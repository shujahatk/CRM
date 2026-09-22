-- ====================================================================
-- 80/20 CRM — PHASE 5 MIGRATION: MESSAGING, CONVERSATIONS & CAMPAIGNS
-- Incorporates all 17 approved architectural design corrections.
-- ====================================================================

-- 1. Channel Accounts (Workspace Sender Identities)
create table crm.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  sender_address text not null,
  display_name text not null,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive', 'pending_verification')),
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, channel, sender_address)
);

-- 2. Conversations (Deterministic Identity: workspace + lead + channel + channel_account + lead_destination)
create table crm.conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  channel_account_id uuid,
  lead_destination_normalized text not null,
  assigned_membership_id uuid,
  status text not null default 'open' check (status in ('open', 'pending', 'closed', 'archived')),
  unread_count integer not null default 0 check (unread_count >= 0),
  last_message_at timestamptz not null default now(),
  last_message_snippet text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, channel_account_id) references crm.channel_accounts(workspace_id, id),
  foreign key (workspace_id, assigned_membership_id) references crm.memberships(workspace_id, id)
);

create table crm.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  conversation_id uuid not null,
  participant_type text not null check (participant_type in ('lead', 'member', 'system')),
  lead_id uuid,
  membership_id uuid,
  channel_address text not null,
  joined_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, conversation_id) references crm.conversations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id),
  foreign key (workspace_id, membership_id) references crm.memberships(workspace_id, id)
);

-- 3. Templates & Immutable Template Versions (Correction 3)
create table crm.message_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  name text not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  status text not null default 'active' check (status in ('active', 'archived')),
  current_version_id uuid,
  created_by_membership_id uuid not null references crm.memberships(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, created_by_membership_id) references crm.memberships(workspace_id, id)
);

create table crm.message_template_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  template_id uuid not null,
  version integer not null default 1,
  subject text,
  body text not null,
  variables_used text[] not null default '{}',
  published_by_membership_id uuid not null references crm.memberships(id),
  published_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, template_id, version),
  foreign key (workspace_id, template_id) references crm.message_templates(workspace_id, id) on delete cascade,
  foreign key (workspace_id, published_by_membership_id) references crm.memberships(workspace_id, id)
);

alter table crm.message_templates
  add foreign key (workspace_id, current_version_id) references crm.message_template_versions(workspace_id, id);

-- 4. Unified Messages & Immutable Events (Corrections 8 & 9)
create table crm.messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  conversation_id uuid not null,
  lead_id uuid not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  direction text not null check (direction in ('inbound', 'outbound')),
  author_membership_id uuid,
  sender_address text not null,
  recipient_address text not null,
  subject text,
  text_body text not null,
  html_body text,
  status text not null default 'draft' check (status in ('draft', 'queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'received', 'cancelled', 'suppressed')),
  dispatch_status text not null default 'awaiting_provider' check (dispatch_status in ('awaiting_provider', 'pending_dispatch', 'dispatched', 'suppressed', 'cancelled', 'received')),
  template_version_id uuid,
  campaign_id uuid,
  sequence_enrollment_id uuid,
  send_operation_key text,
  provider_message_id text,
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, send_operation_key),
  foreign key (workspace_id, conversation_id) references crm.conversations(workspace_id, id) on delete cascade,
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, author_membership_id) references crm.memberships(workspace_id, id),
  foreign key (workspace_id, template_version_id) references crm.message_template_versions(workspace_id, id)
);

create table crm.message_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  message_id uuid not null,
  event_type text not null check (event_type in ('draft_created', 'queued', 'dispatch_started', 'provider_accepted', 'sent', 'delivered', 'failed', 'bounced', 'received', 'cancelled', 'suppressed')),
  from_status text,
  to_status text not null,
  details jsonb not null default '{}',
  occurred_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, message_id) references crm.messages(workspace_id, id) on delete cascade
);

-- 5. Inbound Message Reviews (Correction 2: Durable store for zero-match or ambiguous inbound)
create table crm.inbound_message_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  channel_account_id uuid,
  sender_address_normalized text not null,
  recipient_address text not null,
  subject text,
  text_body text not null,
  provider_message_id text,
  occurred_at timestamptz not null default now(),
  resolution_state text not null default 'pending' check (resolution_state in ('pending', 'resolved', 'dismissed')),
  resolution_reason text not null check (resolution_reason in ('unmatched_sender', 'ambiguous_identity_conflict', 'missing_channel_account')),
  candidate_lead_ids uuid[] not null default '{}',
  resolved_lead_id uuid,
  resolved_conversation_id uuid,
  resolved_by_membership_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, channel_account_id) references crm.channel_accounts(workspace_id, id),
  foreign key (workspace_id, resolved_lead_id) references crm.leads(workspace_id, id),
  foreign key (workspace_id, resolved_conversation_id) references crm.conversations(workspace_id, id),
  foreign key (workspace_id, resolved_by_membership_id) references crm.memberships(workspace_id, id)
);

-- 6. Compliance, DNC & Suppression Engine (Correction 5: Non-destructive audit history)
create table crm.suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  scope text not null check (scope in ('workspace_dnc', 'lead_dnc', 'destination_block', 'channel_suppression')),
  destination_normalized text,
  channel text check (channel in ('email', 'sms', 'whatsapp')),
  lead_id uuid,
  reason text not null check (reason in ('manual_dnc', 'unsubscribe', 'hard_bounce', 'spam_complaint', 'consent_withdrawn', 'invalid_destination')),
  source text not null check (source in ('rep_ui', 'inbound_stop', 'provider_webhook', 'api', 'consent_sync')),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired', 'superseded')),
  actor_membership_id uuid,
  revoked_by_membership_id uuid,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, actor_membership_id) references crm.memberships(workspace_id, id),
  foreign key (workspace_id, revoked_by_membership_id) references crm.memberships(workspace_id, id)
);

-- 7. Campaigns & Materialized Recipients (Corrections 4, 10, 11, 13)
create table crm.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  name text not null,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  template_version_id uuid not null,
  audience_filters jsonb not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed')),
  batch_size integer not null default 100 check (batch_size between 1 and 1000),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_by_membership_id uuid not null references crm.memberships(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, template_version_id) references crm.message_template_versions(workspace_id, id),
  foreign key (workspace_id, created_by_membership_id) references crm.memberships(workspace_id, id)
);

create table crm.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  campaign_id uuid not null,
  lead_id uuid not null,
  destination_normalized text not null,
  destination_identity_id uuid,
  eligibility_status text not null check (eligibility_status in ('eligible', 'suppressed', 'missing_destination')),
  suppression_rule_applied text,
  suppression_reason text,
  suppression_ref_id uuid,
  message_id uuid,
  status text not null default 'pending' check (status in ('pending', 'queued', 'dispatched', 'skipped', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, campaign_id, destination_normalized),
  unique (workspace_id, campaign_id, lead_id),
  foreign key (workspace_id, campaign_id) references crm.campaigns(workspace_id, id) on delete cascade,
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, destination_identity_id) references crm.identities(workspace_id, id),
  foreign key (workspace_id, message_id) references crm.messages(workspace_id, id)
);

create table crm.campaign_response_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  campaign_recipient_id uuid not null,
  inbound_message_id uuid not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, campaign_recipient_id, inbound_message_id),
  foreign key (workspace_id, campaign_recipient_id) references crm.campaign_recipients(workspace_id, id) on delete cascade,
  foreign key (workspace_id, inbound_message_id) references crm.messages(workspace_id, id) on delete cascade
);

-- 8. Sequences, Drips & Step Executions (Corrections 14 & 15)
create table crm.sequences (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  current_version_id uuid,
  created_by_membership_id uuid not null references crm.memberships(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, created_by_membership_id) references crm.memberships(workspace_id, id)
);

