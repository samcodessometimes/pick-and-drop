import { db } from './supabase.js';
import { esc, money, fmtDate, label, callRpc } from './ui.js';

const PAGE = 30;
const STATUSES = ['PENDING_PAYMENT', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'DELIVERED', 'CANCELLED'];
// Mirrors admin_set_order_status. The database enforces the real rules.
const NEXT = { PENDING_PAYMENT: ['CANCELLED'], PLACED: ['ACCEPTED', 'CANCELLED'], ACCEPTED: ['PREPARING', 'CANCELLED'],
               PREPARING: ['READY_FOR_PICKUP', 'CANCELLED'], READY_FOR_PICKUP: ['CANCELLED'] };
const REASSIGNABLE = ['UNASSIGNED', 'ASSIGNED', 'ACCEPTED', 'AT_MERCHANT'];

const row = o => {
  const p = o.payments?.[0];
  return `<article class="orow" tabindex="0" role="button" data-id="${esc(o.id)}" aria-label="Open order ${esc(o.order_number)}">
    <div><strong>#${esc(o.order_number)}</strong><small>${fmtDate(o.created_at)}</small></div>
    <div>${esc(o.merchants?.name)}${o.is_demo ? ' <span class="tag-demo">DEMO</span>' : ''}<small>${esc(o.contact_name)}</small></div>
    <div><strong>${money(o.total)}</strong><small>Payment: ${esc(label(p?.status || 'none'))}${p?.is_simulated ? ' (simulated)' : ''}</small></div>
    <div><span class="pill">${esc(label(o.status))}</span><small>Delivery: ${esc(label(o.delivery_status))}${o.riders ? ' · ' + esc(o.riders.display_name) : ''}</small></div></article>`;
};

