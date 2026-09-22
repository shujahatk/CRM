-- 80/20 CRM Phase 4: CRM Forms, First-Party Attribution & VSL Analytics
-- Additive Migration: Preserves Phase 1–3 schema and data contracts.

-- 1. Tracking Sites Configuration
create table crm.tracking_sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  name text not null,
  public_key text not null unique,
  allowed_origins text[] not null default '{}',
  allow_any_origin boolean not null default false,
  session_timeout_minutes integer not null default 30 check (session_timeout_minutes between 5 and 1440),
  attribution_lookback_days integer not null default 30 check (attribution_lookback_days between 1 and 365),
  status text not null default 'active' check (status in ('active', 'disabled', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

-- 2. Explicit Versioned Consent Engine
create table crm.consent_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  name text not null,
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table crm.consent_policy_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  policy_id uuid not null,
  version integer not null,
  policy_text text not null,
  categories text[] not null default '{"analytics", "marketing"}',
  published_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (policy_id, version),
  foreign key (workspace_id, policy_id) references crm.consent_policies(workspace_id, id) on delete cascade
);

alter table crm.consent_policies
  add foreign key (workspace_id, current_version_id) references crm.consent_policy_versions(workspace_id, id);

create table crm.consent_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  policy_version_id uuid not null,
  visitor_id uuid,
  site_session_id uuid,
  lead_id uuid,
  form_submission_id uuid,
  category text not null check (category in ('analytics', 'marketing', 'all')),
  state text not null check (state in ('granted', 'denied', 'withdrawn')),
  source text not null check (source in ('banner', 'form_checkbox', 'manual_optout', 'api')),
  occurred_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, policy_version_id) references crm.consent_policy_versions(workspace_id, id)
);

-- 3. Forms Engine
create table crm.forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  tracking_site_id uuid not null,
  name text not null,
  public_key text not null unique,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  current_published_version_id uuid,
  created_by_membership_id uuid not null references crm.memberships(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, tracking_site_id) references crm.tracking_sites(workspace_id, id)
);

create table crm.form_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  form_id uuid not null,
  version integer not null,
  pipeline_id uuid not null references crm.pipelines(id),
  stage_id uuid not null references crm.stages(id),
  consent_policy_version_id uuid,
  title text,
  description text,
  submit_button_text text not null default 'Submit',
  success_message text not null default 'Thank you for your submission.',
  redirect_url text,
  published_at timestamptz not null default now(),
  published_by_membership_id uuid not null references crm.memberships(id),
  unique (workspace_id, id),
  unique (form_id, version),
  foreign key (workspace_id, form_id) references crm.forms(workspace_id, id) on delete cascade,
  foreign key (workspace_id, consent_policy_version_id) references crm.consent_policy_versions(workspace_id, id)
);

alter table crm.forms
  add foreign key (workspace_id, current_published_version_id) references crm.form_versions(workspace_id, id);

create table crm.form_fields (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  form_version_id uuid not null,
  key text not null,
  label text not null,
  field_type text not null check (field_type in ('text', 'email', 'phone', 'textarea', 'select', 'radio', 'checkbox', 'hidden', 'consent')),
  is_required boolean not null default false,
  options jsonb not null default '[]',
  placeholder text,
  sort_order integer not null default 0,
  unique (workspace_id, id),
  unique (form_version_id, key),
  foreign key (workspace_id, form_version_id) references crm.form_versions(workspace_id, id) on delete cascade
);

create table crm.form_submissions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  form_version_id uuid not null,
  intake_record_id uuid references private.intake_records(id),
  lead_id uuid references crm.leads(id),
  visitor_id uuid,
  site_session_id uuid,
  idempotency_key text,
  request_hash text not null,
  raw_answers jsonb not null default '{}',
  submitted_at timestamptz not null default now(),
  attribution_touch_id uuid,
  consent_event_id uuid,
  unique (workspace_id, id),
  unique (workspace_id, form_version_id, idempotency_key),
  foreign key (workspace_id, form_version_id) references crm.form_versions(workspace_id, id)
);

create table crm.submission_answers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  form_submission_id uuid not null,
  field_key text not null,
  typed_value text,
  unique (workspace_id, id),
  unique (form_submission_id, field_key),
  foreign key (workspace_id, form_submission_id) references crm.form_submissions(workspace_id, id) on delete cascade
);

-- 4. Visitors, Sessions & Contextual Provenance
create table crm.visitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  visitor_token_hash text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, visitor_token_hash)
);

create table crm.site_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  visitor_id uuid not null,
  session_token_hash text not null,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  landing_url text,
  referrer text,
  user_agent_category text,
  ip_country_code char(2),
  consent_status text not null default 'unknown' check (consent_status in ('unknown', 'granted', 'denied')),
  unique (workspace_id, id),
  unique (workspace_id, session_token_hash),
  foreign key (workspace_id, visitor_id) references crm.visitors(workspace_id, id) on delete cascade
);

create table crm.visitor_lead_links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  visitor_id uuid not null,
  lead_id uuid not null,
  site_session_id uuid not null,
  form_submission_id uuid,
  association_window_start timestamptz not null,
  association_window_end timestamptz not null,
  proof_basis text not null check (proof_basis in ('form_submission', 'verified_token', 'direct_intake')),
  linked_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, visitor_id, site_session_id, lead_id),
  foreign key (workspace_id, visitor_id) references crm.visitors(workspace_id, id),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id),
  foreign key (workspace_id, site_session_id) references crm.site_sessions(workspace_id, id),
  foreign key (workspace_id, form_submission_id) references crm.form_submissions(workspace_id, id)
);

