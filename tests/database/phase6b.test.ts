import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { beforeAll, afterAll, beforeEach, afterEach, expect, it, describe } from 'vitest';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

let db: PGlite;
let leadAId: string;
let channelAccountAId: string;
let channelAccountBId: string;
let connectionAId: string;
let connectionBId: string;

async function actor(n: number) {
  await db.exec(
    `set local role authenticated; select set_config('request.jwt.claims','${JSON.stringify({
      sub: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      aal: 'aal2',
      role: 'authenticated',
    })}',true)`
  );
}

async function anon() {
  await db.exec(`set local role anon; select set_config('request.jwt.claims','{}',true)`);
}

async function system() {
  await db.exec('reset role');
}

async function value<T>(sql: string, args: unknown[] = []): Promise<T> {
  return (await db.query<{ v: T }>(sql, args)).rows[0].v;
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
  await actor(1); // Workspace A Admin

  // 1. Setup Provider Connection for Workspace A
  connectionAId = await value<string>(
    `insert into crm.provider_connections (
      workspace_id, provider, external_account_id, connection_state, capabilities, health_status
    ) values ($1, 'resend', 'resend_acct_a', 'active', '["email"]'::jsonb, 'active')
    returning id as v`,
    [a]
  );

  // 2. Setup Channel Account for Workspace A
  channelAccountAId = (
    await value<{ id: string }>(
      `select api.upsert_channel_account($1, 'email', 'inbox@workspace-a.com', 'Workspace A Email', true) v`,
      [a]
    )
  ).id;

  // Link provider connection in superuser mode
  await system();
  await db.exec(
    `update crm.channel_accounts set provider_connection_id = '${connectionAId}', provider = 'resend' where id = '${channelAccountAId}'`
  );

  // 3. Setup Lead for Workspace A with email identity
  await actor(1);
  leadAId = await value<string>(
    `select api.create_lead($1, 'Alice Test', 'alice@example.com', null, 'Acme Corp') v`,
    [a]
  );

  // Setup Workspace B (Tenant isolation checks)
  await actor(7); // Workspace B Admin
  connectionBId = await value<string>(
    `insert into crm.provider_connections (
      workspace_id, provider, external_account_id, connection_state, capabilities, health_status
    ) values ($1, 'resend', 'resend_acct_b', 'active', '["email"]'::jsonb, 'active')
    returning id as v`,
    [b]
  );

  channelAccountBId = (
    await value<{ id: string }>(
      `select api.upsert_channel_account($1, 'email', 'inbox@workspace-b.com', 'Workspace B Email', true) v`,
      [b]
    )
  ).id;

  await system();
  await db.exec(
    `update crm.channel_accounts set provider_connection_id = '${connectionBId}', provider = 'resend' where id = '${channelAccountBId}'`
  );

  await actor(7);
  await value<string>(
    `select api.create_lead($1, 'Bob Foreign', 'bob@example.com', null, 'Foreign Corp') v`,
    [b]
  );

  await actor(1); // Reset to Workspace A
});

afterEach(async () => {
  await db.exec('rollback');
});

