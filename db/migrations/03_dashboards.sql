-- =====================================================================
-- PICK & DROP | Migration 03: Merchant and rider dashboards, assignment
-- Requires 01 and 02. Adds NO weaker policies: it extends read access to
-- admin-linked merchant staff and moves every status change into
-- server-side functions that validate who is calling and the transition.
-- =====================================================================

-- Demo merchants have no owner (owner_id plus ACTIVE means a signed partner).
-- merchant_staff lets an admin link a test login to ANY merchant, including a
-- DEMO one, without changing its status or implying a partnership.
create table public.merchant_staff (
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (merchant_id, user_id)
);
create index merchant_staff_user_idx on public.merchant_staff (user_id);
alter table public.merchant_staff enable row level security;
create policy merchant_staff_read  on public.merchant_staff for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy merchant_staff_admin on public.merchant_staff for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create or replace function public.is_merchant_staff(p_merchant_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from merchant_staff s where s.merchant_id = p_merchant_id and s.user_id = auth.uid())
      or exists (select 1 from merchants m where m.id = p_merchant_id and m.owner_id = auth.uid())
$$;
revoke all on function public.is_merchant_staff(uuid) from public, anon;
grant execute on function public.is_merchant_staff(uuid) to authenticated;

-- Same rules as migration 02, with merchant staff added next to merchant owners.
-- order_items, history and payments read policies reference orders, so they
-- inherit this scope automatically.
drop policy orders_read on public.orders;
create policy orders_read on public.orders for select to authenticated using (
  customer_id = auth.uid() or public.is_admin()
  or exists (select 1 from riders r where r.id = rider_id and r.user_id = auth.uid())
  or public.is_merchant_staff(merchant_id));

-- ---------- merchant actions ------------------------------------------
-- ACCEPT:    PLACED    -> ACCEPTED
-- REJECT:    PLACED    -> CANCELLED (simulated payment marked REFUNDED)
-- PREPARING: ACCEPTED  -> PREPARING
-- READY:     PREPARING -> READY_FOR_PICKUP
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
      update riders set availability = 'AVAILABLE' where id = o.rider_id;
      update orders set rider_id = null, delivery_status = 'UNASSIGNED' where id = p_order_id;
    end if;
  end if;
  return jsonb_build_object('status', v_new);
end $$;

-- ---------- admin assignment ------------------------------------------
create or replace function public.admin_assign_rider(p_order_id uuid, p_rider_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; r riders%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status not in ('PLACED','ACCEPTED','PREPARING','READY_FOR_PICKUP') then
    raise exception 'This order can no longer be assigned (%)', o.status; end if;
  if o.delivery_status not in ('UNASSIGNED','ASSIGNED') then
    raise exception 'This order is already with a rider'; end if;
  select * into r from riders where id = p_rider_id;
  if not found then raise exception 'Rider not found'; end if;
  if r.availability = 'OFFLINE' then raise exception 'That rider is offline'; end if;
  update orders set rider_id = p_rider_id, delivery_status = 'ASSIGNED' where id = p_order_id;
  return jsonb_build_object('rider', r.display_name);
end $$;

-- ---------- rider actions ---------------------------------------------
-- ACCEPT ASSIGNED->ACCEPTED, ARRIVE_MERCHANT ACCEPTED->AT_MERCHANT,
-- PICKUP AT_MERCHANT->PICKED_UP (only once the store marked it ready),
-- ON_THE_WAY PICKED_UP->ON_THE_WAY, ARRIVE_CUSTOMER ON_THE_WAY->AT_CUSTOMER.
-- The final step (DELIVERED) exists only in verify_delivery_pin().
create or replace function public.rider_advance_delivery(p_order_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_new text;
begin
  select * into o from orders where id = p_order_id for update;
  if not found or not (public.is_admin()
     or exists (select 1 from riders r where r.id = o.rider_id and r.user_id = auth.uid())) then
    raise exception 'Order not found'; end if;
  if o.status = 'CANCELLED' then raise exception 'This order was cancelled'; end if;
  if p_action = 'PICKUP' and o.delivery_status = 'AT_MERCHANT' and o.status <> 'READY_FOR_PICKUP' then
    raise exception 'The store has not marked this order ready yet'; end if;
  v_new := case
    when p_action = 'ACCEPT'          and o.delivery_status = 'ASSIGNED'    then 'ACCEPTED'
    when p_action = 'ARRIVE_MERCHANT' and o.delivery_status = 'ACCEPTED'    then 'AT_MERCHANT'
    when p_action = 'PICKUP'          and o.delivery_status = 'AT_MERCHANT' then 'PICKED_UP'
    when p_action = 'ON_THE_WAY'      and o.delivery_status = 'PICKED_UP'   then 'ON_THE_WAY'
    when p_action = 'ARRIVE_CUSTOMER' and o.delivery_status = 'ON_THE_WAY'  then 'AT_CUSTOMER' end;
  if v_new is null then raise exception 'That step is not available yet'; end if;
  update orders set delivery_status = v_new where id = p_order_id;
  if p_action = 'ACCEPT' then update riders set availability = 'BUSY' where id = o.rider_id; end if;
  return jsonb_build_object('delivery_status', v_new);
end $$;

revoke all on function public.merchant_set_order_status(uuid, text) from public, anon;
revoke all on function public.admin_assign_rider(uuid, uuid)        from public, anon;
revoke all on function public.rider_advance_delivery(uuid, text)    from public, anon;
grant execute on function public.merchant_set_order_status(uuid, text) to authenticated;
grant execute on function public.admin_assign_rider(uuid, uuid)        to authenticated;
grant execute on function public.rider_advance_delivery(uuid, text)    to authenticated;
