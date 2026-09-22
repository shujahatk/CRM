-- Phase 2: Identity, Lead Work, Pipeline and Durable Commands
-- Run as migration administrator.
begin;
set local role crm_owner;

create type crm.identity_kind as enum ('email', 'phone', 'provider');
create type crm.lead_status as enum ('active', 'merged', 'archived');
create type crm.stage_category as enum ('open', 'won', 'lost', 'nurture');
create type crm.journey_lifecycle as enum ('active', 'won', 'lost', 'archived');
create type crm.task_priority as enum ('low', 'medium', 'high', 'urgent');
create type crm.task_status as enum ('open', 'completed', 'cancelled');
create type crm.task_action as enum ('created', 'completed', 'reopened', 'cancelled');
create type crm.assignment_strategy as enum ('manual', 'fixed', 'round_robin');
create type crm.assignment_role as enum ('setter', 'closer');
create type crm.conflict_status as enum ('open', 'resolved', 'dismissed');

-- 1. Pipelines, Stages and Lost Reasons
create table crm.pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  is_default boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (workspace_id, id)
);

create table crm.stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  pipeline_id uuid not null,
  stable_code text not null check (stable_code ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(btrim(label)) between 1 and 120),
  category crm.stage_category not null default 'open',
  sort_order int not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, pipeline_id, id),
  unique (workspace_id, pipeline_id, stable_code),
  foreign key (workspace_id, pipeline_id) references crm.pipelines(workspace_id, id)
);

create table crm.stage_transition_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  pipeline_id uuid not null,
  from_stage_id uuid not null,
  to_stage_id uuid not null,
  required_action text,
  allowed_roles crm.member_role[],
  unique (workspace_id, id),
  foreign key (workspace_id, pipeline_id, from_stage_id) references crm.stages(workspace_id, pipeline_id, id),
  foreign key (workspace_id, pipeline_id, to_stage_id) references crm.stages(workspace_id, pipeline_id, id)
);

create table crm.lost_reasons (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  code text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(btrim(label)) between 1 and 120),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, code)
);

-- 2. Leads and Identities
create table crm.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  company text check (company is null or length(btrim(company)) between 1 and 160),
  canonical_lead_id uuid,
  accountable_team_id uuid,
  assigned_setter_id uuid,
  assigned_closer_id uuid,
  status crm.lead_status not null default 'active',
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  unique (workspace_id, id),
  foreign key (workspace_id, canonical_lead_id) references crm.leads(workspace_id, id),
  foreign key (workspace_id, accountable_team_id) references crm.teams(workspace_id, id),
  foreign key (workspace_id, assigned_setter_id) references crm.memberships(workspace_id, id),
  foreign key (workspace_id, assigned_closer_id) references crm.memberships(workspace_id, id),
  foreign key (workspace_id, created_by_membership_id) references crm.memberships(workspace_id, id)
);
create index leads_workspace_team on crm.leads(workspace_id, accountable_team_id);
create index leads_workspace_setter on crm.leads(workspace_id, assigned_setter_id);
create index leads_workspace_closer on crm.leads(workspace_id, assigned_closer_id);

create table crm.identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  kind crm.identity_kind not null,
  normalized_value text not null,
  raw_value_ref text,
  normalization_version int not null default 1,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, kind, normalized_value)
);

create table crm.lead_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  identity_id uuid not null,
  verification_state text not null default 'unverified' check (verification_state in ('unverified', 'verified', 'disputed')),
  is_primary boolean not null default false,
  source text not null default 'manual',
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  unique (workspace_id, id),
  unique (workspace_id, lead_id, identity_id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, identity_id) references crm.identities(workspace_id, id)
);

create table crm.identity_claims (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  identity_id uuid not null,
  lead_id uuid not null,
  claim_basis text not null default 'unambiguous',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, identity_id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id),
  foreign key (workspace_id, identity_id) references crm.identities(workspace_id, id)
);

create table crm.identity_conflicts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  intake_source text not null,
  candidate_lead_ids uuid[] not null,
  conflicting_identities jsonb not null default '[]',
  reason text not null,
  status crm.conflict_status not null default 'open',
  resolution text,
  resolved_by_membership_id uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, resolved_by_membership_id) references crm.memberships(workspace_id, id)
);

create table crm.lead_merges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  source_lead_id uuid not null,
  survivor_lead_id uuid not null,
  reason text not null,
  actor_membership_id uuid not null,
  merged_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, source_lead_id),
  check (source_lead_id <> survivor_lead_id),
  foreign key (workspace_id, source_lead_id) references crm.leads(workspace_id, id),
  foreign key (workspace_id, survivor_lead_id) references crm.leads(workspace_id, id),
  foreign key (workspace_id, actor_membership_id) references crm.memberships(workspace_id, id)
);

-- 3. Tags & Custom Fields
create table crm.tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  name text not null check (length(btrim(name)) between 1 and 60),
  color text not null default '#116c58',
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);
create unique index tags_workspace_name on crm.tags(workspace_id, lower(name));

create table crm.lead_tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  tag_id uuid not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, lead_id, tag_id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, tag_id) references crm.tags(workspace_id, id)
);

create table crm.custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  key text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label text not null check (length(btrim(label)) between 1 and 80),
  data_type text not null check (data_type in ('text', 'number', 'boolean', 'date', 'select')),
  options jsonb not null default '[]',
  version bigint not null default 1,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, key)
);

create table crm.lead_custom_values (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  definition_id uuid not null,
  typed_value jsonb not null default 'null',
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, lead_id, definition_id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, definition_id) references crm.custom_field_definitions(workspace_id, id)
);

-- 4. Assignment System
create table crm.assignment_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  strategy crm.assignment_strategy not null default 'round_robin',
  target_role crm.assignment_role not null default 'setter',
  team_id uuid,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, team_id) references crm.teams(workspace_id, id)
);

create table crm.assignment_rule_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  rule_id uuid not null,
  version int not null default 1,
  candidate_membership_ids uuid[] not null,
  published_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, rule_id, version),
  foreign key (workspace_id, rule_id) references crm.assignment_rules(workspace_id, id)
);

create table crm.assignment_cursors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  rule_version_id uuid not null,
  next_position int not null default 0,
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, rule_version_id),
  foreign key (workspace_id, rule_version_id) references crm.assignment_rule_versions(workspace_id, id)
);

create table crm.assignment_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  assignment_role crm.assignment_role not null,
  old_membership_id uuid,
  new_membership_id uuid not null,
  rule_version_id uuid,
  reason text not null,
  actor_membership_id uuid not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, old_membership_id) references crm.memberships(workspace_id, id),
  foreign key (workspace_id, new_membership_id) references crm.memberships(workspace_id, id),
  foreign key (workspace_id, actor_membership_id) references crm.memberships(workspace_id, id)
);

-- 5. Lead Journeys & Transitions
create table crm.lead_journeys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  pipeline_id uuid not null,
  stage_id uuid not null,
  lifecycle crm.journey_lifecycle not null default 'active',
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  lost_reason_id uuid,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, pipeline_id) references crm.pipelines(workspace_id, id),
  foreign key (workspace_id, pipeline_id, stage_id) references crm.stages(workspace_id, pipeline_id, id),
  foreign key (workspace_id, lost_reason_id) references crm.lost_reasons(workspace_id, id)
);
create unique index lead_active_journey on crm.lead_journeys(workspace_id, lead_id) where lifecycle = 'active';

