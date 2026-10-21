\set ON_ERROR_STOP on
drop table if exists public.res; create table public.res(n serial, test text, ok boolean);
grant all on public.res to public; grant all on sequence public.res_n_seq to public;
create or replace function pg_temp.as_user(u uuid, adm boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub',u,'app_metadata', case when adm then json_build_object('role','admin') else '{}'::json end)::text, true);
end $$;
do $$
declare cust uuid; cust2 uuid; mer uuid; mer2 uuid; rid uuid; adm uuid; stranger uuid;
  gm uuid; prod uuid; oid uuid; oid2 uuid; riderrow uuid; vpin text; r jsonb; n int; err text;
  procedure_ok boolean;
begin
  insert into auth.users(email) values ('cust') returning id into cust;
  insert into auth.users(email) values ('cust2') returning id into cust2;
  insert into auth.users(email) values ('merch') returning id into mer;
  insert into auth.users(email) values ('merch2') returning id into mer2;
  insert into auth.users(email) values ('rider') returning id into rid;
  insert into auth.users(email) values ('admin') returning id into adm;
  select id into gm from merchants where slug='goodies-supermarket';
  select id into riderrow from riders where display_name='Demo Rider 001';
  insert into merchant_staff values (gm, mer);
  update riders set user_id = rid where id = riderrow;
  insert into product_categories(merchant_id,name) values (gm,'T');
  insert into products(merchant_id,name,price) values (gm,'TEST Rice',100) returning id into prod;

  -- customer places order
  perform pg_temp.as_user(cust); set local role authenticated;
  r := place_order(gm, jsonb_build_array(jsonb_build_object('product_id',prod,'qty',2)),
        '{"contact_name":"Test Customer","contact_phone":"+23276000000","address_line":"1 Test Street Freetown","notes":"gate"}', 'ORANGE_MONEY','TXN123456');
  oid := (r->>'order_id')::uuid;
  insert into res(test,ok) values ('order placed, total=200+20 server-side', (select total=220 and status='PLACED' from orders where id=oid));
  select d.pin into vpin from order_delivery_pins d where d.order_id=oid;
  insert into res(test,ok) values ('customer can read own PIN', vpin ~ '^[0-9]{4}$');
  begin perform place_order(gm, jsonb_build_array(jsonb_build_object('product_id',prod,'qty',1)),'{"contact_name":"Test Customer","contact_phone":"+23276000000","address_line":"1 Test Street Freetown"}','ORANGE_MONEY','TXN123456'); procedure_ok:=false;
  exception when others then procedure_ok:=true; end;
  insert into res(test,ok) values ('reused transaction ID rejected', procedure_ok);
  begin update orders set status='DELIVERED' where id=oid; get diagnostics n = row_count; procedure_ok := n=0; exception when others then procedure_ok:=true; end;
  insert into res(test,ok) values ('customer cannot update orders directly', procedure_ok);
  reset role;

  -- other customer / stranger isolation
  perform pg_temp.as_user(cust2); set local role authenticated;
  select count(*) into n from orders; insert into res(test,ok) values ('other customer sees 0 orders', n=0);
  select count(*) into n from order_delivery_pins; insert into res(test,ok) values ('other customer sees 0 PINs', n=0);
  reset role;

  -- merchant isolation + transitions
  perform pg_temp.as_user(mer2); set local role authenticated;
  select count(*) into n from orders; insert into res(test,ok) values ('unlinked merchant user sees 0 orders', n=0);
  begin perform merchant_set_order_status(oid,'ACCEPT'); procedure_ok:=false; exception when others then procedure_ok:=true; end;
  insert into res(test,ok) values ('unlinked merchant cannot accept', procedure_ok);
  reset role;
  perform pg_temp.as_user(mer); set local role authenticated;
  select count(*) into n from orders; insert into res(test,ok) values ('linked merchant sees the order', n=1);
  select count(*) into n from order_delivery_pins; insert into res(test,ok) values ('merchant sees 0 PINs', n=0);
  begin perform merchant_set_order_status(oid,'READY'); procedure_ok:=false; exception when others then procedure_ok:=true; end;
  insert into res(test,ok) values ('cannot skip PLACED->READY', procedure_ok);
  perform merchant_set_order_status(oid,'ACCEPT'); perform merchant_set_order_status(oid,'PREPARING'); perform merchant_set_order_status(oid,'READY');
  insert into res(test,ok) values ('merchant flow to READY_FOR_PICKUP', (select status='READY_FOR_PICKUP' from orders where id=oid));
  reset role;

  -- rider cannot act before assignment, sees nothing
  perform pg_temp.as_user(rid); set local role authenticated;
  select count(*) into n from orders; insert into res(test,ok) values ('rider sees 0 orders before assignment', n=0);
  reset role;
  -- non-admin cannot assign
  perform pg_temp.as_user(mer); set local role authenticated;
  begin perform admin_assign_rider(oid, riderrow); procedure_ok:=false; exception when others then procedure_ok:=true; end;
  insert into res(test,ok) values ('non-admin cannot assign rider', procedure_ok);
  reset role;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  perform admin_assign_rider(oid, riderrow);
  insert into res(test,ok) values ('admin assigns Demo Rider 001', (select delivery_status='ASSIGNED' from orders where id=oid));
  reset role;

  -- rider flow
  perform pg_temp.as_user(rid); set local role authenticated;
  select count(*) into n from orders; insert into res(test,ok) values ('rider sees assigned order', n=1);
  select count(*) into n from order_delivery_pins; insert into res(test,ok) values ('rider sees 0 PINs (table read)', n=0);
  begin perform rider_advance_delivery(oid,'PICKUP'); procedure_ok:=false; exception when others then procedure_ok:=true; end;
  insert into res(test,ok) values ('rider cannot skip steps', procedure_ok);
  perform rider_advance_delivery(oid,'ACCEPT'); perform rider_advance_delivery(oid,'ARRIVE_MERCHANT');
  perform rider_advance_delivery(oid,'PICKUP'); perform rider_advance_delivery(oid,'ON_THE_WAY');
  begin perform verify_delivery_pin(oid, vpin); procedure_ok:=false; exception when others then procedure_ok:=true; end;
  insert into res(test,ok) values ('PIN rejected before arrival at customer', procedure_ok);
  perform rider_advance_delivery(oid,'ARRIVE_CUSTOMER');
  r := verify_delivery_pin(oid, case when vpin='0000' then '1111' else '0000' end);
  insert into res(test,ok) values ('wrong PIN fails, attempts counted', (r->>'ok')='false' and (r->>'attempts_left')='4' and (select status<>'DELIVERED' from orders where id=oid));
  r := verify_delivery_pin(oid, vpin);
  insert into res(test,ok) values ('correct PIN completes delivery', (r->>'ok')='true' and (select status='DELIVERED' and delivery_status='DELIVERED' from orders where id=oid));
  reset role;

  -- lockout on a second order
  perform pg_temp.as_user(cust); set local role authenticated;
  r := place_order(gm, jsonb_build_array(jsonb_build_object('product_id',prod,'qty',1)),'{"contact_name":"Test Customer","contact_phone":"+23276000000","address_line":"2 Test Street Freetown"}','AFRIMONEY','TXN999999');
  oid2 := (r->>'order_id')::uuid; select d.pin into vpin from order_delivery_pins d where d.order_id=oid2; reset role;
  perform pg_temp.as_user(mer); set local role authenticated;
  perform merchant_set_order_status(oid2,'ACCEPT'); perform merchant_set_order_status(oid2,'PREPARING'); perform merchant_set_order_status(oid2,'READY'); reset role;
  perform pg_temp.as_user(adm,true); set local role authenticated; perform admin_assign_rider(oid2, riderrow); reset role;
  perform pg_temp.as_user(rid); set local role authenticated;
  perform rider_advance_delivery(oid2,'ACCEPT'); perform rider_advance_delivery(oid2,'ARRIVE_MERCHANT'); perform rider_advance_delivery(oid2,'PICKUP');
  perform rider_advance_delivery(oid2,'ON_THE_WAY'); perform rider_advance_delivery(oid2,'ARRIVE_CUSTOMER');
  for i in 1..5 loop perform verify_delivery_pin(oid2, case when vpin='0000' then '1111' else '0000' end); end loop;
  begin perform verify_delivery_pin(oid2, vpin); procedure_ok:=false; exception when others then procedure_ok:=true; end;
  insert into res(test,ok) values ('PIN locks after 5 wrong tries (even correct PIN refused)', procedure_ok);
  reset role;
  -- admin cannot force DELIVERED without PIN
  perform pg_temp.as_user(adm,true); set local role authenticated;
  begin update orders set status='DELIVERED', delivery_status='DELIVERED' where id=oid2; exception when others then null; end; procedure_ok := (select status<>'DELIVERED' from orders where id=oid2);
  insert into res(test,ok) values ('admin cannot force DELIVERED without verified PIN', procedure_ok);
  reset role;

  -- reject flow refunds simulated payment
  perform pg_temp.as_user(cust); set local role authenticated;
  r := place_order(gm, jsonb_build_array(jsonb_build_object('product_id',prod,'qty',1)),'{"contact_name":"Test Customer","contact_phone":"+23276000000","address_line":"3 Test Street Freetown"}','AFRIMONEY','TXN555555');
  oid := (r->>'order_id')::uuid; reset role;
  perform pg_temp.as_user(mer); set local role authenticated; perform merchant_set_order_status(oid,'REJECT'); reset role;
  insert into res(test,ok) values ('reject cancels and refunds simulated payment', (select o.status='CANCELLED' and p.status='REFUNDED' from orders o join payments p on p.order_id=o.id where o.id=oid));
  insert into res(test,ok) values ('status history recorded', (select count(*)>=8 from order_status_history where order_id=oid2));
end $$;
select n, case when ok then 'PASS' else 'FAIL' end, test from res order by n;
