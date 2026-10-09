import { db } from './supabase.js';
import { esc, money, note, requireStaff, wireSignOut, callRpc } from './ui.js';

const root = document.querySelector('#dash');
const DLABEL = { ASSIGNED: 'Assigned', ACCEPTED: 'Accepted', AT_MERCHANT: 'At store', PICKED_UP: 'Picked up',
                 ON_THE_WAY: 'On the way', AT_CUSTOMER: 'At customer' };
const NEXT = { ASSIGNED: ['ACCEPT', 'Accept delivery'], ACCEPTED: ['ARRIVE_MERCHANT', 'Arrived at store'],
               AT_MERCHANT: ['PICKUP', 'Picked up order'], PICKED_UP: ['ON_THE_WAY', 'Start delivery'],
               ON_THE_WAY: ['ARRIVE_CUSTOMER', 'Arrived at customer'] };
let rider = null;
wireSignOut();

function card(o) {
  const m = o.merchants || {};
  const n = NEXT[o.delivery_status];
  const blocked = o.delivery_status === 'AT_MERCHANT' && o.status !== 'READY_FOR_PICKUP';
  let action = '';
  if (n) action = `<button class="btn btn-block" style="width:100%" data-act="${n[0]}" data-id="${esc(o.id)}" ${blocked ? 'disabled' : ''}>${n[1]}</button>${blocked ? '<p class="note">Waiting for the store to mark this order ready.</p>' : ''}`;
  else if (o.delivery_status === 'AT_CUSTOMER') action = `<form class="pinform" data-id="${esc(o.id)}"><label>Customer delivery PIN
    <input name="pin" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{4}" required placeholder="4 digits"></label>
    <button class="btn btn-block" style="width:100%">Confirm delivery</button></form>`;
  return `<article class="ocard"><header><strong>#${esc(o.order_number)}</strong><span class="pill">${esc(DLABEL[o.delivery_status] || o.delivery_status)}</span></header>
    ${m.status && m.status !== 'ACTIVE' ? '<p class="note">DEMO store, not a partner.</p>' : ''}
    <p><strong>Pick up:</strong> ${esc(m.name)}${m.address_line ? ', ' + esc(m.address_line) : ''}${m.phone ? ' · ' + esc(m.phone) : ''}</p>
    <p><strong>Deliver to:</strong> ${esc(o.contact_name)} · <a href="tel:${esc(o.contact_phone)}">${esc(o.contact_phone)}</a></p>
    <p>${esc(o.address_line)}${o.landmark ? ' · ' + esc(o.landmark) : ''}</p>
    ${o.notes ? `<p class="inst">Delivery note: ${esc(o.notes)}</p>` : ''}
    <p class="note">${o.order_items.reduce((s, i) => s + i.quantity, 0)} items · order total ${money(o.total)}</p>${action}</article>`;
}

async function load() {
  const { data, error } = await db.from('orders')
    .select('id,order_number,status,delivery_status,total,contact_name,contact_phone,address_line,landmark,notes,merchants(name,status,address_line,phone),order_items(quantity)')
    .eq('rider_id', rider.id).neq('delivery_status', 'DELIVERED').neq('status', 'CANCELLED').order('created_at');
  const list = document.querySelector('#list');
  if (error) return note(list, 'Could not load deliveries. Refresh to try again.');
  list.innerHTML = data.length ? data.map(card).join('') : '<p class="note">No deliveries assigned right now.</p>';
}

const user = await requireStaff(root);
if (user) {
  const { data } = await db.from('riders').select('id,display_name,is_demo').eq('user_id', user.id).maybeSingle();
  if (!data) note(root, 'This account is not linked to a rider profile. An admin must link it first.');
  else {
    rider = data;
    root.innerHTML = `<h2>${esc(rider.display_name)}</h2>${rider.is_demo ? '<p class="note">Demo rider. Test deliveries only.</p>' : ''}
      <p class="error" id="msg" role="alert" hidden></p><div id="list"></div>`;
    const msg = document.querySelector('#msg');
    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      b.disabled = true;
      await callRpc('rider_advance_delivery', { p_order_id: b.dataset.id, p_action: b.dataset.act }, msg);
      load();
    });
    // The PIN is typed by the rider and checked only by verify_delivery_pin on the server.
    root.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target.closest('.pinform'); if (!form) return;
      const pin = new FormData(form).get('pin').trim();
      if (!/^[0-9]{4}$/.test(pin)) { msg.textContent = 'Enter the 4-digit PIN.'; msg.hidden = false; return; }
      const res = await callRpc('verify_delivery_pin', { p_order_id: form.dataset.id, p_pin: pin }, msg);
      if (res && !res.ok) { msg.textContent = `Wrong PIN. ${res.attempts_left} ${res.attempts_left === 1 ? 'try' : 'tries'} left.`; msg.hidden = false; }
      else if (res?.ok) { msg.hidden = false; msg.textContent = 'Delivery confirmed.'; msg.className = 'ok'; }
      load();
    });
    load();
    db.channel('r-' + rider.id).on('postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `rider_id=eq.${rider.id}` }, load).subscribe();
    setInterval(load, 20000);
  }
}
