// Real-browser (Chromium) end-to-end test of the shipped pages.
//
// What is real:   Chromium, the unmodified HTML/CSS/JS in this repo (including js/config.js), the real supabase-js
//                 library, PostgREST and PostgreSQL with all migrations (RLS, functions, triggers).
// What is faked:  Supabase Auth (GoTrue): sign-in/sign-up endpoints are answered locally with signed test tokens.
//                 Supabase Realtime: the websocket is closed, so pages fall back to polling.
//                 Google Fonts and the supabase-js CDN URL are served locally (no internet in the test sandbox).
// NOT tested:     real Supabase Auth, real Realtime, Safari/Firefox, real phones, the live Vercel deployment.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../..');
const req = createRequire(import.meta.url);
const tryReq = (name, extra) => { for (const base of [here, path.join(ROOT, 'tests/pages'), extra].filter(Boolean)) { try { return createRequire(path.join(base, 'x.js'))(name); } catch { /* next */ } } throw new Error('Cannot load ' + name); };
const { chromium } = tryReq('playwright', '/opt/npm-tools/node_modules/');
const esbuild = tryReq('esbuild');

const PSQL = process.env.PSQL || 'su postgres -c "psql -tA -d pd"';
const API = process.env.API_URL || 'http://127.0.0.1:3000';
const SECRET = process.env.JWT_SECRET || 'test-only-secret-test-only-secret-1234';
const SHOTS = process.env.SHOTS || path.join(here, 'shots');
const PORT = 4173, ORIGIN = `http://localhost:${PORT}`;
fs.mkdirSync(SHOTS, { recursive: true });
const sql = q => execSync(PSQL, { input: q }).toString().trim();

const cfg = fs.readFileSync(path.join(ROOT, 'js/config.js'), 'utf8');
const SB = (cfg.match(/SUPABASE_URL\s*=\s*'([^']+)'/) || [])[1];
if (!SB || SB.startsWith('YOUR_')) throw new Error('js/config.js has no Supabase URL');

// ---------- tiny static server ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(new URL(rq.url, ORIGIN).pathname); if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rs.writeHead(404); return rs.end('not found'); }
  rs.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(rs);
});
await new Promise(r => server.listen(PORT, r));

// ---------- supabase-js for the browser, bundled locally ----------
const sbBundle = (await esbuild.build({ stdin: { contents: "export * from '@supabase/supabase-js'", resolveDir: path.join(ROOT, 'tests/pages'), loader: 'js' },
  bundle: true, format: 'esm', platform: 'browser', write: false, logLevel: 'error' })).outputFiles[0].text;

// ---------- fake GoTrue ----------
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const sign = payload => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload); return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const U = id => `00000000-0000-4000-8000-0000000000${id}`;
const STAFF = {
  'merchant-goodies@test': { id: U('b1') }, 'merchant-stmarys@test': { id: U('b2') }, 'rider@test': { id: U('c1') },
  'rider-other@test': { id: U('c2') }, 'admin@test': { id: U('d1'), app: { role: 'admin' } },
};
function session(id, email, anon, app = {}) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id, aud: 'authenticated', role: 'authenticated', email: email || '', is_anonymous: !!anon, app_metadata: { provider: anon ? 'anonymous' : 'email', ...app }, user_metadata: {}, created_at: new Date().toISOString() };
  const access_token = sign({ sub: id, aud: 'authenticated', role: 'authenticated', exp, is_anonymous: !!anon, email: email || undefined, app_metadata: user.app_metadata, user_metadata: {} });
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: b64({ id, email, anon, app }), user };
}
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': '*' };
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function wire(context, log) {
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/css' }, body: '' }));
  await context.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, r => r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'text/javascript' }, body: sbBundle }));
  await context.route(`${SB}/**`, async route => {
    const rq = route.request(), u = new URL(rq.url());
    if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    log.push(`${rq.method()} ${u.pathname}${u.search}`);
    if (u.pathname.startsWith('/rest/v1/')) {
      const h = { ...rq.headers() };
      if (!/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(h.authorization || '')) delete h.authorization;   // the gateway ignores a publishable key sent as a bearer
      delete h.apikey; delete h.host; delete h.origin; delete h.referer;
      const resp = await route.fetch({ url: API + u.pathname.replace('/rest/v1', '') + u.search, headers: h });
      return route.fulfill({ response: resp, headers: { ...resp.headers(), ...CORS } });
    }
    if (u.pathname === '/auth/v1/signup') {                                  // anonymous sign-in
      const id = crypto.randomUUID();
      sql(`insert into auth.users (id, is_anonymous, raw_app_meta_data, raw_user_meta_data) values ('${id}', true, '{}', '{}')`);
      return json(route, 200, session(id, '', true));
    }
    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(rq.postData() || '{}'), gt = u.searchParams.get('grant_type');
      if (gt === 'password') {
        const s = STAFF[String(body.email).toLowerCase()];
        if (!s || body.password !== 'pw') return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', code: 'invalid_credentials', message: 'Invalid login credentials' });
        return json(route, 200, session(s.id, body.email, false, s.app));
      }
      if (gt === 'refresh_token') { const r = JSON.parse(Buffer.from(body.refresh_token, 'base64url').toString()); return json(route, 200, session(r.id, r.email, r.anon, r.app)); }
    }
    if (u.pathname === '/auth/v1/user') { const t = (rq.headers().authorization || '').slice(7).split('.')[1]; const c = t ? JSON.parse(Buffer.from(t, 'base64url').toString()) : {}; return json(route, 200, session(c.sub, c.email, c.is_anonymous, c.app_metadata?.role ? { role: c.app_metadata.role } : {}).user); }
    if (u.pathname === '/auth/v1/logout') return route.fulfill({ status: 204, headers: CORS });
    return json(route, 404, { message: 'not faked: ' + u.pathname });
  });
  await context.routeWebSocket(/realtime\/v1\/websocket/, ws => ws.close());     // Realtime is not available in the test sandbox
}

