import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it } from 'vitest';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let db: PGlite;
let leadId: string;
let channelAccountId: string;
let messageId: string;
let foreignChannelAccountId: string;

async function actor(n: number) {
  await db.exec(
    `set local role authenticated; select set_config('request.jwt.claims','${JSON.stringify({
      sub: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      aal: 'aal2',
      role: 'authenticated',
    })}',true)`
  );
}

async function value<T>(sql: string, args: unknown[] = []): Promise<T> {
  return (await db.query<{ v: T }>(sql, args)).rows[0].v;
}

async function denied(sql: string, args: unknown[] = [], code = '42501') {
  await db.exec('savepoint denied');
  try {
    await expect(db.query(sql, args)).rejects.toMatchObject({ code });
  } finally {
    await db.exec('rollback to savepoint denied');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile('tests/support/auth-compat.sql', 'utf8'));
  for (const file of (await readdir('supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
  }
  await db.exec(await readFile('supabase/tests/fixtures.sql', 'utf8'));
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec('begin');
  await actor(1); // Workspace A admin

  // Create Channel Account for Workspace A
  channelAccountId = (
    await value<{ id: string }>(
      `select api.upsert_channel_account($1,'email','outbound@example.test','Outbound Sender',true) v`,
      [a]
    )
  ).id;

  // Create Lead for Workspace A
  leadId = await value<string>(
    `select api.create_lead($1,'Test Lead','recipient@example.test',null,'Test Corp') v`,
    [a]
  );

  // Create Conversation and Message (via service role since crm.conversations is mutated via commands)
  await db.exec('reset role');
  const convId = await value<string>(
    `insert into crm.conversations(workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
     values ($1, $2, 'email', $3, 'recipient@example.test') returning id v`,
    [a, leadId, channelAccountId]
  );

  messageId = await value<string>(
    `insert into crm.messages(workspace_id, conversation_id, lead_id, channel, direction, sender_address, recipient_address, text_body, status, dispatch_status)
     values ($1, $2, $3, 'email', 'outbound', 'outbound@example.test', 'recipient@example.test', 'Hello lead', 'queued', 'awaiting_provider')
     returning id v`,
    [a, convId, leadId]
  );

  // Setup foreign workspace B fixtures
  await actor(7); // Workspace B admin
  foreignChannelAccountId = (
    await value<{ id: string }>(
      `select api.upsert_channel_account($1,'email','foreign@example.test','Foreign Sender',true) v`,
      [b]
    )
  ).id;

  await value<string>(
    `select api.create_lead($1,'Foreign Lead','foreign_lead@example.test',null,'Foreign Corp') v`,
    [b]
  );

  await actor(1);
});

afterEach(async () => {
  await db.exec('rollback');
});

// ====================================================================
// 1. PROVIDER CONNECTION MODEL & SECRET ISOLATION
// ====================================================================

it('admin can insert provider connection without secrets in CRM table', async () => {
  await actor(1);
  const connId = await value<string>(
    `insert into crm.provider_connections (workspace_id, provider, external_account_id, connection_state, capabilities)
     values ($1, 'resend', 're_acc_12345', 'configured', '["email"]')
     returning id v`,
    [a]
  );
  expect(connId).toBeDefined();

  // Verify list_provider_connections returns metadata and zero secret fields
  const conns = await value<Array<Record<string, unknown>>>(`select api.list_provider_connections($1) v`, [a]);
  expect(conns).toHaveLength(1);
  expect(conns[0].provider).toBe('resend');
  expect(conns[0].external_account_id).toBe('re_acc_12345');
  expect(conns[0].connection_state).toBe('configured');
  expect(conns[0].api_key).toBeUndefined();
  expect(conns[0].secret).toBeUndefined();
});

it('setter cannot insert or update provider connections directly', async () => {
  await actor(3); // Setter
  await denied(
    `insert into crm.provider_connections (workspace_id, provider, external_account_id)
     values ($1, 'resend', 'setter_acc')`,
    [a]
  );
});

it('secret bindings table is strictly inaccessible to authenticated users', async () => {
  await actor(1); // Admin
  await denied(
    `select * from private.provider_connection_secret_bindings where workspace_id = $1`,
    [a]
  );
});

// ====================================================================
// 2. DURABLE WEBHOOK INBOX, DEDUPLICATION & QUARANTINE
// ====================================================================

it('records webhook event and enqueues durable processing job', async () => {
  await db.exec('reset role');
  const res = (
    await db.query<{ event_id: string; outcome: string; is_quarantined: boolean }>(
      `select * from private.record_webhook_event($1, 'resend', 'evt_email_delivered_1', 'email.delivered', 'hash_aaa_111', '{"type":"email.delivered"}'::jsonb)`,
      [a]
    )
  ).rows[0];

  expect(res.outcome).toBe('received');
  expect(res.is_quarantined).toBe(false);
  expect(res.event_id).toBeDefined();

  // Verify job enqueued in private.jobs
  const job = (
    await db.query<{ type: string; dedup_key: string }>(
      `select type, dedup_key from private.jobs where workspace_id = $1 and type = 'provider_webhook_process'`,
      [a]
    )
  ).rows[0];
  expect(job.dedup_key).toBe('webhook:resend:evt_email_delivered_1');
});

it('safely replays identical webhook duplicate without re-enqueuing or erroring', async () => {
  await db.exec('reset role');
  // First delivery
  const res1 = (
    await db.query<{ event_id: string; outcome: string; is_quarantined: boolean }>(
      `select * from private.record_webhook_event($1, 'resend', 'evt_replay_test', 'email.sent', 'hash_identical', '{"type":"email.sent"}'::jsonb)`,
      [a]
    )
  ).rows[0];

  // Second delivery with identical payload hash
  const res2 = (
    await db.query<{ event_id: string; outcome: string; is_quarantined: boolean }>(
      `select * from private.record_webhook_event($1, 'resend', 'evt_replay_test', 'email.sent', 'hash_identical', '{"type":"email.sent"}'::jsonb)`,
      [a]
    )
  ).rows[0];

  expect(res1.outcome).toBe('received');
  expect(res2.outcome).toBe('replay_safe');
  expect(res2.is_quarantined).toBe(false);
  expect(res2.event_id).toBe(res1.event_id);
});

it('quarantines conflicting duplicate with differing payload hash without overwriting original', async () => {
  await db.exec('reset role');
  // First delivery
  const res1 = (
    await db.query<{ event_id: string; outcome: string; is_quarantined: boolean }>(
      `select * from private.record_webhook_event($1, 'resend', 'evt_conflict_test', 'email.sent', 'original_hash', '{"body":"original"}'::jsonb)`,
      [a]
    )
  ).rows[0];

  // Conflicting delivery: same external_event_id with differing payload hash!
  const res2 = (
    await db.query<{ event_id: string; outcome: string; is_quarantined: boolean }>(
      `select * from private.record_webhook_event($1, 'resend', 'evt_conflict_test', 'email.sent', 'conflicting_hash', '{"body":"tampered"}'::jsonb)`,
      [a]
    )
  ).rows[0];

  expect(res2.outcome).toBe('quarantined_conflict');
  expect(res2.is_quarantined).toBe(true);

  // Original event is preserved
  const original = (
    await db.query<{ payload_hash: string }>(
      `select payload_hash from private.provider_webhook_events where id = $1`,
      [res1.event_id]
    )
  ).rows[0];
  expect(original.payload_hash).toBe('original_hash');

  // Quarantine record exists
  const quarantine = (
    await db.query<{ quarantine_reason: string; payload_hash: string }>(
      `select quarantine_reason, payload_hash from private.provider_webhook_quarantine where workspace_id = $1 and external_event_id = 'evt_conflict_test'`,
      [a]
    )
  ).rows[0];
  expect(quarantine.quarantine_reason).toBe('conflicting_payload');
  expect(quarantine.payload_hash).toBe('conflicting_hash');
});

// ====================================================================
// 3. DISPATCH JOB CLAIMING & CONCURRENCY
// ====================================================================

it('claims dispatch jobs with lease fence and prevents duplicate claims', async () => {
  await db.exec('reset role');
  // Insert a dispatch job
  const jobId = await value<string>(
    `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state)
     values ($1, $2, 'email', $3, 'resend', 'pending') returning id v`,
    [a, messageId, channelAccountId]
  );

  // Worker 1 claims
  const worker1Claims = (
    await db.query<{ job_id: string; fence: string }>(
      `select * from private.claim_dispatch_jobs($1, 'worker_1', 60, 5)`,
      [a]
    )
  ).rows;

  expect(worker1Claims).toHaveLength(1);
  expect(worker1Claims[0].job_id).toBe(jobId);
  expect(Number(worker1Claims[0].fence)).toBe(1);

  // Worker 2 attempts to claim simultaneously — returns empty because job is leased
  const worker2Claims = (
    await db.query<{ job_id: string }>(
      `select * from private.claim_dispatch_jobs($1, 'worker_2', 60, 5)`,
      [a]
    )
  ).rows;
  expect(worker2Claims).toHaveLength(0);

  // Re-verify job state in database
  const jobState = (
    await db.query<{ state: string; lease_owner: string; fence: string }>(
      `select state, lease_owner, fence from private.provider_dispatch_jobs where id = $1`,
      [jobId]
    )
  ).rows[0];
  expect(jobState.state).toBe('claimed');
  expect(jobState.lease_owner).toBe('worker_1');
  expect(Number(jobState.fence)).toBe(1);
});

// ====================================================================
// 4. JIT PRE-SEND POLICY EVALUATION
// ====================================================================

it('pre-send policy approves eligible queued message', async () => {
  await db.exec('reset role');
  const jobId = await value<string>(
    `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state)
     values ($1, $2, 'email', $3, 'resend', 'claimed') returning id v`,
    [a, messageId, channelAccountId]
  );

  const evalResult = (
    await db.query<{ is_eligible: boolean; block_reason: string | null; error_classification: string | null }>(
      `select * from private.evaluate_pre_send_policy($1, $2)`,
      [a, jobId]
    )
  ).rows[0];

  expect(evalResult.is_eligible).toBe(true);
  expect(evalResult.block_reason).toBeNull();
});

it('pre-send policy blocks dispatch when recipient destination is suppressed (DNC)', async () => {
  await db.exec('reset role');
  // Add suppression for the recipient address
  await db.query(
    `insert into crm.suppressions (workspace_id, channel, destination_normalized, reason, source, scope, status)
     values ($1, 'email', 'recipient@example.test', 'manual_dnc', 'api', 'destination_block', 'active')`,
    [a]
  );

  const jobId = await value<string>(
    `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state)
     values ($1, $2, 'email', $3, 'resend', 'claimed') returning id v`,
    [a, messageId, channelAccountId]
  );

  const evalResult = (
    await db.query<{ is_eligible: boolean; block_reason: string; error_classification: string }>(
      `select * from private.evaluate_pre_send_policy($1, $2)`,
      [a, jobId]
    )
  ).rows[0];

  expect(evalResult.is_eligible).toBe(false);
  expect(evalResult.block_reason).toBe('recipient_suppressed_dnc');
  expect(evalResult.error_classification).toBe('suppressed');
});

it('pre-send policy blocks dispatch if parent campaign is cancelled', async () => {
  await actor(1);
  const tpl = await value<{ id: string }>(`select api.create_template($1, 'Camp Tpl', 'email') v`, [a]);
  const ver = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Subject', 'Body') v`, [a, tpl.id]);
  const camp = await value<{ id: string }>(`select api.create_campaign($1, 'Cancelled Campaign', 'email', $2) v`, [a, ver.version_id]);
  await value(`select api.launch_campaign($1, $2) v`, [a, camp.id]);
  await value(`select api.cancel_campaign($1, $2) v`, [a, camp.id]);

  await db.exec('reset role');
  // Tag message with cancelled campaign
  await db.query(`update crm.messages set campaign_id = $1 where id = $2`, [camp.id, messageId]);

  const jobId = await value<string>(
    `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state)
     values ($1, $2, 'email', $3, 'resend', 'claimed') returning id v`,
    [a, messageId, channelAccountId]
  );

  const evalResult = (
    await db.query<{ is_eligible: boolean; block_reason: string }>(
      `select * from private.evaluate_pre_send_policy($1, $2)`,
      [a, jobId]
    )
  ).rows[0];

  expect(evalResult.is_eligible).toBe(false);
  expect(evalResult.block_reason).toBe('campaign_not_active');
});

it('pre-send policy blocks dispatch if sequence enrollment has exited', async () => {
  await actor(1);
  const tpl = await value<{ id: string }>(`select api.create_template($1, 'Seq Tpl', 'email') v`, [a]);
  const ver = await value<{ version_id: string }>(`select api.publish_template_version($1, $2, 'Subject', 'Body') v`, [a, tpl.id]);
  const seq = await value<{ id: string }>(`select api.create_sequence($1, 'Test Sequence', 'Desc') v`, [a]);
  await value(`select api.publish_sequence_version($1, $2, $3::jsonb) v`, [
    a, seq.id, JSON.stringify([{ step_number: 1, delay_seconds: 0, channel: 'email', template_version_id: ver.version_id }])
  ]);
  const enroll = await value<{ enrollment_id: string }>(`select api.enroll_lead_sequence($1, $2, $3) v`, [a, seq.id, leadId]);

  await db.exec('reset role');
  await db.query(`update crm.sequence_enrollments set status = 'exited', exit_reason = 'manual' where id = $1`, [enroll.enrollment_id]);
  await db.query(`update crm.messages set sequence_enrollment_id = $1 where id = $2`, [enroll.enrollment_id, messageId]);

  const jobId = await value<string>(
    `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state)
     values ($1, $2, 'email', $3, 'resend', 'claimed') returning id v`,
    [a, messageId, channelAccountId]
  );

  const evalResult = (
    await db.query<{ is_eligible: boolean; block_reason: string }>(
      `select * from private.evaluate_pre_send_policy($1, $2)`,
      [a, jobId]
    )
  ).rows[0];

  expect(evalResult.is_eligible).toBe(false);
  expect(evalResult.block_reason).toBe('sequence_enrollment_not_active');
});

// ====================================================================
// 5. MONOTONIC MESSAGE STATUS RECONCILIATION
// ====================================================================

it('monotonically progresses message status and prevents status regression', async () => {
  await db.exec('reset role');

  // Step 1: Progress queued -> accepted (maps to message status 'sending', event 'provider_accepted')
  let status = await value<string>(
    `select private.apply_message_status_event($1, $2, 'resend', 'accepted', 'evt_acc') v`,
    [a, messageId]
  );
  expect(status).toBe('sending');

  // Step 2: Progress sending -> delivered
  status = await value<string>(
    `select private.apply_message_status_event($1, $2, 'resend', 'delivered', 'evt_del') v`,
    [a, messageId]
  );
  expect(status).toBe('delivered');

  // Step 3: Late out-of-order 'sent' event arriving after 'delivered' MUST NOT regress status!
  status = await value<string>(
    `select private.apply_message_status_event($1, $2, 'resend', 'sent', 'evt_late_sent') v`,
    [a, messageId]
  );
  expect(status).toBe('delivered'); // Preserved monotonically!

  // Re-verify crm.messages table status
  const currentStatus = await value<string>(`select status v from crm.messages where id = $1`, [messageId]);
  expect(currentStatus).toBe('delivered');

  // But the late event was still recorded in crm.message_events for audit!
  const events = (
    await db.query<{ event_type: string }>(
      `select event_type from crm.message_events where message_id = $1 order by occurred_at asc`,
      [messageId]
    )
  ).rows;
  expect(events.map((e) => e.event_type)).toEqual(['provider_accepted', 'delivered', 'sent']);
});

// ====================================================================
// 6. OPERATIONAL RETRY RPC & RBAC
// ====================================================================

it('manager can retry eligible failed dispatch job', async () => {
  await db.exec('reset role');
  // Mark job as failed
  const jobId = await value<string>(
    `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state, last_error_code)
     values ($1, $2, 'email', $3, 'resend', 'failed', 'transient_timeout') returning id v`,
    [a, messageId, channelAccountId]
  );
  await db.query(`update crm.messages set status = 'failed' where id = $1`, [messageId]);

  // Manager triggers retry
  await actor(2); // Workspace A Manager
  const retriedId = await value<string>(`select api.retry_dispatch_job($1, $2) v`, [a, jobId]);
  expect(retriedId).toBe(jobId);

  // Job is reset to pending
  await db.exec('reset role');
  const job = (
    await db.query<{ state: string; attempt_count: number; fence: string }>(
      `select state, attempt_count, fence from private.provider_dispatch_jobs where id = $1`,
      [jobId]
    )
  ).rows[0];
  expect(job.state).toBe('pending');
  expect(job.attempt_count).toBe(0);
  expect(Number(job.fence)).toBe(1);

  // Message is reset to queued
  const msgStatus = await value<string>(`select status v from crm.messages where id = $1`, [messageId]);
  expect(msgStatus).toBe('queued');
});

it('retry fails if recipient has since been added to DNC / suppression list', async () => {
  await db.exec('reset role');
  const jobId = await value<string>(
    `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state)
     values ($1, $2, 'email', $3, 'resend', 'failed') returning id v`,
    [a, messageId, channelAccountId]
  );

  // Suppress recipient
  await db.query(
    `insert into crm.suppressions (workspace_id, channel, destination_normalized, reason, source, scope, status)
     values ($1, 'email', 'recipient@example.test', 'manual_dnc', 'api', 'destination_block', 'active')`,
    [a]
  );

  // Manager attempts retry -> rejected!
  await actor(2);
  await expect(
    db.query(`select api.retry_dispatch_job($1, $2)`, [a, jobId])
  ).rejects.toThrow('cannot_retry_suppressed_recipient');
});

it('setter cannot invoke retry_dispatch_job', async () => {
  await db.exec('reset role');
  const jobId = await value<string>(
    `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state)
     values ($1, $2, 'email', $3, 'resend', 'failed') returning id v`,
    [a, messageId, channelAccountId]
  );

  await actor(3); // Setter
  await expect(
    db.query(`select api.retry_dispatch_job($1, $2)`, [a, jobId])
  ).rejects.toThrow('forbidden_manager_required');
});

// ====================================================================
// 7. CROSS-WORKSPACE ISOLATION
// ====================================================================

it('cross-workspace dispatch job referencing foreign message is rejected by composite foreign key', async () => {
  await db.exec('reset role');
  // Attempt to create dispatch job in Workspace A referencing message in Workspace B
  await expect(
    db.query(
      `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state)
       values ($1, $2, 'email', $3, 'resend', 'pending')`,
      [b, messageId, foreignChannelAccountId] // messageId belongs to workspace A!
    )
  ).rejects.toMatchObject({ code: '23503' });
});

it('cross-workspace retry is rejected', async () => {
  await db.exec('reset role');
  const jobId = await value<string>(
    `insert into private.provider_dispatch_jobs(workspace_id, message_id, channel, channel_account_id, provider, state)
     values ($1, $2, 'email', $3, 'resend', 'failed') returning id v`,
    [a, messageId, channelAccountId]
  );

  // Workspace B manager attempts to retry Workspace A's job
  await actor(7); // Workspace B Admin
  await expect(
    db.query(`select api.retry_dispatch_job($1, $2)`, [a, jobId])
  ).rejects.toThrow('unauthorized');
});
