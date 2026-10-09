// Test replacement for js/supabase.js. Uses the real supabase-js client for from() and rpc() against
// PostgREST, with the JWT of whichever test user is "signed in". Auth (GoTrue) and Realtime are faked.
import { createClient } from '@supabase/supabase-js';

export const configured = true;
const log = (globalThis.__REQ__ ||= []);
const client = createClient(globalThis.__API__, 'unused-anon-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: (url, opts = {}) => {
      const h = new Headers(opts.headers);
      h.set('Authorization', 'Bearer ' + (globalThis.__TOKEN__ || globalThis.__ANON_JWT__));
      const u = String(url).replace('/rest/v1', '');   // Supabase serves PostgREST under /rest/v1, the standalone test server does not
      log.push({ method: opts.method || 'GET', url: u });
      return fetch(u, { ...opts, headers: h });
    },
  },
});
const decode = t => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString());
const userOf = () => {
  const t = globalThis.__TOKEN__; if (!t) return null; const p = decode(t);
  return { id: p.sub, is_anonymous: !!p.is_anonymous, app_metadata: p.app_metadata || {} };
};
const auth = {
  getSession: async () => ({ data: { session: userOf() ? { user: userOf() } : null } }),
  signInAnonymously: async () => { globalThis.__TOKEN__ = globalThis.__CUSTOMER_TOKEN__; return { data: { user: userOf() }, error: null }; },
  signInWithPassword: async ({ email, password }) => {
    const t = globalThis.__STAFF__?.[email];
    if (!t || password !== 'pw') return { data: null, error: { message: 'Invalid login credentials' } };
    globalThis.__TOKEN__ = t; return { data: { user: userOf() }, error: null };
  },
  signOut: async () => { globalThis.__TOKEN__ = null; return { error: null }; },
};
const channel = () => { const c = { on: () => c, subscribe: () => c }; return c; };
export const db = new Proxy(client, {
  get: (t, k) => (k === 'auth' ? auth : k === 'channel' ? channel : typeof t[k] === 'function' ? t[k].bind(t) : t[k]),
});
