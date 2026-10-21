-- =====================================================================
-- PICK & DROP | Migration 04: Admin dashboard
-- Requires 01 to 03. Every admin write goes through a function that checks
-- is_admin() (an app_metadata claim users cannot edit), validates input and
-- logs the action. This migration also TIGHTENS security: it removes the
-- direct "admin can update any order column" policy, so order status can only
-- change through validated functions.
-- =====================================================================

alter table public.order_status_history add column note text;

-- History trigger now records an optional reason set by admin functions.
create or replace function public.log_order_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_note text := nullif(current_setting('pd.reason', true), '');
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into order_status_history (order_id, kind, status, actor_id, note) values (new.id, 'ORDER', new.status, auth.uid(), v_note);
  end if;
  if tg_op = 'UPDATE' and new.delivery_status is distinct from old.delivery_status then
    insert into order_status_history (order_id, kind, status, actor_id, note) values (new.id, 'DELIVERY', new.delivery_status, auth.uid(), v_note);
  end if;
  return new;
end $$;

drop policy orders_admin_update on public.orders;

-- Audit trail for merchant, rider and order changes made by admins.
create table public.admin_audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid,
  action     text not null,
  entity     text not null,
  entity_id  uuid,
  detail     jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
create policy audit_admin_read on public.admin_audit_log for select to authenticated using (public.is_admin());

create or replace function public._audit(p_action text, p_entity text, p_id uuid, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into admin_audit_log (actor_id, action, entity, entity_id, detail) values (auth.uid(), p_action, p_entity, p_id, p_detail)
$$;
revoke all on function public._audit(text, text, uuid, jsonb) from public, anon, authenticated;

-- Frees a rider unless they still have a delivery in progress.
create or replace function public._free_rider(p_rider uuid, p_except uuid)
returns void language sql security definer set search_path = public as $$
  update riders set availability = 'AVAILABLE'
  where id = p_rider and availability = 'BUSY' and not exists (
    select 1 from orders x where x.rider_id = p_rider and x.id <> p_except
      and x.status not in ('DELIVERED','CANCELLED')
      and x.delivery_status in ('ACCEPTED','AT_MERCHANT','PICKED_UP','ON_THE_WAY','AT_CUSTOMER'))
$$;
revoke all on function public._free_rider(uuid, uuid) from public, anon, authenticated;

-- ---------- overview ---------------------------------------------------
-- Grouped real counts. The browser sums them. Nothing is invented.
create or replace function public.admin_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'is_demo', is_demo, 'n', n))
        from (select status, is_demo, count(*) n from orders group by 1, 2) x), '[]'::jsonb),
    'merchants', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'type', merchant_type, 'n', n))
        from (select status, merchant_type, count(*) n from merchants group by 1, 2) x), '[]'::jsonb),
    'riders', coalesce((select jsonb_agg(jsonb_build_object('availability', availability, 'is_demo', is_demo, 'n', n))
        from (select availability, is_demo, count(*) n from riders group by 1, 2) x), '[]'::jsonb));
end $$;