describe('Phase 6B Database: Outbound Dispatch Queue & JIT Policies', () => {
  it('creates dispatch job and executes JIT pre-send checks successfully', async () => {
    // 1. Create outbound queued message
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_1', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;

    // 2. Insert provider dispatch job via system role
    await system();
    const jobId = await value<string>(
      `insert into private.provider_dispatch_jobs (
        workspace_id, message_id, channel, channel_account_id, provider, provider_connection_id, state
      ) values ($1, $2, 'email', $3, 'resend', $4, 'pending')
      returning id as v`,
      [a, messageId, channelAccountAId, connectionAId]
    );

    // 3. Claim dispatch job
    const claimed = await db.query<{ job_id: string; fence: number }>(
      `select job_id, fence from private.claim_dispatch_jobs($1, 'worker_1', 60, 5)`,
      [a]
    );
    expect(claimed.rows.length).toBe(1);
    expect(claimed.rows[0].job_id).toBe(jobId);
    expect(claimed.rows[0].fence).toBe(1);

    // 4. Evaluate JIT Pre-send policy
    const evalResult = await db.query<{ is_eligible: boolean; block_reason: string | null }>(
      `select is_eligible, block_reason from private.evaluate_pre_send_policy($1, $2)`,
      [a, jobId]
    );
    expect(evalResult.rows[0].is_eligible).toBe(true);
    expect(evalResult.rows[0].block_reason).toBeNull();
  });

  it('blocks dispatch when recipient has been suppressed after queuing (JIT DNC check)', async () => {
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_2', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;

    await system();
    const jobId = await value<string>(
      `insert into private.provider_dispatch_jobs (
        workspace_id, message_id, channel, channel_account_id, provider, provider_connection_id, state
      ) values ($1, $2, 'email', $3, 'resend', $4, 'pending')
      returning id as v`,
      [a, messageId, channelAccountAId, connectionAId]
    );

    // Add suppression for Alice's destination
    await actor(1);
    await value<string>(
      `select api.add_suppression($1, 'destination_block', 'manual_dnc', 'alice@example.com', $2, 'email', null) v`,
      [a, leadAId]
    );

    // JIT evaluation immediately blocks dispatch
    await system();
    const evalResult = await db.query<{ is_eligible: boolean; block_reason: string; error_classification: string }>(
      `select is_eligible, block_reason, error_classification from private.evaluate_pre_send_policy($1, $2)`,
      [a, jobId]
    );
    expect(evalResult.rows[0].is_eligible).toBe(false);
    expect(evalResult.rows[0].block_reason).toBe('recipient_suppressed_dnc');
    expect(evalResult.rows[0].error_classification).toBe('suppressed');
  });

  it('blocks dispatch when provider connection is disabled', async () => {
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_3', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;

    await system();
    const jobId = await value<string>(
      `insert into private.provider_dispatch_jobs (
        workspace_id, message_id, channel, channel_account_id, provider, provider_connection_id, state
      ) values ($1, $2, 'email', $3, 'resend', $4, 'pending')
      returning id as v`,
      [a, messageId, channelAccountAId, connectionAId]
    );

    // Disable provider connection
    await db.exec(`update crm.provider_connections set connection_state = 'disabled' where id = '${connectionAId}'`);

    const evalResult = await db.query<{ is_eligible: boolean; block_reason: string }>(
      `select is_eligible, block_reason from private.evaluate_pre_send_policy($1, $2)`,
      [a, jobId]
    );
    expect(evalResult.rows[0].is_eligible).toBe(false);
    expect(evalResult.rows[0].block_reason).toBe('provider_connection_disabled');
  });
});

