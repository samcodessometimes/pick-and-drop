import { db } from './supabase.js';
import { esc, money, note, fmtDate, timeAgo, spinner, showError, requireStaff, wireSignOut, callRpc, keepFresh } from './ui.js';
import { ORDER_LABEL, DELIVERY_LABEL, METHOD_LABEL, payInfo } from './status.js';

const root = document.querySelector('#dash');
const ACTIONS = {
  PLACED: [['ACCEPT', 'Accept'], ['REJECT', 'Reject', 'ghost']],
  ACCEPTED: [['PREPARING', 'Start preparing']],
  PREPARING: [['READY', 'Mark ready for pickup']],
};
const ACTIVE = ['PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'];
const RANK = { PLACED: 0, ACCEPTED: 1, PREPARING: 2, READY_FOR_PICKUP: 3, PENDING_PAYMENT: 4 };
let lastSig = '', merchant = null, data = null, tab = 'active', stop = null, seen = null, firstLoad = true, loading = false;
wireSignOut();

const pct = bps => (bps / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 }) + '%';
const sound = () => { try { return localStorage.getItem('pd_sound') === '1'; } catch { return false; } };

function moneyLine(o) {
  const m = o.money || {};
  if (o.status === 'CANCELLED') return '';
  if (m.commission_bps == null) return '<p class="note">Your payout for this order: not set yet. Pick &amp; Drop has not agreed commission terms.</p>';
  return `<p class="note">Pick &amp; Drop commission (${pct(m.commission_bps)}): ${money(m.commission)} · Your payout for this order: <strong>${money(m.net)}</strong></p>`;
}

function paymentBlock(o) {
  const p = payInfo(o.payment), cod = o.payment?.method === 'CASH_ON_DELIVERY';
  let help = p.detail;
  if (o.status !== 'CANCELLED') {
    if (cod && o.payment?.status === 'PENDING') help = 'The customer pays the rider in cash at the door. You do not collect this payment. The order cannot be marked delivered until the rider records the cash.';
    else if (o.payment?.status === 'SIMULATED') help = 'Demo payment. No real money has been received for this order.';
  }
  return `<p class="payline"><span class="badge badge-${p.tone}">${esc(p.text)}</span> ${cod ? '' : `<span class="note">${esc(METHOD_LABEL[o.payment?.method] || '')}</span>`}</p>${help ? `<p class="note">${esc(help)}</p>` : ''}`;
}

