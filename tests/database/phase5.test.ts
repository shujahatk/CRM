import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';

const w = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let db: PGlite;

async function actor(n: number) {
  await db.exec(`set local role authenticated;select set_config('request.jwt.claims','${JSON.stringify({
    sub: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    aal: 'aal2',
    role: 'authenticated',
  })}',true);`);
}

async function value<T>(sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<{ v: T }>(sql, params);
  return res.rows[0].v;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile('tests/support/auth-compat.sql', 'utf8'));
  for (const f of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${f}`, 'utf8'));
  }
  await db.exec(await readFile('supabase/tests/fixtures.sql', 'utf8'));
});

afterAll(async () => {
  await db?.close();
});

let emailAccount1: string;
let emailAccount2: string;
let lead1: string;
let lead2: string;

beforeEach(async () => {
  await db.exec('begin');
  await actor(1); // admin

  // Create channel accounts via api.upsert_channel_account
  const acc1 = await value<{ id: string }>(
    `select api.upsert_channel_account($1, 'email', 'sales@example.com', 'Primary Sales Inbox', true) v`,
    [w]
  );
  emailAccount1 = acc1.id;

  const acc2 = await value<{ id: string }>(
    `select api.upsert_channel_account($1, 'email', 'support@example.com', 'Support Inbox', false) v`,
    [w]
  );
  emailAccount2 = acc2.id;

  await db.query(
    `select api.upsert_channel_account($1, 'sms', '+12025550100', 'Primary SMS', true)`,
    [w]
  );

  lead1 = await value<string>("select api.create_lead($1, 'Alice Corp', 'alice@example.com', '+12025550101', 'Alice') v", [w]);
  lead2 = await value<string>("select api.create_lead($1, 'Bob LLC', 'bob@example.com', '+12025550102', 'Bob') v", [w]);
});

afterEach(async () => {
  await db.exec('rollback');
});

// ==========================================
// 1. CONVERSATION IDENTITY & THREADING (Correction 1)
// ==========================================
it('same lead + same channel + different destination creates distinct conversations', async () => {
  const msg1 = await value<{ conversation_id: string; message_id: string }>(
    `select api.create_outbound_message(
      $1, $2, 'email', 'alice.work@example.com', 'Here is the work contract', 'Contract', null, null, 'out-1', $3
    ) v`,
    [w, lead1, emailAccount1]
  );

  const msg2 = await value<{ conversation_id: string; message_id: string }>(
    `select api.create_outbound_message(
      $1, $2, 'email', 'alice.personal@example.com', 'Here is your personal copy', 'Personal note', null, null, 'out-2', $3
    ) v`,
    [w, lead1, emailAccount1]
  );

  expect(msg1.conversation_id).not.toBe(msg2.conversation_id);

  // Sending again to alice.work@example.com reuses the same conversation
  const msg3 = await value<{ conversation_id: string; message_id: string }>(
    `select api.create_outbound_message(
      $1, $2, 'email', 'alice.work@example.com', 'Following up on work contract', 'Update', null, null, 'out-3', $3
    ) v`,
    [w, lead1, emailAccount1]
  );
  expect(msg3.conversation_id).toBe(msg1.conversation_id);
});

it('same lead + same destination + different channel account creates distinct conversations', async () => {
  const msgSales = await value<{ conversation_id: string; message_id: string }>(
    `select api.create_outbound_message(
      $1, $2, 'email', 'alice@example.com', 'From sales', 'Sales', null, null, 'sales-1', $3
    ) v`,
    [w, lead1, emailAccount1]
  );

  const msgSupport = await value<{ conversation_id: string; message_id: string }>(
    `select api.create_outbound_message(
      $1, $2, 'email', 'alice@example.com', 'From support', 'Support Ticket', null, null, 'supp-1', $3
    ) v`,
    [w, lead1, emailAccount2]
  );

  expect(msgSales.conversation_id).not.toBe(msgSupport.conversation_id);
});

// ==========================================
// 2. UNRESOLVED / AMBIGUOUS INBOUND (Correction 2)
// ==========================================
it('zero-match inbound is preserved in inbound_message_reviews', async () => {
  const result = await value<{ review_id: string; status: string }>(
    `select api.ingest_inbound_message(
      $1, 'email', 'unknown.sender@unknown.test', 'sales@example.com', 'Hello I want to buy', 'Inquiry', 'prov-msg-001', 'idemp-in-1'
    ) v`,
    [w]
  );

  expect(result.status).toBe('unresolved_inbound');
  expect(result.review_id).toBeTruthy();

  const review = await value<{ resolution_state: string; resolution_reason: string; sender_address_normalized: string }>(
    `select jsonb_build_object(
      'resolution_state', resolution_state,
      'resolution_reason', resolution_reason,
      'sender_address_normalized', sender_address_normalized
    ) v from crm.inbound_message_reviews where id = $1`,
    [result.review_id]
  );
  expect(review.resolution_state).toBe('pending');
  expect(review.resolution_reason).toBe('unmatched_sender');
  expect(review.sender_address_normalized).toBe('unknown.sender@unknown.test');
});

it('inbound review can later resolve to a lead without rewriting history', async () => {
  const ingest = await value<{ review_id: string }>(
    `select api.ingest_inbound_message(
      $1, 'email', 'stranger@example.com', 'sales@example.com', 'Can you help?', 'Question', 'prov-msg-002', 'idemp-in-2'
    ) v`,
    [w]
  );

  // Later an agent resolves this to lead1
  const resolution = await value<{ review_id: string; conversation_id: string; message_id: string }>(
    `select api.resolve_inbound_review($1, $2, $3, 'Confirmed sender identity manually') v`,
    [w, ingest.review_id, lead1]
  );

  expect(resolution.conversation_id).toBeTruthy();
  expect(resolution.message_id).toBeTruthy();

  // Review table is marked resolved with resolver membership preserved
  const review = await value<{ resolution_state: string; resolved_lead_id: string }>(
    `select jsonb_build_object('resolution_state', resolution_state, 'resolved_lead_id', resolved_lead_id::text) v
     from crm.inbound_message_reviews where id = $1`,
    [ingest.review_id]
  );
  expect(review.resolution_state).toBe('resolved');
  expect(review.resolved_lead_id).toBe(lead1);

  // Authoritative message now exists in crm.messages
  const msgCount = await value<number>(
    "select count(*)::int v from crm.messages where id = $1 and direction = 'inbound'",
    [resolution.message_id]
  );
  expect(msgCount).toBe(1);
});

// ==========================================
// 3. TEMPLATE VARIABLE FAILURE (Correction 3)
// ==========================================
it('unknown template variable is rejected at template publish time', async () => {
  const tpl = await value<{ id: string }>(
    `select api.create_template($1, 'Bad Template', 'email') v`,
    [w]
  );

  // Using {{unsupported_variable}} should throw 22023
  await expect(
    value(
      `select api.publish_template_version($1, $2, 'Subject', 'Hello {{unsupported_variable}}') v`,
      [w, tpl.id]
    )
  ).rejects.toMatchObject({ code: '22023' });
});

it('required known variable with missing runtime value is rejected at queue time', async () => {
  const tpl = await value<{ id: string }>(
    `select api.create_template($1, 'Valid Greeting', 'email') v`,
    [w]
  );

  const ver = await value<{ version_id: string }>(
    `select api.publish_template_version($1, $2, 'Hello {{company}}', 'Hi {{first_name}}, welcome to {{company}}') v`,
    [w, tpl.id]
  );

  // Omitting required variable 'company' when lead has null company must reject rendering
  await db.exec('reset role');
  await db.query("update crm.leads set company = null where id = $1", [lead1]);
  await actor(1);

  await db.exec('savepoint invalid_var');
  await expect(
    value(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', null, null, null, $3, 'idemp-tpl-fail', null, jsonb_build_object('first_name', 'Alice')
      ) v`,
      [w, lead1, ver.version_id]
    )
  ).rejects.toMatchObject({ code: '22023' });
  await db.exec('rollback to savepoint invalid_var');

  // Providing all required variables succeeds
  const msg = await value<{ message_id: string }>(
    `select api.create_outbound_message(
      $1, $2, 'email', 'alice@example.com', null, null, null, $3, 'idemp-tpl-pass', null, jsonb_build_object('first_name', 'Alice', 'company', 'Acme')
    ) v`,
    [w, lead1, ver.version_id]
  );
  expect(msg.message_id).toBeTruthy();

  const rendered = await value<string>('select text_body v from crm.messages where id = $1', [msg.message_id]);
  expect(rendered).toBe('Hi Alice, welcome to Acme');
});

