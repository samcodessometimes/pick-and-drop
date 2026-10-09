import { db, configured } from './supabase.js';
import { addItem, getCart, setQty, cartCount, cartSubtotal } from './cart.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => 'NLe ' + Number(n).toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const note = (el, msg) => { el.innerHTML = `<p class="note">${esc(msg)}</p>`; };

function eta(m) {
  if (!m.prep_time_min) return '';
  return `${m.prep_time_min}${m.prep_time_max ? '-' + m.prep_time_max : ''} mins`;
}

function merchantCard(m) {
  const img = m.cover_url ? `<img src="${esc(m.cover_url)}" alt="" loading="lazy">` : `<span class="mark">${esc(m.name.charAt(0))}</span>`;
  return `<a class="card" href="merchant.html?slug=${encodeURIComponent(m.slug)}">
    <div class="card-img">${img}<span class="tag ${m.is_partner ? 'tag-partner' : ''}">${esc(m.partner_label)}</span></div>
    <div class="card-body"><h3>${esc(m.name)}</h3>
      <p>${m.rating ? '★ ' + Number(m.rating).toFixed(1) : 'New'}${eta(m) ? ' · ' + eta(m) : ''}</p>
      <p>${esc(m.neighbourhood || m.service_area_name)}${m.delivery_fee > 0 ? ' · ' + money(m.delivery_fee) + ' delivery' : ''}</p></div></a>`;
}

function renderNav() {
  const n = $('#cart-count');
  if (n) { const c = cartCount(); n.textContent = c; n.hidden = !c; }
}

async function loadMerchants(type) {
  const { data, error } = await db.from('merchants_public').select('*')
    .eq('merchant_type', type).eq('delivery_enabled', true).order('sort_order').order('name');
  if (error) throw error;
  return data;
}

async function homePage() {
  const lists = { RESTAURANT: $('#restaurants'), GROCERY: $('#groceries') };
  const all = {};
  for (const [type, el] of Object.entries(lists)) {
    try { all[type] = await loadMerchants(type); } catch { note(el, 'Could not load this list. Check your connection and refresh.'); }
  }
  const draw = q => {
    for (const [type, el] of Object.entries(lists)) {
      if (!all[type]) continue;
      const rows = all[type].filter(m => m.name.toLowerCase().includes(q));
      el.innerHTML = rows.length ? rows.map(merchantCard).join('') : `<p class="note">${q ? 'No matches.' : 'No listings yet.'}</p>`;
    }
  };
  draw('');
  $('#search').addEventListener('input', e => draw(e.target.value.trim().toLowerCase()));
}

async function merchantPage() {
  const root = $('#menu');
  const slug = new URLSearchParams(location.search).get('slug');
  if (!slug) return note(root, 'No store selected.');
  const { data: m, error } = await db.from('merchants_public').select('*').eq('slug', slug).maybeSingle();
  if (error || !m) return note(root, 'We could not find this store.');
  document.title = `${m.name} | Pick & Drop`;
  $('#m-name').textContent = m.name;
  $('#m-meta').textContent = [m.partner_label, m.neighbourhood || m.service_area_name, eta(m)].filter(Boolean).join(' · ');
  if (!m.is_partner) $('#m-demo').hidden = false;

  const { data: items, error: e2 } = await db.from('products')
    .select('id,name,description,price,unit_label,image_url,sort_order,product_categories(name,sort_order)')
    .eq('merchant_id', m.id).eq('is_available', true).order('sort_order');
  if (e2) return note(root, 'Could not load the menu. Refresh to try again.');
  if (!items.length) return note(root, 'The menu for this store is not available yet.');

  const groups = new Map();
  for (const p of items) {
    const s = p.product_categories?.name || 'Menu';
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(p);
  }
  const byId = new Map(items.map(p => [p.id, p]));
  root.innerHTML = [...groups].map(([s, ps]) => `<section><h2>${esc(s)}</h2>${ps.map(p => `
    <div class="item"><div><h3>${esc(p.name)}</h3>${p.description ? `<p>${esc(p.description)}</p>` : ''}
      <p class="price">${money(p.price)}${p.unit_label ? ' · ' + esc(p.unit_label) : ''}</p></div>
      <button class="btn btn-sm" data-add="${esc(p.id)}" aria-label="Add ${esc(p.name)} to cart">Add</button></div>`).join('')}</section>`).join('');

  root.addEventListener('click', e => {
    const b = e.target.closest('[data-add]'); if (!b) return;
    if (!addItem(m, byId.get(b.dataset.add))) {
      if (confirm('Your cart has items from another store. Start a new cart with this item?')) {
        localStorage.removeItem('pd_cart_v1'); addItem(m, byId.get(b.dataset.add));
      }
    }
    b.textContent = 'Added'; setTimeout(() => (b.textContent = 'Add'), 900);
  });
}

function cartPage() {
  const root = $('#cart');
  const draw = () => {
    const c = getCart();
    if (!c.items.length) { root.innerHTML = '<p class="note">Your cart is empty.</p><a class="btn" href="index.html">Browse stores</a>'; return; }
    const fee = c.merchant.delivery_fee, sub = cartSubtotal(), below = sub < c.merchant.min_order_amount;
    root.innerHTML = `<h2>${esc(c.merchant.name)}</h2>` + c.items.map(i => `
      <div class="item"><div><h3>${esc(i.name)}</h3><p class="price">${money(i.price * i.qty)}</p></div>
      <div class="qty"><button data-q="${esc(i.id)}" data-d="-1" aria-label="Remove one ${esc(i.name)}">−</button><span>${i.qty}</span>
      <button data-q="${esc(i.id)}" data-d="1" aria-label="Add one ${esc(i.name)}">+</button></div></div>`).join('') + `
      <dl class="totals"><dt>Subtotal</dt><dd>${money(sub)}</dd><dt>Delivery</dt><dd>${money(fee)}</dd>
      <dt>Total</dt><dd><strong>${money(sub + fee)}</strong></dd></dl>
      ${below ? `<p class="note">Minimum order is ${money(c.merchant.min_order_amount)}.</p>` : ''}
      <a class="btn btn-block ${below ? 'disabled' : ''}" href="${below ? '#' : 'checkout.html'}" ${below ? 'aria-disabled="true"' : ''}>Go to checkout</a>`;
  };
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (!b) return;
    const line = getCart().items.find(i => i.id === b.dataset.q);
    setQty(b.dataset.q, line.qty + Number(b.dataset.d));
  });
  window.addEventListener('cart', draw);
  draw();
}

const pages = { home: homePage, merchant: merchantPage, cart: cartPage };
const page = document.body.dataset.page;
renderNav();
window.addEventListener('cart', renderNav);
if (page === 'cart') cartPage();
else if (!configured) note($('main'), 'Supabase is not connected yet. Add your project URL and anon key in js/config.js.');
else pages[page]?.();