function card(o) {
  const acts = o.status === 'PENDING_PAYMENT' ? '' : (ACTIONS[o.status] || []).map(([a, t, k]) =>
    `<button class="btn btn-sm ${k === 'ghost' ? 'btn-ghost' : ''}" data-act="${a}" data-id="${esc(o.id)}">${t}</button>`).join(' ');
  const wait = o.status === 'READY_FOR_PICKUP' ? `<p class="note">${o.rider ? `Rider ${esc(o.rider)}: ${esc(DELIVERY_LABEL[o.delivery_status] || '')}.` : 'Waiting for an admin to assign a rider.'}</p>`
    : o.status === 'PENDING_PAYMENT' ? '<p class="note">Waiting for the customer payment to be confirmed. Do not start this order yet.</p>' : '';
  const isNew = o.status === 'PLACED';
  return `<article class="ocard ${isNew ? 'ocard-new' : ''}" data-order="${esc(o.id)}">
    <header><strong>#${esc(o.order_number)}</strong><span class="pill">${esc(ORDER_LABEL[o.status] || o.status)}</span></header>
    <p class="note">${fmtDate(o.created_at)} · ${esc(timeAgo(o.created_at))}${o.is_demo ? ' · <span class="tag-demo">DEMO</span>' : ''}</p>
    ${paymentBlock(o)}
    <table class="lines"><thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody>
      ${o.items.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${i.quantity}</td><td class="num">${money(i.unit_price)}</td><td class="num">${money(i.line_total)}</td></tr>`).join('')}
    </tbody><tfoot><tr><td colspan="3">Items subtotal</td><td class="num">${money(o.subtotal)}</td></tr>
      <tr><td colspan="3">Delivery fee</td><td class="num">${money(o.delivery_fee)}</td></tr>
      <tr><th colspan="3">Customer pays</th><th class="num">${money(o.total)}</th></tr></tfoot></table>
    ${moneyLine(o)}
    <p><strong>${esc(o.contact_name)}</strong> · <a href="tel:${esc(o.contact_phone)}">${esc(o.contact_phone)}</a></p>
    <p>${esc(o.address_line)}${o.landmark ? ' · ' + esc(o.landmark) : ''}</p>
    ${o.notes ? `<p class="inst">Customer note: ${esc(o.notes)}</p>` : ''}${wait}<div class="actions">${acts}</div></article>`;
}

const stat = (title, value, sub, cls = '') => `<div class="stat ${cls}"><span>${esc(title)}</span><strong>${value}</strong>${sub ? `<small>${sub}</small>` : ''}</div>`;

function summary(s, demo) {
  const sales = Number(s.items_sales), salesDemo = Number(s.items_sales_demo);
  const owed = s.orders_pending_terms > 0 && !s.orders_owed
    ? stat('Owed to you', 'Not set', `${s.orders_pending_terms} delivered order${s.orders_pending_terms === 1 ? '' : 's'} waiting for commission terms`)
    : stat('Owed to you', money(s.net_owed), `${s.orders_owed} order${s.orders_owed === 1 ? '' : 's'}, after commission${s.orders_pending_terms ? ` · ${s.orders_pending_terms} more waiting for terms` : ''}`);
  return `<div class="stats">
    ${stat('Needs action', s.new_orders, 'new orders to accept or reject', s.new_orders ? 'stat-alert' : '')}
    ${stat('In the kitchen', s.in_progress, 'accepted or preparing')}
    ${stat('Ready for pickup', s.ready, 'waiting for a rider to collect')}
    ${stat('Out for delivery', s.out_for_delivery, 'collected by the rider')}
    ${stat('Completed', s.completed, `${s.cancelled} rejected or cancelled`)}
    ${stat('Orders today', s.orders_today, `${s.orders_total} in total`)}
    ${stat('Sales', money(sales), salesDemo ? `Includes ${money(salesDemo)} from demo payments (no real money)` : 'Delivered orders, items only')}
    ${owed}
    ${stat('Settled so far', money(s.net_settled), 'payouts recorded by Pick &amp; Drop')}</div>`;
}

function tabsHtml(orders) {
  const n = f => orders.filter(f).length;
  const T = [['active', 'Active', n(o => ACTIVE.includes(o.status))], ['completed', 'Completed', n(o => o.status === 'DELIVERED')], ['rejected', 'Rejected or cancelled', n(o => o.status === 'CANCELLED')]];
  return `<div class="atabs" role="tablist" aria-label="Orders">${T.map(([k, t, c]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${t} (${c})</button>`).join('')}</div>`;
}

function listHtml(orders) {
  let rows = tab === 'active' ? orders.filter(o => ACTIVE.includes(o.status)).sort((a, b) => RANK[a.status] - RANK[b.status] || a.created_at.localeCompare(b.created_at))
    : tab === 'completed' ? orders.filter(o => o.status === 'DELIVERED') : orders.filter(o => o.status === 'CANCELLED');
  if (rows.length) return rows.map(card).join('');
  return `<div class="empty"><p><strong>${tab === 'active' ? 'No active orders right now.' : tab === 'completed' ? 'No completed orders yet.' : 'No rejected or cancelled orders.'}</strong></p>
    ${tab === 'active' ? '<p class="note">When a customer places an order for this shop it appears here automatically and this page shows a "New order" alert.</p>' : ''}</div>`;
}

function draw() {
  if (!data) return;
  const el = document.querySelector('#body');
  el.innerHTML = `${summary(data.summary, merchant.status !== 'ACTIVE')}${tabsHtml(data.orders)}<div id="list">${listHtml(data.orders)}</div>
    <h2>Payouts to this shop</h2>${data.settlements.length
      ? `<table class="lines"><thead><tr><th>Reference</th><th>Recorded</th><th class="num">Orders</th><th class="num">Amount</th></tr></thead><tbody>${data.settlements.map(s =>
          `<tr><td>${esc(s.reference)}${s.is_demo ? ' <span class="tag-demo">DEMO</span>' : ''}</td><td>${fmtDate(s.recorded_at)}</td><td class="num">${s.order_count}</td><td class="num">${money(s.net_total)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="note">No payouts have been recorded for this shop yet. A payout is recorded by Pick &amp; Drop after it pays the shop outside this app.</p>'}`;
}

function alertNew(ids) {
  const box = document.querySelector('#alert');
  if (!ids.length) return;
  box.hidden = false; box.className = 'alert alert-new';
  box.innerHTML = `<strong>${ids.length === 1 ? 'New order received' : ids.length + ' new orders received'}.</strong> Check the Active tab and accept or reject.`;
  document.title = `(${ids.length}) New order | Pick & Drop`;
  if (sound()) { try { const a = new AudioContext(), o = a.createOscillator(); o.connect(a.destination); o.frequency.value = 880; o.start(); o.stop(a.currentTime + 0.25); } catch { /* sound is optional */ } }
}

async function load() {
  if (loading || !merchant) return;
  loading = true;
  const mine = merchant.id;
  const { data: d, error } = await db.rpc('merchant_dashboard', { p_merchant_id: mine, p_limit: 100 });
  loading = false;
  if (mine !== merchant.id) return;                                   // the shop was switched while loading
  const err = document.querySelector('#loaderr');
  if (error || !d) {
    showError(err, data ? 'Could not refresh. Showing the last orders we loaded.' : 'Could not load orders.', load);
    if (!data) document.querySelector('#body').innerHTML = '';
    return;
  }
  err.hidden = true;
  const sig = JSON.stringify(d), changed = sig !== lastSig; lastSig = sig;
  data = d;
  const ids = new Set(d.orders.filter(o => o.status === 'PLACED').map(o => o.id));
  if (!firstLoad && seen) alertNew([...ids].filter(id => !seen.has(id)));
  seen = new Set([...(seen || []), ...ids]); firstLoad = false;
  if (!ids.size) document.title = 'Merchant dashboard | Pick & Drop';
  if (changed) draw();
}

function start(m) {
  stop?.(); merchant = m; data = null; lastSig = ''; seen = null; firstLoad = true;
  document.querySelector('#demo').hidden = m.status === 'ACTIVE';
  document.querySelector('#mname').textContent = m.name;
  document.querySelector('#body').innerHTML = spinner('Loading orders...');
  document.querySelector('#alert').hidden = true;
  load();
  stop = keepFresh({ name: 'm-' + m.id, table: 'orders', filter: `merchant_id=eq.${m.id}`, onChange: load,
    onStatus: st => { document.querySelector('#live').textContent = st === 'live' ? 'Live updates on' : 'Checking for new orders every 15 seconds'; } });
}

const user = await requireStaff(root);
if (user) {
  const { data: rows, error } = await db.from('merchant_staff').select('merchants(id,name,status)').eq('user_id', user.id);
  const ms = (rows || []).map(r => r.merchants).filter(Boolean);
  if (error) note(root, 'Could not check your shop access. Refresh to try again.');
  else if (!ms.length) root.innerHTML = `<div class="empty"><h2>This login is not linked to a shop</h2>
      <p>You are signed in as <strong>${esc(user.email || 'this account')}</strong>. Ask a Pick &amp; Drop admin to link this email to your shop (Admin, Merchants, open the shop, Logins).</p>
      <p class="note">If you expected access, check that you signed in with the same email the admin used.</p></div>`;
  else {
    root.innerHTML = `<div id="demo" class="banner" hidden>DEMO / NOT PARTNERED. This business has not agreed to use Pick &amp; Drop. Orders here are test orders.</div>
      <h2 id="mname"></h2>${ms.length > 1 ? `<label class="inline">Shop <select id="msel" aria-label="Shop">${ms.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('')}</select></label>` : ''}
      <p class="note"><span id="live">Connecting...</span> · <label class="inline"><input type="checkbox" id="snd" ${sound() ? 'checked' : ''}> Sound alert for new orders</label></p>
      <div id="alert" class="alert" role="alert" hidden></div><div id="loaderr" class="alert alert-bad" role="alert" hidden></div>
      <p class="error" id="msg" role="alert" hidden></p><div id="body"></div>
      <p class="note">Alerts appear on this page only. WhatsApp or SMS notifications are not set up yet.</p>`;
    document.querySelector('#msel')?.addEventListener('change', e => start(ms.find(m => m.id === e.target.value)));
    document.querySelector('#snd').addEventListener('change', e => { try { localStorage.setItem('pd_sound', e.target.checked ? '1' : '0'); } catch { /* storage unavailable */ } });
    root.addEventListener('click', async e => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; draw(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'REJECT' && !confirm('Reject this order? The customer will be told it was cancelled. A demo payment is reversed.')) return;
      b.disabled = true;
      const msg = document.querySelector('#msg');
      const ok = await callRpc('merchant_set_order_status', { p_order_id: b.dataset.id, p_action: b.dataset.act }, msg);
      if (ok) document.title = 'Merchant dashboard | Pick & Drop';
      await load();
      if (!ok) msg.hidden = false;
    });
    start(ms[0]);
  }
}