// ==========================================
// 4. CAMPAIGN RECIPIENT UNIQUENESS & FROZEN AUDIENCE (Correction 4 & 13)
// ==========================================
it('campaign launch re-evaluates audience transactionally and deduplicates destinations', async () => {
  const tpl = await value<{ id: string }>(
    `select api.create_template($1, 'Campaign Blast', 'email') v`,
    [w]
  );
  const ver = await value<{ version_id: string }>(
    `select api.publish_template_version($1, $2, 'Announcement', 'Hello {{first_name}}') v`,
    [w, tpl.id]
  );

  const camp = await value<{ id: string }>(
    `select api.create_campaign($1, 'Q4 Launch', 'email', $2, '{}'::jsonb) v`,
    [w, ver.version_id]
  );

  const launch = await value<{ campaign_id: string; total_recipients: number }>(
    `select api.launch_campaign($1, $2) v`,
    [w, camp.id]
  );

  expect(launch.total_recipients).toBeGreaterThanOrEqual(2);

  // Verify frozen audience in crm.campaign_recipients
  const recipientCount = await value<number>(
    'select count(*)::int v from crm.campaign_recipients where campaign_id = $1',
    [camp.id]
  );
  expect(recipientCount).toBe(launch.total_recipients);

  // Check unique destination constraint: trying to insert duplicate destination must fail
  const firstDest = await value<string>(
    'select destination_normalized v from crm.campaign_recipients where campaign_id = $1 limit 1',
    [camp.id]
  );
  await db.exec('reset role');
  await db.exec('savepoint dup_dest');
  await expect(
    db.query(
      `insert into crm.campaign_recipients (workspace_id, campaign_id, lead_id, destination_normalized, eligibility_status)
       values ($1, $2, $3, $4, 'eligible')`,
      [w, camp.id, lead2, firstDest]
    )
  ).rejects.toMatchObject({ code: '23505' });
  await db.exec('rollback to savepoint dup_dest');
  await actor(1);
});

