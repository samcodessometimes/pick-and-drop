// Demo order simulator. It places orders through the SAME place_order function the customer checkout uses,
// so prices, minimum order rules, payment labels and delivery PINs are all real server behaviour.
// It only ever orders from DEMO shops (slug starting "demo-"), and every simulated order is labelled as a demo order.
import { db } from './supabase.js';

const pick = a => a[Math.floor(Math.random() * a.length)];
const METHODS = ['CASH_ON_DELIVERY', 'CASH_ON_DELIVERY', 'ORANGE_MONEY', 'AFRIMONEY'];
const AREAS = ['Wilkinson Road', 'Lumley Beach Road', 'Aberdeen Road', 'Hill Station', 'Congo Cross', 'Kissy Road'];

export async function simulate(count, onStep) {
  const { data: shops, error } = await db.from('merchants_public').select('id,slug,name,min_order_amount')
    .like('slug', 'demo-%').eq('delivery_enabled', true);
  if (error) throw new Error('Could not load the demo shops.');
  if (!shops?.length) throw new Error('There are no demo shops. Run db/dev/demo_seed.sql first.');
  const out = [];
  for (let i = 1; i <= count; i++) {
    const shop = pick(shops);
    onStep?.(`Placing order ${i} of ${count} from ${shop.name}...`);
    try {
      const { data: items, error: e1 } = await db.from('products').select('id,price').eq('merchant_id', shop.id).eq('is_available', true);
      if (e1 || !items?.length) throw new Error('this shop has no available items');
      const lines = [], used = new Set(); let total = 0;
      const min = Number(shop.min_order_amount) || 0;
      while ((lines.length < 2 || total < min) && used.size < items.length && lines.length < 8) {
        const it = pick(items.filter(x => !used.has(x.id))); used.add(it.id);
        const qty = 1 + Math.floor(Math.random() * 2); lines.push({ product_id: it.id, qty }); total += qty * Number(it.price);
      }
      const phone = '+232760' + String(10000 + Math.floor(Math.random() * 89999));
      const { data, error: e2 } = await db.rpc('place_order', {
        p_merchant_id: shop.id, p_items: lines,
        p_address: { contact_name: `Demo Customer ${100 + Math.floor(Math.random() * 900)}`, contact_phone: phone, address_line: `${1 + Math.floor(Math.random() * 60)} ${pick(AREAS)}, Freetown (simulated)` },
        p_method: pick(METHODS), p_txn_ref: null });
      if (e2) throw new Error(e2.message);
      out.push({ ok: true, shop: shop.name, id: data.order_id, number: data.order_number });
    } catch (e) { out.push({ ok: false, shop: shop.name, error: e.message }); }
  }
  return out;
}
