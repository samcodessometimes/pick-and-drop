-- READ ONLY. Run in the Supabase SQL editor to see why a login cannot reach a dashboard. Changes nothing.
-- Each row says what is true right now. Replace nothing; it lists every login.

-- 1. Logins and the role each one carries. Admin access requires app_metadata.role = 'admin'.
select u.email, u.is_anonymous, u.raw_app_meta_data ->> 'role' as admin_claim, u.email_confirmed_at is not null as confirmed
from auth.users u where not coalesce(u.is_anonymous, false) order by u.created_at;

-- 2. Which login is linked to which shop. A merchant login with no row here sees "not linked to a shop".
select u.email, count(*) as shops_linked, string_agg(m.name, ', ' order by m.name) as shops
from public.merchant_staff s join auth.users u on u.id = s.user_id join public.merchants m on m.id = s.merchant_id group by u.email;

-- 3. Which login is linked to which rider. A rider login with no row here sees "no rider profile".
select r.display_name, r.is_demo, r.availability, coalesce(u.email, 'NO LOGIN LINKED') as login
from public.riders r left join auth.users u on u.id = r.user_id order by r.display_name;

-- 4. Is there anything for the dashboards to show? Zero rows is the usual reason a dashboard looks empty.
select (select count(*) from public.merchants) as merchants,
       (select count(*) from public.merchants where status in ('DEMO','ACTIVE')) as visible_to_customers,
       (select count(*) from public.products) as products,
       (select count(*) from public.riders) as riders,
       (select count(*) from public.orders) as orders;

-- 5. Are all six migrations in? Each function below must exist.
select f as function_name, exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f) as present
from unnest(array['place_order','admin_overview','admin_assign_rider','merchant_dashboard','rider_deliveries','admin_link_staff','admin_setup_status','record_cash_collected']) f;
