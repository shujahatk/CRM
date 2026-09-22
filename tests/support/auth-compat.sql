-- Embedded PostgreSQL only. Models Supabase's JWT/session database boundary;
-- this does NOT simulate or certify GoTrue, token verification or PostgREST.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid(),auth.jwt() to authenticated,anon;
set timezone to 'UTC';

