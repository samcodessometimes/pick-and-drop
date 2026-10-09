-- =====================================================================
-- PICK & DROP | Migration 05: QA fixes (Step 6)
-- Requires 01 to 04. Safe to run once on a database that already has 01 to 04,
-- and part of the normal sequence on a fresh install. Fixes found during QA:
--  1. Internal merchant fields (internal_notes, data_source, source_url) were readable by
--     anyone through the merchants table and merchants_public. They move to an admin-only table.
--  2. Rider availability was reset to AVAILABLE when a merchant rejected one order, or when one
--     delivery finished, even if the rider still had another delivery in progress.
--  3. A delivery PIN locked after 5 wrong tries had no recovery path. Admin can now unlock it.
--  4. place_order generated the PIN with pgcrypto, which is not on the function search_path on
--     Supabase (it lives in the "extensions" schema), so every order failed. Fixed in this file.
--  5. place_order accepted half-supplied coordinates with an unclear error. It now says Invalid location.
-- =====================================================================

-- 1. internal merchant data -------------------------------------------
create table if not exists public.merchant_internal (
  merchant_id    uuid primary key references public.merchants(id) on delete cascade,
  internal_notes text,
  data_source    text,
  source_url     text,
  updated_at     timestamptz not null default now()
);
alter table public.merchant_internal enable row level security;
drop policy if exists merchant_internal_admin on public.merchant_internal;
create policy merchant_internal_admin on public.merchant_internal for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.merchant_internal from anon;

do $mig$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'merchants' and column_name = 'internal_notes') then
    insert into public.merchant_internal (merchant_id, internal_notes, data_source, source_url)
      select id, internal_notes, data_source, source_url from public.merchants
      where internal_notes is not null or data_source is not null or source_url is not null
      on conflict (merchant_id) do nothing;
    drop view if exists public.merchants_public;
    alter table public.merchants drop column internal_notes, drop column data_source, drop column source_url;
  end if;
end $mig$;

-- Public view lists safe columns explicitly (no owner, no internal notes, no provenance).
drop view if exists public.merchants_public;
create view public.merchants_public with (security_invoker = true) as
select m.id, m.slug, m.name, m.brand_name, m.branch_name, m.merchant_type, m.status, m.description,
       m.service_area_id, m.address_line, m.neighbourhood, m.landmark, m.latitude, m.longitude,
       m.phone, m.whatsapp, m.website_url, m.social_url, m.logo_url, m.cover_url, m.image_credit,
       m.price_tier, m.rating, m.rating_count, m.is_featured, m.sort_order,
       m.delivery_enabled, m.delivery_radius_km, m.delivery_fee, m.min_order_amount,
       m.prep_time_min, m.prep_time_max, m.currency, m.verification, m.last_verified_at,
       m.created_at, m.updated_at,
       sa.name as service_area_name,
       case m.status when 'ACTIVE' then 'Pick & Drop partner' else 'Demo listing' end as partner_label,
       (m.status = 'ACTIVE') as is_partner
from public.merchants m
join public.service_areas sa on sa.id = m.service_area_id;