create table crm.journey_transitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  journey_id uuid not null,
  from_stage_id uuid,
  to_stage_id uuid not null,
  actor_membership_id uuid not null,
  reason text,
  transitioned_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, journey_id) references crm.lead_journeys(workspace_id, id) on delete cascade,
  foreign key (workspace_id, from_stage_id) references crm.stages(workspace_id, id),
  foreign key (workspace_id, to_stage_id) references crm.stages(workspace_id, id),
  foreign key (workspace_id, actor_membership_id) references crm.memberships(workspace_id, id)
);

-- 6. Notes & Revisions
create table crm.notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  author_membership_id uuid not null,
  pinned boolean not null default false,
  important boolean not null default false,
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, author_membership_id) references crm.memberships(workspace_id, id)
);

create table crm.note_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  note_id uuid not null,
  revision_number int not null default 1,
  body text not null check (length(btrim(body)) between 1 and 20000),
  editor_membership_id uuid not null,
  edited_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, note_id, revision_number),
  foreign key (workspace_id, note_id) references crm.notes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, editor_membership_id) references crm.memberships(workspace_id, id)
);

create table crm.important_markers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  note_id uuid,
  author_membership_id uuid not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, note_id) references crm.notes(workspace_id, id) on delete cascade,
  foreign key (workspace_id, author_membership_id) references crm.memberships(workspace_id, id)
);

-- 7. Tasks & Next-Action Projection
create table crm.tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  journey_id uuid,
  assignee_membership_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 240),
  due_at timestamptz not null,
  timezone text not null default 'UTC',
  priority crm.task_priority not null default 'medium',
  status crm.task_status not null default 'open',
  completed_at timestamptz,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, journey_id) references crm.lead_journeys(workspace_id, id),
  foreign key (workspace_id, assignee_membership_id) references crm.memberships(workspace_id, id),
  foreign key (workspace_id, created_by_membership_id) references crm.memberships(workspace_id, id)
);
create index tasks_workspace_status_due on crm.tasks(workspace_id, status, due_at);

create table crm.task_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  task_id uuid not null,
  action crm.task_action not null,
  actor_membership_id uuid not null,
  occurred_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, task_id) references crm.tasks(workspace_id, id) on delete cascade,
  foreign key (workspace_id, actor_membership_id) references crm.memberships(workspace_id, id)
);

create table crm.next_action_projection (
  lead_id uuid not null,
  workspace_id uuid not null,
  task_id uuid,
  due_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, lead_id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, task_id) references crm.tasks(workspace_id, id) on delete set null
);

-- 8. Immutable Activities & Credits
create table crm.activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid,
  journey_id uuid,
  aggregate_type text not null,
  aggregate_id uuid not null,
  aggregate_version bigint not null default 1,
  event_type text not null,
  actor_membership_id uuid,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  correlation_id uuid not null default gen_random_uuid(),
  causation_id uuid,
  source text not null default 'app',
  payload jsonb not null default '{}' check (jsonb_typeof(payload)='object' and octet_length(payload::text)<16384),
  unique (workspace_id, id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id) on delete cascade,
  foreign key (workspace_id, journey_id) references crm.lead_journeys(workspace_id, id) on delete set null,
  foreign key (workspace_id, actor_membership_id) references crm.memberships(workspace_id, id)
);
create index activities_lead_time on crm.activities(workspace_id, lead_id, occurred_at desc, id desc);

create table crm.activity_credits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  activity_id uuid not null,
  membership_id uuid not null,
  role text not null check (role in ('setter', 'closer', 'actor')),
  weight numeric not null default 1.0,
  unique (workspace_id, id),
  unique (workspace_id, activity_id, membership_id, role),
  foreign key (workspace_id, activity_id) references crm.activities(workspace_id, id) on delete cascade,
  foreign key (workspace_id, membership_id) references crm.memberships(workspace_id, id)
);

-- 9. Private Command Receipts, Outbox, Jobs and Intake
create table private.command_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  actor_membership_id uuid not null,
  command_key text not null,
  request_hash text not null,
  status text not null default 'completed',
  result jsonb not null default '{}',
  executed_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, actor_membership_id, command_key),
  foreign key (workspace_id, actor_membership_id) references crm.memberships(workspace_id, id)
);

create table private.outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  activity_id uuid not null references crm.activities(id) on delete cascade,
  destination text not null,
  payload jsonb not null default '{}',
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table private.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  type text not null,
  dedup_key text not null,
  payload jsonb not null default '{}',
  run_at timestamptz not null default now(),
  priority int not null default 0,
  state text not null default 'pending' check (state in ('pending','running','completed','failed')),
  attempt_count int not null default 0,
  max_attempts int not null default 5,
  lease_owner text,
  lease_until timestamptz,
  fence bigint not null default 0,
  last_error_code text,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, type, dedup_key)
);

create table private.intake_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  source text not null,
  connection_id text,
  source_key text not null,
  payload_ref jsonb not null default '{}',
  resolved_lead_id uuid,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'conflict', 'failed')),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, source, source_key)
);

-- 10. Immutability Triggers
create function private.reject_activity_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501', message='Activity records are append-only'; end $$;
create trigger immutable_activities before update or delete on crm.activities for each row execute function private.reject_activity_mutation();

create function private.reject_transition_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501', message='Journey transitions are append-only'; end $$;
create trigger immutable_transitions before update or delete on crm.journey_transitions for each row execute function private.reject_transition_mutation();

create function private.reject_assignment_history_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501', message='Assignment history is append-only'; end $$;
create trigger immutable_assignment_history before update or delete on crm.assignment_history for each row execute function private.reject_assignment_history_mutation();

create function private.reject_note_revision_mutation() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501', message='Note revisions are append-only'; end $$;
create trigger immutable_note_revisions before update or delete on crm.note_revisions for each row execute function private.reject_note_revision_mutation();

