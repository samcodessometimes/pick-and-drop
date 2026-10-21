-- =====================================================================
-- PICK & DROP | Migration 06: payment status, cash on delivery, settlement
-- records, staff linking, merchant and admin dashboard data.
-- Requires 01 to 05. Safe to run once on a database that has 01 to 05.
--
-- What this migration does NOT do: it does not move money, call Orange Money
-- or Afrimoney, send WhatsApp or SMS, or decide commercial terms. Every
-- payment made through the app is a DEMO payment until a real provider
-- integration exists. Settlement rows record amounts owed and manual payouts
-- that an admin says they made outside the app.
-- =====================================================================

-- 1. payments ----------------------------------------------------------
-- Statuses: PENDING (waiting), PAID (confirmed: cash collected, or provider-verified),
-- FAILED, REFUNDED, SIMULATED (demo payment, no money involved), CANCELLED (order cancelled before payment).
alter table public.payments drop constraint if exists payments_method_check;
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments drop constraint if exists payments_sim_not_paid;
update public.payments set status = 'SIMULATED', verified_at = null where status = 'PAID' and is_simulated;
alter table public.payments add constraint payments_method_check
  check (method in ('ORANGE_MONEY','AFRIMONEY','CASH_ON_DELIVERY'));
alter table public.payments add constraint payments_status_check
  check (status in ('PENDING','PAID','FAILED','REFUNDED','SIMULATED','CANCELLED'));
-- A simulated payment can never be reported as confirmed.
alter table public.payments add constraint payments_sim_not_paid check (not (is_simulated and status = 'PAID'));
alter table public.payments add column if not exists confirmed_at timestamptz;
alter table public.payments add column if not exists confirmed_by uuid;
alter table public.payments add column if not exists note text;

-- 2. orders: when the current status began (used to flag delayed orders) --
alter table public.orders add column if not exists status_changed_at timestamptz not null default now();
create or replace function public.touch_status_changed() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status or new.delivery_status is distinct from old.delivery_status then
    new.status_changed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists orders_touch_status on public.orders;
create trigger orders_touch_status before update on public.orders
  for each row execute function public.touch_status_changed();

-- 3. commercial settings (all pending until the business decides) -------
create table if not exists public.platform_settings (
  id                       smallint primary key default 1 check (id = 1),
  merchant_commission_bps  integer check (merchant_commission_bps between 0 and 5000),  -- 1000 = 10%. NULL = not decided
  rider_pay_per_delivery   numeric(10,2) check (rider_pay_per_delivery >= 0),           -- NULL = not decided
  terms_note               text,
  updated_at               timestamptz not null default now(),
  updated_by               uuid
);
insert into public.platform_settings (id) values (1) on conflict do nothing;
alter table public.platform_settings enable row level security;
drop policy if exists settings_admin_read on public.platform_settings;
create policy settings_admin_read on public.platform_settings for select to authenticated using (public.is_admin());
revoke all on public.platform_settings from anon;

-- 4. settlement batches and per-order financial records -----------------
create table if not exists public.merchant_settlements (
  id             uuid primary key default gen_random_uuid(),
  merchant_id    uuid not null references public.merchants(id),
  reference      text not null unique,
  is_demo        boolean not null,
  order_count    integer not null check (order_count > 0),
  gross_subtotal numeric(12,2) not null,
  commission_total numeric(12,2) not null,
  net_total      numeric(12,2) not null,
  note           text,
  recorded_by    uuid,
  recorded_at    timestamptz not null default now()
);
create table if not exists public.rider_payouts (
  id             uuid primary key default gen_random_uuid(),
  rider_id       uuid not null references public.riders(id),
  reference      text not null unique,
  is_demo        boolean not null,
  delivery_count integer not null check (delivery_count > 0),
  total          numeric(12,2) not null,
  note           text,
  recorded_by    uuid,
  recorded_at    timestamptz not null default now()
);
create table if not exists public.order_financials (
  order_id              uuid primary key references public.orders(id) on delete cascade,
  merchant_id           uuid not null references public.merchants(id),
  rider_id              uuid references public.riders(id),
  is_demo               boolean not null,
  subtotal              numeric(12,2) not null,
  delivery_fee          numeric(10,2) not null,
  commission_bps        integer,
  merchant_commission   numeric(12,2),
  merchant_net          numeric(12,2),
  rider_pay             numeric(10,2),
  platform_revenue      numeric(12,2),
  settlement_status     text not null default 'NOT_DUE'
                          check (settlement_status in ('NOT_DUE','PENDING_TERMS','OWED','SETTLED','VOID')),
  merchant_settlement_id uuid references public.merchant_settlements(id),
  rider_pay_status      text not null default 'NOT_DUE'
                          check (rider_pay_status in ('NOT_DUE','PENDING_TERMS','OWED','PAID','VOID')),
  rider_payout_id       uuid references public.rider_payouts(id),
  updated_at            timestamptz not null default now()
);
create index if not exists order_fin_merchant_idx on public.order_financials (merchant_id, settlement_status);
create index if not exists order_fin_rider_idx    on public.order_financials (rider_id, rider_pay_status);

alter table public.merchant_settlements enable row level security;
alter table public.rider_payouts        enable row level security;
alter table public.order_financials     enable row level security;
drop policy if exists mset_read on public.merchant_settlements;
create policy mset_read on public.merchant_settlements for select to authenticated
  using (public.is_admin() or public.is_merchant_staff(merchant_id));
drop policy if exists rpay_read on public.rider_payouts;
create policy rpay_read on public.rider_payouts for select to authenticated
  using (public.is_admin() or exists (select 1 from riders r where r.id = rider_id and r.user_id = auth.uid()));