// ==========================================
// 5. SUPPRESSION & AUDIT HISTORY (Correction 5 & 11)
// ==========================================
it('suppression blocks outbound message, and revocation preserves audit history', async () => {
  const supp = await value<{ suppression_id: string }>(
    `select api.add_suppression($1, 'destination_block', 'unsubscribe', 'alice@example.com', $2, 'email') v`,
    [w, lead1]
  );
  expect(supp.suppression_id).toBeTruthy();

  // Outbound message to alice@example.com must be rejected as suppressed
  await db.exec('savepoint supp_msg');
  await expect(
    value(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Text body', 'Subject', null, null, 'supp-test-1', $3
      ) v`,
      [w, lead1, emailAccount1]
    )
  ).rejects.toMatchObject({ code: '22023' });
  await db.exec('rollback to savepoint supp_msg');

  // Revoke suppression
  const rev = await value<{ status: string }>(
    `select api.revoke_suppression($1, $2, 'Customer re-subscribed via web form') v`,
    [w, supp.suppression_id]
  );
  expect(rev.status).toBe('revoked');

  // Verify historical record is preserved with revoked_by and revocation_reason
  const record = await value<{ status: string; revocation_reason: string; revoked_by: string }>(
    `select jsonb_build_object(
      'status', status,
      'revocation_reason', revocation_reason,
      'revoked_by', revoked_by_membership_id::text
    ) v from crm.suppressions where id = $1`,
    [supp.suppression_id]
  );
  expect(record.status).toBe('revoked');
  expect(record.revocation_reason).toBe('Customer re-subscribed via web form');
  expect(record.revoked_by).toBe('10000000-0000-4000-8000-000000000001');

  // Now outbound message succeeds
  const msg = await value<{ message_id: string }>(
    `select api.create_outbound_message(
      $1, $2, 'email', 'alice@example.com', 'Text body', 'Subject', null, null, 'supp-test-after', $3
    ) v`,
    [w, lead1, emailAccount1]
  );
  expect(msg.message_id).toBeTruthy();
});

// ==========================================
// 6. PROVIDERLESS DISPATCH STATE (Correction 6 & 9)
// ==========================================
it('outbound message terminates internally at queued / awaiting_provider', async () => {
  const msg = await value<{ message_id: string }>(
    `select api.create_outbound_message(
      $1, $2, 'email', 'alice@example.com', 'Testing lifecycle', 'Status check', null, null, 'prov-lifecycle-1', $3
    ) v`,
    [w, lead1, emailAccount1]
  );

  const status = await value<{ status: string; dispatch_status: string }>(
    `select jsonb_build_object('status', status, 'dispatch_status', dispatch_status) v from crm.messages where id = $1`,
    [msg.message_id]
  );

  expect(status.status).toBe('queued');
  expect(status.dispatch_status).toBe('awaiting_provider');

  // Verify message event was logged
  const eventCount = await value<number>(
    "select count(*)::int v from crm.message_events where message_id = $1 and event_type = 'queued'",
    [msg.message_id]
  );
  expect(eventCount).toBe(1);
});

// ==========================================
// 7. SEQUENCES & STATE MACHINE (Correction 14 & 15)
// ==========================================
it('sequences support versioning, enrollment, and step executions', async () => {
  const tpl = await value<{ id: string }>(
    `select api.create_template($1, 'Seq Template', 'email') v`,
    [w]
  );
  const tplVer = await value<{ version_id: string }>(
    `select api.publish_template_version($1, $2, 'Welcome', 'Welcome to the platform!') v`,
    [w, tpl.id]
  );

  const seq = await value<{ id: string }>(
    `select api.create_sequence($1, 'Onboarding Drip', '3-step sequence') v`,
    [w]
  );

  // Publish sequence version with step 1
  await value<{ version_id: string }>(
    `select api.publish_sequence_version($1, $2, $3::jsonb) v`,
    [
      w,
      seq.id,
      JSON.stringify([
        { step_number: 1, delay_seconds: 0, channel: 'email', template_version_id: tplVer.version_id }
      ])
    ]
  );

  // Enroll lead1
  const enrollment = await value<{ enrollment_id: string }>(
    `select api.enroll_lead_sequence($1, $2, $3) v`,
    [w, seq.id, lead1]
  );
  expect(enrollment.enrollment_id).toBeTruthy();

  const enrStatus = await value<string>('select status v from crm.sequence_enrollments where id = $1', [enrollment.enrollment_id]);
  expect(enrStatus).toBe('active');

  // Verify step execution was scheduled
  const stepExecCount = await value<number>(
    'select count(*)::int v from crm.sequence_step_executions where enrollment_id = $1',
    [enrollment.enrollment_id]
  );
  expect(stepExecCount).toBe(1);
});

// ==========================================
// 8. INBOUND IDEMPOTENCY & SCOPING (Correction 12)
// ==========================================
it('inbound idempotency binds payload hash and prevents duplicate messages', async () => {
  const first = await value<{ message_id: string; review_id: string }>(
    `select api.ingest_inbound_message(
      $1, 'email', 'alice@example.com', 'sales@example.com', 'My inquiry', 'Hello', 'msg-ext-100', 'idemp-in-key'
    ) v`,
    [w]
  );

  // Re-submitting with identical payload reuses authoritative result
  const replay = await value<{ message_id: string; review_id: string }>(
    `select api.ingest_inbound_message(
      $1, 'email', 'alice@example.com', 'sales@example.com', 'My inquiry', 'Hello', 'msg-ext-100', 'idemp-in-key'
    ) v`,
    [w]
  );
  expect(replay.message_id).toBe(first.message_id);

  // Re-submitting with different payload with same key must reject
  await db.exec('savepoint idemp_replay');
  await expect(
    value(
      `select api.ingest_inbound_message(
        $1, 'email', 'alice@example.com', 'sales@example.com', 'Different', 'Changed Subject', 'msg-ext-100', 'idemp-in-key'
      ) v`,
      [w]
    )
  ).rejects.toMatchObject({ code: '40001' });
  await db.exec('rollback to savepoint idemp_replay');
});

// ==========================================
// 9. CROSS-WORKSPACE SECURITY & RLS (Correction 18)
// ==========================================
it('cross-workspace entities and permissions are strictly enforced', async () => {
  // User 1 belongs to Workspace A ($w)
  // Trying to create a message in otherW using user 1 must fail with 42501
  await db.exec('savepoint cross_w');
  await expect(
    value(
      `select api.create_outbound_message(
        $1, $2, 'email', 'cross@example.com', 'Body', 'Subject', null, null, 'cross-test', $3
      ) v`,
      [otherW, lead1, emailAccount1]
    )
  ).rejects.toMatchObject({ code: '42501' });
  await db.exec('rollback to savepoint cross_w');

  // Read-only user cannot create outbound message
  await actor(5); // reader
  await db.exec('savepoint reader_w');
  await expect(
    value(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Body', 'Subject', null, null, 'reader-fail', $3
      ) v`,
      [w, lead1, emailAccount1]
    )
  ).rejects.toMatchObject({ code: '42501' });
  await db.exec('rollback to savepoint reader_w');
});

