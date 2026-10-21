-- =====================================================================
-- PICK & DROP | DEMO SEED for client demonstrations
-- Run AFTER migrations 01 to 06. Safe to run again: it never creates duplicates.
--
-- Everything here is FICTIONAL and clearly labelled "Demo". The businesses do not exist, have no
-- address, phone number or partnership with Pick & Drop, and their prices are made up.
-- The images are original illustrations drawn for this project, not photographs of any business.
-- To remove all of it:
--   delete from merchants where slug like 'demo-%';        -- also removes their menus
--   delete from riders where display_name like 'Demo Rider %' and user_id is null;
-- =====================================================================

-- Demo shops get a NEGATIVE sort_order so they list first on the home page (other listings use 0 and sort by name).
-- 1. Fictional merchants -------------------------------------------------------------
insert into merchants (slug, name, merchant_type, status, service_area_id, verification, description,
                       neighbourhood, delivery_fee, min_order_amount, prep_time_min, prep_time_max,
                       cover_url, image_credit, delivery_enabled, sort_order)
select v.slug, v.name, v.mtype, 'DEMO', (select id from service_areas where slug = 'central-freetown'), 'UNVERIFIED', v.descr,
       'Central Freetown (demo)', v.fee, v.minimum, v.pmin, v.pmax, v.cover,
       'Illustration by Pick & Drop. Not a photograph of any real business.', true, v.ord
from (values
  ('demo-jollof-kitchen',      'Demo Jollof Kitchen',      'RESTAURANT', 'Fictional restaurant for demonstrations. Rice dishes and stews.',        25, 60, 25, 40, 'images/covers/restaurant-kitchen.svg',     -30),
  ('demo-fufu-soup-house',     'Demo Fufu & Soup House',   'RESTAURANT', 'Fictional restaurant for demonstrations. Soups and local dishes.',       25, 60, 30, 45, 'images/covers/restaurant-grill.svg',       -29),
  ('demo-burger-pizza-spot',   'Demo Burger & Pizza Spot', 'RESTAURANT', 'Fictional fast food place for demonstrations. Burgers, pizza and chips.', 30, 70, 20, 35, 'images/covers/restaurant-fastfood.svg',   -28),
  ('demo-grill-chicken',       'Demo Grill & Chicken',     'RESTAURANT', 'Fictional grill for demonstrations. Chicken and chips.',                 30, 70, 25, 40, 'images/covers/restaurant-grill.svg',       -27),
  ('demo-fresh-market',        'Demo Fresh Market',        'GROCERY',    'Fictional produce market for demonstrations. Fruit and vegetables.',      20, 40, 30, 45, 'images/covers/grocery-market.svg',         -20),
  ('demo-corner-supermarket',  'Demo Corner Supermarket',  'GROCERY',    'Fictional supermarket for demonstrations. Pantry, drinks and household.', 20, 50, 30, 45, 'images/covers/grocery-supermarket.svg',    -19)
) as v(slug, name, mtype, descr, fee, minimum, pmin, pmax, cover, ord)
on conflict (slug) do update set
  name = excluded.name, description = excluded.description, cover_url = excluded.cover_url, image_credit = excluded.image_credit,
  delivery_fee = excluded.delivery_fee, min_order_amount = excluded.min_order_amount,
  prep_time_min = excluded.prep_time_min, prep_time_max = excluded.prep_time_max, sort_order = excluded.sort_order
  where merchants.status = 'DEMO';           -- never overwrite a merchant an admin has changed to PENDING/ACTIVE/SUSPENDED

-- primary categories
insert into merchant_categories (merchant_id, category_id, is_primary)
select m.id, c.id, true
from (values ('demo-jollof-kitchen','sierra-leonean'),('demo-fufu-soup-house','sierra-leonean'),('demo-burger-pizza-spot','fast-food'),
             ('demo-grill-chicken','chicken-grills'),('demo-fresh-market','fresh-produce'),('demo-corner-supermarket','supermarket')) v(slug, cat)
join merchants m on m.slug = v.slug join categories c on c.slug = v.cat
on conflict (merchant_id, category_id) do nothing;

