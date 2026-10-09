import { db, configured } from './supabase.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => 'NLe ' + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 });
export const note = (el, msg) => { el.innerHTML = `<p class="note">${esc(msg)}</p>`; };

// Redirects to login unless a real (non-anonymous) session exists.
// This is a convenience only. Access is enforced by RLS and the SQL functions.
export async function requireStaff(root) {
  if (!configured) { note(root, 'Supabase is not connected yet. Add your keys in js/config.js.'); return null; }
  const { data: { session } } = await db.auth.getSession();
  const u = session?.user;
  if (!u || u.is_anonymous) {
    location.replace('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || ''));
    return null;
  }
  return u;
}

export function wireSignOut() {
  document.querySelector('#signout')?.addEventListener('click', async () => {
    await db?.auth.signOut();
    location.href = 'login.html';
  });
}

export async function callRpc(name, args, msgEl) {
  const { data, error } = await db.rpc(name, args);
  if (msgEl) { msgEl.className = 'error'; msgEl.hidden = !error; msgEl.textContent = error ? error.message : ''; }
  return error ? null : data;
}

export const fmtDate = d => new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
export const label = s => String(s ?? '').replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
