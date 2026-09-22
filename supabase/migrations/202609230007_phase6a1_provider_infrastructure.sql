-- ====================================================================
-- 80/20 CRM — PHASE 6A.1 MIGRATION: PROVIDER INFRASTRUCTURE FOUNDATION
-- Additive only: strictly preserves migrations 001–006 untouched.
-- Establishes provider-neutral connection models, durable webhook inbox,
-- deduplication/quarantine, concurrency-safe dispatch queue, JIT pre-send
-- policy checks, and monotonic message status reconciliation.
-- ====================================================================

-- 1. Provider Connections (Workspace External Integration Accounts)
create table if not exists crm.provider_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  provider text not null check (provider in ('resend', 'twilio', 'whatsapp', 'calendly', 'meta', 'vsl', 'outbound')),
  external_account_id text not null,
  connection_state text not null default 'not_configured' check (
    connection_state in ('not_configured', 'configured', 'verification_required', 'active', 'degraded', 'disabled', 'error')
  ),
  capabilities jsonb not null default '[]'::jsonb,
  configuration_metadata jsonb not null default '{}'::jsonb,
  health_status text not null default 'not_configured' check (
    health_status in ('not_configured', 'active', 'degraded', 'error', 'disabled', 'verification_required')
  ),
  last_health_check_at timestamptz,
  last_health_check_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, provider, external_account_id)
);

create index if not exists idx_provider_connections_workspace_provider 
  on crm.provider_connections(workspace_id, provider);

-- 2. Extend Channel Accounts with Provider Connection Reference
alter table crm.channel_accounts
  add column if not exists provider_connection_id uuid,
  add column if not exists provider text check (provider in ('resend', 'twilio', 'whatsapp', 'calendly', 'meta', 'vsl', 'outbound'));

do $$
begin
  if not exists (
    select 1 from pg_constraint 
    where conname = 'fk_channel_accounts_provider_connection'
  ) then
    alter table crm.channel_accounts
      add constraint fk_channel_accounts_provider_connection
      foreign key (workspace_id, provider_connection_id) 
      references crm.provider_connections(workspace_id, id);
  end if;
end $$;

-- 3. Private Connection Secret Bindings (Server-only secret storage, zero CRM read exposure)
create table if not exists private.provider_connection_secret_bindings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  connection_id uuid not null,
  secret_reference text not null,
  key_id text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, connection_id),
  foreign key (workspace_id, connection_id) references crm.provider_connections(workspace_id, id) on delete cascade
);

revoke all on private.provider_connection_secret_bindings from public, anon, authenticated;

-- 4. Durable Webhook Inbox (Private Ingress Evidence & Deduplication)
create table if not exists private.provider_webhook_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  provider text not null check (provider in ('resend', 'twilio', 'whatsapp', 'calendly', 'meta', 'vsl', 'outbound')),
  provider_account_id text,
  connection_id uuid,
  external_event_id text not null,
  event_type text not null,
  payload_hash text not null,
  sanitized_payload jsonb not null default '{}'::jsonb,
  verification_state text not null check (verification_state in ('received', 'verified', 'rejected')),
  processing_state text not null default 'pending' check (processing_state in ('pending', 'processing', 'processed', 'failed', 'quarantined')),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  error_classification text check (
    error_classification in ('transient', 'rate_limited', 'authentication', 'configuration', 'invalid_destination', 'suppressed', 'provider_rejected', 'permanent', 'unknown')
  ),
  error_detail text,
  received_at timestamptz not null default now(),
  provider_timestamp timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, provider, external_event_id),
  foreign key (workspace_id, connection_id) references crm.provider_connections(workspace_id, id)
);

revoke all on private.provider_webhook_events from public, anon, authenticated;

create index if not exists idx_provider_webhook_events_pending 
  on private.provider_webhook_events(workspace_id, processing_state) 
  where processing_state in ('pending', 'processing');

