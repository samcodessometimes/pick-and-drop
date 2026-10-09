-- Fixed test users and data for tests/api. Run once after migrations 01 to 05 and the dev seed.
-- Test-only. Never run against a real project.
insert into auth.users (id, email, is_anonymous, raw_app_meta_data, raw_user_meta_data) values
 ('00000000-0000-4000-8000-0000000000a1','cust-a@test', true,  '{}', '{}'),
 ('00000000-0000-4000-8000-0000000000a2','cust-b@test', true,  '{}', '{}'),
 ('00000000-0000-4000-8000-0000000000b1','merchant-goodies@test', false, '{}', '{}'),
 ('00000000-0000-4000-8000-0000000000b2','merchant-stmarys@test', false, '{}', '{}'),
 ('00000000-0000-4000-8000-0000000000c1','rider@test', false, '{}', '{}'),
 ('00000000-0000-4000-8000-0000000000c2','rider-other@test', false, '{}', '{}'),
 ('00000000-0000-4000-8000-0000000000d1','admin@test', false, '{"role":"admin"}', '{}'),
 ('00000000-0000-4000-8000-0000000000e1','attacker@test', false, '{}', '{"role":"admin"}'),
 ('00000000-0000-4000-8000-0000000000f1','owner@example.test', false, '{}', '{}')
on conflict do nothing;
insert into merchant_staff (merchant_id, user_id)
 select id, '00000000-0000-4000-8000-0000000000b1' from merchants where slug='goodies-supermarket' on conflict do nothing;
insert into merchant_staff (merchant_id, user_id)
 select id, '00000000-0000-4000-8000-0000000000b2' from merchants where slug='st-marys-supermarket' on conflict do nothing;
update riders set user_id='00000000-0000-4000-8000-0000000000c1' where display_name='Demo Rider 001';
insert into riders (display_name, is_demo, availability) values ('Test Rider 002', true, 'AVAILABLE'), ('Test Rider Offline', true, 'OFFLINE');
-- St Mary's: product, a minimum order and a delivery radius around central Freetown
insert into product_categories (merchant_id, name) select id, 'Pantry' from merchants where slug='st-marys-supermarket';
insert into products (merchant_id, product_category_id, name, price, unit_label)
 select m.id, pc.id, 'TEST Biscuits', 50, 'pack' from merchants m join product_categories pc on pc.merchant_id=m.id where m.slug='st-marys-supermarket';
update merchants set min_order_amount=200, latitude=8.484000, longitude=-13.229900, delivery_radius_km=5, delivery_fee=30 where slug='st-marys-supermarket';
-- An unavailable product at Goodies, and a SUSPENDED / PENDING merchant with products
insert into products (merchant_id, product_category_id, name, price, is_available)
 select m.id, pc.id, 'TEST Unavailable', 10, false from merchants m join product_categories pc on pc.merchant_id=m.id where m.slug='goodies-supermarket';
update merchants set status='SUSPENDED' where slug='fairway-supermarket';
update merchants set status='PENDING' where slug='monoprix-freetown';
insert into merchant_internal (merchant_id, internal_notes, data_source, source_url)
 select id, 'SECRET-NOTE-goodies', 'SECRET-SOURCE', 'https://example.test/secret' from merchants where slug='goodies-supermarket'
 on conflict (merchant_id) do update set internal_notes = excluded.internal_notes, data_source = excluded.data_source, source_url = excluded.source_url;
insert into merchant_internal (merchant_id, internal_notes) select id, 'SECRET-NOTE-suspended' from merchants where slug='fairway-supermarket'
 on conflict (merchant_id) do update set internal_notes = excluded.internal_notes;
insert into product_categories (merchant_id, name) select id,'Pantry' from merchants where slug in ('fairway-supermarket','monoprix-freetown');
insert into products (merchant_id, product_category_id, name, price)
 select m.id, pc.id, 'TEST Hidden item', 25 from merchants m join product_categories pc on pc.merchant_id=m.id where m.slug in ('fairway-supermarket','monoprix-freetown');
