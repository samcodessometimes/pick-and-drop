-- Minimal imitation of a Supabase project for local testing. Mirrors the parts that matter for security:
--   * roles anon / authenticated / service_role and Supabase's default grants on the public schema
--   * pgcrypto living in the "extensions" schema (functions with search_path = public cannot see it)
--   * auth.uid() / auth.jwt() reading the JWT claims the way Supabase does
-- It is NOT Supabase: GoTrue (sign-in), Realtime and Storage are absent.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema auth;
create table auth.users(
  id uuid primary key default gen_random_uuid(), email text,
  raw_app_meta_data jsonb default '{}', raw_user_meta_data jsonb default '{}', is_anonymous boolean default false);
do $$ begin create role anon nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin noinherit; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin noinherit bypassrls; exception when duplicate_object then null; end $$;
create or replace function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $f$;
create or replace function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $f$;
create publication supabase_realtime;
grant usage on schema public, auth, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
-- Login role PostgREST connects as (Supabase calls it "authenticator"). Test-only password.
do $$ begin create role authenticator login noinherit password 'authpw'; exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to authenticator;