-- order_financials holds platform revenue, so only admins read it directly. Merchants get their own
-- figures through merchant_dashboard() below.
drop policy if exists ofin_admin_read on public.order_financials;
create policy ofin_admin_read on public.order_financials for select to authenticated using (public.is_admin());
revoke all on public.merchant_settlements, public.rider_payouts, public.order_financials from anon;

-- Recomputes one order's money record from the order, its payment and the current settings.
-- Rules: nothing is OWED until the order is DELIVERED and its payment is PAID (cash collected or provider
-- verified) or SIMULATED (demo). Commission and rider pay stay NULL ("pending terms") until set.
-- Amounts are fixed once an order becomes OWED, and never change after SETTLED / PAID.
create or replace function public._refresh_financials(p_order uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  o orders%rowtype; f order_financials%rowtype; s platform_settings%rowtype; p payments%rowtype;
  v_bps int; v_comm numeric; v_net numeric; v_rp numeric; v_rev numeric; v_ms text; v_rs text; v_rider uuid; v_ok boolean;
begin
  select * into o from orders where id = p_order;
  if not found then return; end if;
  select * into s from platform_settings where id = 1;
  select * into p from payments where order_id = p_order order by created_at desc limit 1;
  select * into f from order_financials where order_id = p_order;
  v_ok := coalesce(p.status in ('PAID','SIMULATED'), false);
  v_rider := coalesce(o.rider_id, f.rider_id);

  v_ms := coalesce(f.settlement_status, 'NOT_DUE'); v_rs := coalesce(f.rider_pay_status, 'NOT_DUE');
  v_bps := f.commission_bps; v_comm := f.merchant_commission; v_net := f.merchant_net; v_rp := f.rider_pay;

  if v_ms <> 'SETTLED' then
    if v_ms <> 'OWED' then v_bps := s.merchant_commission_bps; end if;   -- locked once owed
    v_comm := case when v_bps is not null then round(o.subtotal * v_bps / 10000.0, 2) end;
    v_net  := case when v_bps is not null then o.subtotal - v_comm end;
    v_ms := case
      when o.status = 'CANCELLED' or coalesce(p.status in ('REFUNDED','CANCELLED','FAILED'), false) then 'VOID'
      when o.status = 'DELIVERED' and v_ok and v_bps is null then 'PENDING_TERMS'
      when o.status = 'DELIVERED' and v_ok then 'OWED'
      else 'NOT_DUE' end;
  end if;
  if v_rs <> 'PAID' then
    if v_rs <> 'OWED' then v_rp := s.rider_pay_per_delivery; end if;
    v_rs := case
      when o.status = 'CANCELLED' or v_rider is null then case when o.status = 'CANCELLED' then 'VOID' else 'NOT_DUE' end
      when o.status = 'DELIVERED' and v_rp is null then 'PENDING_TERMS'
      when o.status = 'DELIVERED' then 'OWED'
      else 'NOT_DUE' end;
  end if;
  v_rev := case when o.status = 'DELIVERED' and v_ok and v_comm is not null and v_rp is not null
                then v_comm + o.delivery_fee - v_rp end;

  insert into order_financials (order_id, merchant_id, rider_id, is_demo, subtotal, delivery_fee, commission_bps, merchant_commission,
      merchant_net, rider_pay, platform_revenue, settlement_status, rider_pay_status, updated_at)
  values (o.id, o.merchant_id, v_rider, o.is_demo, o.subtotal, o.delivery_fee, v_bps, v_comm, v_net, v_rp, v_rev, v_ms, v_rs, now())
  on conflict (order_id) do update set rider_id = excluded.rider_id, commission_bps = excluded.commission_bps,
      merchant_commission = excluded.merchant_commission, merchant_net = excluded.merchant_net, rider_pay = excluded.rider_pay,
      platform_revenue = excluded.platform_revenue, settlement_status = excluded.settlement_status,
      rider_pay_status = excluded.rider_pay_status, updated_at = now();
end $$;

create or replace function public._fin_from_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public._refresh_financials(new.id); return new; end $$;
create or replace function public._fin_from_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform public._refresh_financials(new.order_id); return new; end $$;
drop trigger if exists orders_fin on public.orders;
create trigger orders_fin after insert or update on public.orders for each row execute function public._fin_from_order();
drop trigger if exists payments_fin on public.payments;
create trigger payments_fin after insert or update on public.payments for each row execute function public._fin_from_payment();

-- 5. payment helpers ------------------------------------------------------
-- Used when an order is cancelled: demo payments become REFUNDED (demo), unpaid ones CANCELLED.
-- A real confirmed payment (PAID) is left alone: it needs a refund through the payment provider.
create or replace function public._void_payment(p_order uuid)
returns void language sql security definer set search_path = public as $$
  update payments set status = case when status = 'SIMULATED' then 'REFUNDED' else 'CANCELLED' end
  where order_id = p_order and status in ('SIMULATED','PENDING')
$$;

-- 6. place_order: adds cash on delivery, demo payments are SIMULATED not PAID ---
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
  v_ref       text := nullif(btrim(coalesce(p_txn_ref, '')), '');
  v_cod       boolean := (p_method = 'CASH_ON_DELIVERY');
  v_pstatus   text;
  v_simulated constant boolean := true;   -- set false when real Orange/Afrimoney verification exists
begin
  if v_uid is null then raise exception 'Please refresh and try again'; end if;
  if p_method not in ('ORANGE_MONEY','AFRIMONEY','CASH_ON_DELIVERY') then raise exception 'Choose a payment method'; end if;
  if v_cod then v_ref := null;
  elsif v_ref is null then v_ref := 'DEMO' || upper(left(replace(gen_random_uuid()::text, '-', ''), 10));   -- generated demo reference
  elsif v_ref !~ '^[A-Za-z0-9]{6,24}$' then raise exception 'Enter a valid transaction ID (6 to 24 letters or numbers)'; end if;
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

  -- Cash on delivery and demo payments go straight to the store. A real mobile money order would wait
  -- in PENDING_PAYMENT until a verified provider confirmation (see provider_confirm_payment below).
  insert into orders (customer_id, merchant_id, status, is_demo, subtotal, delivery_fee, total, currency,
                      contact_name, contact_phone, address_line, landmark, latitude, longitude, notes)
  values (v_uid, m.id, case when v_cod or v_simulated then 'PLACED' else 'PENDING_PAYMENT' end, m.status <> 'ACTIVE',
          v_subtotal, m.delivery_fee, v_subtotal + m.delivery_fee, m.currency,
          v_name, v_phone, v_line, left(btrim(p_address->>'landmark'), 120), v_lat, v_lng, left(btrim(p_address->>'notes'), 300))
  returning * into v_order;

  insert into order_items (order_id, product_id, name, unit_price, quantity, line_total)
  select v_order.id, p.id, p.name, p.price, l.qty, p.price * l.qty
  from _po_lines l join products p on p.id = l.pid;

  v_pstatus := case when v_cod then 'PENDING' when v_simulated then 'SIMULATED' else 'PENDING' end;
  begin
    insert into payments (order_id, method, provider, provider_reference, amount, currency, status, is_simulated, verified_at, note)
    values (v_order.id, p_method, case when v_cod then 'CASH' when v_simulated then 'SIMULATED' else p_method end, v_ref,
            v_order.total, v_order.currency, v_pstatus, (not v_cod) and v_simulated, null,
            case when v_cod then 'Cash due from the customer on delivery'
                 when v_simulated then 'Demo payment. No money was moved and the reference was not verified' end);
  exception when unique_violation then
    raise exception 'This transaction ID has already been used';
  end;

  insert into order_delivery_pins (order_id, pin)
  values (v_order.id, lpad(((('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint) % 10000)::text, 4, '0'));

  return jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'payment_status', v_pstatus);
end $$;

-- 7. cash on delivery: who records collection --------------------------------
-- The assigned rider records the cash when they are at the customer's door, before entering the PIN.
-- An admin can record it for any order that is out for delivery (for example if the rider phones it in).
create or replace function public.record_cash_collected(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; p payments%rowtype; v_admin boolean := public.is_admin(); v_is_rider boolean;
begin
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  v_is_rider := exists (select 1 from riders r where r.id = o.rider_id and r.user_id = auth.uid());
  if not (v_admin or v_is_rider) then raise exception 'Order not found'; end if;
  if o.status in ('CANCELLED','DELIVERED') then raise exception 'This order is already closed'; end if;
  select * into p from payments where order_id = p_order_id and method = 'CASH_ON_DELIVERY' for update;
  if not found then raise exception 'This is not a cash on delivery order'; end if;
  if p.status = 'PAID' then raise exception 'Cash was already recorded for this order'; end if;
  if p.status <> 'PENDING' then raise exception 'The payment is %', lower(p.status); end if;
  if v_is_rider and not v_admin then
    if o.delivery_status <> 'AT_CUSTOMER' then raise exception 'Record the cash once you have arrived at the customer'; end if;
  elsif o.delivery_status not in ('PICKED_UP','ON_THE_WAY','AT_CUSTOMER') then
    raise exception 'Cash can only be recorded once the order is out for delivery'; end if;
  update payments set status = 'PAID', confirmed_at = now(), confirmed_by = auth.uid(), verified_at = now(),
         note = case when v_is_rider and not v_admin then 'Cash collected by rider' else 'Cash recorded by admin' end
   where id = p.id;
  update orders set updated_at = now() where id = p_order_id;     -- wakes dashboards listening for order changes
  if v_admin and not v_is_rider then
    perform public._audit('CASH_RECORDED', 'order', p_order_id, jsonb_build_object('amount', p.amount)); end if;
  return jsonb_build_object('payment_status', 'PAID', 'amount', p.amount);
end $$;

-- A payment that is still waiting can be marked failed by an admin (for example a customer who refuses to pay cash).
create or replace function public.admin_set_payment_status(p_order_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p payments%rowtype; v_reason text := left(btrim(coalesce(p_reason, '')), 200);
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_status <> 'FAILED' then raise exception 'Only FAILED can be set here. Confirmation comes from cash collection or the payment provider'; end if;
  select * into p from payments where order_id = p_order_id order by created_at desc limit 1 for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.status <> 'PENDING' then raise exception 'Only a pending payment can be marked failed (this one is %)', lower(p.status); end if;
  update payments set status = 'FAILED', note = nullif(v_reason, '') where id = p.id;
  update orders set updated_at = now() where id = p_order_id;
  perform public._audit('PAYMENT_FAILED', 'order', p_order_id, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('payment_status', 'FAILED');
end $$;

-- ENTRY POINT FOR A FUTURE PAYMENT INTEGRATION. Nothing calls this today.
-- A verified provider webhook, running in a Supabase Edge Function with the service role key, would call it.
-- It is not callable by browsers (anon or signed-in users). It checks the amount matches before confirming.
create or replace function public.provider_confirm_payment(p_payment_id uuid, p_provider text, p_provider_reference text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p payments%rowtype;
begin
  select * into p from payments where id = p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.is_simulated or p.method not in ('ORANGE_MONEY','AFRIMONEY') then raise exception 'Not a mobile money payment'; end if;
  if p.status <> 'PENDING' then raise exception 'Payment is not pending'; end if;
  if p_amount is distinct from p.amount then raise exception 'Amount mismatch'; end if;
  if nullif(btrim(coalesce(p_provider_reference, '')), '') is null or nullif(btrim(coalesce(p_provider, '')), '') is null then
    raise exception 'Provider and reference are required'; end if;
  update payments set status = 'PAID', provider = p_provider, provider_reference = p_provider_reference,
         verified_at = now(), confirmed_at = now(), note = 'Confirmed by payment provider' where id = p.id;
  update orders set status = 'PLACED' where id = p.order_id and status = 'PENDING_PAYMENT';
  return jsonb_build_object('payment_status', 'PAID');
end $$;

-- 8. delivery cannot complete while cash is still owed ---------------------
create or replace function public.guard_delivered() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status = 'DELIVERED' and old.status <> 'DELIVERED')
     or (new.delivery_status = 'DELIVERED' and old.delivery_status <> 'DELIVERED') then
    if not exists (select 1 from order_delivery_pins where order_id = new.id and verified_at is not null) then
      raise exception 'Delivery PIN must be verified before an order can be delivered';
    end if;
    if exists (select 1 from payments where order_id = new.id and method = 'CASH_ON_DELIVERY' and status = 'PENDING') then
      raise exception 'Record the cash collected before the order can be delivered';
    end if;
  end if;
  return new;
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
  if exists (select 1 from payments where order_id = p_order_id and method = 'CASH_ON_DELIVERY' and status = 'PENDING') then
    raise exception 'Record the cash collected before confirming delivery'; end if;
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

-- 9. cancellation paths now use _void_payment ----------------------------------
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
    perform public._void_payment(p_order_id);
    if o.rider_id is not null then
      update orders set rider_id = null, delivery_status = 'UNASSIGNED' where id = p_order_id;
      perform public._free_rider(o.rider_id, p_order_id);
    end if;
  end if;
  return jsonb_build_object('status', v_new);
end $$;

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
    perform public._void_payment(p_order_id);       -- a real confirmed payment needs a refund through the provider
    if o.rider_id is not null then
      update orders set rider_id = null, delivery_status = 'UNASSIGNED' where id = p_order_id;
      perform public._free_rider(o.rider_id, p_order_id);
    end if;
  end if;
  perform set_config('pd.reason', '', true);
  perform public._audit('ORDER_STATUS', 'order', p_order_id, jsonb_build_object('from', o.status, 'to', p_status, 'reason', v_reason));
  return jsonb_build_object('status', p_status);
end $$;

-- 10. link a login to a rider or a merchant (replaces hand-written SQL) -------
-- The login must already exist in Supabase Authentication. Customers' anonymous sessions cannot be linked.
create or replace function public.admin_link_staff(p_kind text, p_email text, p_target uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u record; r riders%rowtype; v_other text; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_kind not in ('RIDER','MERCHANT') then raise exception 'Choose rider or merchant'; end if;
  select id, email, coalesce(is_anonymous, false) as anon into u from auth.users where lower(email) = v_email;
  if not found then
    raise exception 'No login with the email %. Create it first in Supabase > Authentication > Users (tick Auto confirm)', v_email; end if;
  if u.anon then raise exception 'That is an anonymous customer session, not a staff login'; end if;
  if p_kind = 'RIDER' then
    select * into r from riders where id = p_target for update;
    if not found then raise exception 'Rider not found'; end if;
    if r.user_id is not null and r.user_id <> u.id then raise exception 'This rider already has a different login. Unlink it first'; end if;
    select display_name into v_other from riders where user_id = u.id and id <> p_target;
    if found then raise exception 'That login is already linked to the rider %', v_other; end if;
    update riders set user_id = u.id where id = p_target;
  else
    if not exists (select 1 from merchants where id = p_target) then raise exception 'Merchant not found'; end if;
    insert into merchant_staff (merchant_id, user_id) values (p_target, u.id) on conflict do nothing;
  end if;
  perform public._audit('STAFF_LINK', lower(p_kind), p_target, jsonb_build_object('email', v_email));
  return jsonb_build_object('linked', true, 'email', v_email);
end $$;

create or replace function public.admin_unlink_staff(p_kind text, p_target uuid, p_user uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_kind = 'RIDER' then
    if exists (select 1 from orders where rider_id = p_target and status not in ('DELIVERED','CANCELLED')) then
      raise exception 'This rider has active orders. Unlink after they finish'; end if;
    update riders set user_id = null where id = p_target;
  elsif p_kind = 'MERCHANT' then
    if p_user is null then raise exception 'Choose which login to unlink'; end if;
    delete from merchant_staff where merchant_id = p_target and user_id = p_user;
  else raise exception 'Choose rider or merchant'; end if;
  perform public._audit('STAFF_UNLINK', lower(p_kind), p_target, jsonb_build_object('user', p_user));
  return jsonb_build_object('unlinked', true);
end $$;

-- 11. merchant dashboard data ---------------------------------------------------
-- One call returns the shop's orders (items, customer delivery details, payment status, its own money
-- figures) and an activity summary. It never returns platform revenue or another shop's data.
create or replace function public.merchant_dashboard(p_merchant_id uuid, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_lim int := least(greatest(coalesce(p_limit, 100), 1), 200); v_m jsonb; v_s jsonb; v_o jsonb;
begin
  if not (public.is_admin() or public.is_merchant_staff(p_merchant_id)) then raise exception 'Not allowed'; end if;
  select jsonb_build_object('id', id, 'name', name, 'status', status) into v_m from merchants where id = p_merchant_id;
  if v_m is null then raise exception 'Merchant not found'; end if;

  select jsonb_build_object(
    'orders_total',     count(*),
    'orders_today',     count(*) filter (where o.created_at >= date_trunc('day', now())),
    'new_orders',       count(*) filter (where o.status = 'PLACED'),
    'in_progress',      count(*) filter (where o.status in ('ACCEPTED','PREPARING')),
    'ready',            count(*) filter (where o.status = 'READY_FOR_PICKUP' and o.delivery_status in ('UNASSIGNED','ASSIGNED','ACCEPTED','AT_MERCHANT')),
    'out_for_delivery', count(*) filter (where o.status = 'READY_FOR_PICKUP' and o.delivery_status in ('PICKED_UP','ON_THE_WAY','AT_CUSTOMER')),
    'completed',        count(*) filter (where o.status = 'DELIVERED'),
    'cancelled',        count(*) filter (where o.status = 'CANCELLED'),
    'items_sales',      coalesce(sum(o.subtotal) filter (where o.status = 'DELIVERED' and pay.status in ('PAID','SIMULATED')), 0),
    'items_sales_demo', coalesce(sum(o.subtotal) filter (where o.status = 'DELIVERED' and pay.status = 'SIMULATED'), 0),
    'net_owed',         coalesce(sum(f.merchant_net) filter (where f.settlement_status = 'OWED'), 0),
    'orders_owed',      count(*) filter (where f.settlement_status = 'OWED'),
    'orders_pending_terms', count(*) filter (where f.settlement_status = 'PENDING_TERMS'),
    'net_settled',      coalesce(sum(f.merchant_net) filter (where f.settlement_status = 'SETTLED'), 0))
  into v_s
  from orders o
  left join lateral (select status from payments x where x.order_id = o.id order by x.created_at desc limit 1) pay on true
  left join order_financials f on f.order_id = o.id
  where o.merchant_id = p_merchant_id;

  select coalesce(jsonb_agg(x order by (x->>'created_at') desc), '[]'::jsonb) into v_o from (
    select jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'status', o.status, 'delivery_status', o.delivery_status,
      'created_at', o.created_at, 'status_changed_at', o.status_changed_at, 'is_demo', o.is_demo,
      'subtotal', o.subtotal, 'delivery_fee', o.delivery_fee, 'total', o.total,
      'contact_name', o.contact_name, 'contact_phone', o.contact_phone, 'address_line', o.address_line,
      'landmark', o.landmark, 'notes', o.notes,
      'rider', (select r.display_name from riders r where r.id = o.rider_id),
      'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'unit_price', i.unit_price, 'line_total', i.line_total) order by i.id)
                         from order_items i where i.order_id = o.id), '[]'::jsonb),
      'payment', (select jsonb_build_object('method', p.method, 'status', p.status, 'is_simulated', p.is_simulated)
                  from payments p where p.order_id = o.id order by p.created_at desc limit 1),
      'money', jsonb_build_object('commission_bps', f.commission_bps, 'commission', f.merchant_commission, 'net', f.merchant_net,
                                  'settlement_status', f.settlement_status)) as x
    from orders o left join order_financials f on f.order_id = o.id
    where o.merchant_id = p_merchant_id order by o.created_at desc limit v_lim) q;

  return jsonb_build_object('merchant', v_m, 'summary', v_s, 'orders', v_o,
    'settlements', coalesce((select jsonb_agg(jsonb_build_object('reference', s.reference, 'net_total', s.net_total, 'order_count', s.order_count,
                                                  'is_demo', s.is_demo, 'recorded_at', s.recorded_at) order by s.recorded_at desc)
                             from (select * from merchant_settlements where merchant_id = p_merchant_id order by recorded_at desc limit 10) s), '[]'::jsonb));
end $$;

-- 12. admin dashboard data ---------------------------------------------------------
-- Delay rules (documented in the dashboard): a new order waiting 10+ minutes, a ready order waiting 15+ minutes,
-- or a delivery in progress for 90+ minutes.
create or replace function public.admin_overview() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ops jsonb;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select coalesce(jsonb_object_agg(k, jsonb_build_object('demo', d, 'live', l)), '{}'::jsonb) into v_ops from (
    select k, count(*) filter (where is_demo) d, count(*) filter (where not is_demo) l from (
      select 'total' k, is_demo from orders
      union all select 'awaiting_merchant', is_demo from orders where status = 'PLACED'
      union all select 'accepted_preparing', is_demo from orders where status in ('ACCEPTED','PREPARING')
      union all select 'ready_for_pickup', is_demo from orders where status = 'READY_FOR_PICKUP' and delivery_status in ('UNASSIGNED','ASSIGNED','ACCEPTED','AT_MERCHANT')
      union all select 'awaiting_rider', is_demo from orders where status in ('ACCEPTED','PREPARING','READY_FOR_PICKUP') and delivery_status = 'UNASSIGNED'
      union all select 'active_deliveries', is_demo from orders where status not in ('DELIVERED','CANCELLED')
                       and delivery_status in ('ACCEPTED','AT_MERCHANT','PICKED_UP','ON_THE_WAY','AT_CUSTOMER')
      union all select 'completed', is_demo from orders where status = 'DELIVERED'
      union all select 'cancelled', is_demo from orders where status = 'CANCELLED'
      union all select 'delayed', is_demo from orders where
           (status = 'PLACED' and status_changed_at < now() - interval '10 minutes')
        or (status = 'READY_FOR_PICKUP' and delivery_status not in ('PICKED_UP','ON_THE_WAY','AT_CUSTOMER') and status_changed_at < now() - interval '15 minutes')
        or (status not in ('DELIVERED','CANCELLED') and delivery_status in ('PICKED_UP','ON_THE_WAY','AT_CUSTOMER') and status_changed_at < now() - interval '90 minutes')
    ) z group by k) y;
  return jsonb_build_object(
    'orders', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'is_demo', is_demo, 'n', n))
        from (select status, is_demo, count(*) n from orders group by 1, 2) x), '[]'::jsonb),
    'merchants', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'type', merchant_type, 'n', n))
        from (select status, merchant_type, count(*) n from merchants group by 1, 2) x), '[]'::jsonb),
    'riders', coalesce((select jsonb_agg(jsonb_build_object('availability', availability, 'is_demo', is_demo, 'n', n))
        from (select availability, is_demo, count(*) n from riders group by 1, 2) x), '[]'::jsonb),
    'ops', v_ops,
    'payments', coalesce((select jsonb_agg(jsonb_build_object('status', status, 'method', method, 'is_simulated', is_simulated, 'n', n))
        from (select status, method, is_simulated, count(*) n from payments group by 1, 2, 3) x), '[]'::jsonb),
    'settlements', jsonb_build_object(
        'merchant_owed', coalesce((select jsonb_agg(jsonb_build_object('is_demo', is_demo, 'n', n, 'amount', a))
            from (select is_demo, count(*) n, coalesce(sum(merchant_net), 0) a from order_financials where settlement_status = 'OWED' group by 1) x), '[]'::jsonb),
        'pending_terms', (select count(*) from order_financials where settlement_status = 'PENDING_TERMS' or rider_pay_status = 'PENDING_TERMS'),
        'rider_owed', coalesce((select jsonb_agg(jsonb_build_object('is_demo', is_demo, 'n', n, 'amount', a))
            from (select is_demo, count(*) n, coalesce(sum(rider_pay), 0) a from order_financials where rider_pay_status = 'OWED' group by 1) x), '[]'::jsonb)));