-- 5. Attribution Engine & Derived Current Snapshots
create table crm.attribution_touches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  visitor_id uuid,
  site_session_id uuid,
  lead_id uuid,
  form_submission_id uuid,
  touch_type text not null check (touch_type in ('page_view', 'form_submit', 'vsl_watch', 'custom')),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  external_campaign_id text,
  external_adset_id text,
  external_ad_id text,
  external_creative_id text,
  landing_url text,
  referrer text,
  occurred_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table crm.lead_attribution_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  lead_id uuid not null,
  model text not null check (model in ('first_touch', 'latest_touch')),
  attribution_touch_id uuid not null,
  snapshot_at timestamptz not null default now(),
  last_evaluated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, lead_id, model),
  foreign key (workspace_id, lead_id) references crm.leads(workspace_id, id),
  foreign key (workspace_id, attribution_touch_id) references crm.attribution_touches(workspace_id, id)
);

-- 6. VSL Assets, Versions, Sessions, Watch Segments & Events
create table crm.vsl_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  tracking_site_id uuid not null,
  name text not null,
  public_key text not null unique,
  external_provider text not null default 'custom' check (external_provider in ('custom', 'vimeo', 'wistia', 'youtube')),
  external_video_id text,
  current_version_id uuid,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, tracking_site_id) references crm.tracking_sites(workspace_id, id)
);

create table crm.vsl_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  vsl_asset_id uuid not null,
  version integer not null default 1,
  duration_seconds integer not null check (duration_seconds > 0),
  bin_width_seconds integer not null default 5 check (bin_width_seconds in (1, 5, 10, 15, 30)),
  completion_threshold_percent integer not null default 95 check (completion_threshold_percent between 50 and 100),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (vsl_asset_id, version),
  foreign key (workspace_id, vsl_asset_id) references crm.vsl_assets(workspace_id, id) on delete cascade
);

alter table crm.vsl_assets
  add foreign key (workspace_id, current_version_id) references crm.vsl_versions(workspace_id, id);

create table crm.vsl_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  vsl_version_id uuid not null,
  visitor_id uuid,
  site_session_id uuid,
  lead_id uuid,
  started_at timestamptz not null default now(),
  last_heartbeat_at timestamptz not null default now(),
  total_unique_seconds_watched integer not null default 0,
  max_position_seconds integer not null default 0,
  completion_percent numeric(5,2) not null default 0.00,
  completed boolean not null default false,
  unique (workspace_id, id),
  foreign key (workspace_id, vsl_version_id) references crm.vsl_versions(workspace_id, id)
);

create table crm.vsl_watch_segments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  vsl_session_id uuid not null,
  segment_start_seconds integer not null check (segment_start_seconds >= 0),
  segment_end_seconds integer not null check (segment_end_seconds >= segment_start_seconds),
  recorded_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, vsl_session_id) references crm.vsl_sessions(workspace_id, id) on delete cascade
);

create table crm.vsl_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references crm.workspaces(id),
  vsl_session_id uuid not null,
  event_type text not null check (event_type in ('play', 'pause', 'seek', 'ended')),
  position_seconds integer not null check (position_seconds >= 0),
  occurred_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, vsl_session_id) references crm.vsl_sessions(workspace_id, id) on delete cascade
);

-- 7. Immutability Triggers
create or replace function private.reject_phase4_mutation() returns trigger language plpgsql set search_path='' as $$
begin
  raise exception using errcode='42501', message='Phase 4 historical records are append-only';
end $$;

create trigger trg_consent_events_immutable before update or delete on crm.consent_events for each row execute function private.reject_phase4_mutation();
create trigger trg_form_submissions_immutable before update or delete on crm.form_submissions for each row execute function private.reject_phase4_mutation();
create trigger trg_submission_answers_immutable before update or delete on crm.submission_answers for each row execute function private.reject_phase4_mutation();
create trigger trg_visitor_lead_links_immutable before update or delete on crm.visitor_lead_links for each row execute function private.reject_phase4_mutation();
create trigger trg_attribution_touches_immutable before update or delete on crm.attribution_touches for each row execute function private.reject_phase4_mutation();
create trigger trg_vsl_watch_segments_immutable before update or delete on crm.vsl_watch_segments for each row execute function private.reject_phase4_mutation();
create trigger trg_vsl_events_immutable before update or delete on crm.vsl_events for each row execute function private.reject_phase4_mutation();

-- 8. Enable RLS on All Tables
alter table crm.tracking_sites enable row level security;
alter table crm.consent_policies enable row level security;
alter table crm.consent_policy_versions enable row level security;
alter table crm.consent_events enable row level security;
alter table crm.forms enable row level security;
alter table crm.form_versions enable row level security;
alter table crm.form_fields enable row level security;
alter table crm.form_submissions enable row level security;
alter table crm.submission_answers enable row level security;
alter table crm.visitors enable row level security;
alter table crm.site_sessions enable row level security;
alter table crm.visitor_lead_links enable row level security;
alter table crm.attribution_touches enable row level security;
alter table crm.lead_attribution_snapshots enable row level security;
alter table crm.vsl_assets enable row level security;
alter table crm.vsl_versions enable row level security;
alter table crm.vsl_sessions enable row level security;
alter table crm.vsl_watch_segments enable row level security;
alter table crm.vsl_events enable row level security;