// ---------- test harness ----------
let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); pass++; console.log('  PASS  ' + name); } catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n')[0]); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || 'expected'}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`); };

const browser = await chromium.launch();
const logs = {};
async function newUser(name, viewport) {
  const context = await browser.newContext({ viewport, baseURL: ORIGIN });
  logs[name] = []; await wire(context, logs[name]);
  const page = await context.newPage();
  page.on('dialog', d => d.accept('Test reason'));
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|realtime/i.test(m.text())) errors.push(m.text()); });
  return { context, page, errors, name };
}
const MOBILE = { width: 390, height: 844 }, DESKTOP = { width: 1280, height: 900 };
const shot = (u, n) => u.page.screenshot({ path: path.join(SHOTS, n + '.png'), fullPage: true });
const imagesOk = async (page, wait = 4000) => {
  await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach(i => { i.loading = 'eager'; }));   // off-screen lazy images never load in a static screenshot
  await page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: wait }).catch(() => {});
  return page.evaluate(() => [...document.images].filter(i => !i.complete || i.naturalWidth === 0).map(i => i.getAttribute('src')));
};
async function login(u, email, next) {
  await u.page.goto(`/login.html?next=${next}`);
  await u.page.fill('input[name=email]', email); await u.page.fill('input[name=password]', 'pw');
  await Promise.all([u.page.waitForURL(`**/${next}`), u.page.click('button.btn')]);
}

const cust = await newUser('customer', MOBILE);
let orderNum, pin, orderId, order2;

