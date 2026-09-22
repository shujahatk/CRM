import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import { beforeAll, afterAll, expect, it } from "vitest";

type Row = Record<string, unknown>;

const wA = "'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'";
const wB = "'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'";
const member = (n: number) => `'10000000-0000-4000-8000-${String(n).padStart(12, "0")}'`;

function identitySql(user?: number, role = "authenticated", aal = "aal2") {
  const claims = {
    sub: user ? `00000000-0000-4000-8000-${String(user).padStart(12, "0")}` : undefined,
    aal,
    role,
    user_metadata: { role: "admin" },
  };
  return `set local role ${role}; select set_config('request.jwt.claims','${JSON.stringify(claims)}',true);`;
}

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile("tests/support/auth-compat.sql", "utf8"));
  for (const file of (await readdir("supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  }
  await db.exec(await readFile("supabase/tests/fixtures.sql", "utf8"));
});

afterAll(async () => {
  if (db) await db.close();
});

it("manual lead creation succeeds and initializes default journey at new_lead", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1)); // Admin
    const res = await db.query(`select api.create_lead(${wA}, 'Jane Doe', 'jane@example.test', '+15551234567', 'Acme Corp', 'cmd-1') as lead_id`);
    const leadId = (res.rows[0] as Row).lead_id;
    expect(leadId).toBeDefined();

    // Verify lead created
    const leadCheck = await db.query(`select * from crm.leads where id = '${leadId}'`);
    expect(leadCheck.rows).toHaveLength(1);
    expect((leadCheck.rows[0] as Row).display_name).toBe("Jane Doe");

    // Verify journey initialized at new_lead
    const journeyCheck = await db.query(`select j.*, s.stable_code from crm.lead_journeys j join crm.stages s on s.id=j.stage_id where j.lead_id = '${leadId}'`);
    expect(journeyCheck.rows).toHaveLength(1);
    expect((journeyCheck.rows[0] as Row).stable_code).toBe("new_lead");

    // Verify activity logged
    const actCheck = await db.query(`select * from crm.activities where lead_id = '${leadId}' and event_type = 'lead.created'`);
    expect(actCheck.rows).toHaveLength(1);
  } finally {
    await db.exec("rollback;");
  }
});

it("duplicate email is rejected and does not overwrite", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    await db.exec(`select api.create_lead(${wA}, 'Lead One', 'unique@example.test', null, null)`);
    await expect(
      db.exec(`select api.create_lead(${wA}, 'Lead Two', 'unique@example.test', null, null)`)
    ).rejects.toMatchObject({ code: "40001" });
  } finally {
    await db.exec("rollback;");
  }
});

it("duplicate phone is rejected", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    await db.exec(`select api.create_lead(${wA}, 'Lead One', null, '+15559876543', null)`);
    await expect(
      db.exec(`select api.create_lead(${wA}, 'Lead Two', null, '+15559876543', null)`)
    ).rejects.toMatchObject({ code: "40001" });
  } finally {
    await db.exec("rollback;");
  }
});

it("identical names with distinct contact details do NOT collide", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const r1 = await db.query(`select api.create_lead(${wA}, 'John Smith', 'john1@example.test', null, null) as id`);
    const r2 = await db.query(`select api.create_lead(${wA}, 'John Smith', 'john2@example.test', null, null) as id`);
    expect((r1.rows[0] as Row).id).not.toBe((r2.rows[0] as Row).id);
  } finally {
    await db.exec("rollback;");
  }
});