// ==========================================
// 10. JIT SUPPRESSION & SAFE JOB CANCELLATION (Corrections 10, 11, 15)
// ==========================================
it('campaign recipient eligible at launch but DNC before dispatch is suppressed', async () => {
  const tpl = await value<{ id: string }>(`select api.create_template($1, 'JIT Campaign', 'email') v`, [w]);
  const ver = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Hello', 'Hi {{first_name}}') v`, [w, tpl.id]);
  const camp = await value<{ id: string }>(`select api.create_campaign($1, 'JIT Test', 'email', $2, '{}'::jsonb) v`, [w, ver.version_id]);
  await value(`select api.launch_campaign($1, $2) v`, [w, camp.id]);

  // Lead1 was eligible at launch. Now lead1 opts out before batch dispatch runs
  await value(
    `select api.add_suppression($1, 'destination_block', 'manual_dnc', 'alice@example.com', $2, 'email') v`,
    [w, lead1]
  );

  // Worker executes batch
  await db.exec('reset role');
  const batch = await value<{ dispatched: number; suppressed: number }>(
    `select private.process_campaign_batch($1, $2, 10) v`,
    [w, camp.id]
  );
  await actor(1);

  expect(batch.suppressed).toBeGreaterThanOrEqual(1);

  // Verify recipient record in campaign_recipients is marked suppressed with audit details
  const rec = await value<{ eligibility_status: string; suppression_reason: string }>(
    `select jsonb_build_object('eligibility_status', eligibility_status, 'suppression_reason', suppression_reason) v
     from crm.campaign_recipients where campaign_id = $1 and lead_id = $2`,
    [camp.id, lead1]
  );
  expect(rec.eligibility_status).toBe('suppressed');
  expect(rec.suppression_reason).toBe('manual_dnc');
});