-- 11. Security Definer Helper Functions
create function private.can_read_lead(w uuid, l uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.member_id(w) is not null and (
    private.member_role(w) = 'admin' or
    (private.member_role(w) = 'manager' and exists (
      select 1 from crm.leads ld where ld.workspace_id=w and ld.id=l and (
        ld.accountable_team_id is null or exists (
          select 1 from crm.team_memberships tm where tm.workspace_id=w and tm.membership_id=private.member_id(w) and tm.is_manager and tm.team_id=ld.accountable_team_id
        )
      )
    )) or
    (private.member_role(w) in ('setter', 'closer') and (
      exists (
        select 1 from crm.leads ld where ld.workspace_id=w and ld.id=l and (
          (private.member_role(w) = 'setter' and ld.assigned_setter_id = private.member_id(w)) or
          (private.member_role(w) = 'closer' and ld.assigned_closer_id = private.member_id(w))
        )
      )
    )) or
    (private.member_role(w) = 'read_only' and exists (
      select 1 from crm.report_scope_grants rsg where rsg.workspace_id=w and rsg.membership_id=private.member_id(w) and (rsg.expires_at is null or rsg.expires_at > now())
    ))
  )
$$;

create function private.can_work_lead(w uuid, l uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.member_id(w) is not null and private.member_role(w) <> 'read_only' and (
    private.member_role(w) = 'admin' or
    (private.member_role(w) = 'manager' and exists (
      select 1 from crm.leads ld where ld.workspace_id=w and ld.id=l and (
        ld.accountable_team_id is null or exists (
          select 1 from crm.team_memberships tm where tm.workspace_id=w and tm.membership_id=private.member_id(w) and tm.is_manager and tm.team_id=ld.accountable_team_id
        )
      )
    )) or
    (private.member_role(w) in ('setter', 'closer') and exists (
      select 1 from crm.leads ld where ld.workspace_id=w and ld.id=l and (
        (private.member_role(w) = 'setter' and ld.assigned_setter_id = private.member_id(w)) or
        (private.member_role(w) = 'closer' and ld.assigned_closer_id = private.member_id(w))
      )
    ))
  )
$$;

-- 12. Enable RLS on All Tables
alter table crm.pipelines enable row level security;
alter table crm.stages enable row level security;
alter table crm.stage_transition_rules enable row level security;
alter table crm.lost_reasons enable row level security;
alter table crm.leads enable row level security;
alter table crm.identities enable row level security;
alter table crm.lead_identities enable row level security;
alter table crm.identity_claims enable row level security;
alter table crm.identity_conflicts enable row level security;
alter table crm.lead_merges enable row level security;
alter table crm.tags enable row level security;
alter table crm.lead_tags enable row level security;
alter table crm.custom_field_definitions enable row level security;
alter table crm.lead_custom_values enable row level security;
alter table crm.assignment_rules enable row level security;
alter table crm.assignment_rule_versions enable row level security;
alter table crm.assignment_cursors enable row level security;
alter table crm.assignment_history enable row level security;
alter table crm.lead_journeys enable row level security;
alter table crm.journey_transitions enable row level security;
alter table crm.notes enable row level security;
alter table crm.note_revisions enable row level security;
alter table crm.important_markers enable row level security;
alter table crm.tasks enable row level security;
alter table crm.task_events enable row level security;
alter table crm.next_action_projection enable row level security;
alter table crm.activities enable row level security;
alter table crm.activity_credits enable row level security;
alter table private.command_receipts enable row level security;
alter table private.outbox_events enable row level security;
alter table private.jobs enable row level security;
alter table private.intake_records enable row level security;

-- Configuration RLS: all active workspace members can read
create policy pipelines_read on crm.pipelines for select to authenticated using (private.member_id(workspace_id) is not null);
create policy stages_read on crm.stages for select to authenticated using (private.member_id(workspace_id) is not null);
create policy stage_rules_read on crm.stage_transition_rules for select to authenticated using (private.member_id(workspace_id) is not null);
create policy lost_reasons_read on crm.lost_reasons for select to authenticated using (private.member_id(workspace_id) is not null);
create policy tags_read on crm.tags for select to authenticated using (private.member_id(workspace_id) is not null);
create policy custom_field_defs_read on crm.custom_field_definitions for select to authenticated using (private.member_id(workspace_id) is not null);
create policy assignment_rules_read on crm.assignment_rules for select to authenticated using (private.member_id(workspace_id) is not null);
create policy assignment_rule_versions_read on crm.assignment_rule_versions for select to authenticated using (private.member_id(workspace_id) is not null);

-- Lead & Child Entity RLS: scoped by can_read_lead
create policy leads_read on crm.leads for select to authenticated using (private.can_read_lead(workspace_id, id));
create policy identities_read on crm.identities for select to authenticated using (private.member_id(workspace_id) is not null);
create policy lead_identities_read on crm.lead_identities for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy identity_claims_read on crm.identity_claims for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy identity_conflicts_read on crm.identity_conflicts for select to authenticated using (private.member_id(workspace_id) is not null and private.member_role(workspace_id) in ('admin', 'manager'));
create policy lead_merges_read on crm.lead_merges for select to authenticated using (private.can_read_lead(workspace_id, survivor_lead_id));
create policy lead_tags_read on crm.lead_tags for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy lead_custom_values_read on crm.lead_custom_values for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy assignment_history_read on crm.assignment_history for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy lead_journeys_read on crm.lead_journeys for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy journey_transitions_read on crm.journey_transitions for select to authenticated using (
  exists (select 1 from crm.lead_journeys j where j.id = journey_id and private.can_read_lead(workspace_id, j.lead_id))
);
create policy notes_read on crm.notes for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy note_revisions_read on crm.note_revisions for select to authenticated using (
  exists (select 1 from crm.notes n where n.id = note_id and private.can_read_lead(workspace_id, n.lead_id))
);
create policy important_markers_read on crm.important_markers for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy tasks_read on crm.tasks for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy task_events_read on crm.task_events for select to authenticated using (
  exists (select 1 from crm.tasks t where t.id = task_id and private.can_read_lead(workspace_id, t.lead_id))
);
create policy next_action_projection_read on crm.next_action_projection for select to authenticated using (private.can_read_lead(workspace_id, lead_id));
create policy activities_read on crm.activities for select to authenticated using (
  lead_id is null or private.can_read_lead(workspace_id, lead_id)
);
create policy activity_credits_read on crm.activity_credits for select to authenticated using (private.member_id(workspace_id) is not null);

grant select on all tables in schema crm to authenticated;

-- 13. Seed Default Pipeline, Stages and Lost Reasons Function
create function private.ensure_default_pipeline(w uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
  select id into pid from crm.pipelines where workspace_id = w and is_default limit 1;
  if pid is not null then return pid; end if;

  insert into crm.pipelines(workspace_id, name, is_default)
  values (w, 'Standard Sales Pipeline', true) returning id into pid;

  insert into crm.stages(workspace_id, pipeline_id, stable_code, label, category, sort_order) values
  (w, pid, 'new_lead', 'New Lead', 'open', 1),
  (w, pid, 'contacted', 'Contacted', 'open', 2),
  (w, pid, 'call_1', 'Call 1', 'open', 3),
  (w, pid, 'call_2', 'Call 2', 'open', 4),
  (w, pid, 'call_3', 'Call 3', 'open', 5),
  (w, pid, 'call_4', 'Call 4', 'open', 6),
  (w, pid, 'nurture', 'Nurture', 'nurture', 7),
  (w, pid, 'meeting_booked', 'Meeting Booked', 'open', 8),
  (w, pid, 'confirmed', 'Confirmed', 'open', 9),
  (w, pid, 'showed', 'Showed', 'open', 10),
  (w, pid, 'follow_up_decision', 'Follow-Up / Decision', 'open', 11),
  (w, pid, 'closed_won', 'Closed Won', 'won', 12),
  (w, pid, 'closed_lost', 'Closed Lost', 'lost', 13);

  insert into crm.lost_reasons(workspace_id, code, label) values
  (w, 'price', 'Price / Budget'),
  (w, 'timing', 'Bad Timing / Postponed'),
  (w, 'unresponsive', 'Unresponsive / Ghosted'),
  (w, 'not_qualified', 'Not Qualified'),
  (w, 'competitor', 'Chose Competitor'),
  (w, 'other', 'Other')
  on conflict (workspace_id, code) do nothing;

  return pid;
end $$;

do $$
declare w record;
begin
  for w in select id from crm.workspaces loop
    perform private.ensure_default_pipeline(w.id);
  end loop;
end $$;

-- 14. Next Action Refresh Trigger / Function
create function private.refresh_next_action(w uuid, l uuid) returns void language plpgsql security definer set search_path='' as $$
declare earliest record;
begin
  select id, due_at into earliest from crm.tasks
  where workspace_id=w and lead_id=l and status='open'
  order by due_at asc, id asc limit 1;

  if earliest.id is not null then
    insert into crm.next_action_projection(workspace_id, lead_id, task_id, due_at, updated_at)
    values (w, l, earliest.id, earliest.due_at, now())
    on conflict (workspace_id, lead_id) do update
    set task_id=excluded.task_id, due_at=excluded.due_at, updated_at=now();
  else
    delete from crm.next_action_projection where workspace_id=w and lead_id=l;
  end if;
end $$;

-- 15. Exposed API Functions
create function api.create_lead(
  p_workspace uuid,
  p_name text,
  p_email text default null,
  p_phone text default null,
  p_company text default null,
  p_command_key text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  norm_email text;
  norm_phone text;
  email_identity uuid;
  phone_identity uuid;
  lead_by_email uuid;
  lead_by_phone uuid;
  new_lead_id uuid;
  default_pipeline uuid;
  first_stage uuid;
  receipt_id uuid;
begin
  actor := private.member_id(p_workspace);
  if actor is null or private.member_role(p_workspace) = 'read_only' then
    raise exception using errcode='42501', message='Authorized membership required';
  end if;

  if p_command_key is not null then
    select (result->>'lead_id')::uuid into new_lead_id
    from private.command_receipts
    where workspace_id=p_workspace and actor_membership_id=actor and command_key=p_command_key;
    if new_lead_id is not null then return new_lead_id; end if;
  end if;

  if p_name is null or length(btrim(p_name)) < 1 or length(btrim(p_name)) > 160 then
    raise exception using errcode='22023', message='Valid lead name required';
  end if;

  -- Email normalization
  if p_email is not null and length(btrim(p_email)) > 0 then
    norm_email := lower(btrim(p_email));
    if norm_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(norm_email) > 254 then
      raise exception using errcode='22023', message='Invalid email format';
    end if;
  end if;

  -- Phone normalization: strip whitespace, dashes, parentheses; validate E.164 if international + prefix
  if p_phone is not null and length(btrim(p_phone)) > 0 then
    norm_phone := regexp_replace(btrim(p_phone), '[[:space:]\-\(\)\.]+', '', 'g');
    if length(norm_phone) < 7 or length(norm_phone) > 20 then
      raise exception using errcode='22023', message='Invalid phone format';
    end if;
  end if;

  -- Identity match checks: look up existing claims
  if norm_email is not null then
    select ic.lead_id into lead_by_email
    from crm.identities i
    join crm.identity_claims ic on ic.identity_id = i.id and ic.active
    where i.workspace_id = p_workspace and i.kind = 'email' and i.normalized_value = norm_email;
  end if;

  if norm_phone is not null then
    select ic.lead_id into lead_by_phone
    from crm.identities i
    join crm.identity_claims ic on ic.identity_id = i.id and ic.active
    where i.workspace_id = p_workspace and i.kind = 'phone' and i.normalized_value = norm_phone;
  end if;

  -- Conflict detection: do NOT silently merge
  if lead_by_email is not null and lead_by_phone is not null and lead_by_email <> lead_by_phone then
    insert into crm.identity_conflicts(workspace_id, intake_source, candidate_lead_ids, conflicting_identities, reason)
    values (p_workspace, 'manual_create', array[lead_by_email, lead_by_phone],
      jsonb_build_array(jsonb_build_object('kind', 'email', 'value', norm_email), jsonb_build_object('kind', 'phone', 'value', norm_phone)),
      'Email and phone resolve to distinct existing leads');
    raise exception using errcode='40001', message='Identity conflict: email and phone belong to distinct leads';
  end if;

  if (lead_by_email is not null and lead_by_phone is null and norm_phone is not null) or
     (lead_by_phone is not null and lead_by_email is null and norm_email is not null) then
    declare matched_lead uuid := coalesce(lead_by_email, lead_by_phone);
    begin
      insert into crm.identity_conflicts(workspace_id, intake_source, candidate_lead_ids, conflicting_identities, reason)
      values (p_workspace, 'manual_create', array[matched_lead],
        jsonb_build_array(jsonb_build_object('kind', 'email', 'value', norm_email), jsonb_build_object('kind', 'phone', 'value', norm_phone)),
        'New identity conflicts with unassociated attribute on existing lead');
      raise exception using errcode='40001', message='Identity conflict: partial match requires manual review';
    end;
  end if;

  if lead_by_email is not null then
    raise exception using errcode='40001', message='A lead with this email address already exists';
  end if;

  if lead_by_phone is not null then
    raise exception using errcode='40001', message='A lead with this phone number already exists';
  end if;

  -- Create new lead
  insert into crm.leads(workspace_id, display_name, company, created_by_membership_id)
  values (p_workspace, btrim(p_name), case when p_company is not null and length(btrim(p_company)) > 0 then btrim(p_company) else null end, actor)
  returning id into new_lead_id;

  -- Create email identity if provided
  if norm_email is not null then
    insert into crm.identities(workspace_id, kind, normalized_value, raw_value_ref)
    values (p_workspace, 'email', norm_email, btrim(p_email))
    on conflict (workspace_id, kind, normalized_value) do update set raw_value_ref = excluded.raw_value_ref
    returning id into email_identity;

    insert into crm.lead_identities(workspace_id, lead_id, identity_id, is_primary)
    values (p_workspace, new_lead_id, email_identity, true);

    insert into crm.identity_claims(workspace_id, identity_id, lead_id)
    values (p_workspace, email_identity, new_lead_id);
  end if;

  -- Create phone identity if provided
  if norm_phone is not null then
    insert into crm.identities(workspace_id, kind, normalized_value, raw_value_ref)
    values (p_workspace, 'phone', norm_phone, btrim(p_phone))
    on conflict (workspace_id, kind, normalized_value) do update set raw_value_ref = excluded.raw_value_ref
    returning id into phone_identity;

    insert into crm.lead_identities(workspace_id, lead_id, identity_id, is_primary)
    values (p_workspace, new_lead_id, phone_identity, true);

    insert into crm.identity_claims(workspace_id, identity_id, lead_id)
    values (p_workspace, phone_identity, new_lead_id);
  end if;

  -- Initialize journey in default pipeline at 'new_lead' stage
  default_pipeline := private.ensure_default_pipeline(p_workspace);
  select id into first_stage from crm.stages where workspace_id = p_workspace and pipeline_id = default_pipeline and stable_code = 'new_lead' limit 1;
  if first_stage is not null then
    insert into crm.lead_journeys(workspace_id, lead_id, pipeline_id, stage_id, lifecycle)
    values (p_workspace, new_lead_id, default_pipeline, first_stage, 'active');
  end if;

  -- Record activity
  insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, event_type, actor_membership_id, payload)
  values (p_workspace, new_lead_id, 'lead', new_lead_id, 'lead.created', actor,
    jsonb_build_object('name', btrim(p_name), 'email', norm_email, 'phone', norm_phone, 'company', p_company));

  -- Record command receipt if key provided
  if p_command_key is not null then
    insert into private.command_receipts(workspace_id, actor_membership_id, command_key, request_hash, result)
    values (p_workspace, actor, p_command_key, md5(p_name || coalesce(norm_email, '') || coalesce(norm_phone, '')), jsonb_build_object('lead_id', new_lead_id));
  end if;

  return new_lead_id;
end $$;

create function api.record_identity_conflict(
  p_workspace uuid,
  p_source text,
  p_candidate_lead_ids uuid[],
  p_conflicting_identities jsonb,
  p_reason text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  cid uuid;
begin
  actor := private.member_id(p_workspace);
  if actor is null or private.member_role(p_workspace) = 'read_only' then
    raise exception using errcode='42501', message='Authorized membership required';
  end if;

  insert into crm.identity_conflicts(workspace_id, intake_source, candidate_lead_ids, conflicting_identities, reason)
  values (p_workspace, coalesce(p_source, 'manual'), p_candidate_lead_ids, p_conflicting_identities, p_reason)
  returning id into cid;

  return cid;
end $$;


create function api.update_lead(
  p_workspace uuid,
  p_lead uuid,
  p_display_name text,
  p_company text,
  p_version bigint
) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; cur crm.leads;
begin
  actor := private.member_id(p_workspace);
  if not private.can_work_lead(p_workspace, p_lead) then
    raise exception using errcode='42501', message='Permission denied to work on lead';
  end if;

  select * into cur from crm.leads where workspace_id=p_workspace and id=p_lead for update;
  if not found then raise exception using errcode='42501', message='Lead not found'; end if;
  if cur.version <> p_version then raise exception using errcode='40001', message='Lead changed concurrently'; end if;

  update crm.leads
  set display_name = btrim(p_display_name),
      company = case when p_company is not null and length(btrim(p_company)) > 0 then btrim(p_company) else null end,
      version = version + 1,
      updated_at = now()
  where workspace_id=p_workspace and id=p_lead;

  insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, aggregate_version, event_type, actor_membership_id, payload)
  values (p_workspace, p_lead, 'lead', p_lead, cur.version + 1, 'lead.updated', actor,
    jsonb_build_object('display_name', p_display_name, 'company', p_company));
end $$;

create function api.assign_lead(
  p_workspace uuid,
  p_lead uuid,
  p_setter uuid default null,
  p_closer uuid default null,
  p_team uuid default null,
  p_reason text default 'manual assignment',
  p_version bigint default 1
) returns void language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  cur crm.leads;
begin
  actor := private.member_id(p_workspace);
  if actor is null or private.member_role(p_workspace) not in ('admin', 'manager') then
    raise exception using errcode='42501', message='Administrator or manager role required for lead assignment';
  end if;

  select * into cur from crm.leads where workspace_id=p_workspace and id=p_lead for update;
  if not found then raise exception using errcode='42501', message='Lead not found'; end if;
  if cur.version <> p_version then raise exception using errcode='40001', message='Lead changed concurrently'; end if;

  if p_setter is not null and not exists (
    select 1 from crm.memberships where workspace_id=p_workspace and id=p_setter and status='active' and role in ('setter', 'admin', 'manager')
  ) then raise exception using errcode='42501', message='Eligible active setter required'; end if;

  if p_closer is not null and not exists (
    select 1 from crm.memberships where workspace_id=p_workspace and id=p_closer and status='active' and role in ('closer', 'admin', 'manager')
  ) then raise exception using errcode='42501', message='Eligible active closer required'; end if;

  if p_team is not null and not exists (
    select 1 from crm.teams where workspace_id=p_workspace and id=p_team and status='active'
  ) then raise exception using errcode='42501', message='Active team required'; end if;

  update crm.leads
  set assigned_setter_id = coalesce(p_setter, assigned_setter_id),
      assigned_closer_id = coalesce(p_closer, assigned_closer_id),
      accountable_team_id = coalesce(p_team, accountable_team_id),
      version = version + 1,
      updated_at = now()
  where workspace_id=p_workspace and id=p_lead;

  if p_setter is not null and p_setter is distinct from cur.assigned_setter_id then
    insert into crm.assignment_history(workspace_id, lead_id, assignment_role, old_membership_id, new_membership_id, reason, actor_membership_id)
    values (p_workspace, p_lead, 'setter', cur.assigned_setter_id, p_setter, p_reason, actor);

    insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, aggregate_version, event_type, actor_membership_id, payload)
    values (p_workspace, p_lead, 'lead', p_lead, cur.version + 1, 'lead.assigned', actor,
      jsonb_build_object('role', 'setter', 'from', cur.assigned_setter_id, 'to', p_setter, 'reason', p_reason));
  end if;

  if p_closer is not null and p_closer is distinct from cur.assigned_closer_id then
    insert into crm.assignment_history(workspace_id, lead_id, assignment_role, old_membership_id, new_membership_id, reason, actor_membership_id)
    values (p_workspace, p_lead, 'closer', cur.assigned_closer_id, p_closer, p_reason, actor);

    insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, aggregate_version, event_type, actor_membership_id, payload)
    values (p_workspace, p_lead, 'lead', p_lead, cur.version + 1, 'lead.assigned', actor,
      jsonb_build_object('role', 'closer', 'from', cur.assigned_closer_id, 'to', p_closer, 'reason', p_reason));
  end if;
end $$;

create function api.transition_stage(
  p_workspace uuid,
  p_lead uuid,
  p_to_stage_code text,
  p_lost_reason_id uuid default null,
  p_expected_stage_code text default null,
  p_version bigint default null,
  p_command_key text default null
) returns void language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  j crm.lead_journeys;
  cur_stage crm.stages;
  target_stage crm.stages;
begin
  actor := private.member_id(p_workspace);
  if not private.can_work_lead(p_workspace, p_lead) then
    raise exception using errcode='42501', message='Permission denied to transition lead stage';
  end if;

  if p_command_key is not null and exists (
    select 1 from private.command_receipts
    where workspace_id=p_workspace and actor_membership_id=actor and command_key=p_command_key
  ) then return; end if;

  select * into j from crm.lead_journeys
  where workspace_id=p_workspace and lead_id=p_lead and lifecycle='active' for update;
  if not found then raise exception using errcode='42501', message='No active journey found for lead'; end if;

  if p_version is not null and j.version <> p_version then
    raise exception using errcode='40001', message='Journey changed concurrently';
  end if;

  select * into cur_stage from crm.stages where workspace_id=p_workspace and id=j.stage_id;
  if p_expected_stage_code is not null and cur_stage.stable_code <> p_expected_stage_code then
    raise exception using errcode='40001', message='Stage changed concurrently';
  end if;

  select * into target_stage from crm.stages
  where workspace_id=p_workspace and pipeline_id=j.pipeline_id and stable_code=p_to_stage_code;
  if not found then raise exception using errcode='42501', message='Target stage unavailable in pipeline'; end if;

  if target_stage.stable_code = 'closed_lost' and p_lost_reason_id is null then
    raise exception using errcode='22023', message='Lost reason required when moving to Closed Lost';
  end if;

  update crm.lead_journeys
  set stage_id = target_stage.id,
      lifecycle = case when target_stage.category in ('won', 'lost') then target_stage.category::text::crm.journey_lifecycle else 'active' end,
      closed_at = case when target_stage.category in ('won', 'lost') then now() else null end,
      lost_reason_id = case when target_stage.category = 'lost' then p_lost_reason_id else null end,
      version = version + 1,
      updated_at = now()
  where id=j.id;

  insert into crm.journey_transitions(workspace_id, journey_id, from_stage_id, to_stage_id, actor_membership_id)
  values (p_workspace, j.id, cur_stage.id, target_stage.id, actor);

  insert into crm.activities(workspace_id, lead_id, journey_id, aggregate_type, aggregate_id, aggregate_version, event_type, actor_membership_id, payload)
  values (p_workspace, p_lead, j.id, 'journey', j.id, j.version + 1, 'stage.transitioned', actor,
    jsonb_build_object('from_stage', cur_stage.stable_code, 'to_stage', target_stage.stable_code, 'category', target_stage.category));

  if p_command_key is not null then
    insert into private.command_receipts(workspace_id, actor_membership_id, command_key, request_hash, result)
    values (p_workspace, actor, p_command_key, md5(j.id::text || target_stage.stable_code), jsonb_build_object('success', true));
  end if;
end $$;

create function api.create_note(
  p_workspace uuid,
  p_lead uuid,
  p_body text,
  p_pinned boolean default false,
  p_important boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; note_id uuid;
begin
  actor := private.member_id(p_workspace);
  if not private.can_work_lead(p_workspace, p_lead) then
    raise exception using errcode='42501', message='Permission denied to add note';
  end if;

  if p_body is null or length(btrim(p_body)) < 1 or length(btrim(p_body)) > 20000 then
    raise exception using errcode='22023', message='Valid note body required';
  end if;

  insert into crm.notes(workspace_id, lead_id, author_membership_id, pinned, important)
  values (p_workspace, p_lead, actor, p_pinned, p_important)
  returning id into note_id;

  insert into crm.note_revisions(workspace_id, note_id, revision_number, body, editor_membership_id)
  values (p_workspace, note_id, 1, btrim(p_body), actor);

  if p_important then
    insert into crm.important_markers(workspace_id, lead_id, note_id, author_membership_id, reason)
    values (p_workspace, p_lead, note_id, actor, 'Marked important by author');
  end if;

  insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, event_type, actor_membership_id, payload)
  values (p_workspace, p_lead, 'note', note_id, 'note.created', actor,
    jsonb_build_object('pinned', p_pinned, 'important', p_important));

  return note_id;
end $$;

create function api.edit_note(
  p_workspace uuid,
  p_note uuid,
  p_body text
) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; n crm.notes; next_rev int;
begin
  actor := private.member_id(p_workspace);
  select * into n from crm.notes where workspace_id=p_workspace and id=p_note;
  if not found then raise exception using errcode='42501', message='Note not found'; end if;

  if actor <> n.author_membership_id and private.member_role(p_workspace) <> 'admin' then
    raise exception using errcode='42501', message='Only author or administrator can edit note';
  end if;

  if p_body is null or length(btrim(p_body)) < 1 or length(btrim(p_body)) > 20000 then
    raise exception using errcode='22023', message='Valid note body required';
  end if;

  select coalesce(max(revision_number), 0) + 1 into next_rev from crm.note_revisions where workspace_id=p_workspace and note_id=p_note;

  insert into crm.note_revisions(workspace_id, note_id, revision_number, body, editor_membership_id)
  values (p_workspace, p_note, next_rev, btrim(p_body), actor);

  update crm.notes set updated_at = now() where id = p_note;

  insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, aggregate_version, event_type, actor_membership_id, payload)
  values (p_workspace, n.lead_id, 'note', p_note, next_rev, 'note.edited', actor,
    jsonb_build_object('revision', next_rev));
