-- =====================================================================
-- PICK & DROP | Migration 01: Merchant catalogue
-- Run in the Supabase SQL editor on a fresh project.
-- Scope: service areas, merchants, hours, browse categories,
--        per-merchant product sections, products, RLS.
-- Orders, payments, riders, PINs come in migration 02.
-- =====================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

-- ---------- helpers ---------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Admin is a claim in app_metadata, which only the service role can set.
-- Users cannot edit app_metadata, so this is safe to use in RLS.
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

-- Great-circle distance in km. Used for delivery radius checks now
-- and nearest-rider matching later.
create or replace function public.distance_km(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) returns double precision language sql immutable as $$
  select 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lon2 - lon1) / 2), 2)
  ))
$$;

-- ---------- service areas ---------------------------------------------
-- Launch scope is controlled by data, not code. Flip is_active to expand.

create table public.service_areas (
  id          smallint generated always as identity primary key,
  slug        text not null unique,
  name        text not null,
  is_active   boolean not null default false,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now()
);

insert into public.service_areas (slug, name, is_active, sort_order) values
  ('central-freetown',  'Central Freetown',          true,  1),
  ('west-freetown',     'West Freetown',             true,  2),
  ('western-peninsula', 'Western Area Peninsula',    true,  3),
  ('east-freetown',     'East Freetown',             false, 9);  -- excluded at launch

-- ---------- merchants -------------------------------------------------

create table public.merchants (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique
                      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name              text not null,
  brand_name        text,              -- chains: "Choithram"; name can carry the branch
  branch_name       text,
  merchant_type     text not null
                      check (merchant_type in ('RESTAURANT','GROCERY')),
  status            text not null default 'DEMO'
                      check (status in ('DEMO','PENDING','ACTIVE','SUSPENDED')),
  description       text,

  -- location
  service_area_id   smallint not null references public.service_areas(id),
  address_line      text,
  neighbourhood     text,              -- e.g. Wilkinson Road, Aberdeen, Lumley
  landmark          text,              -- how people actually navigate in Freetown
  latitude          numeric(9,6),
  longitude         numeric(9,6),

  -- contact
  phone             text,
  whatsapp          text,
  website_url       text,
  social_url        text,

  -- presentation
  logo_url          text,
  cover_url         text,
  image_credit      text,              -- licence or source of the image
  price_tier        smallint check (price_tier between 1 and 3),
  rating            numeric(2,1) check (rating between 0 and 5),   -- null until real
  rating_count      integer not null default 0,
  is_featured       boolean not null default false,
  sort_order        integer not null default 0,

  -- delivery
  delivery_enabled  boolean not null default true,
  delivery_radius_km numeric(4,1) not null default 5 check (delivery_radius_km > 0),
  delivery_fee      numeric(10,2) not null default 0 check (delivery_fee >= 0),
  min_order_amount  numeric(10,2) not null default 0 check (min_order_amount >= 0),
  prep_time_min     smallint check (prep_time_min > 0),
  prep_time_max     smallint,
  currency          char(3) not null default 'SLE',

  -- partnership and data provenance
  owner_id          uuid references auth.users(id),
  partnered_at      timestamptz,
  data_source       text,              -- where we found the business
  source_url        text,
  verification      text not null default 'UNVERIFIED'
                      check (verification in ('UNVERIFIED','PHONE_CONFIRMED','VISITED')),
  last_verified_at  timestamptz,
  internal_notes    text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint merchants_geo_pair
    check ((latitude is null) = (longitude is null)),
  constraint merchants_lat_range
    check (latitude is null or latitude between -90 and 90),
  constraint merchants_lng_range
    check (longitude is null or longitude between -180 and 180),
  constraint merchants_prep_range
    check (prep_time_max is null or prep_time_max >= coalesce(prep_time_min, 0)),
  -- A business cannot be ACTIVE (a real partner) without an owner account
  -- and a recorded partnership date. This enforces the "never claim a
  -- partner who has not agreed" rule in the database itself.
  constraint merchants_active_requires_partner
    check (status <> 'ACTIVE' or (owner_id is not null and partnered_at is not null))
);

create index merchants_browse_idx
  on public.merchants (merchant_type, status, service_area_id, sort_order);
create index merchants_owner_idx on public.merchants (owner_id) where owner_id is not null;
create index merchants_name_trgm on public.merchants using gin (name gin_trgm_ops);

create trigger merchants_updated_at
  before update on public.merchants
  for each row execute function public.set_updated_at();

-- ---------- opening hours ---------------------------------------------
-- One row per open window. Two rows for a split day (lunch + evening).
-- No row for a day means closed. If closes_at < opens_at the window
-- runs past midnight.

create table public.merchant_hours (
  id           bigint generated always as identity primary key,
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  day_of_week  smallint not null check (day_of_week between 0 and 6),  -- 0 = Sunday
  opens_at     time not null,
  closes_at    time not null,
  check (opens_at <> closes_at),
  unique (merchant_id, day_of_week, opens_at)
);
create index merchant_hours_merchant_idx on public.merchant_hours (merchant_id);

-- ---------- browse categories -----------------------------------------
-- Global taxonomy used for homepage filters (Chicken, Pizza, Supermarket).
-- Not the same as a merchant's own menu sections (see product_categories).

