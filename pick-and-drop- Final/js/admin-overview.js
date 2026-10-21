import { db } from './supabase.js';
import { esc, label, money, spinner, showError } from './ui.js';

const sum = (rows, f) => rows.filter(f).reduce((n, r) => n + r.n, 0);
const card = (title, v, hint = '', cls = '') => `<div class="stat ${cls}"><span>${esc(title)}</span><strong>${v.demo + v.live}</strong>
  <small>Demo/test ${v.demo} · Live ${v.live}</small>${hint ? `<small>${esc(hint)}</small>` : ''}</div>`;
const zero = { demo: 0, live: 0 };

function setupPanel(s) {
  const row = (ok, text) => `<li class="${ok ? 'ok-row' : 'warn-row'}"><span aria-hidden="true">${ok ? '✔' : '!'}</span> ${text}</li>`;
  return `<section class="setup" aria-label="Setup check"><h2>Setup check</h2>
    <p class="note">Every figure on this page comes from the database. If something below is missing, that is why a screen looks empty.</p>
    <ul class="plain checks">
      ${row(s.visible_merchants > 0, `${s.visible_merchants} shop${s.visible_merchants === 1 ? '' : 's'} visible to customers (${s.merchants} registered). ${s.visible_merchants ? '' : 'Run db/dev/demo_seed.sql or add a merchant.'}`)}
      ${row(s.merchants_with_menu > 0, `${s.merchants_with_menu} shop${s.merchants_with_menu === 1 ? '' : 's'} with a menu or product list. ${s.merchants_with_menu ? '' : 'Customers cannot order until a shop has products.'}`)}
      ${row(s.merchants_with_login > 0, `${s.merchants_with_login} shop${s.merchants_with_login === 1 ? '' : 's'} with a merchant login linked. ${s.merchants_with_login ? '' : 'Merchants cannot see orders until you link a login (Merchants tab, Logins).'}`)}
      ${row(s.riders_with_login > 0, `${s.riders_with_login} of ${s.riders} rider${s.riders === 1 ? '' : 's'} with a login linked, ${s.riders_available} available. ${s.riders_with_login ? '' : 'Riders cannot sign in until you link a login (Riders tab, Link login).'}`)}
      ${row(s.orders > 0, `${s.orders} order${s.orders === 1 ? '' : 's'} placed so far. ${s.orders ? '' : 'Nothing to show yet. Place a demo order as a customer and it appears here.'}`)}
      ${row(!!s.terms_set, s.terms_set ? 'Commission and rider pay are set.' : 'Commission and rider pay are not decided. Settlement amounts stay as pending until you set them (Payments tab).')}
    </ul></section>`;
}