-- 2. Menus and shelves ---------------------------------------------------------------
drop table if exists pg_temp._demo_items;
create temporary table _demo_items (merchant_slug text, section text, sec_ord int, ord int, name text, descr text, price numeric, unit text, image text);
insert into _demo_items values
 ('demo-jollof-kitchen','Rice dishes',1,1,'Jollof rice with chicken','Demo dish. Jollof rice with grilled chicken.',90,'1 portion','images/meals/jollof-rice-chicken.svg'),
 ('demo-jollof-kitchen','Rice dishes',1,2,'Fried fish and rice','Demo dish. White rice with fried fish and pepper sauce.',85,'1 portion','images/meals/fried-fish-rice.svg'),
 ('demo-jollof-kitchen','Rice dishes',1,3,'Cassava leaves and rice','Demo dish. Rice with cassava leaf stew.',80,'1 portion','images/meals/cassava-leaves-rice.svg'),
 ('demo-jollof-kitchen','Drinks',2,4,'Soft drink','Demo drink.',35,'1 glass','images/meals/soft-drink.svg'),

 ('demo-fufu-soup-house','Soups',1,1,'Fufu with groundnut soup','Demo dish. Fufu served with groundnut soup.',95,'1 bowl','images/meals/fufu-groundnut-soup.svg'),
 ('demo-fufu-soup-house','Rice dishes',2,2,'Cassava leaves and rice','Demo dish. Rice with cassava leaf stew.',80,'1 portion','images/meals/cassava-leaves-rice.svg'),
 ('demo-fufu-soup-house','Rice dishes',2,3,'Fried fish and rice','Demo dish. White rice with fried fish and pepper sauce.',85,'1 portion','images/meals/fried-fish-rice.svg'),
 ('demo-fufu-soup-house','Drinks',3,4,'Soft drink','Demo drink.',35,'1 glass','images/meals/soft-drink.svg'),

 ('demo-burger-pizza-spot','Burgers',1,1,'Burger and chips','Demo dish. Beef burger with a carton of chips.',70,'1 meal','images/meals/burger-chips.svg'),
 ('demo-burger-pizza-spot','Burgers',1,2,'Chicken burger and chips','Demo dish. Crispy chicken burger with a carton of chips.',75,'1 meal','images/meals/chicken-burger-chips.svg'),
 ('demo-burger-pizza-spot','Pizza',2,3,'Margherita pizza','Demo dish. Tomato, mozzarella and basil.',120,'1 pizza','images/meals/pizza-margherita.svg'),
 ('demo-burger-pizza-spot','Pizza',2,4,'Pepperoni pizza','Demo dish. Tomato, mozzarella and pepperoni.',140,'1 pizza','images/meals/pizza-pepperoni.svg'),
 ('demo-burger-pizza-spot','Sides and drinks',3,5,'Chips','Demo side.',35,'1 carton','images/meals/chips.svg'),
 ('demo-burger-pizza-spot','Sides and drinks',3,6,'Soft drink','Demo drink.',30,'1 glass','images/meals/soft-drink.svg'),

 ('demo-grill-chicken','Grill',1,1,'Grilled chicken and chips','Demo dish. Two grilled chicken pieces with chips.',110,'1 plate','images/meals/grilled-chicken-chips.svg'),
 ('demo-grill-chicken','Grill',1,2,'Jollof rice with chicken','Demo dish. Jollof rice with grilled chicken.',90,'1 portion','images/meals/jollof-rice-chicken.svg'),
 ('demo-grill-chicken','Grill',1,3,'Chicken burger and chips','Demo dish. Crispy chicken burger with a carton of chips.',75,'1 meal','images/meals/chicken-burger-chips.svg'),
 ('demo-grill-chicken','Sides and drinks',2,4,'Chips','Demo side.',35,'1 carton','images/meals/chips.svg'),
 ('demo-grill-chicken','Sides and drinks',2,5,'Soft drink','Demo drink.',30,'1 glass','images/meals/soft-drink.svg'),

 ('demo-fresh-market','Fruit and vegetables',1,1,'Fresh tomatoes','Demo product.',25,'1 kg','images/groceries/fresh-tomatoes.svg'),
 ('demo-fresh-market','Fruit and vegetables',1,2,'Onions','Demo product.',20,'1 kg','images/groceries/onions.svg'),
 ('demo-fresh-market','Fruit and vegetables',1,3,'Bananas','Demo product.',30,'1 bunch','images/groceries/bananas.svg'),
 ('demo-fresh-market','Fruit and vegetables',1,4,'Oranges','Demo product.',35,'1 kg','images/groceries/oranges.svg'),
 ('demo-fresh-market','Fruit and vegetables',1,5,'Cabbage','Demo product.',20,'1 head','images/groceries/cabbage.svg'),
 ('demo-fresh-market','Fruit and vegetables',1,6,'Hot peppers','Demo product.',15,'250 g','images/groceries/hot-peppers.svg'),
 ('demo-fresh-market','Fruit and vegetables',1,7,'Apples','Demo product.',40,'1 kg','images/photos/apples-800.jpg'),
 ('demo-fresh-market','Fruit and vegetables',1,8,'Vegetable basket','Demo product. Tomatoes, pumpkin, corn, potatoes and greens.',90,'1 basket','images/photos/vegetable-basket-800.jpg'),

 ('demo-corner-supermarket','Pantry',1,1,'Rice','Demo product.',110,'5 kg','images/groceries/rice-5kg.svg'),
 ('demo-corner-supermarket','Pantry',1,2,'Cooking oil','Demo product.',65,'1 L','images/groceries/cooking-oil.svg'),
 ('demo-corner-supermarket','Drinks',2,3,'Bottled water','Demo product.',12,'1.5 L','images/groceries/bottled-water.svg'),
 ('demo-corner-supermarket','Drinks',2,4,'Orange juice','Demo product.',30,'1 L','images/groceries/juice-carton.svg'),
 ('demo-corner-supermarket','Household and toiletries',3,5,'Bar soap','Demo product.',35,'pack of 3','images/groceries/soap-bars.svg'),
 ('demo-corner-supermarket','Household and toiletries',3,6,'Toothpaste','Demo product.',28,'70 g','images/groceries/toothpaste.svg'),
 ('demo-corner-supermarket','Household and toiletries',3,7,'Laundry liquid','Demo product.',55,'1 L','images/groceries/laundry-liquid.svg'),
 ('demo-corner-supermarket','Household and toiletries',3,8,'Toilet tissue','Demo product.',40,'4 rolls','images/groceries/toilet-tissue.svg');