export async function render(el, ctx) {
  const st = { status: '', q: '', demo: '', n: 0 };
  el.innerHTML = `<div class="filters"><input id="oq" type="search" placeholder="Search order reference, e.g. PD1024" aria-label="Search order reference">
    <select id="os" aria-label="Filter by status"><option value="">All statuses</option>${STATUSES.map(s => `<option value="${s}">${label(s)}</option>`).join('')}</select>
    <select id="od" aria-label="Demo or live"><option value="">Demo and live</option><option value="demo">Demo/test only</option><option value="live">Live only</option></select></div>
    <div id="olist"></div><p class="center"><button class="btn btn-ghost" id="more" hidden>Load more</button></p>`;
  const list = el.querySelector('#olist'), more = el.querySelector('#more');

  async function load(reset) {
    if (reset) { st.n = 0; list.innerHTML = ''; }
    let q = db.from('orders').select('id,order_number,created_at,status,delivery_status,total,is_demo,contact_name,merchants(name),payments(status,is_simulated),riders(display_name)')
      .order('created_at', { ascending: false }).range(st.n, st.n + PAGE - 1);
    if (st.status) q = q.eq('status', st.status);
    if (st.demo) q = q.eq('is_demo', st.demo === 'demo');
    const clean = st.q.replace(/[^A-Za-z0-9]/g, '');
    if (clean) q = q.ilike('order_number', `%${clean}%`);
    const { data, error } = await q;
    if (error) { list.innerHTML = '<p class="error">Could not load orders.</p>'; return; }
    list.insertAdjacentHTML('beforeend', data.map(row).join(''));
    st.n += data.length; more.hidden = data.length < PAGE;
    if (!list.children.length) list.innerHTML = `<p class="note">${st.q || st.status || st.demo ? 'No orders match these filters.' : 'No orders yet. Orders appear here when customers check out.'}</p>`;
  }

  let t;
  el.querySelector('#oq').addEventListener('input', e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); load(true); }, 300); });
  el.querySelector('#os').addEventListener('change', e => { st.status = e.target.value; load(true); });
  el.querySelector('#od').addEventListener('change', e => { st.demo = e.target.value; load(true); });
  more.addEventListener('click', () => load(false));
  const openRow = e => { const r = e.target.closest('[data-id]'); if (r) detail(r.dataset.id); };
  list.addEventListener('click', openRow);
  list.addEventListener('keydown', e => { if (e.key === 'Enter') openRow(e); });

  async function detail(id) {
    const [{ data: o, error }, { data: riders }, { data: pinState }] = await Promise.all([
      db.from('orders').select('*, merchants(name,status), order_items(name,quantity,unit_price,line_total), payments(method,status,provider_reference,is_simulated), riders(display_name), order_status_history(kind,status,note,created_at)').eq('id', id).maybeSingle(),
      db.from('riders').select('id,display_name,availability').neq('availability', 'OFFLINE').order('display_name'),
      db.from('order_delivery_pins').select('locked_at,failed_attempts,verified_at').eq('order_id', id).maybeSingle()]);
    if (error || !o) { ctx.open('<p class="error">Could not load this order.</p>'); return; }
    const p = o.payments?.[0], next = NEXT[o.status] || [];
    const canRider = REASSIGNABLE.includes(o.delivery_status) && !['DELIVERED', 'CANCELLED'].includes(o.status);
    const hist = [...o.order_status_history].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const body = ctx.open(`<h2>Order #${esc(o.order_number)} ${o.is_demo ? '<span class="tag-demo">DEMO</span>' : ''}</h2>
      <p class="note">${fmtDate(o.created_at)} · ${esc(o.merchants?.name)}${o.merchants?.status !== 'ACTIVE' ? ' (not a partner)' : ''}</p>
      <p><span class="pill">${esc(label(o.status))}</span> <span class="pill">Delivery: ${esc(label(o.delivery_status))}</span></p>
      <h3>Items</h3>${o.order_items.map(i => `<div class="item"><span>${i.quantity} x ${esc(i.name)}</span><span>${money(i.line_total)}</span></div>`).join('')}
      <dl class="totals"><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd><dt>Delivery</dt><dd>${money(o.delivery_fee)}</dd><dt>Total</dt><dd><strong>${money(o.total)}</strong></dd></dl>
      <h3>Delivery</h3><p><strong>${esc(o.contact_name)}</strong> · ${esc(o.contact_phone)}</p><p>${esc(o.address_line)}${o.landmark ? ' · ' + esc(o.landmark) : ''}</p>
      ${o.notes ? `<p class="inst">Note: ${esc(o.notes)}</p>` : ''}
      <h3>Payment</h3><p>${p ? `${esc(label(p.method))} · ${esc(label(p.status))}${p.is_simulated ? ' (simulated)' : ''} · ref ${esc(p.provider_reference)}` : 'No payment recorded'}</p>
      <p class="error" id="pmsg" role="alert" hidden></p>
      <h3>Rider</h3><p>${esc(o.riders?.display_name || 'Not assigned')}</p>
      ${canRider ? `<div class="actions"><select id="rsel" aria-label="Rider">${(riders || []).map(r => `<option value="${esc(r.id)}">${esc(r.display_name)} (${esc(label(r.availability))})</option>`).join('')}</select>
        <button class="btn btn-sm" id="rbtn">${o.rider_id ? 'Reassign' : 'Assign'}</button></div>${riders?.length ? '' : '<p class="note">No riders available. Add a test rider in the Riders tab.</p>'}` : ''}
      <h3>Status</h3>${next.length ? `<div class="actions"><select id="ssel" aria-label="New status">${next.map(s => `<option value="${s}">${label(s)}</option>`).join('')}</select>
        <input id="sreason" maxlength="200" placeholder="Reason (optional)" aria-label="Reason"><button class="btn btn-sm" id="sbtn">Update</button></div>`
        : '<p class="note">No admin status change is available for this order.</p>'}
      <p class="note">Delivered can only be set by the rider entering the customer PIN.</p>
      ${pinState?.locked_at && !pinState.verified_at ? `<p class="inst">The delivery PIN is locked after ${pinState.failed_attempts} wrong attempts.</p>
        <div class="actions"><button class="btn btn-sm btn-ghost" id="ubtn">Unlock PIN</button></div>` : ''}
      <h3>History</h3><ol class="hist">${hist.map(h => `<li>${fmtDate(h.created_at)} · ${esc(label(h.kind))}: <strong>${esc(label(h.status))}</strong>${h.note ? ` <em>(${esc(h.note)})</em>` : ''}</li>`).join('')}</ol>`);
    const msg = body.querySelector('#pmsg');
    const after = async ok => { if (ok) { await load(true); detail(id); } };
    body.querySelector('#rbtn')?.addEventListener('click', async e => {
      e.target.disabled = true;
      after(await callRpc('admin_assign_rider', { p_order_id: id, p_rider_id: body.querySelector('#rsel').value }, msg));
      e.target.disabled = false;
    });
    body.querySelector('#ubtn')?.addEventListener('click', async e => {
      if (!confirm('Unlock the delivery PIN so the rider can try again?')) return;
      e.target.disabled = true;
      after(await callRpc('admin_unlock_delivery_pin', { p_order_id: id }, msg));
      e.target.disabled = false;
    });
    body.querySelector('#sbtn')?.addEventListener('click', async e => {
      const s = body.querySelector('#ssel').value;
      if (s === 'CANCELLED' && !confirm('Cancel this order? Simulated payments are marked refunded.')) return;
      e.target.disabled = true;
      after(await callRpc('admin_set_order_status', { p_order_id: id, p_status: s, p_reason: body.querySelector('#sreason').value }, msg));
      e.target.disabled = false;
    });
  }
  await load(true);
}