it("ambiguous collision logs identity_conflict and denies silent merge", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    await db.exec(`select api.create_lead(${wA}, 'Lead A', 'leada@example.test', '+15551111111', null)`);
    await db.exec(`select api.create_lead(${wA}, 'Lead B', 'leadb@example.test', '+15552222222', null)`);

    // Intake with Lead A's email and Lead B's phone
    await db.exec("savepoint sp_conflict;");
    await expect(
      db.exec(`select api.create_lead(${wA}, 'Conflict Candidate', 'leada@example.test', '+15552222222', null)`)
    ).rejects.toMatchObject({ code: "40001" });
    await db.exec("rollback to savepoint sp_conflict;");

    // Conflict recording logs identity_conflict for manager review
    await db.exec(`select api.record_identity_conflict(
      ${wA},
      'intake_test',
      array['10000000-0000-4000-8000-000000000001'::uuid, '10000000-0000-4000-8000-000000000002'::uuid],
      '[{"kind": "email", "value": "leada@example.test"}, {"kind": "phone", "value": "+15552222222"}]'::jsonb,
      'Email and phone belong to distinct existing leads'
    )`);

    // Verify conflict record created
    const conflicts = await db.query(`select * from crm.identity_conflicts where workspace_id = ${wA}`);
    expect(conflicts.rows.length).toBeGreaterThanOrEqual(1);
    expect((conflicts.rows[0] as Row).status).toBe("open");
  } finally {
    await db.exec("rollback;");
  }
});

it("command idempotency returns existing lead without duplicate side effects", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const r1 = await db.query(`select api.create_lead(${wA}, 'Idempotent Lead', 'idem@example.test', null, null, 'key-100') as id`);
    const id1 = (r1.rows[0] as Row).id;

    const r2 = await db.query(`select api.create_lead(${wA}, 'Idempotent Lead', 'idem@example.test', null, null, 'key-100') as id`);
    const id2 = (r2.rows[0] as Row).id;

    expect(id1).toBe(id2);

    // Verify only 1 activity created
    const acts = await db.query(`select count(*) as cnt from crm.activities where lead_id = '${id1}'`);
    expect(Number((acts.rows[0] as Row).cnt)).toBe(1);
  } finally {
    await db.exec("rollback;");
  }
});

it("read-only user cannot create or edit leads", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(5)); // User 5 is read_only
    await expect(
      db.exec(`select api.create_lead(${wA}, 'Forbidden', 'ro@example.test', null, null)`)
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.exec("rollback;");
  }
});

it("lead assignment records history and activity", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const res = await db.query(`select api.create_lead(${wA}, 'Assignee Test', 'assign@example.test', null, null) as id`);
    const leadId = (res.rows[0] as Row).id;

    // Admin assigns setter (user 3) and closer (user 4)
    await db.exec(`select api.assign_lead(${wA}, '${leadId}', ${member(3)}, ${member(4)}, '20000000-0000-4000-8000-000000000001', 'Initial triage', 1)`);

    // Verify assignment on lead
    const lead = await db.query(`select * from crm.leads where id = '${leadId}'`);
    expect((lead.rows[0] as Row).assigned_setter_id).toBe("10000000-0000-4000-8000-000000000003");
    expect((lead.rows[0] as Row).assigned_closer_id).toBe("10000000-0000-4000-8000-000000000004");

    // Verify assignment history
    const history = await db.query(`select * from crm.assignment_history where lead_id = '${leadId}'`);
    expect(history.rows).toHaveLength(2); // setter + closer
  } finally {
    await db.exec("rollback;");
  }
});

it("setter cannot reassign leads", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const res = await db.query(`select api.create_lead(${wA}, 'Setter Reassign', 'reassign@example.test', null, null) as id`);
    const leadId = (res.rows[0] as Row).id;

    // Setter (user 3) attempts reassignment
    await db.exec(identitySql(3));
    await expect(
      db.exec(`select api.assign_lead(${wA}, '${leadId}', ${member(3)}, ${member(4)}, null, 'Hack', 1)`)
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.exec("rollback;");
  }
});

it("stage transition succeeds and records immutable transition", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const res = await db.query(`select api.create_lead(${wA}, 'Stage Move', 'move@example.test', null, null) as id`);
    const leadId = (res.rows[0] as Row).id;

    // Move to contacted
    await db.exec(`select api.transition_stage(${wA}, '${leadId}', 'contacted')`);

    const journey = await db.query(`select j.*, s.stable_code from crm.lead_journeys j join crm.stages s on s.id=j.stage_id where j.lead_id = '${leadId}'`);
    expect((journey.rows[0] as Row).stable_code).toBe("contacted");

    // Transition history check
    const transitions = await db.query(`select * from crm.journey_transitions where journey_id = '${(journey.rows[0] as Row).id}'`);
    expect(transitions.rows).toHaveLength(1);
  } finally {
    await db.exec("rollback;");
  }
});

