import { db } from './supabase.js';
import { note, requireStaff, wireSignOut } from './ui.js';
import * as overview from './admin-overview.js';
import * as orders from './admin-orders.js';
import * as merchants from './admin-merchants.js';
import * as riders from './admin-riders.js';

const TABS = { overview, orders, merchants, riders };
const gate = document.querySelector('#gate'), app = document.querySelector('#app'), view = document.querySelector('#view');
const dlg = document.querySelector('#panel');
wireSignOut();

// Shared helpers for the section modules.
const ctx = {
  open(html) { const b = dlg.querySelector('.pbody'); b.innerHTML = html; if (!dlg.open) dlg.showModal(); return b; },
  close() { if (dlg.open) dlg.close(); },
  show(tab) { select(tab); },
  toast(el, msg, ok) { el.hidden = !msg; el.textContent = msg || ''; el.className = ok ? 'ok' : 'error'; },
};
document.querySelector('#pclose').addEventListener('click', () => ctx.close());

let current = 'overview';
function select(tab) {
  current = tab;
  document.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  view.innerHTML = '<p class="note">Loading...</p>';
  TABS[tab].render(view, ctx).catch(() => note(view, 'Could not load this section. Refresh to try again.'));
}
document.querySelector('.atabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (b) select(b.dataset.tab);
});

const user = await requireStaff(gate);
if (user) {
  // The server decides: admin_overview raises for anyone without the admin claim.
  const { error } = await db.rpc('admin_overview');
  if (error) note(gate, 'This page is for Pick & Drop admins only. If you were just made an admin, sign out and sign in again.');
  else { gate.hidden = true; app.hidden = false; select('overview'); }
}
