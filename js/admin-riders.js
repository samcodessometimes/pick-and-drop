import { db } from './supabase.js';
import { esc, label, callRpc, showError } from './ui.js';
import { DELIVERY_LABEL } from './status.js';

export async function render(el, ctx) {
  const [{ data: load, error: e1 }, { data: riders, error }, { data: orders }] = await Promise.all([
    db.rpc('admin_rider_load'),
    db.from('riders').select('id,display_name,phone,is_demo,availability,user_id').order('display_name'),
    db.from('orders').select('order_number,status,delivery_status,rider_id').not('rider_id', 'is', null).not('status', 'in', '(DELIVERED,CANCELLED)')]);
  if (error || e1) { el.innerHTML = '<div id="rerr"></div>'; showError(el.querySelector('#rerr'), 'Could not load riders.', () => ctx.show('riders')); return; }
  const info = Object.fromEntries((load || []).map(r => [r.id, r]));
  const byRider = {};
  for (const o of orders || []) (byRider[o.rider_id] ||= []).push(o);
  const unlinked = riders.filter(r => !r.user_id).length;
  el.innerHTML = `<div class="filters"><button class="btn btn-sm" id="radd">Add test rider</button></div>
    ${unlinked ? `<p class="note">${unlinked} rider${unlinked === 1 ? ' has' : 's have'} no login yet. A rider with no login cannot sign in at the rider page. Use Link login.</p>` : ''}
    ${riders.length ? riders.map(r => `<article class="orow rrow"><div><strong>${esc(r.display_name)}</strong>
      <small>${r.is_demo ? '<span class="tag-demo">DEMO RIDER</span>' : 'Real rider'} · ${r.user_id ? 'login: ' + esc(info[r.id]?.email || 'linked') : '<span class="error">no login linked</span>'}</small></div>
      <div><span class="pill">${esc(label(r.availability))}</span><small>${r.phone ? esc(r.phone) : 'No phone on file'}</small></div>
      <div>${(byRider[r.id] || []).length ? (byRider[r.id]).map(o => `<small>#${esc(o.order_number)} · ${esc(DELIVERY_LABEL[o.delivery_status] || label(o.delivery_status))}</small>`).join('') : '<small>No active orders</small>'}</div>
      <div><small><button class="linkbtn" data-edit="${esc(r.id)}">Edit</button> <button class="linkbtn" data-link="${esc(r.id)}">${r.user_id ? 'Login' : 'Link login'}</button></small></div></article>`).join('')
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
  // Link or unlink the login a rider signs in with. The login must already exist in Supabase Authentication.
  const linkDlg = r => {
    const cur = info[r.id]?.email;
    const body = ctx.open(`<h2>Login for ${esc(r.display_name)}</h2>
      ${cur ? `<p>Linked login: <strong>${esc(cur)}</strong></p><div class="actions"><button class="btn btn-sm btn-ghost" id="unlink">Unlink this login</button></div>`
            : '<p class="note">No login is linked, so nobody can sign in as this rider yet.</p>'}
      ${cur ? '' : `<form id="lf"><label>Email of an existing login<input name="email" type="email" required autocomplete="off"></label>
        <p class="note">Create the login first in Supabase, Authentication, Users, with Auto Confirm ticked. Then enter the same email here. After linking, the rider signs in at the staff login page.</p>
        <p class="error" id="lmsg" role="alert" hidden></p><button class="btn btn-block" style="width:100%">Link login</button></form>`}
      <p class="error" id="umsg" role="alert" hidden></p>`);
    body.querySelector('#lf')?.addEventListener('submit', async e => {
      e.preventDefault(); const btn = e.target.querySelector('button'); btn.disabled = true;
      const ok = await callRpc('admin_link_staff', { p_kind: 'RIDER', p_email: new FormData(e.target).get('email'), p_target: r.id }, body.querySelector('#lmsg'));
      btn.disabled = false; if (ok) { ctx.close(); ctx.show('riders'); }
    });
    body.querySelector('#unlink')?.addEventListener('click', async () => {
      if (!confirm('Unlink this login? The rider will no longer be able to sign in.')) return;
      const ok = await callRpc('admin_unlink_staff', { p_kind: 'RIDER', p_target: r.id }, body.querySelector('#umsg'));
      if (ok) { ctx.close(); ctx.show('riders'); }
    });
  };
  el.querySelector('#radd').addEventListener('click', () => form(null));
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-edit]'); if (b) form(riders.find(r => r.id === b.dataset.edit));
    const l = e.target.closest('[data-link]'); if (l) linkDlg(riders.find(r => r.id === l.dataset.link));
  });
}