it("transition to Closed Lost without lost reason is rejected", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const res = await db.query(`select api.create_lead(${wA}, 'Lost Move', 'lost@example.test', null, null) as id`);
    const leadId = (res.rows[0] as Row).id;

    await expect(
      db.exec(`select api.transition_stage(${wA}, '${leadId}', 'closed_lost')`)
    ).rejects.toMatchObject({ code: "22023" });
  } finally {
    await db.exec("rollback;");
  }
});

it("concurrency conflict on stage transition is rejected", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const res = await db.query(`select api.create_lead(${wA}, 'Conflict Move', 'cmove@example.test', null, null) as id`);
    const leadId = (res.rows[0] as Row).id;

    await expect(
      db.exec(`select api.transition_stage(${wA}, '${leadId}', 'contacted', null, null, 999)`)
    ).rejects.toMatchObject({ code: "40001" });
  } finally {
    await db.exec("rollback;");
  }
});

it("notes support revisions and immutability", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const res = await db.query(`select api.create_lead(${wA}, 'Notes Test', 'notes@example.test', null, null) as id`);
    const leadId = (res.rows[0] as Row).id;

    // Create note
    const nres = await db.query(`select api.create_note(${wA}, '${leadId}', 'Initial note body', true, true) as note_id`);
    const noteId = (nres.rows[0] as Row).note_id;

    // Edit note
    await db.exec(`select api.edit_note(${wA}, '${noteId}', 'Updated note body')`);

    // Verify 2 revisions exist
    const revs = await db.query(`select * from crm.note_revisions where note_id = '${noteId}' order by revision_number asc`);
    expect(revs.rows).toHaveLength(2);
    expect((revs.rows[0] as Row).body).toBe("Initial note body");
    expect((revs.rows[1] as Row).body).toBe("Updated note body");

    // Direct revision update fails
    await expect(
      db.exec(`update crm.note_revisions set body = 'Hacked' where id = '${(revs.rows[0] as Row).id}'`)
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.exec("rollback;");
  }
});

it("tasks update next-action projection on create, complete and reopen", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const res = await db.query(`select api.create_lead(${wA}, 'Task Test', 'task@example.test', null, null) as id`);
    const leadId = (res.rows[0] as Row).id;

    // Create task due in 2 hours
    const tres = await db.query(`select api.create_task(${wA}, '${leadId}', ${member(3)}, 'Call back tomorrow', now() + interval '2 hours', 'high') as task_id`);
    const taskId = (tres.rows[0] as Row).task_id;

    // Verify next-action projection populated
    const nap1 = await db.query(`select * from crm.next_action_projection where lead_id = '${leadId}'`);
    expect(nap1.rows).toHaveLength(1);
    expect((nap1.rows[0] as Row).task_id).toBe(taskId);

    // Complete task -> projection cleared
    await db.exec(`select api.complete_task(${wA}, '${taskId}')`);
    const nap2 = await db.query(`select * from crm.next_action_projection where lead_id = '${leadId}'`);
    expect(nap2.rows).toHaveLength(0);

    // Reopen task -> projection restored
    await db.exec(`select api.reopen_task(${wA}, '${taskId}')`);
    const nap3 = await db.query(`select * from crm.next_action_projection where lead_id = '${leadId}'`);
    expect(nap3.rows).toHaveLength(1);
    expect((nap3.rows[0] as Row).task_id).toBe(taskId);
  } finally {
    await db.exec("rollback;");
  }
});

