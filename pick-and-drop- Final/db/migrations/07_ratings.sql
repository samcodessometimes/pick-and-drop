-- =====================================================================
-- PICK & DROP | Migration 07: customer ratings
-- Requires 01 to 06. Safe to run once, and safe to run again (everything is "if not exists" or "create or replace").
--
-- A customer can rate a shop once, only for their own order, and only after that order is DELIVERED.
-- Ratings are written ONLY by the function rate_order(). Nobody can insert, edit or delete a rating
-- directly, so a shop's average cannot be forged. The shop's rating and rating_count are recalculated
-- from the real ratings each time, so they always agree with the data.
-- Nothing here touches orders, payments, delivery PINs or any existing policy.
-- =====================================================================
create table if not exists public.order_ratings (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  customer_id uuid not null references auth.users(id),
  stars       smallint not null check (stars between 1 and 5),
  comment     text check (comment is null or char_length(comment) <= 300),
  created_at  timestamptz not null default now()
);
create index if not exists order_ratings_merchant_idx on public.order_ratings (merchant_id, created_at desc);

alter table public.order_ratings enable row level security;
revoke all on public.order_ratings from anon, authenticated;
grant select on public.order_ratings to authenticated;
drop policy if exists order_ratings_read on public.order_ratings;
-- The customer who wrote it, the staff of that shop, and admins may read a rating. Nobody else.
create policy order_ratings_read on public.order_ratings for select to authenticated using (
  customer_id = auth.uid() or public.is_admin() or public.is_merchant_staff(merchant_id));

create or replace function public.rate_order(p_order_id uuid, p_stars integer, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  o orders%rowtype;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_avg numeric; v_n integer;
begin
  if v_uid is null then raise exception 'Please refresh and try again'; end if;
  if p_stars is null or p_stars < 1 or p_stars > 5 then raise exception 'Choose 1 to 5 stars'; end if;
  if v_comment is not null and char_length(v_comment) > 300 then raise exception 'Keep the comment under 300 characters'; end if;
  select * into o from orders where id = p_order_id and customer_id = v_uid;
  if not found then raise exception 'We could not find that order'; end if;
  if o.status <> 'DELIVERED' then raise exception 'You can rate an order once it has been delivered'; end if;
  if exists (select 1 from order_ratings where order_id = p_order_id) then raise exception 'You have already rated this order'; end if;
  insert into order_ratings (order_id, merchant_id, customer_id, stars, comment) values (p_order_id, o.merchant_id, v_uid, p_stars, v_comment);
  select round(avg(stars)::numeric, 1), count(*) into v_avg, v_n from order_ratings where merchant_id = o.merchant_id;
  update merchants set rating = v_avg, rating_count = v_n where id = o.merchant_id;
  return jsonb_build_object('stars', p_stars, 'shop_rating', v_avg, 'shop_rating_count', v_n);
end $$;
revoke all on function public.rate_order(uuid, integer, text) from public, anon;
grant execute on function public.rate_order(uuid, integer, text) to authenticated;