-- 5. Durable Webhook Quarantine (Conflicting duplicate payloads, malformed/unsupported events)
create table if not exists private.provider_webhook_quarantine (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  provider text not null check (provider in ('resend', 'twilio', 'whatsapp', 'calendly', 'meta', 'vsl', 'outbound')),
  external_event_id text not null,
  original_event_id uuid references private.provider_webhook_events(id),
  quarantine_reason text not null check (
    quarantine_reason in ('conflicting_payload', 'unresolved_account', 'unsupported_event', 'invalid_mapping', 'suspicious_replay')
  ),
  payload_hash text not null,
  sanitized_payload jsonb not null default '{}'::jsonb,
  quarantined_at timestamptz not null default now(),
  unique (workspace_id, id)
);

revoke all on private.provider_webhook_quarantine from public, anon, authenticated;

-- 6. Durable Provider Dispatch Jobs (Connects Phase 5 queued messages to durable dispatch)
create table if not exists private.provider_dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  message_id uuid not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  channel_account_id uuid not null,
  provider text not null check (provider in ('resend', 'twilio', 'whatsapp', 'calendly', 'meta', 'vsl', 'outbound')),
  provider_connection_id uuid,
  state text not null default 'pending' check (
    state in ('pending', 'claimed', 'dispatching', 'completed', 'failed', 'blocked', 'reconciling')
  ),
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  fence bigint not null default 0,
  lease_owner text,
  lease_until timestamptz,
  scheduled_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error_classification text check (
    last_error_classification in ('transient', 'rate_limited', 'authentication', 'configuration', 'invalid_destination', 'suppressed', 'provider_rejected', 'permanent', 'unknown')
  ),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, message_id),
  foreign key (workspace_id, message_id) references crm.messages(workspace_id, id) on delete cascade,
  foreign key (workspace_id, channel_account_id, channel) references crm.channel_accounts(workspace_id, id, channel),
  foreign key (workspace_id, provider_connection_id) references crm.provider_connections(workspace_id, id)
);

revoke all on private.provider_dispatch_jobs from public, anon, authenticated;

create index if not exists idx_provider_dispatch_jobs_claimable 
  on private.provider_dispatch_jobs(workspace_id, scheduled_at) 
  where state in ('pending', 'failed');

-- 7. Durable Provider Operations (Effectively-once execution tracking per external semantic key)
create table if not exists private.provider_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  provider text not null check (provider in ('resend', 'twilio', 'whatsapp', 'calendly', 'meta', 'vsl', 'outbound')),
  provider_connection_id uuid,
  operation_key text not null,
  message_id uuid,
  state text not null default 'pending' check (
    state in ('pending', 'in_flight', 'accepted', 'rejected', 'unknown', 'failed')
  ),
  request_hash text not null,
  provider_message_id text,
  attempt_count integer not null default 0,
  last_fence bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, provider, operation_key),
  foreign key (workspace_id, provider_connection_id) references crm.provider_connections(workspace_id, id),
  foreign key (workspace_id, message_id) references crm.messages(workspace_id, id) on delete set null
);

revoke all on private.provider_operations from public, anon, authenticated;

-- ====================================================================
-- RLS POLICIES
-- ====================================================================

alter table crm.provider_connections enable row level security;
alter table private.provider_connection_secret_bindings enable row level security;
alter table private.provider_webhook_events enable row level security;
alter table private.provider_webhook_quarantine enable row level security;
alter table private.provider_dispatch_jobs enable row level security;
alter table private.provider_operations enable row level security;

create policy provider_connections_select on crm.provider_connections
  for select to authenticated
  using (private.member_id(workspace_id) is not null);

create policy provider_connections_admin_all on crm.provider_connections
  for all to authenticated
  using (private.member_role(workspace_id) = 'admin')
  with check (private.member_role(workspace_id) = 'admin');

