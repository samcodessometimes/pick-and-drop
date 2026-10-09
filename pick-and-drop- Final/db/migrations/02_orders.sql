-- =====================================================================
-- PICK & DROP | Migration 02: Orders, payments, riders, delivery PIN
-- Requires migration 01. In Supabase enable Authentication > Providers >
-- "Allow anonymous sign-ins" (customers get a real auth uid with no friction).
-- Rules enforced here, not in the browser:
--   * prices and totals are computed on the server from the products table
--   * the 4-digit PIN is generated on the server and is invisible to riders
--   * an order cannot become DELIVERED unless its PIN was verified
-- =====================================================================

create sequence public.order_number_seq start 1024;

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

create table public.riders (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid unique references auth.users(id),   -- null until a real rider has a login
  display_name         text not null,
  phone                text,
  is_demo              boolean not null default true,
  availability         text not null default 'OFFLINE'
                         check (availability in ('OFFLINE','AVAILABLE','BUSY')),
  latitude             numeric(9,6),
  longitude            numeric(9,6),
  location_updated_at  timestamptz,
  created_at           timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
-- Simulated rider. Position is a placeholder in central Freetown, not real GPS.
insert into public.riders (display_name, is_demo, availability, latitude, longitude, location_updated_at)
values ('Demo Rider 001', true, 'AVAILABLE', 8.484000, -13.229900, now());

create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text not null unique default ('PD' || nextval('public.order_number_seq')::text),
  customer_id      uuid not null references auth.users(id),
  merchant_id      uuid not null references public.merchants(id),
  rider_id         uuid references public.riders(id),
  status           text not null default 'PLACED' check (status in
                     ('PENDING_PAYMENT','PLACED','ACCEPTED','PREPARING','READY_FOR_PICKUP','DELIVERED','CANCELLED')),
  delivery_status  text not null default 'UNASSIGNED' check (delivery_status in
                     ('UNASSIGNED','ASSIGNED','ACCEPTED','AT_MERCHANT','PICKED_UP','ON_THE_WAY','AT_CUSTOMER','DELIVERED')),
  is_demo          boolean not null default true,       -- true while the merchant is not an ACTIVE partner
  subtotal         numeric(12,2) not null check (subtotal >= 0),
  delivery_fee     numeric(10,2) not null check (delivery_fee >= 0),
  total            numeric(12,2) not null check (total >= 0),
  currency         char(3) not null default 'SLE',
  contact_name     text not null,
  contact_phone    text not null,
  address_line     text not null,
  landmark         text,
  latitude         numeric(9,6),
  longitude        numeric(9,6),
  notes            text,
  delivered_at     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check (total = subtotal + delivery_fee)
);
create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_merchant_idx on public.orders (merchant_id, status);
create index orders_rider_idx    on public.orders (rider_id) where rider_id is not null;
create trigger orders_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.order_items (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.orders(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,                     -- snapshot, survives menu edits
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  quantity    integer not null check (quantity between 1 and 20),
  line_total  numeric(12,2) not null
);
create index order_items_order_idx on public.order_items (order_id);

create table public.payments (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders(id) on delete cascade,
  method             text not null check (method in ('ORANGE_MONEY','AFRIMONEY')),
  provider           text not null default 'SIMULATED',      -- later: ORANGE, AFRIMONEY
  provider_reference text,                                   -- transaction ID
  amount             numeric(12,2) not null check (amount >= 0),
  currency           char(3) not null default 'SLE',
  status             text not null default 'PENDING' check (status in ('PENDING','PAID','FAILED','REFUNDED')),
  is_simulated       boolean not null default true,
  verified_at        timestamptz,
  created_at         timestamptz not null default now()
);
create index payments_order_idx on public.payments (order_id);
-- one transaction ID can pay for one order only
create unique index payments_ref_unique on public.payments (method, provider_reference)
  where provider_reference is not null;

-- PIN lives in its own table so no join or select on orders can expose it.
-- Only the customer who owns the order can read it. Riders have no access
-- and can only call verify_delivery_pin(). Five wrong tries lock the PIN.
create table public.order_delivery_pins (
  order_id         uuid primary key references public.orders(id) on delete cascade,
  pin              char(4) not null check (pin ~ '^[0-9]{4}$'),
  failed_attempts  smallint not null default 0,
  locked_at        timestamptz,
  verified_at      timestamptz,
  created_at       timestamptz not null default now()
);

create table public.order_status_history (
  id         bigint generated always as identity primary key,
  order_id   uuid not null references public.orders(id) on delete cascade,
  kind       text not null check (kind in ('ORDER','DELIVERY')),
  status     text not null,
  actor_id   uuid,
  created_at timestamptz not null default now()
);
create index order_history_idx on public.order_status_history (order_id, created_at);

-- ---------- triggers ---------------------------------------------------

create or replace function public.log_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into order_status_history (order_id, kind, status, actor_id) values (new.id, 'ORDER', new.status, auth.uid());
  end if;
  if tg_op = 'UPDATE' and new.delivery_status is distinct from old.delivery_status then
    insert into order_status_history (order_id, kind, status, actor_id) values (new.id, 'DELIVERY', new.delivery_status, auth.uid());
  end if;
  return new;
end $$;
create trigger orders_log_status after insert or update on public.orders
  for each row execute function public.log_order_status();

-- Hard stop: DELIVERED is impossible without a verified PIN, even for admins.
create or replace function public.guard_delivered() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status = 'DELIVERED' and old.status <> 'DELIVERED')
     or (new.delivery_status = 'DELIVERED' and old.delivery_status <> 'DELIVERED') then
    if not exists (select 1 from order_delivery_pins where order_id = new.id and verified_at is not null) then
      raise exception 'Delivery PIN must be verified before an order can be delivered';
    end if;
  end if;
  return new;
