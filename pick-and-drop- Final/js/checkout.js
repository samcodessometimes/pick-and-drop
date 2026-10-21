import { configured } from './supabase.js';
import { getCart, clearCart, cartSubtotal } from './cart.js';
import { placeOrder } from './orders.js';
import { METHODS, SIMULATED, validRef } from './payments.js';
import { img } from './images.js';

const root = document.querySelector('#checkout');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => 'NLe ' + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 });
const cart = getCart();
let coords = null;

function show(html) { root.innerHTML = html; }

if (!configured) show('<p class="note">Supabase is not connected yet. Add your keys in js/config.js.</p>');
else if (!cart.items.length) show('<p class="note">Your cart is empty.</p><a class="btn" href="index.html">Browse stores</a>');
else {
  const sub = cartSubtotal(), fee = cart.merchant.delivery_fee;
  const kind = cart.merchant.type === 'GROCERY' ? 'product' : 'meal';
  const lines = cart.items.map(i => `<div class="item"><div class="pimg pimg-xs">${img(i.image, `${i.name}, illustrative image`, kind, { w: 96, h: 96 })}</div><div class="ptext"><h3>${esc(i.name)}</h3><p>${i.qty} x ${money(i.price)}</p></div><span>${money(i.qty * i.price)}</span></div>`).join('');
  show(`<h2>${esc(cart.merchant.name)}</h2>
  <section aria-label="Your order">${lines}</section>
  <form id="form" novalidate>
    <h3>Delivery details</h3>
    <label>Your name<input name="contact_name" autocomplete="name" required maxlength="80"></label>
    <label>Phone number<input name="contact_phone" type="tel" autocomplete="tel" inputmode="tel" required placeholder="+232 ..."></label>
    <label>Delivery address<input name="address_line" autocomplete="street-address" required maxlength="200" placeholder="Street, area, Freetown"></label>
    <label>Landmark (optional)<input name="landmark" maxlength="120" placeholder="Near ..."></label>
    <button type="button" class="btn btn-ghost" id="locate">Use my current location</button>
    <p class="note" id="loc-status" role="status"></p>
    <label>Note for the rider (optional)<input name="notes" maxlength="300"></label>
    <h3>Payment</h3>
    <fieldset><legend class="sr">Payment method</legend>
      ${Object.entries(METHODS).map(([k, v], i) => `<label class="radio"><input type="radio" name="method" value="${k}" ${i ? '' : 'checked'}>
        <span>${esc(v.label)}${v.demo ? ' <span class="tag-demo">DEMO</span>' : ''}<small class="help">${esc(v.help)}</small></span></label>`).join('')}
    </fieldset>
    <label id="ref-wrap">Transaction ID (optional in demo mode)<input name="ref" autocomplete="off" maxlength="24" placeholder="Leave empty to use a demo reference"></label>
    ${SIMULATED ? '<p class="note" id="pay-note">Demo mode: Orange Money and Afrimoney are simulated. No money moves, nothing is verified, and the order is marked as a demo payment.</p>' : ''}
    <dl class="totals"><dt>Subtotal</dt><dd>${money(sub)}</dd><dt>Delivery</dt><dd>${money(fee)}</dd><dt>Total</dt><dd><strong>${money(sub + fee)}</strong></dd></dl>
    <p class="note" id="cod-note" hidden>Cash on delivery: you pay <strong>${money(sub + fee)}</strong> in cash to the rider when the order arrives. Keep your delivery PIN private until you have paid.</p>
    <p class="error" id="err" role="alert" hidden></p>
    <button class="btn btn-block" id="submit" style="width:100%">Place order</button>
  </form>`);

  const form = document.querySelector('#form'), err = document.querySelector('#err'), btn = document.querySelector('#submit');
  const fail = m => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: 'center' }); };

  const refWrap = document.querySelector('#ref-wrap'), codNote = document.querySelector('#cod-note'), payNote = document.querySelector('#pay-note');
  const syncMethod = () => {
    const cod = form.querySelector('[name=method]:checked').value === 'CASH_ON_DELIVERY';
    refWrap.hidden = cod; codNote.hidden = !cod; if (payNote) payNote.hidden = cod;
  };
  form.addEventListener('change', e => { if (e.target.name === 'method') syncMethod(); });
  syncMethod();

  document.querySelector('#locate').addEventListener('click', () => {
    const s = document.querySelector('#loc-status');
    if (!navigator.geolocation) { s.textContent = 'Location is not available on this device.'; return; }
    s.textContent = 'Finding your location...';
    navigator.geolocation.getCurrentPosition(
      p => { coords = { latitude: +p.coords.latitude.toFixed(6), longitude: +p.coords.longitude.toFixed(6) }; s.textContent = 'Location saved. Still add your address above.'; },
      () => { coords = null; s.textContent = 'Could not get your location. Enter your address instead.'; },
      { enableHighAccuracy: true, timeout: 10000 });
  });

  form.addEventListener('submit', async e => {
    e.preventDefault(); err.hidden = true;
    const f = Object.fromEntries(new FormData(form));
    const digits = f.contact_phone.replace(/\D/g, '');
    if (f.contact_name.trim().length < 2) return fail('Enter your name.');
    if (digits.length < 8 || digits.length > 15) return fail('Enter a valid phone number.');
    if (f.address_line.trim().length < 5) return fail('Enter your delivery address.');
    if (f.method !== 'CASH_ON_DELIVERY' && !validRef((f.ref || '').trim())) return fail('Transaction ID must be 6 to 24 letters or numbers, or leave it empty.');
    btn.disabled = true; btn.textContent = 'Placing order...';
    try {
      const res = await placeOrder({
        cart, method: f.method, ref: f.method === 'CASH_ON_DELIVERY' ? '' : (f.ref || '').trim(),
        address: { contact_name: f.contact_name, contact_phone: f.contact_phone, address_line: f.address_line,
                   landmark: f.landmark, notes: f.notes, ...(coords || {}) },
      });
      clearCart();
      location.href = 'tracking.html?id=' + encodeURIComponent(res.order_id);
    } catch (ex) {
      fail(ex.message || 'Could not place your order. Try again.');
      btn.disabled = false; btn.textContent = 'Place order';
    }
  });
}
