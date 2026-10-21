// Loads a page's HTML into jsdom, bundles the real page script with esbuild, runs it, and offers
// small helpers to click, type and wait. jsdom is NOT a browser: no layout, no CSS, no real events timing.
import { JSDOM, VirtualConsole } from 'jsdom';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = path.join(here, '.dist');
export const store = new Map();                       // shared localStorage = same browser profile
export const problems = [];                           // jsdom errors and uncaught exceptions
let runId = 0;

export async function bundleAll(entries) {
  fs.rmSync(dist, { recursive: true, force: true });
  await esbuild.build({
    entryPoints: entries.map(e => path.join(root, 'js', e)), outdir: dist, bundle: true, format: 'esm', platform: 'node',
    target: 'esnext', logLevel: 'error', outExtension: { '.js': '.mjs' },
    plugins: [{ name: 'shim', setup: b => b.onResolve({ filter: /^\.\/supabase\.js$/ }, () => ({ path: path.join(here, 'shim-supabase.js') })) }],
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  });
}

export async function openPage(file, query = '', script = file) {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const vc = new VirtualConsole(); vc.on('jsdomError', e => problems.push(`${file}: ${e.message}`));
  const dom = new JSDOM(html, { url: `http://localhost/${file}${query}`, pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  w.Element.prototype.scrollIntoView = () => {};
  const nav = [];
  const loc = { search: query, pathname: '/' + file, hash: '', get href() { return `http://localhost/${file}${query}`; },
    set href(v) { nav.push(String(v)); }, replace(v) { nav.push(String(v)); }, assign(v) { nav.push(String(v)); } };
  const g = globalThis;
  Object.assign(g, { window: w, document: w.document, Event: w.Event, FormData: w.FormData, location: loc,
    CSS: { escape: s => String(s) }, confirm: () => (g.__CONFIRM__ ?? true), alert: () => {},
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() } });
  Object.defineProperty(g, 'navigator', { value: { geolocation: g.__GEO__ }, configurable: true, writable: true });
  const entry = script.replace(/^.*\//, '').replace(/\.html$/, '');
  const jsName = { index: 'app', merchant: 'app', cart: 'app', 'merchant-dashboard': 'merchant' }[entry] || entry;
  const before = problems.length;
  await import(`file://${path.join(dist, jsName + '.mjs')}?run=${++runId}`).catch(e => problems.push(`${file}: module error ${e.message}`));
  return { dom, w, doc: w.document, nav, problems: () => problems.slice(before) };
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function until(fn, timeout = 6000, what = 'condition') {
  const t0 = Date.now();
  for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t0 > timeout) throw new Error('timed out waiting for ' + what); await sleep(40); }
}
export const $ = (p, s) => p.doc.querySelector(s);
export const $$ = (p, s) => [...p.doc.querySelectorAll(s)];
export const text = (p, s = 'body') => ($(p, s)?.textContent || '').replace(/\s+/g, ' ').trim();
export const click = (p, sel) => { const el = typeof sel === 'string' ? $(p, sel) : sel; if (!el) throw new Error('no element ' + sel); el.click(); };
export function fill(p, form, values) {
  for (const [k, v] of Object.entries(values)) {
    const el = $(p, `${form} [name="${k}"]`); if (!el) throw new Error('no field ' + k);
    if (el.type === 'radio') { $$(p, `${form} [name="${k}"]`).forEach(r => { r.checked = r.value === v; }); } else if (el.type === 'checkbox') el.checked = !!v; else el.value = v;
  }
}
export const submit = (p, form) => $(p, form).dispatchEvent(new p.w.Event('submit', { bubbles: true, cancelable: true }));
