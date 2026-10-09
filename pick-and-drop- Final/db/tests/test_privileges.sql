\set ON_ERROR_STOP on
-- Privilege audit. pg_trgm helper functions (extension-owned, pure, harmless) are excluded. Run after migrations 01 to 05 (needs supabase_stub.sql). Prints PASS/FAIL rows.
drop table if exists public.res3; create table public.res3(n serial, test text, ok boolean);
-- 1. every table in public has row level security enabled
insert into res3(test, ok)
 select 'RLS enabled on public.' || c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relname not like 'res%' order by c.relname;
-- 2. functions anonymous users can execute: only the harmless helpers
insert into res3(test, ok)
 select 'anon may execute public.' || p.proname || '(): ' || (p.proname in ('is_admin','distance_km')), p.proname in ('is_admin','distance_km')
 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') and has_function_privilege('anon', p.oid, 'execute') order by p.proname;
-- 3. functions signed-in users can execute: exactly the intended API surface
insert into res3(test, ok)
 select 'authenticated may execute public.' || p.proname || '()', p.proname in ('is_admin','distance_km','is_merchant_staff','place_order','verify_delivery_pin',
   'merchant_set_order_status','rider_advance_delivery','admin_overview','admin_set_order_status','admin_assign_rider','admin_save_rider',
   'admin_save_merchant','admin_set_merchant_status','admin_unlock_delivery_pin')
 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') and has_function_privilege('authenticated', p.oid, 'execute') order by p.proname;
-- 4. every SECURITY DEFINER function pins its search_path
insert into res3(test, ok)
 select 'search_path pinned on ' || p.proname || '()', p.proconfig is not null and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')
 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosecdef order by p.proname;
-- 5. anonymous users have no policy-granted rows on private tables (policy roles)
insert into res3(test, ok)
 select 'no policy lets anon read ' || tablename, not exists (select 1 from pg_policies pl where pl.schemaname = 'public' and pl.tablename = t.tablename and ('anon' = any(pl.roles) or 'public' = any(pl.roles)) and pl.cmd in ('SELECT','ALL'))
 from (values ('orders'),('order_items'),('payments'),('order_delivery_pins'),('order_status_history'),('riders'),('profiles'),('merchant_staff'),('merchant_internal'),('admin_audit_log')) t(tablename);
-- 6. no insert/update/delete policy exists for customers or riders on order data
insert into res3(test, ok)
 select 'no write policy on ' || tablename || ' except admin-only', not exists (select 1 from pg_policies pl where pl.schemaname = 'public' and pl.tablename = t.tablename and pl.cmd in ('INSERT','UPDATE','DELETE','ALL') and pl.policyname not like '%admin%')
 from (values ('orders'),('order_items'),('payments'),('order_delivery_pins'),('order_status_history'),('profiles'),('merchant_internal'),('admin_audit_log')) t(tablename);
insert into res3(test, ok) values ('orders has no admin write policy any more', not exists (select 1 from pg_policies where tablename = 'orders' and cmd in ('UPDATE','DELETE','INSERT','ALL')));
-- 7. views use the caller's permissions and expose no internal columns
insert into res3(test, ok) values
 ('merchants_public is security_invoker', coalesce((select 'security_invoker=true' = any(reloptions) from pg_class where relname = 'merchants_public'), false)),
 ('merchants_public hides internal columns', not exists (select 1 from information_schema.columns where table_name = 'merchants_public' and column_name in ('internal_notes','data_source','source_url','owner_id','partnered_at')));
select n, case when ok then 'PASS' else 'FAIL' end as result, test from res3 order by n;