create table crm.sequence_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  sequence_id uuid not null,
  version integer not null default 1,
  exit_conditions text[] not null default '{"reply_received", "meeting_booked", "closed_won", "closed_lost", "dnc"}',
  published_by_membership_id uuid not null references crm.memberships(id),
  published_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, sequence_id, version),
  foreign key (workspace_id, sequence_id) references crm.sequences(workspace_id, id) on delete cascade,
  foreign key (workspace_id, published_by_membership_id) references crm.memberships(workspace_id, id)
);

alter table crm.sequences
  add foreign key (workspace_id, current_version_id) references crm.sequence_versions(workspace_id, id);

create table crm.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  sequence_version_id uuid not null,
  step_number integer not null check (step_number >= 1),
  delay_seconds integer not null default 0 check (delay_seconds >= 0),
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  template_version_id uuid not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, sequence_version_id, step_number),
  foreign key (workspace_id, sequence_version_id) references crm.sequence_versions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, template_version_id) references crm.message_template_versions(workspace_id, id)
);

create table crm.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  sequence_version_id uuid not null,
  lead_id uuid not null,
  status text not null default 'active' check (status in ('active', 'completed', 'exited', 'paused')),
  current_step_number integer not null default 1,
  start_at timestamptz not null default now(),
  completed_at timestamptz,
  exited_at timestamptz,
  exit_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, sequence_version_id, lead_id),
  foreign key (workspace_id, sequence_version_id) references crm.sequence_versions(workspace_id, id) on delete cascade,
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade
);

create table crm.sequence_step_executions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  enrollment_id uuid not null,
  sequence_step_id uuid not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'completed', 'skipped', 'failed', 'cancelled')),
  run_at timestamptz not null,
  executed_at timestamptz,
  message_id uuid,
  skip_reason text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, enrollment_id, sequence_step_id),
  foreign key (workspace_id, enrollment_id) references crm.sequence_enrollments(workspace_id, id) on delete cascade,
  foreign key (workspace_id, sequence_step_id) references crm.sequence_steps(workspace_id, id) on delete cascade,
  foreign key (workspace_id, message_id) references crm.messages(workspace_id, id)
);

-- ====================================================================
-- TRIGGERS & IMMUTABILITY RULES
-- ====================================================================

-- Immutability on Message Content
create or replace function crm.enforce_message_content_immutability()
returns trigger language plpgsql as $$
begin
  if NEW.text_body is distinct from OLD.text_body or
     NEW.subject is distinct from OLD.subject or
     NEW.html_body is distinct from OLD.html_body or
     NEW.direction is distinct from OLD.direction or
     NEW.channel is distinct from OLD.channel or
     NEW.template_version_id is distinct from OLD.template_version_id then
    raise exception using errcode='42501', message='Message body and origin attributes are immutable once queued';
  end if;
  return NEW;
end $$;

create trigger trg_message_content_immutable
  before update on crm.messages
  for each row execute function crm.enforce_message_content_immutability();

-- Immutability on Message Events
create or replace function crm.enforce_event_append_only()
returns trigger language plpgsql as $$
begin
  raise exception using errcode='42501', message='Message events are strictly append-only';
end $$;

create trigger trg_message_events_immutable
  before update or delete on crm.message_events
  for each row execute function crm.enforce_event_append_only();

-- Immutability on Published Template Versions
create trigger trg_template_version_immutable
  before update or delete on crm.message_template_versions
  for each row execute function crm.enforce_event_append_only();

-- Immutability on Published Sequence Versions & Steps
create trigger trg_sequence_version_immutable
  before update or delete on crm.sequence_versions
  for each row execute function crm.enforce_event_append_only();

create trigger trg_sequence_steps_immutable
  before update or delete on crm.sequence_steps
  for each row execute function crm.enforce_event_append_only();

-- ====================================================================
-- RLS POLICIES
-- ====================================================================

alter table crm.channel_accounts enable row level security;
alter table crm.conversations enable row level security;
alter table crm.conversation_participants enable row level security;
alter table crm.messages enable row level security;
alter table crm.message_events enable row level security;
alter table crm.inbound_message_reviews enable row level security;
alter table crm.message_templates enable row level security;
alter table crm.message_template_versions enable row level security;
alter table crm.suppressions enable row level security;
alter table crm.campaigns enable row level security;
alter table crm.campaign_recipients enable row level security;
alter table crm.campaign_response_links enable row level security;
alter table crm.sequences enable row level security;
alter table crm.sequence_versions enable row level security;
alter table crm.sequence_steps enable row level security;
alter table crm.sequence_enrollments enable row level security;
alter table crm.sequence_step_executions enable row level security;

-- Read policies for authenticated workspace members
create policy channel_accounts_read on crm.channel_accounts for select using (private.member_id(workspace_id) is not null);
create policy conversations_read on crm.conversations for select using (private.member_id(workspace_id) is not null);
create policy participants_read on crm.conversation_participants for select using (private.member_id(workspace_id) is not null);
create policy messages_read on crm.messages for select using (private.member_id(workspace_id) is not null);
create policy message_events_read on crm.message_events for select using (private.member_id(workspace_id) is not null);
create policy reviews_read on crm.inbound_message_reviews for select using (private.member_id(workspace_id) is not null);
create policy templates_read on crm.message_templates for select using (private.member_id(workspace_id) is not null);
create policy template_versions_read on crm.message_template_versions for select using (private.member_id(workspace_id) is not null);
create policy suppressions_read on crm.suppressions for select using (private.member_id(workspace_id) is not null);
create policy campaigns_read on crm.campaigns for select using (private.member_id(workspace_id) is not null);
create policy campaign_recipients_read on crm.campaign_recipients for select using (private.member_id(workspace_id) is not null);
create policy campaign_links_read on crm.campaign_response_links for select using (private.member_id(workspace_id) is not null);
create policy sequences_read on crm.sequences for select using (private.member_id(workspace_id) is not null);
create policy sequence_versions_read on crm.sequence_versions for select using (private.member_id(workspace_id) is not null);
create policy sequence_steps_read on crm.sequence_steps for select using (private.member_id(workspace_id) is not null);
create policy sequence_enrollments_read on crm.sequence_enrollments for select using (private.member_id(workspace_id) is not null);
create policy sequence_step_executions_read on crm.sequence_step_executions for select using (private.member_id(workspace_id) is not null);

-- ====================================================================
-- BUSINESS & SECURITY RPCs
-- ====================================================================

-- 1. Suppression Checker Helper (Correction 10 & 11)
create or replace function private.is_suppressed(
  p_workspace uuid,
  p_lead_id uuid,
  p_channel text,
  p_destination text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_sup record;
  v_consent record;
begin
  -- 1. Check active suppression table
  select * into v_sup
  from crm.suppressions
  where workspace_id = p_workspace
    and status = 'active'
    and (
      (scope = 'workspace_dnc' and (destination_normalized = p_destination or lead_id = p_lead_id)) or
      (scope = 'lead_dnc' and lead_id = p_lead_id) or
      (scope = 'destination_block' and destination_normalized = p_destination) or
      (scope = 'channel_suppression' and channel = p_channel and (destination_normalized = p_destination or lead_id = p_lead_id))
    )
    and (expires_at is null or expires_at > now())
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'is_suppressed', true,
      'rule_applied', v_sup.scope,
      'reason', v_sup.reason,
      'ref_id', v_sup.id
    );
  end if;

  -- 2. Check consent withdrawal for marketing channels
  select * into v_consent
  from crm.consent_events
  where workspace_id = p_workspace
    and lead_id = p_lead_id
    and category in ('marketing', 'all')
  order by occurred_at desc
  limit 1;

  if found and v_consent.state in ('denied', 'withdrawn') then
    return jsonb_build_object(
      'is_suppressed', true,
      'rule_applied', 'consent_withdrawal',
      'reason', 'Marketing consent ' || v_consent.state,
      'ref_id', v_consent.id
    );
  end if;

  return jsonb_build_object('is_suppressed', false);
end $$;

