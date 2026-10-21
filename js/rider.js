import { db } from './supabase.js';
import { esc, money, note, spinner, showError, requireStaff, wireSignOut, callRpc, keepFresh } from './ui.js';
import { DELIVERY_LABEL, METHOD_LABEL, payInfo } from './status.js';

const root = document.querySelector('#dash');
const NEXT = { ASSIGNED: ['ACCEPT', 'Accept delivery'], ACCEPTED: ['ARRIVE_MERCHANT', 'Arrived at store'],
               AT_MERCHANT: ['PICKUP', 'Picked up order'], PICKED_UP: ['ON_THE_WAY', 'Start delivery'],
               ON_THE_WAY: ['ARRIVE_CUSTOMER', 'Arrived at customer'] };
let rider = null, stop = null, loading = false, lastSig = '';
wireSignOut();

function payBlock(o) {
  const p = payInfo(o.payment), cod = o.payment?.method === 'CASH_ON_DELIVERY';
  if (cod && o.payment.status === 'PENDING')
    return `<p class="cash"><strong>Collect ${money(o.payment.amount)} in cash</strong> from the customer. You record it here before confirming delivery.</p>`;
  if (cod && o.payment.status === 'PAID') return '<p class="cash cash-done"><strong>Cash recorded.</strong> You can now ask for the delivery PIN.</p>';
  return `<p class="note"><span class="badge badge-${p.tone}">${esc(p.text)}</span> ${esc(METHOD_LABEL[o.payment?.method] || '')}. Do not collect any money.</p>`;
}

function card(o) {
  const m = o.merchant || {};
  const n = NEXT[o.delivery_status];
  const blocked = o.delivery_status === 'AT_MERCHANT' && o.status !== 'READY_FOR_PICKUP';
  const cashDue = o.payment?.method === 'CASH_ON_DELIVERY' && o.payment.status === 'PENDING';
  let action = '';
  if (n) action = `<button class="btn btn-block" style="width:100%" data-act="${n[0]}" data-id="${esc(o.id)}" ${blocked ? 'disabled' : ''}>${n[1]}</button>${blocked ? '<p class="note">Waiting for the store to mark this order ready.</p>' : ''}`;
  else if (o.delivery_status === 'AT_CUSTOMER') action =
    (cashDue ? `<button class="btn btn-block" style="width:100%" data-cash="${esc(o.id)}">Cash collected: ${money(o.payment.amount)}</button>` : '') +
    `<form class="pinform" data-id="${esc(o.id)}"><label>Customer delivery PIN
      <input name="pin" inputmode="numeric" autocomplete="off" maxlength="4" pattern="[0-9]{4}" required placeholder="4 digits" ${cashDue ? 'disabled' : ''}></label>
      <button class="btn btn-block" style="width:100%" ${cashDue ? 'disabled' : ''}>Confirm delivery</button>${cashDue ? '<p class="note">Record the cash first. Then enter the PIN.</p>' : ''}</form>`;
  return `<article class="ocard"><header><strong>#${esc(o.order_number)}</strong><span class="pill">${esc(DELIVERY_LABEL[o.delivery_status] || o.delivery_status)}</span></header>
    ${m.status && m.status !== 'ACTIVE' ? '<p class="note">DEMO store, not a partner.</p>' : ''}
    <p><strong>Pick up:</strong> ${esc(m.name)}${m.address_line ? ', ' + esc(m.address_line) : ''}${m.phone ? ' · ' + esc(m.phone) : ''}</p>
    <p><strong>Deliver to:</strong> ${esc(o.contact_name)} · <a href="tel:${esc(o.contact_phone)}">${esc(o.contact_phone)}</a></p>
    <p>${esc(o.address_line)}${o.landmark ? ' · ' + esc(o.landmark) : ''}</p>
    ${o.notes ? `<p class="inst">Delivery note: ${esc(o.notes)}</p>` : ''}
    <p class="note">${o.item_count} items · order total ${money(o.total)}</p>${payBlock(o)}${action}</article>`;
}

