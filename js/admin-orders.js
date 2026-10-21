import { db } from './supabase.js';
import { esc, money, fmtDate, label, callRpc, spinner, showError, timeAgo } from './ui.js';
import { ORDER_LABEL, DELIVERY_LABEL, METHOD_LABEL, SETTLEMENT_LABEL, RIDER_PAY_LABEL, payInfo } from './status.js';

const PAGE = 30;
const STATUSES = ['PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED'];
// Mirrors admin_set_order_status. The database enforces the real rules.
const NEXT = { PENDING_PAYMENT: ['CANCELLED'], PLACED: ['ACCEPTED', 'CANCELLED'], ACCEPTED: ['PREPARING', 'CANCELLED'],
               PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'], READY_FOR_PICKUP: ['CANCELLED'] };
const REASSIGNABLE = ['UNASSIGNED', 'ASSIGNED', 'ACCEPTED', 'AT_MERCHANT'];
const OUT = ['PICKED_UP', 'ON_THE_WAY', 'AT_CUSTOMER'];
// Same rules as the overview cards (see admin_overview in migration 06).
const DELAY = { PLACED: 10, READY: 15, DELIVERY: 90 };
const isDelayed = o => {
  const mins = (Date.now() - new Date(o.status_changed_at).getTime()) / 60000;
  if (o.status === 'PLACED') return mins > DELAY.PLACED;
  if (o.status === 'READY_FOR_PICKUP' && !OUT.includes(o.delivery_status)) return mins > DELAY.READY;
  return !['DELIVERED', 'CANCELLED'].includes(o.status) && OUT.includes(o.delivery_status) && mins > DELAY.DELIVERY;
};
const FILTERS = { '': 'Everything', awaiting_merchant: 'New, awaiting the shop', awaiting_rider: 'Awaiting a rider', delayed: 'Delayed',
  active: 'Active deliveries', payment_pending: 'Payment pending' };

const row = o => {
  const p = o.payments?.[0], pi = payInfo(p);
  return `<article class="orow" tabindex="0" role="button" data-id="${esc(o.id)}" aria-label="Open order ${esc(o.order_number)}">
    <div><strong>#${esc(o.order_number)}</strong><small>${fmtDate(o.created_at)}</small></div>
    <div>${esc(o.merchants?.name)}${o.is_demo ? ' <span class="tag-demo">DEMO</span>' : ''}<small>${esc(o.contact_name)}</small></div>
    <div><strong>${money(o.total)}</strong><small><span class="badge badge-${pi.tone}">${esc(pi.text)}</span></small></div>
    <div><span class="pill">${esc(ORDER_LABEL[o.status] || label(o.status))}</span>${isDelayed(o) ? ' <span class="tag-late">Delayed</span>' : ''}
      <small>${esc(DELIVERY_LABEL[o.delivery_status] || label(o.delivery_status))}${o.riders ? ' · ' + esc(o.riders.display_name) : ''}</small></div></article>`;
};

export async function render(el, ctx) {
  const st = { status: '', q: '', demo: '', focus: '', n: 0 };
  el.innerHTML = `<div class="filters"><input id="oq" type="search" placeholder="Search order reference, e.g. PD1024" aria-label="Search order reference">
    <select id="of" aria-label="Needs attention">${Object.entries(FILTERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
    <select id="os" aria-label="Filter by status"><option value="">All statuses</option>${STATUSES.map(s => `<option value="${s}">${ORDER_LABEL[s]}</option>`).join('')}</select>
    <select id="od" aria-label="Demo or live"><option value="">Demo and live</option><option value="demo">Demo/test only</option><option value="live">Live only</option></select></div>
    <div id="oerr" hidden></div><div id="olist">${spinner('Loading orders...')}</div><p class="center"><button class="btn btn-ghost" id="more" hidden>Load more</button></p>`;
  const list = el.querySelector('#olist'), more = el.querySelector('#more'), errEl = el.querySelector('#oerr');

  async function load(reset) {
    if (reset) { st.n = 0; list.innerHTML = spinner('Loading orders...'); }
    const ago = m => new Date(Date.now() - m * 60000).toISOString();
    const inner = st.focus === 'payment_pending' ? 'payments!inner' : 'payments';
    let q = db.from('orders').select(`id,order_number,created_at,status,delivery_status,status_changed_at,total,is_demo,contact_name,merchants(name),${inner}(method,status,is_simulated,note),riders(display_name)`)
      .order('created_at', { ascending: false }).range(st.n, st.n + PAGE - 1);
    if (st.status) q = q.eq('status', st.status);
    if (st.demo) q = q.eq('is_demo', st.demo === 'demo');
    if (st.focus === 'awaiting_merchant') q = q.eq('status', 'PLACED');
    if (st.focus === 'awaiting_rider') q = q.in('status', ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']).eq('delivery_status', 'UNASSIGNED');
    if (st.focus === 'active') q = q.in('delivery_status', ['ACCEPTED', 'AT_MERCHANT', 'PICKED_UP', 'ON_THE_WAY', 'AT_CUSTOMER']).not('status', 'in', '(DELIVERED,CANCELLED)');
    if (st.focus === 'payment_pending') q = q.eq('payments.status', 'PENDING').not('status', 'in', '(CANCELLED)');
    if (st.focus === 'delayed') q = q.or(`and(status.eq.PLACED,status_changed_at.lt.${ago(DELAY.PLACED)}),and(status.eq.READY_FOR_PICKUP,delivery_status.in.(UNASSIGNED,ASSIGNED,ACCEPTED,AT_MERCHANT),status_changed_at.lt.${ago(DELAY.READY)}),and(delivery_status.in.(PICKED_UP,ON_THE_WAY,AT_CUSTOMER),status_changed_at.lt.${ago(DELAY.DELIVERY)})`);
    const clean = st.q.replace(/[^A-Za-z0-9]/g, '');
    if (clean) q = q.ilike('order_number', `%${clean}%`);
    const { data, error } = await q;
    if (error) { list.innerHTML = ''; showError(errEl, 'Could not load orders.', () => load(true)); return; }
    errEl.hidden = true;
    if (reset) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', data.map(row).join(''));
    st.n += data.length; more.hidden = data.length < PAGE;
    if (!list.children.length) list.innerHTML = `<div class="empty"><p><strong>${st.q || st.status || st.demo || st.focus ? 'No orders match these filters.' : 'No orders yet.'}</strong></p>
      ${st.q || st.status || st.demo || st.focus ? '' : '<p class="note">Orders appear here when customers check out. To see one now, place a demo order from the customer home page.</p>'}</div>`;
  }

  let t;
  el.querySelector('#oq').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); load(true); }, 300); });
  el.querySelector('#os').addEventListener('change', e => { st.status = e.target.value; load(true); });
  el.querySelector('#od').addEventListener('change', e => { st.demo = e.target.value; load(true); });
  el.querySelector('#of').addEventListener('change', e => { st.focus = e.target.value; load(true); });
  more.addEventListener('click', () => load(false));
  const openRow = e => { const r = e.target.closest('[data-id]'); if (r) detail(r.dataset.id); };
  list.addEventListener('click', openRow);
  list.addEventListener('keydown', e => { if (e.key === 'Enter') openRow(e); });

  const one = x => (Array.isArray(x) ? x[0] : x) || null;

  async function detail(id) {
    const [{ data: o, error }, { data: riders }, { data: pinState }] = await Promise.all([
      db.from('orders').select('*, merchants(name,status), order_items(name,quantity,unit_price,line_total), payments(method,status,provider_reference,is_simulated,note,confirmed_at), riders(display_name), order_financials(commission_bps,merchant_commission,merchant_net,rider_pay,platform_revenue,settlement_status,rider_pay_status), order_status_history(kind,status,note,created_at)').eq('id', id).maybeSingle(),
      db.rpc('admin_rider_load'),
      db.from('order_delivery_pins').select('locked_at,failed_attempts,verified_at').eq('order_id', id).maybeSingle()]);
    if (error || !o) { ctx.open('<p class="error">Could not load this order. It may have been removed. Close this and refresh the list.</p>'); return; }
    const p = o.payments?.[0], pi = payInfo(p), f = one(o.order_financials), next = NEXT[o.status] || [];
    const canRider = REASSIGNABLE.includes(o.delivery_status) && !['DELIVERED', 'CANCELLED'].includes(o.status);
    const hist = [...o.order_status_history].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const assigned = [...hist].reverse().find(h => h.kind === 'DELIVERY' && h.status === 'ASSIGNED');
    const cod = p?.method === 'CASH_ON_DELIVERY', canCash = cod && p.status === 'PENDING' && OUT.includes(o.delivery_status) && !['DELIVERED', 'CANCELLED'].includes(o.status);
    const canFail = p?.status === 'PENDING' && o.status !== 'CANCELLED';
    const choices = (riders || []).filter(r => r.id !== o.rider_id);
    const finRow = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
    const body = ctx.open(`<h2>Order #${esc(o.order_number)} ${o.is_demo ? '<span class="tag-demo">DEMO</span>' : ''}</h2>
      <p class="note">${fmtDate(o.created_at)} · ${esc(o.merchants?.name)}${o.merchants?.status !== 'ACTIVE' ? ' (not a partner)' : ''}</p>
      <p><span class="pill">${esc(ORDER_LABEL[o.status] || label(o.status))}</span> <span class="pill">Delivery: ${esc(DELIVERY_LABEL[o.delivery_status] || label(o.delivery_status))}</span>${isDelayed(o) ? ' <span class="tag-late">Delayed</span>' : ''}</p>
      <h3>Items</h3>${o.order_items.map(i => `<div class="item"><span>${i.quantity} x ${esc(i.name)} <small>(${money(i.unit_price)} each)</small></span><span>${money(i.line_total)}</span></div>`).join('')}
      <dl class="totals"><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd><dt>Delivery</dt><dd>${money(o.delivery_fee)}</dd><dt>Total</dt><dd><strong>${money(o.total)}</strong></dd></dl>
      <h3>Delivery</h3><p><strong>${esc(o.contact_name)}</strong> · ${esc(o.contact_phone)}</p><p>${esc(o.address_line)}${o.landmark ? ' · ' + esc(o.landmark) : ''}</p>
      ${o.notes ? `<p class="inst">Note: ${esc(o.notes)}</p>` : ''}
      <h3>Payment</h3>
      ${p ? `<p><span class="badge badge-${pi.tone}">${esc(pi.text)}</span> ${esc(METHOD_LABEL[p.method] || p.method)}</p><p class="note">${esc(pi.detail)}</p>
        ${p.provider_reference ? `<p class="note">Reference ${esc(p.provider_reference)}${p.is_simulated ? ' (demo reference, not verified)' : ''}</p>` : ''}`
        : '<p>No payment recorded</p>'}
      <div class="actions">${canCash ? '<button class="btn btn-sm" id="cashbtn">Record cash collected</button>' : ''}${canFail ? '<button class="btn btn-sm btn-ghost" id="failbtn">Mark payment failed</button>' : ''}</div>
      <p class="error" id="pmsg" role="alert" hidden></p>
      <h3>Money</h3>${f ? `<dl class="totals">${finRow('Shop subtotal', money(o.subtotal))}
        ${finRow('Pick &amp; Drop commission', f.commission_bps == null ? 'Not decided yet' : `${money(f.merchant_commission)} (${(f.commission_bps / 100)}%)`)}
        ${finRow('Owed to the shop', f.merchant_net == null ? 'Not decided yet' : money(f.merchant_net))}
        ${finRow('Rider pay', f.rider_pay == null ? 'Not decided yet' : money(f.rider_pay))}
        ${finRow('Pick &amp; Drop revenue', f.platform_revenue == null ? 'Known after delivery, once terms are set' : money(f.platform_revenue))}
        ${finRow('Shop settlement', esc(SETTLEMENT_LABEL[f.settlement_status] || f.settlement_status))}${finRow('Rider payment', esc(RIDER_PAY_LABEL[f.rider_pay_status] || f.rider_pay_status))}</dl>` : '<p class="note">No money record yet.</p>'}
      <h3>Rider</h3><p>${esc(o.riders?.display_name || 'Not assigned')}${assigned && o.riders ? ` <small class="note">assigned ${esc(timeAgo(assigned.created_at))}</small>` : ''}</p>
      ${canRider ? `<div class="actions"><select id="rsel" aria-label="Rider">${choices.map(r => `<option value="${esc(r.id)}" ${r.eligible ? '' : 'disabled'}>${esc(r.display_name)} (${r.availability === 'OFFLINE' ? 'offline' : r.active_orders + ' active'}${r.eligible ? '' : ', not eligible'})</option>`).join('')}</select>
        <button class="btn btn-sm" id="rbtn" ${choices.some(r => r.eligible) ? '' : 'disabled'}>${o.rider_id ? 'Reassign' : 'Assign'}</button></div>
        ${choices.some(r => r.eligible) ? '<p class="note">Only riders who are online and have fewer than 2 active orders can be chosen.</p>' : '<p class="note">No eligible rider. Set a rider to Available in the Riders tab, or add a test rider.</p>'}` : (o.rider_id && !['DELIVERED', 'CANCELLED'].includes(o.status) ? '<p class="note">The rider has already collected this order, so it can no longer be reassigned.</p>' : '')}
      <h3>Status</h3>${next.length ? `<div class="actions"><select id="ssel" aria-label="New status">${next.map(s => `<option value="${s}">${ORDER_LABEL[s]}</option>`).join('')}</select>
        <input id="sreason" maxlength="200" placeholder="Reason (optional)" aria-label="Reason"><button class="btn btn-sm" id="sbtn">Update</button></div>`
        : '<p class="note">No admin status change is available for this order.</p>'}
      <p class="note">Delivered can only be set by the rider entering the customer PIN${cod ? ', after the cash is recorded' : ''}.</p>
      ${pinState?.locked_at && !pinState.verified_at ? `<p class="inst">The delivery PIN is locked after ${pinState.failed_attempts} wrong attempts.</p>
        <div class="actions"><button class="btn btn-sm btn-ghost" id="ubtn">Unlock PIN</button></div>` : ''}
      <h3>History</h3><ol class="hist">${hist.map(h => `<li>${fmtDate(h.created_at)} · ${esc(label(h.kind))}: <strong>${esc((h.kind === 'ORDER' ? ORDER_LABEL : DELIVERY_LABEL)[h.status] || label(h.status))}</strong>${h.note ? ` <em>(${esc(h.note)})</em>` : ''}</li>`).join('')}</ol>`);
    const msg = body.querySelector('#pmsg');
    // After any action the list and this panel are reloaded, so a change made by someone else shows up too.
    const after = async () => { await load(true); detail(id); };
    const run = (btn, name, args) => btn?.addEventListener('click', async e => {
      const b = e.target; b.disabled = true;
      const res = await callRpc(name, typeof args === 'function' ? args() : args, msg);
      if (res) after(); else { b.disabled = false; }
    });
    run(body.querySelector('#rbtn'), 'admin_assign_rider', () => ({ p_order_id: id, p_rider_id: body.querySelector('#rsel').value }));
    run(body.querySelector('#cashbtn'), 'record_cash_collected', () => ({ p_order_id: id }));
    body.querySelector('#failbtn')?.addEventListener('click', async e => {
      const reason = prompt('Why did the payment fail? (shown in the record)') ; if (reason === null) return;
      e.target.disabled = true;
      const res = await callRpc('admin_set_payment_status', { p_order_id: id, p_status: 'FAILED', p_reason: reason }, msg);
      if (res) after(); else e.target.disabled = false;
    });
    body.querySelector('#ubtn')?.addEventListener('click', async e => {
      if (!confirm('Unlock the delivery PIN so the rider can try again?')) return;
      e.target.disabled = true;
      const res = await callRpc('admin_unlock_delivery_pin', { p_order_id: id }, msg);
      if (res) after(); else e.target.disabled = false;
    });
    body.querySelector('#sbtn')?.addEventListener('click', async e => {
      const s = body.querySelector('#ssel').value;
      if (s === 'CANCELLED' && !confirm('Cancel this order? A demo payment is marked refunded. A real confirmed payment must be refunded through the payment provider.')) return;
      e.target.disabled = true;
      const res = await callRpc('admin_set_order_status', { p_order_id: id, p_status: s, p_reason: body.querySelector('#sreason').value }, msg);
      if (res) after(); else e.target.disabled = false;
    });
  }
  await load(true);
}
