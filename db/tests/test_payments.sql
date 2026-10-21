\set ON_ERROR_STOP on
-- Step 7 tests: payment status, cash on delivery, settlement records, staff linking, merchant dashboard data.
-- Run AFTER test_flows.sql and test_admin.sql (needs supabase_stub.sql, migrations 01 to 06, the dev seed).
-- Prints PASS/FAIL rows.
drop table if exists public.res4; create table public.res4(n serial, test text, ok boolean);
grant all on public.res4 to public; grant all on sequence public.res4_n_seq to public;
create or replace function pg_temp.as_user(u uuid, adm boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub',u,'app_metadata', case when adm then json_build_object('role','admin') else '{}'::json end)::text, true);
end $$;
create or replace function pg_temp.raises(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end $$;

do $$
declare
  cust uuid; cust2 uuid; mer uuid; mer2 uuid; ridu uuid; adm uuid; anon_u uuid; rid2u uuid;
  gm uuid; sm uuid; prod uuid; smprod uuid; rider uuid; rider2 uuid; rider3 uuid;
  oc uuid; os uuid; od uuid; ox uuid; oy uuid; r jsonb; v text; n int; ok boolean; v_pin text; d jsonb; pid uuid; bps int;
  addr jsonb := '{"contact_name":"Pay Test","contact_phone":"+23276222222","address_line":"4 Payment Test Road Freetown"}';
  items jsonb;
  fee numeric; sub numeric; u_new uuid; u_other uuid;
begin
  insert into auth.users(email) values ('p_cust') returning id into cust;
  insert into auth.users(email) values ('p_cust2') returning id into cust2;
  insert into auth.users(email) values ('p_mer') returning id into mer;
  insert into auth.users(email) values ('p_mer2') returning id into mer2;
  insert into auth.users(email) values ('p_rider') returning id into ridu;
  insert into auth.users(email) values ('p_rider2') returning id into rid2u;
  insert into auth.users(email) values ('p_admin') returning id into adm;
  insert into auth.users(email, is_anonymous) values ('p_anon@example.test', true) returning id into anon_u;
  insert into auth.users(email) values ('p_newrider@example.test') returning id into u_new;
  insert into auth.users(email) values ('p_other@example.test') returning id into u_other;
  select id into gm from merchants where slug = 'goodies-supermarket';
  select id into sm from merchants where slug = 'st-marys-supermarket';
  select id into prod from products where merchant_id = gm and is_available limit 1;
  insert into product_categories (merchant_id, name) values (sm, 'PayPantry') on conflict do nothing;
  insert into products (merchant_id, product_category_id, name, price)
    select sm, (select id from product_categories where merchant_id = sm limit 1), 'PAYTEST item', 40 returning id into smprod;
  insert into merchant_staff values (gm, mer) on conflict do nothing;
  insert into merchant_staff values (sm, mer2) on conflict do nothing;
  insert into riders (display_name, user_id, availability) values ('Pay Rider A', ridu, 'AVAILABLE') returning id into rider;
  insert into riders (display_name, user_id, availability) values ('Pay Rider B', rid2u, 'AVAILABLE') returning id into rider2;
  items := jsonb_build_array(jsonb_build_object('product_id', prod, 'qty', 2));
  select delivery_fee into fee from merchants where id = gm;

  -- ===== A. checkout payment records =====
  perform pg_temp.as_user(cust); set local role authenticated;
  r := place_order(gm, items, addr, 'ORANGE_MONEY', null); os := (r->>'order_id')::uuid;
  insert into res4(test, ok) values ('demo mobile money order is accepted without a typed reference', os is not null and r->>'payment_status' = 'SIMULATED');
  r := place_order(gm, items, addr, 'CASH_ON_DELIVERY', null); oc := (r->>'order_id')::uuid;
  insert into res4(test, ok) values ('cash on delivery order is accepted without a reference', oc is not null and r->>'payment_status' = 'PENDING');
  v := pg_temp.raises(format($q$select place_order(%L, %L::jsonb, %L::jsonb, 'AFRIMONEY', 'ab')$q$, gm, items, addr));
  insert into res4(test, ok) values ('a malformed typed reference is refused', v like '%valid transaction ID%');
  v := pg_temp.raises(format($q$select place_order(%L, %L::jsonb, %L::jsonb, 'BITCOIN', null)$q$, gm, items, addr));
  insert into res4(test, ok) values ('unknown payment method is refused', v like '%payment method%');
  reset role;
  insert into res4(test, ok) select 'demo payment is SIMULATED, flagged simulated, never PAID, not verified, reference auto generated',
     status = 'SIMULATED' and is_simulated and verified_at is null and provider = 'SIMULATED' and provider_reference like 'DEMO%'
     from payments where order_id = os;
  insert into res4(test, ok) select 'cash order payment is PENDING, CASH, not simulated, no reference',
     status = 'PENDING' and not is_simulated and provider = 'CASH' and provider_reference is null and method = 'CASH_ON_DELIVERY'
     from payments where order_id = oc;
  insert into res4(test, ok) values ('database refuses a simulated payment marked PAID',
     pg_temp.raises(format($q$update payments set status = 'PAID' where order_id = %L$q$, os)) like '%payments_sim_not_paid%');
  insert into res4(test, ok) select 'financial record starts NOT_DUE for new orders',
     (select settlement_status from order_financials where order_id = os) = 'NOT_DUE' and (select rider_pay_status from order_financials where order_id = oc) = 'NOT_DUE';

  -- ===== B. merchant dashboard data and isolation =====
  perform pg_temp.as_user(mer); set local role authenticated;
  d := merchant_dashboard(gm);
  insert into res4(test, ok) values ('merchant sees own orders with payment status and items',
     jsonb_array_length(d->'orders') >= 2 and (select bool_and(o->'payment'->>'status' is not null and jsonb_array_length(o->'items') > 0) from jsonb_array_elements(d->'orders') o));
  insert into res4(test, ok) values ('merchant summary counts new orders',
     (d->'summary'->>'new_orders')::int >= 2 and (d->'summary'->>'orders_today')::int >= 2);
  insert into res4(test, ok) values ('merchant figures contain no platform revenue or rider pay',
     d::text not like '%platform_revenue%' and d::text not like '%rider_pay%');
  v := pg_temp.raises(format($q$select merchant_dashboard(%L)$q$, sm));
  insert into res4(test, ok) values ('merchant cannot load another merchant''s dashboard', v like '%Not allowed%');
  reset role;
  perform pg_temp.as_user(cust); set local role authenticated;
  v := pg_temp.raises(format($q$select merchant_dashboard(%L)$q$, gm));
  insert into res4(test, ok) values ('customer cannot load a merchant dashboard', v like '%Not allowed%');
  reset role;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  insert into res4(test, ok) values ('admin can load any merchant dashboard', jsonb_array_length(merchant_dashboard(gm)->'orders') >= 2);
  reset role;

  -- ===== C. cash on delivery: rules for recording collection =====
  perform pg_temp.as_user(mer); set local role authenticated;
  perform merchant_set_order_status(oc, 'ACCEPT'); perform merchant_set_order_status(oc, 'PREPARING'); perform merchant_set_order_status(oc, 'READY');
  perform merchant_set_order_status(os, 'ACCEPT'); perform merchant_set_order_status(os, 'PREPARING'); perform merchant_set_order_status(os, 'READY');
  reset role;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  perform admin_assign_rider(oc, rider); perform admin_assign_rider(os, rider2);
  reset role;
  perform pg_temp.as_user(ridu); set local role authenticated;
  perform rider_advance_delivery(oc, 'ACCEPT'); perform rider_advance_delivery(oc, 'ARRIVE_MERCHANT');
  v := pg_temp.raises(format($q$select record_cash_collected(%L)$q$, oc));
  insert into res4(test, ok) values ('rider cannot record cash before reaching the customer', v like '%arrived at the customer%');
  perform rider_advance_delivery(oc, 'PICKUP'); perform rider_advance_delivery(oc, 'ON_THE_WAY'); perform rider_advance_delivery(oc, 'ARRIVE_CUSTOMER');
  reset role;
  select order_delivery_pins.pin into v_pin from order_delivery_pins where order_id = oc;

  perform pg_temp.as_user(ridu); set local role authenticated;
  v := pg_temp.raises(format($q$select verify_delivery_pin(%L, %L)$q$, oc, v_pin));
  insert into res4(test, ok) values ('delivery is blocked while cash is still owed', v like '%Record the cash collected%');
  reset role;
  insert into res4(test, ok) select 'blocked delivery did not use up a PIN attempt', failed_attempts = 0 from order_delivery_pins where order_id = oc;
  perform pg_temp.as_user(rid2u); set local role authenticated;
  v := pg_temp.raises(format($q$select record_cash_collected(%L)$q$, oc));
  insert into res4(test, ok) values ('a different rider cannot record cash for this order', v like '%Order not found%');
  reset role;
  perform pg_temp.as_user(cust); set local role authenticated;
  v := pg_temp.raises(format($q$select record_cash_collected(%L)$q$, oc));
  insert into res4(test, ok) values ('the customer cannot record cash', v like '%Order not found%');
  reset role;
  v := pg_temp.raises(format($q$update orders set status = 'DELIVERED', delivery_status = 'DELIVERED' where id = %L$q$, oc));
  update order_delivery_pins set verified_at = now() where order_id = oc;
  v := pg_temp.raises(format($q$update orders set status = 'DELIVERED', delivery_status = 'DELIVERED' where id = %L$q$, oc));
  insert into res4(test, ok) values ('even a direct update cannot deliver an unpaid cash order', v like '%Record the cash collected%');
  update order_delivery_pins set verified_at = null where order_id = oc;

  perform pg_temp.as_user(ridu); set local role authenticated;
  r := record_cash_collected(oc);
  insert into res4(test, ok) values ('assigned rider records cash at the door', r->>'payment_status' = 'PAID');
  v := pg_temp.raises(format($q$select record_cash_collected(%L)$q$, oc));
  insert into res4(test, ok) values ('cash cannot be recorded twice', v like '%already recorded%');
  r := verify_delivery_pin(oc, v_pin);
  insert into res4(test, ok) values ('correct PIN completes delivery once cash is recorded', (r->>'ok')::boolean);
  reset role;
  insert into res4(test, ok) select 'cash payment is PAID with confirmer and time recorded',
     status = 'PAID' and confirmed_by = ridu and confirmed_at is not null and verified_at is not null and note like 'Cash collected by rider%'
     from payments where order_id = oc;

  -- demo order delivered through the normal flow
  perform pg_temp.as_user(rid2u); set local role authenticated;
  perform rider_advance_delivery(os, 'ACCEPT'); perform rider_advance_delivery(os, 'ARRIVE_MERCHANT'); perform rider_advance_delivery(os, 'PICKUP');
  perform rider_advance_delivery(os, 'ON_THE_WAY'); perform rider_advance_delivery(os, 'ARRIVE_CUSTOMER');
  v := pg_temp.raises(format($q$select record_cash_collected(%L)$q$, os));
  insert into res4(test, ok) values ('cash recording refused on a non cash order', v like '%not a cash on delivery%');
  reset role;
  select order_delivery_pins.pin into v_pin from order_delivery_pins where order_id = os;
  perform pg_temp.as_user(rid2u); set local role authenticated;
  perform verify_delivery_pin(os, v_pin);
  reset role;
  insert into res4(test, ok) select 'demo payment stays SIMULATED after delivery (never becomes PAID)', status = 'SIMULATED' from payments where order_id = os;

  -- ===== D. financial records and pending commercial terms =====
  insert into res4(test, ok) select 'with no commercial terms set, delivered orders are PENDING_TERMS and amounts stay empty',
     (select count(*) from order_financials where order_id in (oc, os) and settlement_status = 'PENDING_TERMS' and rider_pay_status = 'PENDING_TERMS'
         and merchant_net is null and platform_revenue is null and rider_pay is null) = 2;
  perform pg_temp.as_user(cust); set local role authenticated;
  select count(*) into n from order_financials; insert into res4(test, ok) values ('customer cannot read order_financials', n = 0);
  select count(*) into n from platform_settings; insert into res4(test, ok) values ('customer cannot read platform_settings', n = 0);
  select count(*) into n from merchant_settlements; insert into res4(test, ok) values ('customer cannot read settlements', n = 0);
  v := pg_temp.raises($q$select admin_save_settings(1000, 15, null)$q$);
  insert into res4(test, ok) values ('customer cannot set commercial terms', v like '%Admin only%');
  reset role;
  perform pg_temp.as_user(mer); set local role authenticated;
  v := pg_temp.raises($q$select admin_save_settings(1000, 15, null)$q$);
  insert into res4(test, ok) values ('merchant cannot set commercial terms', v like '%Admin only%');
  select count(*) into n from order_financials; insert into res4(test, ok) values ('merchant cannot read order_financials directly', n = 0);
  reset role;

  perform pg_temp.as_user(adm, true); set local role authenticated;
  v := pg_temp.raises($q$select admin_save_settings(6000, 15, null)$q$);
  insert into res4(test, ok) values ('commission above 50% is refused', v like '%between 0%');
  v := pg_temp.raises($q$select admin_save_settings(1000, -1, null)$q$);
  insert into res4(test, ok) values ('negative rider pay is refused', v like '%negative%');
  perform admin_save_settings(1000, 15, 'test terms');
  reset role;
  select subtotal into sub from orders where id = os;
  insert into res4(test, ok) select 'terms turn pending orders into OWED with correct arithmetic (10% commission)',
     settlement_status = 'OWED' and commission_bps = 1000 and merchant_commission = round(subtotal * 0.10, 2)
     and merchant_net = subtotal - merchant_commission and rider_pay = 15 and rider_pay_status = 'OWED'
     and platform_revenue = merchant_commission + delivery_fee - 15
     from order_financials where order_id = os;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  perform admin_save_settings(2000, 20, 'changed');
  reset role;
  insert into res4(test, ok) select 'changing terms later does not change amounts already OWED', commission_bps = 1000 and rider_pay = 15
     from order_financials where order_id = os;

  -- a new order after the change uses the new terms when delivered
  perform pg_temp.as_user(cust); set local role authenticated;
  r := place_order(gm, items, addr, 'AFRIMONEY', 'REF123456'); od := (r->>'order_id')::uuid;
  reset role;
  insert into res4(test, ok) select 'undelivered order is NOT_DUE and has no revenue figure', settlement_status = 'NOT_DUE' and platform_revenue is null
     from order_financials where order_id = od;

  -- ===== E. cancellation =====
  perform pg_temp.as_user(mer); set local role authenticated;
  perform merchant_set_order_status(od, 'REJECT');
  reset role;
  insert into res4(test, ok) select 'rejected demo order: payment REFUNDED (demo), money record VOID',
     (select status from payments where order_id = od) = 'REFUNDED' and (select settlement_status from order_financials where order_id = od) = 'VOID';
  perform pg_temp.as_user(cust); set local role authenticated;
  r := place_order(gm, items, addr, 'CASH_ON_DELIVERY', null); ox := (r->>'order_id')::uuid;
  reset role;
  perform pg_temp.as_user(mer); set local role authenticated;
  perform merchant_set_order_status(ox, 'REJECT');
  reset role;
  insert into res4(test, ok) select 'rejected cash order: payment CANCELLED (nothing was collected)', status = 'CANCELLED' from payments where order_id = ox;

  perform pg_temp.as_user(cust); set local role authenticated;
  r := place_order(gm, items, addr, 'CASH_ON_DELIVERY', null); oy := (r->>'order_id')::uuid;
  reset role;
  perform pg_temp.as_user(cust2); set local role authenticated;
  v := pg_temp.raises(format($q$select admin_set_payment_status(%L, 'FAILED', 'x')$q$, oy));
  insert into res4(test, ok) values ('non admin cannot mark a payment failed', v like '%Admin only%');
  reset role;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  v := pg_temp.raises(format($q$select admin_set_payment_status(%L, 'PAID', 'x')$q$, oy));
  insert into res4(test, ok) values ('admin cannot set a payment to PAID by hand', v like '%Only FAILED%');
  v := pg_temp.raises(format($q$select admin_set_payment_status(%L, 'FAILED', 'x')$q$, os));
  insert into res4(test, ok) values ('only a pending payment can be marked failed', v like '%Only a pending payment%');
  perform admin_set_payment_status(oy, 'FAILED', 'customer refused to pay');
  reset role;
  insert into res4(test, ok) select 'pending cash payment marked FAILED with reason and money record VOID',
     (select status from payments where order_id = oy) = 'FAILED' and (select note from payments where order_id = oy) = 'customer refused to pay'
     and (select settlement_status from order_financials where order_id = oy) = 'VOID';

  -- ===== F. settlement records =====
  perform pg_temp.as_user(mer); set local role authenticated;
  v := pg_temp.raises(format($q$select admin_record_merchant_settlement(%L, true, 'REFX1', null)$q$, gm));
  insert into res4(test, ok) values ('merchant cannot record a settlement for themselves', v like '%Admin only%');
  reset role;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  v := pg_temp.raises(format($q$select admin_record_merchant_settlement(%L, true, 'x', null)$q$, gm));
  insert into res4(test, ok) values ('settlement needs a payment reference', v like '%payment reference%');
  v := pg_temp.raises(format($q$select admin_record_merchant_settlement(%L, false, 'LIVE-REF-1', null)$q$, gm));
  insert into res4(test, ok) values ('demo money cannot be recorded as a live settlement', v like '%Nothing is owed%');
  select count(*), coalesce(sum(merchant_net),0) into n, sub from order_financials where merchant_id = gm and is_demo and settlement_status = 'OWED';
  r := admin_record_merchant_settlement(gm, true, 'DEMO-PAYOUT-1', 'bank transfer outside the app');
  insert into res4(test, ok) values ('settlement covers exactly the owed orders and total', (r->>'order_count')::int = n and (r->>'net_total')::numeric = sub and n >= 1);
  v := pg_temp.raises(format($q$select admin_record_merchant_settlement(%L, true, 'DEMO-PAYOUT-1', null)$q$, gm));
  insert into res4(test, ok) values ('nothing left to settle the second time', v like '%Nothing is owed%');
  r := admin_record_rider_payout(rider2, true, 'DEMO-RIDER-1', null);
  insert into res4(test, ok) values ('rider payout recorded with the configured pay', (r->>'total')::numeric = 15 and (r->>'delivery_count')::int = 1);
  v := pg_temp.raises(format($q$select admin_record_rider_payout(%L, true, 'DEMO-RIDER-1', null)$q$, rider2));
  insert into res4(test, ok) values ('rider payout twice is refused', v like '%Nothing is owed%');
  reset role;
  insert into res4(test, ok) select 'settled order is SETTLED with its settlement linked and amounts frozen',
     settlement_status = 'SETTLED' and merchant_settlement_id is not null and commission_bps = 1000 and rider_pay_status = 'PAID'
     from order_financials where order_id = os;
  perform pg_temp.as_user(mer); set local role authenticated;
  d := merchant_dashboard(gm);
  insert into res4(test, ok) values ('merchant sees their own settlement history and settled total',
     jsonb_array_length(d->'settlements') = 1 and d->'settlements'->0->>'reference' = 'DEMO-PAYOUT-1' and (d->'summary'->>'net_settled')::numeric > 0);
  select count(*) into n from merchant_settlements; insert into res4(test, ok) values ('merchant can read only their own settlement rows', n = 1);
  reset role;
  perform pg_temp.as_user(mer2); set local role authenticated;
  select count(*) into n from merchant_settlements; insert into res4(test, ok) values ('another merchant cannot read those settlements', n = 0);
  reset role;
  perform pg_temp.as_user(ridu); set local role authenticated;
  select count(*) into n from rider_payouts; insert into res4(test, ok) values ('a rider cannot read another rider''s payouts', n = 0);
  reset role;

  -- ===== G. real-payment confirmation entry point =====
  insert into orders (id, customer_id, merchant_id, status, is_demo, subtotal, delivery_fee, total, contact_name, contact_phone, address_line)
    values (gen_random_uuid(), cust, gm, 'PENDING_PAYMENT', true, 100, 20, 120, 'x', '+23276000000', '1 Test Road Freetown') returning id into ox;
  insert into payments (order_id, method, provider, amount, status, is_simulated) values (ox, 'ORANGE_MONEY', 'ORANGE_MONEY', 120, 'PENDING', false) returning id into pid;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  v := pg_temp.raises(format($q$select provider_confirm_payment(%L, 'ORANGE', 'TX1', 120)$q$, pid));
  insert into res4(test, ok) values ('signed-in users (even admins) cannot call the provider confirmation', v like '%permission denied%');
  reset role;
  set local role anon;
  v := pg_temp.raises(format($q$select provider_confirm_payment(%L, 'ORANGE', 'TX1', 120)$q$, pid));
  insert into res4(test, ok) values ('anonymous users cannot call the provider confirmation', v like '%permission denied%');
  reset role;
  set local role service_role;
  v := pg_temp.raises(format($q$select provider_confirm_payment(%L, 'ORANGE', 'TX1', 99)$q$, pid));
  insert into res4(test, ok) values ('provider confirmation refuses a wrong amount', v like '%Amount mismatch%');
  perform provider_confirm_payment(pid, 'ORANGE', 'TX1', 120);
  reset role;
  insert into res4(test, ok) select 'server side confirmation sets PAID and releases the order to the store',
     (select status from payments where id = pid) = 'PAID' and (select status from orders where id = ox) = 'PLACED';
  set local role service_role;
  v := pg_temp.raises(format($q$select provider_confirm_payment(%L, 'ORANGE', 'TX1', 120)$q$, pid));
  reset role;
  insert into res4(test, ok) values ('a payment cannot be confirmed twice', v like '%not pending%');
  set local role service_role;
  v := pg_temp.raises(format($q$select provider_confirm_payment((select id from payments where order_id = %L), 'ORANGE', 'TX2', 100)$q$, os));
  reset role;
  insert into res4(test, ok) values ('a demo payment can never be confirmed as real', v like '%Not a mobile money%');

  -- ===== H. linking logins =====
  perform pg_temp.as_user(adm, true); set local role authenticated;
  insert into riders (display_name, availability) values ('Link Rider', 'AVAILABLE') returning id into rider3;
  v := pg_temp.raises(format($q$select admin_link_staff('RIDER', 'nobody@example.test', %L)$q$, rider3));
  insert into res4(test, ok) values ('linking an unknown email explains what to do', v like '%Create it first in Supabase%');
  v := pg_temp.raises(format($q$select admin_link_staff('RIDER', 'p_anon@example.test', %L)$q$, rider3));
  insert into res4(test, ok) values ('an anonymous customer session cannot be linked as staff', v like '%anonymous%');
  v := pg_temp.raises(format($q$select admin_link_staff('RIDER', 'p_rider', %L)$q$, rider3));
  insert into res4(test, ok) values ('a login already linked to another rider is refused', v like '%already linked to the rider Pay Rider A%');
  perform admin_link_staff('RIDER', 'P_NewRider@Example.Test', rider3);
  insert into res4(test, ok) select 'rider login linked (email match ignores case)', user_id = u_new from riders where id = rider3;
  v := pg_temp.raises(format($q$select admin_link_staff('RIDER', 'p_other@example.test', %L)$q$, rider3));
  insert into res4(test, ok) values ('a rider that already has a login cannot be silently overwritten', v like '%already has a different login%');
  perform admin_link_staff('MERCHANT', 'p_other@example.test', gm);
  insert into res4(test, ok) select 'merchant login linked', exists (select 1 from merchant_staff where merchant_id = gm and user_id = u_other);
  perform admin_unlink_staff('MERCHANT', gm, u_other);
  insert into res4(test, ok) select 'merchant login unlinked', not exists (select 1 from merchant_staff where merchant_id = gm and user_id = u_other);
  perform admin_unlink_staff('RIDER', rider3);
  insert into res4(test, ok) select 'idle rider login unlinked', user_id is null from riders where id = rider3;
  insert into res4(test, ok) select 'linking is audited', count(*) >= 3 from admin_audit_log where action in ('STAFF_LINK','STAFF_UNLINK');
  reset role;
  perform pg_temp.as_user(mer); set local role authenticated;
  v := pg_temp.raises(format($q$select admin_link_staff('MERCHANT', 'p_other@example.test', %L)$q$, gm));
  insert into res4(test, ok) values ('merchant staff cannot link logins', v like '%Admin only%');
  reset role;
  perform pg_temp.as_user(cust); set local role authenticated;
  v := pg_temp.raises(format($q$select admin_link_staff('RIDER', 'p_cust', %L)$q$, rider3));
  insert into res4(test, ok) values ('a customer cannot link themselves as a rider', v like '%Admin only%');
  reset role;

  -- ===== I. admin dashboard data =====
  perform pg_temp.as_user(adm, true); set local role authenticated;
  d := admin_overview();
  insert into res4(test, ok) values ('overview counts agree with the orders table',
     ((d->'ops'->'total'->>'demo')::int + (d->'ops'->'total'->>'live')::int) = (select count(*) from orders)
     and ((d->'ops'->'completed'->>'demo')::int) = (select count(*) from orders where status = 'DELIVERED' and is_demo));
  insert into res4(test, ok) values ('overview reports payments by status', exists (select 1 from jsonb_array_elements(d->'payments') p where p->>'status' = 'SIMULATED')
     and exists (select 1 from jsonb_array_elements(d->'payments') p where p->>'status' = 'PAID'));
  insert into res4(test, ok) values ('overview reports settlements outstanding as numbers from the database', jsonb_typeof(d->'settlements'->'merchant_owed') = 'array');
  d := admin_setup_status();
  insert into res4(test, ok) values ('setup status counts come from the database', (d->>'orders')::int = (select count(*) from orders) and (d->>'riders_with_login')::int >= 2);
  d := admin_rider_load();
  insert into res4(test, ok) values ('rider load reports active orders and eligibility', exists (select 1 from jsonb_array_elements(d) x where x->>'display_name' = 'Pay Rider A'));
  d := admin_finance_summary();
  insert into res4(test, ok) values ('finance summary includes settings and history', d->'settings' is not null and jsonb_array_length(d->'recent_merchant_settlements') >= 1);
  reset role;
  perform pg_temp.as_user(mer); set local role authenticated;
  v := pg_temp.raises($q$select admin_finance_summary()$q$); insert into res4(test, ok) values ('merchant cannot read the finance summary', v like '%Admin only%');
  v := pg_temp.raises($q$select admin_setup_status()$q$); insert into res4(test, ok) values ('merchant cannot read setup status', v like '%Admin only%');
  reset role;

  -- ===== J. delay rules =====
  update orders set status_changed_at = now() - interval '20 minutes' where id = (select id from orders where status = 'PLACED' limit 1);
  perform pg_temp.as_user(adm, true); set local role authenticated;
  d := admin_overview();
  insert into res4(test, ok) values ('a new order waiting more than 10 minutes counts as delayed', ((d->'ops'->'delayed'->>'demo')::int + (d->'ops'->'delayed'->>'live')::int) >= 1 or not exists (select 1 from orders where status = 'PLACED'));
  reset role;
end $$;
select n, case when ok then 'PASS' else 'FAIL' end as result, test from public.res4 order by n;
