-- Phase 1 only. Run as migration administrator. No app role owns tables/functions.
begin;
create role crm_owner nologin noinherit;
create schema crm authorization crm_owner;
create schema private authorization crm_owner;
create schema api authorization crm_owner;
revoke all on schema crm, private, api from public, anon, authenticated;
grant usage on schema crm, private, api to authenticated;
grant usage on schema auth to crm_owner;
grant execute on function auth.uid(), auth.jwt() to crm_owner;
grant select (id, email, email_confirmed_at) on auth.users to crm_owner;
grant references (id) on auth.users to crm_owner;
set local role crm_owner;
-- Per-schema revocation cannot remove PostgreSQL's global PUBLIC function default.
alter default privileges revoke execute on functions from public;
alter default privileges in schema crm, private, api revoke execute on functions from public;
alter default privileges in schema crm, private, api revoke all on tables from public, anon, authenticated;

create type crm.member_role as enum ('admin','manager','setter','closer','read_only');
create table crm.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  timezone text not null default 'UTC',
  default_currency text not null default 'USD' check (default_currency ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active','suspended','archived')),
  settings_version bigint not null default 1 check (settings_version > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0)
);
-- Profile is global self-only identity display, never a workspace entitlement.
create table crm.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version bigint not null default 1
);
create table crm.memberships (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references crm.workspaces(id),
  user_id uuid not null references auth.users(id), role crm.member_role not null,
  is_owner boolean not null default false, status text not null default 'active' check (status in ('active','inactive')),
  deactivated_at timestamptz,
  created_by_membership_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  unique (workspace_id,id), unique (workspace_id,user_id),
  check (not is_owner or role = 'admin'),
  check ((status='inactive') = (deactivated_at is not null)),
  foreign key (workspace_id,created_by_membership_id) references crm.memberships(workspace_id,id)
);
create index memberships_user_workspace on crm.memberships(user_id,workspace_id) where status='active';
create table crm.teams (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references crm.workspaces(id),
  name text not null check (length(btrim(name)) between 1 and 120),
  status text not null default 'active' check (status in ('active','archived')),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version bigint not null default 1,
  unique (workspace_id,id),
  foreign key (workspace_id,created_by_membership_id) references crm.memberships(workspace_id,id)
);
create unique index teams_active_name on crm.teams(workspace_id,lower(name)) where status='active';
create table crm.team_memberships (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references crm.workspaces(id),
  team_id uuid not null, membership_id uuid not null, is_manager boolean not null default false,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), version bigint not null default 1,
  unique (workspace_id,id), unique (workspace_id,team_id,membership_id),
  foreign key (workspace_id,team_id) references crm.teams(workspace_id,id),
  foreign key (workspace_id,membership_id) references crm.memberships(workspace_id,id),
  foreign key (workspace_id,created_by_membership_id) references crm.memberships(workspace_id,id)
);
create index team_membership_member on crm.team_memberships(workspace_id,membership_id,team_id);
create table crm.membership_capabilities (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references crm.workspaces(id),
  membership_id uuid not null, capability text not null check (capability in ('export','merge','refund')),
  granted_by uuid not null, expires_at timestamptz, created_at timestamptz not null default now(),
  unique (workspace_id,id), unique (workspace_id,membership_id,capability),
  foreign key (workspace_id,membership_id) references crm.memberships(workspace_id,id),
  foreign key (workspace_id,granted_by) references crm.memberships(workspace_id,id)
);
create table crm.report_scope_grants (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references crm.workspaces(id),
  membership_id uuid not null, scope text not null check (scope in ('workspace','team','own_credit')),
  team_id uuid, detail_level text not null check (detail_level in ('summary','lead_detail')),
  granted_by uuid not null, expires_at timestamptz, created_at timestamptz not null default now(),
  unique (workspace_id,id), check ((scope='team') = (team_id is not null)),
  foreign key (workspace_id,membership_id) references crm.memberships(workspace_id,id),
  foreign key (workspace_id,team_id) references crm.teams(workspace_id,id),
  foreign key (workspace_id,granted_by) references crm.memberships(workspace_id,id)
);
create index report_grants_member on crm.report_scope_grants(workspace_id,membership_id);
create table private.invitations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references crm.workspaces(id),
  intended_email text not null check (length(intended_email) <= 254 and intended_email = lower(btrim(intended_email))),
  role crm.member_role not null, team_id uuid, token_digest text not null unique,
  expires_at timestamptz not null, consumed_at timestamptz, revoked_at timestamptz,
  consumed_by_user_id uuid references auth.users(id), created_by_membership_id uuid not null,
  created_at timestamptz not null default now(), unique (workspace_id,id),
  check (expires_at > created_at), check ((consumed_at is null) = (consumed_by_user_id is null)),
  foreign key (workspace_id,team_id) references crm.teams(workspace_id,id),
  foreign key (workspace_id,created_by_membership_id) references crm.memberships(workspace_id,id)
);
create table private.audit_logs (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references crm.workspaces(id),
  actor_membership_id uuid, action text not null, target_id uuid not null,
  recorded_at timestamptz not null default now(), request_id uuid not null default gen_random_uuid(),
  details jsonb not null default '{}' check (jsonb_typeof(details)='object' and octet_length(details::text)<8192),
  unique (workspace_id,id),
  foreign key (workspace_id,actor_membership_id) references crm.memberships(workspace_id,id)
);
create index audit_workspace_time on private.audit_logs(workspace_id,recorded_at desc,id);