end $$;

create function api.create_task(
  p_workspace uuid,
  p_lead uuid,
  p_assignee uuid,
  p_title text,
  p_due_at timestamptz,
  p_priority crm.task_priority default 'medium'
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; task_id uuid; jid uuid;
begin
  actor := private.member_id(p_workspace);
  if not private.can_work_lead(p_workspace, p_lead) then
    raise exception using errcode='42501', message='Permission denied to create task';
  end if;

  if p_title is null or length(btrim(p_title)) < 1 or length(btrim(p_title)) > 240 then
    raise exception using errcode='22023', message='Valid task title required';
  end if;

  if p_due_at is null then
    raise exception using errcode='22023', message='Due date required';
  end if;

  if not exists (select 1 from crm.memberships where workspace_id=p_workspace and id=p_assignee and status='active') then
    raise exception using errcode='42501', message='Active assignee required';
  end if;

  select id into jid from crm.lead_journeys where workspace_id=p_workspace and lead_id=p_lead and lifecycle='active' limit 1;

  insert into crm.tasks(workspace_id, lead_id, journey_id, assignee_membership_id, title, due_at, priority, created_by_membership_id)
  values (p_workspace, p_lead, jid, p_assignee, btrim(p_title), p_due_at, p_priority, actor)
  returning id into task_id;

  insert into crm.task_events(workspace_id, task_id, action, actor_membership_id)
  values (p_workspace, task_id, 'created', actor);

  perform private.refresh_next_action(p_workspace, p_lead);

  insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, event_type, actor_membership_id, payload)
  values (p_workspace, p_lead, 'task', task_id, 'task.created', actor,
    jsonb_build_object('title', p_title, 'due_at', p_due_at, 'priority', p_priority, 'assignee', p_assignee));

  return task_id;