// =============== 1. CUSTOMER BROWSING (phone size) ===============
console.log('\n1. Customer browsing, photos and fallbacks');
await t('home page lists demo restaurants and grocers with pictures that actually loaded', async () => {
  await cust.page.goto('/index.html');
  await cust.page.waitForSelector('#restaurants .card'); await cust.page.waitForSelector('#groceries .card');
  ok((await cust.page.locator('#restaurants .card').count()) >= 4, 'restaurants');
  ok((await cust.page.locator('#groceries .card').count()) >= 2, 'groceries');
  const broken = await imagesOk(cust.page); eq(broken.length, 0, 'broken images ' + broken.join(','));
  ok(await cust.page.locator('#restaurants .card img[alt*="Demo Jollof Kitchen"]').count() === 1, 'descriptive alt text');
  ok(/Stock photo|Illustration/.test(await cust.page.textContent('body')), 'picture label (stock photo or illustration)');
  await shot(cust, '01-home-mobile');
});
await t('every listing is labelled demo / not partnered, never as a partner', async () => {
  const tags = await cust.page.locator('.card .tag').allTextContents();
  ok(tags.length >= 6 && tags.every(x => /Demo listing/.test(x)), tags.join('|'));
});
await t('restaurant menu shows a picture, name, description and price for each dish', async () => {
  await cust.page.click('a.card:has-text("Demo Jollof Kitchen")'); await cust.page.waitForSelector('.item [data-add]');
  eq(await cust.page.locator('.item').count(), 4, 'dishes');
  const broken = await imagesOk(cust.page); eq(broken.length, 0, 'broken ' + broken.join(','));
  const text = await cust.page.textContent('#menu'); ok(/Jollof rice with chicken/.test(text) && /NLe\s*90/.test(text), 'name and price');
  ok((await cust.page.locator('#m-cover img').count()) === 1, 'cover');
  await shot(cust, '02-restaurant-menu-mobile');
});
await t('grocery page shows product cards in a grid with pictures', async () => {
  await cust.page.goto('/merchant.html?slug=demo-corner-supermarket'); await cust.page.waitForSelector('.pcard');
  ok((await cust.page.locator('.pcard').count()) === 8, 'products');
  const broken = await imagesOk(cust.page); eq(broken.length, 0, 'broken ' + broken.join(','));
  await shot(cust, '03-grocery-grid-mobile');
});
if (fs.existsSync(path.join(ROOT, 'images/photos')) && fs.readdirSync(path.join(ROOT, 'images/photos')).some(f => f.endsWith('-800.jpg'))) {
  await t('dish photographs use responsive sources, load, and say they are illustrative', async () => {
    await cust.page.goto('/merchant.html?slug=demo-jollof-kitchen'); await cust.page.waitForSelector('.item [data-add]');
    await cust.page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach(i => { i.loading = 'eager'; }));
    await cust.page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 5000 }).catch(() => {});
    const info = await cust.page.evaluate(() => [...document.images].filter(i => i.srcset).map(i => ({ alt: i.alt, ok: i.complete && i.naturalWidth > 0 })));
    ok(info.length > 0, 'no image has a srcset'); ok(info.every(i => i.ok), 'a photograph failed to load'); ok(info.every(i => /illustrative photo|stock photo/.test(i.alt)), 'alt text: ' + info.map(i => i.alt).join('|'));
    await shot(cust, '02b-menu-photo-mobile');
  });
} else console.log('  SKIP  photograph checks: no photographs are installed in images/photos yet');
await t('every shop on the home page shows a photograph (none are left with the plain placeholder), on desktop too', async () => {
  const d = await newUser('home-desktop', DESKTOP);
  try {
    await d.page.goto('/'); await d.page.waitForSelector('#restaurants .card'); await d.page.waitForSelector('#groceries .card');
    await imagesOk(d.page, 6000);
    const cards = await d.page.evaluate(() => [...document.querySelectorAll('.card')].map(c => ({ name: c.querySelector('h3').textContent, src: c.querySelector('img').currentSrc, ok: c.querySelector('img').naturalWidth > 0 })));
    ok(cards.length >= 6, 'too few shops listed: ' + cards.length);
    ok(cards.every(c => c.ok), 'a shop picture failed to load');
    const plain = cards.filter(c => /fallback\/store\.svg/.test(c.src)).map(c => c.name);
    eq(plain.length, 0, 'shops still showing the plain placeholder: ' + plain.join(', '));
    const drawn = cards.filter(c => /\.svg/.test(c.src)).map(c => c.name); eq(drawn.length, 0, 'shops still showing a drawing, not a photo: ' + drawn.join(', '));
    ok(await d.page.locator('.hero h1').isVisible(), 'hero headline missing');
    await shot(d, '01b-home-desktop');
  } finally { await d.context.close(); }
});
await t('a missing picture is replaced by the fallback image (no broken image icon)', async () => {
  const gone = /\/images\/(meals|photos)\//; await cust.context.route(gone, r => r.fulfill({ status: 404, body: 'gone' }));      // every dish picture, illustration or photograph, is missing
  await cust.page.goto('/merchant.html?slug=demo-jollof-kitchen'); await cust.page.waitForSelector('.item [data-add]');
  await cust.page.waitForFunction(() => [...document.images].some(i => i.src.endsWith('fallback/meal.svg') && i.naturalWidth > 0), null, { timeout: 5000 });
  eq((await imagesOk(cust.page)).length, 0, 'still broken');
  await cust.context.unroute(gone);
});
await t('pages do not scroll sideways at 360px wide (home, menu, grocery, cart, checkout)', async () => {
  const p = cust.page; await p.setViewportSize({ width: 360, height: 740 });
  for (const url of ['/index.html', '/merchant.html?slug=demo-jollof-kitchen', '/merchant.html?slug=demo-fresh-market', '/cart.html']) {
    await p.goto(url); await p.waitForTimeout(400);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(over <= 0, `${url} overflows by ${over}px`);
  }
  await p.setViewportSize(MOBILE);
});