-- 2 to 5. functions ----------------------------------------------------
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
  perform public._free_rider(o.rider_id, p_order_id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.merchant_set_order_status(p_order_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_new text;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or not (public.is_admin() or public.is_merchant_staff(o.merchant_id)) then
    raise exception 'Order not found'; end if;
  v_new := case
    when p_action = 'ACCEPT'    and o.status = 'PLACED'    then 'ACCEPTED'
    when p_action = 'REJECT'    and o.status = 'PLACED'    then 'CANCELLED'
    when p_action = 'PREPARING' and o.status = 'ACCEPTED'  then 'PREPARING'
    when p_action = 'READY'     and o.status = 'PREPARING' then 'READY_FOR_PICKUP' end;
  if v_new is null then
    raise exception 'That action is not allowed while the order is %', o.status; end if;
  update orders set status = v_new where id = p_order_id;
  if v_new = 'CANCELLED' then
    -- Simulated payments only. Real payments need a provider refund call.
    update payments set status = 'REFUNDED' where order_id = p_order_id and status = 'PAID' and is_simulated;
    if o.rider_id is not null then
      update orders set rider_id = null, delivery_status = 'UNASSIGNED' where id = p_order_id;
      perform public._free_rider(o.rider_id, p_order_id);
    end if;
  end if;
  return jsonb_build_object('status', v_new);
end $$;

create or replace function public.admin_save_merchant(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := p_id;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_type text := p->>'merchant_type';
  v_area smallint; v_cat smallint; v_slug text; v_base text; i int := 1;
  v_lat numeric := nullif(p->>'latitude', '')::numeric;
  v_lng numeric := nullif(p->>'longitude', '')::numeric;
  v_fee numeric := coalesce(nullif(p->>'delivery_fee', '')::numeric, 0);
  v_min numeric := coalesce(nullif(p->>'min_order_amount', '')::numeric, 0);
  v_pmin smallint := nullif(p->>'prep_time_min', '')::smallint;
  v_pmax smallint := nullif(p->>'prep_time_max', '')::smallint;
  v_ver text := coalesce(nullif(p->>'verification', ''), 'UNVERIFIED');
  v_phone text := nullif(btrim(coalesce(p->>'phone', '')), '');
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if length(v_name) < 2 or length(v_name) > 100 then raise exception 'Merchant name must be 2 to 100 characters'; end if;
  if v_type not in ('RESTAURANT','GROCERY') then raise exception 'Choose Restaurant or Grocery'; end if;
  select id into v_area from service_areas where slug = p->>'service_area';
  if v_area is null then raise exception 'Choose a service area'; end if;
  if v_fee < 0 or v_min < 0 then raise exception 'Fees cannot be negative'; end if;
  if (v_lat is null) <> (v_lng is null) then raise exception 'Enter both latitude and longitude, or neither'; end if;
  if v_ver not in ('UNVERIFIED','PHONE_CONFIRMED','VISITED') then raise exception 'Invalid verification'; end if;
  if v_phone is not null and v_phone !~ '^[0-9+ ()-]{6,25}$' then raise exception 'Enter a valid phone number or leave it empty'; end if;
  if nullif(p->>'category', '') is not null then
    select id into v_cat from categories where slug = p->>'category' and merchant_type = v_type;
    if v_cat is null then raise exception 'That category does not match the merchant type'; end if;
  end if;

  if v_id is null then
    v_base := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
    if v_base = '' then raise exception 'Merchant name needs letters or numbers'; end if;
    v_slug := v_base;
    while exists (select 1 from merchants where slug = v_slug) loop i := i + 1; v_slug := v_base || '-' || i; end loop;
    insert into merchants (slug, name, merchant_type, status, service_area_id, address_line, neighbourhood, landmark, phone, whatsapp,
        description, delivery_enabled, delivery_fee, min_order_amount, prep_time_min, prep_time_max, latitude, longitude,
        verification, last_verified_at)
    values (v_slug, v_name, v_type, 'DEMO', v_area, nullif(btrim(p->>'address_line'), ''), nullif(btrim(p->>'neighbourhood'), ''),
        nullif(btrim(p->>'landmark'), ''), v_phone, nullif(btrim(p->>'whatsapp'), ''), nullif(btrim(p->>'description'), ''),
        coalesce((p->>'delivery_enabled')::boolean, true), v_fee, v_min, v_pmin, v_pmax, v_lat, v_lng,
        v_ver, case when v_ver <> 'UNVERIFIED' then now() end)
    returning id into v_id;
  else
    update merchants set name = v_name, merchant_type = v_type, service_area_id = v_area,
        address_line = nullif(btrim(p->>'address_line'), ''), neighbourhood = nullif(btrim(p->>'neighbourhood'), ''),
        landmark = nullif(btrim(p->>'landmark'), ''), phone = v_phone, whatsapp = nullif(btrim(p->>'whatsapp'), ''),
        description = nullif(btrim(p->>'description'), ''), delivery_enabled = coalesce((p->>'delivery_enabled')::boolean, true),
        delivery_fee = v_fee, min_order_amount = v_min, prep_time_min = v_pmin, prep_time_max = v_pmax,
        latitude = v_lat, longitude = v_lng, verification = v_ver,
        last_verified_at = case when v_ver <> 'UNVERIFIED' then coalesce(last_verified_at, now()) end
    where id = v_id;
    if not found then raise exception 'Merchant not found'; end if;
  end if;
  insert into merchant_internal (merchant_id, internal_notes, data_source, source_url)
  values (v_id, nullif(btrim(p->>'internal_notes'), ''), nullif(btrim(p->>'data_source'), ''), nullif(btrim(p->>'source_url'), ''))
  on conflict (merchant_id) do update set internal_notes = excluded.internal_notes, data_source = excluded.data_source, source_url = excluded.source_url;
  if v_cat is not null then
    delete from merchant_categories where merchant_id = v_id and is_primary;
    insert into merchant_categories (merchant_id, category_id, is_primary) values (v_id, v_cat, true)
      on conflict (merchant_id, category_id) do update set is_primary = true;
  end if;
  perform public._audit(case when p_id is null then 'MERCHANT_CREATE' else 'MERCHANT_UPDATE' end, 'merchant', v_id, jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id);
end $$;

-- 3. admin unlock ------------------------------------------------------
create or replace function public.admin_unlock_delivery_pin(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k order_delivery_pins%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into k from order_delivery_pins where order_id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if k.verified_at is not null then raise exception 'This order is already delivered'; end if;
  if k.locked_at is null then raise exception 'The PIN is not locked'; end if;
  update order_delivery_pins set failed_attempts = 0, locked_at = null where order_id = p_order_id;
  perform public._audit('PIN_UNLOCK', 'order', p_order_id, jsonb_build_object('failed_attempts', k.failed_attempts));
  return jsonb_build_object('unlocked', true);
end $$;

-- grants (re-stated because create or replace keeps existing ones, and new functions need them)
revoke all on function public.place_order(uuid, jsonb, jsonb, text, text)            from public, anon;
revoke all on function public.verify_delivery_pin(uuid, text)                        from public, anon;
revoke all on function public.merchant_set_order_status(uuid, text)                  from public, anon;
revoke all on function public.admin_save_merchant(uuid, jsonb)                       from public, anon;
revoke all on function public.admin_unlock_delivery_pin(uuid)                        from public, anon;
grant execute on function public.place_order(uuid, jsonb, jsonb, text, text)         to authenticated;
grant execute on function public.verify_delivery_pin(uuid, text)                     to authenticated;
grant execute on function public.merchant_set_order_status(uuid, text)               to authenticated;
grant execute on function public.admin_save_merchant(uuid, jsonb)                    to authenticated;
grant execute on function public.admin_unlock_delivery_pin(uuid)                     to authenticated;

-- Trigger and helper functions are never called directly by API users.
revoke all on function public.log_order_status() from public, anon, authenticated;
revoke all on function public.guard_delivered()  from public, anon, authenticated;
revoke all on function public.set_updated_at()   from public, anon, authenticated;