export async function render(el, ctx) {
  el.innerHTML = spinner('Loading overview...');
  const [{ data, error }, { data: setup }] = await Promise.all([db.rpc('admin_overview'), db.rpc('admin_setup_status')]);
  if (error) { el.innerHTML = '<div id="oerr"></div>'; showError(el.querySelector('#oerr'), error.message, () => ctx.show('overview')); return; }
  const o = data.orders, m = data.merchants, r = data.riders, ops = data.ops || {}, pay = data.payments || [], st = data.settlements || {};
  const g = k => ops[k] || zero;
  const liveOrders = sum(o, x => !x.is_demo), active = sum(m, x => x.status === 'ACTIVE');
  const pays = f => pay.filter(f).reduce((n, p) => n + p.n, 0);
  const owed = (st.merchant_owed || []).reduce((a, x) => { a[x.is_demo ? 'demo' : 'live'] = x; return a; }, {});
  const amt = k => owed[k] ? money(owed[k].amount) : money(0);
  const rOwed = (st.rider_owed || []).reduce((a, x) => { a[x.is_demo ? 'demo' : 'live'] = x; return a; }, {});
  el.innerHTML = `
    ${liveOrders === 0 && active === 0 ? '<div class="banner">No live operations yet. Every figure below comes from demo/test records.</div>' : ''}
    ${setup ? setupPanel(setup) : ''}
    <h2>Orders</h2>
    <div class="stats">${card('Total orders', g('total'))}${card('New, awaiting the shop', g('awaiting_merchant'), 'Shop has not accepted yet', g('awaiting_merchant').demo + g('awaiting_merchant').live ? 'stat-alert' : '')}
      ${card('Accepted or preparing', g('accepted_preparing'))}${card('Ready for pickup', g('ready_for_pickup'))}
      ${card('Awaiting a rider', g('awaiting_rider'), 'Accepted by the shop, no rider yet', g('awaiting_rider').demo + g('awaiting_rider').live ? 'stat-alert' : '')}
      ${card('Active deliveries', g('active_deliveries'))}${card('Completed', g('completed'))}${card('Rejected or cancelled', g('cancelled'))}
      ${card('Delayed', g('delayed'), 'See the rules below', g('delayed').demo + g('delayed').live ? 'stat-alert' : '')}</div>
    <p class="note">Delayed means: a new order waiting more than 10 minutes for the shop, an order ready for pickup for more than 15 minutes, or a delivery in progress for more than 90 minutes.</p>
    <h2>Payments</h2>
    <div class="stats">
      <div class="stat"><span>Pending confirmation</span><strong>${pays(p => p.status === 'PENDING')}</strong><small>Includes cash on delivery not yet collected</small></div>
      <div class="stat"><span>Confirmed</span><strong>${pays(p => p.status === 'PAID')}</strong><small>Cash collected or provider verified</small></div>
      <div class="stat"><span>Demo payments</span><strong>${pays(p => p.status === 'SIMULATED')}</strong><small>No real money involved</small></div>
      <div class="stat"><span>Failed, cancelled or refunded</span><strong>${pays(p => ['FAILED', 'CANCELLED', 'REFUNDED'].includes(p.status))}</strong></div></div>
    <h2>Settlements outstanding</h2>
    <div class="stats">
      <div class="stat"><span>Owed to shops</span><strong>${money((owed.live?.amount || 0) + (owed.demo?.amount || 0))}</strong><small>Demo ${amt('demo')} · Live ${amt('live')}</small></div>
      <div class="stat"><span>Owed to riders</span><strong>${money((rOwed.live?.amount || 0) + (rOwed.demo?.amount || 0))}</strong><small>Demo ${money(rOwed.demo?.amount || 0)} · Live ${money(rOwed.live?.amount || 0)}</small></div>
      <div class="stat"><span>Waiting for terms</span><strong>${st.pending_terms || 0}</strong><small>Delivered orders with no commission or rider pay set</small></div></div>
    <p class="note">Owed means money Pick &amp; Drop still has to pay out. Nothing here moves money. A payout is recorded in the Payments tab after you pay outside the app.</p>
    <h2>Merchants and riders</h2>
    <div class="stats"><div class="stat"><span>Registered merchants</span><strong>${sum(m, () => true)}</strong><small>${active} formally partnered (ACTIVE)</small></div>
      <div class="stat"><span>By status</span><ul class="plain">${['DEMO', 'PENDING', 'ACTIVE', 'SUSPENDED'].map(s => `<li>${s}: <strong>${sum(m, x => x.status === s)}</strong></li>`).join('')}</ul></div>
      <div class="stat"><span>Registered riders</span><strong>${sum(r, () => true)}</strong><small>Demo/test ${sum(r, x => x.is_demo)} · Real ${sum(r, x => !x.is_demo)}</small></div>
      <div class="stat"><span>Rider availability</span><ul class="plain">${['AVAILABLE', 'BUSY', 'OFFLINE'].map(a => `<li>${label(a)}: <strong>${sum(r, x => x.availability === a)}</strong></li>`).join('')}</ul></div></div>
    <p class="note">Live means the order was placed with an ACTIVE partner merchant. Demo/test orders involve a merchant that has not formally partnered.</p>`;
}
