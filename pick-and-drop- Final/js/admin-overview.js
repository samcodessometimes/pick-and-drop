import { db } from './supabase.js';
import { esc, label } from './ui.js';

const sum = (rows, f) => rows.filter(f).reduce((n, r) => n + r.n, 0);
const stat = (title, total, demo) => `<div class="stat"><span>${esc(title)}</span><strong>${total}</strong>
  <small>Demo/test ${demo} · Live ${total - demo}</small></div>`;

export async function render(el) {
  const { data, error } = await db.rpc('admin_overview');
  if (error) { el.innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
  const o = data.orders, m = data.merchants, r = data.riders;
  const PEND = ['PENDING_PAYMENT', 'PLACED'], PROG = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP'];
  const cnt = (list) => [sum(o, x => list.includes(x.status)), sum(o, x => list.includes(x.status) && x.is_demo)];
  const all = [sum(o, () => true), sum(o, x => x.is_demo)];
  const liveOrders = all[0] - all[1], active = sum(m, x => x.status === 'ACTIVE'), realRiders = sum(r, x => !x.is_demo);
  const byStatus = ['DEMO', 'PENDING', 'ACTIVE', 'SUSPENDED'].map(s => `<li>${s}: <strong>${sum(m, x => x.status === s)}</strong></li>`).join('');
  el.innerHTML = `
    ${liveOrders === 0 && active === 0 ? '<div class="banner">No live operations yet. Every figure below comes from demo/test records.</div>' : ''}
    <h2>Orders</h2>
    <div class="stats">${stat('Total orders', all[0], all[1])}${stat('Pending', ...cnt(PEND))}${stat('In progress', ...cnt(PROG))}
      ${stat('Completed', ...cnt(['DELIVERED']))}${stat('Cancelled', ...cnt(['CANCELLED']))}</div>
    <h2>Merchants</h2>
    <div class="stats"><div class="stat"><span>Registered merchants</span><strong>${sum(m, () => true)}</strong>
      <small>${active} formally partnered (ACTIVE)</small></div>
      <div class="stat"><span>By status</span><ul class="plain">${byStatus}</ul></div>
      <div class="stat"><span>By type</span><ul class="plain"><li>Restaurants: <strong>${sum(m, x => x.type === 'RESTAURANT')}</strong></li>
      <li>Groceries: <strong>${sum(m, x => x.type === 'GROCERY')}</strong></li></ul></div></div>
    <h2>Riders</h2>
    <div class="stats"><div class="stat"><span>Registered riders</span><strong>${sum(r, () => true)}</strong>
      <small>Demo/test ${sum(r, x => x.is_demo)} · Real ${realRiders}</small></div>
      <div class="stat"><span>Availability</span><ul class="plain">${['AVAILABLE', 'BUSY', 'OFFLINE'].map(a => `<li>${label(a)}: <strong>${sum(r, x => x.availability === a)}</strong></li>`).join('')}</ul></div></div>
    <p class="note">Live means the order was placed with an ACTIVE partner merchant. Demo/test orders involve a merchant that has not formally partnered.</p>`;
}