end $$;

-- What is set up and what is missing. Shown at the top of the admin overview so an empty dashboard
-- always says why it is empty.
create or replace function public.admin_setup_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return jsonb_build_object(
    'merchants',            (select count(*) from merchants),
    'visible_merchants',    (select count(*) from merchants where status in ('DEMO','ACTIVE') and delivery_enabled),
    'merchants_with_menu',  (select count(distinct merchant_id) from products where is_available),
    'merchants_with_login', (select count(distinct merchant_id) from merchant_staff),
    'riders',               (select count(*) from riders),
    'riders_with_login',    (select count(*) from riders where user_id is not null),
    'riders_available',     (select count(*) from riders where availability = 'AVAILABLE'),
    'orders',               (select count(*) from orders),
    'terms_set',            (select merchant_commission_bps is not null and rider_pay_per_delivery is not null from platform_settings where id = 1));
end $$;

-- Riders with their current load, for the assignment control.
create or replace function public.admin_rider_load() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'display_name', r.display_name, 'availability', r.availability,
      'is_demo', r.is_demo, 'has_login', r.user_id is not null,
      'email', (select u.email from auth.users u where u.id = r.user_id),
      'active_orders', (select count(*) from orders x where x.rider_id = r.id and x.status not in ('DELIVERED','CANCELLED')),
      'eligible', r.availability <> 'OFFLINE' and (select count(*) from orders x where x.rider_id = r.id and x.status not in ('DELIVERED','CANCELLED')) < 2)
      order by r.display_name) from riders r), '[]'::jsonb);
