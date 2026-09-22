import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const member = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
let db: PGlite;
let lead: string, hidden: string, account: string, foreignAccount: string;
let conversation: string, message: string, review: string, foreignReview: string;
async function actor(n: number) {
  await db.exec(`set local role authenticated; select set_config('request.jwt.claims','${JSON.stringify({ sub: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, aal: 'aal2', role: 'authenticated' })}',true)`);
}
async function value<T>(sql: string, args: unknown[] = []): Promise<T> {
  return (await db.query<{ v: T }>(sql, args)).rows[0].v;
}
async function denied(sql: string, args: unknown[] = [], code = '42501') {
  await db.exec('savepoint denied');
  try { await expect(db.query(sql, args)).rejects.toMatchObject({ code }); }
  finally { await db.exec('rollback to savepoint denied'); }
}
async function inbound(workspace: string, key: string, sender = 'person@example.test', recipient = 'inbox@example.test', body = 'Private inbound evidence') {
  return value<{ message_id?: string; conversation_id?: string; review_id?: string }>(
    `select api.ingest_inbound_message($1,'email',$2,$3,$4,'Subject',$5,$5,'2026-09-23T00:00:00Z') v`,
    [workspace, sender, recipient, body, key]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile('tests/support/auth-compat.sql', 'utf8'));
  for (const file of (await readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(await readFile('supabase/tests/fixtures.sql', 'utf8'));
});
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('begin');
  await actor(1);
  account = (await value<{ id: string }>(`select api.upsert_channel_account($1,'email','inbox@example.test','Inbox',true) v`, [a])).id;
  lead = await value<string>(`select api.create_lead($1,'Person','person@example.test',null,'Company') v`, [a]);
  hidden = await value<string>(`select api.create_lead($1,'Hidden','hidden@example.test',null,'Company') v`, [a]);
  await db.exec('reset role');
  await db.query(`update crm.leads set accountable_team_id='20000000-0000-4000-8000-000000000001',assigned_setter_id=$2,assigned_closer_id=$3 where id=$1`, [lead, member(3), member(4)]);
  await db.query(`update crm.leads set accountable_team_id='20000000-0000-4000-8000-000000000002' where id=$1`, [hidden]);
  await actor(1);
  const received = await inbound(a, 'initial');
  conversation = received.conversation_id!; message = received.message_id!;
  review = (await inbound(a, 'unknown', 'unknown@example.test')).review_id!;
  await inbound(a, 'hidden', 'hidden@example.test');
  await actor(7);
  foreignAccount = (await value<{ id: string }>(`select api.upsert_channel_account($1,'email','foreign@example.test','Foreign',true) v`, [b])).id;
  foreignReview = (await inbound(b, 'foreign', 'unknown@example.test', 'foreign@example.test')).review_id!;
  await actor(1);
});
afterEach(async () => { await db.exec('rollback'); });

