-- DEV ONLY. Lets you test browsing before the research pass is done.
-- Names come from the founder's list. Area is a placeholder, address and
-- coordinates are unknown. Items and prices below are TEST VALUES, not real.
-- Run AFTER migration 05. Delete before any public demo:
--   delete from merchants where id in (select merchant_id from merchant_internal where internal_notes like 'DEV SEED%');
insert into merchants (slug, name, merchant_type, status, service_area_id, verification, delivery_fee, prep_time_min, prep_time_max)
select v.slug, v.name, 'GROCERY', 'DEMO', (select id from service_areas where slug = 'central-freetown'),
       'UNVERIFIED', 20, 30, 45
from (values
 ('goodies-supermarket','Goodies'),('st-marys-supermarket','St Mary''s'),('fairway-supermarket','Fairway'),
 ('monoprix-freetown','Monoprix'),('freetown-supermarket','Freetown Supermarket'),('city-supermarket','City Supermarket'),
 ('choithram-freetown','Choithram'),('adnans-supermarket','Adnan''s'),('freetown-mall','Freetown Mall')
) as v(slug, name)
on conflict (slug) do nothing;

insert into merchant_internal (merchant_id, internal_notes)
select id, 'DEV SEED: area unconfirmed' from merchants
where slug in ('goodies-supermarket','st-marys-supermarket','fairway-supermarket','monoprix-freetown','freetown-supermarket','city-supermarket','choithram-freetown','adnans-supermarket','freetown-mall')
on conflict (merchant_id) do nothing;

insert into product_categories (merchant_id, name, sort_order)
select id, 'Pantry', 1 from merchants where slug = 'goodies-supermarket' on conflict do nothing;

insert into products (merchant_id, product_category_id, name, price, unit_label, sort_order)
select m.id, pc.id, v.name, v.price, v.unit, v.ord
from merchants m join product_categories pc on pc.merchant_id = m.id and pc.name = 'Pantry',
 (values ('TEST Rice',100,'5 kg',1),('TEST Cooking oil',60,'1 L',2),('TEST Sugar',30,'1 kg',3)) as v(name, price, unit, ord)
where m.slug = 'goodies-supermarket';