end $$;


-- Logins linked to a merchant, with their emails (admin only).
create or replace function public.admin_merchant_staff(p_merchant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'email', u.email) order by u.email)
                   from merchant_staff s join auth.users u on u.id = s.user_id where s.merchant_id = p_merchant_id), '[]'::jsonb);
end $$;

-- The rider's own deliveries. Riders cannot read the payments table, so this returns only what they need:
-- whether cash must be collected, and how much. It never returns the delivery PIN or a customer's payment reference.
create or replace function public.rider_deliveries() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r riders%rowtype;
begin
  select * into r from riders where user_id = auth.uid();
  if not found then raise exception 'NOT_LINKED'; end if;
  return jsonb_build_object(
    'rider', jsonb_build_object('id', r.id, 'display_name', r.display_name, 'is_demo', r.is_demo, 'availability', r.availability),
    'orders', coalesce((select jsonb_agg(x order by (x->>'created_at')) from (
      select jsonb_build_object(
        'id', o.id, 'order_number', o.order_number, 'status', o.status, 'delivery_status', o.delivery_status, 'created_at', o.created_at,
        'total', o.total, 'contact_name', o.contact_name, 'contact_phone', o.contact_phone, 'address_line', o.address_line,
        'landmark', o.landmark, 'notes', o.notes, 'is_demo', o.is_demo,
        'item_count', (select coalesce(sum(i.quantity), 0) from order_items i where i.order_id = o.id),
        'merchant', (select jsonb_build_object('name', m.name, 'status', m.status, 'address_line', m.address_line, 'phone', m.phone) from merchants m where m.id = o.merchant_id),
        'payment', (select jsonb_build_object('method', p.method, 'status', p.status, 'is_simulated', p.is_simulated, 'amount', p.amount)
                    from payments p where p.order_id = o.id order by p.created_at desc limit 1)) as x
      from orders o where o.rider_id = r.id and o.status not in ('DELIVERED','CANCELLED')) q), '[]'::jsonb),
    'completed_today', (select count(*) from orders o where o.rider_id = r.id and o.status = 'DELIVERED' and o.delivered_at >= date_trunc('day', now())));