grant select, insert, update, delete on crm.provider_connections to authenticated;

-- ====================================================================
-- DATABASE FUNCTIONS & STORED PROCEDURES
-- ====================================================================

-- 1. Ingest Webhook Event with Deduplication & Quarantine
create or replace function private.record_webhook_event(
  p_workspace_id uuid,
  p_provider text,
  p_external_event_id text,
  p_event_type text,
  p_payload_hash text,
  p_sanitized_payload jsonb,
  p_provider_account_id text default null,
  p_provider_timestamp timestamptz default null
)
returns table (
  event_id uuid,
  outcome text,
  is_quarantined boolean
)
language plpgsql
security definer
set search_path = public, crm, private, pg_temp
as $$
declare
  v_existing record;
  v_connection_id uuid;
  v_new_id uuid;
begin
  -- Validate workspace
  if not exists (select 1 from crm.workspaces where id = p_workspace_id) then
    raise exception 'invalid_workspace';
  end if;

  -- Check for existing event with same (workspace, provider, external_event_id)
  select id, payload_hash, processing_state into v_existing
  from private.provider_webhook_events
  where workspace_id = p_workspace_id
    and provider = p_provider
    and external_event_id = p_external_event_id;

  if found then
    -- Deduplication check
    if v_existing.payload_hash = p_payload_hash then
      -- Safe replay: same event, identical payload
      return query select v_existing.id, 'replay_safe'::text, false;
      return;
    else
      -- Conflict: same external event ID with differing payload!
      -- Never overwrite original event. Record in quarantine.
      insert into private.provider_webhook_quarantine (
        workspace_id,
        provider,
        external_event_id,
        original_event_id,
        quarantine_reason,
        payload_hash,
        sanitized_payload
      ) values (
        p_workspace_id,
        p_provider,
        p_external_event_id,
        v_existing.id,
        'conflicting_payload',
        p_payload_hash,
        p_sanitized_payload
      );

      return query select v_existing.id, 'quarantined_conflict'::text, true;
      return;
    end if;
  end if;

  -- Resolve provider connection if account id provided
  if p_provider_account_id is not null then
    select id into v_connection_id
    from crm.provider_connections
    where workspace_id = p_workspace_id
      and provider = p_provider
      and external_account_id = p_provider_account_id
    limit 1;
  end if;

  -- Insert new verified webhook event
  insert into private.provider_webhook_events (
    workspace_id,
    provider,
    provider_account_id,
    connection_id,
    external_event_id,
    event_type,
    payload_hash,
    sanitized_payload,
    verification_state,
    processing_state,
    received_at,
    provider_timestamp
  ) values (
    p_workspace_id,
    p_provider,
    p_provider_account_id,
    v_connection_id,
    p_external_event_id,
    p_event_type,
    p_payload_hash,
    coalesce(p_sanitized_payload, '{}'::jsonb),
    'verified',
    'pending',
    now(),
    p_provider_timestamp
  )
  returning id into v_new_id;

  -- Enqueue processing job in private.jobs
  insert into private.jobs (
    workspace_id,
    type,
    dedup_key,
    payload
  ) values (
    p_workspace_id,
    'provider_webhook_process',
    'webhook:' || p_provider || ':' || p_external_event_id,
    jsonb_build_object(
      'event_id', v_new_id,
      'provider', p_provider,
      'event_type', p_event_type
    )
  )
  on conflict (workspace_id, type, dedup_key) do nothing;

  return query select v_new_id, 'received'::text, false;
end;
$$;

revoke all on function private.record_webhook_event from public, anon, authenticated;