-- ---------- order status (admin) --------------------------------------
-- Never DELIVERED: that needs the customer PIN via verify_delivery_pin.
create or replace function public.admin_set_order_status(p_order_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_reason text := left(btrim(coalesce(p_reason, '')), 200);
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if not (case o.status
      when 'PENDING_PAYMENT'  then p_status = 'CANCELLED'
      when 'PLACED'           then p_status in ('ACCEPTED','CANCELLED')
      when 'ACCEPTED'         then p_status in ('PREPARING','CANCELLED')
      when 'PREPARING'        then p_status in ('READY_FOR_PICKUP','CANCELLED')
      when 'READY_FOR_PICKUP' then p_status = 'CANCELLED'
      else false end) then
    raise exception 'Changing an order from % to % is not permitted', o.status, p_status; end if;
  if p_status = 'CANCELLED' and o.delivery_status in ('PICKED_UP','ON_THE_WAY','AT_CUSTOMER') then
    raise exception 'This order is already out for delivery and cannot be cancelled here'; end if;
  perform set_config('pd.reason', v_reason, true);
  update orders set status = p_status where id = p_order_id;
  if p_status = 'CANCELLED' then
    update payments set status = 'REFUNDED' where order_id = p_order_id and status = 'PAID' and is_simulated;  -- real payments need a provider refund
    if o.rider_id is not null then
      update orders set rider_id = null, delivery_status = 'UNASSIGNED' where id = p_order_id;
      perform public._free_rider(o.rider_id, p_order_id);
    end if;
  end if;
  perform set_config('pd.reason', '', true);
  perform public._audit('ORDER_STATUS', 'order', p_order_id, jsonb_build_object('from', o.status, 'to', p_status, 'reason', v_reason));
  return jsonb_build_object('status', p_status);
end $$;

-- ---------- assign / reassign rider -----------------------------------
create or replace function public.admin_assign_rider(p_order_id uuid, p_rider_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; r riders%rowtype; v_old uuid;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status not in ('PLACED','ACCEPTED','PREPARING','READY_FOR_PICKUP') then
    raise exception 'This order can no longer be assigned (%)', o.status; end if;
  if o.delivery_status not in ('UNASSIGNED','ASSIGNED','ACCEPTED','AT_MERCHANT') then
    raise exception 'The rider has already picked up this order'; end if;
  if o.rider_id = p_rider_id then raise exception 'That rider is already assigned'; end if;
  select * into r from riders where id = p_rider_id;
  if not found then raise exception 'Rider not found'; end if;
  if r.availability = 'OFFLINE' then raise exception 'That rider is offline'; end if;
  if (select count(*) from orders x where x.rider_id = p_rider_id and x.id <> p_order_id
        and x.status not in ('DELIVERED','CANCELLED')) >= 2 then
    raise exception 'That rider already has 2 active orders'; end if;
  v_old := o.rider_id;
  update orders set rider_id = p_rider_id, delivery_status = 'ASSIGNED' where id = p_order_id;
  if v_old is not null then perform public._free_rider(v_old, p_order_id); end if;
  perform public._audit('RIDER_ASSIGN', 'order', p_order_id, jsonb_build_object('rider', p_rider_id, 'previous', v_old));
  return jsonb_build_object('rider', r.display_name);
end $$;

-- ---------- riders -----------------------------------------------------
-- New riders created here are always demo/test riders with no login.
create or replace function public.admin_save_rider(p_id uuid, p_name text, p_phone text, p_availability text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_name text := btrim(coalesce(p_name, '')); v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
        r riders%rowtype; v_id uuid; v_avail text;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if length(v_name) < 2 or length(v_name) > 60 then raise exception 'Rider name must be 2 to 60 characters'; end if;
  if v_phone is not null and v_phone !~ '^[0-9+ ()-]{6,20}$' then raise exception 'Enter a valid phone number or leave it empty'; end if;
  if p_availability not in ('AVAILABLE','OFFLINE') then raise exception 'Availability must be AVAILABLE or OFFLINE'; end if;
  if p_id is null then
    insert into riders (display_name, phone, is_demo, availability) values (v_name, v_phone, true, p_availability) returning id into v_id;
  else
    select * into r from riders where id = p_id for update;
    if not found then raise exception 'Rider not found'; end if;
    if p_availability = 'OFFLINE' and exists (select 1 from orders x where x.rider_id = p_id
         and x.status not in ('DELIVERED','CANCELLED')) then
      raise exception 'This rider has active orders and cannot go offline'; end if;
    v_avail := case when r.availability = 'BUSY' then 'BUSY' else p_availability end;   -- BUSY is system managed
    update riders set display_name = v_name, phone = v_phone, availability = v_avail where id = p_id;
    v_id := p_id;
  end if;
  perform public._audit(case when p_id is null then 'RIDER_CREATE' else 'RIDER_UPDATE' end, 'rider', v_id, jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id);
end $$;

-- ---------- merchants --------------------------------------------------
-- New merchants are always DEMO. Status is changed only by admin_set_merchant_status.
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
        verification, last_verified_at, data_source, source_url, internal_notes)
    values (v_slug, v_name, v_type, 'DEMO', v_area, nullif(btrim(p->>'address_line'), ''), nullif(btrim(p->>'neighbourhood'), ''),
        nullif(btrim(p->>'landmark'), ''), v_phone, nullif(btrim(p->>'whatsapp'), ''), nullif(btrim(p->>'description'), ''),
        coalesce((p->>'delivery_enabled')::boolean, true), v_fee, v_min, v_pmin, v_pmax, v_lat, v_lng,
        v_ver, case when v_ver <> 'UNVERIFIED' then now() end, nullif(btrim(p->>'data_source'), ''),
        nullif(btrim(p->>'source_url'), ''), nullif(btrim(p->>'internal_notes'), ''))
    returning id into v_id;
  else
    update merchants set name = v_name, merchant_type = v_type, service_area_id = v_area,
        address_line = nullif(btrim(p->>'address_line'), ''), neighbourhood = nullif(btrim(p->>'neighbourhood'), ''),
        landmark = nullif(btrim(p->>'landmark'), ''), phone = v_phone, whatsapp = nullif(btrim(p->>'whatsapp'), ''),
        description = nullif(btrim(p->>'description'), ''), delivery_enabled = coalesce((p->>'delivery_enabled')::boolean, true),
        delivery_fee = v_fee, min_order_amount = v_min, prep_time_min = v_pmin, prep_time_max = v_pmax,
        latitude = v_lat, longitude = v_lng, verification = v_ver,
        last_verified_at = case when v_ver <> 'UNVERIFIED' then coalesce(last_verified_at, now()) end,
        data_source = nullif(btrim(p->>'data_source'), ''), source_url = nullif(btrim(p->>'source_url'), ''),
        internal_notes = nullif(btrim(p->>'internal_notes'), '')
    where id = v_id;
    if not found then raise exception 'Merchant not found'; end if;
  end if;
  if v_cat is not null then
    delete from merchant_categories where merchant_id = v_id and is_primary;
    insert into merchant_categories (merchant_id, category_id, is_primary) values (v_id, v_cat, true)
      on conflict (merchant_id, category_id) do update set is_primary = true;
  end if;
  perform public._audit(case when p_id is null then 'MERCHANT_CREATE' else 'MERCHANT_UPDATE' end, 'merchant', v_id, jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id);
end $$;

-- ACTIVE means a signed partner. It needs an explicit confirmation and an
-- existing login for the owner (create it in Supabase Auth first).
create or replace function public.admin_set_merchant_status(p_id uuid, p_status text, p_owner_email text default null, p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m merchants%rowtype; v_owner uuid;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_status not in ('DEMO','PENDING','ACTIVE','SUSPENDED') then raise exception 'Invalid status'; end if;
  select * into m from merchants where id = p_id for update;
  if not found then raise exception 'Merchant not found'; end if;
  if p_status = 'ACTIVE' then
    if not coalesce(p_confirm, false) then raise exception 'Confirm that this business has agreed in writing to join Pick & Drop'; end if;
    select id into v_owner from auth.users where lower(email) = lower(btrim(coalesce(p_owner_email, '')));
    if v_owner is null then raise exception 'No user with that email. Create the owner login in Supabase Auth first'; end if;
    update merchants set status = 'ACTIVE', owner_id = v_owner, partnered_at = coalesce(partnered_at, now()) where id = p_id;
    insert into merchant_staff (merchant_id, user_id) values (p_id, v_owner) on conflict do nothing;
  else
    update merchants set status = p_status where id = p_id;
  end if;
  perform public._audit('MERCHANT_STATUS', 'merchant', p_id, jsonb_build_object('from', m.status, 'to', p_status));
  return jsonb_build_object('status', p_status);
end $$;

revoke all on function public.admin_overview()                                     from public, anon;
revoke all on function public.admin_set_order_status(uuid, text, text)             from public, anon;
revoke all on function public.admin_assign_rider(uuid, uuid)                       from public, anon;
revoke all on function public.admin_save_rider(uuid, text, text, text)             from public, anon;
revoke all on function public.admin_save_merchant(uuid, jsonb)                     from public, anon;
revoke all on function public.admin_set_merchant_status(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_overview()                                     to authenticated;
grant execute on function public.admin_set_order_status(uuid, text, text)             to authenticated;
grant execute on function public.admin_assign_rider(uuid, uuid)                       to authenticated;
grant execute on function public.admin_save_rider(uuid, text, text, text)             to authenticated;
grant execute on function public.admin_save_merchant(uuid, jsonb)                     to authenticated;
grant execute on function public.admin_set_merchant_status(uuid, text, text, boolean) to authenticated;