describe('Phase 6B Database: Webhook Workspace Resolution & Ingestion', () => {
  it('resolves outbound webhook workspace from message provider_message_id', async () => {
    // 1. Create message with provider_message_id
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_res_1', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;
    const providerEmailId = 'resend_email_test_1001';

    await system();
    await db.exec(
      `update crm.messages set provider_message_id = '${providerEmailId}', status = 'sending' where id = '${messageId}'`
    );

    // 2. Query workspace resolution
    const resolved = await db.query<{ workspace_id: string; message_id: string; resolution_state: string }>(
      `select workspace_id, message_id, resolution_state 
       from private.resolve_resend_webhook_workspace('email.sent', $1, null)`,
      [providerEmailId]
    );

    expect(resolved.rows.length).toBe(1);
    expect(resolved.rows[0].resolution_state).toBe('resolved');
    expect(resolved.rows[0].workspace_id).toBe(a);
    expect(resolved.rows[0].message_id).toBe(messageId);
  });

  it('resolves inbound webhook workspace from active channel account', async () => {
    await system();
    const resolved = await db.query<{ workspace_id: string; channel_account_id: string; resolution_state: string }>(
      `select workspace_id, channel_account_id, resolution_state 
       from private.resolve_resend_webhook_workspace('email.received', 'dummy_inbound_id', 'inbox@workspace-a.com')`
    );

    expect(resolved.rows.length).toBe(1);
    expect(resolved.rows[0].resolution_state).toBe('resolved');
    expect(resolved.rows[0].workspace_id).toBe(a);
    expect(resolved.rows[0].channel_account_id).toBe(channelAccountAId);
  });

  it('quarantines unresolved inbound destination with unresolved_account', async () => {
    await anon();
    const result = await value<{ outcome: string; error: string }>(
      `select api.ingest_resend_webhook(
        'evt_unresolved_1',
        'email.received',
        'hash123',
        '{"type":"email.received","data":{"to":["unknown@nowhere.com"]}}'::jsonb,
        null,
        'unknown@nowhere.com',
        now()
      ) v`
    );

    expect(result.outcome).toBe('unresolved_account');

    // Verify quarantine table has record
    await system();
    const quarantined = await value<number>(
      `select count(*)::int as v from private.provider_webhook_quarantine 
       where external_event_id = 'evt_unresolved_1' and quarantine_reason = 'unresolved_account'`
    );
    expect(quarantined).toBeGreaterThanOrEqual(1);
  });

  it('deduplicates identical webhook replay safely without duplicating events', async () => {
    // 1. Create message for correlation
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_dedup_1', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;
    const providerEmailId = 'resend_email_dedup_101';

    await system();
    await db.exec(
      `update crm.messages set provider_message_id = '${providerEmailId}', status = 'sending' where id = '${messageId}'`
    );

    await anon();
    const payload = {
      type: 'email.sent',
      data: { email_id: providerEmailId },
    };

    // First ingestion -> received
    const res1 = await value<{ outcome: string; event_id: string }>(
      `select api.ingest_resend_webhook(
        'evt_dedup_1',
        'email.sent',
        'payload_hash_1',
        $1::jsonb,
        $2,
        null,
        now()
      ) v`,
      [JSON.stringify(payload), providerEmailId]
    );
    expect(res1.outcome).toBe('received');

    // Second ingestion (exact same payload and event ID) -> replay_safe
    const res2 = await value<{ outcome: string; event_id: string }>(
      `select api.ingest_resend_webhook(
        'evt_dedup_1',
        'email.sent',
        'payload_hash_1',
        $1::jsonb,
        $2,
        null,
        now()
      ) v`,
      [JSON.stringify(payload), providerEmailId]
    );
    expect(res2.outcome).toBe('replay_safe');
    expect(res2.event_id).toBe(res1.event_id);
  });

  it('quarantines conflicting duplicate webhook payload', async () => {
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_conf_1', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;
    const providerEmailId = 'resend_email_conf_102';

    await system();
    await db.exec(
      `update crm.messages set provider_message_id = '${providerEmailId}', status = 'sending' where id = '${messageId}'`
    );

    await anon();
    const payloadA = { type: 'email.sent', data: { email_id: providerEmailId } };
    const payloadB = { type: 'email.sent', data: { email_id: providerEmailId, altered: true } };

    // Ingest initial event
    await value<{ outcome: string }>(
      `select api.ingest_resend_webhook(
        'evt_conflict_1',
        'email.sent',
        'hash_original',
        $1::jsonb,
        $2,
        null,
        now()
      ) v`,
      [JSON.stringify(payloadA), providerEmailId]
    );

    // Ingest same event ID with differing hash -> quarantined_conflict
    const conflictRes = await value<{ outcome: string }>(
      `select api.ingest_resend_webhook(
        'evt_conflict_1',
        'email.sent',
        'hash_tampered',
        $1::jsonb,
        $2,
        null,
        now()
      ) v`,
      [JSON.stringify(payloadB), providerEmailId]
    );
    expect(conflictRes.outcome).toBe('quarantined_conflict');

    await system();
    const quarantined = await value<number>(
      `select count(*)::int as v from private.provider_webhook_quarantine 
       where external_event_id = 'evt_conflict_1' and quarantine_reason = 'conflicting_payload'`
    );
    expect(quarantined).toBe(1);
  });
});