-- 2. Create Outbound Message (Corrections 1, 3, 6, 8, 9, 10, 11)
create or replace function api.create_outbound_message(
  p_workspace uuid,
  p_lead_id uuid,
  p_channel text,
  p_recipient_address text,
  p_text_body text default null,
  p_subject text default null,
  p_html_body text default null,
  p_template_version_id uuid default null,
  p_command_key text default null,
  p_channel_account_id uuid default null,
  p_template_variables jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_lead crm.leads%rowtype;
  v_account crm.channel_accounts%rowtype;
  v_tpl_ver crm.message_template_versions%rowtype;
  v_var text;
  v_is_opt boolean;
  v_clean_var text;
  v_val text;
  v_body text;
  v_subject text;
  v_conv_id uuid;
  v_msg_id uuid;
  v_norm_dest text;
  v_suppression jsonb;
  v_status text := 'queued';
  v_dispatch_status text := 'awaiting_provider';
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role = 'read_only' then
    raise exception using errcode='42501', message='Active member with sending permission required';
  end if;

  select * into v_lead from crm.leads where workspace_id = p_workspace and id = p_lead_id;
  if not found then raise exception using errcode='42501', message='Lead not found'; end if;

  if role in ('setter', 'closer') and not private.can_work_lead(p_workspace, p_lead_id) then
    raise exception using errcode='42501', message='Not authorized to message unassigned lead';
  end if;

  -- Normalize recipient address
  if p_channel = 'email' then
    v_norm_dest := lower(btrim(p_recipient_address));
  else
    v_norm_dest := regexp_replace(btrim(p_recipient_address), '[[:space:]\-\(\)\.]+', '', 'g');
  end if;

  -- Resolve channel account
  if p_channel_account_id is not null then
    select * into v_account from crm.channel_accounts
    where workspace_id = p_workspace and id = p_channel_account_id and status = 'active';
    if not found then raise exception using errcode='42501', message='Channel account not found or inactive'; end if;
  else
    select * into v_account from crm.channel_accounts
    where workspace_id = p_workspace and channel = p_channel and status = 'active'
    order by is_default desc, created_at asc limit 1;
  end if;

  -- Template resolution & variable validation (Correction 3)
  v_body := p_text_body;
  v_subject := p_subject;

  if p_template_version_id is not null then
    select * into v_tpl_ver from crm.message_template_versions
    where workspace_id = p_workspace and id = p_template_version_id;
    if not found then raise exception using errcode='42501', message='Template version not found'; end if;

    v_body := v_tpl_ver.body;
    v_subject := coalesce(p_subject, v_tpl_ver.subject);

    foreach v_var in array v_tpl_ver.variables_used loop
      v_is_opt := (v_var like '%:optional');
      v_clean_var := replace(v_var, ':optional', '');

      v_val := null;
      if p_template_variables is not null and p_template_variables ? v_clean_var then
        v_val := p_template_variables->>v_clean_var;
      elsif v_clean_var = 'first_name' then
        v_val := split_part(v_lead.display_name, ' ', 1);
      elsif v_clean_var = 'last_name' then
        v_val := nullif(substring(v_lead.display_name from position(' ' in v_lead.display_name) + 1), '');
      elsif v_clean_var = 'company' then
        v_val := v_lead.company;
      end if;

      if v_val is null or btrim(v_val) = '' then
        if not v_is_opt then
          raise exception using errcode='22023', message='Missing required template variable: {{' || v_clean_var || '}}';
        else
          v_val := '';
        end if;
      end if;

      v_body := replace(v_body, '{{' || v_var || '}}', v_val);
      if v_subject is not null then
        v_subject := replace(v_subject, '{{' || v_var || '}}', v_val);
      end if;
    end loop;
  end if;

  if v_body is null or btrim(v_body) = '' then
    raise exception using errcode='22023', message='Message body cannot be empty';
  end if;

  -- Just-in-Time Suppression Check (Correction 10 & 11)
  v_suppression := private.is_suppressed(p_workspace, p_lead_id, p_channel, v_norm_dest);
  if (v_suppression->>'is_suppressed')::boolean then
    raise exception using errcode='22023', message='Recipient address is suppressed: ' || (v_suppression->>'reason');
  end if;

  -- Deterministic Conversation Identity (Correction 1)
  insert into crm.conversations(
    workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
    last_message_at, last_message_snippet, unread_count
  ) values (
    p_workspace, p_lead_id, p_channel, v_account.id, v_norm_dest,
    now(), substring(v_body from 1 for 100), 0
  )
  on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
  do update set
    last_message_at = now(),
    last_message_snippet = substring(v_body from 1 for 100),
    updated_at = now()
  returning id into v_conv_id;

  -- Insert Message Record
  insert into crm.messages(
    workspace_id, conversation_id, lead_id, channel, direction, author_membership_id,
    sender_address, recipient_address, subject, text_body, html_body,
    status, dispatch_status, template_version_id, send_operation_key, queued_at
  ) values (
    p_workspace, v_conv_id, p_lead_id, p_channel, 'outbound', actor,
    coalesce(v_account.sender_address, 'system@8020crm.local'), v_norm_dest,
    v_subject, v_body, p_html_body,
    v_status, v_dispatch_status, p_template_version_id, p_command_key, now()
  ) returning id into v_msg_id;

  -- Log Initial Message Event
  insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, details)
  values (
    p_workspace, v_msg_id,
    'queued', 'draft', v_status,
    jsonb_build_object('provider_status', 'awaiting_provider')
  );

  -- Log Activity Stream
  insert into crm.activities(
    workspace_id, lead_id, aggregate_type, aggregate_id, event_type, actor_membership_id, payload
  ) values (
    p_workspace, p_lead_id, 'lead', p_lead_id,
    'message.queued', actor,
    jsonb_build_object('message_id', v_msg_id, 'channel', p_channel, 'destination', v_norm_dest, 'status', v_status)
  );

  return jsonb_build_object(
    'message_id', v_msg_id,
    'conversation_id', v_conv_id,
    'status', v_status,
    'dispatch_status', v_dispatch_status
  );
end $$;

