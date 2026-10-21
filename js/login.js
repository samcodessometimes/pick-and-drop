import { configured } from './supabase.js';
import { signInStaff } from './auth.js';

const root = document.querySelector('#login');
const NEXT = ['merchant-dashboard.html', 'rider.html', 'admin.html'];   // allowlist, no open redirects
const next = new URLSearchParams(location.search).get('next');

if (!configured) root.innerHTML = '<p class="note">Supabase is not connected yet. Add your keys in js/config.js.</p>';
else {
  root.innerHTML = `<form id="f" novalidate><p class="note">Demo staff access for merchant, rider and admin test accounts. Customers do not need to sign in.</p>
    <label>Email<input name="email" type="email" autocomplete="username" required></label>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <p class="error" id="err" role="alert" hidden></p><button class="btn btn-block" style="width:100%">Sign in</button></form>`;
  document.querySelector('#f').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = document.querySelector('#err'), b = e.target.querySelector('button');
    b.disabled = true; err.hidden = true;
    try {
      await signInStaff(f.email.trim(), f.password);
      if (NEXT.includes(next)) location.href = next;
      else root.innerHTML = `<h2>Signed in</h2><p><a class="btn" href="merchant-dashboard.html">Merchant dashboard</a></p>
        <p><a class="btn" href="rider.html">Rider</a></p><p><a class="btn" href="admin.html">Admin</a></p>`;
    } catch (ex) { err.textContent = ex.message; err.hidden = false; b.disabled = false; }
  });
}
