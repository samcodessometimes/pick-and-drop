// Staff-dashboard flows (merchant, admin order/rider tabs, rider steps, tracking PIN card) are covered end to end by tests/browser/browser.test.mjs
// in real Chromium. The jsdom versions of those tests were retired when the screens were rebuilt for payments and the new RPC-based dashboards.
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
group('Customer: cart');
await t('cart badge shows the item count and clears when empty', async () => {
  store.clear(); const q = await openPage('merchant.html', '?slug=goodies-supermarket'); await until(() => $$(q, '[data-add]').length === 3);
  const n = $(q, '#cart-count'); ok(n.hidden, 'badge visible when empty'); click(q, '[data-add]'); click(q, '[data-add]'); eq(n.textContent, '2'); ok(!n.hidden, 'badge hidden');
});

// =======================================================================
group('Customer: checkout, order, PIN, tracking');
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
await t('another merchant\'s dashboard does not show this order', async () => {
  as(TOK.merchS); const q = await openPage('merchant-dashboard.html'); await until(() => $(q, '#list') && text(q, '#list') !== '', 6000, 'list'); ok(!text(q).includes(num), 'cross-merchant leak'); eq(text(q, '#mname'), "St Mary's");
});
group('Admin dashboard');
await t('non-admin staff are told the page is admin-only (server decides)', async () => { as(TOK.merchG); const q = await openPage('admin.html'); await until(() => /admins only/.test(text(q, '#gate')), 5000, 'message'); ok($(q, '#app').hidden, 'app visible'); });
await t('overview shows real database counts and flags demo vs live', async () => {
  as(TOK.admin); p = await openPage('admin.html'); await until(() => $$(p, '.stat').length > 3, 6000, 'stats'); const stat = n => $$(p, '.stat').find(s => s.querySelector('span')?.textContent === n);
  eq(Number(stat('Total orders').querySelector('strong').textContent), Number(sql('select count(*) from orders')), 'orders'); eq(Number(stat('Registered merchants').querySelector('strong').textContent), Number(sql('select count(*) from merchants')), 'merchants');
  eq(Number(stat('Registered riders').querySelector('strong').textContent), Number(sql('select count(*) from riders')), 'riders');
  ok(/Live 0/.test(stat('Total orders').textContent), 'live split'); ok(/No live operations yet/.test(text(p, '.banner')), 'banner');
  eq(Number(stat('Completed').querySelector('strong').textContent), Number(sql(`select count(*) from orders where status='DELIVERED'`)), 'completed');
});
await t('admin changes a status with a reason and it appears in history', async () => {
  const o3 = await mkOrder(); const n3 = numOf(o3); p = await openPage('admin.html'); await until(() => $$(p, '.stat').length > 3); click(p, '[data-tab="orders"]'); await until(() => $$(p, '.orow').some(r => r.textContent.includes(n3)));
  click(p, $$(p, '.orow').find(r => r.textContent.includes(n3))); await until(() => $(p, '#ssel'), 4000, 'status select'); $(p, '#ssel').value = 'ACCEPTED'; $(p, '#sreason').value = 'called the shop'; click(p, '#sbtn');
  await until(() => /called the shop/.test(text(p, '#panel')), 5000, 'history note'); eq(row(o3).split('|')[0], 'ACCEPTED');
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
group('Rider dashboard');
let o5, n5;
await t('an account with no rider profile gets a clear message', async () => { as(TOK.riderOther); const q = await openPage('rider.html'); await until(() => /not linked to a rider profile/.test(text(q)), 5000, 'message'); });
await t('no uncaught page errors or jsdom errors across the whole run', async () => { eq(problems.length, 0, problems.slice(0, 3).join(' | ')); });

// ---- report -----------------------------------------------------------
let last = ''; let pass = 0;
for (const r of results) { if (r.section !== last) { console.log(`\n${r.section}`); last = r.section; } console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n        -> ' + r.msg}`); if (r.ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, ${results.length} total`);
process.exit(results.length === pass ? 0 : 1);