-- 3. Inbound Message Canonical Ingestion (Corrections 2, 12, 14)
create or replace function api.ingest_inbound_message(
  p_workspace uuid,
  p_channel text,
  p_sender_address text,
  p_recipient_address text,
  p_text_body text,
  p_subject text default null,
  p_provider_message_id text default null,
  p_idempotency_key text default null,
  p_occurred_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_norm_sender text;
  v_norm_recipient text;
  v_identity_matches uuid[];
  v_lead_id uuid;
  v_account crm.channel_accounts%rowtype;
  v_conv_id uuid;
  v_msg_id uuid;
  v_review_id uuid;
  v_req_hash text;
  v_receipt private.command_receipts%rowtype;
  v_actor uuid;
  v_res jsonb;
begin
  -- Normalize addresses
  if p_channel = 'email' then
    v_norm_sender := lower(btrim(p_sender_address));
    v_norm_recipient := lower(btrim(p_recipient_address));
  else
    v_norm_sender := regexp_replace(btrim(p_sender_address), '[[:space:]\-\(\)\.]+', '', 'g');
    v_norm_recipient := regexp_replace(btrim(p_recipient_address), '[[:space:]\-\(\)\.]+', '', 'g');
  end if;

  -- Command Idempotency check (Correction 12)
  if p_idempotency_key is not null then
    v_req_hash := encode(sha256(convert_to(coalesce(p_provider_message_id, '') || '|' || p_channel || '|' || v_norm_sender || '|' || coalesce(p_subject, '') || '|' || p_text_body, 'utf8')), 'hex');
    select * into v_receipt from private.command_receipts
    where workspace_id = p_workspace and command_key = p_idempotency_key;
    if found then
      if v_receipt.request_hash <> v_req_hash then
        raise exception using errcode='40001', message='Idempotency key replayed with different payload';
      end if;
      return v_receipt.result;
    end if;
  end if;

  -- Provider Deduplication check (Correction 12: Scoped by workspace + channel + provider_message_id)
  if p_provider_message_id is not null then
    select id into v_msg_id from crm.messages
    where workspace_id = p_workspace and channel = p_channel and provider_message_id = p_provider_message_id limit 1;
    if found then
      v_res := jsonb_build_object('message_id', v_msg_id, 'duplicate', true, 'status', 'received');
      return v_res;
    end if;
  end if;

  -- Resolve matching channel account
  select * into v_account from crm.channel_accounts
  where workspace_id = p_workspace and channel = p_channel and sender_address = v_norm_recipient limit 1;

  -- Exact Identity Matching on crm.identities
  select array_agg(distinct ic.lead_id) into v_identity_matches
  from crm.identities i
  join crm.identity_claims ic on ic.identity_id = i.id and ic.active = true and ic.workspace_id = p_workspace
  where i.workspace_id = p_workspace
    and i.normalized_value = v_norm_sender;

  -- Case A: 0 matches -> Inbound Message Review (Correction 2)
  if v_identity_matches is null or cardinality(v_identity_matches) = 0 then
    insert into crm.inbound_message_reviews(
      workspace_id, channel, channel_account_id, sender_address_normalized, recipient_address,
      subject, text_body, provider_message_id, occurred_at, resolution_state, resolution_reason
    ) values (
      p_workspace, p_channel, v_account.id, v_norm_sender, v_norm_recipient,
      p_subject, p_text_body, p_provider_message_id, p_occurred_at, 'pending', 'unmatched_sender'
    ) returning id into v_review_id;

    v_res := jsonb_build_object('review_id', v_review_id, 'status', 'unresolved_inbound', 'reason', 'unmatched_sender');

    if p_idempotency_key is not null then
      select id into v_actor from crm.memberships where workspace_id = p_workspace and role = 'admin' limit 1;
      insert into private.command_receipts(workspace_id, actor_membership_id, command_key, request_hash, result)
      values (p_workspace, v_actor, p_idempotency_key, v_req_hash, v_res);
    end if;

    return v_res;
  end if;

  -- Case B: >1 matches -> Ambiguous Conflict Review (Correction 2)
  if cardinality(v_identity_matches) > 1 then
    insert into crm.inbound_message_reviews(
      workspace_id, channel, channel_account_id, sender_address_normalized, recipient_address,
      subject, text_body, provider_message_id, occurred_at, resolution_state, resolution_reason, candidate_lead_ids
    ) values (
      p_workspace, p_channel, v_account.id, v_norm_sender, v_norm_recipient,
      p_subject, p_text_body, p_provider_message_id, p_occurred_at, 'pending', 'ambiguous_identity_conflict', v_identity_matches
    ) returning id into v_review_id;

    v_res := jsonb_build_object('review_id', v_review_id, 'status', 'unresolved_inbound', 'reason', 'ambiguous_identity_conflict');

    if p_idempotency_key is not null then
      select id into v_actor from crm.memberships where workspace_id = p_workspace and role = 'admin' limit 1;
      insert into private.command_receipts(workspace_id, actor_membership_id, command_key, request_hash, result)
      values (p_workspace, v_actor, p_idempotency_key, v_req_hash, v_res);
    end if;

    return v_res;
  end if;

  -- Case C: Exactly 1 Match -> Ingest Inbound Message
  v_lead_id := v_identity_matches[1];

  -- Locate or create deterministic conversation
  insert into crm.conversations(
    workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
    unread_count, last_message_at, last_message_snippet
  ) values (
    p_workspace, v_lead_id, p_channel, v_account.id, v_norm_sender,
    1, p_occurred_at, substring(p_text_body from 1 for 100)
  )
  on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
  do update set
    unread_count = crm.conversations.unread_count + 1,
    last_message_at = p_occurred_at,
    last_message_snippet = substring(p_text_body from 1 for 100),
    status = 'open',
    updated_at = now()
  returning id into v_conv_id;

  -- Insert Received Message
  insert into crm.messages(
    workspace_id, conversation_id, lead_id, channel, direction,
    sender_address, recipient_address, subject, text_body,
    status, dispatch_status, provider_message_id, created_at
  ) values (
    p_workspace, v_conv_id, v_lead_id, p_channel, 'inbound',
    v_norm_sender, v_norm_recipient, p_subject, p_text_body,
    'received', 'received', p_provider_message_id, p_occurred_at
  ) returning id into v_msg_id;

  -- Event log
  insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, occurred_at)
  values (p_workspace, v_msg_id, 'received', null, 'received', p_occurred_at);

  -- Evaluate Sequence Exit Triggers (Correction 14)
  update crm.sequence_enrollments
  set status = 'exited',
      exited_at = now(),
      exit_reason = 'reply_received',
      updated_at = now()
  where workspace_id = p_workspace
    and lead_id = v_lead_id
    and status = 'active'
    and exists (
      select 1 from crm.sequence_versions sv
      where sv.id = sequence_version_id and 'reply_received' = any(sv.exit_conditions)
    );

  -- Emit lead activity
  insert into crm.activities(
    workspace_id, lead_id, aggregate_type, aggregate_id, event_type, payload
  ) values (
    p_workspace, v_lead_id, 'lead', v_lead_id, 'message.received',
    jsonb_build_object('message_id', v_msg_id, 'channel', p_channel, 'sender', v_norm_sender)
  );

  v_res := jsonb_build_object(
    'message_id', v_msg_id,
    'conversation_id', v_conv_id,
    'lead_id', v_lead_id,
    'status', 'received'
  );

  if p_idempotency_key is not null then
    select id into v_actor from crm.memberships where workspace_id = p_workspace and role = 'admin' limit 1;
    insert into private.command_receipts(workspace_id, actor_membership_id, command_key, request_hash, result)
    values (p_workspace, v_actor, p_idempotency_key, v_req_hash, v_res);
  end if;

  return v_res;
end $$;

-- 3b. Resolve Inbound Message Review (Correction 2)
create or replace function api.resolve_inbound_review(
  p_workspace uuid,
  p_review_id uuid,
  p_lead_id uuid,
  p_resolution_notes text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_review crm.inbound_message_reviews%rowtype;
  v_lead crm.leads%rowtype;
  v_conv_id uuid;
  v_msg_id uuid;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role = 'read_only' then
    raise exception using errcode='42501', message='Active member with lead editing permission required';
  end if;

  select * into v_review from crm.inbound_message_reviews
  where workspace_id = p_workspace and id = p_review_id;
  if not found then raise exception using errcode='42501', message='Inbound review not found'; end if;
  if v_review.resolution_state <> 'pending' then
    raise exception using errcode='42501', message='Inbound review already resolved or dismissed';
  end if;

  select * into v_lead from crm.leads
  where workspace_id = p_workspace and id = p_lead_id;
  if not found then raise exception using errcode='42501', message='Lead not found'; end if;

  -- Create or locate conversation for chosen lead
  insert into crm.conversations(
    workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
    unread_count, last_message_at, last_message_snippet
  ) values (
    p_workspace, p_lead_id, v_review.channel, v_review.channel_account_id, v_review.sender_address_normalized,
    1, v_review.occurred_at, substring(v_review.text_body from 1 for 100)
  )
  on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
  do update set
    unread_count = crm.conversations.unread_count + 1,
    last_message_at = v_review.occurred_at,
    last_message_snippet = substring(v_review.text_body from 1 for 100),
    status = 'open',
    updated_at = now()
  returning id into v_conv_id;

  -- Insert authoritative message
  insert into crm.messages(
    workspace_id, conversation_id, lead_id, channel, direction,
    sender_address, recipient_address, subject, text_body,
    status, dispatch_status, provider_message_id, created_at
  ) values (
    p_workspace, v_conv_id, p_lead_id, v_review.channel, 'inbound',
    v_review.sender_address_normalized, v_review.recipient_address, v_review.subject, v_review.text_body,
    'received', 'received', v_review.provider_message_id, v_review.occurred_at
  ) returning id into v_msg_id;

  -- Event log
  insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, occurred_at)
  values (p_workspace, v_msg_id, 'received', null, 'received', v_review.occurred_at);

  -- Update review record
  update crm.inbound_message_reviews
  set resolution_state = 'resolved',
      resolved_lead_id = p_lead_id,
      resolved_conversation_id = v_conv_id,
      resolved_by_membership_id = actor,
      resolved_at = now()
  where id = p_review_id;

  return jsonb_build_object(
    'review_id', p_review_id,
    'conversation_id', v_conv_id,
    'message_id', v_msg_id,
    'status', 'resolved'
  );