end $$;

create function api.complete_task(
  p_workspace uuid,
  p_task uuid
) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; t crm.tasks;
begin
  actor := private.member_id(p_workspace);
  select * into t from crm.tasks where workspace_id=p_workspace and id=p_task for update;
  if not found then raise exception using errcode='42501', message='Task not found'; end if;

  if not private.can_work_lead(p_workspace, t.lead_id) then
    raise exception using errcode='42501', message='Permission denied to complete task';
  end if;

  update crm.tasks set status = 'completed', completed_at = now(), updated_at = now() where id = p_task;

  insert into crm.task_events(workspace_id, task_id, action, actor_membership_id)
  values (p_workspace, p_task, 'completed', actor);

  perform private.refresh_next_action(p_workspace, t.lead_id);

  insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, event_type, actor_membership_id, payload)
  values (p_workspace, t.lead_id, 'task', p_task, 'task.completed', actor, jsonb_build_object('task_id', p_task));
end $$;

create function api.reopen_task(
  p_workspace uuid,
  p_task uuid
) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; t crm.tasks;
begin
  actor := private.member_id(p_workspace);
  select * into t from crm.tasks where workspace_id=p_workspace and id=p_task for update;
  if not found then raise exception using errcode='42501', message='Task not found'; end if;

  if not private.can_work_lead(p_workspace, t.lead_id) then
    raise exception using errcode='42501', message='Permission denied to reopen task';
  end if;

  update crm.tasks set status = 'open', completed_at = null, updated_at = now() where id = p_task;

  insert into crm.task_events(workspace_id, task_id, action, actor_membership_id)
  values (p_workspace, p_task, 'reopened', actor);

  perform private.refresh_next_action(p_workspace, t.lead_id);

  insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, event_type, actor_membership_id, payload)
  values (p_workspace, t.lead_id, 'task', p_task, 'task.reopened', actor, jsonb_build_object('task_id', p_task));