describe('Phase 6B Database: Monotonic Status Reconciliation & Suppressions', () => {
  it('reconciles delivery monotonically: late sent event does NOT regress delivered', async () => {
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_mono_1', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;
    const providerEmailId = 'resend_email_mono_103';

    await system();
    await db.exec(
      `update crm.messages set provider_message_id = '${providerEmailId}', status = 'sending' where id = '${messageId}'`
    );

    await anon();
    // 1. Delivered event arrives first
    await value<{ outcome: string }>(
      `select api.ingest_resend_webhook(
        'evt_del_1',
        'email.delivered',
        'hash_del',
        $1::jsonb,
        $2,
        null,
        now()
      ) v`,
      [JSON.stringify({ type: 'email.delivered', data: { email_id: providerEmailId } }), providerEmailId]
    );

    await actor(1);
    expect(await value<string>(`select status as v from crm.messages where id = $1`, [messageId])).toBe('delivered');

    // 2. Late sent event arrives afterwards
    await anon();
    await value<{ outcome: string }>(
      `select api.ingest_resend_webhook(
        'evt_late_sent',
        'email.sent',
        'hash_sent',
        $1::jsonb,
        $2,
        null,
        now()
      ) v`,
      [JSON.stringify({ type: 'email.sent', data: { email_id: providerEmailId } }), providerEmailId]
    );

    await actor(1);
    // Monotonic invariant: status remains delivered (NO regression)
    expect(await value<string>(`select status as v from crm.messages where id = $1`, [messageId])).toBe('delivered');

    // Both events are preserved in message_events
    const eventCount = await value<number>(
      `select count(*)::int as v from crm.message_events where message_id = $1`,
      [messageId]
    );
    expect(eventCount).toBeGreaterThanOrEqual(2);
  });

  it('records delivery_delayed as observational audit without mutating status or suppressing', async () => {
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_delay_1', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;
    const providerEmailId = 'resend_email_delay_104';

    await system();
    await db.exec(
      `update crm.messages set provider_message_id = '${providerEmailId}', status = 'sending' where id = '${messageId}'`
    );

    await anon();
    await value<{ outcome: string }>(
      `select api.ingest_resend_webhook(
        'evt_delay_1',
        'email.delivery_delayed',
        'hash_delay',
        $1::jsonb,
        $2,
        null,
        now()
      ) v`,
      [
        JSON.stringify({
          type: 'email.delivery_delayed',
          data: { email_id: providerEmailId, delivery: { message: 'Mail server busy' } },
        }),
        providerEmailId,
      ]
    );

    await actor(1);
    // Status not mutated to failed or bounced
    expect(await value<string>(`select status as v from crm.messages where id = $1`, [messageId])).toBe('sending');

    // Event recorded in message_events
    const delayedCount = await value<number>(
      `select count(*)::int as v from crm.message_events where message_id = $1 and event_type = 'delivery_delayed'`,
      [messageId]
    );
    expect(delayedCount).toBe(1);

    // NO suppression created
    const suppressionCount = await value<number>(
      `select count(*)::int as v from crm.suppressions where workspace_id = $1 and destination_normalized = 'alice@example.com'`,
      [a]
    );
    expect(suppressionCount).toBe(0);
  });

  it('handles permanent bounce: marks message bounced and creates destination suppression', async () => {
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_bounce_1', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;
    const providerEmailId = 'resend_email_bounce_105';

    await system();
    await db.exec(
      `update crm.messages set provider_message_id = '${providerEmailId}', status = 'sending' where id = '${messageId}'`
    );

    await anon();
    await value<{ outcome: string }>(
      `select api.ingest_resend_webhook(
        'evt_bounce_perm',
        'email.bounced',
        'hash_bounce',
        $1::jsonb,
        $2,
        null,
        now()
      ) v`,
      [
        JSON.stringify({
          type: 'email.bounced',
          data: {
            email_id: providerEmailId,
            bounce: { type: 'Permanent', subType: 'General', message: 'Mailbox not found' },
          },
        }),
        providerEmailId,
      ]
    );

    await actor(1);
    expect(await value<string>(`select status as v from crm.messages where id = $1`, [messageId])).toBe('bounced');

    // Canonical suppression created with hard_bounce reason
    const suppression = await db.query<{ reason: string; scope: string; source: string }>(
      `select reason, scope, source from crm.suppressions 
       where workspace_id = $1 and destination_normalized = 'alice@example.com' and status = 'active'`,
      [a]
    );
    expect(suppression.rows.length).toBe(1);
    expect(suppression.rows[0].reason).toBe('hard_bounce');
    expect(suppression.rows[0].scope).toBe('destination_block');
    expect(suppression.rows[0].source).toBe('provider_webhook');
  });

  it('handles spam complaint: records event and suppresses destination without mutating delivery status', async () => {
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_complaint_1', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;
    const providerEmailId = 'resend_email_complaint_106';

    await system();
    await db.exec(
      `update crm.messages set provider_message_id = '${providerEmailId}', status = 'delivered' where id = '${messageId}'`
    );

    await anon();
    await value<{ outcome: string }>(
      `select api.ingest_resend_webhook(
        'evt_complaint_1',
        'email.complained',
        'hash_complaint',
        $1::jsonb,
        $2,
        null,
        now()
      ) v`,
      [
        JSON.stringify({
          type: 'email.complained',
          data: {
            email_id: providerEmailId,
            complaint: { feedback_type: 'abuse' },
          },
        }),
        providerEmailId,
      ]
    );

    await actor(1);
    // Correction 2: Status remains delivered (not complained)
    expect(await value<string>(`select status as v from crm.messages where id = $1`, [messageId])).toBe('delivered');

    // Event recorded in message_events as complained
    const complaintEvent = await value<number>(
      `select count(*)::int as v from crm.message_events where message_id = $1 and event_type = 'complained'`,
      [messageId]
    );
    expect(complaintEvent).toBe(1);

    // Canonical suppression created with spam_complaint reason
    const suppression = await db.query<{ reason: string; scope: string }>(
      `select reason, scope from crm.suppressions 
       where workspace_id = $1 and destination_normalized = 'alice@example.com' and status = 'active'`,
      [a]
    );
    expect(suppression.rows.length).toBe(1);
    expect(suppression.rows[0].reason).toBe('spam_complaint');
    expect(suppression.rows[0].scope).toBe('destination_block');
  });
});

