import { configured, db } from './supabase.js';
import { stars, picker } from './stars.js';
import { getOrder, getPin, watchOrder } from './orders.js';
import { payInfo, METHOD_LABEL, DELIVERY_LABEL } from './status.js';

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
  const pay = o.payments?.[0], pi = payInfo(pay), cashDue = pay?.method === 'CASH_ON_DELIVERY' && pay.status === 'PENDING' && o.status !== 'CANCELLED';
  root.innerHTML = `
    ${o.is_demo ? '<div class="banner">Demo order. No real business, rider or payment is involved.</div>' : ''}
    <h2>Order #${esc(o.order_number)}</h2>
    <p class="note">${esc(o.merchants?.name)} · ${money(o.total)}</p>
    <p class="payline"><span class="badge badge-${pi.tone}">${esc(pi.text)}</span> <span class="note">${esc(METHOD_LABEL[pay?.method] || '')}</span></p>
    ${cashDue ? `<p class="inst">Cash on delivery: please have ${money(o.total)} ready for the rider.</p>` : ''}
    ${pi.detail && !cashDue ? `<p class="note">${esc(pi.detail)}</p>` : ''}
    ${o.rider_id ? `<p class="note">Delivery: ${esc(DELIVERY_LABEL[o.delivery_status] || o.delivery_status)}</p>` : ''}
    ${o.status === 'CANCELLED' ? '<p class="error">This order was cancelled.</p>' : `<ol class="steps">${STEPS.map((t, i) =>
      `<li class="${i < s ? 'done' : i === s ? 'now' : ''}" ${i === s ? 'aria-current="step"' : ''}>${t}</li>`).join('')}</ol>`}
    ${pin ? `<section class="pin" aria-label="Delivery PIN"><p>Delivery PIN</p><strong>${esc(pin)}</strong>
      <p>Your Pick & Drop delivery PIN is ${esc(pin)}. Keep this PIN private and give it to your rider when your order arrives.</p></section>` : ''}
    ${o.status === 'DELIVERED' ? '<p class="done-msg">Your order has been delivered. Thank you for using Pick & Drop.</p>' : ''}
    <h3>Items</h3>${o.order_items.map(i => `<div class="item"><span>${i.quantity} x ${esc(i.name)}</span><span>${money(i.line_total)}</span></div>`).join('')}
    <p class="note">Delivering to ${esc(o.address_line)}</p>`;
  await drawRating(o);
}

// Rating box. It lives outside #tracking so the 15-second refresh never wipes a half-written rating.
const box = document.querySelector('#rating');
let ratingFor = '';   // 'form:<id>' or 'done:<id>' once drawn, so an unchanged state is not redrawn
async function drawRating(o) {
  if (!box) return;
  if (o.status !== 'DELIVERED') { box.innerHTML = ''; ratingFor = ''; return; }
  const { data: mine, error } = await db.from('order_ratings').select('stars,comment').eq('order_id', o.id).maybeSingle();
  if (error) { box.innerHTML = '<p class="note">Could not check your rating. Refresh to try again.</p>'; ratingFor = ''; return; }
  const state = (mine ? 'done:' : 'form:') + o.id;
  if (state === ratingFor) return; ratingFor = state;
  if (mine) {
    box.innerHTML = `<section class="ratebox"><h3>Your rating</h3><p>${stars(mine.stars)} <b>${mine.stars} out of 5</b></p>${mine.comment ? `<p class="note">${esc(mine.comment)}</p>` : ''}<p class="note">Thank you. Your rating helps other customers.</p></section>`;
    return;
  }
  box.innerHTML = `<section class="ratebox"><h3>How was ${esc(o.merchants?.name || 'your order')}?</h3>
    <form id="rateform" novalidate>${picker('rating')}
    <label>Add a comment (optional)<textarea name="comment" rows="2" maxlength="300" placeholder="What did you like, or what went wrong?"></textarea></label>
    <p class="error" id="rmsg" role="alert" hidden></p><button class="btn btn-block" type="submit">Submit rating</button></form></section>`;
  const form = box.querySelector('#rateform'), msg = box.querySelector('#rmsg');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const val = form.querySelector('input[name=rating]:checked')?.value;
    if (!val) { msg.textContent = 'Choose a star rating first.'; msg.hidden = false; return; }
    const btn = form.querySelector('button'); btn.disabled = true; msg.hidden = true;
    const { error: err } = await db.rpc('rate_order', { p_order_id: o.id, p_stars: Number(val), p_comment: form.comment.value });
    if (err) { msg.textContent = err.message; msg.hidden = false; btn.disabled = false; return; }
    ratingFor = ''; drawRating(o).catch(() => {});
  });
}

const id = new URLSearchParams(location.search).get('id');
if (!configured) root.innerHTML = '<p class="note">Supabase is not connected yet. Add your keys in js/config.js.</p>';
else if (!id) root.innerHTML = '<p class="note">No order selected.</p>';
else {
  draw(id).catch(() => { root.innerHTML = '<p class="note">Could not load your order. Refresh to try again.</p>'; });
  watchOrder(id, () => draw(id).catch(() => {}));
}