end $$;

-- 16. Reporting & Dashboard Metrics (Phase 2 honest data only)
create function api.dashboard_metrics(p_workspace uuid) returns table(
  total_active_leads bigint,
  new_leads_7d bigint,
  unassigned_leads bigint,
  tasks_due_today bigint,
  tasks_overdue bigint,
  leads_no_next_action bigint,
  stage_distribution jsonb
) language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  total_l bigint;
  new_l bigint;
  unassigned_l bigint;
  due_today_t bigint;
  overdue_t bigint;
  no_action_l bigint;
  stages_json jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select count(*) into total_l from crm.leads l where l.workspace_id=p_workspace and l.status='active' and private.can_read_lead(p_workspace, l.id);
  select count(*) into new_l from crm.leads l where l.workspace_id=p_workspace and l.status='active' and l.created_at >= now() - interval '7 days' and private.can_read_lead(p_workspace, l.id);
  select count(*) into unassigned_l from crm.leads l where l.workspace_id=p_workspace and l.status='active' and l.assigned_setter_id is null and l.assigned_closer_id is null and private.can_read_lead(p_workspace, l.id);

  select count(*) into due_today_t from crm.tasks t
  where t.workspace_id=p_workspace and t.status='open' and t.due_at >= date_trunc('day', now()) and t.due_at < date_trunc('day', now()) + interval '1 day'
    and private.can_read_lead(p_workspace, t.lead_id);

  select count(*) into overdue_t from crm.tasks t
  where t.workspace_id=p_workspace and t.status='open' and t.due_at < date_trunc('day', now())
    and private.can_read_lead(p_workspace, t.lead_id);

  select count(*) into no_action_l from crm.leads l
  left join crm.next_action_projection nap on nap.workspace_id=l.workspace_id and nap.lead_id=l.id
  where l.workspace_id=p_workspace and l.status='active' and nap.task_id is null
    and private.can_read_lead(p_workspace, l.id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'stage_code', sc.stable_code,
    'label', sc.label,
    'category', sc.category,
    'sort_order', sc.sort_order,
    'count', sc.lead_count
  ) order by sc.sort_order), '[]'::jsonb) into stages_json
  from (
    select s.stable_code, s.label, s.category, s.sort_order, count(j.id) as lead_count
    from crm.stages s
    join crm.pipelines p on p.id = s.pipeline_id and p.is_default
    left join crm.lead_journeys j on j.stage_id = s.id and j.lifecycle = 'active' and private.can_read_lead(p_workspace, j.lead_id)
    where s.workspace_id = p_workspace
    group by s.id, s.stable_code, s.label, s.category, s.sort_order
  ) sc;

  return query select total_l, new_l, unassigned_l, due_today_t, overdue_t, no_action_l, coalesce(stages_json, '[]'::jsonb);