describe('Phase 6B Database: Inbound Email Ingestion & Identity Matching', () => {
  it('attaches inbound email to canonical conversation when exactly 1 lead identity matches', async () => {
    await anon();
    const inboundPayload = {
      type: 'email.received',
      data: {
        id: 'em_inbound_101',
        from: 'alice@example.com',
        to: ['inbox@workspace-a.com'],
        subject: 'Re: Welcome to 80/20',
        text: 'Thanks for having me!',
        attachments: [],
      },
    };

    const res = await value<{ outcome: string; processing: { message_id: string } }>(
      `select api.ingest_resend_webhook(
        'evt_inbound_match',
        'email.received',
        'hash_inbound_1',
        $1::jsonb,
        'em_inbound_101',
        'inbox@workspace-a.com',
        now()
      ) v`,
      [JSON.stringify(inboundPayload)]
    );

    expect(res.outcome).toBe('received');
    expect(res.processing.message_id).toBeDefined();

    await actor(1);
    const msg = await db.query<{ direction: string; status: string; lead_id: string }>(
      `select direction, status, lead_id from crm.messages where id = $1`,
      [res.processing.message_id]
    );
    expect(msg.rows[0].direction).toBe('inbound');
    expect(msg.rows[0].status).toBe('received');
    expect(msg.rows[0].lead_id).toBe(leadAId);
  });

  it('routes to inbound_message_reviews with unmatched_sender and DOES NOT create lead when sender has zero matches', async () => {
    await anon();
    const inboundPayload = {
      type: 'email.received',
      data: {
        id: 'em_inbound_102',
        from: 'stranger@unknown-domain.com',
        to: ['inbox@workspace-a.com'],
        subject: 'Inquiry',
        text: 'Interested in your services.',
      },
    };

    const res = await value<{ outcome: string; processing: { review_id: string } }>(
      `select api.ingest_resend_webhook(
        'evt_inbound_unknown',
        'email.received',
        'hash_inbound_2',
        $1::jsonb,
        'em_inbound_102',
        'inbox@workspace-a.com',
        now()
      ) v`,
      [JSON.stringify(inboundPayload)]
    );

    expect(res.outcome).toBe('received');
    expect(res.processing.review_id).toBeDefined();

    await actor(1);
    const review = await db.query<{ resolution_reason: string; resolution_state: string; sender_address_normalized: string }>(
      `select resolution_reason, resolution_state, sender_address_normalized from crm.inbound_message_reviews where id = $1`,
      [res.processing.review_id]
    );
    expect(review.rows[0].resolution_state).toBe('pending');
    expect(review.rows[0].resolution_reason).toBe('unmatched_sender');
    expect(review.rows[0].sender_address_normalized).toBe('stranger@unknown-domain.com');

    // Canonical Policy: DOES NOT automatically create a CRM lead or identity
    const identityCount = await value<number>(
      `select count(*)::int as v from crm.identities where workspace_id = $1 and kind = 'email' and normalized_value = 'stranger@unknown-domain.com'`,
      [a]
    );
    expect(identityCount).toBe(0);

    // Canonical Policy: DOES NOT create a message in crm.messages
    const msgCount = await value<number>(
      `select count(*)::int as v from crm.messages where workspace_id = $1 and provider_message_id = 'em_inbound_102'`,
      [a]
    );
    expect(msgCount).toBe(0);
  });

  it('routes to inbound_message_reviews with ambiguous_identity_conflict and DOES NOT auto-attach when multiple leads match', async () => {
    // 1. Create a second lead in Workspace A and claim the same normalized email
    await actor(1);
    const leadA2Id = await value<string>(
      `select api.create_lead($1, 'Alice Alias', 'alice2@example.com', null, 'Alias Corp') v`,
      [a]
    );

    await system();
    const identRes = await db.query<{ id: string }>(
      `select id from crm.identities where workspace_id = $1 and kind = 'email' and normalized_value = 'shared@example.com'`,
      [a]
    );

    const newIdentId =
      identRes.rows.length > 0
        ? identRes.rows[0].id
        : (
            await db.query<{ id: string }>(
              `insert into crm.identities (workspace_id, kind, normalized_value)
               values ($1, 'email', 'shared@example.com')
               returning id`,
              [a]
            )
          ).rows[0].id;

    await db.exec(
      `insert into crm.identity_claims (workspace_id, identity_id, lead_id, active)
       values ('${a}', '${newIdentId}', '${leadAId}', true),
              ('${a}', '${newIdentId}', '${leadA2Id}', true)`
    );

    // 2. Ingest inbound email from the shared address
    await anon();
    const inboundPayload = {
      type: 'email.received',
      data: {
        id: 'em_inbound_ambig_1',
        from: 'shared@example.com',
        to: ['inbox@workspace-a.com'],
        subject: 'Ambiguous inquiry',
        text: 'Which lead am I?',
      },
    };

    const res = await value<{ outcome: string; processing: { review_id: string } }>(
      `select api.ingest_resend_webhook(
        'evt_inbound_ambig',
        'email.received',
        'hash_inbound_ambig',
        $1::jsonb,
        'em_inbound_ambig_1',
        'inbox@workspace-a.com',
        now()
      ) v`,
      [JSON.stringify(inboundPayload)]
    );

    expect(res.outcome).toBe('received');
    expect(res.processing.review_id).toBeDefined();

    await actor(1);
    const review = await db.query<{ resolution_reason: string; resolution_state: string; candidate_lead_ids: string[] }>(
      `select resolution_reason, resolution_state, candidate_lead_ids from crm.inbound_message_reviews where id = $1`,
      [res.processing.review_id]
    );
    expect(review.rows[0].resolution_state).toBe('pending');
    expect(review.rows[0].resolution_reason).toBe('ambiguous_identity_conflict');
    expect(review.rows[0].candidate_lead_ids).toContain(leadAId);
    expect(review.rows[0].candidate_lead_ids).toContain(leadA2Id);

    // Canonical Policy: DOES NOT automatically attach to any conversation or create a message
    const msgCount = await value<number>(
      `select count(*)::int as v from crm.messages where workspace_id = $1 and provider_message_id = 'em_inbound_ambig_1'`,
      [a]
    );
    expect(msgCount).toBe(0);
  });

  it('ensures duplicate webhook does not create duplicate inbound review', async () => {
    await anon();
    const inboundPayload = {
      type: 'email.received',
      data: {
        id: 'em_inbound_dup_test',
        from: 'stranger-dup@domain.com',
        to: ['inbox@workspace-a.com'],
        subject: 'First attempt',
        text: 'Original message text',
      },
    };

    // First arrival
    const res1 = await value<{ outcome: string; processing: { review_id: string } }>(
      `select api.ingest_resend_webhook(
        'evt_dup_rev_1',
        'email.received',
        'hash_dup_1',
        $1::jsonb,
        'em_inbound_dup_test',
        'inbox@workspace-a.com',
        now()
      ) v`,
      [JSON.stringify(inboundPayload)]
    );
    expect(res1.outcome).toBe('received');

    // Duplicate webhook delivery with different external event ID but same provider email
    await value<{ outcome: string }>(
      `select api.ingest_resend_webhook(
        'evt_dup_rev_2',
        'email.received',
        'hash_dup_1',
        $1::jsonb,
        'em_inbound_dup_test',
        'inbox@workspace-a.com',
        now()
      ) v`,
      [JSON.stringify(inboundPayload)]
    );

    // Exactly one review exists in the durable store
    await actor(1);
    const reviewCount = await value<number>(
      `select count(*)::int as v from crm.inbound_message_reviews 
       where workspace_id = $1 and provider_message_id = 'em_inbound_dup_test'`,
      [a]
    );
    expect(reviewCount).toBe(1);
  });

  it('ensures cross-workspace identity cannot be selected for inbound message attachment', async () => {
    // Lead exists in Workspace B with bob@example.com (from beforeEach)
    // Inbound email arrives at Workspace A targeting Workspace A channel account
    await anon();
    const inboundPayload = {
      type: 'email.received',
      data: {
        id: 'em_inbound_cross_1',
        from: 'bob@example.com',
        to: ['inbox@workspace-a.com'],
        subject: 'Hello from Bob',
        text: 'Sending to Workspace A',
      },
    };

    const res = await value<{ outcome: string; processing: { review_id: string } }>(
      `select api.ingest_resend_webhook(
        'evt_inbound_cross',
        'email.received',
        'hash_inbound_cross',
        $1::jsonb,
        'em_inbound_cross_1',
        'inbox@workspace-a.com',
        now()
      ) v`,
      [JSON.stringify(inboundPayload)]
    );

    expect(res.outcome).toBe('received');
    expect(res.processing.review_id).toBeDefined();

    // In Workspace A, this must be an unmatched_sender review (Workspace B's lead is not accessible)
    await actor(1);
    const review = await db.query<{ resolution_reason: string; candidate_lead_ids: string[] }>(
      `select resolution_reason, candidate_lead_ids from crm.inbound_message_reviews where id = $1`,
      [res.processing.review_id]
    );
    expect(review.rows[0].resolution_reason).toBe('unmatched_sender');
    expect(review.rows[0].candidate_lead_ids.length).toBe(0);

    // Workspace B actor checks: Workspace B's conversations/messages were NOT touched
    await actor(7);
    const wsBMsgs = await value<number>(
      `select count(*)::int as v from crm.messages where workspace_id = $1 and provider_message_id = 'em_inbound_cross_1'`,
      [b]
    );
    expect(wsBMsgs).toBe(0);
  });

  it('enforces strict workspace isolation: Workspace B cannot match or access Workspace A messages', async () => {
    // 1. Create message in Workspace A
    const msgRes = await value<{ message_id: string }>(
      `select api.create_outbound_message(
        $1, $2, 'email', 'alice@example.com', 'Hello Alice', 'Subject', null, null, 'cmd_k_iso_1', $3, null
      ) v`,
      [a, leadAId, channelAccountAId]
    );
    const messageId = msgRes.message_id;
    const providerEmailId = 'resend_email_iso_107';

    await system();
    await db.exec(
      `update crm.messages set provider_message_id = '${providerEmailId}', status = 'sending' where id = '${messageId}'`
    );

    // 2. Query as Workspace B actor
    await actor(7);
    const countB = await value<number>(
      `select count(*)::int as v from crm.messages where workspace_id = $1 and provider_message_id = $2`,
      [b, providerEmailId]
    );
    expect(countB).toBe(0);

    // Cross-workspace direct query returns 0 rows due to RLS
    const countCross = await value<number>(
      `select count(*)::int as v from crm.messages where id = $1`,
      [messageId]
    );
    expect(countCross).toBe(0);
  });
});