it('rejects cross-workspace inbound RPC before any business side effects', async () => {
  await db.exec('reset role');
  const snapshot = () => value<string>(`select jsonb_build_array((select count(*) from crm.messages),(select count(*) from crm.conversations),(select count(*) from crm.conversation_participants),(select count(*) from crm.inbound_message_reviews),(select count(*) from crm.message_events),(select count(*) from crm.activities),(select count(*) from crm.identity_claims))::text v`);
  const before = await snapshot(); await actor(1);
  await denied(`select api.ingest_inbound_message($1,'email','attacker@example.test','foreign@example.test','forged',null,'attack','attack')`, [b]);
  await db.exec('reset role'); expect(await snapshot()).toBe(before);
});
it.each([3, 4, 5, 6])('rejects non-reviewer/inactive actor %s inbound injection', async n => {
  await actor(n); await denied(`select api.ingest_inbound_message($1,'email','unknown@example.test','inbox@example.test','forged')`, [a]);
});
it('rejects anonymous direct inbound RPC', async () => {
  await db.exec(`set local role anon; select set_config('request.jwt.claims','{}',true)`);
  await denied(`select api.ingest_inbound_message($1,'email','unknown@example.test','inbox@example.test','forged')`, [a]);
});
it.each([1, 2, 3, 4])('role %s reads legitimate scoped message and detail', async n => {
  await actor(n);
  expect(await value<number>('select count(*)::int v from crm.messages where id=$1', [message])).toBe(1);
  const rows = await value<Array<{ id: string; text_body: string; sender: string; recipient: string; author_name: string | null }>>('select api.get_conversation_messages($1,$2) v', [a, conversation]);
  expect(rows[0]).toMatchObject({ id: message, text_body: 'Private inbound evidence', sender: 'person@example.test', recipient: 'inbox@example.test', author_name: null });
});
it.each([2, 3, 4, 5])('role %s cannot read unassigned/other-team message bodies', async n => {
  await actor(n);
  expect(await value<number>('select count(*)::int v from crm.messages where lead_id=$1', [hidden])).toBe(0);
});
it.each(['messages', 'message_events', 'conversations', 'conversation_participants', 'inbound_message_reviews'])('cross-workspace %s table reads return no rows', async table => {
  await actor(7); expect(await value<number>(`select count(*)::int v from crm.${table} where workspace_id=$1`, [a])).toBe(0);
});
it('unprivileged reader has no body access through detail RPC', async () => {
  await actor(5); await denied('select api.get_conversation_messages($1,$2)', [a, conversation]);
});
it('conversation detail is a read and never clears unread state', async () => {
  const before = await value<number>('select unread_count v from crm.conversations where id=$1', [conversation]);
  await value('select api.get_conversation_messages($1,$2) v', [a, conversation]);
  expect(await value<number>('select unread_count v from crm.conversations where id=$1', [conversation])).toBe(before);
});
it('cross-workspace detail RPC is rejected', async () => {
  await actor(7); await denied('select api.get_conversation_messages($1,$2)', [a, conversation]);
});
it('cross-workspace review resolution is rejected', async () => {
  await denied('select api.resolve_inbound_review($1,$2,$3)', [b, foreignReview, lead]);
});
it.each([3, 4, 5, 6])('actor %s cannot resolve review through direct RPC', async n => {
  await actor(n); await denied('select api.resolve_inbound_review($1,$2,$3)', [a, review, lead]);
});
it('manager cannot inspect globally unmatched review evidence', async () => {
  await actor(2); expect(await value<number>('select count(*)::int v from crm.inbound_message_reviews where id=$1', [review])).toBe(0);
});
it('review resolution preserves original immutable evidence', async () => {
  const result = await value<{ message_id: string }>('select api.resolve_inbound_review($1,$2,$3,$4) v', [a, review, lead, 'Verified internally']);
  expect(result.message_id).toBeTruthy();
  await db.exec('reset role');
  await denied(`update crm.inbound_message_reviews set text_body='rewritten' where id=$1`, [review]);
});
it('cross-workspace account cannot create conversation/message', async () => {
  await denied(`select api.create_outbound_message($1,$2,'email','person@example.test','test',null,null,null,'pivot',$3)`, [a, lead, foreignAccount]);
});
it('account channel mismatch is rejected', async () => {
  await denied(`select api.create_outbound_message($1,$2,'sms','+12025550100','test',null,null,null,'channel-pivot',$3)`, [a, lead, account]);
});
it('foreign recipient account cannot be consumed as an inbound account', async () => {
  const result = await inbound(a, 'account-pivot', 'person@example.test', 'foreign@example.test');
  expect(result.message_id).toBeUndefined(); expect(result.review_id).toBeTruthy();
  expect(await value<string>('select resolution_reason v from crm.inbound_message_reviews where id=$1', [result.review_id])).toBe('missing_channel_account');
});
const lists = ['list_conversations', 'list_campaigns', 'list_message_templates', 'list_sequences', 'list_inbound_reviews'] as const;
it.each(lists)('%s works with deterministic array shape and no provider metadata', async rpc => {
  const rows = await value<Array<Record<string, unknown>>>(`select api.${rpc}($1) v`, [a]);
  expect(Array.isArray(rows)).toBe(true);
  for (const row of rows) { expect(row).not.toHaveProperty('provider_message_id'); expect(row).not.toHaveProperty('html_body'); }
  expect(await value(`select api.${rpc}($1) v`, [a])).toEqual(rows);
});
it.each(lists)('%s denies wrong workspace direct RPC', async rpc => {
  await actor(7); await denied(`select api.${rpc}($1)`, [a]);
});
it.each(lists)('%s handles empty authorized workspace', async rpc => {
  await db.exec('reset role');
  const empty = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.query(`insert into crm.workspaces(id,name) values ($1,'Empty');`, [empty]);
  await db.query(`insert into crm.memberships(workspace_id,user_id,role,is_owner) values ($1,'00000000-0000-4000-8000-000000000001','admin',true)`, [empty]);
  await actor(1); expect(await value(`select api.${rpc}($1) v`, [empty])).toEqual([]);
});
it('conversation list exposes bounded snippet, not full body/HTML/provider ID', async () => {
  const rows = await value<Array<Record<string, unknown>>>('select api.list_conversations($1) v', [a]);
  expect(rows.length).toBe(2);
  for (const row of rows) { expect(row).not.toHaveProperty('text_body'); expect(String(row.last_message_snippet).length).toBeLessThanOrEqual(100); }
  expect(rows[0]).toHaveProperty('assigned_to_name');
});
it('inbound replay preserves same result', async () => {
  expect(await inbound(a, 'repeat')).toEqual(await inbound(a, 'repeat'));
});
it('inbound key binds recipient as well as content', async () => {
  await inbound(a, 'recipient-key');
  await denied(`select api.ingest_inbound_message($1,'email','person@example.test','other@example.test','Private inbound evidence','Subject','recipient-key','recipient-key','2026-09-23T00:00:00Z')`, [a], '40001');
});
it('inbound key rejects changed body', async () => {
  await inbound(a, 'body-key');
  await denied(`select api.ingest_inbound_message($1,'email','person@example.test','inbox@example.test','changed','Subject','body-key','body-key','2026-09-23T00:00:00Z')`, [a], '40001');
});
it('same key in legitimately authorized workspaces does not collide or leak', async () => {
  const first = await inbound(a, 'shared-key'); await actor(7);
  const second = await inbound(b, 'shared-key', 'unknown@example.test', 'foreign@example.test');
  expect(second.review_id).toBeTruthy(); expect(second).not.toEqual(first);
});
it('private suppression helper is not an authenticated workspace probe', async () => {
  await denied(`select private.is_suppressed($1,$2,'email','person@example.test')`, [b, lead]);
});
it('read-only cannot mutate canonical message directly', async () => {
  await actor(5); await denied(`update crm.messages set text_body='bad' where id=$1`, [message]);
});

