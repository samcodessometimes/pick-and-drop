\set ON_ERROR_STOP on
-- Run AFTER test_flows.sql (reuses its Goodies merchant and TEST product). Needs supabase_stub.sql and migrations 01 to 04.
drop table if exists public.res2; create table public.res2(n serial, test text, ok boolean);
grant all on public.res2 to public; grant all on sequence public.res2_n_seq to public;
create or replace function pg_temp.as_user(u uuid, adm boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub',u,'app_metadata', case when adm then json_build_object('role','admin') else '{}'::json end)::text, true);
end $$;
do $$
declare cust uuid; mer uuid; rid uuid; adm uuid; owner uuid; gm uuid; prod uuid; rider1 uuid; rider2 uuid; rider3 uuid;
  o1 uuid; o2 uuid; o3 uuid; r jsonb; n int; ok boolean; mid uuid; rid_new uuid;
  function_names text[] := array['admin_overview()','admin_set_order_status(uuid,text,text)','admin_assign_rider(uuid,uuid)','admin_save_rider(uuid,text,text,text)','admin_save_merchant(uuid,jsonb)','admin_set_merchant_status(uuid,text,text,boolean)'];
  addr text := '{"contact_name":"Admin Test","contact_phone":"+23276111111","address_line":"9 Admin Test Road Freetown"}';
begin
  insert into auth.users(email) values ('a_cust') returning id into cust;
  insert into auth.users(email) values ('a_mer') returning id into mer;
  insert into auth.users(email) values ('a_rider') returning id into rid;
  insert into auth.users(email) values ('a_admin') returning id into adm;
  insert into auth.users(email) values ('owner@example.test') returning id into owner;
  select id into gm from merchants where slug='goodies-supermarket';
  select id into prod from products where merchant_id=gm limit 1;
  insert into merchant_staff values (gm, mer) on conflict do nothing;

  -- 1. non-admins (customer, merchant, rider) cannot call admin functions or read admin data
  perform pg_temp.as_user(cust); set local role authenticated;
  begin perform admin_overview(); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('customer cannot call admin_overview', ok);
  begin perform admin_save_merchant(null, '{"name":"Evil","merchant_type":"GROCERY","service_area":"central-freetown"}'); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('customer cannot create merchant', ok);
  begin perform admin_save_rider(null,'Evil','', 'AVAILABLE'); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('customer cannot create rider', ok);
  select count(*) into n from admin_audit_log; insert into res2(test,ok) values ('customer cannot read audit log', n=0);
  reset role;
  perform pg_temp.as_user(mer); set local role authenticated;
  begin perform admin_set_merchant_status(gm,'ACTIVE','owner@example.test',true); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('merchant staff cannot activate a merchant', ok);
  begin perform admin_set_order_status(gen_random_uuid(),'CANCELLED',null); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('merchant staff cannot use admin order status', ok);
  reset role;
  perform pg_temp.as_user(rid); set local role authenticated;
  begin perform admin_assign_rider(gen_random_uuid(), gen_random_uuid()); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('rider cannot assign riders', ok);
  reset role;

  -- 2. admin overview returns real grouped counts
  perform pg_temp.as_user(adm, true); set local role authenticated;
  r := admin_overview();
  insert into res2(test,ok) values ('admin overview returns orders/merchants/riders', r ? 'orders' and r ? 'merchants' and r ? 'riders');
  insert into res2(test,ok) values ('overview counts match table', (select coalesce(sum((x->>'n')::int),0) from jsonb_array_elements(r->'orders') x) = (select count(*) from orders));
  reset role;

  -- 3. merchants: create (always DEMO), validation, activation rules
  perform pg_temp.as_user(adm, true); set local role authenticated;
  r := admin_save_merchant(null, '{"name":"Test Kitchen Alpha","merchant_type":"RESTAURANT","service_area":"central-freetown","category":"pizza","phone":""}');
  mid := (r->>'id')::uuid;
  insert into res2(test,ok) values ('new merchant is DEMO with slug, no owner, no invented phone', (select status='DEMO' and slug='test-kitchen-alpha' and owner_id is null and phone is null from merchants where id=mid));
  insert into res2(test,ok) values ('primary category saved', exists (select 1 from merchant_categories mc join categories c on c.id=mc.category_id where mc.merchant_id=mid and mc.is_primary and c.slug='pizza'));
  r := admin_save_merchant(null, '{"name":"Test Kitchen Alpha","merchant_type":"RESTAURANT","service_area":"central-freetown"}');
  insert into res2(test,ok) values ('duplicate name gets unique slug', exists (select 1 from merchants where slug='test-kitchen-alpha-2'));
  begin perform admin_save_merchant(null, '{"name":"X","merchant_type":"GROCERY","service_area":"east-freetown"}'); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('short name rejected', ok);
  begin perform admin_save_merchant(null, '{"name":"East Shop","merchant_type":"GROCERY","service_area":"nowhere"}'); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('unknown service area rejected', ok);
  begin perform admin_save_merchant(null, '{"name":"Pizza Shop","merchant_type":"GROCERY","service_area":"central-freetown","category":"pizza"}'); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('category must match merchant type', ok);
  begin perform admin_set_merchant_status(mid,'ACTIVE','owner@example.test',false); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('ACTIVE refused without written-agreement confirmation', ok);
  begin perform admin_set_merchant_status(mid,'ACTIVE','nobody@example.test',true); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('ACTIVE refused for unknown owner email', ok);
  perform admin_set_merchant_status(mid,'SUSPENDED');
  reset role;
  perform pg_temp.as_user(cust); set local role authenticated;
  select count(*) into n from merchants where id=mid; insert into res2(test,ok) values ('SUSPENDED merchant hidden from customers', n=0);
  reset role;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  perform admin_set_merchant_status(mid,'ACTIVE','owner@example.test',true);
  insert into res2(test,ok) values ('ACTIVE with confirmation sets owner, partnered_at, staff link', (select status='ACTIVE' and owner_id=owner and partnered_at is not null from merchants where id=mid) and exists (select 1 from merchant_staff where merchant_id=mid and user_id=owner));
  insert into res2(test,ok) values ('partner label only for ACTIVE', (select partner_label from merchants_public where id=mid)='Pick & Drop partner' and (select partner_label from merchants_public where id=gm)='Demo listing');
  perform admin_set_merchant_status(mid,'DEMO');
  reset role;

  -- 4. riders
  perform pg_temp.as_user(adm, true); set local role authenticated;
  r := admin_save_rider(null,'Test Rider B','+232 76 000 111','AVAILABLE'); rider2 := (r->>'id')::uuid;
  r := admin_save_rider(null,'Test Rider C',null,'OFFLINE'); rider3 := (r->>'id')::uuid;
  insert into res2(test,ok) values ('new rider is demo with no login', (select is_demo and user_id is null from riders where id=rider2));
  begin perform admin_save_rider(null,'A','', 'AVAILABLE'); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('rider with 1-letter name rejected', ok);
  begin perform admin_save_rider(null,'Bad Phone','abc','AVAILABLE'); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('rider with bad phone rejected', ok);
  begin perform admin_save_rider(null,'Busy Try','', 'BUSY'); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('BUSY cannot be set manually', ok);
  reset role;
  select id into rider1 from riders where display_name='Demo Rider 001';

  -- 5. orders: admin status, history notes, rider assignment rules
  perform pg_temp.as_user(cust); set local role authenticated;
  o1 := (place_order(gm, jsonb_build_array(jsonb_build_object('product_id',prod,'qty',1)), addr::jsonb, 'ORANGE_MONEY','ADM000001')->>'order_id')::uuid;
  o2 := (place_order(gm, jsonb_build_array(jsonb_build_object('product_id',prod,'qty',1)), addr::jsonb, 'AFRIMONEY','ADM000002')->>'order_id')::uuid;
  o3 := (place_order(gm, jsonb_build_array(jsonb_build_object('product_id',prod,'qty',1)), addr::jsonb, 'AFRIMONEY','ADM000003')->>'order_id')::uuid;
  reset role;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  begin perform admin_set_order_status(o1,'DELIVERED','force'); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('admin cannot set DELIVERED', ok);
  begin perform admin_set_order_status(o1,'READY_FOR_PICKUP',null); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('admin cannot skip PLACED to READY', ok);
  perform admin_set_order_status(o1,'ACCEPTED','phoned the shop');
  insert into res2(test,ok) values ('admin status change logged with reason and actor', exists (select 1 from order_status_history where order_id=o1 and status='ACCEPTED' and note='phoned the shop' and actor_id=adm));
  begin update orders set status='PREPARING' where id=o1; get diagnostics n = row_count; ok := n=0; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('admin cannot update orders table directly any more', ok);
  begin perform admin_assign_rider(o1, rider3); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('offline rider cannot be assigned', ok);
  perform admin_assign_rider(o1, rider1);
  begin perform admin_assign_rider(o1, rider1); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('assigning same rider again refused', ok);
  begin perform admin_assign_rider(o3, rider1); ok:=false; exception when others then ok:=true; end;
  insert into res2(test,ok) values ('rider already holding 2 active orders refused a third', ok);
  perform admin_assign_rider(o1, rider2);
  insert into res2(test,ok) values ('reassign moves order to new rider as ASSIGNED', (select rider_id=rider2 and delivery_status='ASSIGNED' from orders where id=o1));
  reset role;
  perform pg_temp.as_user(rid); set local role authenticated;
  select count(*) into n from orders where id=o1; insert into res2(test,ok) values ('old rider no longer sees reassigned order', n=0);
  reset role;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  perform admin_assign_rider(o2, rider2);
  perform admin_set_order_status(o2,'CANCELLED','customer asked');
  insert into res2(test,ok) values ('cancel refunds simulated payment and unassigns rider', (select o.status='CANCELLED' and o.rider_id is null and o.delivery_status='UNASSIGNED' and p.status='REFUNDED' from orders o join payments p on p.order_id=o.id where o.id=o2));
  select count(*) into n from admin_audit_log; insert into res2(test,ok) values ('audit log records admin actions', n>=10);
  reset role;
end $$;
select n, case when ok then 'PASS' else 'FAIL' end as result, test from res2 order by n;
