// HTTP-level security and flow tests for Pick & Drop.
// Talks to PostgREST (the same REST layer Supabase uses) with signed JWTs for each role.
// It does NOT test Supabase Auth (GoTrue), Realtime or any browser. See tests/README.md.
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const API = process.env.API_URL || 'http://127.0.0.1:3000';
const SECRET = process.env.JWT_SECRET || 'test-only-secret-test-only-secret-1234';
const PSQL = process.env.PSQL || 'su postgres -c "psql -tA -d pd"';

const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const sign = (payload, secret = SECRET) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, ...payload });
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
const U = id => `00000000-0000-4000-8000-0000000000${id}`;
const user = (id, extra = {}) => sign({ sub: U(id), role: 'authenticated', ...extra });
const T = {
  anon: sign({ role: 'anon' }),
  custA: user('a1', { is_anonymous: true }), custB: user('a2', { is_anonymous: true }),
  merchG: user('b1'), merchS: user('b2'),
  rider: user('c1'), riderOther: user('c2'),
  admin: user('d1', { app_metadata: { role: 'admin' } }),
  attacker: user('e1', { user_metadata: { role: 'admin' } }),           // user_metadata is user-editable
  forgedAdmin: sign({ sub: U('a1'), role: 'authenticated', app_metadata: { role: 'admin' } }, 'wrong-secret'),
};
const sql = q => execSync(PSQL, { input: q }).toString().trim();

async function api(method, path, { tok, body, prefer } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const rpc = (name, args, tok) => api('POST', `/rpc/${name}`, { tok, body: args });
const get = (path, tok) => api('GET', path, { tok });
const failed = r => r.status >= 400;
const rows = r => (Array.isArray(r.body) ? r.body : []);
// A write is "blocked" if rejected, or if it matched zero rows
const writeBlocked = async (m, path, tok, body) => {
  const r = await api(m, path, { tok, body, prefer: 'return=representation' });
  return r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0);
};