end $$;

create function api.list_leads(
  p_workspace uuid,
  p_query text default null,
  p_stage text default null,
  p_setter uuid default null,
  p_closer uuid default null,
  p_limit int default 50,
  p_offset int default 0
) returns table(
  id uuid,
  display_name text,
  company text,
  email text,
  phone text,
  stage_code text,
  stage_label text,
  stage_category crm.stage_category,
  setter_id uuid,
  setter_name text,
  closer_id uuid,
  closer_name text,
  next_action_due timestamptz,
  next_action_title text,
  created_at timestamptz,
  total_count bigint
) language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  return query
  with filtered as (
    select
      l.id,
      l.display_name,
      l.company,
      (select i.normalized_value from crm.lead_identities li join crm.identities i on i.id=li.identity_id where li.lead_id=l.id and i.kind='email' order by li.is_primary desc, li.valid_from asc limit 1) as email,
      (select i.normalized_value from crm.lead_identities li join crm.identities i on i.id=li.identity_id where li.lead_id=l.id and i.kind='phone' order by li.is_primary desc, li.valid_from asc limit 1) as phone,
      st.stable_code as stage_code,
      st.label as stage_label,
      st.category as stage_category,
      l.assigned_setter_id as setter_id,
      (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=l.assigned_setter_id) as setter_name,
      l.assigned_closer_id as closer_id,
      (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=l.assigned_closer_id) as closer_name,
      nap.due_at as next_action_due,
      tk.title as next_action_title,
      l.created_at,
      count(*) over() as total_count
    from crm.leads l
    left join crm.lead_journeys j on j.lead_id = l.id and j.lifecycle = 'active'
    left join crm.stages st on st.id = j.stage_id
    left join crm.next_action_projection nap on nap.lead_id = l.id
    left join crm.tasks tk on tk.id = nap.task_id
    where l.workspace_id = p_workspace
      and l.status = 'active'
      and private.can_read_lead(p_workspace, l.id)
      and (p_stage is null or st.stable_code = p_stage)
      and (p_setter is null or l.assigned_setter_id = p_setter)
      and (p_closer is null or l.assigned_closer_id = p_closer)
      and (p_query is null or (
        l.display_name ilike '%' || p_query || '%' or
        coalesce(l.company, '') ilike '%' || p_query || '%' or
        exists (select 1 from crm.lead_identities li join crm.identities i on i.id=li.identity_id where li.lead_id=l.id and i.normalized_value ilike '%' || p_query || '%')
      ))
    order by l.created_at desc, l.id desc
    limit p_limit offset p_offset
  )
  select * from filtered;
end $$;

