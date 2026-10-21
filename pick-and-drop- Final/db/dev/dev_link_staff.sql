-- =====================================================================
-- DEV SETUP: give test logins their roles. Run in the Supabase SQL editor.
-- Safe to run again. It FAILS LOUDLY (with the reason) instead of silently doing nothing.
--
-- Before running:
--   1. Supabase > Authentication > Users > Add user, tick "Auto Confirm User", for each login below.
--   2. Put the three emails in the first lines of the DO block.
--   3. Run migrations 01 to 06 and db/dev/demo_seed.sql first.
-- Afterwards each person must SIGN OUT and sign in again so the admin role reaches their token.
--
-- Type the real emails into the three lines below ONLY inside the Supabase SQL editor. Never commit them to GitHub.
-- This script never touches passwords, never turns RLS off, and only changes the three logins named below.
-- =====================================================================
do $$
declare
  v_admin_email    text := 'PUT-ADMIN-EMAIL-HERE';
  v_merchant_email text := 'PUT-MERCHANT-EMAIL-HERE';
  v_rider_email    text := 'PUT-RIDER-EMAIL-HERE';
  u_admin uuid; u_merchant uuid; u_rider uuid; n int; r_id uuid;
begin
  select id into u_admin    from auth.users where lower(email) = lower(v_admin_email);
  select id into u_merchant from auth.users where lower(email) = lower(v_merchant_email);
  select id into u_rider    from auth.users where lower(email) = lower(v_rider_email);
  if u_admin    is null then raise exception 'No login found for the admin email %. Create it in Authentication > Users first.', v_admin_email; end if;
  if u_merchant is null then raise exception 'No login found for the merchant email %. Create it in Authentication > Users first.', v_merchant_email; end if;
  if u_rider    is null then raise exception 'No login found for the rider email %. Create it in Authentication > Users first.', v_rider_email; end if;
  if u_admin in (u_merchant, u_rider) or u_merchant = u_rider then
    raise exception 'Use three different logins: one admin, one merchant, one rider.'; end if;

  -- 1) Admin role. Stored in app_metadata, which users cannot edit themselves.
  update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb where id = u_admin;

  -- 2) Merchant login: all demo merchants plus Goodies. Their status stays DEMO. Nothing implies a partnership.
  insert into public.merchant_staff (merchant_id, user_id)
  select m.id, u_merchant from public.merchants m where m.slug like 'demo-%' or m.slug = 'goodies-supermarket'
  on conflict do nothing;
  get diagnostics n = row_count;
  if (select count(*) from public.merchant_staff where user_id = u_merchant) = 0 then
    raise exception 'No demo merchants exist yet. Run db/dev/demo_seed.sql first.'; end if;

  -- 3) Rider login for Demo Rider 001.
  select id into r_id from public.riders where display_name = 'Demo Rider 001';
  if r_id is null then raise exception 'Demo Rider 001 does not exist. Run migration 02 first.'; end if;
  if exists (select 1 from public.riders where user_id = u_rider and id <> r_id) then
    raise exception 'That rider login is already linked to a different rider.'; end if;
  update public.riders set user_id = u_rider where id = r_id;
end $$;

-- Check: every row should show a login. If a column says "NOT LINKED", that account will see an access message.
select 'admin' as role, u.email, (u.raw_app_meta_data ->> 'role') as detail
  from auth.users u where u.raw_app_meta_data ->> 'role' = 'admin'
union all
select 'merchant', u.email, string_agg(m.name, ', ' order by m.name)
  from public.merchant_staff s join auth.users u on u.id = s.user_id join public.merchants m on m.id = s.merchant_id group by u.email
union all
select 'rider', coalesce(u.email, 'NOT LINKED'), r.display_name
  from public.riders r left join auth.users u on u.id = r.user_id where r.display_name = 'Demo Rider 001';