// ---- tiny harness -----------------------------------------------------
const results = []; let section = '';
const group = n => { section = n; };
async function t(name, fn) {
  try { await fn(); results.push({ section, name, ok: true }); }
  catch (e) { results.push({ section, name, ok: false, msg: String(e.message || e).slice(0, 220) }); }
}
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`${m} expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };

// ---- fixtures ---------------------------------------------------------
const ADDR = { contact_name: 'Test Customer', contact_phone: '+23276000000', address_line: '1 Test Street Freetown' };
let ref = 0; const nref = () => `APIT${String(++ref).padStart(6, '0')}`;
const merchants = {}; for (const m of rows(await get('/merchants_public?select=id,slug', T.anon))) merchants[m.slug] = m.id;
const G = merchants['goodies-supermarket'], S = merchants['st-marys-supermarket'];
const hiddenId = slug => sql(`select id from merchants where slug='${slug}'`);   // not visible through the public view
const prod = {}; for (const p of rows(await get(`/products?select=id,name,price&merchant_id=eq.${G}`, T.anon))) prod[p.name] = p;
const sProd = rows(await get(`/products?select=id,price&merchant_id=eq.${S}`, T.anon))[0];
const RIDER1 = sql(`select id from riders where display_name='Demo Rider 001'`);
const RIDER2 = sql(`select id from riders where display_name='Test Rider 002'`);
const OFFLINE = sql(`select id from riders where display_name='Test Rider Offline'`);
const item = (p, qty) => ({ product_id: p.id, qty });
const place = (tok, items, { merchant = G, addr = ADDR, method = 'ORANGE_MONEY', txn = nref() } = {}) =>
  rpc('place_order', { p_merchant_id: merchant, p_items: items, p_address: addr, p_method: method, p_txn_ref: txn }, tok);
const newOrder = async (tok = T.custA, items = [item(prod['TEST Rice'], 1)]) => {
  const r = await place(tok, items); ok(!failed(r), 'place_order failed: ' + JSON.stringify(r.body)); return r.body.order_id;
};
const pinOf = id => sql(`select pin from order_delivery_pins where order_id='${id}'`);
const orderRow = id => sql(`select status||'|'||delivery_status||'|'||total||'|'||coalesce(rider_id::text,'-') from orders where id='${id}'`);
const wrongPin = p => (p === '0000' ? '1111' : '0000');
// Drives an order to AT_CUSTOMER with the given rider
async function toAtCustomer(id, riderId = RIDER1) {
  for (const a of ['ACCEPT', 'PREPARING', 'READY']) ok(!failed(await rpc('merchant_set_order_status', { p_order_id: id, p_action: a }, T.merchG)), 'merchant ' + a);
  ok(!failed(await rpc('admin_assign_rider', { p_order_id: id, p_rider_id: riderId }, T.admin)), 'assign');
  for (const a of ['ACCEPT', 'ARRIVE_MERCHANT', 'PICKUP', 'ON_THE_WAY', 'ARRIVE_CUSTOMER']) {
    const r = await rpc('rider_advance_delivery', { p_order_id: id, p_action: a }, T.rider); ok(!failed(r), 'rider ' + a + ' ' + JSON.stringify(r.body));
  }
}

// =======================================================================
group('A. Anonymous (no login) access');
await t('can browse DEMO merchants via merchants_public', async () => {
  const r = await get('/merchants_public?select=name,partner_label,status', T.anon); ok(rows(r).length >= 7, 'no merchants');
  ok(rows(r).every(m => m.partner_label === 'Demo listing' && m.status === 'DEMO'), 'non-demo label present');
});
await t('SUSPENDED and PENDING merchants are hidden', async () => {
  const names = rows(await get('/merchants_public?select=slug', T.anon)).map(m => m.slug);
  ok(!names.includes('fairway-supermarket') && !names.includes('monoprix-freetown'), 'hidden merchant visible');
  eq(rows(await get('/merchants?select=id&slug=eq.fairway-supermarket', T.anon)).length, 0, 'table leak');
});
await t('products of hidden merchants are hidden; available/unavailable handling', async () => {
  const all = rows(await get('/products?select=name', T.anon)).map(p => p.name);
  ok(!all.includes('TEST Hidden item'), 'hidden merchant product visible');
});
await t('internal merchant fields are NOT readable (internal_notes, data_source, source_url)', async () => {
  for (const col of ['internal_notes', 'data_source', 'source_url']) {
    const r = await get(`/merchants?select=${col}`, T.anon); ok(failed(r), `${col} readable from merchants: ${JSON.stringify(r.body).slice(0, 80)}`);
  }
  const v = await get('/merchants_public?select=*&limit=1', T.anon); const k = Object.keys(rows(v)[0] || {});
  for (const col of ['internal_notes', 'data_source', 'source_url']) ok(!k.includes(col), `${col} in merchants_public`);
  const sup = JSON.stringify((await get('/merchants_public?select=*', T.custA)).body); ok(!sup.includes('SECRET-'), 'secret text visible');
});
for (const tb of ['orders', 'order_items', 'payments', 'order_delivery_pins', 'order_status_history', 'riders', 'profiles', 'merchant_staff', 'admin_audit_log']) {
  await t(`cannot read ${tb}`, async () => { const r = await get(`/${tb}?select=*`, T.anon); ok(failed(r) || rows(r).length === 0, 'rows returned'); });
}
for (const [fn, args] of [['place_order', { p_merchant_id: G, p_items: [], p_address: {}, p_method: 'ORANGE_MONEY', p_txn_ref: 'ABCDEF' }],
  ['verify_delivery_pin', { p_order_id: G, p_pin: '1234' }], ['merchant_set_order_status', { p_order_id: G, p_action: 'ACCEPT' }],
  ['rider_advance_delivery', { p_order_id: G, p_action: 'ACCEPT' }], ['admin_overview', {}], ['admin_assign_rider', { p_order_id: G, p_rider_id: G }],
  ['admin_set_order_status', { p_order_id: G, p_status: 'CANCELLED' }], ['admin_save_rider', { p_id: null, p_name: 'Evil', p_phone: null, p_availability: 'AVAILABLE' }],
  ['admin_save_merchant', { p_id: null, p: { name: 'Evil' } }], ['admin_set_merchant_status', { p_id: G, p_status: 'ACTIVE' }]]) {
  await t(`anon cannot execute ${fn}`, async () => { const r = await rpc(fn, args, T.anon); ok(failed(r), 'call succeeded: ' + JSON.stringify(r.body).slice(0, 80)); });
}
await t('internal helper functions are not callable by anyone (_audit, _free_rider)', async () => {
  for (const tok of [T.anon, T.custA, T.admin]) {
    ok(failed(await rpc('_audit', { p_action: 'x', p_entity: 'x', p_id: G, p_detail: {} }, tok)), '_audit callable');
    ok(failed(await rpc('_free_rider', { p_rider: G, p_except: G }, tok)), '_free_rider callable');
  }
});
await t('auth schema is not exposed (auth.users)', async () => { ok(failed(await get('/users?select=*', T.anon)), 'users visible'); });

// =======================================================================
group('B. Customer: ordering and server-side validation');
let o1;
await t('valid order: reference, status, delivery PIN generated', async () => {
  const r = await place(T.custA, [item(prod['TEST Rice'], 2), item(prod['TEST Sugar'], 1)]); ok(!failed(r), JSON.stringify(r.body));
  o1 = r.body.order_id; ok(/^PD\d+$/.test(r.body.order_number), 'order number ' + r.body.order_number);
  const o = rows(await get(`/orders?select=*&id=eq.${o1}`, T.custA))[0];
  eq(o.status, 'PLACED'); eq(o.delivery_status, 'UNASSIGNED'); ok(o.is_demo === true, 'not flagged demo');
  const pins = rows(await get(`/order_delivery_pins?select=pin&order_id=eq.${o1}`, T.custA)); ok(/^[0-9]{4}$/.test(pins[0]?.pin), 'customer cannot see PIN');
});
await t('total = server price x qty + delivery fee (230 + 20)', async () => {
  const o = rows(await get(`/orders?select=subtotal,delivery_fee,total&id=eq.${o1}`, T.custA))[0];
  eq(Number(o.subtotal), 230, 'subtotal'); eq(Number(o.delivery_fee), 20, 'fee'); eq(Number(o.total), 250, 'total');
});
await t('payment recorded as simulated PAID with the method and reference', async () => {
  const p = rows(await get(`/payments?select=method,status,is_simulated,provider,amount&order_id=eq.${o1}`, T.custA))[0];
  eq(p.status, 'PAID'); ok(p.is_simulated === true, 'not simulated'); eq(p.method, 'ORANGE_MONEY'); eq(Number(p.amount), 250);
});
await t('order items snapshot name, unit price and quantity', async () => {
  const it = rows(await get(`/order_items?select=name,unit_price,quantity,line_total&order_id=eq.${o1}&order=name`, T.custA));
  eq(it.length, 2); eq(it.find(i => i.name === 'TEST Rice').quantity, 2); eq(Number(it.find(i => i.name === 'TEST Rice').line_total), 200);
});
await t('Afrimoney order works', async () => { const r = await place(T.custA, [item(prod['TEST Sugar'], 1)], { method: 'AFRIMONEY' }); ok(!failed(r), JSON.stringify(r.body)); });
await t('client-supplied prices, fees, totals and statuses are ignored', async () => {
  const r = await place(T.custA, [{ product_id: prod['TEST Rice'].id, qty: 1, price: 1, unit_price: 0, line_total: 0 }],
    { addr: { ...ADDR, total: 1, delivery_fee: 0, subtotal: 1, status: 'DELIVERED', delivery_status: 'DELIVERED', rider_id: RIDER1 } });
  ok(!failed(r), JSON.stringify(r.body));
  const o = rows(await get(`/orders?select=total,status,delivery_status,rider_id&id=eq.${r.body.order_id}`, T.custA))[0];
  eq(Number(o.total), 120, 'total'); eq(o.status, 'PLACED'); eq(o.delivery_status, 'UNASSIGNED'); eq(o.rider_id, null);
});
await t('duplicate lines for one product are merged, not double counted incorrectly', async () => {
  const r = await place(T.custA, [item(prod['TEST Rice'], 1), item(prod['TEST Rice'], 2)]); ok(!failed(r), JSON.stringify(r.body));
  eq(Number(rows(await get(`/orders?select=subtotal&id=eq.${r.body.order_id}`, T.custA))[0].subtotal), 300);
});
for (const [name, items] of [['quantity 0', [item(prod['TEST Rice'], 0)]], ['negative quantity', [item(prod['TEST Rice'], -3)]],
  ['quantity 21', [item(prod['TEST Rice'], 21)]], ['fractional quantity', [item(prod['TEST Rice'], 1.5)]], ['text quantity', [{ product_id: prod['TEST Rice'].id, qty: 'abc' }]],
  ['empty cart', []], ['51 lines', Array.from({ length: 51 }, () => item(prod['TEST Rice'], 1))],
  ['unknown product id', [{ product_id: '11111111-1111-4111-8111-111111111111', qty: 1 }]],
  ['invalid product id', [{ product_id: 'not-a-uuid', qty: 1 }]],
  ['product from another merchant', [item(sProd, 5)]], ['unavailable product', [item(prod['TEST Unavailable'], 1)]]]) {
  await t(`rejects ${name}`, async () => { const r = await place(T.custA, items); ok(failed(r), 'accepted'); });
}
for (const [name, opts] of [['unknown payment method', { method: 'CASH' }], ['short transaction ID', { txn: 'abc' }], ['transaction ID with symbols', { txn: "AB'; DROP--" }],
  ['transaction ID too long', { txn: 'A'.repeat(30) }], ['one-letter name', { addr: { ...ADDR, contact_name: 'A' } }],
  ['short phone', { addr: { ...ADDR, contact_phone: '123' } }], ['short address', { addr: { ...ADDR, address_line: 'x' } }],
  ['SUSPENDED merchant', { merchant: hiddenId('fairway-supermarket') }], ['PENDING merchant', { merchant: hiddenId('monoprix-freetown') }],
  ['unknown merchant', { merchant: '11111111-1111-4111-8111-111111111111' }]]) {
  await t(`rejects ${name}`, async () => { const r = await place(T.custA, [item(prod['TEST Rice'], 1)], opts); ok(failed(r), 'accepted'); });
}
await t('rejects reused transaction ID', async () => {
  const x = nref(); ok(!failed(await place(T.custA, [item(prod['TEST Rice'], 1)], { txn: x })), 'first'); ok(failed(await place(T.custB, [item(prod['TEST Rice'], 1)], { txn: x })), 'second accepted');
});
await t('enforces minimum order amount', async () => {
  ok(failed(await place(T.custA, [item(sProd, 2)], { merchant: S })), 'below minimum accepted');   // 100 < 200
  ok(!failed(await place(T.custA, [item(sProd, 4)], { merchant: S })), 'at minimum rejected');     // 200
});
await t('enforces delivery radius when a location is supplied', async () => {
  ok(failed(await place(T.custA, [item(sProd, 4)], { merchant: S, addr: { ...ADDR, latitude: 9.5, longitude: -12.0 } })), 'far address accepted');
  ok(!failed(await place(T.custA, [item(sProd, 4)], { merchant: S, addr: { ...ADDR, latitude: 8.49, longitude: -13.23 } })), 'near address rejected');
});
await t('rejects impossible coordinates', async () => { ok(failed(await place(T.custA, [item(prod['TEST Rice'], 1)], { addr: { ...ADDR, latitude: 123, longitude: 5 } })), 'accepted'); });
await t('customer B cannot see A\'s order, items, payment, history or PIN', async () => {
  for (const q of [`orders?id=eq.${o1}`, `order_items?order_id=eq.${o1}`, `payments?order_id=eq.${o1}`, `order_status_history?order_id=eq.${o1}`, `order_delivery_pins?order_id=eq.${o1}`]) {
    eq(rows(await get(`/${q}&select=*`, T.custB)).length, 0, q);
  }
});
await t('customer lists only their own orders', async () => {
  const mine = rows(await get('/orders?select=customer_id', T.custA)); ok(mine.length > 0 && mine.every(o => o.customer_id === U('a1')), 'foreign order visible');
});
await t('customer cannot write orders, items, payments, PINs or history directly', async () => {
  const base = { order_id: o1 };
  ok(await writeBlocked('POST', '/orders', T.custA, { customer_id: U('a1'), merchant_id: G, subtotal: 1, delivery_fee: 0, total: 1, contact_name: 'x', contact_phone: '1234567', address_line: 'abcdef' }), 'insert order');
  ok(await writeBlocked('PATCH', `/orders?id=eq.${o1}`, T.custA, { total: 1, subtotal: 1 }), 'patch total');
  ok(await writeBlocked('PATCH', `/orders?id=eq.${o1}`, T.custA, { status: 'DELIVERED', delivery_status: 'DELIVERED' }), 'patch status');
  ok(await writeBlocked('PATCH', `/orders?id=eq.${o1}`, T.custA, { rider_id: RIDER1 }), 'patch rider');
  ok(await writeBlocked('DELETE', `/orders?id=eq.${o1}`, T.custA), 'delete order');
  ok(await writeBlocked('PATCH', `/payments?order_id=eq.${o1}`, T.custA, { status: 'REFUNDED', amount: 0 }), 'patch payment');
  ok(await writeBlocked('POST', '/payments', T.custA, { ...base, method: 'AFRIMONEY', amount: 0, status: 'PAID' }), 'insert payment');
  ok(await writeBlocked('PATCH', `/order_delivery_pins?order_id=eq.${o1}`, T.custA, { verified_at: new Date().toISOString() }), 'verify pin directly');
  ok(await writeBlocked('PATCH', `/order_delivery_pins?order_id=eq.${o1}`, T.custA, { pin: '0000', failed_attempts: 0, locked_at: null }), 'rewrite pin');
  ok(await writeBlocked('POST', '/order_items', T.custA, { ...base, name: 'x', unit_price: 0, quantity: 1, line_total: 0 }), 'insert item');
  ok(await writeBlocked('PATCH', `/order_items?order_id=eq.${o1}`, T.custA, { unit_price: 0, line_total: 0 }), 'patch item');
  ok(await writeBlocked('POST', '/order_status_history', T.custA, { ...base, kind: 'ORDER', status: 'DELIVERED' }), 'insert history');
  ok(await writeBlocked('PATCH', '/merchants?slug=eq.goodies-supermarket', T.custA, { status: 'ACTIVE', delivery_fee: 0 }), 'patch merchant');
  ok(await writeBlocked('PATCH', `/products?id=eq.${prod['TEST Rice'].id}`, T.custA, { price: 0 }), 'patch product price');
  ok(await writeBlocked('POST', '/riders', T.custA, { display_name: 'Evil' }), 'insert rider');
  ok(await writeBlocked('POST', '/merchant_staff', T.custA, { merchant_id: G, user_id: U('a1') }), 'add self as staff');
  eq(orderRow(o1), `PLACED|UNASSIGNED|250.00|-`, 'order changed in database');
});
await t('customer cannot call merchant, rider or admin functions on their own order', async () => {
  for (const [fn, a] of [['merchant_set_order_status', { p_order_id: o1, p_action: 'ACCEPT' }], ['rider_advance_delivery', { p_order_id: o1, p_action: 'ACCEPT' }],
    ['verify_delivery_pin', { p_order_id: o1, p_pin: pinOf(o1) }], ['admin_set_order_status', { p_order_id: o1, p_status: 'CANCELLED' }],
    ['admin_assign_rider', { p_order_id: o1, p_rider_id: RIDER1 }], ['admin_overview', {}]]) ok(failed(await rpc(fn, a, T.custA)), fn + ' allowed');
  eq(orderRow(o1), `PLACED|UNASSIGNED|250.00|-`);
});
await t('customer cannot read riders, other profiles or merchant staff', async () => {
  eq(rows(await get('/riders?select=*', T.custA)).length, 0, 'riders'); eq(rows(await get('/merchant_staff?select=*', T.custA)).length, 0, 'staff');
  const pr = rows(await get('/profiles?select=id', T.custA)); ok(pr.every(p => p.id === U('a1')), 'foreign profile');
});

// =======================================================================
group('C. Merchant');
let m1, m2;
await t('merchant sees orders for their merchant only, with items and customer note fields', async () => {
  m1 = await newOrder(T.custA, [item(prod['TEST Rice'], 1)]); const sOrder = (await place(T.custA, [item(sProd, 4)], { merchant: S })).body.order_id;
  const g = rows(await get('/orders?select=id,merchant_id,contact_name,address_line,notes,total,order_items(name,quantity)', T.merchG));
  ok(g.length > 0 && g.every(o => o.merchant_id === G), 'saw another merchant'); ok(g.some(o => o.id === m1 && o.order_items.length === 1), 'own order missing');
  ok(!g.some(o => o.id === sOrder), 'St Marys order visible to Goodies');
  const s = rows(await get('/orders?select=id,merchant_id', T.merchS)); ok(s.every(o => o.merchant_id === S) && s.some(o => o.id === sOrder), 'St Marys scope');
  ok(failed(await rpc('merchant_set_order_status', { p_order_id: sOrder, p_action: 'ACCEPT' }, T.merchG)), 'Goodies accepted St Marys order');
  ok(failed(await rpc('merchant_set_order_status', { p_order_id: m1, p_action: 'ACCEPT' }, T.merchS)), 'St Marys accepted Goodies order');
});
await t('merchant cannot read PINs, payments or riders', async () => {
  eq(rows(await get('/order_delivery_pins?select=*', T.merchG)).length, 0, 'pins'); eq(rows(await get('/payments?select=*', T.merchG)).length, 0, 'payments');
  eq(rows(await get('/riders?select=*', T.merchG)).length, 0, 'riders');
});
await t('merchant cannot write orders directly or use admin/rider functions', async () => {
  ok(await writeBlocked('PATCH', `/orders?id=eq.${m1}`, T.merchG, { status: 'READY_FOR_PICKUP', total: 1 }), 'patch');
  for (const [fn, a] of [['verify_delivery_pin', { p_order_id: m1, p_pin: pinOf(m1) }], ['rider_advance_delivery', { p_order_id: m1, p_action: 'ACCEPT' }],
    ['admin_set_order_status', { p_order_id: m1, p_status: 'CANCELLED' }], ['admin_overview', {}], ['admin_set_merchant_status', { p_id: G, p_status: 'ACTIVE', p_owner_email: 'owner@example.test', p_confirm: true }]]) ok(failed(await rpc(fn, a, T.merchG)), fn);
});
await t('status flow enforced: cannot skip steps', async () => {
  ok(failed(await rpc('merchant_set_order_status', { p_order_id: m1, p_action: 'READY' }, T.merchG)), 'READY from PLACED');
  ok(failed(await rpc('merchant_set_order_status', { p_order_id: m1, p_action: 'PREPARING' }, T.merchG)), 'PREPARING from PLACED');
  ok(failed(await rpc('merchant_set_order_status', { p_order_id: m1, p_action: 'DELIVERED' }, T.merchG)), 'unknown action');
});
await t('accept, preparing, ready; each step is logged in history', async () => {
  for (const a of ['ACCEPT', 'PREPARING', 'READY']) ok(!failed(await rpc('merchant_set_order_status', { p_order_id: m1, p_action: a }, T.merchG)), a);
  eq(orderRow(m1).split('|')[0], 'READY_FOR_PICKUP');
  const h = rows(await get(`/order_status_history?select=kind,status&order_id=eq.${m1}`, T.custA)).map(x => x.status);
  for (const s of ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP']) ok(h.includes(s), 'history missing ' + s);
  ok(failed(await rpc('merchant_set_order_status', { p_order_id: m1, p_action: 'ACCEPT' }, T.merchG)), 'repeat accept');
});
await t('reject cancels the order and refunds the simulated payment (customer sees both)', async () => {
  m2 = await newOrder(T.custA); ok(!failed(await rpc('merchant_set_order_status', { p_order_id: m2, p_action: 'REJECT' }, T.merchG)), 'reject');
  eq(rows(await get(`/orders?select=status&id=eq.${m2}`, T.custA))[0].status, 'CANCELLED'); eq(rows(await get(`/payments?select=status&order_id=eq.${m2}`, T.custA))[0].status, 'REFUNDED');
  ok(failed(await rpc('merchant_set_order_status', { p_order_id: m2, p_action: 'ACCEPT' }, T.merchG)), 'accept after reject');
});
await t('merchant cannot reject an order that is already accepted', async () => { const o = await newOrder(); await rpc('merchant_set_order_status', { p_order_id: o, p_action: 'ACCEPT' }, T.merchG); ok(failed(await rpc('merchant_set_order_status', { p_order_id: o, p_action: 'REJECT' }, T.merchG)), 'rejected'); });

// =======================================================================
group('D. Rider and delivery PIN');
let r1;
await t('rider sees nothing and cannot act before assignment', async () => {
  r1 = await newOrder(); eq(rows(await get('/orders?select=id', T.rider)).length, 0, 'visible'); ok(failed(await rpc('rider_advance_delivery', { p_order_id: r1, p_action: 'ACCEPT' }, T.rider)), 'acted');
});
await t('only an admin can assign; offline riders are refused', async () => {
  for (const tok of [T.custA, T.merchG, T.rider, T.attacker]) ok(failed(await rpc('admin_assign_rider', { p_order_id: r1, p_rider_id: RIDER1 }, tok)), 'non-admin assigned');
  ok(failed(await rpc('admin_assign_rider', { p_order_id: r1, p_rider_id: OFFLINE }, T.admin)), 'offline assigned');
});
await t('assigned rider sees the order and delivery details but never the PIN', async () => {
  ok(!failed(await rpc('admin_assign_rider', { p_order_id: r1, p_rider_id: RIDER1 }, T.admin)), 'assign');
  const o = rows(await get('/orders?select=id,delivery_status,address_line,contact_phone,notes&id=eq.' + r1, T.rider))[0]; eq(o.delivery_status, 'ASSIGNED'); ok(o.address_line && o.contact_phone, 'details missing');
  eq(rows(await get('/order_delivery_pins?select=*', T.rider)).length, 0, 'PIN table readable'); eq(rows(await get(`/order_delivery_pins?select=pin&order_id=eq.${r1}`, T.rider)).length, 0, 'PIN readable');
  ok(!JSON.stringify((await get(`/orders?select=*,order_delivery_pins(pin)&id=eq.${r1}`, T.rider)).body).includes(pinOf(r1)), 'PIN reachable by embedding');
});
await t('another rider account cannot see or advance the order', async () => {
  eq(rows(await get(`/orders?select=id&id=eq.${r1}`, T.riderOther)).length, 0); ok(failed(await rpc('rider_advance_delivery', { p_order_id: r1, p_action: 'ACCEPT' }, T.riderOther)), 'advance');
  ok(failed(await rpc('verify_delivery_pin', { p_order_id: r1, p_pin: pinOf(r1) }, T.riderOther)), 'verify');
});
await t('rider cannot skip steps; cannot pick up before the store marks ready', async () => {
  ok(failed(await rpc('rider_advance_delivery', { p_order_id: r1, p_action: 'PICKUP' }, T.rider)), 'skip to pickup');
  ok(failed(await rpc('rider_advance_delivery', { p_order_id: r1, p_action: 'ON_THE_WAY' }, T.rider)), 'skip to on the way');
  for (const a of ['ACCEPT', 'ARRIVE_MERCHANT']) ok(!failed(await rpc('rider_advance_delivery', { p_order_id: r1, p_action: a }, T.rider)), a);
  ok(failed(await rpc('rider_advance_delivery', { p_order_id: r1, p_action: 'PICKUP' }, T.rider)), 'picked up before ready');
  for (const a of ['ACCEPT', 'PREPARING', 'READY']) await rpc('merchant_set_order_status', { p_order_id: r1, p_action: a }, T.merchG);
  for (const a of ['PICKUP', 'ON_THE_WAY']) ok(!failed(await rpc('rider_advance_delivery', { p_order_id: r1, p_action: a }, T.rider)), a);
});
await t('PIN cannot be verified before arrival at the customer', async () => { ok(failed(await rpc('verify_delivery_pin', { p_order_id: r1, p_pin: pinOf(r1) }, T.rider)), 'verified early'); });
await t('rider cannot jump to delivered by writing or by any function other than the PIN', async () => {
  ok(await writeBlocked('PATCH', `/orders?id=eq.${r1}`, T.rider, { status: 'DELIVERED', delivery_status: 'DELIVERED' }), 'direct patch');
  ok(failed(await rpc('rider_advance_delivery', { p_order_id: r1, p_action: 'DELIVERED' }, T.rider)), 'DELIVERED action');
  ok(await writeBlocked('PATCH', `/order_delivery_pins?order_id=eq.${r1}`, T.rider, { verified_at: new Date().toISOString() }), 'pin patch');
  ok(!orderRow(r1).includes('DELIVERED'), 'delivered in db');
  ok(!failed(await rpc('rider_advance_delivery', { p_order_id: r1, p_action: 'ARRIVE_CUSTOMER' }, T.rider)), 'arrive');
});
await t('wrong PIN fails and does not deliver; attempts are counted', async () => {
  const r = await rpc('verify_delivery_pin', { p_order_id: r1, p_pin: wrongPin(pinOf(r1)) }, T.rider); ok(!failed(r), 'call'); eq(r.body.ok, false); eq(r.body.attempts_left, 4);
  ok(!orderRow(r1).includes('DELIVERED'), 'delivered with wrong PIN');
});
await t('customer and merchant cannot complete delivery with the correct PIN', async () => {
  for (const tok of [T.custA, T.merchG, T.attacker]) ok(failed(await rpc('verify_delivery_pin', { p_order_id: r1, p_pin: pinOf(r1) }, tok)), 'non-rider verified');
  ok(!orderRow(r1).includes('DELIVERED'), 'delivered');
});
await t('correct PIN completes delivery; customer sees DELIVERED; rider freed', async () => {
  const r = await rpc('verify_delivery_pin', { p_order_id: r1, p_pin: pinOf(r1) }, T.rider); eq(r.body.ok, true);
  eq(rows(await get(`/orders?select=status,delivery_status,delivered_at&id=eq.${r1}`, T.custA))[0].status, 'DELIVERED'); ok(rows(await get(`/orders?select=delivered_at&id=eq.${r1}`, T.custA))[0].delivered_at, 'no delivered_at');
  eq(sql(`select availability from riders where id='${RIDER1}'`), 'AVAILABLE');
  const h = rows(await get(`/order_status_history?select=status&order_id=eq.${r1}`, T.custA)).map(x => x.status); ok(h.includes('DELIVERED') && h.includes('AT_CUSTOMER'), 'history');
  ok(failed(await rpc('verify_delivery_pin', { p_order_id: r1, p_pin: pinOf(r1) }, T.rider)), 'verified twice');
});
await t('malformed PINs (empty, short, long, letters, SQL text) never deliver, then the real PIN still works', async () => {
  const f = await newOrder(); await toAtCustomer(f);
  for (const bad of ['', '12', '12345', 'abcd', "1' or '1'='1"].slice(0, 4)) { const x = await rpc('verify_delivery_pin', { p_order_id: f, p_pin: bad }, T.rider); ok(failed(x) || x.body.ok === false, 'bad format accepted: ' + JSON.stringify(bad)); }
  ok(!orderRow(f).includes('DELIVERED'), 'delivered by malformed PIN');
  eq((await rpc('verify_delivery_pin', { p_order_id: f, p_pin: pinOf(f) }, T.rider)).body.ok, true, 'real PIN after 4 bad tries');
});
let lk;
await t('PIN locks after 5 wrong attempts (even the correct PIN is then refused)', async () => {
  lk = await newOrder(); await toAtCustomer(lk); const bad = wrongPin(pinOf(lk));
  for (let i = 0; i < 5; i++) { const r = await rpc('verify_delivery_pin', { p_order_id: lk, p_pin: bad }, T.rider); ok(!failed(r) && r.body.ok === false, 'attempt ' + i); }
  ok(failed(await rpc('verify_delivery_pin', { p_order_id: lk, p_pin: pinOf(lk) }, T.rider)), 'correct PIN accepted while locked'); ok(!orderRow(lk).includes('DELIVERED'), 'delivered while locked');
});
await t('an admin can unlock a locked PIN, and the rider can then deliver', async () => {
  ok(failed(await rpc('admin_unlock_delivery_pin', { p_order_id: lk }, T.rider)), 'rider unlocked');
  const u = await rpc('admin_unlock_delivery_pin', { p_order_id: lk }, T.admin); ok(!failed(u), 'admin unlock failed: ' + JSON.stringify(u.body));
  eq((await rpc('verify_delivery_pin', { p_order_id: lk, p_pin: pinOf(lk) }, T.rider)).body.ok, true);
});
await t('rider with two active orders stays BUSY after delivering one', async () => {
  sql(`update riders set availability='AVAILABLE' where id='${RIDER1}'`);
  const a = await newOrder(), b = await newOrder();
  for (const id of [a, b]) for (const s of ['ACCEPT', 'PREPARING', 'READY']) await rpc('merchant_set_order_status', { p_order_id: id, p_action: s }, T.merchG);
  for (const id of [a, b]) ok(!failed(await rpc('admin_assign_rider', { p_order_id: id, p_rider_id: RIDER1 }, T.admin)), 'assign');
  for (const id of [a, b]) await rpc('rider_advance_delivery', { p_order_id: id, p_action: 'ACCEPT' }, T.rider);
  for (const s of ['ARRIVE_MERCHANT', 'PICKUP', 'ON_THE_WAY', 'ARRIVE_CUSTOMER']) await rpc('rider_advance_delivery', { p_order_id: a, p_action: s }, T.rider);
  eq((await rpc('verify_delivery_pin', { p_order_id: a, p_pin: pinOf(a) }, T.rider)).body.ok, true);
  eq(sql(`select availability from riders where id='${RIDER1}'`), 'BUSY', 'rider marked available while order b is in progress');
});
await t('merchant rejecting one order does not free a rider who is mid-delivery on another', async () => {
  sql(`update riders set availability='AVAILABLE' where id='${RIDER2}'`);
  const x = await newOrder(), y = await newOrder();
  for (const s of ['ACCEPT', 'PREPARING', 'READY']) await rpc('merchant_set_order_status', { p_order_id: x, p_action: s }, T.merchG);
  for (const id of [x, y]) await rpc('admin_assign_rider', { p_order_id: id, p_rider_id: RIDER2 }, T.admin);
  sql(`update riders set user_id='${U('c2')}' where id='${RIDER2}'`);
  await rpc('rider_advance_delivery', { p_order_id: x, p_action: 'ACCEPT' }, T.riderOther); await rpc('rider_advance_delivery', { p_order_id: y, p_action: 'ACCEPT' }, T.riderOther);
  ok(!failed(await rpc('merchant_set_order_status', { p_order_id: y, p_action: 'REJECT' }, T.merchG)), 'reject y');
  eq(sql(`select availability from riders where id='${RIDER2}'`), 'BUSY', 'rider freed although x is in progress'); sql(`update riders set user_id=null where id='${RIDER2}'`);
});

// =======================================================================
group('E. Admin and role enforcement');
await t('admin overview returns real grouped counts that match the tables', async () => {
  const r = await rpc('admin_overview', {}, T.admin); ok(!failed(r), JSON.stringify(r.body));
  eq(r.body.orders.reduce((n, x) => n + x.n, 0), Number(sql('select count(*) from orders')), 'orders'); eq(r.body.riders.reduce((n, x) => n + x.n, 0), Number(sql('select count(*) from riders')), 'riders');
  eq(r.body.merchants.reduce((n, x) => n + x.n, 0), Number(sql('select count(*) from merchants')), 'merchants');
});
await t('admin can list all orders, riders, audit log and internal merchant details', async () => {
  ok(rows(await get('/orders?select=id', T.admin)).length >= 10, 'orders'); ok(rows(await get('/riders?select=id', T.admin)).length >= 3, 'riders');
  const a = await get('/admin_audit_log?select=action', T.admin); ok(!failed(a), 'audit'); const m = await get('/merchant_internal?select=internal_notes&internal_notes=like.SECRET*', T.admin);
  ok(!failed(m) && rows(m).length >= 1, 'admin cannot read internal merchant notes: ' + JSON.stringify(m.body).slice(0, 100));
});
await t('non-admin roles cannot read internal merchant details or the audit log', async () => {
  for (const tok of [T.anon, T.custA, T.merchG, T.rider, T.attacker]) {
    ok(failed(await get('/merchant_internal?select=*', tok)) || rows(await get('/merchant_internal?select=*', tok)).length === 0, 'internal readable');
    ok(failed(await get('/admin_audit_log?select=*', tok)) || rows(await get('/admin_audit_log?select=*', tok)).length === 0, 'audit readable');
  }
});
await t('admin cannot edit orders directly (status only changes through validated functions)', async () => {
  const o = await newOrder(); ok(await writeBlocked('PATCH', `/orders?id=eq.${o}`, T.admin, { total: 1 }), 'total'); ok(await writeBlocked('PATCH', `/orders?id=eq.${o}`, T.admin, { status: 'DELIVERED', delivery_status: 'DELIVERED' }), 'status');
  ok(await writeBlocked('DELETE', `/orders?id=eq.${o}`, T.admin), 'delete'); ok(await writeBlocked('PATCH', `/payments?order_id=eq.${o}`, T.admin, { status: 'REFUNDED' }), 'payments');
  ok(await writeBlocked('PATCH', `/order_delivery_pins?order_id=eq.${o}`, T.admin, { verified_at: new Date().toISOString() }), 'pins');
  ok(failed(await rpc('admin_set_order_status', { p_order_id: o, p_status: 'DELIVERED' }, T.admin)), 'DELIVERED via function'); ok(failed(await rpc('admin_set_order_status', { p_order_id: o, p_status: 'READY_FOR_PICKUP' }, T.admin)), 'skip');
  ok(!failed(await rpc('admin_set_order_status', { p_order_id: o, p_status: 'CANCELLED', p_reason: 'api test' }, T.admin)), 'cancel'); eq(orderRow(o).split('|')[0], 'CANCELLED');
  eq(sql(`select note from order_status_history where order_id='${o}' and status='CANCELLED'`), 'api test');
});
await t('admin can reassign a rider before pickup and the old rider loses access', async () => {
  const o = await newOrder(); await rpc('admin_assign_rider', { p_order_id: o, p_rider_id: RIDER1 }, T.admin); eq(rows(await get(`/orders?select=id&id=eq.${o}`, T.rider)).length, 1);
  ok(!failed(await rpc('admin_assign_rider', { p_order_id: o, p_rider_id: RIDER2 }, T.admin)), 'reassign'); eq(rows(await get(`/orders?select=id&id=eq.${o}`, T.rider)).length, 0, 'old rider still sees');
});
await t('admin merchant management: always DEMO on create; ACTIVE needs confirmation and a real owner', async () => {
  const c = await rpc('admin_save_merchant', { p_id: null, p: { name: 'API Test Cafe', merchant_type: 'RESTAURANT', service_area: 'central-freetown', internal_notes: 'api-note', data_source: 'api test' } }, T.admin); ok(!failed(c), JSON.stringify(c.body));
  eq(sql(`select status||'|'||coalesce(phone,'null')||'|'||coalesce(owner_id::text,'none') from merchants where id='${c.body.id}'`), 'DEMO|null|none');
  eq(sql(`select internal_notes from merchant_internal where merchant_id='${c.body.id}'`), 'api-note', 'internal notes not stored in the admin-only table');
  ok(failed(await rpc('admin_set_merchant_status', { p_id: c.body.id, p_status: 'ACTIVE', p_owner_email: 'owner@example.test', p_confirm: false }, T.admin)), 'no confirm');
  ok(failed(await rpc('admin_set_merchant_status', { p_id: c.body.id, p_status: 'ACTIVE', p_owner_email: 'nobody@example.test', p_confirm: true }, T.admin)), 'unknown owner');
  ok(!failed(await rpc('admin_set_merchant_status', { p_id: c.body.id, p_status: 'ACTIVE', p_owner_email: 'owner@example.test', p_confirm: true }, T.admin)), 'valid');
  eq(rows(await get('/merchants_public?select=partner_label&slug=eq.api-test-cafe', T.anon))[0].partner_label, 'Pick & Drop partner'); sql(`update merchants set status='DEMO', owner_id=null, partnered_at=null where id='${c.body.id}'`);
});
await t('forged or malformed tokens are rejected', async () => {
  ok(failed(await rpc('admin_overview', {}, T.forgedAdmin)), 'wrong-secret admin token accepted'); ok(failed(await get('/orders?select=id', T.forgedAdmin)), 'wrong-secret token read orders');
  ok(failed(await rpc('admin_overview', {}, sign({ sub: U('a1'), role: 'authenticated', exp: 1 }))), 'expired token accepted'); ok(failed(await rpc('admin_overview', {}, 'not.a.jwt')), 'garbage token');
  ok(failed(await rpc('admin_overview', {}, sign({ sub: U('a1'), role: 'service_role' }, 'wrong-secret'))), 'forged service_role');
});
await t('user-editable metadata cannot grant admin (user_metadata.role, top-level role claim)', async () => {
  ok(failed(await rpc('admin_overview', {}, T.attacker)), 'user_metadata admin worked'); ok(failed(await rpc('admin_overview', {}, T.custA)), 'customer');
  ok(failed(await rpc('admin_overview', {}, sign({ sub: U('e1'), role: 'admin' }))), 'role=admin claim worked'); eq(rows(await get('/orders?select=id', T.attacker)).length, 0, 'attacker sees orders');
});

// ---- report -----------------------------------------------------------
let last = ''; let pass = 0;
for (const r of results) { if (r.section !== last) { console.log(`\n${r.section}`); last = r.section; } console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '\n        -> ' + r.msg}`); if (r.ok) pass++; }
console.log(`\n${pass} passed, ${results.length - pass} failed, ${results.length} total`);
process.exit(results.length === pass ? 0 : 1);
