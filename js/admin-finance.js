import { db } from './supabase.js';
import { esc, money, fmtDate, callRpc, spinner, showError } from './ui.js';

// Payments tab: commercial settings, amounts owed, and records of payouts made outside the app.
// Nothing here moves money. It records what is owed and what an admin says they paid.
const demoTag = d => (d ? ' <span class="tag-demo">DEMO</span>' : '');

export async function render(el, ctx) {
  el.innerHTML = spinner('Loading payments and settlements...');
  const { data: d, error } = await db.rpc('admin_finance_summary');
  if (error) { el.innerHTML = '<div id="ferr"></div>'; showError(el.querySelector('#ferr'), error.message, () => ctx.show('finance')); return; }
  const s = d.settings || {};
  const bps = s.merchant_commission_bps, pay = s.rider_pay_per_delivery;

  const merchantRows = d.merchants.length ? `<table class="lines"><thead><tr><th>Shop</th><th class="num">Orders owed</th><th class="num">Sales</th><th class="num">Commission</th><th class="num">Owed to shop</th><th class="num">Already settled</th><th></th></tr></thead><tbody>
    ${d.merchants.map(m => `<tr><td>${esc(m.name)}${demoTag(m.is_demo)}${m.pending_terms_orders ? `<small class="note"> ${m.pending_terms_orders} waiting for terms</small>` : ''}</td>
      <td class="num">${m.owed_orders}</td><td class="num">${money(m.gross)}</td><td class="num">${money(m.commission)}</td><td class="num"><strong>${money(m.net_owed)}</strong></td><td class="num">${money(m.net_settled)}</td>
      <td>${m.owed_orders ? `<button class="btn btn-sm" data-mset="${esc(m.merchant_id)}" data-demo="${m.is_demo}" data-name="${esc(m.name)}" data-amount="${m.net_owed}">Record payout</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty"><p><strong>Nothing to settle yet.</strong></p><p class="note">Amounts appear here once an order is delivered and its payment is confirmed (cash collected) or is a demo payment.</p></div>';

  const riderRows = d.riders.length ? `<table class="lines"><thead><tr><th>Rider</th><th class="num">Deliveries owed</th><th class="num">Owed</th><th class="num">Already paid</th><th></th></tr></thead><tbody>
    ${d.riders.map(r => `<tr><td>${esc(r.display_name)}${demoTag(r.is_demo)}${r.pending_terms_deliveries ? `<small class="note"> ${r.pending_terms_deliveries} waiting for terms</small>` : ''}</td>
      <td class="num">${r.owed_deliveries}</td><td class="num"><strong>${money(r.owed)}</strong></td><td class="num">${money(r.paid)}</td>
      <td>${r.owed_deliveries ? `<button class="btn btn-sm" data-rset="${esc(r.rider_id)}" data-demo="${r.is_demo}" data-name="${esc(r.display_name)}" data-amount="${r.owed}">Record payout</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<p class="note">No rider payments to show yet.</p>';

  const rev = d.platform_revenue.length ? d.platform_revenue.map(r => `<li>${r.is_demo ? 'Demo/test' : 'Live'}: <strong>${money(r.revenue)}</strong> from ${r.orders} order${r.orders === 1 ? '' : 's'}</li>`).join('')
    : '<li>Not available until terms are set and an order is delivered and paid.</li>';

  el.innerHTML = `
    <div class="banner">Records only. This screen does not send money. "Record payout" notes that you already paid outside the app (for example by bank or mobile money transfer).</div>
    <h2>Commercial terms</h2>
    <p class="note">${bps == null || pay == null ? 'Not decided yet. Until both are set, delivered orders show their settlement as "waiting for terms" and no revenue is calculated.' : 'These terms are applied to orders when they become owed. Orders already owed keep the terms they had.'}</p>
    <form id="tf" class="inline-form" novalidate>
      <label>Commission charged to shops (%)<input name="pct" type="number" min="0" max="50" step="0.01" value="${bps == null ? '' : bps / 100}" placeholder="Not decided"></label>
      <label>Rider pay per delivery (NLe)<input name="rider" type="number" min="0" step="0.01" value="${pay ?? ''}" placeholder="Not decided"></label>
      <label>Note (optional)<input name="note" maxlength="500" value="${esc(s.terms_note ?? '')}"></label>
      <p class="note">Leave a field empty to keep it "not decided". Assumption in these figures: the delivery fee is kept by Pick &amp; Drop and the rider pay is paid out of it. Confirm this before real use.</p>
      <p class="error" id="tmsg" role="alert" hidden></p><button class="btn btn-sm">Save terms</button></form>
    <h2>Owed to shops</h2>${merchantRows}
    <h2>Owed to riders</h2>${riderRows}
    <h2>Pick &amp; Drop revenue</h2><ul class="plain">${rev}</ul>
    <h2>Payouts recorded</h2>
    ${d.recent_merchant_settlements.length ? `<table class="lines"><thead><tr><th>Reference</th><th>Shop</th><th>Recorded</th><th class="num">Orders</th><th class="num">Amount</th></tr></thead><tbody>${d.recent_merchant_settlements.map(x =>
      `<tr><td>${esc(x.reference)}${demoTag(x.is_demo)}</td><td>${esc(x.name)}</td><td>${fmtDate(x.recorded_at)}</td><td class="num">${x.order_count}</td><td class="num">${money(x.net_total)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">No shop payouts recorded yet.</p>'}
    ${d.recent_rider_payouts.length ? `<table class="lines"><thead><tr><th>Reference</th><th>Rider</th><th>Recorded</th><th class="num">Deliveries</th><th class="num">Amount</th></tr></thead><tbody>${d.recent_rider_payouts.map(x =>
      `<tr><td>${esc(x.reference)}${demoTag(x.is_demo)}</td><td>${esc(x.display_name)}</td><td>${fmtDate(x.recorded_at)}</td><td class="num">${x.delivery_count}</td><td class="num">${money(x.total)}</td></tr>`).join('')}</tbody></table>` : '<p class="note">No rider payouts recorded yet.</p>'}`;

  el.querySelector('#tf').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.target), msg = el.querySelector('#tmsg'), btn = e.target.querySelector('button'); btn.disabled = true;
    const pct = String(fd.get('pct')).trim(), rider = String(fd.get('rider')).trim();
    const ok = await callRpc('admin_save_settings', { p_commission_bps: pct === '' ? null : Math.round(Number(pct) * 100), p_rider_pay: rider === '' ? null : Number(rider), p_note: fd.get('note') }, msg);
    btn.disabled = false; if (ok) ctx.show('finance');
  });

  const payout = (kind, b) => {
    const rpc = kind === 'm' ? 'admin_record_merchant_settlement' : 'admin_record_rider_payout';
    const body = ctx.open(`<h2>Record payout${b.dataset.demo === 'true' ? ' (demo)' : ''}</h2>
      <p><strong>${esc(b.dataset.name)}</strong>: ${money(b.dataset.amount)}</p>
      <p class="note">${b.dataset.demo === 'true' ? 'These are demo orders. Recording this moves no money and is only for demonstration.' : 'Only record this after you have actually paid this amount outside the app.'} Recording marks every order currently owed as settled.</p>
      <form id="pf"><label>Payment reference (bank or mobile money transaction ID)<input name="ref" required minlength="3" maxlength="60"></label>
      <label>Note (optional)<input name="note" maxlength="300"></label>
      <p class="error" id="pmsg" role="alert" hidden></p><button class="btn btn-block" style="width:100%">Record that I paid this</button></form>`);
    body.querySelector('#pf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target), btn = e.target.querySelector('button'); btn.disabled = true;
      const args = kind === 'm' ? { p_merchant_id: b.dataset.mset, p_is_demo: b.dataset.demo === 'true', p_reference: fd.get('ref'), p_note: fd.get('note') }
                                : { p_rider_id: b.dataset.rset, p_is_demo: b.dataset.demo === 'true', p_reference: fd.get('ref'), p_note: fd.get('note') };
      const ok = await callRpc(rpc, args, body.querySelector('#pmsg'));
      btn.disabled = false; if (ok) { ctx.close(); ctx.show('finance'); }
    });
  };
  el.addEventListener('click', e => {
    const m = e.target.closest('[data-mset]'), r = e.target.closest('[data-rset]');
    if (m) payout('m', m); else if (r) payout('r', r);
  });
}
