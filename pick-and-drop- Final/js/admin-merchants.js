import { db } from './supabase.js';
import { esc, label, callRpc } from './ui.js';

const STATUSES = ['DEMO', 'PENDING', 'ACTIVE', 'SUSPENDED'];
const PARTNER = { ACTIVE: 'Pick & Drop partner', DEMO: 'DEMO / NOT PARTNERED', PENDING: 'NOT PARTNERED (pending)', SUSPENDED: 'SUSPENDED' };
const field = (n, l, v = '', t = 'text', x = '') => `<label>${l}<input name="${n}" type="${t}" value="${esc(v ?? '')}" ${x}></label>`;

export async function render(el, ctx) {
  const [{ data: ms, error }, { data: areas }, { data: cats }, { data: ints }] = await Promise.all([
    db.from('merchants').select('*, service_areas(name), merchant_categories(is_primary, categories(name,slug))').order('name').limit(500),
    db.from('service_areas').select('slug,name,is_active').order('sort_order'),
    db.from('categories').select('slug,name,merchant_type').order('sort_order'),
    db.from('merchant_internal').select('merchant_id,internal_notes,data_source,source_url')]);
  const internal = Object.fromEntries((ints || []).map(i => [i.merchant_id, i]));   // admin-only table
  if (error) { el.innerHTML = '<p class="error">Could not load merchants.</p>'; return; }
  el.innerHTML = `<div class="filters"><input id="mq" type="search" placeholder="Search merchants" aria-label="Search merchants">
    <select id="ms" aria-label="Status"><option value="">All statuses</option>${STATUSES.map(s => `<option>${s}</option>`).join('')}</select>
    <button class="btn btn-sm" id="madd">Add merchant</button></div><div id="mlist"></div>`;
  const list = el.querySelector('#mlist');
  const primary = m => m.merchant_categories?.find(c => c.is_primary)?.categories;

  function draw() {
    const q = el.querySelector('#mq').value.trim().toLowerCase(), s = el.querySelector('#ms').value;
    const rows = ms.filter(m => (!s || m.status === s) && (!q || m.name.toLowerCase().includes(q)));
    list.innerHTML = rows.length ? rows.map(m => `<article class="orow mrow" data-id="${esc(m.id)}">
      <div><strong>${esc(m.name)}</strong><small>${esc(label(m.merchant_type))}${primary(m) ? ' · ' + esc(primary(m).name) : ''}</small></div>
      <div>${esc(m.service_areas?.name)}<small>${esc([m.neighbourhood, m.address_line].filter(Boolean).join(', ') || 'No address on file')}</small></div>
      <div>${m.phone ? esc(m.phone) : '<small>No phone on file</small>'}<small>${esc(label(m.verification))}</small></div>
      <div><span class="pill ${m.status === 'ACTIVE' ? 'pill-on' : ''}">${esc(PARTNER[m.status])}</span>
        <small><button class="linkbtn" data-edit="${esc(m.id)}">Edit</button> <button class="linkbtn" data-status="${esc(m.id)}">Status</button></small></div></article>`).join('')
      : '<p class="note">No merchants match. Use Add merchant to create a demo listing.</p>';
  }
  el.querySelector('#mq').addEventListener('input', draw);
  el.querySelector('#ms').addEventListener('change', draw);
  el.querySelector('#madd').addEventListener('click', () => form(null));
  list.addEventListener('click', e => {
    const ed = e.target.closest('[data-edit]'), st = e.target.closest('[data-status]');
    if (ed) form(ms.find(m => m.id === ed.dataset.edit));
    if (st) statusDlg(ms.find(m => m.id === st.dataset.status));
  });
  draw();

  async function reload() { ctx.close(); ctx.show('merchants'); }

  function form(m) {
    const v = { ...(m || {}), ...(m ? internal[m.id] || {} : {}) }, pc = m ? primary(m)?.slug : '';
    const body = ctx.open(`<h2>${m ? 'Edit' : 'Add'} merchant</h2>
      <p class="note">${m ? '' : 'New merchants are always created as DEMO / NOT PARTNERED. '}Only enter details you have verified. Leave unknown fields empty.</p>
      <form id="mf" novalidate>${field('name', 'Name', v.name, 'text', 'required maxlength="100"')}
      <label>Type<select name="merchant_type" id="mtype"><option value="RESTAURANT" ${v.merchant_type === 'RESTAURANT' ? 'selected' : ''}>Restaurant</option><option value="GROCERY" ${v.merchant_type === 'GROCERY' ? 'selected' : ''}>Grocery</option></select></label>
      <label>Category<select name="category" id="mcat"></select></label>
      <label>Service area<select name="service_area">${(areas || []).filter(a => a.is_active).map(a => `<option value="${esc(a.slug)}" ${m && m.service_areas?.name === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      ${field('address_line', 'Address', v.address_line)}${field('neighbourhood', 'Neighbourhood', v.neighbourhood)}${field('landmark', 'Landmark', v.landmark)}
      ${field('phone', 'Phone', v.phone, 'tel')}${field('whatsapp', 'WhatsApp', v.whatsapp, 'tel')}
      ${field('latitude', 'Latitude', v.latitude, 'number', 'step="any"')}${field('longitude', 'Longitude', v.longitude, 'number', 'step="any"')}
      ${field('delivery_fee', 'Delivery fee (NLe)', v.delivery_fee ?? 0, 'number', 'min="0" step="any"')}${field('min_order_amount', 'Minimum order (NLe)', v.min_order_amount ?? 0, 'number', 'min="0" step="any"')}
      ${field('prep_time_min', 'Prep time min (mins)', v.prep_time_min, 'number', 'min="1"')}${field('prep_time_max', 'Prep time max (mins)', v.prep_time_max, 'number', 'min="1"')}
      <label>Verification<select name="verification">${['UNVERIFIED', 'PHONE_CONFIRMED', 'VISITED'].map(x => `<option value="${x}" ${v.verification === x ? 'selected' : ''}>${label(x)}</option>`).join('')}</select></label>
      ${field('data_source', 'Where the details came from', v.data_source)}${field('source_url', 'Source URL', v.source_url, 'url')}
      <label>Description<input name="description" value="${esc(v.description ?? '')}"></label>
      <label>Internal notes<input name="internal_notes" value="${esc(v.internal_notes ?? '')}"></label>
      <label class="radio"><input type="checkbox" name="delivery_enabled" ${v.delivery_enabled === false ? '' : 'checked'}> Delivery enabled</label>
      <p class="error" id="fmsg" role="alert" hidden></p><button class="btn btn-block" style="width:100%">Save</button></form>`);
    const catSel = body.querySelector('#mcat'), typeSel = body.querySelector('#mtype');
    const fillCats = () => { catSel.innerHTML = '<option value="">No category</option>' + (cats || []).filter(c => c.merchant_type === typeSel.value)
      .map(c => `<option value="${esc(c.slug)}" ${c.slug === pc ? 'selected' : ''}>${esc(c.name)}</option>`).join(''); };
    fillCats(); typeSel.addEventListener('change', () => { fillCats(); });
    body.querySelector('#mf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target), f = Object.fromEntries(fd); f.delivery_enabled = fd.has('delivery_enabled');
      const btn = e.target.querySelector('button'); btn.disabled = true;
      const res = await callRpc('admin_save_merchant', { p_id: m ? m.id : null, p: f }, body.querySelector('#fmsg'));
      btn.disabled = false; if (res) reload();
    });
  }

  function statusDlg(m) {
    const body = ctx.open(`<h2>Status: ${esc(m.name)}</h2><p><span class="pill">${esc(PARTNER[m.status])}</span></p>
      <p class="note">ACTIVE means a signed Pick & Drop partner. Choose it only after the business has agreed in writing. Everything else is shown to customers as not partnered or hidden.</p>
      <form id="sf"><label>New status<select name="status" id="sst">${STATUSES.map(s => `<option ${s === m.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div id="act" hidden>${field('owner_email', 'Owner login email (must already exist in Supabase Auth)', '', 'email')}
      <label class="radio"><input type="checkbox" name="confirm"> This business has agreed in writing to join Pick & Drop</label></div>
      <p class="error" id="smsg" role="alert" hidden></p><button class="btn btn-block" style="width:100%">Update status</button></form>`);
    const sst = body.querySelector('#sst'), act = body.querySelector('#act');
    const sync = () => { act.hidden = sst.value !== 'ACTIVE'; }; sst.addEventListener('change', sync); sync();
    body.querySelector('#sf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target), btn = e.target.querySelector('button.btn'); btn.disabled = true;
      const res = await callRpc('admin_set_merchant_status', { p_id: m.id, p_status: sst.value,
        p_owner_email: fd.get('owner_email') || null, p_confirm: fd.has('confirm') }, body.querySelector('#smsg'));
      btn.disabled = false; if (res) reload();
    });
  }
}
