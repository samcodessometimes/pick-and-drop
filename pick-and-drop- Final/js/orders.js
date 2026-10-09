import { db } from './supabase.js';
import { ensureSession } from './auth.js';

export async function placeOrder({ cart, address, method, ref }) {
  await ensureSession();
  const { data, error } = await db.rpc('place_order', {
    p_merchant_id: cart.merchant.id,
    p_items: cart.items.map(i => ({ product_id: i.id, qty: i.qty })),
    p_address: address,
    p_method: method,
    p_txn_ref: ref,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function getOrder(id) {
  await ensureSession();
  const { data, error } = await db.from('orders')
    .select('*, merchants(name), order_items(name,quantity,line_total), payments(method,status,is_simulated)')
    .eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getPin(id) {
  const { data } = await db.from('order_delivery_pins').select('pin').eq('order_id', id).maybeSingle();
  return data?.pin ?? null;
}

export function watchOrder(id, onChange) {
  return db.channel('order-' + id)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` }, onChange)
    .subscribe();
}
