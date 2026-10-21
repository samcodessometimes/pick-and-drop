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

export const spinner = text => `<p class="loading" role="status"><span class="spin" aria-hidden="true"></span>${esc(text || 'Loading...')}</p>`;

// Keeps a dashboard fresh. Uses Supabase Realtime when it connects and ALWAYS polls as a safety net,
// so a blocked websocket never leaves a screen stale. Pauses polling while the tab is hidden and cleans up on exit.
// onStatus receives 'live' when Realtime is connected, otherwise 'polling'.
export function keepFresh({ name, table, filter, onChange, seconds = 15, onStatus }) {
  let stopped = false, ch = null;
  const tick = () => { if (!stopped && !document.hidden) onChange(); };
  const timer = setInterval(tick, seconds * 1000);
  const onVisible = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', onVisible);
  try {
    ch = db.channel(name).on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, payload => onChange(payload))
      .subscribe(st => onStatus?.(st === 'SUBSCRIBED' ? 'live' : 'polling'));
  } catch { onStatus?.('polling'); }
  const stop = () => {
    if (stopped) return; stopped = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible);
    try { if (ch) db.removeChannel(ch); } catch { /* already closed */ }
  };
  window.addEventListener('pagehide', stop);
  return stop;
}

// Shows an error with a Retry button without discarding what is already on screen.
export function showError(el, msg, retry) {
  el.hidden = false; el.className = 'alert alert-bad';
  el.innerHTML = `${esc(msg)} ${retry ? '<button type="button" class="linkbtn" data-retry>Try again</button>' : ''}`;
  el.querySelector('[data-retry]')?.addEventListener('click', retry);
}
export const timeAgo = d => {
  const m = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : fmtDate(d);
};