-- Read Policies: Workspace members can view workspace records
create policy tracking_sites_read on crm.tracking_sites for select using (private.member_id(workspace_id) is not null);
create policy consent_policies_read on crm.consent_policies for select using (private.member_id(workspace_id) is not null);
create policy consent_policy_versions_read on crm.consent_policy_versions for select using (private.member_id(workspace_id) is not null);
create policy consent_events_read on crm.consent_events for select using (private.member_id(workspace_id) is not null);
create policy forms_read on crm.forms for select using (private.member_id(workspace_id) is not null);
create policy form_versions_read on crm.form_versions for select using (private.member_id(workspace_id) is not null);
create policy form_fields_read on crm.form_fields for select using (private.member_id(workspace_id) is not null);
create policy form_submissions_read on crm.form_submissions for select using (private.member_id(workspace_id) is not null);
create policy submission_answers_read on crm.submission_answers for select using (private.member_id(workspace_id) is not null);
create policy visitors_read on crm.visitors for select using (private.member_id(workspace_id) is not null);
create policy site_sessions_read on crm.site_sessions for select using (private.member_id(workspace_id) is not null);
create policy visitor_lead_links_read on crm.visitor_lead_links for select using (private.member_id(workspace_id) is not null);
create policy attribution_touches_read on crm.attribution_touches for select using (private.member_id(workspace_id) is not null);
create policy lead_attribution_snapshots_read on crm.lead_attribution_snapshots for select using (private.member_id(workspace_id) is not null);
create policy vsl_assets_read on crm.vsl_assets for select using (private.member_id(workspace_id) is not null);
create policy vsl_versions_read on crm.vsl_versions for select using (private.member_id(workspace_id) is not null);
create policy vsl_sessions_read on crm.vsl_sessions for select using (private.member_id(workspace_id) is not null);
create policy vsl_watch_segments_read on crm.vsl_watch_segments for select using (private.member_id(workspace_id) is not null);
create policy vsl_events_read on crm.vsl_events for select using (private.member_id(workspace_id) is not null);

-- 9. Authoritative Security Definer RPCs