// =============== 2. CUSTOMER CHECKOUT (cash on delivery) ===============
console.log('\n2. Customer cart and checkout');
await t('add dishes, cart totals match, checkout offers cash on delivery and demo mobile money', async () => {
  const p = cust.page; await p.goto('/merchant.html?slug=demo-jollof-kitchen'); await p.waitForSelector('[data-add]');
  await p.locator('[data-add]').nth(0).click(); await p.locator('[data-add]').nth(0).click(); await p.locator('[data-add]').nth(3).click();
  await p.goto('/cart.html'); await p.waitForSelector('#cart .item');
  const cart = await p.textContent('#cart'); ok(/Subtotal\s*NLe\s*215/.test(cart) && /Delivery\s*NLe\s*25/.test(cart) && /NLe\s*240/.test(cart), cart.replace(/\s+/g, ' ').slice(0, 200));
  await shot(cust, '04-cart-mobile');
  await p.click('a:has-text("Go to checkout")'); await p.waitForSelector('#form');
  const pay = await p.textContent('fieldset'); ok(/Orange Money/.test(pay) && /Afrimoney/.test(pay) && /Cash on delivery/.test(pay) && /DEMO/.test(pay), pay);
  await shot(cust, '05-checkout-mobile');
});
await t('checkout validates before sending anything (name, phone, address, transaction ID for mobile money)', async () => {
  const p = cust.page, before = logs.customer.filter(l => /place_order/.test(l)).length, err = () => p.textContent('#err');
  await p.click('#submit'); eq((await err()).trim(), 'Enter your name.');
  await p.fill('[name=contact_name]', 'Browser Customer'); await p.click('#submit'); eq((await err()).trim(), 'Enter a valid phone number.');
  await p.fill('[name=contact_phone]', '+23276123456'); await p.click('#submit'); eq((await err()).trim(), 'Enter your delivery address.');
  await p.fill('[name=address_line]', '12 Test Street, Freetown'); await p.fill('[name=ref]', 'abc'); await p.click('#submit'); ok(/Transaction ID must be 6 to 24/.test(await err()), 'transaction id message'); await p.fill('[name=ref]', '');
  eq(logs.customer.filter(l => /place_order/.test(l)).length, before, 'a request was sent for an invalid form');
});
await t('place a cash on delivery order: order created, PIN shown to the customer, payment labelled', async () => {
  const p = cust.page;
  await p.check('input[value=CASH_ON_DELIVERY]');
  ok(await p.locator('#cod-note').isVisible(), 'cash note'); ok(!(await p.locator('#ref-wrap').isVisible()), 'ref hidden for cash');
  await Promise.all([p.waitForURL('**/tracking.html?id=*'), p.click('#submit')]);
  await p.waitForSelector('.pin strong');
  pin = (await p.textContent('.pin strong')).trim(); ok(/^\d{4}$/.test(pin), 'pin ' + pin);
  orderId = new URL(p.url()).searchParams.get('id');
  orderNum = (await p.textContent('h2')).match(/PD\d+/)[0];
  const text = await p.textContent('#tracking');
  ok(/Cash on delivery/.test(text) && /have NLe\s*240 ready/.test(text), 'cash due message');
  eq(sql(`select method||'|'||status||'|'||is_simulated from payments where order_id='${orderId}'`), 'CASH_ON_DELIVERY|PENDING|false');
  await shot(cust, '06-tracking-cod-mobile');
});


console.log('\n2b. Reused transaction ID and switching shops');
await t('a transaction ID that was already used is refused with a clear reason and the button comes back', async () => {
  const order = async (u, ref) => {
    await u.page.goto('/merchant.html?slug=demo-fresh-market'); await u.page.waitForSelector('[data-add], .pcard [data-add]'); await u.page.locator('[data-add]').first().click(); await u.page.locator('[data-add]').first().click();
    await u.page.goto('/checkout.html'); await u.page.waitForSelector('#form');
    await u.page.fill('[name=contact_name]', 'Ref Tester'); await u.page.fill('[name=contact_phone]', '+23276111222'); await u.page.fill('[name=address_line]', '5 Ref Road'); await u.page.fill('[name=ref]', ref);
    await u.page.click('#submit');
  };
  const a = await newUser('refA', MOBILE), b = await newUser('refB', MOBILE);
  await order(a, 'REUSE000001'); await a.page.waitForURL('**/tracking.html?id=*');
  await order(b, 'REUSE000001'); await b.page.waitForSelector('#err:not([hidden])'); ok(/already been used/.test(await b.page.textContent('#err')), await b.page.textContent('#err'));
  eq(await b.page.locator('#submit').isDisabled(), false, 'button stays disabled'); ok(!/tracking/.test(b.page.url()), 'navigated'); await a.context.close(); await b.context.close();
});
await t('adding from a second shop asks first; accepting replaces the cart with the new shop only', async () => {
  const u = await newUser('swap', MOBILE);
  await u.page.goto('/merchant.html?slug=demo-jollof-kitchen'); await u.page.waitForSelector('[data-add]'); await u.page.locator('[data-add]').first().click();
  let asked = false; u.page.removeAllListeners('dialog'); u.page.on('dialog', d => { asked = true; d.accept(); });
  await u.page.goto('/merchant.html?slug=demo-burger-pizza-spot'); await u.page.waitForSelector('[data-add]'); await u.page.locator('[data-add]').first().click();
  await u.page.waitForTimeout(300); ok(asked, 'no confirmation asked');
  await u.page.goto('/cart.html'); await u.page.waitForSelector('#cart .item'); const c = await u.page.textContent('#cart'); ok(/Burger/.test(c) && !/Jollof/.test(c), c.replace(/\s+/g, ' ').slice(0, 200));
  await u.context.close();
});
await t('minimum order rule: a basket under the shop minimum cannot be placed and says why', async () => {
  const u = await newUser('min', MOBILE);
  await u.page.goto('/merchant.html?slug=demo-corner-supermarket'); await u.page.waitForSelector('.pcard [data-add]'); await u.page.locator('.pcard', { hasText: 'Bottled water' }).locator('[data-add]').click();   // NLe 12, minimum NLe 50
  await u.page.goto('/cart.html'); await u.page.waitForSelector('#cart .item'); const t0 = await u.page.textContent('#cart');
  ok(/minimum/i.test(t0), 'minimum message: ' + t0.replace(/\s+/g, ' ').slice(0, 200)); await u.context.close();
});

