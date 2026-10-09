-- DEV SETUP. Run once per test login, after creating the users in
-- Supabase Dashboard > Authentication > Users (tick "Auto confirm user").
-- Replace the three example emails. Sign out and back in afterwards so the
-- admin claim reaches your token.

-- 1) Admin role (stored in app_metadata, which users cannot edit themselves)
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
where email = 'tiangaysamandiayk@gmail.com';

-- 2) Test login for a DEMO merchant. The merchant stays DEMO / NOT PARTNERED.
insert into public.merchant_staff (merchant_id, user_id)
select m.id, u.id from public.merchants m, auth.users u
where m.slug = 'goodies-supermarket' and u.email = 'catalysttechlabsafrica.sl@gmail.com'
on conflict do nothing;

-- 3) Test login for Demo Rider 001
update public.riders
set user_id = (select id from auth.users where email = 'aquahavenfarms.sl@gmail.com')
where display_name = 'Demo Rider 001';
