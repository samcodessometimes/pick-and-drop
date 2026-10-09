import { db } from './supabase.js';
import { esc, label, callRpc } from './ui.js';

export async function render(el, ctx) {
  const [{ data: riders, error }, { data: orders }] = await Promise.all([
    db.from('riders').select('id,display_name,phone,is_demo,availability,user_id').order('display_name'),
    db.from('orders').select('order_number,status,delivery_status,rider_id').not('rider_id', 'is', null).not('status', 'in', '(DELIVERED,CANCELLED)')]);
  if (error) { el.innerHTML = '<p class="error">Could not load riders.</p>'; return; }
  const byRider = {};
  for (const o of orders || []) (byRider[o.rider_id] ||= []).push(o);
  el.innerHTML = `<div class="filters"><button class="btn btn-sm" id="radd">Add test rider</button></div>
    ${riders.length ? riders.map(r => `<article class="orow rrow"><div><strong>${esc(r.display_name)}</strong>
      <small>${r.is_demo ? '<span class="tag-demo">DEMO RIDER</span>' : 'Real rider'} · ${r.user_id ? 'login linked' : 'no login'}</small></div>
      <div><span class="pill">${esc(label(r.availability))}</span><small>${r.phone ? esc(r.phone) : 'No phone on file'}</small></div>
      <div>${(byRider[r.id] || []).length ? (byRider[r.id]).map(o => `<small>#${esc(o.order_number)} · ${esc(label(o.delivery_status))}</small>`).join('') : '<small>No active orders</small>'}</div>
      <div><small><button class="linkbtn" data-edit="${esc(r.id)}">Edit</button></small></div></article>`).join('')
      : '<p class="note">No riders yet. Add a test rider to start assigning deliveries.</p>'}`;
  const form = r => {
    const body = ctx.open(`<h2>${r ? 'Edit' : 'Add test'} rider</h2>
      <p class="note">${r ? '' : 'New riders added here are demo/test riders without a login. '}${r?.availability === 'BUSY' ? 'This rider is on a delivery. Availability is managed automatically until it ends.' : ''}</p>
      <form id="rf" novalidate><label>Name<input name="name" required maxlength="60" value="${esc(r?.display_name ?? '')}"></label>
      <label>Phone (optional)<input name="phone" type="tel" value="${esc(r?.phone ?? '')}"></label>
      <label>Availability<select name="availability"><option value="AVAILABLE" ${r?.availability !== 'OFFLINE' ? 'selected' : ''}>Available</option><option value="OFFLINE" ${r?.availability === 'OFFLINE' ? 'selected' : ''}>Offline</option></select></label>
      <p class="error" id="rmsg" role="alert" hidden></p><button class="btn btn-block" style="width:100%">Save</button></form>`);
    body.querySelector('#rf').addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target), btn = e.target.querySelector('button'); btn.disabled = true;
      const res = await callRpc('admin_save_rider', { p_id: r?.id ?? null, p_name: fd.get('name'), p_phone: fd.get('phone'), p_availability: fd.get('availability') }, body.querySelector('#rmsg'));
      btn.disabled = false; if (res) { ctx.close(); ctx.show('riders'); }
    });
  };
  el.querySelector('#radd').addEventListener('click', () => form(null));
  el.addEventListener('click', e => { const b = e.target.closest('[data-edit]'); if (b) form(riders.find(r => r.id === b.dataset.edit)); });
}