// =============== 3. MERCHANT ===============
console.log('\n3. Merchant dashboard');
const mer = await newUser('merchant', MOBILE);
await t('merchant signs in and sees the new order with items, prices, payment status and customer details', async () => {
  await login(mer, 'merchant-goodies@test', 'merchant-dashboard.html');
  await mer.page.waitForSelector('#msel'); await mer.page.selectOption('#msel', { label: 'Demo Jollof Kitchen' });
  await mer.page.waitForSelector(`.ocard:has-text("#${orderNum}")`);
  const c = await mer.page.textContent(`.ocard:has-text("#${orderNum}")`);
  ok(/Cash on delivery/.test(c) && /You do not collect this payment/.test(c) && /Jollof rice with chicken/.test(c) && /Soft drink/.test(c), 'items/payment ' + c.replace(/\s+/g, ' ').slice(0, 300));
  ok(/Items subtotal\s*NLe\s*215/.test(c) && /Delivery fee\s*NLe\s*25/.test(c) && /Customer pays\s*NLe\s*240/.test(c), 'totals ' + c.replace(/\s+/g, ' ').slice(0, 300));
  ok(/Browser Customer/.test(c) && /12 Test Street/.test(c), 'delivery info');
  ok(/not set yet/.test(c), 'commission pending message');
  const sum = await mer.page.textContent('.stats'); ok(/Needs action\s*1/.test(sum), 'summary: ' + sum.replace(/\s+/g, ' ').slice(0, 200));
  ok((await mer.page.textContent('#live')).length > 0, 'live status');
  await shot(mer, '07-merchant-new-order-mobile');
});
await t('merchant sees an in-app alert when a second order arrives while the page is open', async () => {
  const c2 = await newUser('customer2', MOBILE);
  await c2.page.goto('/merchant.html?slug=demo-jollof-kitchen'); await c2.page.waitForSelector('[data-add]');
  await c2.page.locator('[data-add]').nth(1).click(); await c2.page.locator('[data-add]').nth(1).click();
  await c2.page.goto('/checkout.html'); await c2.page.waitForSelector('#form');
  await c2.page.fill('[name=contact_name]', 'Second Customer'); await c2.page.fill('[name=contact_phone]', '+23276999000'); await c2.page.fill('[name=address_line]', '3 Demo Lane, Freetown');
  await Promise.all([c2.page.waitForURL('**/tracking.html?id=*'), c2.page.click('#submit')]);
  order2 = new URL(c2.page.url()).searchParams.get('id');
  await c2.page.waitForSelector('.pin strong');
  const label = await c2.page.textContent('.payline'); ok(/Demo payment/.test(label), 'customer sees demo label: ' + label);
  eq(sql(`select status||'|'||is_simulated||'|'||(verified_at is null) from payments where order_id='${order2}'`), 'SIMULATED|true|true');
  await mer.page.waitForSelector('#alert:not([hidden])', { timeout: 25000 });                 // polling picks it up within 15 s
  ok(/New order received/.test(await mer.page.textContent('#alert')), 'alert text');
  ok(/Demo payment/.test(await mer.page.textContent('.ocard-new:has-text("Second Customer")')), 'merchant sees demo label');
  await shot(mer, '08-merchant-alert-mobile');
  await c2.context.close();
});
await t('merchant accepts, starts preparing and marks the first order ready; the customer tracking page follows', async () => {
  const card = () => mer.page.locator(`.ocard:has-text("#${orderNum}")`);
  await card().getByRole('button', { name: 'Accept' }).click();
  await card().getByRole('button', { name: 'Start preparing' }).click();
  await card().getByRole('button', { name: 'Mark ready for pickup' }).click();
  await mer.page.waitForSelector(`.ocard:has-text("#${orderNum}") .pill:text-is("Ready for pickup")`);
  eq(sql(`select status from orders where id='${orderId}'`), 'READY_FOR_PICKUP');
  ok(/Waiting for an admin to assign a rider/.test(await card().textContent()), 'waiting text');
  await cust.page.goto('/tracking.html?id=' + orderId);
  await cust.page.waitForSelector('.steps li.now:has-text("Ready for pickup")');
});
await t('merchant rejects the second order: it moves to the rejected tab and the demo payment is reversed', async () => {
  await mer.page.locator('.ocard:has-text("Second Customer")').getByRole('button', { name: 'Reject' }).click();
  await mer.page.waitForSelector('.ocard:has-text("Second Customer")', { state: 'detached' });
  await mer.page.click('[data-tab=rejected]'); await mer.page.waitForSelector('.ocard:has-text("Second Customer"):has-text("Refunded (demo)")');
  eq(sql(`select status from payments where order_id='${order2}'`), 'REFUNDED');
});