create function private.member_id(w uuid) returns uuid language sql stable security definer set search_path='' as $$
  select m.id from crm.memberships m join crm.workspaces s on s.id=m.workspace_id
  where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and s.status='active'
    and (m.role <> 'admin' or auth.jwt()->>'aal'='aal2')
$$;
create function private.member_role(w uuid) returns crm.member_role language sql stable security definer set search_path='' as $$
  select m.role from crm.memberships m where m.id=private.member_id(w)
$$;
create function private.can_read_team(w uuid,t uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.member_id(w) is not null and (
    private.member_role(w)='admin' or exists (
      select 1 from crm.team_memberships tm where tm.workspace_id=w and tm.team_id=t and tm.membership_id=private.member_id(w)))
$$;
create function private.can_read_member(w uuid,target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select private.member_id(w) is not null and (target=private.member_id(w) or private.member_role(w)='admin' or (
    private.member_role(w)='manager' and exists (
      select 1 from crm.team_memberships mine join crm.team_memberships theirs
      on mine.workspace_id=theirs.workspace_id and mine.team_id=theirs.team_id
      where mine.workspace_id=w and mine.membership_id=private.member_id(w) and mine.is_manager and theirs.membership_id=target)))
$$;
create function private.require_admin(w uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  -- Serialize all administrative mutations, then re-read authoritative membership.
  perform 1 from crm.workspaces where id=w for update;
  actor := private.member_id(w);
  if actor is null or private.member_role(w) <> 'admin' then
    raise exception using errcode='42501', message='Workspace administrator access required';
  end if;
  return actor;
end $$;
create function private.protect_last_owner() returns trigger language plpgsql set search_path='' as $$
begin
  perform 1 from crm.workspaces where id=old.workspace_id for update;
  if old.is_owner and old.status='active' and
    (tg_op='DELETE' or not new.is_owner or new.status <> 'active' or new.role <> 'admin') and
    not exists(select 1 from crm.memberships where workspace_id=old.workspace_id and id<>old.id and is_owner and status='active') then
    raise exception using errcode='23514', message='The last active owner must be retained';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger protect_last_owner before update or delete on crm.memberships for each row execute function private.protect_last_owner();
create function private.reject_journal_change() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='42501', message='Audit records are append-only'; end $$;
create trigger immutable_audit before update or delete on private.audit_logs for each row execute function private.reject_journal_change();

alter table crm.workspaces enable row level security;
alter table crm.profiles enable row level security;
alter table crm.memberships enable row level security;
alter table crm.teams enable row level security;
alter table crm.team_memberships enable row level security;
alter table crm.membership_capabilities enable row level security;
alter table crm.report_scope_grants enable row level security;
alter table private.invitations enable row level security;
alter table private.audit_logs enable row level security;
create policy workspace_read on crm.workspaces for select to authenticated using (private.member_id(id) is not null);
create policy profile_self on crm.profiles for select to authenticated using (user_id=(select auth.uid()));
create policy membership_read on crm.memberships for select to authenticated using (private.can_read_member(workspace_id,id));
create policy team_read on crm.teams for select to authenticated using (private.can_read_team(workspace_id,id));
create policy team_member_read on crm.team_memberships for select to authenticated using (private.can_read_member(workspace_id,membership_id) and private.can_read_team(workspace_id,team_id));
create policy capability_read on crm.membership_capabilities for select to authenticated using (private.member_id(workspace_id) is not null and (membership_id=private.member_id(workspace_id) or private.member_role(workspace_id)='admin'));
create policy report_grant_read on crm.report_scope_grants for select to authenticated using (private.member_id(workspace_id) is not null and (membership_id=private.member_id(workspace_id) or private.member_role(workspace_id)='admin'));
-- No INSERT/UPDATE/DELETE policies or grants. All writes go through narrowly scoped commands.
grant select on all tables in schema crm to authenticated;
grant execute on function private.member_id(uuid), private.member_role(uuid), private.can_read_team(uuid,uuid), private.can_read_member(uuid,uuid) to authenticated;

-- Minimal own-membership metadata is available before MFA for enrollment/routing only.
create function api.my_access() returns table(workspace_id uuid,workspace_name text,membership_id uuid,role crm.member_role,is_owner boolean)
language sql stable security definer set search_path='' as $$
  select w.id,w.name,m.id,m.role,m.is_owner from crm.memberships m join crm.workspaces w on w.id=m.workspace_id
  where m.user_id=auth.uid() and m.status='active' and w.status='active'
$$;
create function api.workspace_context(p_workspace uuid) returns table(id uuid,name text,timezone text,role crm.member_role,is_owner boolean)
language sql stable security invoker set search_path='' as $$
  select w.id,w.name,w.timezone,m.role,m.is_owner from crm.workspaces w join crm.memberships m on m.workspace_id=w.id
  where w.id=p_workspace and m.user_id=auth.uid()
$$;
create function api.list_members(p_workspace uuid) returns table(id uuid,user_id uuid,role crm.member_role,is_owner boolean,status text,version bigint)
language sql stable security invoker set search_path='' as $$
  select m.id,m.user_id,m.role,m.is_owner,m.status,m.version from crm.memberships m where m.workspace_id=p_workspace order by m.created_at,m.id
$$;
create function api.set_membership_role(p_workspace uuid,p_member uuid,p_role crm.member_role,p_active boolean,p_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; target crm.memberships;
begin
  actor:=private.require_admin(p_workspace);
  select * into target from crm.memberships where workspace_id=p_workspace and id=p_member for update;
  if not found then raise exception using errcode='42501',message='Membership unavailable'; end if;
  if target.version<>p_version then raise exception using errcode='40001',message='Membership changed'; end if;
  if target.is_owner then raise exception using errcode='42501',message='Owner changes require a reviewed ownership transfer'; end if;
  update crm.memberships set role=p_role,status=case when p_active then 'active' else 'inactive' end,
    deactivated_at=case when p_active then null else now() end,version=version+1,updated_at=now() where id=p_member;
  -- Removing manager eligibility also removes team-manager flags atomically.
  if p_role not in ('admin','manager') or not p_active then
    update crm.team_memberships set is_manager=false,version=version+1,updated_at=now() where workspace_id=p_workspace and membership_id=p_member;
  end if;
  insert into private.audit_logs(workspace_id,actor_membership_id,action,target_id,details)
    values(p_workspace,actor,'membership.changed',p_member,jsonb_build_object('old_role',target.role,'role',p_role,'active',p_active));
end $$;
create function api.create_team(p_workspace uuid,p_name text) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; result uuid;
begin
  actor:=private.require_admin(p_workspace);
  insert into crm.teams(workspace_id,name,created_by_membership_id) values(p_workspace,btrim(p_name),actor) returning id into result;
  insert into private.audit_logs(workspace_id,actor_membership_id,action,target_id) values(p_workspace,actor,'team.created',result);
  return result;
end $$;
create function api.set_team_member(p_workspace uuid,p_team uuid,p_member uuid,p_manager boolean) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=private.require_admin(p_workspace);
  if not exists(select 1 from crm.teams where workspace_id=p_workspace and id=p_team and status='active') or
     not exists(select 1 from crm.memberships where workspace_id=p_workspace and id=p_member and status='active' and (not p_manager or role in ('admin','manager'))) then
    raise exception using errcode='42501',message='Eligible team and membership required';
  end if;
  insert into crm.team_memberships(workspace_id,team_id,membership_id,is_manager,created_by_membership_id)
    values(p_workspace,p_team,p_member,p_manager,actor)
    on conflict(workspace_id,team_id,membership_id) do update set is_manager=excluded.is_manager,version=crm.team_memberships.version+1,updated_at=now();
  insert into private.audit_logs(workspace_id,actor_membership_id,action,target_id) values(p_workspace,actor,'team.member_changed',p_member);
end $$;
create function api.issue_invitation(p_workspace uuid,p_email text,p_role crm.member_role,p_team uuid default null) returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid; token text; invite uuid;
begin
  actor:=private.require_admin(p_workspace);
  if p_email is null or length(p_email)>254 or btrim(p_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='Valid invitation email required';
  end if;
  if p_team is not null and not exists(select 1 from crm.teams where workspace_id=p_workspace and id=p_team and status='active') then
    raise exception using errcode='42501',message='Team unavailable';
  end if;
  token:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
  insert into private.invitations(workspace_id,intended_email,role,team_id,token_digest,expires_at,created_by_membership_id)
    values(p_workspace,lower(btrim(p_email)),p_role,p_team,encode(sha256(convert_to(token,'UTF8')),'hex'),now()+interval '48 hours',actor) returning id into invite;
  insert into private.audit_logs(workspace_id,actor_membership_id,action,target_id) values(p_workspace,actor,'invitation.issued',invite);
  return token; -- returned once; never store raw token or include it in logs.
end $$;
create function api.accept_invitation(p_token text) returns uuid language plpgsql security definer set search_path='' as $$
declare inv private.invitations; email text; member uuid; wid uuid;
begin
  if auth.uid() is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception using errcode='42501',message='Invitation unavailable'; end if;
  -- Match lock ordering used by admin commands: workspace, then invitation.
  select workspace_id into wid from private.invitations where token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  perform 1 from crm.workspaces where id=wid and status='active' for update;
  if not found then raise exception using errcode='42501',message='Invitation unavailable'; end if;
  select * into inv from private.invitations where workspace_id=wid and token_digest=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  select lower(u.email) into email from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null;
  if email is null or inv.intended_email<>email or inv.expires_at<=now() or inv.consumed_at is not null or inv.revoked_at is not null or
    not exists(select 1 from crm.memberships where workspace_id=wid and id=inv.created_by_membership_id and role='admin' and status='active') or
    (inv.team_id is not null and not exists(select 1 from crm.teams where workspace_id=wid and id=inv.team_id and status='active')) then
    raise exception using errcode='42501',message='Invitation unavailable';
  end if;
  if exists(select 1 from crm.memberships where workspace_id=wid and user_id=auth.uid()) then
    raise exception using errcode='42501',message='Existing membership requires administrator review';
  end if;
  insert into crm.memberships(workspace_id,user_id,role,created_by_membership_id)
    values(wid,auth.uid(),inv.role,inv.created_by_membership_id) returning id into member;
  if inv.team_id is not null then
    insert into crm.team_memberships(workspace_id,team_id,membership_id,created_by_membership_id) values(wid,inv.team_id,member,inv.created_by_membership_id);
  end if;
  update private.invitations set consumed_at=now(),consumed_by_user_id=auth.uid() where id=inv.id;
  insert into private.audit_logs(workspace_id,actor_membership_id,action,target_id) values(wid,member,'invitation.accepted',inv.id);
  return wid;
end $$;
create function api.revoke_invitation(p_workspace uuid,p_invitation uuid) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=private.require_admin(p_workspace);
  update private.invitations set revoked_at=now() where workspace_id=p_workspace and id=p_invitation and consumed_at is null and revoked_at is null;
  if not found then raise exception using errcode='42501',message='Invitation unavailable'; end if;
  insert into private.audit_logs(workspace_id,actor_membership_id,action,target_id) values(p_workspace,actor,'invitation.revoked',p_invitation);
end $$;
-- Admin-only provisioning is intentionally absent from the exposed API schema.
create function private.bootstrap_workspace(p_owner uuid,p_name text,p_timezone text,p_currency text) returns uuid
language plpgsql security definer set search_path='' as $$
declare wid uuid; mid uuid;
begin
  if not exists(select 1 from auth.users where id=p_owner and email_confirmed_at is not null) then raise exception 'Confirmed owner identity required'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Valid IANA timezone required'; end if;
  insert into crm.workspaces(name,timezone,default_currency) values(p_name,p_timezone,p_currency) returning id into wid;
  insert into crm.memberships(workspace_id,user_id,role,is_owner) values(wid,p_owner,'admin',true) returning id into mid;
  insert into private.audit_logs(workspace_id,actor_membership_id,action,target_id) values(wid,mid,'workspace.bootstrapped',wid);
  return wid;
end $$;

revoke all on all functions in schema private, api from public, anon, authenticated;
grant execute on function private.member_id(uuid), private.member_role(uuid), private.can_read_team(uuid,uuid), private.can_read_member(uuid,uuid) to authenticated;
grant execute on all functions in schema api to authenticated;
-- private.require_admin/bootstrap and invitation/audit rows have no client grants.
reset role;
commit;