create table public.categories (
  id             smallint generated always as identity primary key,
  merchant_type  text not null check (merchant_type in ('RESTAURANT','GROCERY')),
  slug           text not null unique,
  name           text not null,
  sort_order     smallint not null default 0
);

create table public.merchant_categories (
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  category_id  smallint not null references public.categories(id),
  is_primary   boolean not null default false,
  primary key (merchant_id, category_id)
);
create unique index merchant_one_primary_category
  on public.merchant_categories (merchant_id) where is_primary;

insert into public.categories (merchant_type, slug, name, sort_order) values
  ('RESTAURANT','sierra-leonean',     'Sierra Leonean',        1),
  ('RESTAURANT','chicken-grills',     'Chicken and Grills',    2),
  ('RESTAURANT','fast-food',          'Fast Food',             3),
  ('RESTAURANT','pizza',              'Pizza',                 4),
  ('RESTAURANT','chinese-asian',      'Chinese and Asian',     5),
  ('RESTAURANT','lebanese',           'Lebanese',              6),
  ('RESTAURANT','indian',             'Indian',                7),
  ('RESTAURANT','seafood',            'Seafood',               8),
  ('RESTAURANT','bakery-pastry',      'Bakery and Pastry',     9),
  ('RESTAURANT','cafe-coffee',        'Cafe and Coffee',      10),
  ('RESTAURANT','desserts',           'Ice Cream and Desserts',11),
  ('RESTAURANT','juice-smoothies',    'Juice and Smoothies',  12),
  ('GROCERY',   'supermarket',        'Supermarket',           1),
  ('GROCERY',   'minimart',           'Minimart',              2),
  ('GROCERY',   'fresh-produce',      'Fresh Produce',         3),
  ('GROCERY',   'wholesale',          'Wholesale',             4);

-- ---------- products --------------------------------------------------
-- One products table serves restaurants and grocers. merchant_type
-- decides how the UI renders it (menu vs aisle). Menu sections are
-- per merchant, so each business keeps its own structure.

create table public.product_categories (
  id           bigint generated always as identity primary key,
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  name         text not null,
  sort_order   integer not null default 0,
  unique (merchant_id, name),
  unique (id, merchant_id)             -- target for the composite FK below
);

create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  merchant_id          uuid not null references public.merchants(id) on delete cascade,
  product_category_id  bigint,
  name                 text not null,
  description          text,
  price                numeric(10,2) not null check (price >= 0),
  unit_label           text,           -- "1 kg", "500 ml", "per portion"
  image_url            text,
  is_available         boolean not null default true,
  sort_order           integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- A product can only sit in a section that belongs to the same merchant.
  foreign key (product_category_id, merchant_id)
    references public.product_categories (id, merchant_id)
);
create index products_merchant_idx on public.products (merchant_id, is_available, sort_order);
create index products_name_trgm on public.products using gin (name gin_trgm_ops);

create trigger products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------- public read view ------------------------------------------
-- The UI reads this view so the "partner or demo" wording is decided
-- once, in the database, and never by frontend code.

create view public.merchants_public
with (security_invoker = true) as
select
  m.*,
  sa.name as service_area_name,
  case m.status when 'ACTIVE' then 'Pick & Drop partner' else 'Demo listing' end as partner_label,
  (m.status = 'ACTIVE') as is_partner
from public.merchants m
join public.service_areas sa on sa.id = m.service_area_id;

-- ---------- row level security ----------------------------------------
-- Visible to customers: DEMO and ACTIVE merchants only.
-- PENDING and SUSPENDED are hidden from the public catalogue.

alter table public.service_areas      enable row level security;
alter table public.merchants          enable row level security;
alter table public.merchant_hours     enable row level security;
alter table public.categories         enable row level security;
alter table public.merchant_categories enable row level security;
alter table public.product_categories enable row level security;
alter table public.products           enable row level security;

-- reference data: public read, admin write
create policy service_areas_read on public.service_areas
  for select to anon, authenticated using (true);
create policy service_areas_admin on public.service_areas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy categories_read on public.categories
  for select to anon, authenticated using (true);
create policy categories_admin on public.categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- merchants: public sees DEMO/ACTIVE, owners see their own, admin sees all
create policy merchants_read on public.merchants
  for select to anon, authenticated
  using (status in ('DEMO','ACTIVE') or owner_id = auth.uid() or public.is_admin());
create policy merchants_admin on public.merchants
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- Owners cannot edit the merchants row in the MVP, so they cannot
-- change their own status, owner or fees. Admin does that.

-- child tables: readable when the parent merchant is readable
create policy merchant_hours_read on public.merchant_hours
  for select to anon, authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id));
create policy merchant_hours_admin on public.merchant_hours
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy merchant_categories_read on public.merchant_categories
  for select to anon, authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id));
create policy merchant_categories_admin on public.merchant_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy product_categories_read on public.product_categories
  for select to anon, authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id));
create policy product_categories_admin on public.product_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy products_read on public.products
  for select to anon, authenticated
  using (exists (select 1 from public.merchants m where m.id = merchant_id));
create policy products_admin on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- real partners manage their own menu once ACTIVE
create policy products_owner_write on public.products
  for all to authenticated
  using (exists (select 1 from public.merchants m
                 where m.id = merchant_id and m.owner_id = auth.uid() and m.status = 'ACTIVE'))
  with check (exists (select 1 from public.merchants m
                 where m.id = merchant_id and m.owner_id = auth.uid() and m.status = 'ACTIVE'));