end $$;

-- 13. settlement records and settings -------------------------------------------------
create or replace function public.admin_save_settings(p_commission_bps integer, p_rider_pay numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if p_commission_bps is not null and p_commission_bps not between 0 and 5000 then raise exception 'Commission must be between 0%% and 50%%'; end if;
  if p_rider_pay is not null and p_rider_pay < 0 then raise exception 'Rider pay cannot be negative'; end if;
  update platform_settings set merchant_commission_bps = p_commission_bps, rider_pay_per_delivery = p_rider_pay,
         terms_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), updated_at = now(), updated_by = auth.uid() where id = 1;
  -- Orders still waiting on terms pick them up. Orders already OWED, SETTLED or PAID keep their amounts.
  for r in select order_id from order_financials where settlement_status in ('PENDING_TERMS','NOT_DUE') or rider_pay_status in ('PENDING_TERMS','NOT_DUE') loop
    perform public._refresh_financials(r.order_id);
  end loop;
  perform public._audit('SETTINGS', 'settings', null, jsonb_build_object('commission_bps', p_commission_bps, 'rider_pay', p_rider_pay));
  return jsonb_build_object('saved', true);
end $$;

create or replace function public.admin_finance_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'updated_by' from platform_settings s where id = 1),
    'merchants', coalesce((select jsonb_agg(row_to_json(x)) from (
        select f.merchant_id, m.name, f.is_demo, count(*) filter (where f.settlement_status = 'OWED') as owed_orders,
               coalesce(sum(f.subtotal) filter (where f.settlement_status = 'OWED'), 0) as gross,
               coalesce(sum(f.merchant_commission) filter (where f.settlement_status = 'OWED'), 0) as commission,
               coalesce(sum(f.merchant_net) filter (where f.settlement_status = 'OWED'), 0) as net_owed,
               count(*) filter (where f.settlement_status = 'PENDING_TERMS') as pending_terms_orders,
               coalesce(sum(f.merchant_net) filter (where f.settlement_status = 'SETTLED'), 0) as net_settled
        from order_financials f join merchants m on m.id = f.merchant_id
        group by f.merchant_id, m.name, f.is_demo
        having count(*) filter (where f.settlement_status in ('OWED','PENDING_TERMS','SETTLED')) > 0
        order by m.name) x), '[]'::jsonb),
    'riders', coalesce((select jsonb_agg(row_to_json(x)) from (
        select f.rider_id, r.display_name, f.is_demo, count(*) filter (where f.rider_pay_status = 'OWED') as owed_deliveries,
               coalesce(sum(f.rider_pay) filter (where f.rider_pay_status = 'OWED'), 0) as owed,
               count(*) filter (where f.rider_pay_status = 'PENDING_TERMS') as pending_terms_deliveries,
               coalesce(sum(f.rider_pay) filter (where f.rider_pay_status = 'PAID'), 0) as paid
        from order_financials f join riders r on r.id = f.rider_id
        group by f.rider_id, r.display_name, f.is_demo
        having count(*) filter (where f.rider_pay_status in ('OWED','PENDING_TERMS','PAID')) > 0
        order by r.display_name) x), '[]'::jsonb),
    'platform_revenue', coalesce((select jsonb_agg(row_to_json(x)) from (
        select is_demo, count(*) as orders, sum(platform_revenue) as revenue from order_financials where platform_revenue is not null group by is_demo) x), '[]'::jsonb),
    'recent_merchant_settlements', coalesce((select jsonb_agg(row_to_json(x)) from (
        select s.reference, m.name, s.net_total, s.order_count, s.is_demo, s.recorded_at, s.note
        from merchant_settlements s join merchants m on m.id = s.merchant_id order by s.recorded_at desc limit 15) x), '[]'::jsonb),
    'recent_rider_payouts', coalesce((select jsonb_agg(row_to_json(x)) from (
        select p.reference, r.display_name, p.total, p.delivery_count, p.is_demo, p.recorded_at, p.note
        from rider_payouts p join riders r on r.id = p.rider_id order by p.recorded_at desc limit 15) x), '[]'::jsonb));