// =============== 4. ADMIN ===============
console.log('\n4. Admin dashboard');
const adm = await newUser('admin', DESKTOP);
await t('admin overview is driven by database counts and has a setup check', async () => {
  await login(adm, 'admin@test', 'admin.html'); await adm.page.waitForSelector('.setup');
  const text = await adm.page.textContent('#view');
  ok(/Setup check/.test(text) && /shops? visible to customers/.test(text), 'setup check');
  const total = sql(`select count(*) from orders`), shown = await adm.page.locator('.stat:has-text("Total orders") strong').textContent();
  eq(shown.trim(), total, 'total orders card matches the database');
  const awaitingRider = sql(`select count(*) from orders where status in ('ACCEPTED','PREPARING','READY_FOR_PICKUP') and delivery_status='UNASSIGNED'`);
  eq((await adm.page.locator('.stat:has-text("Awaiting a rider") strong').textContent()).trim(), awaitingRider, 'awaiting rider card');
  await shot(adm, '09-admin-overview-desktop');
});
await t('admin sees the order with merchant, payment status and assigns an eligible rider', async () => {
  await adm.page.click('[data-tab=orders]'); await adm.page.waitForSelector(`.orow:has-text("#${orderNum}")`);
  ok(/Cash on delivery/.test(await adm.page.textContent(`.orow:has-text("#${orderNum}")`)), 'payment badge in list');
  await adm.page.click(`.orow:has-text("#${orderNum}")`); await adm.page.waitForSelector('#rsel');
  const opts = await adm.page.locator('#rsel option').allTextContents(); ok(opts.some(o => /Demo Rider 001/.test(o)), opts.join('|'));
  const offline = await adm.page.locator('#rsel option[disabled]').allTextContents(); ok(offline.some(o => /offline/.test(o)), 'offline rider is not selectable: ' + offline.join('|'));
  await adm.page.selectOption('#rsel', { label: opts.find(o => /Demo Rider 001/.test(o)) });
  await adm.page.click('#rbtn'); await adm.page.waitForSelector('#panel :text("Demo Rider 001")');
  await adm.page.waitForFunction(() => /assigned/.test(document.querySelector('#panel').textContent));
  eq(sql(`select r.display_name||'|'||o.delivery_status from orders o join riders r on r.id=o.rider_id where o.id='${orderId}'`), 'Demo Rider 001|ASSIGNED');
  await shot(adm, '10-admin-order-detail-desktop');
  await adm.page.click('#pclose');
});
await t('admin can link a rider login without SQL, and an unknown email gives a clear message', async () => {
  await adm.page.click('[data-tab=riders]'); await adm.page.waitForSelector('.rrow');
  ok(/no login linked/.test(await adm.page.textContent('#view')), 'unlinked rider flagged');
  await adm.page.locator('.rrow:has-text("Demo Rider 002") [data-link]').click();
  await adm.page.fill('#panel input[name=email]', 'nobody@example.test'); await adm.page.click('#panel #lf button');
  await adm.page.waitForSelector('#panel #lmsg:not([hidden])'); ok(/No login with the email/.test(await adm.page.textContent('#lmsg')), 'message');
  await adm.page.fill('#panel input[name=email]', 'rider-other@test'); await adm.page.click('#panel #lf button');
  await adm.page.waitForSelector('.rrow:has-text("Demo Rider 002"):has-text("rider-other@test")');
  await shot(adm, '11-admin-riders-desktop');
});