insert into product_categories (merchant_id, name, sort_order)
select distinct m.id, i.section, i.sec_ord from _demo_items i join merchants m on m.slug = i.merchant_slug
on conflict (merchant_id, name) do update set sort_order = excluded.sort_order;

-- new items
insert into products (merchant_id, product_category_id, name, description, price, unit_label, image_url, sort_order, is_available)
select m.id, pc.id, i.name, i.descr, i.price, i.unit, i.image, i.ord, true
from _demo_items i join merchants m on m.slug = i.merchant_slug
join product_categories pc on pc.merchant_id = m.id and pc.name = i.section
where not exists (select 1 from products p where p.merchant_id = m.id and p.name = i.name);
-- existing demo items: keep description, price, image and section in step with this file
update products p set description = i.descr, price = i.price, unit_label = i.unit, image_url = i.image, sort_order = i.ord,
       product_category_id = pc.id
from _demo_items i join merchants m on m.slug = i.merchant_slug join product_categories pc on pc.merchant_id = m.id and pc.name = i.section
where p.merchant_id = m.id and p.name = i.name;

-- 3. Illustration for the named grocers already in the database ----------------------------
-- These are real business names added as DEMO listings, so their picture is a generic drawing and says so.
update merchants set cover_url = 'images/covers/grocery-supermarket.svg',
       image_credit = 'Generic illustration by Pick & Drop. Not the real premises.'
where merchant_type = 'GROCERY' and status = 'DEMO' and cover_url is null and slug not like 'demo-%';

-- 4. A second demo rider so assignment and reassignment can be shown -----------------------------
insert into riders (display_name, is_demo, availability, latitude, longitude, location_updated_at)
select 'Demo Rider 002', true, 'AVAILABLE', 8.480000, -13.234000, now()
where not exists (select 1 from riders where display_name = 'Demo Rider 002');

drop table if exists pg_temp._demo_items;

select (select count(*) from merchants where slug like 'demo-%') as demo_merchants,
       (select count(*) from products p join merchants m on m.id = p.merchant_id where m.slug like 'demo-%') as demo_products,
       (select count(*) from riders where is_demo) as demo_riders;