it('campaign private worker rejects cross-workspace campaign execution', async () => {
  await actor(7);
  // Create template and campaign in workspace B
  const tplB = await value<{ id: string }>(`select api.create_template($1, 'Camp B Template', 'email') v`, [b]);
  const verB = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Subject', 'Hi {{first_name}}') v`, [b, tplB.id]);
  const campB = await value<{ id: string }>(`select api.create_campaign($1, 'Camp B', 'email', $2) v`, [b, verB.version_id]);

  // Invoking worker with workspace A on workspace B campaign must be rejected / not found
  await db.exec('reset role');
  const result = await value<{ error: string }>(`select private.process_campaign_batch($1, $2) v`, [a, campB.id]);
  expect(result.error).toBe('campaign_not_found');
});

it('sequence private worker rejects cross-workspace execution', async () => {
  await actor(7);
  // Create template and sequence in workspace B
  const tplB = await value<{ id: string }>(`select api.create_template($1, 'Seq B Template', 'email') v`, [b]);
  const verB = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Subject', 'Hi {{first_name}}') v`, [b, tplB.id]);
  const seqB = await value<{ id: string }>(`select api.create_sequence($1, 'Seq B', 'Description') v`, [b]);
  await value(`select api.publish_sequence_version($1, $2, $3::jsonb) v`, [
    b, seqB.id, JSON.stringify([{ step_number: 1, delay_seconds: 0, channel: 'email', template_version_id: verB.version_id }])
  ]);
  const leadB = await value<string>(`select api.create_lead($1, 'Bob Foreign', 'bobforeign@example.test', null, 'BobCorp') v`, [b]);
  const enrollB = await value<{ enrollment_id: string }>(`select api.enroll_lead_sequence($1, $2, $3) v`, [b, seqB.id, leadB]);
  const execB = await value<string>(`select id v from crm.sequence_step_executions where workspace_id=$1 and enrollment_id=$2 limit 1`, [b, enrollB.enrollment_id]);

  // Invoking worker with workspace A on workspace B execution must be rejected / not found
  await db.exec('reset role');
  const result = await value<{ error: string }>(`select private.process_sequence_step_execution($1, $2) v`, [a, execB]);
  expect(result.error).toBe('execution_not_found');
});