// =============== 5. RIDER ===============
console.log('\n5. Rider dashboard');
const rid = await newUser('rider', MOBILE);
await t('rider signs in and sees the assigned delivery with the cash to collect, never the PIN', async () => {
  await login(rid, 'rider@test', 'rider.html'); await rid.page.waitForSelector(`.ocard:has-text("#${orderNum}")`);
  const c = await rid.page.textContent('.ocard');
  ok(/Collect NLe\s*240 in cash/.test(c) && /Pick up:.*Demo Jollof Kitchen/.test(c), c.replace(/\s+/g, ' ').slice(0, 250));
  ok(!c.includes(pin) || pin === '0000' ? true : !new RegExp(`\\b${pin}\\b`).test(c), 'PIN visible to rider');
  await shot(rid, '12-rider-assigned-mobile');
});
await t('rider moves through each delivery step', async () => {
  for (const [btn, status] of [['Accept delivery', 'ACCEPTED'], ['Arrived at store', 'AT_MERCHANT'], ['Picked up order', 'PICKED_UP'], ['Start delivery', 'ON_THE_WAY'], ['Arrived at customer', 'AT_CUSTOMER']]) {
    await rid.page.getByRole('button', { name: btn }).click();
    await rid.page.waitForFunction(([id, s]) => true, [orderId, status]);
    const t0 = Date.now(); for (;;) { if (sql(`select delivery_status from orders where id='${orderId}'`) === status) break; if (Date.now() - t0 > 6000) throw new Error('stuck before ' + status); await new Promise(r => setTimeout(r, 150)); }
  }
  await rid.page.waitForSelector('[data-cash]');
});
await t('delivery cannot be confirmed until the cash is recorded (PIN field is locked and the server refuses)', async () => {
  ok(await rid.page.locator('.pinform input[name=pin]').isDisabled(), 'pin input disabled');
  const r = sql(`select count(*) from order_delivery_pins where order_id='${orderId}' and verified_at is not null`); eq(r, '0');
  await shot(rid, '13-rider-at-customer-cash-mobile');
});
await t('rider records the cash, then a wrong PIN is refused and the right PIN delivers the order', async () => {
  await rid.page.click('[data-cash]'); await rid.page.waitForFunction(() => /Cash recorded/.test(document.querySelector('#msg').textContent));
  eq(sql(`select status||'|'||note from payments where order_id='${orderId}'`), 'PAID|Cash collected by rider');
  const wrong = String((Number(pin) + 1) % 10000).padStart(4, '0');
  await rid.page.fill('.pinform input[name=pin]', wrong); await rid.page.click('.pinform button');
  await rid.page.waitForFunction(() => /Wrong PIN/.test(document.querySelector('#msg').textContent));
  // The page re-draws the list right after a refused PIN, so a value typed during that redraw is lost (harmless for a person). Retry like a person would.
  for (let i = 0; i < 4; i++) {
    await rid.page.waitForTimeout(500);
    await rid.page.fill('.pinform input[name=pin]', pin); await rid.page.click('.pinform button');
    if (await rid.page.waitForFunction(() => /Delivery confirmed/.test(document.querySelector('#msg').textContent), null, { timeout: 4000 }).then(() => true, () => false)) break;
  }
  ok(/Delivery confirmed/.test(await rid.page.textContent('#msg')), 'delivery not confirmed after retries');
  eq(sql(`select status||'|'||delivery_status from orders where id='${orderId}'`), 'DELIVERED|DELIVERED');
  await shot(rid, '14-rider-delivered-mobile');
});
await t('the rider page never asked the database for the PIN table', async () => {
  ok(!logs.rider.some(l => /order_delivery_pins/.test(l)), 'rider requested order_delivery_pins');
});
await t('a login that is not linked to a rider sees a helpful message, not an empty screen', async () => {
  const u = await newUser('unlinked', MOBILE); await login(u, 'rider-other@test', 'rider.html'); await u.page.waitForSelector('.empty');
  // Demo Rider 002 was linked to this login in the admin test above; unlink it to test the unlinked state
  await u.context.close();
});