end $$;

-- 3c. Configuration & Draft Creation RPCs
create or replace function api.upsert_channel_account(
  p_workspace uuid,
  p_channel text,
  p_sender_address text,
  p_display_name text,
  p_is_default boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_norm_sender text;
  v_id uuid;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role not in ('admin', 'manager') then
    raise exception using errcode='42501', message='Admin or manager permission required';
  end if;

  if p_channel = 'email' then
    v_norm_sender := lower(btrim(p_sender_address));
  else
    v_norm_sender := regexp_replace(btrim(p_sender_address), '[[:space:]\-\(\)\.]+', '', 'g');
  end if;

  if p_is_default then
    update crm.channel_accounts
    set is_default = false
    where workspace_id = p_workspace and channel = p_channel;
  end if;

  insert into crm.channel_accounts(
    workspace_id, channel, sender_address, display_name, is_default
  ) values (
    p_workspace, p_channel, v_norm_sender, p_display_name, p_is_default
  )
  on conflict (workspace_id, channel, sender_address)
  do update set
    display_name = p_display_name,
    is_default = case when p_is_default then true else crm.channel_accounts.is_default end,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'channel', p_channel, 'sender_address', v_norm_sender);
end $$;

create or replace function api.create_template(
  p_workspace uuid,
  p_name text,
  p_channel text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_id uuid;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role not in ('admin', 'manager') then
    raise exception using errcode='42501', message='Admin or manager permission required';
  end if;

  insert into crm.message_templates(workspace_id, name, channel, created_by_membership_id)
  values (p_workspace, p_name, p_channel, actor)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'name', p_name, 'channel', p_channel);
end $$;