it('cancelled campaign stale job cannot dispatch', async () => {
  const tpl = await value<{ id: string }>(`select api.create_template($1, 'Cancel Camp Tpl', 'email') v`, [w]);
  const ver = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Hello', 'Hi {{first_name}}') v`, [w, tpl.id]);
  const camp = await value<{ id: string }>(`select api.create_campaign($1, 'Cancel Test', 'email', $2, '{}'::jsonb) v`, [w, ver.version_id]);
  await value(`select api.launch_campaign($1, $2) v`, [w, camp.id]);

  // Cancel campaign
  await value(`select api.cancel_campaign($1, $2) v`, [w, camp.id]);

  // Stale worker picks up job
  await db.exec('reset role');
  const res = await value<{ status: string; dispatched: number }>(
    `select private.process_campaign_batch($1, $2, 100) v`,
    [w, camp.id]
  );
  await actor(1);
  expect(res.status).toBe('cancelled');
  expect(res.dispatched).toBe(0);

  // No messages were dispatched
  const msgCount = await value<number>('select count(*)::int v from crm.messages where campaign_id = $1', [camp.id]);
  expect(msgCount).toBe(0);
});

it('sequence step scheduled before consent withdrawal does not dispatch', async () => {
  const tpl = await value<{ id: string }>(`select api.create_template($1, 'Seq DNC Tpl', 'email') v`, [w]);
  const tplVer = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Hello', 'Hi {{first_name}}') v`, [w, tpl.id]);
  const seq = await value<{ id: string }>(`select api.create_sequence($1, 'DNC Seq', 'dnc test') v`, [w]);
  await value(
    `select api.publish_sequence_version($1, $2, $3::jsonb) v`,
    [w, seq.id, JSON.stringify([{ step_number: 1, delay_seconds: 0, channel: 'email', template_version_id: tplVer.version_id }])]
  );

  const enr = await value<{ enrollment_id: string }>(`select api.enroll_lead_sequence($1, $2, $3) v`, [w, seq.id, lead1]);
  const execId = await value<string>('select id v from crm.sequence_step_executions where enrollment_id = $1 limit 1', [enr.enrollment_id]);

  // Lead opts out
  await value(
    `select api.add_suppression($1, 'destination_block', 'consent_withdrawn', 'alice@example.com', $2, 'email') v`,
    [w, lead1]
  );

  // Worker runs step
  await db.exec('reset role');
  const result = await value<{ status: string; reason: string }>(
    `select private.process_sequence_step_execution($1, $2) v`,
    [w, execId]
  );
  await actor(1);
  expect(result.status).toBe('skipped');
  expect(result.reason).toBe('suppressed');

  const execStatus = await value<string>('select status v from crm.sequence_step_executions where id = $1', [execId]);
  expect(execStatus).toBe('skipped');
});

