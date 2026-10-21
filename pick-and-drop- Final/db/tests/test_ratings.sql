\set ON_ERROR_STOP on
-- Run on a fresh database after the stub, migrations 01 to 07 and db/dev/dev_seed_grocers.sql.
drop table if exists public.res7; create table public.res7(n serial, test text, ok boolean);
grant all on public.res7 to public; grant all on sequence public.res7_n_seq to public;
create or replace function pg_temp.as_user(u uuid, adm boolean default false) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub',u,'app_metadata', case when adm then json_build_object('role','admin') else '{}'::json end)::text, true);
end $$;
do $$
declare cust uuid; other uuid; adm uuid; gm uuid; prod uuid; o1 uuid; o2 uuid; r jsonb; ok boolean; n int; avg1 numeric; cnt int;
  addr jsonb := '{"contact_name":"Rate Test","contact_phone":"+23276111111","address_line":"9 Rating Test Road Freetown"}';
begin
  insert into auth.users(email) values ('r_cust') returning id into cust;
  insert into auth.users(email) values ('r_other') returning id into other;
  insert into auth.users(email) values ('r_admin') returning id into adm;
  select id into gm from merchants where slug='goodies-supermarket';
  select id into prod from products where merchant_id=gm limit 1;
  perform pg_temp.as_user(cust); set local role authenticated;
  o1 := (place_order(gm, jsonb_build_array(jsonb_build_object('product_id',prod,'qty',1)), addr, 'CASH_ON_DELIVERY', null)->>'order_id')::uuid;
  o2 := (place_order(gm, jsonb_build_array(jsonb_build_object('product_id',prod,'qty',1)), addr, 'CASH_ON_DELIVERY', null)->>'order_id')::uuid;
  -- not delivered yet
  begin perform rate_order(o1, 5, null); ok := false; exception when others then ok := sqlerrm like '%once it has been delivered%'; end;
  insert into res7(test, ok) values ('cannot rate an order that is not delivered', ok);
  reset role;
  update order_delivery_pins set verified_at = now() where order_id in (o1, o2);   -- the real guard still applies: no verified PIN, no DELIVERED
  update payments set status = 'PAID', confirmed_at = now() where order_id in (o1, o2) and method = 'CASH_ON_DELIVERY';
  update orders set status='DELIVERED', delivery_status='DELIVERED', delivered_at=now() where id in (o1, o2);
  -- stranger
  perform pg_temp.as_user(other); set local role authenticated;
  begin perform rate_order(o1, 5, null); ok := false; exception when others then ok := sqlerrm like '%could not find%'; end;
  insert into res7(test, ok) values ('another customer cannot rate someone else''s order', ok);
  reset role;
  -- bad stars
  perform pg_temp.as_user(cust); set local role authenticated;
  begin perform rate_order(o1, 0, null); ok := false; exception when others then ok := true; end;
  insert into res7(test, ok) values ('0 stars refused', ok);
  begin perform rate_order(o1, 6, null); ok := false; exception when others then ok := true; end;
  insert into res7(test, ok) values ('6 stars refused', ok);
  begin perform rate_order(o1, 4, repeat('x', 301)); ok := false; exception when others then ok := true; end;
  insert into res7(test, ok) values ('comment over 300 characters refused', ok);
  -- good rating
  r := rate_order(o1, 5, '  Quick and hot  ');
  insert into res7(test, ok) values ('delivered order can be rated, shop rating recalculated', (r->>'shop_rating')::numeric = 5.0 and (r->>'shop_rating_count')::int = 1);
  begin perform rate_order(o1, 1, null); ok := false; exception when others then ok := sqlerrm like '%already rated%'; end;
  insert into res7(test, ok) values ('an order can only be rated once', ok);
  r := rate_order(o2, 2, null);
  insert into res7(test, ok) values ('average of 5 and 2 is 3.5 with count 2', (r->>'shop_rating')::numeric = 3.5 and (r->>'shop_rating_count')::int = 2);
  select count(*) into n from order_ratings;
  insert into res7(test, ok) values ('the customer can read their own ratings', n = 2);
  -- direct writes are impossible
  begin insert into order_ratings(order_id, merchant_id, customer_id, stars) values (gen_random_uuid(), gm, cust, 5); ok := false; exception when others then ok := true; end;
  insert into res7(test, ok) values ('direct insert into order_ratings is refused', ok);
  begin update order_ratings set stars = 5; get diagnostics n = row_count; ok := n = 0; exception when others then ok := true; end;
  insert into res7(test, ok) values ('direct edit of a rating is refused', ok);
  begin update merchants set rating = 5 where id = gm; get diagnostics n = row_count; ok := n = 0; exception when others then ok := true; end;
  insert into res7(test, ok) values ('a customer cannot set a shop rating directly', ok);
  reset role;
  perform pg_temp.as_user(other); set local role authenticated;
  select count(*) into n from order_ratings;
  insert into res7(test, ok) values ('another customer cannot read these ratings', n = 0);
  reset role;
  perform pg_temp.as_user(adm, true); set local role authenticated;
  select count(*) into n from order_ratings;
  insert into res7(test, ok) values ('admin can read all ratings', n = 2);
  reset role;
  perform pg_temp.as_user(null); set local role anon;
  begin perform rate_order(o1, 5, null); ok := false; exception when others then ok := true; end;
  insert into res7(test, ok) values ('signed-out caller cannot rate', ok);
  reset role;
  select rating, rating_count into avg1, cnt from merchants_public where slug='goodies-supermarket';
  insert into res7(test, ok) values ('public shop listing shows the new average and count', avg1 = 3.5 and cnt = 2);
end $$;
select n, case when ok then 'PASS' else 'FAIL' end as result, test from res7 order by n;