-- 2. Concurrency-Safe Dispatch Job Claiming
create or replace function private.claim_dispatch_jobs(
  p_workspace_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 60,
  p_limit integer default 10
)
returns table (
  job_id uuid,
  workspace_id uuid,
  message_id uuid,
  channel text,
  channel_account_id uuid,
  provider text,
  provider_connection_id uuid,
  fence bigint,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public, crm, private, pg_temp
as $$
begin
  return query
  with claimable as (
    select j.id
    from private.provider_dispatch_jobs j
    where j.workspace_id = p_workspace_id
      and j.state in ('pending', 'failed')
      and j.attempt_count < j.max_attempts
      and j.scheduled_at <= now()
      and (j.lease_until is null or j.lease_until < now())
    order by j.scheduled_at asc
    limit p_limit
    for update skip locked
  )
  update private.provider_dispatch_jobs target
  set state = 'claimed',
      fence = target.fence + 1,
      lease_owner = p_worker_id,
      lease_until = now() + (p_lease_seconds || ' seconds')::interval,
      claimed_at = now(),
      updated_at = now()
  from claimable
  where target.id = claimable.id
  returning 
    target.id,
    target.workspace_id,
    target.message_id,
    target.channel,
    target.channel_account_id,
    target.provider,
    target.provider_connection_id,
    target.fence,
    target.attempt_count;
end;
$$;

revoke all on function private.claim_dispatch_jobs from public, anon, authenticated;

-- 3. JIT Pre-Send Policy Evaluation
create or replace function private.evaluate_pre_send_policy(
  p_workspace_id uuid,
  p_job_id uuid
)
returns table (
  is_eligible boolean,
  block_reason text,
  error_classification text
)
language plpgsql
security definer
set search_path = public, crm, private, pg_temp
as $$
declare
  v_job record;
  v_msg record;
  v_lead_id uuid;
  v_recipient_endpoint text;
  v_campaign_status text;
  v_sequence_status text;
  v_channel_account_status text;
  v_connection_state text;
begin
  -- 1. Load job
  select * into v_job
  from private.provider_dispatch_jobs
  where workspace_id = p_workspace_id and id = p_job_id;

  if not found then
    return query select false, 'job_not_found'::text, 'permanent'::text;
    return;
  end if;

  -- 2. Load message
  select * into v_msg
  from crm.messages
  where workspace_id = p_workspace_id and id = v_job.message_id;

  if not found then
    return query select false, 'message_not_found'::text, 'permanent'::text;
    return;
  end if;

  -- Verify message is still in queued state
  if v_msg.status <> 'queued' then
    return query select false, 'message_not_queued'::text, 'permanent'::text;
    return;
  end if;

  -- 3. Check Lead exists and is active
  select lead_id into v_lead_id
  from crm.conversations
  where workspace_id = p_workspace_id and id = v_msg.conversation_id;

  if not found or not exists (
    select 1 from crm.leads where workspace_id = p_workspace_id and id = v_lead_id
  ) then
    return query select false, 'lead_invalid_or_deleted'::text, 'permanent'::text;
    return;
  end if;

  -- 4. Check Suppression / DNC for recipient endpoint
  v_recipient_endpoint := coalesce(v_msg.recipient_address, '');
  if v_recipient_endpoint <> '' then
    if (private.is_suppressed(p_workspace_id, v_lead_id, v_msg.channel, v_recipient_endpoint)->>'is_suppressed')::boolean then
      return query select false, 'recipient_suppressed_dnc'::text, 'suppressed'::text;
      return;
    end if;
  end if;

  -- 5. Campaign Lifecycle Check (if campaign message)
  if v_msg.campaign_id is not null then
    select status into v_campaign_status
    from crm.campaigns
    where workspace_id = p_workspace_id and id = v_msg.campaign_id;

    if v_campaign_status is null or v_campaign_status <> 'active' then
      return query select false, 'campaign_not_active'::text, 'configuration'::text;
      return;
    end if;
  end if;

  -- 6. Sequence Lifecycle Check (if sequence message)
  if v_msg.sequence_enrollment_id is not null then
    select status into v_sequence_status
    from crm.sequence_enrollments
    where workspace_id = p_workspace_id and id = v_msg.sequence_enrollment_id;

    if v_sequence_status is null or v_sequence_status <> 'active' then
      return query select false, 'sequence_enrollment_not_active'::text, 'configuration'::text;
      return;
    end if;
  end if;

  -- 7. Channel Account Status Check
  select status into v_channel_account_status
  from crm.channel_accounts
  where workspace_id = p_workspace_id and id = v_job.channel_account_id;

  if v_channel_account_status is null or v_channel_account_status <> 'active' then
    return query select false, 'channel_account_inactive'::text, 'configuration'::text;
    return;
  end if;

  -- 8. Provider Connection State Check
  if v_job.provider_connection_id is not null then
    select connection_state into v_connection_state
    from crm.provider_connections
    where workspace_id = p_workspace_id and id = v_job.provider_connection_id;

    if v_connection_state is null or v_connection_state in ('disabled', 'error') then
      return query select false, 'provider_connection_disabled'::text, 'configuration'::text;
      return;
    end if;
  end if;

  -- All checks passed
  return query select true, null::text, null::text;
end;
$$;

revoke all on function private.evaluate_pre_send_policy from public, anon, authenticated;

-- 4. Monotonic Message Status Reconciliation Engine
create or replace function private.apply_message_status_event(
  p_workspace_id uuid,
  p_message_id uuid,
  p_provider text,
  p_event_type text,
  p_provider_event_id text default null,
  p_payload_hash text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public, crm, private, pg_temp
as $$
declare
  v_curr_status text;
  v_curr_rank integer;
  v_new_rank integer;
  v_target_status text;
  v_final_status text;
  v_event_type text;
begin
  -- Load current message status
  select status into v_curr_status
  from crm.messages
  where workspace_id = p_workspace_id and id = p_message_id;

  if not found then
    raise exception 'message_not_found';
  end if;

  -- Map incoming event to canonical message status & event_type
  v_target_status := case p_event_type
    when 'provider_accepted' then 'sending'
    when 'accepted' then 'sending'
    when 'dispatch_started' then 'sending'
    when 'sent' then 'sent'
    when 'delivered' then 'delivered'
    when 'failed' then 'failed'
    when 'bounced' then 'bounced'
    when 'cancelled' then 'cancelled'
    when 'suppressed' then 'suppressed'
    else p_event_type
  end;

  v_event_type := case p_event_type
    when 'accepted' then 'provider_accepted'
    when 'sending' then 'dispatch_started'
    else p_event_type
  end;

  -- Compute ranks: draft: 0, queued: 1, sending: 2, sent: 3, delivered: 4
  v_curr_rank := case v_curr_status
    when 'draft' then 0
    when 'queued' then 1
    when 'sending' then 2
    when 'sent' then 3
    when 'delivered' then 4
    else 99 -- terminal / failure
  end;

  v_new_rank := case v_target_status
    when 'draft' then 0
    when 'queued' then 1
    when 'sending' then 2
    when 'sent' then 3
    when 'delivered' then 4
    else 99
  end;

  -- Monotonic progression:
  -- If event is terminal (failed, bounced, cancelled, suppressed), always apply terminal state.
  -- If event is progression rank (sending, sent, delivered), apply ONLY if new_rank > curr_rank.
  -- E.g. A late 'sent' (rank 3) cannot overwrite 'delivered' (rank 4).
  if v_target_status in ('failed', 'bounced', 'cancelled', 'suppressed') then
    v_final_status := v_target_status;
    update crm.messages
    set status = v_final_status
    where workspace_id = p_workspace_id and id = p_message_id;
  elsif v_curr_rank < 99 and v_new_rank > v_curr_rank and v_new_rank < 99 then
    v_final_status := v_target_status;
    update crm.messages
    set status = v_final_status
    where workspace_id = p_workspace_id and id = p_message_id;
  else
    -- Status preserved monotonically (no regression)
    v_final_status := v_curr_status;
  end if;

  -- Always record the event evidence in crm.message_events for permanent audit
  insert into crm.message_events (
    workspace_id,
    message_id,
    event_type,
    from_status,
    to_status,
    details
  ) values (
    p_workspace_id,
    p_message_id,
    v_event_type,
    v_curr_status,
    v_final_status,
    jsonb_build_object(
      'provider', p_provider,
      'provider_event_id', p_provider_event_id,
      'payload_hash', p_payload_hash,
      'metadata', coalesce(p_metadata, '{}'::jsonb)
    )
  );

  return v_final_status;
end;
$$;

revoke all on function private.apply_message_status_event from public, anon, authenticated;

-- 5. Operational Retry RPC (Admin / Manager safe retry with compliance re-check)
create or replace function api.retry_dispatch_job(
  p_workspace_id uuid,
  p_job_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, crm, private, pg_temp
as $$
declare
  v_caller_membership_id uuid;
  v_job record;
  v_eval record;
begin
  -- 1. Validate caller membership and authority
  v_caller_membership_id := private.member_id(p_workspace_id);
  if v_caller_membership_id is null then
    raise exception 'unauthorized';
  end if;

  if private.member_role(p_workspace_id) not in ('admin', 'manager') then
    raise exception 'forbidden_manager_required';
  end if;

  -- 2. Lookup job
  select * into v_job
  from private.provider_dispatch_jobs
  where workspace_id = p_workspace_id and id = p_job_id;

  if not found then
    raise exception 'job_not_found';
  end if;

  if v_job.state not in ('failed', 'blocked') then
    raise exception 'job_not_eligible_for_retry';
  end if;

  -- 3. JIT Pre-send policy recheck: DNC/suppression MUST NOT BE BYPASSED
  select * into v_eval
  from private.evaluate_pre_send_policy(p_workspace_id, p_job_id);

  if not v_eval.is_eligible and v_eval.error_classification = 'suppressed' then
    raise exception 'cannot_retry_suppressed_recipient';
  end if;

  -- 4. Reset job for safe re-dispatch
  update private.provider_dispatch_jobs
  set state = 'pending',
      attempt_count = 0,
      fence = fence + 1,
      scheduled_at = now(),
      lease_owner = null,
      lease_until = null,
      last_error_classification = null,
      last_error_code = null,
      updated_at = now()
  where workspace_id = p_workspace_id and id = p_job_id;

  -- Reset message to queued if it was marked failed
  update crm.messages
  set status = 'queued'
  where workspace_id = p_workspace_id and id = v_job.message_id and status in ('failed', 'suppressed');

  return v_job.id;
end;
$$;

revoke all on function api.retry_dispatch_job from public, anon;
grant execute on function api.retry_dispatch_job to authenticated;

-- 6. List Provider Connections RPC (Settings -> Integrations UI)
create or replace function api.list_provider_connections(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, crm, private, pg_temp
as $$
declare
  v_caller_membership_id uuid;
  v_result jsonb;
begin
  -- Validate caller membership
  v_caller_membership_id := private.member_id(p_workspace_id);
  if v_caller_membership_id is null then
    raise exception 'unauthorized';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'provider', c.provider,
      'external_account_id', c.external_account_id,
      'connection_state', c.connection_state,
      'capabilities', c.capabilities,
      'configuration_metadata', c.configuration_metadata,
      'health_status', c.health_status,
      'last_health_check_at', c.last_health_check_at,
      'last_health_check_code', c.last_health_check_code,
      'created_at', c.created_at,
      'updated_at', c.updated_at
    ) order by c.provider asc
  ), '[]'::jsonb)
  into v_result
  from crm.provider_connections c
  where c.workspace_id = p_workspace_id;

  return v_result;
end;
$$;

revoke all on function api.list_provider_connections from public, anon;
grant execute on function api.list_provider_connections to authenticated;