it('exited sequence stale job cannot dispatch', async () => {
  const tpl = await value<{ id: string }>(`select api.create_template($1, 'Seq Exit Tpl', 'email') v`, [w]);
  const tplVer = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Hello', 'Hi {{first_name}}') v`, [w, tpl.id]);
  const seq = await value<{ id: string }>(`select api.create_sequence($1, 'Exit Seq', 'exit test') v`, [w]);
  await value(
    `select api.publish_sequence_version($1, $2, $3::jsonb) v`,
    [w, seq.id, JSON.stringify([{ step_number: 1, delay_seconds: 0, channel: 'email', template_version_id: tplVer.version_id }])]
  );

  const enr = await value<{ enrollment_id: string }>(`select api.enroll_lead_sequence($1, $2, $3) v`, [w, seq.id, lead1]);
  const execId = await value<string>('select id v from crm.sequence_step_executions where enrollment_id = $1 limit 1', [enr.enrollment_id]);

  // Lead replies inbound -> exits sequence
  await value(
    `select api.ingest_inbound_message($1, 'email', 'alice@example.com', 'sales@example.com', 'I want to talk', 'Re: Hello') v`,
    [w]
  );

  const enrStatus = await value<string>('select status v from crm.sequence_enrollments where id = $1', [enr.enrollment_id]);
  expect(enrStatus).toBe('exited');

  // Stale worker executes step
  await db.exec('reset role');
  const result = await value<{ status: string; reason: string }>(
    `select private.process_sequence_step_execution($1, $2) v`,
    [w, execId]
  );
  await actor(1);
  expect(result.status).toBe('cancelled');
  expect(result.reason).toBe('enrollment_not_active');
});