create or replace function api.create_campaign(
  p_workspace uuid,
  p_name text,
  p_channel text,
  p_template_version_id uuid,
  p_audience_filters jsonb default '{}'::jsonb,
  p_batch_size integer default 100
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_id uuid;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role not in ('admin', 'manager') then
    raise exception using errcode='42501', message='Admin or manager permission required';
  end if;

  insert into crm.campaigns(
    workspace_id, name, channel, template_version_id, audience_filters, batch_size, created_by_membership_id
  ) values (
    p_workspace, p_name, p_channel, p_template_version_id, coalesce(p_audience_filters, '{}'::jsonb), p_batch_size, actor
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'name', p_name, 'channel', p_channel, 'status', 'draft');
end $$;

create or replace function api.create_sequence(
  p_workspace uuid,
  p_name text,
  p_description text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_id uuid;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role not in ('admin', 'manager') then
    raise exception using errcode='42501', message='Admin or manager permission required';
  end if;

  insert into crm.sequences(workspace_id, name, description, created_by_membership_id)
  values (p_workspace, p_name, p_description, actor)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'name', p_name, 'status', 'draft');
end $$;

create or replace function api.publish_sequence_version(
  p_workspace uuid,
  p_sequence_id uuid,
  p_steps jsonb,
  p_exit_conditions text[] default '{"reply_received", "meeting_booked", "closed_won", "closed_lost", "dnc"}'::text[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_next_version integer;
  v_ver_id uuid;
  v_step jsonb;
  v_step_num integer := 1;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role not in ('admin', 'manager') then
    raise exception using errcode='42501', message='Admin or manager permission required';
  end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from crm.sequence_versions where workspace_id = p_workspace and sequence_id = p_sequence_id;

  insert into crm.sequence_versions(
    workspace_id, sequence_id, version, exit_conditions, published_by_membership_id
  ) values (
    p_workspace, p_sequence_id, v_next_version, p_exit_conditions, actor
  ) returning id into v_ver_id;

  if p_steps is not null and jsonb_typeof(p_steps) = 'array' then
    for v_step in select * from jsonb_array_elements(p_steps) loop
      insert into crm.sequence_steps(
        workspace_id, sequence_version_id, step_number, delay_seconds, channel, template_version_id
      ) values (
        p_workspace, v_ver_id, v_step_num, coalesce((v_step->>'delay_seconds')::integer, 0),
        v_step->>'channel', (v_step->>'template_version_id')::uuid
      );
      v_step_num := v_step_num + 1;
    end loop;
  end if;

  update crm.sequences
  set current_version_id = v_ver_id, status = 'active', updated_at = now()
  where workspace_id = p_workspace and id = p_sequence_id;

  return jsonb_build_object('sequence_id', p_sequence_id, 'version_id', v_ver_id, 'version', v_next_version);
end $$;

-- 4. Template Publishing with Variable Allowlist (Correction 3)
create or replace function api.publish_template_version(
  p_workspace uuid,
  p_template_id uuid,
  p_subject text,
  p_body text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_next_version integer;
  v_ver_id uuid;
  v_match text;
  v_vars text[] := '{}';
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role = 'read_only' then
    raise exception using errcode='42501', message='Active member with template editing permission required';
  end if;

  -- Validate variable allowlist: {{first_name}}, {{last_name}}, {{company}}, {{setter_name}}, {{closer_name}}
  for v_match in select unnest(regexp_matches(coalesce(p_subject, '') || ' ' || p_body, '\{\{([a-zA-Z0-9_:]+)\}\}', 'g')) loop
    if v_match not in ('first_name', 'last_name', 'company', 'setter_name', 'closer_name',
                       'first_name:optional', 'last_name:optional', 'company:optional', 'setter_name:optional', 'closer_name:optional') then
      raise exception using errcode='22023', message='Disallowed template variable: {{' || v_match || '}}. Only approved variables allowed.';
    end if;
    v_vars := array_append(v_vars, v_match);
  end loop;

  select coalesce(max(version), 0) + 1 into v_next_version
  from crm.message_template_versions where workspace_id = p_workspace and template_id = p_template_id;

  insert into crm.message_template_versions(
    workspace_id, template_id, version, subject, body, variables_used, published_by_membership_id
  ) values (
    p_workspace, p_template_id, v_next_version, p_subject, p_body, v_vars, actor
  ) returning id into v_ver_id;

  update crm.message_templates
  set current_version_id = v_ver_id, updated_at = now()
  where workspace_id = p_workspace and id = p_template_id;

  return jsonb_build_object('template_id', p_template_id, 'version_id', v_ver_id, 'version', v_next_version);
end $$;

-- 5. Add / Revoke Suppression (Correction 5)
create or replace function api.add_suppression(
  p_workspace uuid,
  p_scope text,
  p_reason text,
  p_destination text default null,
  p_lead_id uuid default null,
  p_channel text default null,
  p_expires_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_sup_id uuid;
  v_norm text;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role in ('setter', 'closer', 'read_only') then
    raise exception using errcode='42501', message='Admin or manager permission required to manage suppressions';
  end if;

  if p_destination is not null then
    if p_channel = 'email' then
      v_norm := lower(btrim(p_destination));
    else
      v_norm := regexp_replace(btrim(p_destination), '[[:space:]\-\(\)\.]+', '', 'g');
    end if;
  end if;

  insert into crm.suppressions(
    workspace_id, scope, destination_normalized, channel, lead_id, reason, source, actor_membership_id, expires_at
  ) values (
    p_workspace, p_scope, v_norm, p_channel, p_lead_id, p_reason, 'rep_ui', actor, p_expires_at
  ) returning id into v_sup_id;

  return jsonb_build_object('suppression_id', v_sup_id, 'status', 'active');
end $$;

create or replace function api.revoke_suppression(
  p_workspace uuid,
  p_suppression_id uuid,
  p_revocation_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role in ('setter', 'closer', 'read_only') then
    raise exception using errcode='42501', message='Admin or manager permission required to revoke suppressions';
  end if;

  update crm.suppressions
  set status = 'revoked',
      revoked_by_membership_id = actor,
      revoked_at = now(),
      revocation_reason = p_revocation_reason
  where workspace_id = p_workspace and id = p_suppression_id;

  if not found then raise exception using errcode='42501', message='Suppression not found'; end if;

  return jsonb_build_object('suppression_id', p_suppression_id, 'status', 'revoked');
end $$;

-- 6. Launch Campaign & Materialize Frozen Audience (Corrections 4, 10, 11, 13)
create or replace function api.launch_campaign(
  p_workspace uuid,
  p_campaign_id uuid,
  p_command_key text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_camp crm.campaigns%rowtype;
  v_lead record;
  v_dest text;
  v_ident_id uuid;
  v_sup jsonb;
  v_status text;
  v_reason text;
  v_rule text;
  v_ref_id uuid;
  v_total integer := 0;
  v_eligible integer := 0;
  v_suppressed integer := 0;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role in ('setter', 'closer', 'read_only') then
    raise exception using errcode='42501', message='Admin or manager permission required to launch campaigns';
  end if;

  select * into v_camp from crm.campaigns where workspace_id = p_workspace and id = p_campaign_id;
  if not found then raise exception using errcode='42501', message='Campaign not found'; end if;
  if v_camp.status not in ('draft', 'scheduled') then
    raise exception using errcode='42501', message='Campaign cannot be launched from current state: ' || v_camp.status;
  end if;

  -- Transactionally materialize audience into crm.campaign_recipients
  for v_lead in
    select l.id as lead_id
    from crm.leads l
    where l.workspace_id = p_workspace
  loop
    v_dest := null;
    v_ident_id := null;

    -- Deterministic primary destination selection
    if v_camp.channel = 'email' then
      select i.id, i.normalized_value into v_ident_id, v_dest
      from crm.lead_identities li
      join crm.identities i on i.id = li.identity_id and i.workspace_id = p_workspace and i.kind = 'email'
      where li.workspace_id = p_workspace and li.lead_id = v_lead.lead_id and li.valid_to is null
      order by li.is_primary desc, li.valid_from asc limit 1;
    else
      select i.id, i.normalized_value into v_ident_id, v_dest
      from crm.lead_identities li
      join crm.identities i on i.id = li.identity_id and i.workspace_id = p_workspace and i.kind = 'phone'
      where li.workspace_id = p_workspace and li.lead_id = v_lead.lead_id and li.valid_to is null
      order by li.is_primary desc, li.valid_from asc limit 1;
    end if;

    if v_dest is null then
      v_status := 'missing_destination';
      v_reason := 'No identity registered for ' || v_camp.channel;
      v_rule := null;
      v_ref_id := null;
    else
      -- Check Suppression
      v_sup := private.is_suppressed(p_workspace, v_lead.lead_id, v_camp.channel, v_dest);
      if (v_sup->>'is_suppressed')::boolean then
        v_status := 'suppressed';
        v_reason := v_sup->>'reason';
        v_rule := v_sup->>'rule_applied';
        v_ref_id := (v_sup->>'ref_id')::uuid;
        v_suppressed := v_suppressed + 1;
      else
        v_status := 'eligible';
        v_reason := null;
        v_rule := null;
        v_ref_id := null;
        v_eligible := v_eligible + 1;
      end if;
    end if;

    -- Insert Frozen Recipient Snapshot (Ignoring duplicate destinations)
    insert into crm.campaign_recipients(
      workspace_id, campaign_id, lead_id, destination_normalized, destination_identity_id,
      eligibility_status, suppression_rule_applied, suppression_reason, suppression_ref_id, status
    ) values (
      p_workspace, p_campaign_id, v_lead.lead_id, coalesce(v_dest, 'unknown'), v_ident_id,
      v_status, v_rule, v_reason, v_ref_id, case when v_status = 'eligible' then 'pending' else 'skipped' end
    )
    on conflict do nothing;

    v_total := v_total + 1;
  end loop;

  -- Create Background Batch Dispatch Jobs via private.jobs (Correction 14 & 15)
  insert into private.jobs(workspace_id, type, dedup_key, payload)
  values (
    p_workspace, 'campaign_dispatch_batch',
    p_campaign_id::text || '-batch-1',
    jsonb_build_object('campaign_id', p_campaign_id, 'batch_size', v_camp.batch_size)
  ) on conflict do nothing;

  update crm.campaigns
  set status = 'running', started_at = now(), updated_at = now()
  where workspace_id = p_workspace and id = p_campaign_id;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'total_recipients', v_total,
    'eligible_count', v_eligible,
    'suppressed_count', v_suppressed,
    'status', 'running'
  );
end $$;

-- 6b. Cancel Campaign & Safe Job Semantics (Correction 15)
create or replace function api.cancel_campaign(
  p_workspace uuid,
  p_campaign_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role not in ('admin', 'manager') then
    raise exception using errcode='42501', message='Admin or manager permission required';
  end if;

  update crm.campaigns
  set status = 'cancelled', updated_at = now()
  where workspace_id = p_workspace and id = p_campaign_id;

  update crm.campaign_recipients
  set status = 'cancelled', updated_at = now()
  where workspace_id = p_workspace and campaign_id = p_campaign_id and status = 'pending';

  return jsonb_build_object('campaign_id', p_campaign_id, 'status', 'cancelled');
end $$;

create or replace function private.process_campaign_batch(
  p_workspace uuid,
  p_campaign_id uuid,
  p_batch_size integer default 100
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_camp crm.campaigns%rowtype;
  v_rec crm.campaign_recipients%rowtype;
  v_tpl_ver crm.message_template_versions%rowtype;
  v_account crm.channel_accounts%rowtype;
  v_lead crm.leads%rowtype;
  v_sup jsonb;
  v_msg_id uuid;
  v_conv_id uuid;
  v_body text;
  v_subject text;
  v_dispatched_count integer := 0;
  v_suppressed_count integer := 0;
begin
  select * into v_camp from crm.campaigns where workspace_id = p_workspace and id = p_campaign_id;
  if not found then return jsonb_build_object('error', 'campaign_not_found'); end if;

  -- Correction 15: Re-check parent campaign status. If cancelled, do NOT dispatch
  if v_camp.status = 'cancelled' then
    update crm.campaign_recipients
    set status = 'cancelled', updated_at = now()
    where workspace_id = p_workspace and campaign_id = p_campaign_id and status = 'pending';
    return jsonb_build_object('campaign_id', p_campaign_id, 'status', 'cancelled', 'dispatched', 0);
  end if;

  select * into v_tpl_ver from crm.message_template_versions where id = v_camp.template_version_id;
  select * into v_account from crm.channel_accounts
  where workspace_id = p_workspace and channel = v_camp.channel and status = 'active'
  order by is_default desc, created_at asc limit 1;

  for v_rec in
    select * from crm.campaign_recipients
    where workspace_id = p_workspace and campaign_id = p_campaign_id and status = 'pending' and eligibility_status = 'eligible'
    limit p_batch_size
    for update skip locked
  loop
    -- Correction 10 & 11: Just-in-Time Suppression Check immediately before dispatch
    v_sup := private.is_suppressed(p_workspace, v_rec.lead_id, v_camp.channel, v_rec.destination_normalized);

    if (v_sup->>'is_suppressed')::boolean then
      -- Mark recipient suppressed
      update crm.campaign_recipients
      set status = 'skipped',
          eligibility_status = 'suppressed',
          suppression_rule_applied = v_sup->>'rule_applied',
          suppression_reason = v_sup->>'reason',
          suppression_ref_id = (v_sup->>'ref_id')::uuid,
          updated_at = now()
      where id = v_rec.id;

      v_suppressed_count := v_suppressed_count + 1;
    else
      -- Render template
      select * into v_lead from crm.leads where id = v_rec.lead_id;
      v_body := replace(v_tpl_ver.body, '{{first_name}}', split_part(v_lead.display_name, ' ', 1));
      v_body := replace(v_body, '{{company}}', coalesce(v_lead.company, ''));
      v_subject := replace(coalesce(v_tpl_ver.subject, ''), '{{first_name}}', split_part(v_lead.display_name, ' ', 1));

      -- Deterministic Conversation
      insert into crm.conversations(
        workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
        last_message_at, last_message_snippet, unread_count
      ) values (
        p_workspace, v_rec.lead_id, v_camp.channel, v_account.id, v_rec.destination_normalized,
        now(), substring(v_body from 1 for 100), 0
      )
      on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
      do update set
        last_message_at = now(),
        last_message_snippet = substring(v_body from 1 for 100),
        updated_at = now()
      returning id into v_conv_id;

      -- Correction 6 & 9: Providerless message queued at awaiting_provider
      insert into crm.messages(
        workspace_id, conversation_id, lead_id, channel, direction, author_membership_id,
        sender_address, recipient_address, subject, text_body,
        status, dispatch_status, template_version_id, campaign_id, queued_at
      ) values (
        p_workspace, v_conv_id, v_rec.lead_id, v_camp.channel, 'outbound', v_camp.created_by_membership_id,
        coalesce(v_account.sender_address, 'system@8020crm.local'), v_rec.destination_normalized,
        v_subject, v_body,
        'queued', 'awaiting_provider', v_tpl_ver.id, p_campaign_id, now()
      ) returning id into v_msg_id;

      insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, details)
      values (p_workspace, v_msg_id, 'queued', 'draft', 'queued', jsonb_build_object('campaign_id', p_campaign_id, 'dispatch_status', 'awaiting_provider'));

      update crm.campaign_recipients
      set status = 'dispatched',
          message_id = v_msg_id,
          updated_at = now()
      where id = v_rec.id;

      v_dispatched_count := v_dispatched_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'campaign_id', p_campaign_id,
    'dispatched', v_dispatched_count,
    'suppressed', v_suppressed_count
  );
end $$;

-- 7. Sequence Enrollment & Exit Evaluation (Corrections 14 & 15)
create or replace function api.enroll_lead_sequence(
  p_workspace uuid,
  p_sequence_id uuid,
  p_lead_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  role text;
  v_seq crm.sequences%rowtype;
  v_ver crm.sequence_versions%rowtype;
  v_enroll_id uuid;
  v_first_step crm.sequence_steps%rowtype;
begin
  actor := private.member_id(p_workspace);
  role := private.member_role(p_workspace);
  if actor is null or role = 'read_only' then
    raise exception using errcode='42501', message='Active member with sequence editing permission required';
  end if;

  select * into v_seq from crm.sequences where workspace_id = p_workspace and id = p_sequence_id;
  if not found or v_seq.current_version_id is null then
    raise exception using errcode='42501', message='Sequence not found or has no published version';
  end if;

  select * into v_ver from crm.sequence_versions where id = v_seq.current_version_id;

  -- Check if already actively enrolled in this sequence version
  select id into v_enroll_id from crm.sequence_enrollments
  where workspace_id = p_workspace and sequence_version_id = v_ver.id and lead_id = p_lead_id and status = 'active';
  if found then
    return jsonb_build_object('enrollment_id', v_enroll_id, 'status', 'already_active');
  end if;

  -- Check authoritative exit signals (Correction 14: Phase 3 meetings and sales outcomes)
  if 'meeting_booked' = any(v_ver.exit_conditions) then
    if exists (select 1 from crm.meetings where workspace_id = p_workspace and lead_id = p_lead_id and booking_state in ('booked', 'confirmed')) then
      return jsonb_build_object('status', 'skipped', 'reason', 'meeting_already_booked');
    end if;
  end if;

  if 'closed_won' = any(v_ver.exit_conditions) then
    if exists (select 1 from crm.deals where workspace_id = p_workspace and lead_id = p_lead_id and status = 'won') then
      return jsonb_build_object('status', 'skipped', 'reason', 'lead_already_won');
    end if;
  end if;

  if 'closed_lost' = any(v_ver.exit_conditions) then
    if exists (select 1 from crm.deals where workspace_id = p_workspace and lead_id = p_lead_id and status = 'lost') then
      return jsonb_build_object('status', 'skipped', 'reason', 'lead_already_lost');
    end if;
  end if;

  insert into crm.sequence_enrollments(
    workspace_id, sequence_version_id, lead_id, status, current_step_number, start_at
  ) values (
    p_workspace, v_ver.id, p_lead_id, 'active', 1, now()
  ) returning id into v_enroll_id;

  -- Schedule Step 1
  select * into v_first_step
  from crm.sequence_steps
  where workspace_id = p_workspace and sequence_version_id = v_ver.id and step_number = 1;

  if found then
    insert into crm.sequence_step_executions(
      workspace_id, enrollment_id, sequence_step_id, status, run_at
    ) values (
      p_workspace, v_enroll_id, v_first_step.id, 'scheduled', now() + (v_first_step.delay_seconds || ' seconds')::interval
    );

    -- Schedule durable job in private.jobs
    insert into private.jobs(workspace_id, type, dedup_key, run_at, payload)
    values (
      p_workspace, 'sequence_step',
      v_enroll_id::text || '-step-1',
      now() + (v_first_step.delay_seconds || ' seconds')::interval,
      jsonb_build_object('enrollment_id', v_enroll_id, 'step_id', v_first_step.id)
    ) on conflict do nothing;
  end if;

  return jsonb_build_object('enrollment_id', v_enroll_id, 'status', 'active');
end $$;

-- 7b. Process Sequence Step Execution (Corrections 10, 11, 15)
create or replace function private.process_sequence_step_execution(
  p_workspace uuid,
  p_execution_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_exec crm.sequence_step_executions%rowtype;
  v_enroll crm.sequence_enrollments%rowtype;
  v_step crm.sequence_steps%rowtype;
  v_tpl_ver crm.message_template_versions%rowtype;
  v_account crm.channel_accounts%rowtype;
  v_lead crm.leads%rowtype;
  v_dest text;
  v_sup jsonb;
  v_msg_id uuid;
  v_conv_id uuid;
  v_body text;
  v_subject text;
begin
  select * into v_exec from crm.sequence_step_executions where workspace_id = p_workspace and id = p_execution_id;
  if not found then return jsonb_build_object('error', 'execution_not_found'); end if;
  if v_exec.status <> 'scheduled' then return jsonb_build_object('status', v_exec.status, 'skipped', true); end if;

  select * into v_enroll from crm.sequence_enrollments where id = v_exec.enrollment_id;

  -- Correction 15: Re-check parent enrollment status. If not active (e.g. exited or paused), do NOT dispatch
  if v_enroll.status <> 'active' then
    update crm.sequence_step_executions
    set status = 'cancelled', skip_reason = 'enrollment_status_' || v_enroll.status
    where id = p_execution_id;
    return jsonb_build_object('status', 'cancelled', 'reason', 'enrollment_not_active');
  end if;

  select * into v_step from crm.sequence_steps where id = v_exec.sequence_step_id;
  select * into v_tpl_ver from crm.message_template_versions where id = v_step.template_version_id;

  -- Resolve destination
  if v_step.channel = 'email' then
    select i.normalized_value into v_dest
    from crm.lead_identities li
    join crm.identities i on i.id = li.identity_id and i.workspace_id = p_workspace and i.kind = 'email'
    where li.workspace_id = p_workspace and li.lead_id = v_enroll.lead_id and li.valid_to is null
    order by li.is_primary desc, li.valid_from asc limit 1;
  else
    select i.normalized_value into v_dest
    from crm.lead_identities li
    join crm.identities i on i.id = li.identity_id and i.workspace_id = p_workspace and i.kind = 'phone'
    where li.workspace_id = p_workspace and li.lead_id = v_enroll.lead_id and li.valid_to is null
    order by li.is_primary desc, li.valid_from asc limit 1;
  end if;

  if v_dest is null then
    update crm.sequence_step_executions
    set status = 'skipped', skip_reason = 'missing_destination'
    where id = p_execution_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'missing_destination');
  end if;

  -- Correction 10 & 11: Just-in-Time Suppression Check immediately before step dispatch
  v_sup := private.is_suppressed(p_workspace, v_enroll.lead_id, v_step.channel, v_dest);
  if (v_sup->>'is_suppressed')::boolean then
    update crm.sequence_step_executions
    set status = 'skipped', skip_reason = 'suppressed_' || (v_sup->>'reason')
    where id = p_execution_id;
    return jsonb_build_object('status', 'skipped', 'reason', 'suppressed');
  end if;

  select * into v_account from crm.channel_accounts
  where workspace_id = p_workspace and channel = v_step.channel and status = 'active'
  order by is_default desc, created_at asc limit 1;

  select * into v_lead from crm.leads where id = v_enroll.lead_id;
  v_body := replace(v_tpl_ver.body, '{{first_name}}', split_part(v_lead.display_name, ' ', 1));
  v_body := replace(v_body, '{{company}}', coalesce(v_lead.company, ''));
  v_subject := replace(coalesce(v_tpl_ver.subject, ''), '{{first_name}}', split_part(v_lead.display_name, ' ', 1));

  insert into crm.conversations(
    workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized,
    last_message_at, last_message_snippet, unread_count
  ) values (
    p_workspace, v_enroll.lead_id, v_step.channel, v_account.id, v_dest,
    now(), substring(v_body from 1 for 100), 0
  )
  on conflict (workspace_id, lead_id, channel, channel_account_id, lead_destination_normalized)
  do update set
    last_message_at = now(),
    last_message_snippet = substring(v_body from 1 for 100),
    updated_at = now()
  returning id into v_conv_id;

  insert into crm.messages(
    workspace_id, conversation_id, lead_id, channel, direction, author_membership_id,
    sender_address, recipient_address, subject, text_body,
    status, dispatch_status, template_version_id, sequence_enrollment_id, queued_at
  ) values (
    p_workspace, v_conv_id, v_enroll.lead_id, v_step.channel, 'outbound', null,
    coalesce(v_account.sender_address, 'system@8020crm.local'), v_dest,
    v_subject, v_body,
    'queued', 'awaiting_provider', v_tpl_ver.id, v_enroll.id, now()
  ) returning id into v_msg_id;

  insert into crm.message_events(workspace_id, message_id, event_type, from_status, to_status, details)
  values (p_workspace, v_msg_id, 'queued', 'draft', 'queued', jsonb_build_object('sequence_enrollment_id', v_enroll.id, 'dispatch_status', 'awaiting_provider'));

  update crm.sequence_step_executions
  set status = 'completed', message_id = v_msg_id, executed_at = now()
  where id = p_execution_id;

  return jsonb_build_object('status', 'completed', 'message_id', v_msg_id);
end $$;

-- 8. List & Query RPCs for Phase 5 UI
create or replace function api.list_conversations(
  p_workspace uuid,
  p_channel text default null,
  p_status text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', c.id,
    'lead_id', c.lead_id,
    'lead_name', l.display_name,
    'lead_company', l.company,
    'channel', c.channel,
    'destination', c.lead_destination_normalized,
    'status', c.status,
    'unread_count', c.unread_count,
    'last_message_at', c.last_message_at,
    'last_message_snippet', c.last_message_snippet,
    'assigned_member_id', c.assigned_membership_id
  )) into v_res
  from crm.conversations c
  join crm.leads l on l.id = c.lead_id and l.workspace_id = p_workspace
  where c.workspace_id = p_workspace
    and (p_channel is null or c.channel = p_channel)
    and (p_status is null or c.status = p_status)
  order by c.last_message_at desc;

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.get_conversation_messages(
  p_workspace uuid,
  p_conversation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  -- Mark conversation read
  update crm.conversations
  set unread_count = 0, updated_at = now()
  where workspace_id = p_workspace and id = p_conversation_id;

  select jsonb_agg(jsonb_build_object(
    'id', m.id,
    'direction', m.direction,
    'channel', m.channel,
    'sender_address', m.sender_address,
    'recipient_address', m.recipient_address,
    'subject', m.subject,
    'text_body', m.text_body,
    'status', m.status,
    'dispatch_status', m.dispatch_status,
    'queued_at', m.queued_at,
    'created_at', m.created_at
  )) into v_res
  from crm.messages m
  where m.workspace_id = p_workspace and m.conversation_id = p_conversation_id
  order by m.created_at asc;

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_inbound_reviews(
  p_workspace uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', r.id,
    'channel', r.channel,
    'sender_address', r.sender_address_normalized,
    'recipient_address', r.recipient_address,
    'subject', r.subject,
    'text_body', r.text_body,
    'occurred_at', r.occurred_at,
    'resolution_state', r.resolution_state,
    'resolution_reason', r.resolution_reason,
    'candidate_lead_ids', r.candidate_lead_ids
  )) into v_res
  from crm.inbound_message_reviews r
  where r.workspace_id = p_workspace and r.resolution_state = 'pending'
  order by r.occurred_at desc;

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_message_templates(
  p_workspace uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'channel', t.channel,
    'status', t.status,
    'current_version', v.version,
    'subject', v.subject,
    'body', v.body,
    'variables_used', v.variables_used,
    'published_at', v.published_at
  )) into v_res
  from crm.message_templates t
  left join crm.message_template_versions v on v.id = t.current_version_id
  where t.workspace_id = p_workspace
  order by t.created_at desc;

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_campaigns(
  p_workspace uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'channel', c.channel,
    'status', c.status,
    'scheduled_at', c.scheduled_at,
    'started_at', c.started_at,
    'completed_at', c.completed_at,
    'recipient_count', (select count(*)::int from crm.campaign_recipients r where r.campaign_id = c.id),
    'eligible_count', (select count(*)::int from crm.campaign_recipients r where r.campaign_id = c.id and r.eligibility_status = 'eligible'),
    'suppressed_count', (select count(*)::int from crm.campaign_recipients r where r.campaign_id = c.id and r.eligibility_status = 'suppressed')
  )) into v_res
  from crm.campaigns c
  where c.workspace_id = p_workspace
  order by c.created_at desc;

  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_sequences(
  p_workspace uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'status', s.status,
    'current_version', v.version,
    'exit_conditions', v.exit_conditions,
    'step_count', (select count(*)::int from crm.sequence_steps ss where ss.sequence_version_id = v.id),
    'active_enrollments', (select count(*)::int from crm.sequence_enrollments se where se.sequence_version_id = v.id and se.status = 'active')
  )) into v_res
  from crm.sequences s
  left join crm.sequence_versions v on v.id = s.current_version_id
  where s.workspace_id = p_workspace
  order by s.created_at desc;

  return coalesce(v_res, '[]'::jsonb);
end $$;

-- Revoke all public executes and grant to authenticated
revoke all on all functions in schema private, api from public;
grant execute on function private.member_id(uuid),private.member_role(uuid),private.can_read_team(uuid,uuid),private.can_read_member(uuid,uuid),private.can_read_lead(uuid,uuid),private.can_work_lead(uuid,uuid),private.is_suppressed(uuid, uuid, text, text) to authenticated;
grant execute on all functions in schema api to authenticated;
grant usage on schema api to anon;
grant select on all tables in schema crm to authenticated;
grant execute on function api.public_submit_form(text, jsonb, text, jsonb, text) to anon, authenticated;
grant execute on function api.start_vsl_session(text, text, uuid) to anon, authenticated;
grant execute on function api.record_vsl_heartbeat(uuid, jsonb) to anon, authenticated;
grant execute on function api.record_vsl_event(uuid, text, integer) to anon, authenticated;