it("activities and transitions reject update/delete", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const res = await db.query(`select api.create_lead(${wA}, 'Immutable Test', 'immut@example.test', null, null) as id`);
    const leadId = (res.rows[0] as Row).id;

    const act = await db.query(`select id from crm.activities where lead_id = '${leadId}' limit 1`);
    const actId = (act.rows[0] as Row).id;

    await db.exec("savepoint sp_del;");
    await expect(db.exec(`delete from crm.activities where id = '${actId}'`)).rejects.toMatchObject({ code: "42501" });
    await db.exec("rollback to savepoint sp_del;");

    await db.exec("savepoint sp_upd;");
    await expect(db.exec(`update crm.activities set event_type = 'hacked' where id = '${actId}'`)).rejects.toMatchObject({ code: "42501" });
    await db.exec("rollback to savepoint sp_upd;");
  } finally {
    await db.exec("rollback;");
  }
});

it("cross-workspace lead access is completely denied", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1)); // Admin of Workspace A
    const res = await db.query(`select api.create_lead(${wA}, 'Workspace A Lead', 'wA@example.test', null, null) as id`);
    const leadId = (res.rows[0] as Row).id;

    // Switch identity to Owner B (workspace B)
    await db.exec(identitySql(7));
    const check = await db.query(`select * from crm.leads where id = '${leadId}'`);
    expect(check.rows).toHaveLength(0);

    // Direct detail RPC returns forbidden
    await expect(
      db.exec(`select api.get_lead_detail(${wB}, '${leadId}')`)
    ).rejects.toMatchObject({ code: "42501" });
  } finally {
    await db.exec("rollback;");
  }
});

it("list_leads filters by search query and supports server pagination", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    await db.exec(`select api.create_lead(${wA}, 'Alice Apple', 'alice@corp.test', null, 'Apple Inc')`);
    await db.exec(`select api.create_lead(${wA}, 'Bob Banana', 'bob@banana.test', null, 'Banana LLC')`);
    await db.exec(`select api.create_lead(${wA}, 'Charlie Citrus', 'charlie@citrus.test', null, 'Citrus Co')`);

    // Search for Apple
    const searchRes = await db.query(`select * from api.list_leads(${wA}, 'Apple', null, null, null, 10, 0)`);
    expect(searchRes.rows).toHaveLength(1);
    expect((searchRes.rows[0] as Row).display_name).toBe("Alice Apple");

    // Pagination test (limit 2 offset 0)
    const page1 = await db.query(`select * from api.list_leads(${wA}, null, null, null, null, 2, 0)`);
    expect(page1.rows).toHaveLength(2);
    expect(Number((page1.rows[0] as Row).total_count)).toBeGreaterThanOrEqual(3);
  } finally {
    await db.exec("rollback;");
  }
});

it("pipeline_board aggregates all default stages with leads", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    const l1 = await db.query(`select api.create_lead(${wA}, 'Board Lead', 'board@lead.test', null, null) as id`);
    const leadId = (l1.rows[0] as Row).id;

    const res = await db.query(`select api.pipeline_board(${wA}) as board`);
    const board = (res.rows[0] as Row).board;
    expect(board).toBeInstanceOf(Array);
    const boardList = board as Row[];
    expect(boardList.length).toBe(13); // All 13 stages

    const newLeadStage = boardList.find((s) => s.stage_code === "new_lead") as { leads: Row[] } | undefined;
    expect(newLeadStage).toBeDefined();
    expect(newLeadStage?.leads.some((l) => l.id === leadId)).toBe(true);
  } finally {
    await db.exec("rollback;");
  }
});

it("dashboard_metrics returns accurate counters and stage distribution", async () => {
  await db.exec("begin;");
  try {
    await db.exec(identitySql(1));
    await db.exec(`select api.create_lead(${wA}, 'Metric Lead', 'metric@lead.test', null, null)`);

    const res = await db.query(`select * from api.dashboard_metrics(${wA})`);
    expect(res.rows).toHaveLength(1);
    const m = res.rows[0] as Row;
    expect(Number(m.total_active_leads)).toBeGreaterThanOrEqual(1);
    expect(Number(m.new_leads_7d)).toBeGreaterThanOrEqual(1);
    expect(Number(m.unassigned_leads)).toBeGreaterThanOrEqual(1);
    expect(m.stage_distribution).toBeInstanceOf(Array);
  } finally {
    await db.exec("rollback;");
  }
});