async function load() {
  if (loading || !rider) return;
  loading = true;
  const { data, error } = await db.rpc('rider_deliveries');
  loading = false;
  const list = document.querySelector('#list'), err = document.querySelector('#loaderr');
  if (error || !data) { showError(err, 'Could not load deliveries. Check your connection.', load); return; }
  err.hidden = true;
  const sig = JSON.stringify(data); if (sig === lastSig) return; lastSig = sig;
  document.querySelector('#done').textContent = `${data.completed_today} completed today`;
  list.innerHTML = data.orders.length ? data.orders.map(card).join('')
    : `<div class="empty"><p><strong>No deliveries assigned to you right now.</strong></p>
       <p class="note">A Pick &amp; Drop admin assigns deliveries to you. They appear here automatically. This screen refreshes every 15 seconds.</p></div>`;
}

const user = await requireStaff(root);
if (user) {
  const { data, error } = await db.from('riders').select('id,display_name,is_demo').eq('user_id', user.id).maybeSingle();
  if (error) note(root, 'Could not check your rider access. Refresh to try again.');
  else if (!data) root.innerHTML = `<div class="empty"><h2>This login is not linked to a rider profile</h2>
      <p>You are signed in as <strong>${esc(user.email || 'this account')}</strong>. A Pick &amp; Drop admin needs to link this email to your rider profile (Admin, Riders, Link login).</p>
      <p class="note">If you expected access, check that you signed in with the same email the admin used.</p></div>`;
  else {
    rider = data;
    root.innerHTML = `<h2>${esc(rider.display_name)}</h2>${rider.is_demo ? '<p class="note">Demo rider. Test deliveries only.</p>' : ''}
      <p class="note"><span id="live">Connecting...</span> · <span id="done"></span></p>
      <div id="loaderr" class="alert alert-bad" role="alert" hidden></div>
      <p class="error" id="msg" role="alert" hidden></p><div id="list">${spinner('Loading deliveries...')}</div>`;
    const msg = document.querySelector('#msg');
    root.addEventListener('click', async e => {
      const cash = e.target.closest('[data-cash]');
      if (cash) {
        if (!confirm('Confirm you have received the cash from the customer?')) return;
        cash.disabled = true;
        const ok = await callRpc('record_cash_collected', { p_order_id: cash.dataset.cash }, msg);
        if (ok) { msg.hidden = false; msg.className = 'ok'; msg.textContent = 'Cash recorded.'; }
        lastSig = ''; load(); return;
      }
      const b = e.target.closest('[data-act]'); if (!b) return;
      b.disabled = true;
      await callRpc('rider_advance_delivery', { p_order_id: b.dataset.id, p_action: b.dataset.act }, msg);
      lastSig = ''; load();
    });
    // The PIN is typed by the rider and checked only by verify_delivery_pin on the server.
    root.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.target.closest('.pinform'); if (!form) return;
      const pin = new FormData(form).get('pin').trim();
      if (!/^[0-9]{4}$/.test(pin)) { msg.textContent = 'Enter the 4-digit PIN.'; msg.className = 'error'; msg.hidden = false; return; }
      const res = await callRpc('verify_delivery_pin', { p_order_id: form.dataset.id, p_pin: pin }, msg);
      if (res && !res.ok) { msg.textContent = `Wrong PIN. ${res.attempts_left} ${res.attempts_left === 1 ? 'try' : 'tries'} left.`; msg.hidden = false; }
      else if (res?.ok) { msg.hidden = false; msg.textContent = 'Delivery confirmed.'; msg.className = 'ok'; }
      lastSig = ''; load();
    });
    load();
    stop = keepFresh({ name: 'r-' + rider.id, table: 'orders', filter: `rider_id=eq.${rider.id}`, onChange: load,
      onStatus: st => { document.querySelector('#live').textContent = st === 'live' ? 'Live updates on' : 'Checking for new deliveries every 15 seconds'; } });
  }
}
