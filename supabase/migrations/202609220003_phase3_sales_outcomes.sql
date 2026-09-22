begin;
set local role crm_owner;
-- Phase 2 audit corrections; original migrations remain immutable.

create or replace function private.ensure_default_pipeline(w uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
  perform 1 from crm.workspaces where id=w for update;
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

create or replace function api.update_lead(
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
  if cur.version is distinct from p_version then raise exception using errcode='40001', message='Lead changed concurrently'; end if;

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

create or replace function api.assign_lead(
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
  if cur.version is distinct from p_version then raise exception using errcode='40001', message='Lead changed concurrently'; end if;

  if p_setter is not null and not exists (
    select 1 from crm.memberships where workspace_id=p_workspace and id=p_setter and status='active' and role in ('setter', 'admin', 'manager')
  ) then raise exception using errcode='42501', message='Eligible active setter required'; end if;

  if p_closer is not null and not exists (
    select 1 from crm.memberships where workspace_id=p_workspace and id=p_closer and status='active' and role in ('closer', 'admin', 'manager')
  ) then raise exception using errcode='42501', message='Eligible active closer required'; end if;

  if p_team is not null and not exists (
    select 1 from crm.teams where workspace_id=p_workspace and id=p_team and status='active'
  ) then raise exception using errcode='42501', message='Active team required'; end if;

  if not private.can_work_lead(p_workspace,p_lead) then raise exception using errcode='42501', message='Lead access required'; end if;
  if private.member_role(p_workspace)='manager' and (
    (p_team is not null and not exists(select 1 from crm.team_memberships where workspace_id=p_workspace and team_id=p_team and membership_id=actor and is_manager)) or
    (p_setter is not null and not private.can_read_member(p_workspace,p_setter)) or
    (p_closer is not null and not private.can_read_member(p_workspace,p_closer))) then
    raise exception using errcode='42501', message='Managed team required'; end if;
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

create or replace function api.edit_note(
  p_workspace uuid,
  p_note uuid,
  p_body text
) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; n crm.notes; next_rev int;
begin
  actor := private.member_id(p_workspace);
  select * into n from crm.notes where workspace_id=p_workspace and id=p_note for update;
  if not found then raise exception using errcode='42501', message='Note not found'; end if;

  if not private.can_work_lead(p_workspace,n.lead_id) then raise exception using errcode='42501', message='Lead access required'; end if;
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

create or replace function api.create_task(
  p_workspace uuid,
  p_lead uuid,
  p_assignee uuid,
  p_title text,
  p_due_at timestamptz,
  p_priority crm.task_priority default 'medium'
) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; task_id uuid; jid uuid;
begin
  perform 1 from crm.leads where workspace_id=p_workspace and id=p_lead for update;
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

  if not exists (select 1 from crm.memberships where workspace_id=p_workspace and id=p_assignee and status='active' and role <> 'read_only') then
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

create or replace function api.complete_task(
  p_workspace uuid,
  p_task uuid
) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; t crm.tasks;
begin
  actor := private.member_id(p_workspace);
  perform 1 from crm.leads where workspace_id=p_workspace and id=(select lead_id from crm.tasks where workspace_id=p_workspace and id=p_task) for update;
  select * into t from crm.tasks where workspace_id=p_workspace and id=p_task for update;
  if not found then raise exception using errcode='42501', message='Task not found'; end if;

  if not private.can_work_lead(p_workspace, t.lead_id) then
    raise exception using errcode='42501', message='Permission denied to complete task';
  end if;

  if t.status='completed' then return; end if;
  update crm.tasks set status = 'completed', completed_at = now(), updated_at = now() where id = p_task;

  insert into crm.task_events(workspace_id, task_id, action, actor_membership_id)
  values (p_workspace, p_task, 'completed', actor);

  perform private.refresh_next_action(p_workspace, t.lead_id);

  insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, event_type, actor_membership_id, payload)
  values (p_workspace, t.lead_id, 'task', p_task, 'task.completed', actor, jsonb_build_object('task_id', p_task));
end $$;

create or replace function api.reopen_task(
  p_workspace uuid,
  p_task uuid
) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; t crm.tasks;
begin
  actor := private.member_id(p_workspace);
  perform 1 from crm.leads where workspace_id=p_workspace and id=(select lead_id from crm.tasks where workspace_id=p_workspace and id=p_task) for update;
  select * into t from crm.tasks where workspace_id=p_workspace and id=p_task for update;
  if not found then raise exception using errcode='42501', message='Task not found'; end if;

  if not private.can_work_lead(p_workspace, t.lead_id) then
    raise exception using errcode='42501', message='Permission denied to reopen task';
  end if;

  if t.status='open' then return; end if;
  update crm.tasks set status = 'open', completed_at = null, updated_at = now() where id = p_task;

  insert into crm.task_events(workspace_id, task_id, action, actor_membership_id)
  values (p_workspace, p_task, 'reopened', actor);

  perform private.refresh_next_action(p_workspace, t.lead_id);

  insert into crm.activities(workspace_id, lead_id, aggregate_type, aggregate_id, event_type, actor_membership_id, payload)
  values (p_workspace, t.lead_id, 'task', p_task, 'task.reopened', actor, jsonb_build_object('task_id', p_task));
end $$;

create or replace function api.list_leads(
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
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then raise exception using errcode='22023', message='Invalid page'; end if;
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
    left join lateral (select j0.* from crm.lead_journeys j0 where j0.workspace_id=l.workspace_id and j0.lead_id=l.id order by j0.opened_at desc,j0.id desc limit 1) j on true
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

create or replace function api.list_tasks(
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
  if p_limit is null or p_limit not between 1 and 100 or p_offset is null or p_offset not between 0 and 100000 then raise exception using errcode='22023', message='Invalid page'; end if;
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
        (p_filter = 'today' and t.status = 'open' and t.due_at >= ((now() at time zone (select timezone from crm.workspaces where id=p_workspace))::date::timestamp at time zone (select timezone from crm.workspaces where id=p_workspace)) and t.due_at < (((now() at time zone (select timezone from crm.workspaces where id=p_workspace))::date + 1)::timestamp at time zone (select timezone from crm.workspaces where id=p_workspace))) or
        (p_filter = 'overdue' and t.status = 'open' and t.due_at < now()) or
        (p_filter = 'upcoming' and t.status = 'open' and t.due_at >= (((now() at time zone (select timezone from crm.workspaces where id=p_workspace))::date + 1)::timestamp at time zone (select timezone from crm.workspaces where id=p_workspace))) or
        (p_filter = 'completed' and t.status = 'completed') or
        (p_filter = 'all')
      )
    order by case when t.status = 'open' then 0 else 1 end, t.due_at asc, t.id desc
    limit p_limit offset p_offset
  )
  select * from filtered;
end $$;

create or replace function api.get_lead_detail(
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
  where j.workspace_id=p_workspace and j.lead_id=p_lead order by j.opened_at desc,j.id desc limit 1;

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

create or replace function api.dashboard_metrics(p_workspace uuid) returns table(
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
  where t.workspace_id=p_workspace and t.status='open' and t.due_at >= ((now() at time zone (select timezone from crm.workspaces where id=p_workspace))::date::timestamp at time zone (select timezone from crm.workspaces where id=p_workspace)) and t.due_at < (((now() at time zone (select timezone from crm.workspaces where id=p_workspace))::date + 1)::timestamp at time zone (select timezone from crm.workspaces where id=p_workspace))
    and private.can_read_lead(p_workspace, t.lead_id);

  select count(*) into overdue_t from crm.tasks t
  where t.workspace_id=p_workspace and t.status='open' and t.due_at < ((now() at time zone (select timezone from crm.workspaces where id=p_workspace))::date::timestamp at time zone (select timezone from crm.workspaces where id=p_workspace))
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
    left join crm.lead_journeys j on j.workspace_id=p_workspace and j.stage_id = s.id and private.can_read_lead(p_workspace, j.lead_id)
    where s.workspace_id = p_workspace
    group by s.id, s.stable_code, s.label, s.category, s.sort_order
  ) sc;

  return query select total_l, new_l, unassigned_l, due_today_t, overdue_t, no_action_l, coalesce(stages_json, '[]'::jsonb);
end $$;

create unique index one_default_pipeline on crm.pipelines(workspace_id) where is_default;
create or replace function private.can_read_lead(w uuid,l uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.member_id(w) is not null and exists (
 select 1 from crm.leads d where d.workspace_id=w and d.id=l and (
 private.member_role(w)='admin' or
 (private.member_role(w)='manager' and exists(select 1 from crm.team_memberships t where t.workspace_id=w and t.membership_id=private.member_id(w) and t.team_id=d.accountable_team_id and t.is_manager)) or
 (private.member_role(w)='setter' and d.assigned_setter_id=private.member_id(w)) or
 (private.member_role(w)='closer' and d.assigned_closer_id=private.member_id(w)) or
 (private.member_role(w)='read_only' and exists(select 1 from crm.report_scope_grants g where g.workspace_id=w and g.membership_id=private.member_id(w) and g.detail_level='lead_detail' and (g.expires_at is null or g.expires_at>now()) and (g.scope='workspace' or (g.scope='team' and g.team_id=d.accountable_team_id) or (g.scope='own_credit' and private.member_id(w) in (d.assigned_setter_id,d.assigned_closer_id)))))
 ))
$$;
create or replace function private.can_work_lead(w uuid,l uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.member_role(w)<>'read_only' and private.can_read_lead(w,l)
$$;
drop policy identities_read on crm.identities;
create policy identities_read on crm.identities for select to authenticated using (exists(select 1 from crm.lead_identities x where x.workspace_id=identities.workspace_id and x.identity_id=identities.id and private.can_read_lead(x.workspace_id,x.lead_id)));
drop policy activities_read on crm.activities;
create policy activities_read on crm.activities for select to authenticated using (private.member_id(workspace_id) is not null and (private.can_read_lead(workspace_id,lead_id) or (lead_id is null and private.member_role(workspace_id)='admin')));
drop policy activity_credits_read on crm.activity_credits;
create policy activity_credits_read on crm.activity_credits for select to authenticated using (exists(select 1 from crm.activities a where a.workspace_id=activity_credits.workspace_id and a.id=activity_credits.activity_id));
drop policy identity_conflicts_read on crm.identity_conflicts;
create policy identity_conflicts_read on crm.identity_conflicts for select to authenticated using (private.member_role(workspace_id)='admin');
create trigger immutable_task_events before update or delete on crm.task_events for each row execute function private.reject_activity_mutation();
create trigger immutable_credits before update or delete on crm.activity_credits for each row execute function private.reject_activity_mutation();
alter table private.outbox_events add foreign key(workspace_id,activity_id) references crm.activities(workspace_id,id);
create unique index outbox_semantic_key on private.outbox_events(workspace_id,activity_id,destination);
create function private.enqueue_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.outbox_events(workspace_id,activity_id,destination,payload) values(new.workspace_id,new.id,'internal',jsonb_build_object('activity_id',new.id));
 return new;
end $$;
create trigger activity_outbox after insert on crm.activities for each row execute function private.enqueue_activity();

-- All consequential commands serialize the durable key before testing the hash.
-- JSONB canonical representation binds the entire request, including command type.
create function private.command_begin(w uuid,k text,body jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.command_receipts; a uuid:=private.member_id(w); h text;
begin
 if a is null then raise exception using errcode='42501',message='Active membership required'; end if;
 if k is null or length(k) not between 1 and 160 then raise exception using errcode='22023',message='Command key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w::text||a::text||k,0));
 h:=encode(sha256(convert_to(body::text,'UTF8')),'hex');
 select * into r from private.command_receipts where workspace_id=w and actor_membership_id=a and command_key=k;
 if found then
   if r.request_hash<>h then raise exception using errcode='40001',message='Command key already used for different input'; end if;
   return r.result;
 end if;
 return null;
end $$;
create function private.command_finish(w uuid,k text,body jsonb,result jsonb) returns void language sql security definer set search_path='' as $$
 insert into private.command_receipts(workspace_id,actor_membership_id,command_key,request_hash,result)
 values(w,private.member_id(w),k,encode(sha256(convert_to(body::text,'UTF8')),'hex'),result)
$$;

create or replace function api.create_lead(
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
  receipt_id uuid; request jsonb; replay jsonb;
begin
  actor := private.member_id(p_workspace);
  if actor is null or private.member_role(p_workspace) = 'read_only' then
    raise exception using errcode='42501', message='Authorized membership required';
  end if;

  perform 1 from crm.workspaces where id=p_workspace for update;
  request:=jsonb_build_object('command','create_lead','name',p_name,'email',p_email,'phone',p_phone,'company',p_company);
  if p_command_key is not null then
    replay:=private.command_begin(p_workspace,p_command_key,request);
    if replay is not null then
      if replay->>'lead_id' is not null and not private.can_read_lead(p_workspace,(replay->>'lead_id')::uuid) then raise exception using errcode='42501',message='Lead access required'; end if;
      return (replay->>'lead_id')::uuid;
    end if;
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
    if norm_phone !~ '^\+[1-9][0-9]{6,14}$' then
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
    if p_command_key is not null then perform private.command_finish(p_workspace,p_command_key,request,jsonb_build_object('lead_id',null,'review_required',true)); end if;
    return null;
  end if;

  if (lead_by_email is not null and lead_by_phone is null and norm_phone is not null) or
     (lead_by_phone is not null and lead_by_email is null and norm_email is not null) then
    declare matched_lead uuid := coalesce(lead_by_email, lead_by_phone);
    begin
      insert into crm.identity_conflicts(workspace_id, intake_source, candidate_lead_ids, conflicting_identities, reason)
      values (p_workspace, 'manual_create', array[matched_lead],
        jsonb_build_array(jsonb_build_object('kind', 'email', 'value', norm_email), jsonb_build_object('kind', 'phone', 'value', norm_phone)),
        'New identity conflicts with unassociated attribute on existing lead');
      if p_command_key is not null then perform private.command_finish(p_workspace,p_command_key,request,jsonb_build_object('lead_id',null,'review_required',true)); end if;
      return null;
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

  update crm.leads set
    assigned_setter_id=case when private.member_role(p_workspace)='setter' then actor end,
    assigned_closer_id=case when private.member_role(p_workspace)='closer' then actor end,
    accountable_team_id=(select team_id from crm.team_memberships where workspace_id=p_workspace and membership_id=actor order by team_id limit 1)
  where id=new_lead_id;
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
    perform private.command_finish(p_workspace,p_command_key,request,jsonb_build_object('lead_id',new_lead_id));
  end if;

  return new_lead_id;
end $$;

create or replace function api.record_identity_conflict(
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
  if actor is null or private.member_role(p_workspace) <> 'admin' then
    raise exception using errcode='42501', message='Authorized membership required';
  end if;

  if cardinality(p_candidate_lead_ids) not between 1 and 10 or exists(select 1 from unnest(p_candidate_lead_ids) x where not exists(select 1 from crm.leads where workspace_id=p_workspace and id=x)) then raise exception using errcode='22023',message='Valid candidate leads required'; end if;
  insert into crm.identity_conflicts(workspace_id, intake_source, candidate_lead_ids, conflicting_identities, reason)
  values (p_workspace, coalesce(p_source, 'manual'), p_candidate_lead_ids, p_conflicting_identities, p_reason)
  returning id into cid;

  return cid;
end $$;

create or replace function api.transition_stage(
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
  target_stage crm.stages; request jsonb; replay jsonb;
begin
  actor := private.member_id(p_workspace);
  if not private.can_work_lead(p_workspace, p_lead) then
    raise exception using errcode='42501', message='Permission denied to transition lead stage';
  end if;

  perform 1 from crm.leads where workspace_id=p_workspace and id=p_lead for update;
  request:=jsonb_build_object('command','transition','lead',p_lead,'target',p_to_stage_code,'reason',p_lost_reason_id,'stage',p_expected_stage_code,'version',p_version);
  if p_command_key is not null then replay:=private.command_begin(p_workspace,p_command_key,request); if replay is not null then return; end if; end if;
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

  if p_to_stage_code not in ('contacted','call_1','call_2','call_3','call_4') then raise exception using errcode='22023',message='Use the validated sales action on Lead Detail'; end if;
  if p_version is null then raise exception using errcode='40001',message='Expected version required'; end if;
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
    perform private.command_finish(p_workspace,p_command_key,request,jsonb_build_object('success',true));
  end if;
end $$;

-- Phase 3 authoritative records. Composite foreign keys bind children to parents.
alter table crm.lead_journeys add unique(workspace_id,lead_id,id);
create table crm.meetings (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null, lead_id uuid not null, journey_id uuid not null,
 booking_chain_id uuid not null default gen_random_uuid(), title text not null check(length(btrim(title)) between 1 and 240), meeting_type text not null default 'sales',
 start_at timestamptz not null,end_at timestamptz not null,timezone text not null,
 booking_state text not null check(booking_state in ('booked','confirmed','cancelled','rescheduled')),
 attendance text not null default 'unknown' check(attendance in ('unknown','showed','no_show')),
 setter_credit_membership_id uuid,closer_credit_membership_id uuid,team_credit_id uuid,
 source text not null default 'manual' check(source='manual'),external_provider text,external_id text,
 created_by uuid not null,version bigint not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,lead_id,id),check(end_at>start_at),check((external_provider is null)=(external_id is null)),
 foreign key(workspace_id,lead_id,journey_id) references crm.lead_journeys(workspace_id,lead_id,id),
 foreign key(workspace_id,setter_credit_membership_id) references crm.memberships(workspace_id,id),
 foreign key(workspace_id,closer_credit_membership_id) references crm.memberships(workspace_id,id),
 foreign key(workspace_id,team_credit_id) references crm.teams(workspace_id,id),foreign key(workspace_id,created_by) references crm.memberships(workspace_id,id)
);
create unique index one_pending_meeting on crm.meetings(workspace_id,journey_id) where booking_state<>'cancelled' and attendance='unknown';
create index meetings_schedule on crm.meetings(workspace_id,closer_credit_membership_id,start_at);
create index meetings_lead on crm.meetings(workspace_id,lead_id,start_at desc);
create table crm.meeting_events (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,lead_id uuid not null,meeting_id uuid not null,
 revision bigint not null,event_type text not null,before_state jsonb,after_state jsonb not null,activity_id uuid not null,occurred_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,meeting_id,revision),
 foreign key(workspace_id,lead_id,meeting_id) references crm.meetings(workspace_id,lead_id,id),foreign key(workspace_id,activity_id) references crm.activities(workspace_id,id)
);
create table crm.deals (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,lead_id uuid not null,journey_id uuid not null,meeting_id uuid,
 title text not null check(length(btrim(title)) between 1 and 240),status text not null check(status in ('won','lost')),
 currency text not null check(currency ~ '^[A-Z]{3}$'),deal_value_minor bigint not null check(deal_value_minor>=0),
 setter_credit_membership_id uuid,closer_credit_membership_id uuid,team_credit_id uuid,won_at timestamptz,lost_at timestamptz,lost_reason_id uuid,
 created_by uuid not null,version bigint not null default 1,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,lead_id,id),unique(workspace_id,journey_id),
 check((status='won' and won_at is not null and lost_at is null) or (status='lost' and lost_at is not null and won_at is null and lost_reason_id is not null)),
 foreign key(workspace_id,lead_id,journey_id) references crm.lead_journeys(workspace_id,lead_id,id),
 foreign key(workspace_id,lead_id,meeting_id) references crm.meetings(workspace_id,lead_id,id),
 foreign key(workspace_id,setter_credit_membership_id) references crm.memberships(workspace_id,id),foreign key(workspace_id,closer_credit_membership_id) references crm.memberships(workspace_id,id),
 foreign key(workspace_id,team_credit_id) references crm.teams(workspace_id,id),foreign key(workspace_id,created_by) references crm.memberships(workspace_id,id),foreign key(workspace_id,lost_reason_id) references crm.lost_reasons(workspace_id,id)
);
create index deals_reporting on crm.deals(workspace_id,created_at,team_credit_id);
create table crm.sales_outcomes (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,lead_id uuid not null,journey_id uuid not null,meeting_id uuid,deal_id uuid,
 action text not null check(action in ('SET','CONFIRM','SHOW','NO_SHOW','CANCEL','RESCHEDULE','FOLLOW_UP','CLOSE_WON','CLOSE_LOST','NURTURE')),
 actor_membership_id uuid not null,setter_credit_membership_id uuid,closer_credit_membership_id uuid,team_credit_id uuid,
 activity_id uuid not null,occurred_at timestamptz not null default now(),unique(workspace_id,id),unique(workspace_id,activity_id),
 foreign key(workspace_id,lead_id,journey_id) references crm.lead_journeys(workspace_id,lead_id,id),foreign key(workspace_id,lead_id,meeting_id) references crm.meetings(workspace_id,lead_id,id),
 foreign key(workspace_id,lead_id,deal_id) references crm.deals(workspace_id,lead_id,id),foreign key(workspace_id,activity_id) references crm.activities(workspace_id,id),
 foreign key(workspace_id,actor_membership_id) references crm.memberships(workspace_id,id),foreign key(workspace_id,setter_credit_membership_id) references crm.memberships(workspace_id,id),
 foreign key(workspace_id,closer_credit_membership_id) references crm.memberships(workspace_id,id),foreign key(workspace_id,team_credit_id) references crm.teams(workspace_id,id)
);
create index outcomes_reporting on crm.sales_outcomes(workspace_id,occurred_at,action);
create index outcomes_lead on crm.sales_outcomes(workspace_id,lead_id,occurred_at);
create table crm.payment_entries (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,lead_id uuid not null,deal_id uuid not null,
 kind text not null check(kind in ('recorded','paid','refund','void')),amount_minor bigint not null check(amount_minor>0),currency text not null check(currency ~ '^[A-Z]{3}$'),
 original_entry_id uuid,method text not null check(length(method) between 1 and 80),reason text check(length(reason)<=500),paid_at timestamptz not null,recorded_by uuid not null,
 source text not null default 'manual' check(source='manual'),external_provider text,external_id text,activity_id uuid not null,created_at timestamptz not null default now(),
 unique(workspace_id,id),unique(workspace_id,deal_id,id),
 foreign key(workspace_id,lead_id,deal_id) references crm.deals(workspace_id,lead_id,id),foreign key(workspace_id,deal_id,original_entry_id) references crm.payment_entries(workspace_id,deal_id,id),
 foreign key(workspace_id,recorded_by) references crm.memberships(workspace_id,id),foreign key(workspace_id,activity_id) references crm.activities(workspace_id,id),check((external_provider is null)=(external_id is null))
);
create index payments_ledger on crm.payment_entries(workspace_id,deal_id,paid_at);
create index payments_original on crm.payment_entries(workspace_id,original_entry_id);
create table crm.eod_reports (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,membership_id uuid not null,business_date date not null,timezone text not null,
 unique(workspace_id,id),unique(workspace_id,membership_id,business_date),foreign key(workspace_id,membership_id) references crm.memberships(workspace_id,id)
);
create table crm.eod_revisions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,report_id uuid not null,revision bigint not null,state text not null check(state in ('draft','submitted','amended')),
 qualitative jsonb not null check(octet_length(qualitative::text)<=16000),facts jsonb not null,cutoff_at timestamptz not null default now(),created_by uuid not null,
 unique(workspace_id,id),unique(workspace_id,report_id,revision),foreign key(workspace_id,report_id) references crm.eod_reports(workspace_id,id),foreign key(workspace_id,created_by) references crm.memberships(workspace_id,id)
);
-- Every new table is deny-by-default. Only scoped SELECT; no ordinary writes.
do $$ declare t text; begin
 foreach t in array array['meetings','meeting_events','deals','sales_outcomes','payment_entries'] loop
 execute format('alter table crm.%I enable row level security',t);
 execute format('create policy scoped_read on crm.%I for select to authenticated using(private.can_read_lead(workspace_id,lead_id))',t);
 execute format('grant select on crm.%I to authenticated',t);
 end loop;
 foreach t in array array['meeting_events','sales_outcomes','payment_entries','eod_revisions'] loop
 execute format('create trigger immutable_record before update or delete on crm.%I for each row execute function private.reject_activity_mutation()',t);
 end loop;
end $$;
alter table crm.eod_reports enable row level security;
alter table crm.eod_revisions enable row level security;
create policy eod_read on crm.eod_reports for select to authenticated using(private.can_read_member(workspace_id,membership_id));
create policy eod_revision_read on crm.eod_revisions for select to authenticated using(exists(select 1 from crm.eod_reports r where r.workspace_id=eod_revisions.workspace_id and r.id=eod_revisions.report_id));
grant select on crm.eod_reports,crm.eod_revisions to authenticated;
create function api.sales_command(p_workspace uuid,p_lead uuid,p_action text,p_version bigint,p_command_key text,p_input jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.member_id(p_workspace); role_name crm.member_role; l crm.leads;j crm.lead_journeys;m crm.meetings;
 req jsonb; replay jsonb; result jsonb; previous jsonb; target text; sid uuid; mid uuid; did uuid; aid uuid; setter uuid;closer uuid;
 amount bigint; curr text; lost uuid; due timestamptz; start_time timestamptz;end_time timestamptz;zone text;task_id uuid;payment_result jsonb;
begin
 if not private.can_work_lead(p_workspace,p_lead) then raise exception using errcode='42501',message='Lead access required'; end if;
 role_name:=private.member_role(p_workspace);
 if p_action is null or p_action not in ('SET','CONFIRM','SHOW','NO_SHOW','CANCEL','RESCHEDULE','FOLLOW_UP','CLOSE_WON','CLOSE_LOST','NURTURE') then raise exception using errcode='22023',message='Invalid action'; end if;
 if role_name='setter' and p_action in ('CLOSE_WON','CLOSE_LOST') then raise exception using errcode='42501',message='Sales closing permission required'; end if;
 if p_input is null or jsonb_typeof(p_input)<>'object' or octet_length(p_input::text)>16000 then raise exception using errcode='22023',message='Invalid input'; end if;
 select * into l from crm.leads where workspace_id=p_workspace and id=p_lead for update;
 if not private.can_work_lead(p_workspace,p_lead) then raise exception using errcode='42501',message='Lead access changed'; end if;
 req:=jsonb_build_object('command','sales','lead',p_lead,'action',p_action,'version',p_version,'input',p_input);
 replay:=private.command_begin(p_workspace,p_command_key,req); if replay is not null then return replay; end if;
 select * into j from crm.lead_journeys where workspace_id=p_workspace and lead_id=p_lead and lifecycle='active' for update;
 if not found or j.version is distinct from p_version then raise exception using errcode='40001',message='Active journey changed'; end if;
 setter:=l.assigned_setter_id;closer:=l.assigned_closer_id;
 if p_action='SET' then
   closer:=coalesce((p_input->>'closer_id')::uuid,closer);
   if closer is not null and not exists(select 1 from crm.memberships x where x.workspace_id=p_workspace and x.id=closer and x.status='active' and x.role in ('closer','manager','admin') and (role_name='admin' or exists(select 1 from crm.team_memberships t where t.workspace_id=p_workspace and t.membership_id=x.id and t.team_id=l.accountable_team_id))) then raise exception using errcode='42501',message='Eligible closer in lead team required'; end if;
   start_time:=(p_input->>'start_at')::timestamptz;end_time:=(p_input->>'end_at')::timestamptz;zone:=p_input->>'timezone';
   if start_time is null or end_time is null or end_time<=start_time or not exists(select 1 from pg_timezone_names where name=zone) then raise exception using errcode='22023',message='Valid meeting schedule and timezone required'; end if;
   if exists(select 1 from crm.meetings where workspace_id=p_workspace and journey_id=j.id and booking_state<>'cancelled' and attendance='unknown') then raise exception using errcode='40001',message='An unresolved booking already exists'; end if;
   insert into crm.meetings(workspace_id,lead_id,journey_id,title,meeting_type,start_at,end_at,timezone,booking_state,setter_credit_membership_id,closer_credit_membership_id,team_credit_id,created_by)
   values(p_workspace,p_lead,j.id,p_input->>'title',coalesce(p_input->>'meeting_type','sales'),start_time,end_time,zone,'booked',setter,closer,l.accountable_team_id,a) returning * into m;
   mid:=m.id;target:='meeting_booked';
   if closer is distinct from l.assigned_closer_id then
     update crm.leads set assigned_closer_id=closer,version=version+1,updated_at=now() where id=p_lead;
     insert into crm.assignment_history(workspace_id,lead_id,assignment_role,old_membership_id,new_membership_id,reason,actor_membership_id) values(p_workspace,p_lead,'closer',l.assigned_closer_id,closer,'Meeting assignment',a);
   end if;
 elsif p_action in ('CONFIRM','SHOW','NO_SHOW','CANCEL','RESCHEDULE') then
   select * into m from crm.meetings where workspace_id=p_workspace and lead_id=p_lead and journey_id=j.id and id=(p_input->>'meeting_id')::uuid for update;
   if not found then raise exception using errcode='42501',message='Meeting unavailable'; end if;
   if m.version is distinct from (p_input->>'meeting_version')::bigint then raise exception using errcode='40001',message='Meeting changed'; end if;
   if m.booking_state='cancelled' or m.attendance<>'unknown' then raise exception using errcode='22023',message='Meeting outcome is final'; end if;
   if p_action='CONFIRM' and m.booking_state='confirmed' then raise exception using errcode='40001',message='Meeting already confirmed'; end if;
   previous:=to_jsonb(m);mid:=m.id;setter:=m.setter_credit_membership_id;closer:=m.closer_credit_membership_id;
   if p_action='RESCHEDULE' then
     start_time:=(p_input->>'start_at')::timestamptz;end_time:=(p_input->>'end_at')::timestamptz;zone:=p_input->>'timezone';
     if start_time is null or end_time is null or end_time<=start_time or not exists(select 1 from pg_timezone_names where name=zone) then raise exception using errcode='22023',message='Valid schedule required'; end if;
   end if;
   update crm.meetings set
    booking_state=case p_action when 'CONFIRM' then 'confirmed' when 'CANCEL' then 'cancelled' when 'RESCHEDULE' then 'rescheduled' else booking_state end,
    attendance=case p_action when 'SHOW' then 'showed' when 'NO_SHOW' then 'no_show' else attendance end,
    start_at=coalesce(start_time,start_at),end_at=coalesce(end_time,end_at),timezone=coalesce(zone,timezone),version=version+1,updated_at=now()
   where id=m.id returning * into m;
   target:=case p_action when 'CONFIRM' then 'confirmed' when 'SHOW' then 'showed' when 'RESCHEDULE' then 'meeting_booked' else null end;
 elsif p_action in ('CLOSE_WON','CLOSE_LOST') then
   if p_action='CLOSE_WON' and (p_input->>'amount_minor' is null or p_input->>'amount_minor' !~ '^[0-9]{1,18}$') then raise exception using errcode='22023',message='Integer minor-unit deal amount required'; end if;
   amount:=case when p_action='CLOSE_WON' then (p_input->>'amount_minor')::bigint else 0 end;
   curr:=p_input->>'currency';
   if curr is null or curr !~ '^[A-Z]{3}$' then raise exception using errcode='22023',message='Currency required'; end if;
   lost:=(p_input->>'lost_reason_id')::uuid;
   if p_action='CLOSE_LOST' and not exists(select 1 from crm.lost_reasons where workspace_id=p_workspace and id=lost and archived_at is null) then raise exception using errcode='22023',message='Lost reason required'; end if;
   if p_input->>'meeting_id' is not null then
    select * into m from crm.meetings where workspace_id=p_workspace and lead_id=p_lead and journey_id=j.id and id=(p_input->>'meeting_id')::uuid;
    if not found then raise exception using errcode='42501',message='Meeting unavailable'; end if;
   else
    select * into m from crm.meetings where workspace_id=p_workspace and lead_id=p_lead and journey_id=j.id and attendance='showed' order by start_at desc,id desc limit 1;
   end if;
   mid:=m.id;setter:=coalesce(m.setter_credit_membership_id,setter);closer:=coalesce(m.closer_credit_membership_id,closer);
   insert into crm.deals(workspace_id,lead_id,journey_id,meeting_id,title,status,currency,deal_value_minor,setter_credit_membership_id,closer_credit_membership_id,team_credit_id,won_at,lost_at,lost_reason_id,created_by)
   values(p_workspace,p_lead,j.id,mid,coalesce(nullif(p_input->>'title',''),l.display_name),case p_action when 'CLOSE_WON' then 'won' else 'lost' end,curr,amount,setter,closer,coalesce(m.team_credit_id,l.accountable_team_id),case when p_action='CLOSE_WON' then now() end,case when p_action='CLOSE_LOST' then now() end,lost,a) returning id into did;
   target:=case p_action when 'CLOSE_WON' then 'closed_won' else 'closed_lost' end;
 else
   due:=(p_input->>'due_at')::timestamptz;
   if due is null or due<=now() then raise exception using errcode='22023',message='Future next action required'; end if;
   task_id:=api.create_task(p_workspace,p_lead,a,coalesce(nullif(p_input->>'task_title',''),'Follow up'),due,'medium');
   target:=case p_action when 'NURTURE' then 'nurture' else 'follow_up_decision' end;
 end if;
 if target is not null then
   select id into sid from crm.stages where workspace_id=p_workspace and pipeline_id=j.pipeline_id and stable_code=target;
   if sid is null then raise exception using errcode='22023',message='Pipeline stage unavailable'; end if;
   update crm.lead_journeys set stage_id=sid,version=version+1,updated_at=now(),lifecycle=case p_action when 'CLOSE_WON' then 'won'::crm.journey_lifecycle when 'CLOSE_LOST' then 'lost'::crm.journey_lifecycle else 'active'::crm.journey_lifecycle end,closed_at=case when did is not null then now() end,lost_reason_id=lost where id=j.id;
   insert into crm.journey_transitions(workspace_id,journey_id,from_stage_id,to_stage_id,actor_membership_id) values(p_workspace,j.id,j.stage_id,sid,a);
 else
   update crm.lead_journeys set version=version+1,updated_at=now() where id=j.id;
 end if;
 insert into crm.activities(workspace_id,lead_id,journey_id,aggregate_type,aggregate_id,aggregate_version,event_type,actor_membership_id,payload)
 values(p_workspace,p_lead,j.id,'journey',j.id,j.version+1,'sales.'||lower(p_action),a,jsonb_build_object('action',p_action,'meeting_id',mid,'deal_id',did,'task_id',task_id)) returning id into aid;
 if mid is not null and p_action not in ('CLOSE_WON','CLOSE_LOST') then
   insert into crm.meeting_events(workspace_id,lead_id,meeting_id,revision,event_type,before_state,after_state,activity_id) values(p_workspace,p_lead,mid,m.version,p_action,previous,to_jsonb(m),aid);
 end if;
 insert into crm.sales_outcomes(workspace_id,lead_id,journey_id,meeting_id,deal_id,action,actor_membership_id,setter_credit_membership_id,closer_credit_membership_id,team_credit_id,activity_id)
 values(p_workspace,p_lead,j.id,mid,did,p_action,a,setter,closer,coalesce(m.team_credit_id,l.accountable_team_id),aid);
 if p_action='CLOSE_WON' and p_input->>'payment_minor' is not null then
   payment_result:=api.payment_command(p_workspace,p_lead,did,p_command_key||':payment',jsonb_build_object('kind','paid','amount_minor',p_input->>'payment_minor','currency',curr,'method',p_input->>'payment_method'));
 end if;
 result:=jsonb_build_object('journey_id',j.id,'version',j.version+1,'meeting_id',mid,'meeting_version',m.version,'deal_id',did,'activity_id',aid,'payment',payment_result);
 perform private.command_finish(p_workspace,p_command_key,req,result);
 return result;
end $$;

create function api.payment_command(p_workspace uuid,p_lead uuid,p_deal uuid,p_command_key text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.member_id(p_workspace);d crm.deals;e crm.payment_entries;req jsonb;replay jsonb;result jsonb;k text;amount bigint;original uuid;remaining bigint;aid uuid;pid uuid;paid timestamptz;
begin
 if not private.can_work_lead(p_workspace,p_lead) or private.member_role(p_workspace) not in ('admin','manager','closer') then raise exception using errcode='42501',message='Financial permission required'; end if;
 perform 1 from crm.leads where workspace_id=p_workspace and id=p_lead for update;
 select * into d from crm.deals where workspace_id=p_workspace and lead_id=p_lead and id=p_deal and status='won' for update;
 if not found then raise exception using errcode='42501',message='Won deal required'; end if;
 req:=jsonb_build_object('command','payment','lead',p_lead,'deal',p_deal,'input',p_input);
 replay:=private.command_begin(p_workspace,p_command_key,req);if replay is not null then return replay;end if;
 k:=p_input->>'kind';
 if k is null or k not in ('recorded','paid','refund','void') or p_input->>'amount_minor' is null or p_input->>'amount_minor' !~ '^[1-9][0-9]{0,17}$' or (p_input->>'currency') is distinct from d.currency then raise exception using errcode='22023',message='Valid amount, kind and matching currency required'; end if;
 amount:=(p_input->>'amount_minor')::bigint;original:=(p_input->>'original_entry_id')::uuid;paid:=coalesce((p_input->>'paid_at')::timestamptz,now());
 if paid>now() then raise exception using errcode='22023',message='Payment cannot be dated in the future'; end if;
 if k in ('refund','void') and private.member_role(p_workspace)<>'admin' and not exists(select 1 from crm.membership_capabilities where workspace_id=p_workspace and membership_id=a and capability='refund' and (expires_at is null or expires_at>now())) then raise exception using errcode='42501',message='Refund capability required'; end if;
 if k in ('refund','void') and (original is null or length(btrim(coalesce(p_input->>'reason','')))=0) then raise exception using errcode='22023',message='Original payment and reason required'; end if;
 if original is not null then
   select * into e from crm.payment_entries where workspace_id=p_workspace and deal_id=p_deal and id=original for update;
   if not found then raise exception using errcode='42501',message='Original payment unavailable'; end if;
   if paid<e.paid_at then raise exception using errcode='22023',message='Correction cannot precede original entry'; end if;
   if k='paid' then
    if e.kind<>'recorded' or amount<>e.amount_minor or exists(select 1 from crm.payment_entries where workspace_id=p_workspace and original_entry_id=original) then raise exception using errcode='40001',message='Pending payment already settled'; end if;
   elsif k='refund' then
    if e.kind<>'paid' then raise exception using errcode='22023',message='Refund requires receipt'; end if;
    select e.amount_minor-coalesce(sum(amount_minor) filter(where kind='refund'),0) into remaining from crm.payment_entries where workspace_id=p_workspace and original_entry_id=original;
    if amount>remaining then raise exception using errcode='22023',message='Refund exceeds receipt balance'; end if;
   elsif k='void' then
    if e.kind<>'recorded' or amount<>e.amount_minor or exists(select 1 from crm.payment_entries where workspace_id=p_workspace and original_entry_id=original) then raise exception using errcode='40001',message='Only unsettled pending entries can be voided'; end if;
   else raise exception using errcode='22023',message='Invalid original entry'; end if;
 elsif k not in ('recorded','paid') then raise exception using errcode='22023',message='Original payment required';
 end if;
 insert into crm.activities(workspace_id,lead_id,journey_id,aggregate_type,aggregate_id,event_type,actor_membership_id,payload) values(p_workspace,p_lead,d.journey_id,'deal',d.id,'payment.'||k,a,jsonb_build_object('amount_minor',amount::text,'currency',d.currency,'original_entry_id',original)) returning id into aid;
 insert into crm.payment_entries(workspace_id,lead_id,deal_id,kind,amount_minor,currency,original_entry_id,method,reason,paid_at,recorded_by,activity_id)
 values(p_workspace,p_lead,p_deal,k,amount,d.currency,original,p_input->>'method',p_input->>'reason',paid,a,aid) returning id into pid;
 result:=jsonb_build_object('payment_id',pid,'activity_id',aid);perform private.command_finish(p_workspace,p_command_key,req,result);return result;
end $$;
-- NEXT_SECTION
-- Correct the existing bounded board without changing its API contract.
create or replace function api.pipeline_board(p_workspace uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare board jsonb;begin
 if private.member_id(p_workspace) is null then raise exception using errcode='42501',message='Active membership required';end if;
 select jsonb_agg(jsonb_build_object('stage_code',s.stable_code,'label',s.label,'category',s.category,'sort_order',s.sort_order,'leads',coalesce((
 select jsonb_agg(to_jsonb(q)) from (
 select l.id,l.display_name,l.company,j.version as journey_version,l.created_at,nap.due_at as next_action_due,t.title as next_action_title,
 (select p.display_name from crm.memberships m join crm.profiles p on p.user_id=m.user_id where m.id=l.assigned_setter_id) setter_name,
 (select p.display_name from crm.memberships m join crm.profiles p on p.user_id=m.user_id where m.id=l.assigned_closer_id) closer_name
 from crm.lead_journeys j join crm.leads l on l.workspace_id=j.workspace_id and l.id=j.lead_id
 left join crm.next_action_projection nap on nap.workspace_id=l.workspace_id and nap.lead_id=l.id left join crm.tasks t on t.workspace_id=nap.workspace_id and t.id=nap.task_id
 where j.workspace_id=p_workspace and j.stage_id=s.id and l.status='active' and private.can_read_lead(p_workspace,l.id)
 order by l.updated_at desc,l.id desc limit 100) q),'[]')) order by s.sort_order) into board
 from crm.stages s join crm.pipelines p on p.workspace_id=s.workspace_id and p.id=s.pipeline_id and p.is_default where s.workspace_id=p_workspace;
 return coalesce(board,'[]');
end $$;
-- The cursor is database-owned; eligibility is rechecked inside the same lock.
create function api.apply_assignment_rule(p_workspace uuid,p_lead uuid,p_rule_version uuid,p_version bigint,p_command_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare v crm.assignment_rule_versions;r crm.assignment_rules;c crm.assignment_cursors;candidate uuid;chosen uuid;pos int;total int;req jsonb;replay jsonb;result jsonb;
begin
 if private.member_role(p_workspace) not in ('admin','manager') or not private.can_work_lead(p_workspace,p_lead) then raise exception using errcode='42501',message='Assignment permission required';end if;
 perform 1 from crm.leads where workspace_id=p_workspace and id=p_lead for update;
 req:=jsonb_build_object('command','apply_assignment_rule','lead',p_lead,'rule_version',p_rule_version,'version',p_version);
 replay:=private.command_begin(p_workspace,p_command_key,req);if replay is not null then return replay;end if;
 select * into v from crm.assignment_rule_versions where workspace_id=p_workspace and id=p_rule_version;
 select * into r from crm.assignment_rules where workspace_id=p_workspace and id=v.rule_id and status='active';
 if r.id is null or r.strategy not in ('fixed','round_robin') then raise exception using errcode='22023',message='Published automatic rule required';end if;
 total:=cardinality(v.candidate_membership_ids);
 if total is null or total=0 then raise exception using errcode='22023',message='Candidates required';end if;
 insert into crm.assignment_cursors(workspace_id,rule_version_id) values(p_workspace,v.id) on conflict(workspace_id,rule_version_id) do nothing;
 select * into c from crm.assignment_cursors where workspace_id=p_workspace and rule_version_id=v.id for update;
 for i in 0..total-1 loop
  pos:=case r.strategy when 'fixed' then i else (c.next_position+i)%total end;candidate:=v.candidate_membership_ids[pos+1];
  if exists(select 1 from crm.memberships m where m.workspace_id=p_workspace and m.id=candidate and m.status='active' and (m.role::text=r.target_role::text or m.role in ('admin','manager')) and (r.team_id is null or exists(select 1 from crm.team_memberships t where t.workspace_id=p_workspace and t.team_id=r.team_id and t.membership_id=m.id))) then chosen:=candidate;exit;end if;
 end loop;
 if chosen is null then raise exception using errcode='22023',message='No eligible candidate';end if;
 perform api.assign_lead(p_workspace,p_lead,case when r.target_role='setter' then chosen end,case when r.target_role='closer' then chosen end,r.team_id,'Rule assignment',p_version);
 update crm.assignment_cursors set next_position=(pos+1)%total,updated_at=now() where id=c.id;
 result:=jsonb_build_object('membership_id',chosen);perform private.command_finish(p_workspace,p_command_key,req,result);return result;
end $$;
create trigger immutable_deal before update or delete on crm.deals for each row execute function private.reject_activity_mutation();
create trigger immutable_rule_version before update or delete on crm.assignment_rule_versions for each row execute function private.reject_activity_mutation();
create index meeting_events_lead on crm.meeting_events(workspace_id,lead_id,occurred_at);
create index payment_entries_lead on crm.payment_entries(workspace_id,lead_id,paid_at);
create index task_event_history on crm.task_events(workspace_id,task_id,occurred_at desc);
alter table crm.task_events add column event_order bigint generated always as identity;
-- NEXT_SECTION
create function private.can_report_fact(w uuid,team uuid,actor uuid,setter uuid,closer uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.member_id(w) is not null and (
 private.member_role(w)='admin' or
 (private.member_role(w)='manager' and exists(select 1 from crm.team_memberships t where t.workspace_id=w and t.team_id=team and t.membership_id=private.member_id(w) and t.is_manager)) or
 (private.member_role(w) in ('setter','closer') and private.member_id(w) in (actor,setter,closer)) or
 (private.member_role(w)='read_only' and exists(select 1 from crm.report_scope_grants g where g.workspace_id=w and g.membership_id=private.member_id(w) and (g.expires_at is null or g.expires_at>now()) and (g.scope='workspace' or (g.scope='team' and g.team_id=team) or (g.scope='own_credit' and private.member_id(w) in (actor,setter,closer)))))
 )
$$;
create function api.sales_detail(p_workspace uuid,p_lead uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.can_read_lead(p_workspace,p_lead) then raise exception using errcode='42501',message='Lead access required'; end if;
 return jsonb_build_object(
 'meetings',coalesce((select jsonb_agg(to_jsonb(x) order by x.start_at desc) from (select * from crm.meetings where workspace_id=p_workspace and lead_id=p_lead order by start_at desc,id desc limit 100) x),'[]'),
 'deals',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('deal_value_minor',x.deal_value_minor::text)) from (select * from crm.deals where workspace_id=p_workspace and lead_id=p_lead order by created_at desc,id desc limit 100) x),'[]'),
 'payments',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('amount_minor',x.amount_minor::text)) from (select * from crm.payment_entries where workspace_id=p_workspace and lead_id=p_lead order by created_at desc,id desc limit 100) x),'[]'));
end $$;

create function api.sales_report(p_workspace uuid,p_from date,p_to date,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare zone text;lo timestamptz;hi timestamptz;who uuid:=(p_filters->>'member_id')::uuid;setter uuid:=(p_filters->>'setter_id')::uuid;closer uuid:=(p_filters->>'closer_id')::uuid;team uuid:=(p_filters->>'team_id')::uuid;
 action_filter text:=p_filters->>'outcome';metrics jsonb;currencies jsonb;drilldown jsonb;stages jsonb;task_stats jsonb;lead_stats jsonb;performance jsonb;denominators jsonb;evidence jsonb;page_offset int:=coalesce((p_filters->>'offset')::int,0);
begin
 if private.member_id(p_workspace) is null then raise exception using errcode='42501',message='Active membership required'; end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or page_offset not between 0 and 100000 then raise exception using errcode='22023',message='Valid date range (maximum 367 days) and page required'; end if;
 select timezone into zone from crm.workspaces where id=p_workspace;
 lo:=p_from::timestamp at time zone zone;hi:=(p_to+1)::timestamp at time zone zone;
 -- Historical facts are authorized by frozen team/rep credit, never by browser roles.
 with facts as (select o.* from crm.sales_outcomes o where o.workspace_id=p_workspace and o.occurred_at>=lo and o.occurred_at<hi
 and private.can_report_fact(p_workspace,o.team_credit_id,o.actor_membership_id,o.setter_credit_membership_id,o.closer_credit_membership_id)
 and (who is null or who in (o.actor_membership_id,o.setter_credit_membership_id,o.closer_credit_membership_id)) and (setter is null or setter=o.setter_credit_membership_id) and (closer is null or closer=o.closer_credit_membership_id) and (team is null or team=o.team_credit_id) and (action_filter is null or action_filter=o.action))
 select coalesce((select jsonb_object_agg(action,n) from (select action,count(*) n from facts group by action) q),'{}'),
 coalesce((select jsonb_agg(jsonb_build_object('activity_id',activity_id,'lead_id',case when private.can_read_lead(p_workspace,lead_id) then lead_id end,'action',action,'at',occurred_at) order by occurred_at desc,id desc) from (select * from facts order by occurred_at desc,id desc limit 100 offset page_offset) q),'[]'),
 coalesce((select jsonb_agg(activity_id) from facts),'[]') into metrics,drilldown,evidence;
 with money as (
 select d.currency,d.deal_value_minor as value_minor,0::bigint as cash_minor from crm.deals d where d.workspace_id=p_workspace and d.status='won' and d.won_at>=lo and d.won_at<hi and private.can_report_fact(p_workspace,d.team_credit_id,d.created_by,d.setter_credit_membership_id,d.closer_credit_membership_id)
 and (who is null or who in (d.created_by,d.setter_credit_membership_id,d.closer_credit_membership_id)) and (setter is null or setter=d.setter_credit_membership_id) and (closer is null or closer=d.closer_credit_membership_id) and (team is null or team=d.team_credit_id) and (action_filter is null or action_filter='CLOSE_WON')
 union all
 select p.currency,0,case p.kind when 'paid' then p.amount_minor when 'refund' then -p.amount_minor else 0 end from crm.payment_entries p join crm.deals d on d.workspace_id=p.workspace_id and d.id=p.deal_id where p.workspace_id=p_workspace and p.paid_at>=lo and p.paid_at<hi and private.can_report_fact(p_workspace,d.team_credit_id,d.created_by,d.setter_credit_membership_id,d.closer_credit_membership_id)
 and (who is null or who in (d.created_by,d.setter_credit_membership_id,d.closer_credit_membership_id)) and (setter is null or setter=d.setter_credit_membership_id) and (closer is null or closer=d.closer_credit_membership_id) and (team is null or team=d.team_credit_id) and (action_filter is null or action_filter='CLOSE_WON'))
 select coalesce(jsonb_agg(jsonb_build_object('currency',currency,'deal_value_minor',value_minor::text,'cash_minor',cash_minor::text)),'[]') into currencies from (select currency,sum(value_minor) value_minor,sum(cash_minor) cash_minor from money group by currency) q;
 select jsonb_build_object('created',count(*) filter(where l.created_at>=lo and l.created_at<hi),'worked',(select count(distinct a.lead_id) from crm.activities a join crm.leads d on d.id=a.lead_id and d.workspace_id=a.workspace_id where a.workspace_id=p_workspace and a.occurred_at>=lo and a.occurred_at<hi and a.event_type in ('stage.transitioned','note.created','task.completed','sales.set','sales.show','sales.follow_up') and private.can_read_lead(p_workspace,a.lead_id) and (who is null or a.actor_membership_id=who) and (setter is null or setter=d.assigned_setter_id) and (closer is null or closer=d.assigned_closer_id) and (team is null or team=d.accountable_team_id))) into lead_stats
 from crm.leads l where l.workspace_id=p_workspace and private.can_read_lead(p_workspace,l.id) and (who is null or who in (l.created_by_membership_id,l.assigned_setter_id,l.assigned_closer_id)) and (setter is null or setter=l.assigned_setter_id) and (closer is null or closer=l.assigned_closer_id) and (team is null or team=l.accountable_team_id);
 select coalesce(jsonb_agg(jsonb_build_object('stage',stable_code,'count',n)),'[]') into stages from (
 select s.stable_code,count(*) n from crm.lead_journeys j join crm.stages s on s.id=j.stage_id join crm.leads l on l.id=j.lead_id where j.workspace_id=p_workspace and private.can_read_lead(p_workspace,l.id) and (who is null or who in (l.assigned_setter_id,l.assigned_closer_id,l.created_by_membership_id)) and (setter is null or setter=l.assigned_setter_id) and (closer is null or closer=l.assigned_closer_id) and (team is null or team=l.accountable_team_id) group by s.stable_code) q;
 select jsonb_build_object('outstanding',count(*) filter(where t.status='open'),'overdue',count(*) filter(where t.status='open' and t.due_at<least(hi,now())),'completed',(select count(*) from crm.activities a where a.workspace_id=p_workspace and a.event_type='task.completed' and a.occurred_at>=lo and a.occurred_at<hi and private.can_read_lead(p_workspace,a.lead_id) and (who is null or a.actor_membership_id=who))) into task_stats
 from crm.tasks t join crm.leads l on l.workspace_id=t.workspace_id and l.id=t.lead_id where t.workspace_id=p_workspace and private.can_read_lead(p_workspace,t.lead_id) and (who is null or t.assignee_membership_id=who) and (setter is null or setter=l.assigned_setter_id) and (closer is null or closer=l.assigned_closer_id) and (team is null or team=l.accountable_team_id);
 -- Attendance cohort: scheduled in range, resolved attendance only. Pending/cancelled are excluded from denominator.
 select jsonb_build_object('attendance_resolved',count(*) filter(where m.attendance in ('showed','no_show')),'attendance_showed',count(*) filter(where m.attendance='showed'),'closed_decisions',coalesce((metrics->>'CLOSE_WON')::bigint,0)+coalesce((metrics->>'CLOSE_LOST')::bigint,0),'closed_won',coalesce((metrics->>'CLOSE_WON')::bigint,0)) into denominators
 from crm.meetings m where m.workspace_id=p_workspace and m.start_at>=lo and m.start_at<hi and m.booking_state<>'cancelled' and private.can_report_fact(p_workspace,m.team_credit_id,m.created_by,m.setter_credit_membership_id,m.closer_credit_membership_id) and (who is null or who in (m.created_by,m.setter_credit_membership_id,m.closer_credit_membership_id)) and (setter is null or setter=m.setter_credit_membership_id) and (closer is null or closer=m.closer_credit_membership_id) and (team is null or team=m.team_credit_id);
 denominators:=denominators||(select jsonb_build_object('closed_decisions',count(*),'closed_won',count(*) filter(where o.action='CLOSE_WON')) from crm.sales_outcomes o where o.workspace_id=p_workspace and o.occurred_at>=lo and o.occurred_at<hi and o.action in ('CLOSE_WON','CLOSE_LOST') and private.can_report_fact(p_workspace,o.team_credit_id,o.actor_membership_id,o.setter_credit_membership_id,o.closer_credit_membership_id) and (who is null or who in (o.actor_membership_id,o.setter_credit_membership_id,o.closer_credit_membership_id)) and (setter is null or setter=o.setter_credit_membership_id) and (closer is null or closer=o.closer_credit_membership_id) and (team is null or team=o.team_credit_id));
 select coalesce(jsonb_agg(jsonb_build_object('membership_id',member_id,'credit_role',credit_role,'action',action,'count',n)),'[]') into performance from (
 select c.member_id,c.credit_role,o.action,count(*) n from crm.sales_outcomes o cross join lateral(values(o.setter_credit_membership_id,'setter'),(o.closer_credit_membership_id,'closer')) c(member_id,credit_role)
 where o.workspace_id=p_workspace and o.occurred_at>=lo and o.occurred_at<hi and c.member_id is not null and private.can_report_fact(p_workspace,o.team_credit_id,o.actor_membership_id,o.setter_credit_membership_id,o.closer_credit_membership_id)
 and (who is null or who in (o.actor_membership_id,o.setter_credit_membership_id,o.closer_credit_membership_id)) and (setter is null or setter=o.setter_credit_membership_id) and (closer is null or closer=o.closer_credit_membership_id) and (team is null or team=o.team_credit_id) and (action_filter is null or action_filter=o.action) group by c.member_id,c.credit_role,o.action) q;
 return jsonb_build_object('from',p_from,'to',p_to,'timezone',zone,'as_of',now(),'outcomes',metrics,'currencies',currencies,'leads',lead_stats,'tasks',task_stats,'stage_distribution',stages,'denominators',denominators,'performance',performance,'drilldown',drilldown,'evidence_activity_ids',evidence,'offset',page_offset);
end $$;

create function api.submit_eod(p_workspace uuid,p_date date,p_revision bigint,p_command_key text,p_qualitative jsonb,p_state text default 'submitted') returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=private.member_id(p_workspace);r crm.eod_reports;v bigint;req jsonb;replay jsonb;facts jsonb;result jsonb;zone text;
begin
 if a is null or private.member_role(p_workspace)='read_only' then raise exception using errcode='42501',message='Active contributor required'; end if;
 select timezone into zone from crm.workspaces where id=p_workspace;
 if p_date is null or p_date>(now() at time zone zone)::date or p_state not in ('draft','submitted','amended') or p_qualitative is null or jsonb_typeof(p_qualitative)<>'object' or octet_length(p_qualitative::text)>16000 or exists(select 1 from jsonb_object_keys(p_qualitative) k where k not in ('wins','blockers','observations','help_needed','next_day_priority')) then raise exception using errcode='22023',message='Invalid EOD date or fields'; end if;
 req:=jsonb_build_object('command','eod','date',p_date,'revision',p_revision,'qualitative',p_qualitative,'state',p_state);
 replay:=private.command_begin(p_workspace,p_command_key,req);if replay is not null then return replay;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_workspace::text||a::text||p_date::text,1));
 insert into crm.eod_reports(workspace_id,membership_id,business_date,timezone) values(p_workspace,a,p_date,zone) on conflict(workspace_id,membership_id,business_date) do nothing;
 select * into r from crm.eod_reports where workspace_id=p_workspace and membership_id=a and business_date=p_date for update;
 select coalesce(max(revision),0) into v from crm.eod_revisions where workspace_id=p_workspace and report_id=r.id;
 if v is distinct from p_revision then raise exception using errcode='40001',message='EOD revision changed'; end if;
 if exists(select 1 from crm.eod_revisions where report_id=r.id and state in ('submitted','amended')) and p_state<>'amended' then raise exception using errcode='22023',message='Submitted EOD requires amendment'; end if;
 facts:=api.sales_report(p_workspace,p_date,p_date,jsonb_build_object('member_id',a));
 -- Freeze task state at the selected business-day cutoff, not today's mutable status.
 facts:=jsonb_set(facts,'{tasks}',(
 select jsonb_build_object('outstanding',count(*) filter(where q.action in ('created','reopened')),'overdue',count(*) filter(where q.action in ('created','reopened') and t.due_at<least(now(),((p_date+1)::timestamp at time zone zone))),'completed',
 (select count(*) from crm.task_events e where e.workspace_id=p_workspace and e.actor_membership_id=a and e.action='completed' and e.occurred_at>=(p_date::timestamp at time zone zone) and e.occurred_at<((p_date+1)::timestamp at time zone zone)))
 from crm.tasks t join lateral(select e.action from crm.task_events e where e.workspace_id=t.workspace_id and e.task_id=t.id and e.occurred_at<=least(now(),((p_date+1)::timestamp at time zone zone)) order by e.occurred_at desc,e.event_order desc limit 1) q on true
 where t.workspace_id=p_workspace and t.assignee_membership_id=a and t.created_at<=least(now(),((p_date+1)::timestamp at time zone zone))));
 insert into crm.eod_revisions(workspace_id,report_id,revision,state,qualitative,facts,created_by) values(p_workspace,r.id,v+1,p_state,p_qualitative,facts,a);
 result:=jsonb_build_object('report_id',r.id,'revision',v+1);perform private.command_finish(p_workspace,p_command_key,req,result);return result;
end $$;
create function api.eod_history(p_workspace uuid,p_date date,p_member uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare who uuid:=coalesce(p_member,private.member_id(p_workspace));begin
 if not coalesce(private.can_read_member(p_workspace,who),false) then raise exception using errcode='42501',message='EOD scope denied';end if;
 return coalesce((select jsonb_agg(to_jsonb(v) order by revision desc) from crm.eod_revisions v join crm.eod_reports r on r.workspace_id=v.workspace_id and r.id=v.report_id where r.workspace_id=p_workspace and r.membership_id=who and r.business_date=p_date),'[]');
end $$;
-- NEXT_SECTION
revoke all on all functions in schema private,api from public,anon,authenticated;
grant execute on function private.member_id(uuid),private.member_role(uuid),private.can_read_team(uuid,uuid),private.can_read_member(uuid,uuid),private.can_read_lead(uuid,uuid),private.can_work_lead(uuid,uuid) to authenticated;
grant execute on all functions in schema api to authenticated;
reset role;
commit;