-- Site & Forms Management RPCs
create or replace function api.create_tracking_site(
  p_workspace uuid,
  p_name text,
  p_allowed_origins text[] default '{}',
  p_allow_any_origin boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_role text;
  v_site_id uuid;
  v_key text;
begin
  actor := private.member_id(p_workspace);
  v_role := private.member_role(p_workspace);
  if actor is null or v_role in ('read_only', 'setter', 'closer') then
    raise exception using errcode='42501', message='Manager or admin role required';
  end if;
  if p_name is null or length(btrim(p_name)) < 1 then
    raise exception using errcode='22023', message='Site name is required';
  end if;
  v_key := 'site_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into crm.tracking_sites(workspace_id, name, public_key, allowed_origins, allow_any_origin)
  values (p_workspace, btrim(p_name), v_key, p_allowed_origins, p_allow_any_origin)
  returning id into v_site_id;
  return jsonb_build_object('site_id', v_site_id, 'public_key', v_key);
end $$;

create or replace function api.create_form(
  p_workspace uuid,
  p_site_id uuid,
  p_name text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_role text;
  v_form_id uuid;
  v_key text;
begin
  actor := private.member_id(p_workspace);
  v_role := private.member_role(p_workspace);
  if actor is null or v_role in ('read_only', 'setter', 'closer') then
    raise exception using errcode='42501', message='Manager or admin role required';
  end if;
  perform 1 from crm.tracking_sites where workspace_id = p_workspace and id = p_site_id;
  if not found then
    raise exception using errcode='22023', message='Tracking site not found in workspace';
  end if;
  if p_name is null or length(btrim(p_name)) < 1 then
    raise exception using errcode='22023', message='Form name is required';
  end if;
  v_key := 'form_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into crm.forms(workspace_id, tracking_site_id, name, public_key, created_by_membership_id)
  values (p_workspace, p_site_id, btrim(p_name), v_key, actor)
  returning id into v_form_id;
  return jsonb_build_object('form_id', v_form_id, 'public_key', v_key);
end $$;

create or replace function api.publish_form_version(
  p_workspace uuid,
  p_form_id uuid,
  p_pipeline_id uuid,
  p_stage_id uuid,
  p_fields jsonb,
  p_config jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_role text;
  v_next_version int;
  v_version_id uuid;
  elem jsonb;
  f_key text;
  f_label text;
  f_type text;
  f_req boolean;
  f_opt jsonb;
  f_order int;
begin
  actor := private.member_id(p_workspace);
  v_role := private.member_role(p_workspace);
  if actor is null or v_role in ('read_only', 'setter', 'closer') then
    raise exception using errcode='42501', message='Manager or admin role required';
  end if;
  perform 1 from crm.forms where workspace_id = p_workspace and id = p_form_id;
  if not found then raise exception using errcode='22023', message='Form not found'; end if;
  perform 1 from crm.stages where workspace_id = p_workspace and pipeline_id = p_pipeline_id and id = p_stage_id;
  if not found then raise exception using errcode='22023', message='Pipeline stage not found'; end if;

  select coalesce(max(version), 0) + 1 into v_next_version
  from crm.form_versions where workspace_id = p_workspace and form_id = p_form_id;

  insert into crm.form_versions(
    workspace_id, form_id, version, pipeline_id, stage_id,
    title, description, submit_button_text, success_message, redirect_url, published_by_membership_id
  ) values (
    p_workspace, p_form_id, v_next_version, p_pipeline_id, p_stage_id,
    p_config->>'title', p_config->>'description',
    coalesce(p_config->>'submit_button_text', 'Submit'),
    coalesce(p_config->>'success_message', 'Thank you for your submission.'),
    p_config->>'redirect_url', actor
  ) returning id into v_version_id;

  f_order := 0;
  for elem in select * from jsonb_array_elements(p_fields) loop
    f_key := elem->>'key';
    f_label := coalesce(elem->>'label', f_key);
    f_type := coalesce(elem->>'field_type', 'text');
    f_req := coalesce((elem->>'is_required')::boolean, false);
    f_opt := coalesce(elem->'options', '[]'::jsonb);
    f_order := f_order + 1;
    insert into crm.form_fields(workspace_id, form_version_id, key, label, field_type, is_required, options, sort_order)
    values (p_workspace, v_version_id, f_key, f_label, f_type, f_req, f_opt, f_order);
  end loop;

  update crm.forms
  set current_published_version_id = v_version_id, status = 'published', updated_at = now()
  where workspace_id = p_workspace and id = p_form_id;

  return jsonb_build_object('version_id', v_version_id, 'version', v_next_version);
end $$;

-- Public Form Submission RPC
create or replace function api.public_submit_form(
  p_public_key text,
  p_answers jsonb,
  p_visitor_token text,
  p_attribution jsonb default '{}'::jsonb,
  p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_form crm.forms%rowtype;
  v_version crm.form_versions%rowtype;
  v_site crm.tracking_sites%rowtype;
  v_req_hash text;
  v_existing_sub crm.form_submissions%rowtype;
  v_visitor_hash text;
  v_visitor_id uuid;
  v_session_id uuid;
  v_lead_id uuid;
  v_sub_id uuid;
  v_touch_id uuid;
  v_norm_email text;
  v_norm_phone text;
  v_lead_name text;
  v_lead_by_email uuid;
  v_lead_by_phone uuid;
  v_field record;
  v_ans_val text;
begin
  select * into v_form from crm.forms where public_key = p_public_key and status = 'published';
  if not found or v_form.current_published_version_id is null then
    raise exception using errcode='42501', message='Form unavailable or not published';
  end if;

  select * into v_version from crm.form_versions where id = v_form.current_published_version_id;
  select * into v_site from crm.tracking_sites where id = v_form.tracking_site_id;

  v_req_hash := encode(sha256(convert_to(p_answers::text || p_attribution::text, 'utf8')), 'hex');

  -- Idempotency check bound to version + payload hash
  if p_idempotency_key is not null and length(btrim(p_idempotency_key)) > 0 then
    select * into v_existing_sub from crm.form_submissions
    where workspace_id = v_form.workspace_id and form_version_id = v_version.id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing_sub.request_hash <> v_req_hash then
        raise exception using errcode='40001', message='Idempotency key reused with mismatched payload';
      end if;
      return jsonb_build_object(
        'submission_id', v_existing_sub.id,
        'lead_id', v_existing_sub.lead_id,
        'redirect_url', v_version.redirect_url,
        'success_message', v_version.success_message
      );
    end if;
  end if;

  -- Visitor & Session Resolution
  v_visitor_hash := encode(sha256(convert_to(coalesce(p_visitor_token, gen_random_uuid()::text), 'utf8')), 'hex');
  insert into crm.visitors(workspace_id, visitor_token_hash)
  values (v_form.workspace_id, v_visitor_hash)
  on conflict (workspace_id, visitor_token_hash) do update set last_seen_at = now()
  returning id into v_visitor_id;

  if p_attribution ? 'session_token' and length(btrim(p_attribution->>'session_token')) > 0 then
    declare
      v_sth text := encode(sha256(convert_to(p_attribution->>'session_token', 'utf8')), 'hex');
    begin
      select id into v_session_id from crm.site_sessions
      where workspace_id = v_form.workspace_id and visitor_id = v_visitor_id and session_token_hash = v_sth
      order by started_at desc limit 1;
    end;
  end if;

  if v_session_id is null then
    select s.id into v_session_id
    from crm.site_sessions s
    where s.workspace_id = v_form.workspace_id
      and s.visitor_id = v_visitor_id
      and s.last_seen_at >= now() - interval '30 minutes'
      and not exists (
        select 1 from crm.visitor_lead_links vll
        where vll.workspace_id = s.workspace_id and vll.site_session_id = s.id
      )
    order by s.started_at desc limit 1;
  end if;

  if v_session_id is null then
    insert into crm.site_sessions(
      workspace_id, visitor_id, session_token_hash, landing_url, referrer, consent_status
    ) values (
      v_form.workspace_id, v_visitor_id,
      encode(sha256(convert_to(coalesce(p_attribution->>'session_token', v_visitor_hash || clock_timestamp()::text || random()::text), 'utf8')), 'hex'),
      p_attribution->>'landing_url', p_attribution->>'referrer',
      coalesce(p_attribution->>'consent_status', 'unknown')
    ) returning id into v_session_id;
  end if;

  -- Normalized fields
  if p_answers ? 'email' and length(btrim(p_answers->>'email')) > 0 then
    v_norm_email := lower(btrim(p_answers->>'email'));
  end if;
  if p_answers ? 'phone' and length(btrim(p_answers->>'phone')) > 0 then
    v_norm_phone := regexp_replace(btrim(p_answers->>'phone'), '[[:space:]\-\(\)\.]+', '', 'g');
  end if;
  v_lead_name := coalesce(
    nullif(btrim(coalesce(p_answers->>'name', '')), ''),
    nullif(btrim(coalesce(p_answers->>'first_name', '') || ' ' || coalesce(p_answers->>'last_name', '')), ''),
    v_norm_email,
    'Web Lead'
  );

  -- Existing lead lookup
  if v_norm_email is not null then
    select ic.lead_id into v_lead_by_email
    from crm.identities i join crm.identity_claims ic on ic.identity_id = i.id and ic.active
    where i.workspace_id = v_form.workspace_id and i.kind = 'email' and i.normalized_value = v_norm_email;
  end if;
  if v_norm_phone is not null then
    select ic.lead_id into v_lead_by_phone
    from crm.identities i join crm.identity_claims ic on ic.identity_id = i.id and ic.active
    where i.workspace_id = v_form.workspace_id and i.kind = 'phone' and i.normalized_value = v_norm_phone;
  end if;

  -- Deduplication / Identity Conflict resolution
  if v_lead_by_email is not null and v_lead_by_phone is not null and v_lead_by_email <> v_lead_by_phone then
    -- Ambiguous collision -> flag conflict, lead_id remains null
    insert into crm.identity_conflicts(workspace_id, intake_source, candidate_lead_ids, conflicting_identities, reason)
    values (v_form.workspace_id, 'form_submit', array[v_lead_by_email, v_lead_by_phone],
      jsonb_build_array(jsonb_build_object('kind', 'email', 'value', v_norm_email), jsonb_build_object('kind', 'phone', 'value', v_norm_phone)),
      'Form email and phone resolve to distinct existing leads');
    v_lead_id := null;
  elsif v_lead_by_email is not null then
    v_lead_id := v_lead_by_email;
  elsif v_lead_by_phone is not null then
    v_lead_id := v_lead_by_phone;
  else
    -- Create new lead
    insert into crm.leads(workspace_id, display_name, created_by_membership_id)
    values (v_form.workspace_id, v_lead_name, v_version.published_by_membership_id)
    returning id into v_lead_id;

    -- Attach identities
    if v_norm_email is not null then
      declare v_ident uuid; begin
        insert into crm.identities(workspace_id, kind, normalized_value)
        values (v_form.workspace_id, 'email', v_norm_email)
        on conflict (workspace_id, kind, normalized_value) do update set normalization_version = excluded.normalization_version
        returning id into v_ident;
        insert into crm.lead_identities(workspace_id, lead_id, identity_id, is_primary) values (v_form.workspace_id, v_lead_id, v_ident, true);
        insert into crm.identity_claims(workspace_id, identity_id, lead_id, active) values (v_form.workspace_id, v_ident, v_lead_id, true);
      end;
    end if;
    if v_norm_phone is not null then
      declare v_ident uuid; begin
        insert into crm.identities(workspace_id, kind, normalized_value)
        values (v_form.workspace_id, 'phone', v_norm_phone)
        on conflict (workspace_id, kind, normalized_value) do update set normalization_version = excluded.normalization_version
        returning id into v_ident;
        insert into crm.lead_identities(workspace_id, lead_id, identity_id, is_primary) values (v_form.workspace_id, v_lead_id, v_ident, true);
        insert into crm.identity_claims(workspace_id, identity_id, lead_id, active) values (v_form.workspace_id, v_ident, v_lead_id, true);
      end;
    end if;

    -- Initialize Journey
    insert into crm.lead_journeys(workspace_id, lead_id, pipeline_id, stage_id, lifecycle)
    values (v_form.workspace_id, v_lead_id, v_version.pipeline_id, v_version.stage_id, 'active');
  end if;

  -- Record Attribution Touch
  insert into crm.attribution_touches(
    workspace_id, visitor_id, site_session_id, lead_id, touch_type,
    utm_source, utm_medium, utm_campaign, utm_term, utm_content,
    external_campaign_id, external_adset_id, external_ad_id, external_creative_id,
    landing_url, referrer
  ) values (
    v_form.workspace_id, v_visitor_id, v_session_id, v_lead_id, 'form_submit',
    p_attribution->>'utm_source', p_attribution->>'utm_medium', p_attribution->>'utm_campaign',
    p_attribution->>'utm_term', p_attribution->>'utm_content',
    p_attribution->>'campaign_id', p_attribution->>'adset_id', p_attribution->>'ad_id', p_attribution->>'creative_id',
    p_attribution->>'landing_url', p_attribution->>'referrer'
  ) returning id into v_touch_id;

  -- Insert Form Submission
  insert into crm.form_submissions(
    workspace_id, form_version_id, lead_id, visitor_id, site_session_id,
    idempotency_key, request_hash, raw_answers, attribution_touch_id
  ) values (
    v_form.workspace_id, v_version.id, v_lead_id, v_visitor_id, v_session_id,
    p_idempotency_key, v_req_hash, p_answers, v_touch_id
  ) returning id into v_sub_id;

  -- Insert Submission Answers
  for v_field in select * from crm.form_fields where workspace_id = v_form.workspace_id and form_version_id = v_version.id loop
    if p_answers ? v_field.key then
      v_ans_val := p_answers->>v_field.key;
      insert into crm.submission_answers(workspace_id, form_submission_id, field_key, typed_value)
      values (v_form.workspace_id, v_sub_id, v_field.key, v_ans_val);
    end if;
  end loop;

  -- If lead is resolved, update provenance links & attribution snapshots
  if v_lead_id is not null then
    -- Contextual Visitor-Lead Link (bound to this site_session_id)
    insert into crm.visitor_lead_links(
      workspace_id, visitor_id, lead_id, site_session_id, form_submission_id,
      association_window_start, association_window_end, proof_basis
    ) values (
      v_form.workspace_id, v_visitor_id, v_lead_id, v_session_id, v_sub_id,
      now() - (v_site.attribution_lookback_days || ' days')::interval, now(), 'form_submission'
    ) on conflict (workspace_id, visitor_id, site_session_id, lead_id) do nothing;

    -- Attribution Snapshots: First touch is stable, Latest touch updates
    insert into crm.lead_attribution_snapshots(workspace_id, lead_id, model, attribution_touch_id)
    values (v_form.workspace_id, v_lead_id, 'first_touch', v_touch_id)
    on conflict (workspace_id, lead_id, model) do nothing;

    insert into crm.lead_attribution_snapshots(workspace_id, lead_id, model, attribution_touch_id, last_evaluated_at)
    values (v_form.workspace_id, v_lead_id, 'latest_touch', v_touch_id, now())
    on conflict (workspace_id, lead_id, model) do update
      set attribution_touch_id = excluded.attribution_touch_id, last_evaluated_at = now();

    -- Append activity
    insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, aggregate_version, event_type, source, payload)
    values (v_form.workspace_id, v_lead_id, 'form_submission', v_sub_id, 1, 'form_submitted', 'web_form',
      jsonb_build_object('form_id', v_form.id, 'form_name', v_form.name, 'submission_id', v_sub_id));
  end if;

  return jsonb_build_object(
    'submission_id', v_sub_id,
    'lead_id', v_lead_id,
    'redirect_url', v_version.redirect_url,
    'success_message', v_version.success_message
  );
end $$;

-- 10. VSL RPCs
create or replace function api.create_vsl_asset(
  p_workspace uuid,
  p_site_id uuid,
  p_name text,
  p_duration integer,
  p_provider text default 'custom',
  p_video_id text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_role text;
  v_asset_id uuid;
  v_ver_id uuid;
  v_key text;
begin
  actor := private.member_id(p_workspace);
  v_role := private.member_role(p_workspace);
  if actor is null or v_role in ('read_only', 'setter', 'closer') then
    raise exception using errcode='42501', message='Manager or admin role required';
  end if;
  if p_duration is null or p_duration <= 0 then
    raise exception using errcode='22023', message='Duration must be greater than 0 seconds';
  end if;
  v_key := 'vsl_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16);
  insert into crm.vsl_assets(workspace_id, tracking_site_id, name, public_key, external_provider, external_video_id)
  values (p_workspace, p_site_id, btrim(p_name), v_key, p_provider, p_video_id)
  returning id into v_asset_id;

  insert into crm.vsl_versions(workspace_id, vsl_asset_id, version, duration_seconds)
  values (p_workspace, v_asset_id, 1, p_duration)
  returning id into v_ver_id;

  update crm.vsl_assets set current_version_id = v_ver_id where id = v_asset_id;

  return jsonb_build_object('asset_id', v_asset_id, 'version_id', v_ver_id, 'public_key', v_key);
end $$;

create or replace function api.start_vsl_session(
  p_public_key text,
  p_visitor_token text,
  p_lead_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_asset crm.vsl_assets%rowtype;
  v_ver crm.vsl_versions%rowtype;
  v_visitor_hash text;
  v_visitor_id uuid;
  v_session_id uuid;
  v_vsl_session_id uuid;
begin
  select * into v_asset from crm.vsl_assets where public_key = p_public_key and status = 'active';
  if not found or v_asset.current_version_id is null then
    raise exception using errcode='42501', message='VSL asset not found or inactive';
  end if;
  select * into v_ver from crm.vsl_versions where id = v_asset.current_version_id;

  v_visitor_hash := encode(sha256(convert_to(coalesce(p_visitor_token, gen_random_uuid()::text), 'utf8')), 'hex');
  insert into crm.visitors(workspace_id, visitor_token_hash)
  values (v_asset.workspace_id, v_visitor_hash)
  on conflict (workspace_id, visitor_token_hash) do update set last_seen_at = now()
  returning id into v_visitor_id;

  select s.id into v_session_id
  from crm.site_sessions s
  where s.workspace_id = v_asset.workspace_id
    and s.visitor_id = v_visitor_id
    and s.last_seen_at >= now() - interval '30 minutes'
    and not exists (
      select 1 from crm.visitor_lead_links vll
      where vll.workspace_id = s.workspace_id and vll.site_session_id = s.id
    )
  order by s.started_at desc limit 1;

  if v_session_id is null then
    insert into crm.site_sessions(workspace_id, visitor_id, session_token_hash)
    values (v_asset.workspace_id, v_visitor_id, encode(sha256(convert_to(v_visitor_hash || clock_timestamp()::text || random()::text, 'utf8')), 'hex'))
    returning id into v_session_id;
  end if;

  -- Lead ID populated ONLY if known at start (Correction 5)
  if p_lead_id is not null then
    perform 1 from crm.leads where workspace_id = v_asset.workspace_id and id = p_lead_id;
    if not found then p_lead_id := null; end if;
  end if;

  insert into crm.vsl_sessions(
    workspace_id, vsl_version_id, visitor_id, site_session_id, lead_id
  ) values (
    v_asset.workspace_id, v_ver.id, v_visitor_id, v_session_id, p_lead_id
  ) returning id into v_vsl_session_id;

  return jsonb_build_object(
    'vsl_session_id', v_vsl_session_id,
    'duration_seconds', v_ver.duration_seconds,
    'bin_width_seconds', v_ver.bin_width_seconds
  );
end $$;

create or replace function api.record_vsl_heartbeat(
  p_session_id uuid,
  p_segments jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_session crm.vsl_sessions%rowtype;
  v_ver crm.vsl_versions%rowtype;
  elem jsonb;
  s_start int;
  s_end int;
  v_unique_sec int;
  v_max_pos int;
  v_pct numeric(5,2);
  v_done boolean;
begin
  select * into v_session from crm.vsl_sessions where id = p_session_id;
  if not found then raise exception using errcode='22023', message='VSL session not found'; end if;
  select * into v_ver from crm.vsl_versions where id = v_session.vsl_version_id;

  for elem in select * from jsonb_array_elements(p_segments) loop
    s_start := (elem->>0)::int;
    s_end := (elem->>1)::int;
    if s_start >= 0 and s_end >= s_start and s_end <= v_ver.duration_seconds then
      insert into crm.vsl_watch_segments(workspace_id, vsl_session_id, segment_start_seconds, segment_end_seconds)
      values (v_session.workspace_id, v_session.id, s_start, s_end);
    end if;
  end loop;

  -- Canonical Interval Merging Calculation
  with sorted as (
    select segment_start_seconds as s, segment_end_seconds as e
    from crm.vsl_watch_segments
    where vsl_session_id = v_session.id
    order by segment_start_seconds, segment_end_seconds
  ),
  merged as (
    select
      min(s) as s,
      max(e) as e
    from (
      select s, e,
             count(case when s > max_prev_e then 1 end) over (order by s, e) as grp
      from (
        select s, e,
               coalesce(max(e) over (order by s, e rows between unbounded preceding and 1 preceding), -1) as max_prev_e
        from sorted
      ) t1
    ) t2
    group by grp
  )
  select
    coalesce(sum(e - s), 0),
    coalesce(max(e), 0)
  into v_unique_sec, v_max_pos
  from merged;

  v_pct := round((v_unique_sec::numeric / v_ver.duration_seconds::numeric) * 100, 2);
  if v_pct > 100.00 then v_pct := 100.00; end if;
  v_done := (v_pct >= v_ver.completion_threshold_percent);

  update crm.vsl_sessions
  set total_unique_seconds_watched = v_unique_sec,
      max_position_seconds = greatest(max_position_seconds, v_max_pos),
      completion_percent = v_pct,
      completed = v_done,
      last_heartbeat_at = now()
  where id = v_session.id;

  return jsonb_build_object(
    'unique_seconds_watched', v_unique_sec,
    'completion_percent', v_pct,
    'completed', v_done
  );
end $$;

create or replace function api.record_vsl_event(
  p_session_id uuid,
  p_event_type text,
  p_position_seconds integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_session crm.vsl_sessions%rowtype;
begin
  select * into v_session from crm.vsl_sessions where id = p_session_id;
  if not found then raise exception using errcode='22023', message='VSL session not found'; end if;
  insert into crm.vsl_events(workspace_id, vsl_session_id, event_type, position_seconds)
  values (v_session.workspace_id, v_session.id, p_event_type, greatest(0, p_position_seconds));
  return jsonb_build_object('recorded', true);
end $$;

-- 11. VSL Analytics & Lead Detail Reporting RPCs
create or replace function api.get_vsl_analytics(
  p_workspace uuid,
  p_asset_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_ver crm.vsl_versions%rowtype;
  v_tot_sessions int;
  v_tot_viewers int;
  v_avg_completion numeric(5,2);
  v_completed_count int;
  v_curve jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  select v.* into v_ver from crm.vsl_versions v
  join crm.vsl_assets a on a.current_version_id = v.id
  where a.workspace_id = p_workspace and a.id = p_asset_id;

  if not found then raise exception using errcode='22023', message='VSL asset not found'; end if;

  select
    count(*),
    count(distinct coalesce(lead_id, visitor_id)),
    coalesce(round(avg(completion_percent), 2), 0.00),
    count(case when completed then 1 end)
  into v_tot_sessions, v_tot_viewers, v_avg_completion, v_completed_count
  from crm.vsl_sessions
  where workspace_id = p_workspace and vsl_version_id = v_ver.id;

  -- 5-second bin retention curve
  with bins as (
    select generate_series(0, v_ver.duration_seconds, v_ver.bin_width_seconds) as bin_sec
  ),
  bin_counts as (
    select b.bin_sec, count(distinct s.vsl_session_id) as viewers
    from bins b
    left join crm.vsl_watch_segments s on s.workspace_id = p_workspace
      and exists (select 1 from crm.vsl_sessions vs where vs.id = s.vsl_session_id and vs.vsl_version_id = v_ver.id)
      and s.segment_start_seconds <= b.bin_sec and s.segment_end_seconds >= b.bin_sec
    group by b.bin_sec
    order by b.bin_sec
  )
  select jsonb_agg(jsonb_build_object('second', bin_sec, 'viewers', viewers))
  into v_curve
  from bin_counts;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'duration_seconds', v_ver.duration_seconds,
    'total_sessions', v_tot_sessions,
    'unique_viewers', v_tot_viewers,
    'average_completion_percent', v_avg_completion,
    'completed_sessions', v_completed_count,
    'retention_curve', coalesce(v_curve, '[]'::jsonb)
  );
end $$;

create or replace function api.get_lead_vsl_history(
  p_workspace uuid,
  p_lead_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_history jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null or not private.can_read_lead(p_workspace, p_lead_id) then
    raise exception using errcode='42501', message='Lead access required';
  end if;

  with eligible_sessions as (
    -- Direct known-lead sessions OR sessions linked via contextual visitor_lead_links
    select distinct s.id, s.vsl_version_id, s.started_at, s.total_unique_seconds_watched, s.completion_percent, s.completed
    from crm.vsl_sessions s
    where s.workspace_id = p_workspace and (
      s.lead_id = p_lead_id or
      exists (
        select 1 from crm.visitor_lead_links vll
        where vll.workspace_id = p_workspace and vll.lead_id = p_lead_id and vll.site_session_id = s.site_session_id
      )
    )
  ),
  session_intervals as (
    select
      es.id as session_id,
      a.name as vsl_name,
      v.duration_seconds,
      es.started_at,
      es.total_unique_seconds_watched,
      es.completion_percent,
      es.completed,
      (
        select jsonb_agg(jsonb_build_object('start', s.segment_start_seconds, 'end', s.segment_end_seconds))
        from crm.vsl_watch_segments s
        where s.vsl_session_id = es.id
      ) as intervals
    from eligible_sessions es
    join crm.vsl_versions v on v.id = es.vsl_version_id
    join crm.vsl_assets a on a.id = v.vsl_asset_id
    order by es.started_at desc
  )
  select jsonb_agg(to_jsonb(session_intervals)) into v_history from session_intervals;

  return coalesce(v_history, '[]'::jsonb);
end $$;

-- 12. Attribution Report RPC
create or replace function api.get_attribution_report(
  p_workspace uuid,
  p_model text default 'first_touch'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_report jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;

  with snap as (
    select
      s.lead_id,
      t.utm_source,
      t.utm_medium,
      t.utm_campaign
    from crm.lead_attribution_snapshots s
    join crm.attribution_touches t on t.id = s.attribution_touch_id
    where s.workspace_id = p_workspace and s.model = p_model
  ),
  leads_data as (
    select
      coalesce(nullif(snap.utm_source, ''), 'direct') as source,
      coalesce(nullif(snap.utm_medium, ''), 'none') as medium,
      coalesce(nullif(snap.utm_campaign, ''), 'none') as campaign,
      count(distinct l.id) as leads_count,
      count(distinct d.id) filter (where d.status = 'won') as won_deals_count,
      coalesce(sum(case when d.status = 'won' then d.deal_value_minor else 0 end), 0) as won_deal_value_minor
    from crm.leads l
    left join snap on snap.lead_id = l.id
    left join crm.deals d on d.lead_id = l.id and d.workspace_id = p_workspace
    where l.workspace_id = p_workspace
    group by coalesce(nullif(snap.utm_source, ''), 'direct'),
             coalesce(nullif(snap.utm_medium, ''), 'none'),
             coalesce(nullif(snap.utm_campaign, ''), 'none')
  )
  select jsonb_agg(to_jsonb(leads_data)) into v_report from leads_data;

  return coalesce(v_report, '[]'::jsonb);
end $$;

create or replace function api.list_tracking_sites(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;
  select jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'public_key', public_key,
    'allowed_origins', allowed_origins, 'is_public_any_origin', is_public_any_origin,
    'status', status, 'created_at', created_at
  )) into v_res
  from crm.tracking_sites where workspace_id = p_workspace order by created_at desc;
  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_forms(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;
  select jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'public_key', f.public_key,
    'status', f.status, 'created_at', f.created_at,
    'current_version_id', f.current_version_id,
    'submission_count', (select count(*)::int from crm.form_submissions s where s.form_id = f.id),
    'version_count', (select count(*)::int from crm.form_versions v where v.form_id = f.id)
  )) into v_res
  from crm.forms f where f.workspace_id = p_workspace order by f.created_at desc;
  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.list_vsl_assets(p_workspace uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null then raise exception using errcode='42501', message='Active membership required'; end if;
  select jsonb_agg(jsonb_build_object(
    'id', a.id, 'name', a.name, 'public_key', a.public_key,
    'player_type', a.player_type, 'status', a.status, 'created_at', a.created_at,
    'duration_seconds', coalesce(v.duration_seconds, 0),
    'session_count', (select count(*)::int from crm.vsl_sessions s where s.workspace_id = a.workspace_id and s.vsl_version_id = a.current_version_id),
    'completed_count', (select count(*)::int from crm.vsl_sessions s where s.workspace_id = a.workspace_id and s.vsl_version_id = a.current_version_id and s.completed = true)
  )) into v_res
  from crm.vsl_assets a
  left join crm.vsl_versions v on v.id = a.current_version_id
  where a.workspace_id = p_workspace order by a.created_at desc;
  return coalesce(v_res, '[]'::jsonb);
end $$;

create or replace function api.get_lead_attribution(p_workspace uuid, p_lead_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid;
  v_res jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null or not private.can_read_lead(p_workspace, p_lead_id) then
    raise exception using errcode='42501', message='Lead access required';
  end if;
  select jsonb_agg(jsonb_build_object(
    'model', s.model,
    'first_touch_at', s.first_touch_at,
    'calculated_at', s.calculated_at,
    'touch', jsonb_build_object(
      'utm_source', t.utm_source,
      'utm_medium', t.utm_medium,
      'utm_campaign', t.utm_campaign,
      'landing_url', t.landing_url,
      'referrer', t.referrer,
      'occurred_at', t.occurred_at
    )
  )) into v_res
  from crm.lead_attribution_snapshots s
  join crm.attribution_touches t on t.id = s.attribution_touch_id
  where s.workspace_id = p_workspace and s.lead_id = p_lead_id;
  return coalesce(v_res, '[]'::jsonb);
end $$;

revoke all on all functions in schema private, api from public;
grant execute on function private.member_id(uuid),private.member_role(uuid),private.can_read_team(uuid,uuid),private.can_read_member(uuid,uuid),private.can_read_lead(uuid,uuid),private.can_work_lead(uuid,uuid) to authenticated;
grant execute on all functions in schema api to authenticated;

grant usage on schema api to anon;
grant select on all tables in schema crm to authenticated;

grant execute on function api.public_submit_form(text, jsonb, text, jsonb, text) to anon, authenticated;
grant execute on function api.start_vsl_session(text, text, uuid) to anon, authenticated;
grant execute on function api.record_vsl_heartbeat(uuid, jsonb) to anon, authenticated;
grant execute on function api.record_vsl_event(uuid, text, integer) to anon, authenticated;
