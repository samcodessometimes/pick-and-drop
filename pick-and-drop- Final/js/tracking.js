import { configured } from './supabase.js';
import { getOrder, getPin, watchOrder } from './orders.js';

const root = document.querySelector('#tracking');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => 'NLe ' + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const STEPS = ['Order placed', 'Accepted by store', 'Being prepared', 'Ready for pickup', 'Rider on the way', 'Delivered'];

function stage(o) {
  if (o.status === 'DELIVERED') return 5;
  if (['PICKED_UP', 'ON_THE_WAY', 'AT_CUSTOMER'].includes(o.delivery_status)) return 4;
  return { READY_FOR_PICKUP: 3, PREPARING: 2, ACCEPTED: 1 }[o.status] ?? 0;
}

async function draw(id) {
  const o = await getOrder(id);
  if (!o) { root.innerHTML = '<p class="note">We could not find this order.</p>'; return; }
  const pin = o.status === 'DELIVERED' ? null : await getPin(id);
  const s = stage(o);
  root.innerHTML = `
    ${o.is_demo ? '<div class="banner">Demo order. No real business, rider or payment is involved.</div>' : ''}
    <h2>Order #${esc(o.order_number)}</h2>
    <p class="note">${esc(o.merchants?.name)} · ${money(o.total)}</p>
    ${o.status === 'CANCELLED' ? '<p class="error">This order was cancelled.</p>' : `<ol class="steps">${STEPS.map((t, i) =>
      `<li class="${i < s ? 'done' : i === s ? 'now' : ''}" ${i === s ? 'aria-current="step"' : ''}>${t}</li>`).join('')}</ol>`}
    ${pin ? `<section class="pin" aria-label="Delivery PIN"><p>Delivery PIN</p><strong>${esc(pin)}</strong>
      <p>Your Pick & Drop delivery PIN is ${esc(pin)}. Keep this PIN private and give it to your rider when your order arrives.</p></section>` : ''}
    ${o.status === 'DELIVERED' ? '<p class="done-msg">Your order has been delivered. Thank you for using Pick & Drop.</p>' : ''}
    <h3>Items</h3>${o.order_items.map(i => `<div class="item"><span>${i.quantity} x ${esc(i.name)}</span><span>${money(i.line_total)}</span></div>`).join('')}
    <p class="note">Delivering to ${esc(o.address_line)}</p>`;
}

const id = new URLSearchParams(location.search).get('id');
if (!configured) root.innerHTML = '<p class="note">Supabase is not connected yet. Add your keys in js/config.js.</p>';
else if (!id) root.innerHTML = '<p class="note">No order selected.</p>';
else {
  draw(id).catch(() => { root.innerHTML = '<p class="note">Could not load your order. Refresh to try again.</p>'; });
  watchOrder(id, () => draw(id).catch(() => {}));
}
