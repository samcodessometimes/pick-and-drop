import { db } from './supabase.js';
import { esc, money, note, requireStaff, wireSignOut, callRpc } from './ui.js';

const root = document.querySelector('#dash');
const LABEL = { PENDING_PAYMENT: 'Awaiting payment', PLACED: 'New order', ACCEPTED: 'Accepted', PREPARING: 'Preparing',
                READY_FOR_PICKUP: 'Ready for pickup', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };
const ACTIONS = {
  PLACED: [['ACCEPT', 'Accept'], ['REJECT', 'Reject', 'ghost']],
  ACCEPTED: [['PREPARING', 'Start preparing']],
  PREPARING: [['READY', 'Mark ready for pickup']],
};
let merchant = null;
wireSignOut();

function card(o) {
  const acts = (ACTIONS[o.status] || []).map(([a, t, k]) =>
    `<button class="btn btn-sm ${k === 'ghost' ? 'btn-ghost' : ''}" data-act="${a}" data-id="${esc(o.id)}">${t}</button>`).join(' ');
  const wait = o.status === 'READY_FOR_PICKUP' ? '<p class="note">Waiting for the rider to collect.</p>' : '';
  return `<article class="ocard"><header><strong>#${esc(o.order_number)}</strong><span class="pill">${esc(LABEL[o.status] || o.status)}</span></header>
    <ul>${o.order_items.map(i => `<li>${i.quantity} x ${esc(i.name)}</li>`).join('')}</ul>
    <p>Total ${money(o.total)} <span class="note">(items ${money(o.subtotal)} + delivery ${money(o.delivery_fee)})</span></p>
    <p><strong>${esc(o.contact_name)}</strong> · <a href="tel:${esc(o.contact_phone)}">${esc(o.contact_phone)}</a></p>
    <p>${esc(o.address_line)}${o.landmark ? ' · ' + esc(o.landmark) : ''}</p>
    ${o.notes ? `<p class="inst">Customer note: ${esc(o.notes)}</p>` : ''}${wait}<div class="actions">${acts}</div></article>`;
}

async function load() {
  const { data, error } = await db.from('orders')
    .select('id,order_number,status,subtotal,delivery_fee,total,contact_name,contact_phone,address_line,landmark,notes,created_at,order_items(name,quantity)')
    .eq('merchant_id', merchant.id).order('created_at', { ascending: false }).limit(40);
  const list = document.querySelector('#list');
  if (error) return note(list, 'Could not load orders. Refresh to try again.');
  list.innerHTML = data.length ? data.map(card).join('') : '<p class="note">No orders yet.</p>';
}

function start(m) {
  merchant = m;
  document.querySelector('#demo').hidden = m.status === 'ACTIVE';
  document.querySelector('#mname').textContent = m.name;
  load();
  db.channel('m-' + m.id).on('postgres_changes',
    { event: '*', schema: 'public', table: 'orders', filter: `merchant_id=eq.${m.id}` }, load).subscribe();
}

const user = await requireStaff(root);
if (user) {
  const { data, error } = await db.from('merchant_staff').select('merchants(id,name,status)').eq('user_id', user.id);
  const ms = (data || []).map(r => r.merchants).filter(Boolean);
  if (error || !ms.length) note(root, 'This account is not linked to a merchant. An admin must link it first.');
  else {
    root.innerHTML = `<div id="demo" class="banner" hidden>DEMO / NOT PARTNERED. This business has not agreed to use Pick & Drop. Orders here are test orders.</div>
      <h2 id="mname"></h2>${ms.length > 1 ? `<select id="msel" aria-label="Merchant">${ms.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select>` : ''}
      <p class="error" id="msg" role="alert" hidden></p><div id="list"></div>`;
    document.querySelector('#msel')?.addEventListener('change', e => start(ms.find(m => m.id === e.target.value)));
    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'REJECT' && !confirm('Reject this order? The customer is refunded (simulated).')) return;
      b.disabled = true;
      await callRpc('merchant_set_order_status', { p_order_id: b.dataset.id, p_action: b.dataset.act }, document.querySelector('#msg'));
      load();
    });
    start(ms[0]);
    setInterval(() => merchant && load(), 20000);
  }
}