end $$;
create trigger orders_guard_delivered before update on public.orders
  for each row execute function public.guard_delivered();

-- ---------- place_order ------------------------------------------------
-- The only way to create an order. Everything is validated and priced here.

create or replace function public.place_order(
  p_merchant_id uuid, p_items jsonb, p_address jsonb, p_method text, p_txn_ref text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  m           merchants%rowtype;
  v_order     orders%rowtype;
  v_subtotal  numeric(12,2);
  v_found     int;
  v_wanted    int;
  v_name      text := btrim(coalesce(p_address->>'contact_name', ''));
  v_phone     text := regexp_replace(coalesce(p_address->>'contact_phone', ''), '[^0-9+]', '', 'g');
  v_line      text := btrim(coalesce(p_address->>'address_line', ''));
  v_lat       numeric; v_lng numeric;
  v_simulated constant boolean := true;   -- set false when real Orange/Afrimoney verification exists
begin
  if v_uid is null then raise exception 'Please refresh and try again'; end if;
  if p_method not in ('ORANGE_MONEY','AFRIMONEY') then raise exception 'Choose Orange Money or Afrimoney'; end if;
  if p_txn_ref is null or p_txn_ref !~ '^[A-Za-z0-9]{6,24}$' then
    raise exception 'Enter a valid transaction ID (6 to 24 letters or numbers)'; end if;
  if length(v_name) < 2 or length(v_name) > 80 then raise exception 'Enter your name'; end if;
  if length(v_phone) < 8 or length(v_phone) > 15 then raise exception 'Enter a valid phone number'; end if;
  if length(v_line) < 5 or length(v_line) > 200 then raise exception 'Enter your delivery address'; end if;

  select * into m from merchants where id = p_merchant_id and status in ('DEMO','ACTIVE') and delivery_enabled;
  if not found then raise exception 'This store is not available for delivery'; end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Your cart is empty'; end if;
  drop table if exists pg_temp._po_lines;
  create temporary table _po_lines on commit drop as
    select (e->>'product_id')::uuid as pid, sum((e->>'qty')::int) as qty
    from jsonb_array_elements(p_items) e group by 1;
  if exists (select 1 from _po_lines where qty < 1 or qty > 20) then raise exception 'Quantity must be between 1 and 20'; end if;

  select count(*), coalesce(sum(p.price * l.qty), 0) into v_found, v_subtotal
  from _po_lines l join products p on p.id = l.pid and p.merchant_id = m.id and p.is_available;
  select count(*) into v_wanted from _po_lines;
  if v_found <> v_wanted then raise exception 'An item in your cart is no longer available. Please review your cart'; end if;
  if v_subtotal < m.min_order_amount then raise exception 'Minimum order is NLe %', m.min_order_amount; end if;

  if (p_address->>'latitude' is null) <> (p_address->>'longitude' is null) then raise exception 'Invalid location'; end if;
  if p_address->>'latitude' is not null then
    v_lat := (p_address->>'latitude')::numeric; v_lng := (p_address->>'longitude')::numeric;
    if v_lat not between -90 and 90 or v_lng not between -180 and 180 then raise exception 'Invalid location'; end if;
    if m.latitude is not null and distance_km(m.latitude, m.longitude, v_lat, v_lng) > m.delivery_radius_km then
      raise exception 'This address is outside the store delivery range'; end if;
  end if;

  insert into profiles (id, full_name, phone) values (v_uid, v_name, v_phone)
    on conflict (id) do update set full_name = excluded.full_name, phone = excluded.phone;

  insert into orders (customer_id, merchant_id, status, is_demo, subtotal, delivery_fee, total, currency,
                      contact_name, contact_phone, address_line, landmark, latitude, longitude, notes)
  values (v_uid, m.id, case when v_simulated then 'PLACED' else 'PENDING_PAYMENT' end, m.status <> 'ACTIVE',
          v_subtotal, m.delivery_fee, v_subtotal + m.delivery_fee, m.currency,
          v_name, v_phone, v_line, left(btrim(p_address->>'landmark'), 120), v_lat, v_lng, left(btrim(p_address->>'notes'), 300))
  returning * into v_order;

  insert into order_items (order_id, product_id, name, unit_price, quantity, line_total)
  select v_order.id, p.id, p.name, p.price, l.qty, p.price * l.qty
  from _po_lines l join products p on p.id = l.pid;

  begin
    insert into payments (order_id, method, provider, provider_reference, amount, currency, status, is_simulated, verified_at)
    values (v_order.id, p_method, case when v_simulated then 'SIMULATED' else p_method end, p_txn_ref,
            v_order.total, v_order.currency, case when v_simulated then 'PAID' else 'PENDING' end, v_simulated,
            case when v_simulated then now() end);
  exception when unique_violation then
    raise exception 'This transaction ID has already been used';
  end;

  -- PIN from PostgreSQL's built-in cryptographically secure generator (gen_random_uuid).
  -- Do not use pgcrypto here: on Supabase it lives in the "extensions" schema, which this function cannot see.
  insert into order_delivery_pins (order_id, pin)
  values (v_order.id, lpad(((('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint) % 10000)::text, 4, '0'));

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number);
end $$;

-- ---------- verify_delivery_pin ---------------------------------------
-- Called by the assigned rider (or admin) once delivery_status = AT_CUSTOMER.

create or replace function public.verify_delivery_pin(p_order_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; k order_delivery_pins%rowtype;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (public.is_admin() or exists (select 1 from riders r where r.id = o.rider_id and r.user_id = auth.uid())) then
    raise exception 'Not allowed'; end if;
  if o.delivery_status <> 'AT_CUSTOMER' then raise exception 'Mark arrival at the customer first'; end if;
  select * into k from order_delivery_pins where order_id = p_order_id for update;
  if k.locked_at is not null then raise exception 'PIN locked after too many wrong attempts. Contact support'; end if;
  if p_pin is null or p_pin !~ '^[0-9]{4}$' or k.pin <> p_pin then
    update order_delivery_pins set failed_attempts = failed_attempts + 1,
           locked_at = case when failed_attempts + 1 >= 5 then now() end where order_id = p_order_id;
    return jsonb_build_object('ok', false, 'attempts_left', greatest(0, 4 - k.failed_attempts));
  end if;
  update order_delivery_pins set verified_at = now() where order_id = p_order_id;
  update orders set status = 'DELIVERED', delivery_status = 'DELIVERED', delivered_at = now() where id = p_order_id;
  update riders set availability = 'AVAILABLE' where id = o.rider_id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.place_order(uuid, jsonb, jsonb, text, text) from public, anon;
revoke all on function public.verify_delivery_pin(uuid, text) from public, anon;
grant execute on function public.place_order(uuid, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.verify_delivery_pin(uuid, text) to authenticated;

-- ---------- row level security ----------------------------------------
-- No insert/update/delete policies for customers or riders: all writes go
-- through the functions above. Admin can read and update everything.

alter table public.profiles             enable row level security;
alter table public.riders               enable row level security;
alter table public.orders               enable row level security;
alter table public.order_items          enable row level security;
alter table public.payments             enable row level security;
alter table public.order_delivery_pins  enable row level security;
alter table public.order_status_history enable row level security;

create policy profiles_own   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy riders_read    on public.riders   for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy riders_admin   on public.riders   for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy orders_read on public.orders for select to authenticated using (
  customer_id = auth.uid() or public.is_admin()
  or exists (select 1 from riders r where r.id = rider_id and r.user_id = auth.uid())
  or exists (select 1 from merchants m where m.id = merchant_id and m.owner_id = auth.uid()));
create policy orders_admin_update on public.orders for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy order_items_read on public.order_items for select to authenticated
  using (exists (select 1 from orders o where o.id = order_id));
create policy history_read on public.order_status_history for select to authenticated
  using (exists (select 1 from orders o where o.id = order_id));
create policy payments_read on public.payments for select to authenticated
  using (public.is_admin() or exists (select 1 from orders o where o.id = order_id and o.customer_id = auth.uid()));
create policy pins_customer_read on public.order_delivery_pins for select to authenticated
  using (public.is_admin() or exists (select 1 from orders o where o.id = order_id and o.customer_id = auth.uid()));

alter publication supabase_realtime add table public.orders;