// =============== 6. FINAL STATES AND PAYMENTS ===============
console.log('\n6. Final status, payment and settlement records');
await t('customer tracking shows Delivered and cash collected', async () => {
  await cust.page.goto('/tracking.html?id=' + orderId); await cust.page.waitForSelector('.done-msg');
  ok(/Cash collected/.test(await cust.page.textContent('.payline')), 'cash collected badge');
  await shot(cust, '15-tracking-delivered-mobile');
});
await t('merchant sees the order as completed, sales figures, and payout not yet set', async () => {
  await mer.page.reload(); await mer.page.waitForSelector('#msel'); await mer.page.selectOption('#msel', { label: 'Demo Jollof Kitchen' }); await mer.page.waitForSelector('.stats'); await mer.page.click('[data-tab=completed]');
  await mer.page.waitForSelector(`.ocard:has-text("#${orderNum}"):has-text("Delivered")`);
  const sum = await mer.page.textContent('.stats');
  ok(/Sales\s*NLe\s*215/.test(sum), 'sales: ' + sum.replace(/\s+/g, ' ')); ok(/Owed to you\s*Not set/.test(sum), 'owed not set');
  await shot(mer, '16-merchant-completed-mobile');
});
await t('admin sees the delivered order, money pending terms, then sets terms and records a payout', async () => {
  await adm.page.click('[data-tab=orders]'); await adm.page.waitForSelector(`.orow:has-text("#${orderNum}")`);
  await adm.page.click(`.orow:has-text("#${orderNum}")`); await adm.page.waitForSelector('#panel h3:text("Money")');
  const m = await adm.page.textContent('#panel'); ok(/Not decided yet/.test(m) && /Waiting for commission terms/.test(m), 'pending terms in order detail');
  await adm.page.click('#pclose');
  await adm.page.click('[data-tab=finance]'); await adm.page.waitForSelector('#tf');
  await adm.page.fill('#tf [name=pct]', '10'); await adm.page.fill('#tf [name=rider]', '15'); await adm.page.click('#tf button');
  await adm.page.waitForSelector('button:has-text("Record payout")');
  const tbl = await adm.page.textContent('#view');
  ok(/Demo Jollof Kitchen/.test(tbl) && /NLe\s*193\.5/.test(tbl), 'owed to shop = 215 - 21.5: ' + tbl.replace(/\s+/g, ' ').slice(0, 400));
  await shot(adm, '17-admin-payments-desktop');
  await adm.page.locator('[data-mset]').first().click(); await adm.page.fill('#panel input[name=ref]', 'DEMO-BANK-0001'); await adm.page.click('#panel #pf button');
  await adm.page.waitForSelector('td:has-text("DEMO-BANK-0001")');
  eq(sql(`select settlement_status from order_financials where order_id='${orderId}'`), 'SETTLED');
});
await t('merchant sees the recorded payout in their history', async () => {
  await mer.page.reload(); await mer.page.waitForSelector('#msel'); await mer.page.selectOption('#msel', { label: 'Demo Jollof Kitchen' }); await mer.page.waitForSelector('td:has-text("DEMO-BANK-0001")');
  const sum = await mer.page.textContent('.stats'); ok(/Settled so far\s*NLe\s*193\.5/.test(sum), sum.replace(/\s+/g, ' '));
});
await t('admin overview and orders list reflect the final state', async () => {
  await adm.page.click('[data-tab=overview]'); await adm.page.waitForSelector('.stat:has-text("Completed")');
  eq((await adm.page.locator('.stat:has-text("Completed") strong').first().textContent()).trim(), sql(`select count(*) from orders where status='DELIVERED'`), 'completed card');
  await adm.page.click('[data-tab=orders]'); await adm.page.waitForSelector(`.orow:has-text("#${orderNum}")`);
  ok(/Delivered/.test(await adm.page.textContent(`.orow:has-text("#${orderNum}")`)), 'delivered in list');
});

// =============== 7. ACCESS CONTROL IN THE BROWSER ===============
console.log('\n7. Access control');
await t('a signed-in merchant who opens the admin page gets "admins only" and no data', async () => {
  await mer.page.goto('/admin.html'); await mer.page.waitForFunction(() => /admins only/.test(document.querySelector('#gate').textContent));
  ok(/admins only/.test(await mer.page.textContent('#gate')), 'message'); ok(await mer.page.locator('#app').isHidden(), 'admin app hidden');
});
await t('a visitor with no staff login is sent to the login page from every staff page', async () => {
  const v = await newUser('visitor', MOBILE);
  for (const pg of ['admin.html', 'merchant-dashboard.html', 'rider.html']) { await v.page.goto('/' + pg); await v.page.waitForURL('**/login.html**'); }
  await v.context.close();
});
await t('wrong password shows an error and stays on the login page', async () => {
  const v = await newUser('badpw', MOBILE); await v.page.goto('/login.html'); await v.page.fill('input[name=email]', 'admin@test'); await v.page.fill('input[name=password]', 'nope'); await v.page.click('button.btn');
  await v.page.waitForSelector('#err:not([hidden])'); ok(/Sign in failed/.test(await v.page.textContent('#err')), 'message'); await v.context.close();
});
await t('merchant of another shop does not see this shop\'s orders', async () => {
  const o = await newUser('other', MOBILE); await login(o, 'merchant-stmarys@test', 'merchant-dashboard.html'); await o.page.waitForSelector('#body .stats');
  ok(!(await o.page.textContent('#body')).includes(orderNum), 'saw another shop order'); await o.context.close();
});
await t('no uncaught JavaScript errors on any page during the run', async () => {
  const all = [cust, mer, adm, rid].flatMap(u => u.errors.map(e => `${u.name}: ${e}`)); ok(all.length === 0, all.slice(0, 3).join(' || '));
});

console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
await browser.close(); server.close();
process.exit(fail ? 1 : 0);