end $$;

-- Records that an admin paid a merchant OUTSIDE the app. No money moves here.
create or replace function public.admin_record_merchant_settlement(p_merchant_id uuid, p_is_demo boolean, p_reference text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text := btrim(coalesce(p_reference, '')); v_id uuid; v_n int; v_gross numeric; v_comm numeric; v_net numeric;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if length(v_ref) < 3 or length(v_ref) > 60 then raise exception 'Enter the payment reference you used (3 to 60 characters)'; end if;
  perform 1 from order_financials where merchant_id = p_merchant_id and is_demo = p_is_demo and settlement_status = 'OWED' for update;
  select count(*), coalesce(sum(subtotal), 0), coalesce(sum(merchant_commission), 0), coalesce(sum(merchant_net), 0)
    into v_n, v_gross, v_comm, v_net from order_financials where merchant_id = p_merchant_id and is_demo = p_is_demo and settlement_status = 'OWED';
  if v_n = 0 then raise exception 'Nothing is owed to this merchant'; end if;
  begin
    insert into merchant_settlements (merchant_id, reference, is_demo, order_count, gross_subtotal, commission_total, net_total, note, recorded_by)
    values (p_merchant_id, v_ref, p_is_demo, v_n, v_gross, v_comm, v_net, nullif(left(btrim(coalesce(p_note, '')), 300), ''), auth.uid())
    returning id into v_id;
  exception when unique_violation then raise exception 'That reference was already used'; end;
  update order_financials set settlement_status = 'SETTLED', merchant_settlement_id = v_id, updated_at = now()
   where merchant_id = p_merchant_id and is_demo = p_is_demo and settlement_status = 'OWED';
  perform public._audit('MERCHANT_SETTLEMENT', 'merchant', p_merchant_id, jsonb_build_object('reference', v_ref, 'net', v_net, 'orders', v_n, 'demo', p_is_demo));
  return jsonb_build_object('settlement_id', v_id, 'net_total', v_net, 'order_count', v_n);
end $$;

create or replace function public.admin_record_rider_payout(p_rider_id uuid, p_is_demo boolean, p_reference text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ref text := btrim(coalesce(p_reference, '')); v_id uuid; v_n int; v_total numeric;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  if length(v_ref) < 3 or length(v_ref) > 60 then raise exception 'Enter the payment reference you used (3 to 60 characters)'; end if;
  perform 1 from order_financials where rider_id = p_rider_id and is_demo = p_is_demo and rider_pay_status = 'OWED' for update;
  select count(*), coalesce(sum(rider_pay), 0) into v_n, v_total from order_financials
   where rider_id = p_rider_id and is_demo = p_is_demo and rider_pay_status = 'OWED';
  if v_n = 0 then raise exception 'Nothing is owed to this rider'; end if;
  begin
    insert into rider_payouts (rider_id, reference, is_demo, delivery_count, total, note, recorded_by)
    values (p_rider_id, v_ref, p_is_demo, v_n, v_total, nullif(left(btrim(coalesce(p_note, '')), 300), ''), auth.uid()) returning id into v_id;
  exception when unique_violation then raise exception 'That reference was already used'; end;
  update order_financials set rider_pay_status = 'PAID', rider_payout_id = v_id, updated_at = now()
   where rider_id = p_rider_id and is_demo = p_is_demo and rider_pay_status = 'OWED';
  perform public._audit('RIDER_PAYOUT', 'rider', p_rider_id, jsonb_build_object('reference', v_ref, 'total', v_total, 'deliveries', v_n, 'demo', p_is_demo));
  return jsonb_build_object('payout_id', v_id, 'total', v_total, 'delivery_count', v_n);
end $$;

-- 14. realtime for payment changes -----------------------------------------------------
do $r$ begin
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null; when undefined_object then null; end $r$;

-- 15. backfill money records for orders that already exist ----------------------------------
do $b$ declare r record; begin
  for r in select id from public.orders loop perform public._refresh_financials(r.id); end loop;
end $b$;

-- 16. privileges (re-stated) ---------------------------------------------------------------
revoke all on function public._refresh_financials(uuid)  from public, anon, authenticated;
revoke all on function public._void_payment(uuid)        from public, anon, authenticated;
revoke all on function public._fin_from_order()          from public, anon, authenticated;
revoke all on function public._fin_from_payment()        from public, anon, authenticated;
revoke all on function public.touch_status_changed()     from public, anon, authenticated;
revoke all on function public.guard_delivered()          from public, anon, authenticated;

revoke all on function public.place_order(uuid, jsonb, jsonb, text, text)           from public, anon;
revoke all on function public.verify_delivery_pin(uuid, text)                       from public, anon;
revoke all on function public.merchant_set_order_status(uuid, text)                 from public, anon;
revoke all on function public.admin_set_order_status(uuid, text, text)              from public, anon;
revoke all on function public.record_cash_collected(uuid)                           from public, anon;
revoke all on function public.admin_set_payment_status(uuid, text, text)            from public, anon;
revoke all on function public.admin_link_staff(text, text, uuid)                    from public, anon;
revoke all on function public.admin_unlink_staff(text, uuid, uuid)                  from public, anon;
revoke all on function public.merchant_dashboard(uuid, integer)                     from public, anon;
revoke all on function public.admin_merchant_staff(uuid)                            from public, anon;
revoke all on function public.rider_deliveries()                                    from public, anon;
revoke all on function public.admin_overview()                                      from public, anon;
revoke all on function public.admin_setup_status()                                  from public, anon;
revoke all on function public.admin_rider_load()                                    from public, anon;
revoke all on function public.admin_save_settings(integer, numeric, text)           from public, anon;
revoke all on function public.admin_finance_summary()                               from public, anon;
revoke all on function public.admin_record_merchant_settlement(uuid, boolean, text, text) from public, anon;
revoke all on function public.admin_record_rider_payout(uuid, boolean, text, text)  from public, anon;
grant execute on function public.place_order(uuid, jsonb, jsonb, text, text)           to authenticated;
grant execute on function public.verify_delivery_pin(uuid, text)                       to authenticated;
grant execute on function public.merchant_set_order_status(uuid, text)                 to authenticated;
grant execute on function public.admin_set_order_status(uuid, text, text)              to authenticated;
grant execute on function public.record_cash_collected(uuid)                           to authenticated;
grant execute on function public.admin_set_payment_status(uuid, text, text)            to authenticated;
grant execute on function public.admin_link_staff(text, text, uuid)                    to authenticated;
grant execute on function public.admin_unlink_staff(text, uuid, uuid)                  to authenticated;
grant execute on function public.merchant_dashboard(uuid, integer)                     to authenticated;
grant execute on function public.admin_merchant_staff(uuid)                            to authenticated;
grant execute on function public.rider_deliveries()                                    to authenticated;
grant execute on function public.admin_overview()                                      to authenticated;
grant execute on function public.admin_setup_status()                                  to authenticated;
grant execute on function public.admin_rider_load()                                    to authenticated;
grant execute on function public.admin_save_settings(integer, numeric, text)           to authenticated;
grant execute on function public.admin_finance_summary()                               to authenticated;
grant execute on function public.admin_record_merchant_settlement(uuid, boolean, text, text) to authenticated;
grant execute on function public.admin_record_rider_payout(uuid, boolean, text, text)  to authenticated;
-- Only the server side (service role) may confirm a provider payment.
revoke all on function public.provider_confirm_payment(uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.provider_confirm_payment(uuid, text, text, numeric) to service_role;
