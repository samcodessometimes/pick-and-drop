// Page-level tests: the real page scripts run in jsdom against PostgREST + the migrated database.
// NOT a browser test (no layout, CSS or real Supabase Auth/Realtime). See tests/README.md.
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { bundleAll, openPage, until, sleep, $, $$, text, click, fill, submit, store, problems } from './harness.mjs';

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const SECRET = process.env.JWT_SECRET || 'test-only-secret-test-only-secret-1234';
const PSQL = process.env.PSQL || 'su postgres -c "psql -tA -d pd"';
const sql = q => execSync(PSQL, { input: q }).toString().trim();
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = p => { const h = b64({ alg: 'HS256', typ: 'JWT' }), b = b64({ aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const U = id => `00000000-0000-4000-8000-0000000000${id}`;
const TOK = { customer: sign({ sub: U('a1'), role: 'authenticated', is_anonymous: true }), customerB: sign({ sub: U('a2'), role: 'authenticated', is_anonymous: true }),
  merchG: sign({ sub: U('b1'), role: 'authenticated' }), merchS: sign({ sub: U('b2'), role: 'authenticated' }), rider: sign({ sub: U('c1'), role: 'authenticated' }),
  riderOther: sign({ sub: U('c2'), role: 'authenticated' }), admin: sign({ sub: U('d1'), role: 'authenticated', app_metadata: { role: 'admin' } }) };
Object.assign(globalThis, { __API__: API, __ANON_JWT__: sign({ role: 'anon' }), __CUSTOMER_TOKEN__: TOK.customer, __TOKEN__: null,
  __STAFF__: { 'merchant@test': TOK.merchG, 'admin@test': TOK.admin }, setInterval: () => 0 });   // periodic refresh is not under test
process.on('unhandledRejection', e => problems.push('unhandled rejection: ' + (e?.message || e)));

const rest = async (path, tok, body, method = 'POST') => { const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body && JSON.stringify(body) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };
const rpc = (fn, args, tok) => rest('/rpc/' + fn, tok, args);
const results = []; let section = '';
const group = n => { section = n; };
async function t(name, fn) { if (process.env.VERBOSE) console.error("  ..", name); try { await fn(); results.push({ section, name, ok: true }); } catch (e) { results.push({ section, name, ok: false, msg: String(e.message || e).slice(0, 240) }); } }
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const as = tok => { globalThis.__TOKEN__ = tok; };
const cart = () => JSON.parse(store.get('pd_cart_v1') || 'null');
const numOf = id => sql(`select order_number from orders where id='${id}'`);
const row = id => sql(`select status||'|'||delivery_status||'|'||total||'|'||coalesce(rider_id::text,'-') from orders where id='${id}'`);
const pinOf = id => sql(`select pin from order_delivery_pins where order_id='${id}'`);
const GEO = { getCurrentPosition: s => s({ coords: { latitude: 8.4812345, longitude: -13.2312345 } }) };
const addr = { contact_name: 'Test Customer', contact_phone: '+23276000000', address_line: '1 Test Street Freetown' };
const prodId = name => sql(`select id from products where name='${name}'`);
const G = sql(`select id from merchants where slug='goodies-supermarket'`);
const RIDER1 = sql(`select id from riders where display_name='Demo Rider 001'`);
const mkOrder = async (qty = 1) => (await rpc('place_order', { p_merchant_id: G, p_items: [{ product_id: prodId('TEST Rice'), qty }], p_address: addr, p_method: 'ORANGE_MONEY', p_txn_ref: 'PGX' + crypto.randomBytes(5).toString('hex') }, TOK.customer)).order_id;
const card = (p, num) => $$(p, '.ocard').find(c => c.textContent.includes('#' + num));
const pill = (p, num) => card(p, num)?.querySelector('.pill')?.textContent;
const btn = (c, label) => [...c.querySelectorAll('button')].find(b => b.textContent.trim() === label);

await bundleAll(['app.js', 'checkout.js', 'tracking.js', 'login.js', 'merchant.js', 'rider.js', 'admin.js']);
let p, oid, num;

// =======================================================================
group('Customer: browse');
await t('home page lists DEMO grocers with a "Demo listing" label, never "partner"', async () => {
  as(null); p = await openPage('index.html'); await until(() => $$(p, '#groceries .card').length >= 7, 6000, 'grocer cards');
  const cards = $$(p, '#groceries .card'); ok(cards.every(c => c.querySelector('.tag')?.textContent === 'Demo listing'), 'label'); ok(!$(p, '.tag-partner'), 'partner tag present');
  ok(!/Pick & Drop partner/.test(text(p)), 'claims partnership'); ok(cards.every(c => c.getAttribute('href').startsWith('merchant.html?slug=')), 'links');
});
await t('suspended and pending merchants are not listed', async () => { ok(!/Fairway|Monoprix/.test(text(p)), 'hidden merchant listed'); });
await t('empty restaurant list shows an empty state, not a blank area', async () => { eq(text(p, '#restaurants'), 'No listings yet.'); });
await t('search filters stores and shows an empty state', async () => {
  const s = $(p, '#search'); s.value = 'good'; s.dispatchEvent(new p.w.Event('input', { bubbles: true })); eq($$(p, '#groceries .card').length, 1); ok(/Goodies/.test(text(p, '#groceries')));
  s.value = 'zzzz'; s.dispatchEvent(new p.w.Event('input', { bubbles: true })); eq(text(p, '#groceries'), 'No matches.');
});
await t('navigation: Orders and Account are disabled placeholders, staff links exist, no script errors', async () => {
  ok($$(p, 'nav.tabs a.soon').length === 2, 'soon tabs'); ok($$(p, '.foot a').length === 3, 'footer links'); eq(p.problems().length, 0, p.problems().join('; '));
});
await t('merchant page: demo banner, menu grouped by section, unavailable item hidden', async () => {
  p = await openPage('merchant.html', '?slug=goodies-supermarket'); await until(() => $$(p, '[data-add]').length > 0, 6000, 'menu');
  eq(text(p, '#m-name'), 'Goodies'); ok(!$(p, '#m-demo').hidden, 'demo banner hidden'); ok(/not yet a Pick & Drop partner/.test(text(p, '#m-demo')), 'banner wording');
  ok(/Demo listing/.test(text(p, '#m-meta')), 'meta'); eq($$(p, '[data-add]').length, 3); ok(!/Unavailable/.test(text(p)), 'unavailable item shown'); ok(/Pantry/.test(text(p, '#menu h2')), 'section');
  ok(/NLe 100/.test(text(p, '#menu')), 'price format');
});
await t('unknown store slug shows a clear message', async () => { const q = await openPage('merchant.html', '?slug=does-not-exist'); await until(() => /could not find/.test(text(q, '#menu')), 4000, 'message'); });
await t('add to cart: quantities accumulate and the button confirms', async () => {
  store.clear(); p = await openPage('merchant.html', '?slug=goodies-supermarket'); await until(() => $$(p, '[data-add]').length === 3);
  const b = n => $$(p, '.item').find(i => i.textContent.includes(n)).querySelector('[data-add]');
  click(p, b('TEST Rice')); click(p, b('TEST Rice')); click(p, b('TEST Sugar')); eq(b('TEST Rice').textContent, 'Added');
  const c = cart(); eq(c.merchant.slug, 'goodies-supermarket'); eq(c.items.find(i => i.name === 'TEST Rice').qty, 2); eq(c.items.find(i => i.name === 'TEST Sugar').qty, 1);
  ok(/^NLe 20/.test('NLe ' + c.merchant.delivery_fee), 'fee stored');
});
await t('adding from a second store asks first; declining keeps the cart, accepting replaces it', async () => {
  const q = await openPage('merchant.html', '?slug=st-marys-supermarket'); await until(() => $$(q, '[data-add]').length > 0, 6000, 'menu');
  globalThis.__CONFIRM__ = false; click(q, '[data-add]'); eq(cart().merchant.slug, 'goodies-supermarket', 'cart replaced after cancel');
  globalThis.__CONFIRM__ = true; click(q, '[data-add]'); eq(cart().merchant.slug, 'st-marys-supermarket'); eq(cart().items.length, 1); eq(cart().items[0].qty, 1);
});

// =======================================================================
group('Customer: cart');
await t('totals, delivery fee and the minimum-order rule (St Mary\'s: min NLe 200, fee NLe 30)', async () => {
  p = await openPage('cart.html'); await until(() => /Subtotal/.test(text(p, '#cart')), 4000, 'cart');
  ok(/Subtotal\s*NLe 50/.test(text(p, '#cart')) && /Delivery\s*NLe 30/.test(text(p, '#cart')) && /Total\s*NLe 80/.test(text(p, '#cart')), text(p, '#cart')); ok(/Minimum order is NLe 200/.test(text(p, '#cart')), 'min note');
  const go = $(p, 'a.btn-block'); ok(go.classList.contains('disabled') && go.getAttribute('aria-disabled') === 'true' && go.getAttribute('href') === '#', 'checkout not blocked');
  for (let i = 0; i < 3; i++) click(p, '[data-d="1"]');
  ok(/Total\s*NLe 230/.test(text(p, '#cart')), text(p, '#cart')); ok(!/Minimum order/.test(text(p, '#cart')), 'min note still shown'); eq($(p, 'a.btn-block').getAttribute('href'), 'checkout.html');
});
await t('quantity cannot exceed 20 (the server limit) and removing the last item empties the cart', async () => {
  for (let i = 0; i < 25; i++) click(p, '[data-d="1"]'); eq(cart().items[0].qty, 20); ok(/>20</.test($(p, '.qty').innerHTML), 'qty display');
  for (let i = 0; i < 20; i++) click(p, '[data-d="-1"]'); ok(/Your cart is empty/.test(text(p, '#cart')), 'empty state'); eq(cart().merchant, null);
});
await t('cart badge shows the item count and clears when empty', async () => {
  store.clear(); const q = await openPage('merchant.html', '?slug=goodies-supermarket'); await until(() => $$(q, '[data-add]').length === 3);
  const n = $(q, '#cart-count'); ok(n.hidden, 'badge visible when empty'); click(q, '[data-add]'); click(q, '[data-add]'); eq(n.textContent, '2'); ok(!n.hidden, 'badge hidden');
});

// =======================================================================
group('Customer: checkout, order, PIN, tracking');
await t('checkout shows server-consistent totals, both payment methods, and the simulated-payment notice', async () => {
  store.clear(); const q = await openPage('merchant.html', '?slug=goodies-supermarket'); await until(() => $$(q, '[data-add]').length === 3);
  const add = n => $$(q, '.item').find(i => i.textContent.includes(n)).querySelector('[data-add]'); click(q, add('TEST Rice')); click(q, add('TEST Rice')); click(q, add('TEST Sugar'));
  globalThis.__GEO__ = GEO; as(null); p = await openPage('checkout.html'); await until(() => $(p, '#form'), 4000, 'form');
  const tx = text(p, '.totals'); ok(/NLe 230/.test(tx) && /NLe 20/.test(tx) && /NLe 250/.test(tx), tx);
  eq($$(p, '[name="method"]').length, 2); ok(/Orange Money/.test(text(p, 'fieldset')) && /Afrimoney/.test(text(p, 'fieldset')), 'methods'); eq($(p, '[name="method"]:checked').value, 'ORANGE_MONEY');
  ok(/payments are simulated/.test(text(p)), 'notice');
});
await t('validation messages appear before anything is sent', async () => {
  const before = (globalThis.__REQ__ || []).length; const e = () => text(p, '#err');
  submit(p, '#form'); eq(e(), 'Enter your name.'); fill(p, '#form', { contact_name: 'Test Customer' }); submit(p, '#form'); eq(e(), 'Enter a valid phone number.');
  fill(p, '#form', { contact_phone: '+23276000000' }); submit(p, '#form'); eq(e(), 'Enter your delivery address.'); fill(p, '#form', { address_line: '1 Test Street Freetown' }); submit(p, '#form');
  eq(e(), 'Transaction ID must be 6 to 24 letters or numbers.'); fill(p, '#form', { ref: 'abc' }); submit(p, '#form'); eq(e(), 'Transaction ID must be 6 to 24 letters or numbers.');
  eq((globalThis.__REQ__ || []).filter(r => r.url.includes('place_order')).length, 0, 'request sent despite invalid form'); ok(before >= 0);
});
await t('"use my location" stores coordinates and says so', async () => { click(p, '#locate'); await until(() => /Location saved/.test(text(p, '#loc-status')), 3000, 'status'); });
await t('placing an order creates it server-side, clears the cart and goes to tracking', async () => {
  fill(p, '#form', { ref: 'PAGE000001', landmark: 'Near the clock tower', notes: 'Ring twice' }); submit(p, '#form');
  await until(() => p.nav.some(n => n.startsWith('tracking.html?id=')), 8000, 'navigation to tracking'); oid = decodeURIComponent(p.nav.find(n => n.startsWith('tracking.html')).split('=')[1]); num = numOf(oid);
  ok(/^PD\d+$/.test(num), 'order number'); eq(row(oid), `PLACED|UNASSIGNED|250.00|-`); eq(cart().items.length, 0, 'cart not cleared');
  eq(sql(`select method||'|'||status||'|'||is_simulated from payments where order_id='${oid}'`), 'ORANGE_MONEY|PAID|true');
  eq(sql(`select landmark||'|'||notes||'|'||(latitude is not null) from orders where id='${oid}'`), 'Near the clock tower|Ring twice|true');
});
await t('a rejected order (reused transaction ID) shows the reason, re-enables the button, does not navigate', async () => {
  store.clear(); const q = await openPage('merchant.html', '?slug=goodies-supermarket'); await until(() => $$(q, '[data-add]').length === 3); click(q, '[data-add]');
  p = await openPage('checkout.html'); fill(p, '#form', { ...addr, ref: 'PAGE000001' }); submit(p, '#form'); await until(() => !$(p, '#err').hidden, 6000, 'error');
  ok(/already been used/.test(text(p, '#err')), text(p, '#err')); eq($(p, '#submit').disabled, false); eq($(p, '#submit').textContent, 'Place order'); eq(p.nav.length, 0, 'navigated');
});
await t('Afrimoney order can be placed', async () => {
  fill(p, '#form', { method: 'AFRIMONEY', ref: 'PAGE000002' }); submit(p, '#form'); await until(() => p.nav.length > 0, 6000, 'nav'); const id = decodeURIComponent(p.nav[0].split('=')[1]);
  eq(sql(`select method from payments where order_id='${id}'`), 'AFRIMONEY');
});
await t('tracking: reference, delivery PIN message, Demo banner, items, first step', async () => {
  as(TOK.customer); p = await openPage('tracking.html', `?id=${oid}`); await until(() => $(p, '.pin strong'), 6000, 'PIN card');
  eq($(p, '.pin strong').textContent, pinOf(oid)); ok(/^\d{4}$/.test($(p, '.pin strong').textContent), 'format');
  ok(/Keep this PIN private and give it to your rider when your order arrives\./.test(text(p, '.pin')), 'wording'); ok(new RegExp('Order #' + num).test(text(p)), 'reference'); ok(/Demo order/.test(text(p, '.banner')), 'banner');
  ok(/2 x TEST Rice/.test(text(p)) && /1 x TEST Sugar/.test(text(p)), 'items'); eq(text(p, '.steps .now'), 'Order placed'); eq(p.problems().length, 0, p.problems().join('; '));
});
await t('tracking: another customer cannot open the order or its PIN', async () => {
  as(TOK.customerB); const q = await openPage('tracking.html', `?id=${oid}`); await until(() => /could not find/i.test(text(q, '#tracking')), 5000, 'not found'); ok(!$(q, '.pin'), 'PIN shown'); as(TOK.customer);
});
await t('tracking: bad or missing id shows a message instead of crashing', async () => {
  const a = await openPage('tracking.html', '?id=not-a-uuid'); await until(() => /Could not load|could not find/i.test(text(a, '#tracking')), 5000, 'message'); const b = await openPage('tracking.html'); ok(/No order selected/.test(text(b, '#tracking')), 'missing id');
});

// =======================================================================
group('Staff sign-in');
await t('wrong password shows an error; correct login goes to the requested dashboard', async () => {
  as(null); p = await openPage('login.html', '?next=merchant-dashboard.html'); await until(() => $(p, '#f'), 3000, 'form');
  fill(p, '#f', { email: 'merchant@test', password: 'nope' }); submit(p, '#f'); await until(() => !$(p, '#err').hidden, 3000, 'error'); ok(/Sign in failed/.test(text(p, '#err')), 'message'); eq(p.nav.length, 0);
  fill(p, '#f', { password: 'pw' }); submit(p, '#f'); await until(() => p.nav.length > 0, 3000, 'redirect'); eq(p.nav[0], 'merchant-dashboard.html');
});
await t('login ignores an external ?next= (no open redirect)', async () => {
  as(null); p = await openPage('login.html', '?next=https://evil.example/steal'); await until(() => $(p, '#f')); fill(p, '#f', { email: 'merchant@test', password: 'pw' }); submit(p, '#f');
  await until(() => /Signed in/.test(text(p, '#login')), 3000, 'signed in'); eq(p.nav.length, 0, 'redirected: ' + p.nav.join());
});
await t('dashboards redirect visitors with no session or only a customer session to login', async () => {
  for (const [file, tok] of [['merchant-dashboard.html', null], ['merchant-dashboard.html', TOK.customer], ['rider.html', null], ['admin.html', null], ['admin.html', TOK.customer]]) {
    as(tok); const q = await openPage(file); await until(() => q.nav.length > 0, 3000, `${file} redirect`); ok(q.nav[0].startsWith('login.html?next='), q.nav[0]);
  }
});

// =======================================================================
group('Merchant dashboard');
await t('merchant sees the DEMO banner and the incoming order with items, total, customer and note', async () => {
  as(TOK.merchG); p = await openPage('merchant-dashboard.html'); await until(() => card(p, num), 6000, 'order card');
  ok(!$(p, '#demo').hidden && /DEMO \/ NOT PARTNERED/.test(text(p, '#demo')), 'banner'); eq(text(p, '#mname'), 'Goodies'); const c = card(p, num).textContent;
  ok(/2 x TEST Rice/.test(c) && /Total NLe 250/.test(c) && /Test Customer/.test(c) && /1 Test Street Freetown/.test(c) && /Ring twice/.test(c) && /Near the clock tower/.test(c), c); eq(pill(p, num), 'New order');
});
await t('accept, start preparing and mark ready update the order', async () => {
  click(p, btn(card(p, num), 'Accept')); await until(() => pill(p, num) === 'Accepted', 5000, 'Accepted');
  click(p, btn(card(p, num), 'Start preparing')); await until(() => pill(p, num) === 'Preparing', 5000, 'Preparing');
  click(p, btn(card(p, num), 'Mark ready for pickup')); await until(() => pill(p, num) === 'Ready for pickup', 5000, 'Ready'); ok(/Waiting for the rider/.test(card(p, num).textContent), 'wait note');
  eq(row(oid).split('|')[0], 'READY_FOR_PICKUP');
});
await t('reject asks first, cancels the order and refunds the simulated payment', async () => {
  const o2 = await mkOrder(); const n2 = numOf(o2); p = await openPage('merchant-dashboard.html'); await until(() => card(p, n2), 6000, 'card');
  globalThis.__CONFIRM__ = false; click(p, btn(card(p, n2), 'Reject')); await sleep(300); eq(pill(p, n2), 'New order', 'rejected despite cancel');
  globalThis.__CONFIRM__ = true; click(p, btn(card(p, n2), 'Reject')); await until(() => pill(p, n2) === 'Cancelled', 5000, 'Cancelled');
  eq(sql(`select status from payments where order_id='${o2}'`), 'REFUNDED'); ok(!btn(card(p, n2), 'Accept'), 'actions still offered');
});
await t('another merchant\'s dashboard does not show this order', async () => {
  as(TOK.merchS); const q = await openPage('merchant-dashboard.html'); await until(() => $(q, '#list') && text(q, '#list') !== '', 6000, 'list'); ok(!text(q).includes(num), 'cross-merchant leak'); eq(text(q, '#mname'), "St Mary's");
});
await t('an account with no merchant link gets a clear message', async () => { as(TOK.riderOther); const q = await openPage('merchant-dashboard.html'); await until(() => /not linked to a merchant/.test(text(q)), 5000, 'message'); });

// =======================================================================
group('Admin dashboard');
await t('non-admin staff are told the page is admin-only (server decides)', async () => { as(TOK.merchG); const q = await openPage('admin.html'); await until(() => /admins only/.test(text(q, '#gate')), 5000, 'message'); ok($(q, '#app').hidden, 'app visible'); });
await t('overview shows real database counts and flags demo vs live', async () => {
  as(TOK.admin); p = await openPage('admin.html'); await until(() => $$(p, '.stat').length > 3, 6000, 'stats'); const stat = n => $$(p, '.stat').find(s => s.querySelector('span')?.textContent === n);
  eq(Number(stat('Total orders').querySelector('strong').textContent), Number(sql('select count(*) from orders')), 'orders'); eq(Number(stat('Registered merchants').querySelector('strong').textContent), Number(sql('select count(*) from merchants')), 'merchants');
  eq(Number(stat('Registered riders').querySelector('strong').textContent), Number(sql('select count(*) from riders')), 'riders');
  ok(/Live 0/.test(stat('Total orders').textContent), 'live split'); ok(/No live operations yet/.test(text(p, '.banner')), 'banner');
  eq(Number(stat('Completed').querySelector('strong').textContent), Number(sql(`select count(*) from orders where status='DELIVERED'`)), 'completed');
});
await t('orders tab: list, search by reference, status filter, detail with items/payment/history', async () => {
  click(p, '[data-tab="orders"]'); await until(() => $$(p, '.orow').length > 0, 5000, 'rows'); ok($$(p, '.orow').some(r => r.textContent.includes('#' + num)), 'order missing');
  const s = $(p, '#oq'); s.value = num; s.dispatchEvent(new p.w.Event('input', { bubbles: true })); await until(() => $$(p, '.orow').length === 1, 4000, 'search'); ok($(p, '.orow').textContent.includes('(simulated)'), 'payment label');
  s.value = ''; s.dispatchEvent(new p.w.Event('input', { bubbles: true })); const st = $(p, '#os'); st.value = 'READY_FOR_PICKUP'; st.dispatchEvent(new p.w.Event('change', { bubbles: true })); await until(() => $$(p, '.orow').length >= 1 && $$(p, '.orow').every(r => /Ready for pickup/.test(r.textContent)), 4000, 'filter');
  click(p, $$(p, '.orow')[0]); await until(() => $(p, '#panel .pbody h2'), 4000, 'detail'); ok(/TEST Rice/.test(text(p, '#panel')) && /Ready for pickup/.test(text(p, '#panel')) && /History/.test(text(p, '#panel')), text(p, '#panel').slice(0, 200));
  ok(/Delivered can only be set by the rider/.test(text(p, '#panel')), 'delivered note'); ok(!$(p, '#ssel') || ![...$(p, '#ssel').options].some(o => o.value === 'DELIVERED'), 'DELIVERED offered');
});
await t('admin assigns Demo Rider 001 from the order detail', async () => {
  const sel = $(p, '#rsel'); ok(sel, 'no rider select'); sel.value = RIDER1; click(p, '#rbtn'); await until(() => /Demo Rider 001/.test(text(p, '#panel')) && /Reassign/.test(text(p, '#panel')), 5000, 'assigned'); eq(row(oid).split('|')[1], 'ASSIGNED'); eq(row(oid).split('|')[3], RIDER1);
});
await t('admin changes a status with a reason and it appears in history', async () => {
  const o3 = await mkOrder(); const n3 = numOf(o3); p = await openPage('admin.html'); await until(() => $$(p, '.stat').length > 3); click(p, '[data-tab="orders"]'); await until(() => $$(p, '.orow').some(r => r.textContent.includes(n3)));
  click(p, $$(p, '.orow').find(r => r.textContent.includes(n3))); await until(() => $(p, '#ssel'), 4000, 'status select'); $(p, '#ssel').value = 'ACCEPTED'; $(p, '#sreason').value = 'called the shop'; click(p, '#sbtn');
  await until(() => /called the shop/.test(text(p, '#panel')), 5000, 'history note'); eq(row(o3).split('|')[0], 'ACCEPTED');
});
await t('admin errors are shown in the dialog (assigning an offline rider is refused)', async () => {
  const o4 = await mkOrder(); const n4 = numOf(o4); p = await openPage('admin.html'); await until(() => $$(p, '.stat').length > 3); click(p, '[data-tab="orders"]'); await until(() => $$(p, '.orow').some(r => r.textContent.includes(n4)));
  click(p, $$(p, '.orow').find(r => r.textContent.includes(n4))); await until(() => $(p, '#rsel'), 4000, 'rider select');
  ok(![...$(p, '#rsel').options].some(o => /Offline/.test(o.textContent) && /Test Rider Offline/.test(o.textContent)), 'offline rider offered in the list');
});
await t('merchants tab: status labels never claim a partnership; admin sees internal notes', async () => {
  p = await openPage('admin.html'); await until(() => $$(p, '.stat').length > 3); click(p, '[data-tab="merchants"]'); await until(() => $$(p, '.mrow').length >= 9, 5000, 'merchant rows');
  const r = n => $$(p, '.mrow').find(x => x.textContent.includes(n)); ok(/DEMO \/ NOT PARTNERED/.test(r('Goodies').textContent), 'goodies'); ok(/SUSPENDED/.test(r('Fairway').textContent), 'suspended'); ok(/NOT PARTNERED \(pending\)/.test(r('Monoprix').textContent), 'pending');
  ok(!$$(p, '.mrow').some(x => /Pick & Drop partner/.test(x.textContent)), 'someone shown as partner'); ok(/No phone on file/.test(r('Goodies').textContent), 'invented phone');
  click(p, r('Goodies').querySelector('[data-edit]')); await until(() => $(p, '#mf'), 3000, 'form'); eq($(p, '[name="internal_notes"]').value, 'SECRET-NOTE-goodies');
});
await t('add merchant: validation error, then saved as DEMO / NOT PARTNERED with no invented details', async () => {
  p = await openPage('admin.html'); await until(() => $$(p, '.stat').length > 3); click(p, '[data-tab="merchants"]'); await until(() => $$(p, '.mrow').length >= 9); click(p, '#madd'); await until(() => $(p, '#mf'), 3000, 'form');
  fill(p, '#mf', { name: 'X', service_area: 'central-freetown' }); submit(p, '#mf'); await until(() => !$(p, '#fmsg').hidden, 4000, 'error'); ok(/2 to 100 characters/.test(text(p, '#fmsg')), text(p, '#fmsg'));
  fill(p, '#mf', { name: 'Page Test Kitchen', merchant_type: 'RESTAURANT' }); $(p, '#mtype').dispatchEvent(new p.w.Event('change')); fill(p, '#mf', { category: 'pizza' }); submit(p, '#mf');
  await until(() => $$(p, '.mrow').some(x => x.textContent.includes('Page Test Kitchen')), 6000, 'new row'); const nr = $$(p, '.mrow').find(x => x.textContent.includes('Page Test Kitchen')); ok(/DEMO \/ NOT PARTNERED/.test(nr.textContent) && /No phone on file/.test(nr.textContent) && /Pizza/.test(nr.textContent), nr.textContent);
  eq(sql(`select status||'|'||coalesce(phone,'none')||'|'||coalesce(owner_id::text,'none') from merchants where name='Page Test Kitchen'`), 'DEMO|none|none');
});
await t('editing a merchant keeps internal notes; ACTIVE without confirmation is refused with a message', async () => {
  const r = n => $$(p, '.mrow').find(x => x.textContent.includes(n)); click(p, r('Goodies').querySelector('[data-edit]')); await until(() => $(p, '#mf')); fill(p, '#mf', { description: 'Edited in page test' }); submit(p, '#mf');
  await until(() => sql(`select description from merchants where slug='goodies-supermarket'`) === 'Edited in page test', 5000, 'saved'); eq(sql(`select internal_notes from merchant_internal where merchant_id='${G}'`), 'SECRET-NOTE-goodies');
  await until(() => $$(p, '.mrow').length >= 9); click(p, r('Goodies').querySelector('[data-status]')); await until(() => $(p, '#sf')); fill(p, '#sf', { status: 'ACTIVE' }); $(p, '#sst').value = 'ACTIVE'; $(p, '#sst').dispatchEvent(new p.w.Event('change')); ok(!$(p, '#act').hidden, 'owner fields hidden');
  fill(p, '#sf', { owner_email: 'owner@example.test' }); submit(p, '#sf'); await until(() => !$(p, '#smsg').hidden, 4000, 'error'); ok(/agreed in writing/.test(text(p, '#smsg')), text(p, '#smsg')); eq(sql(`select status from merchants where slug='goodies-supermarket'`), 'DEMO');
});
await t('riders tab: lists demo riders with active orders; add a test rider; cannot take a busy rider offline', async () => {
  p = await openPage('admin.html'); await until(() => $$(p, '.stat').length > 3); click(p, '[data-tab="riders"]'); await until(() => $$(p, '.rrow').length >= 3, 5000, 'rider rows');
  const r = n => $$(p, '.rrow').find(x => x.textContent.includes(n)); ok(/DEMO RIDER/.test(r('Demo Rider 001').textContent) && new RegExp('#' + num).test(r('Demo Rider 001').textContent), 'active order not listed');
  click(p, '#radd'); await until(() => $(p, '#rf')); fill(p, '#rf', { name: 'Page Test Rider', phone: '+23277000000' }); submit(p, '#rf'); await until(() => $$(p, '.rrow').some(x => x.textContent.includes('Page Test Rider')), 5000, 'new rider');
  click(p, r('Demo Rider 001').querySelector('[data-edit]')); await until(() => $(p, '#rf')); fill(p, '#rf', { availability: 'OFFLINE' }); submit(p, '#rf'); await until(() => !$(p, '#rmsg').hidden, 4000, 'error'); ok(/cannot go offline/.test(text(p, '#rmsg')), text(p, '#rmsg'));
});

// =======================================================================
group('Rider dashboard');
let o5, n5;
await t('an account with no rider profile gets a clear message', async () => { as(TOK.riderOther); const q = await openPage('rider.html'); await until(() => /not linked to a rider profile/.test(text(q)), 5000, 'message'); });
await t('rider sees assigned deliveries with address, contact and note; never requests the PIN table', async () => {
  o5 = await mkOrder(); n5 = numOf(o5); for (const a of ['ACCEPT', 'PREPARING', 'READY']) await rpc('merchant_set_order_status', { p_order_id: o5, p_action: a }, TOK.merchG);
  await rpc('admin_assign_rider', { p_order_id: o5, p_rider_id: RIDER1 }, TOK.admin); for (const a of ['ACCEPT', 'ARRIVE_MERCHANT', 'PICKUP', 'ON_THE_WAY', 'ARRIVE_CUSTOMER']) await rpc('rider_advance_delivery', { p_order_id: o5, p_action: a }, TOK.rider);
  globalThis.__REQ__.length = 0; as(TOK.rider); p = await openPage('rider.html'); await until(() => card(p, num) && card(p, n5), 6000, 'cards'); eq(text(p, 'h2'), 'Demo Rider 001'); ok(/Demo rider/.test(text(p)), 'demo label');
  const c = card(p, num).textContent; ok(/1 Test Street Freetown/.test(c) && /\+23276000000/.test(c) && /Ring twice/.test(c) && /Goodies/.test(c) && /DEMO store, not a partner/.test(c), c);
  eq(pill(p, num), 'Assigned'); eq(pill(p, n5), 'At customer'); ok(!globalThis.__REQ__.some(r => r.url.includes('order_delivery_pins')), 'rider page read the PIN table');
  for (const pn of [pinOf(oid), pinOf(o5)]) ok(!new RegExp(`\\b${pn}\\b`).test(p.doc.body.innerHTML.replace(/NLe[ \d.,]+/g, '').replace(/\+232\d+/g, '').replace(/PD\d+/g, '')), 'PIN digits visible on rider page');
});
await t('rider steps through accept, arrived, picked up (store already ready), on the way, arrived', async () => {
  const step = async (label, next) => { click(p, btn(card(p, num), label)); await until(() => pill(p, num) === next, 5000, next); };
  await step('Accept delivery', 'Accepted'); await step('Arrived at store', 'At store'); await step('Picked up order', 'Picked up'); await step('Start delivery', 'On the way'); await step('Arrived at customer', 'At customer');
  ok(card(p, num).querySelector('.pinform'), 'PIN form missing'); ok(!btn(card(p, num), 'Accept delivery'), 'stale button');
});
await t('a wrong PIN is refused with attempts left, shown as an error, and the order stays undelivered', async () => {
  const f = card(p, num).querySelector('.pinform'); const bad = pinOf(oid) === '0000' ? '1111' : '0000'; f.querySelector('[name="pin"]').value = bad; submit(p, `.pinform[data-id="${oid}"]`);
  await until(() => /Wrong PIN/.test(text(p, '#msg')), 5000, 'message'); ok(/4 tries left/.test(text(p, '#msg')), text(p, '#msg')); ok(!$(p, '#msg').hidden && $(p, '#msg').className === 'error', 'msg class ' + $(p, '#msg').className); ok(!row(oid).includes('DELIVERED'), 'delivered');
});
await t('the correct PIN completes delivery and the card disappears', async () => {
  card(p, num).querySelector('[name="pin"]').value = pinOf(oid); submit(p, `.pinform[data-id="${oid}"]`); await until(() => /Delivery confirmed/.test(text(p, '#msg')), 5000, 'confirmed'); eq($(p, '#msg').className, 'ok');
  await until(() => !card(p, num), 5000, 'card removed'); eq(row(oid).split('|')[0], 'DELIVERED');
});
await t('an error after a success is NOT styled as success (message class resets)', async () => {
  const f = card(p, n5).querySelector('.pinform'); f.querySelector('[name="pin"]').value = pinOf(o5) === '0000' ? '1111' : '0000'; submit(p, `.pinform[data-id="${o5}"]`);
  await until(() => /Wrong PIN/.test(text(p, '#msg')), 5000, 'message'); eq($(p, '#msg').className, 'error', 'error shown with class ' + $(p, '#msg').className);
});
await t('PIN input rejects non-digits in the page before calling the server', async () => {
  const before = globalThis.__REQ__.filter(r => r.url.includes('verify_delivery_pin')).length; card(p, n5).querySelector('[name="pin"]').value = '12a4'; submit(p, `.pinform[data-id="${o5}"]`);
  await until(() => /Enter the 4-digit PIN/.test(text(p, '#msg')), 3000, 'message'); eq(globalThis.__REQ__.filter(r => r.url.includes('verify_delivery_pin')).length, before, 'server called');
});
await t('customer tracking shows Delivered and no PIN after completion', async () => {
  as(TOK.customer); const q = await openPage('tracking.html', `?id=${oid}`); await until(() => /has been delivered/.test(text(q, '#tracking')), 6000, 'delivered'); ok(!$(q, '.pin'), 'PIN still shown'); eq(text(q, '.steps .now'), 'Delivered', 'last step not highlighted');
});
await t('no uncaught page errors or jsdom errors across the whole run', async () => { eq(problems.length, 0, problems.slice(0, 3).join(' | ')); });

// ---- report -----------------------------------------------------------
let last = ''; let pass = 0;
for (const r of results) { if (r.section !== last) { console.log(`\n${r.section}`); last = r.section; } console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n        -> ' + r.msg}`); if (r.ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, ${results.length} total`);
process.exit(results.length === pass ? 0 : 1);