create function api.get_lead_detail(
  p_workspace uuid,
  p_lead uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  lead_rec record;
  journey_rec record;
  identities_json jsonb;
  tags_json jsonb;
  custom_values_json jsonb;
  notes_json jsonb;
  tasks_json jsonb;
  activities_json jsonb;
  next_action_json jsonb;
begin
  actor := private.member_id(p_workspace);
  if not private.can_read_lead(p_workspace, p_lead) then
    raise exception using errcode='42501', message='Permission denied to view lead';
  end if;

  select l.*,
    (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=l.assigned_setter_id) as setter_name,
    (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=l.assigned_closer_id) as closer_name,
    (select t.name from crm.teams t where t.id=l.accountable_team_id) as team_name
  into lead_rec
  from crm.leads l where l.workspace_id=p_workspace and l.id=p_lead;

  if not found then raise exception using errcode='42501', message='Lead not found'; end if;

  select j.*, s.stable_code as stage_code, s.label as stage_label, s.category as stage_category
  into journey_rec
  from crm.lead_journeys j
  join crm.stages s on s.id=j.stage_id
  where j.workspace_id=p_workspace and j.lead_id=p_lead and j.lifecycle='active' limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'kind', i.kind, 'normalized_value', i.normalized_value,
    'raw_value', i.raw_value_ref, 'is_primary', li.is_primary
  ) order by li.is_primary desc, i.created_at asc), '[]'::jsonb) into identities_json
  from crm.lead_identities li
  join crm.identities i on i.id=li.identity_id
  where li.workspace_id=p_workspace and li.lead_id=p_lead;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'name', t.name, 'color', t.color
  ) order by t.name asc), '[]'::jsonb) into tags_json
  from crm.lead_tags lt
  join crm.tags t on t.id=lt.tag_id
  where lt.workspace_id=p_workspace and lt.lead_id=p_lead;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key', d.key, 'label', d.label, 'data_type', d.data_type, 'value', lcv.typed_value
  ) order by d.key asc), '[]'::jsonb) into custom_values_json
  from crm.lead_custom_values lcv
  join crm.custom_field_definitions d on d.id=lcv.definition_id
  where lcv.workspace_id=p_workspace and lcv.lead_id=p_lead;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'pinned', n.pinned, 'important', n.important,
    'author_id', n.author_membership_id,
    'author_name', (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=n.author_membership_id),
    'created_at', n.created_at, 'updated_at', n.updated_at,
    'body', nr.body, 'revision_number', nr.revision_number
  ) order by n.pinned desc, n.created_at desc), '[]'::jsonb) into notes_json
  from crm.notes n
  left join lateral (
    select body, revision_number from crm.note_revisions where note_id=n.id order by revision_number desc limit 1
  ) nr on true
  where n.workspace_id=p_workspace and n.lead_id=p_lead and n.hidden_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'title', t.title, 'due_at', t.due_at, 'priority', t.priority, 'status', t.status,
    'assignee_id', t.assignee_membership_id,
    'assignee_name', (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=t.assignee_membership_id),
    'completed_at', t.completed_at, 'created_at', t.created_at
  ) order by t.status asc, t.due_at asc), '[]'::jsonb) into tasks_json
  from crm.tasks t
  where t.workspace_id=p_workspace and t.lead_id=p_lead;

  select coalesce(jsonb_agg(s.obj), '[]'::jsonb) into activities_json
  from (
    select jsonb_build_object(
      'id', a.id, 'event_type', a.event_type, 'occurred_at', a.occurred_at,
      'actor_name', (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=a.actor_membership_id),
      'payload', a.payload
    ) as obj
    from crm.activities a
    where a.workspace_id=p_workspace and a.lead_id=p_lead
    order by a.occurred_at desc, a.id desc
    limit 100
  ) s;

  select jsonb_build_object(
    'task_id', t.id, 'title', t.title, 'due_at', t.due_at, 'priority', t.priority,
    'assignee_name', (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=t.assignee_membership_id)
  ) into next_action_json
  from crm.next_action_projection nap
  join crm.tasks t on t.id=nap.task_id
  where nap.workspace_id=p_workspace and nap.lead_id=p_lead;

  return jsonb_build_object(
    'lead', jsonb_build_object(
      'id', lead_rec.id, 'display_name', lead_rec.display_name, 'company', lead_rec.company,
      'status', lead_rec.status, 'version', lead_rec.version,
      'created_at', lead_rec.created_at, 'updated_at', lead_rec.updated_at,
      'setter_id', lead_rec.assigned_setter_id, 'setter_name', lead_rec.setter_name,
      'closer_id', lead_rec.assigned_closer_id, 'closer_name', lead_rec.closer_name,
      'team_id', lead_rec.accountable_team_id, 'team_name', lead_rec.team_name
    ),
    'journey', case when journey_rec.id is not null then jsonb_build_object(
      'id', journey_rec.id, 'pipeline_id', journey_rec.pipeline_id, 'stage_id', journey_rec.stage_id,
      'stage_code', journey_rec.stage_code, 'stage_label', journey_rec.stage_label,
      'stage_category', journey_rec.stage_category, 'version', journey_rec.version, 'opened_at', journey_rec.opened_at
    ) else null end,
    'identities', identities_json,
    'tags', tags_json,
    'custom_values', custom_values_json,
    'next_action', next_action_json,
    'notes', notes_json,
    'tasks', tasks_json,
    'activities', activities_json
  );
end $$;

create function api.list_tasks(
  p_workspace uuid,
  p_filter text default 'today',
  p_limit int default 50,
  p_offset int default 0
) returns table(
  id uuid,
  lead_id uuid,
  lead_name text,
  title text,
  due_at timestamptz,
  priority crm.task_priority,
  status crm.task_status,
  assignee_id uuid,
  assignee_name text,
  created_at timestamptz,
  completed_at timestamptz,
  total_count bigint
) language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  return query
  with filtered as (
    select
      t.id,
      t.lead_id,
      l.display_name as lead_name,
      t.title,
      t.due_at,
      t.priority,
      t.status,
      t.assignee_membership_id as assignee_id,
      (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=t.assignee_membership_id) as assignee_name,
      t.created_at,
      t.completed_at,
      count(*) over() as total_count
    from crm.tasks t
    join crm.leads l on l.id=t.lead_id
    where t.workspace_id = p_workspace
      and private.can_read_lead(p_workspace, t.lead_id)
      and (
        (p_filter = 'today' and t.status = 'open' and t.due_at >= date_trunc('day', now()) and t.due_at < date_trunc('day', now()) + interval '1 day') or
        (p_filter = 'overdue' and t.status = 'open' and t.due_at < date_trunc('day', now())) or
        (p_filter = 'upcoming' and t.status = 'open' and t.due_at >= date_trunc('day', now()) + interval '1 day') or
        (p_filter = 'completed' and t.status = 'completed') or
        (p_filter = 'all')
      )
    order by case when t.status = 'open' then 0 else 1 end, t.due_at asc, t.id desc
    limit p_limit offset p_offset
  )
  select * from filtered;
end $$;

create function api.pipeline_board(p_workspace uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; board jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select jsonb_agg(jsonb_build_object(
    'stage_code', s.stable_code,
    'label', s.label,
    'category', s.category,
    'sort_order', s.sort_order,
    'leads', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'display_name', l.display_name,
        'company', l.company,
        'setter_name', (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=l.assigned_setter_id),
        'closer_name', (select p.display_name from crm.memberships m left join crm.profiles p on p.user_id=m.user_id where m.id=l.assigned_closer_id),
        'next_action_due', nap.due_at,
        'next_action_title', tk.title,
        'journey_version', j.version,
        'created_at', l.created_at
      ) order by l.updated_at desc, l.id desc)
      from crm.lead_journeys j
      join crm.leads l on l.id=j.lead_id and l.status='active'
      left join crm.next_action_projection nap on nap.lead_id=l.id
      left join crm.tasks tk on tk.id=nap.task_id
      where j.workspace_id=p_workspace and j.stage_id=s.id and j.lifecycle='active' and private.can_read_lead(p_workspace, l.id)
    ), '[]'::jsonb)
  ) order by s.sort_order) into board
  from crm.stages s
  join crm.pipelines p on p.id=s.pipeline_id and p.is_default
  where s.workspace_id=p_workspace;

  return coalesce(board, '[]'::jsonb);
end $$;

create function api.list_stages(p_workspace uuid) returns table(
  stage_code text,
  label text,
  category crm.stage_category,
  sort_order int
) language plpgsql security definer set search_path='' as $$
begin
  if private.member_id(p_workspace) is null then raise exception using errcode='42501', message='Active membership required'; end if;
  return query
  select s.stable_code, s.label, s.category, s.sort_order
  from crm.stages s
  join crm.pipelines p on p.id=s.pipeline_id and p.is_default
  where s.workspace_id=p_workspace
  order by s.sort_order asc;
end $$;

create function api.list_lost_reasons(p_workspace uuid) returns table(
  id uuid,
  code text,
  label text
) language plpgsql security definer set search_path='' as $$
begin
  if private.member_id(p_workspace) is null then raise exception using errcode='42501', message='Active membership required'; end if;
  return query
  select lr.id, lr.code, lr.label
  from crm.lost_reasons lr
  where lr.workspace_id=p_workspace and lr.archived_at is null
  order by lr.code asc;
end $$;

-- 17. Security Grants
revoke all on all functions in schema private, api from public, anon, authenticated;
grant execute on function private.member_id(uuid), private.member_role(uuid), private.can_read_team(uuid,uuid), private.can_read_member(uuid,uuid), private.can_read_lead(uuid, uuid), private.can_work_lead(uuid, uuid) to authenticated;
grant execute on all functions in schema api to authenticated;

reset role;
commit;