it('stale or cancelled parent stops campaign batch and sequence step dispatch', async () => {
  await actor(1);
  // 1. Campaign cancellation
  const tpl = await value<{ id: string }>(`select api.create_template($1, 'Cancel Camp Tpl', 'email') v`, [a]);
  const ver = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Subject', 'Hi {{first_name}}') v`, [a, tpl.id]);
  const camp = await value<{ id: string }>(`select api.create_campaign($1, 'Cancel Camp', 'email', $2) v`, [a, ver.version_id]);
  await value(`select api.launch_campaign($1, $2) v`, [a, camp.id]);
  await value(`select api.cancel_campaign($1, $2) v`, [a, camp.id]);

  await db.exec('reset role');
  const campResult = await value<{ status: string; dispatched: number }>(`select private.process_campaign_batch($1, $2) v`, [a, camp.id]);
  expect(campResult.status).toBe('cancelled');
  expect(campResult.dispatched).toBe(0);

  // 2. Sequence enrollment exit
  await actor(1);
  const seq = await value<{ id: string }>(`select api.create_sequence($1, 'Exit Seq', 'Desc') v`, [a]);
  await value(`select api.publish_sequence_version($1, $2, $3::jsonb) v`, [
    a, seq.id, JSON.stringify([{ step_number: 1, delay_seconds: 0, channel: 'email', template_version_id: ver.version_id }])
  ]);
  const enroll = await value<{ enrollment_id: string }>(`select api.enroll_lead_sequence($1, $2, $3) v`, [a, seq.id, lead]);
  const execId = await value<string>(`select id v from crm.sequence_step_executions where workspace_id=$1 and enrollment_id=$2 limit 1`, [a, enroll.enrollment_id]);

  // Manually mark enrollment exited
  await db.exec('reset role');
  await db.query(`update crm.sequence_enrollments set status='exited', exit_reason='dnc' where id=$1`, [enroll.enrollment_id]);

  const seqResult = await value<{ status: string; reason: string }>(`select private.process_sequence_step_execution($1, $2) v`, [a, execId]);
  expect(seqResult.status).toBe('cancelled');
  expect(seqResult.reason).toBe('enrollment_not_active');
});

it('template rendering contract in worker suppresses recipient when required variable is missing', async () => {
  await actor(1);
  // Template with required company variable: {{company}}
  const tpl = await value<{ id: string }>(`select api.create_template($1, 'Required Company Tpl', 'email') v`, [a]);
  const ver = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Subject', 'Hi {{first_name}}, from {{company}}') v`, [a, tpl.id]);

  // Create lead with NO company
  const noCompLead = await value<string>(`select api.create_lead($1, 'No Company Lead', 'nocompany@example.test', null, null) v`, [a]);

  // Sequence step execution
  const seq = await value<{ id: string }>(`select api.create_sequence($1, 'Req Var Seq', 'Desc') v`, [a]);
  await value(`select api.publish_sequence_version($1, $2, $3::jsonb) v`, [
    a, seq.id, JSON.stringify([{ step_number: 1, delay_seconds: 0, channel: 'email', template_version_id: ver.version_id }])
  ]);
  const enroll = await value<{ enrollment_id: string }>(`select api.enroll_lead_sequence($1, $2, $3) v`, [a, seq.id, noCompLead]);
  const execId = await value<string>(`select id v from crm.sequence_step_executions where workspace_id=$1 and enrollment_id=$2 limit 1`, [a, enroll.enrollment_id]);

  await db.exec('reset role');
  const result = await value<{ status: string; reason: string }>(`select private.process_sequence_step_execution($1, $2) v`, [a, execId]);
  expect(result.status).toBe('skipped');
  expect(result.reason).toBe('missing_required_template_variable');

  // Verify no outbound message was queued with a broken blank company
  const msgCount = await value<number>(`select count(*)::int v from crm.messages where workspace_id=$1 and lead_id=$2`, [a, noCompLead]);
  expect(msgCount).toBe(0);
});
