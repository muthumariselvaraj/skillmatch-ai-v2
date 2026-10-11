// Manager dashboard
shell('manager', [['dash', 'Dashboard', dash], ['post', 'Post a Job', el => jobForm(el)], ['jobs', 'My Job Vacancies', vacancies],
  ['applicants', 'Applicants', applicants], ['selected', 'Selected Candidates', selected], ['offers', 'Offer Letters', offers],
  ['msgs', 'Messages', el => messagesView(el, window.pre)], ['company', 'Company Profile', company]]);

const DEFAULT_TERMS = "This offer is subject to satisfactory verification of the details in your resume and application.\nEmployment is subject to the company's policies, which will be shared when you join.";

async function dash(el) {
  const [js, ap] = await Promise.all([api('/jobs/mine'), api('/applicants')]);
  const n = s => ap.filter(a => a.status === s).length;
  el.innerHTML = `<h2>Recruitment overview</h2><div class="stats">
    <div class="card stat"><b>${js.filter(j => j.status === 'active').length}</b><span>Active vacancies</span></div><div class="card stat"><b>${ap.length}</b><span>Applicants</span></div>
    <div class="card stat"><b>${n('Applied') + n('Under Review')}</b><span>To review</span></div><div class="card stat"><b>${n('Selected') + n('Offer Sent')}</b><span>Selected / offers out</span></div>
    <div class="card stat"><b>${n('Offer Accepted')}</b><span>Offers accepted</span></div></div>
  <div class="card"><h3>Top matches waiting for review</h3>${ap.filter(a => ['Applied', 'Under Review'].includes(a.status) && !a.match.incomplete).slice(0, 3).map(a => `<p>${esc(a.name)} for ${esc(a.jobTitle)}: <b>${a.match.score}%</b></p>`).join('') || '<p class="muted">No applicants waiting.</p>'}
  <button class="btn sm" onclick="go('applicants')">Open applicants</button></div>`;
}

// ----- vacancies -----
const jobFormHtml = (j, cfg, company) => {
  const i = (id, label, val = '', extra = '', cls = '') => `<div class="${cls}"><label for="j_${id}">${label}</label><input id="j_${id}" value="${esc(val)}" ${extra}></div>`;
  return `<div class="grid2">${i('title', 'Job role / title *', j.title, 'placeholder="e.g. Python Developer"')}
    <div><label>Company name</label><input value="${esc(company.name)}" disabled></div>${i('location', 'Company location *', j.location || company.location)}
    <div><label for="j_type">Job type *</label><select id="j_type">${cfg.jobTypes.map(t => `<option ${j.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div><label for="j_experience">Experience requirement *</label><select id="j_experience">${cfg.levels.map(l => `<option ${j.experience === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${i('minQual', 'Minimum qualification', j.minQual, 'placeholder="e.g. B.E / B.Tech"')}
    ${i('skills', 'Required technical skills * (comma separated)', (j.skills || []).join(', '), 'placeholder="Python, SQL, Django, Git"', 'full')}
    ${i('preferred', 'Preferred skills (optional)', (j.preferred || []).join(', '), '', 'full')}
    <div class="full"><label for="j_description">Job description *</label><textarea id="j_description">${esc(j.description)}</textarea></div>
    ${i('openings', 'Number of vacancies *', j.openings || 1, 'type="number" min="1"')}${i('deadline', 'Application deadline', j.deadline, 'type="date"')}</div>`;
};
const readJob = () => { const b = {}; ['title', 'location', 'type', 'experience', 'minQual', 'skills', 'preferred', 'description', 'openings', 'deadline'].forEach(k => b[k] = $('j_' + k).value); return b; };

async function jobForm(el) {
  const [cfg, co] = await Promise.all([api('/config'), api('/company')]);
  el.innerHTML = `<h2>Post a Job</h2><div class="card">${jobFormHtml({}, cfg, co)}<div class="actions"><button class="btn" id="pub">Publish Job</button></div></div>`;
  $('pub').onclick = () => busy($('pub'), async () => { await api('/jobs', 'POST', readJob()); toast('Job published'); go('jobs'); });
}

async function vacancies(el) {
  const [list, cfg, co] = await Promise.all([api('/jobs/mine'), api('/config'), api('/company')]);
  el.innerHTML = `<h2>My Job Vacancies</h2>${list.map(j => `<div class="card"><div class="row"><div><h3>${esc(j.title)}</h3><small>${esc(j.location)} - ${esc(j.type)} - ${esc(j.experience)} - posted ${fmt(j.postedAt)}${j.deadline ? ' - deadline ' + fmt(j.deadline) : ''}</small></div>${tag(j.status)}</div>
    <p>${j.skills.map(s => chip(s)).join('')}</p><p class="muted">${j.filled} of ${j.openings} filled - ${j.applicants} applicant(s)</p>
    <div class="actions"><button class="btn ghost sm" data-a="edit" data-id="${j.id}">Edit</button><button class="btn ghost sm" data-a="toggle" data-id="${j.id}">${j.status === 'active' ? 'Close vacancy' : 'Reopen'}</button><button class="btn sm" data-a="apps" data-id="${j.id}">View applicants</button></div></div>`).join('') || '<div class="card muted">No vacancies yet. Use Post a Job.</div>'}`;
  el.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return; const j = list.find(x => x.id === b.dataset.id);
    if (b.dataset.a === 'apps') { window.filterJob = j.id; return go('applicants'); }
    if (b.dataset.a === 'toggle') {
      if (!(await ask(j.status === 'active' ? 'Close this vacancy? Workers will no longer see it.' : 'Reopen this vacancy?'))) return;
      try { await api('/jobs/' + j.id, 'PUT', { status: j.status === 'active' ? 'closed' : 'active' }); vacancies(el); } catch (err) { toast(err.message, true); } return;
    }
    const m = modal(`<h3>Edit vacancy</h3>${jobFormHtml(j, cfg, co)}<div class="actions"><button class="btn" id="upd">Save changes</button></div>`, true);
    $('upd').onclick = () => busy($('upd'), async () => { await api('/jobs/' + j.id, 'PUT', readJob()); m.close(); toast('Vacancy updated'); vacancies(el); });
  };
}

// ----- applicants -----
const applicantCard = a => `<div class="card"><div class="row"><div><h3>${esc(a.name)}</h3><small>${esc(a.email)} - applied ${fmt(a.createdAt)} for <b>${esc(a.jobTitle)}</b></small></div>
  <div style="text-align:right">${matchBlock(a.match)}<br>${tag(a.status)}</div></div>
  ${a.match.incomplete ? '' : `<div class="bar"><i style="width:${a.match.score}%"></i></div>`}
  <p class="muted"><small>${esc(a.education || 'Education not given')}${a.college ? ' (' + esc(a.college) + ')' : ''} - ${esc(a.experience)} - ${esc(a.location)} - Resume: ${a.hasResume ? 'available' : 'not uploaded'}</small></p>
  <p>${a.skills.map(s => chip(s)).join('')}</p>${matchChips(a.match)}
  <div class="actions">${a.hasResume ? `<button class="btn ghost sm" data-a="resume" data-id="${a.id}">VIEW RESUME</button>` : ''}
  ${['Applied', 'Under Review'].includes(a.status) ? `<button class="btn ok sm" data-a="select" data-id="${a.id}">SELECT</button><button class="btn bad sm" data-a="reject" data-id="${a.id}">REJECT</button>` : ''}
  ${['Selected', 'Offer Sent'].includes(a.status) ? `<button class="btn sm" data-a="offer" data-id="${a.id}">${a.status === 'Selected' ? 'GENERATE OFFER LETTER' : 'REVISE OFFER'}</button>` : ''}
  <button class="btn ghost sm" data-a="msg" data-id="${a.id}">Message</button></div></div>`;

async function applicants(el) {
  const [list, jobs] = await Promise.all([api('/applicants'), api('/jobs/mine')]);
  const cur = window.filterJob || '';
  el.innerHTML = `<h2>Applicants</h2><p class="muted"><small>AI match is decision support only. Please review each applicant yourself.</small></p>
    <select id="jf" style="margin-bottom:16px"><option value="">All vacancies</option>${jobs.map(j => `<option value="${j.id}" ${cur === j.id ? 'selected' : ''}>${esc(j.title)} (${j.applicants})</option>`).join('')}</select><div id="alist"></div>`;
  const draw = () => { const f = $('jf').value; window.filterJob = f; $('alist').innerHTML = list.filter(a => !f || a.jobId === f).map(applicantCard).join('') || '<div class="card muted">No applicants yet.</div>'; };
  draw(); $('jf').onchange = draw; el.onclick = e => handle(e, list, () => applicants(el));
}

async function handle(e, list, reload) {
  const b = e.target.closest('[data-a]'); if (!b) return; const a = list.find(x => x.id === b.dataset.id), act = b.dataset.a;
  if (act === 'msg') { window.pre = a.id; return go('msgs'); }
  if (act === 'resume') {
    const r = await api('/resume-token/' + a.id, 'POST');
    return modal(`<h3>${esc(a.name)} - resume (read-only)</h3><div class="viewer" oncontextmenu="return false"><iframe title="Resume" src="${r.url}${r.kind === 'pdf' ? '#toolbar=0&navpanes=0' : ''}"></iframe></div><div class="actions"><button class="btn ghost" onclick="this.closest('.overlay').querySelector('.x').click()">Close</button></div>`, true, reload);
  }
  if (act === 'select' || act === 'reject') {
    const yes = act === 'select';
    if (!(await ask(`${yes ? 'Select' : 'Reject'} ${a.name} for ${a.jobTitle}? The worker will be notified and this cannot be undone.`, yes ? 'Select' : 'Reject'))) return;
    try { await api(`/applications/${a.id}/status`, 'POST', { action: act }); toast(yes ? 'Candidate selected' : 'Applicant rejected'); reload(); } catch (err) { toast(err.message, true); }
  }
  if (act === 'offer') {
    let prev = null; if (a.status === 'Offer Sent') { const o = await api('/offers'); prev = (o.find(x => x.appId === a.id && x.latest) || {}).fields; }
    offerForm(a, prev, reload);
  }
}

async function offerForm(a, prev, reload) {
  const me = await api('/me'), f = prev || {};
  const i = (id, label, val, extra = '', cls = '') => `<div class="${cls}"><label for="o_${id}">${label}</label><input id="o_${id}" value="${esc(val || '')}" ${extra}></div>`;
  const m = modal(`<div id="oc"><h3>${prev ? 'Revise' : 'Generate'} offer letter for ${esc(a.name)}</h3><p class="muted">${esc(a.jobTitle)}. Enter the real terms. Nothing is filled in for you except the signatory and editable terms text.</p>
    <div class="grid2">${i('salary', 'Compensation *', f.salary, 'placeholder="e.g. Rs. 6,00,000 per year"')}${i('startDate', 'Start date *', f.startDate, 'type="date"')}
    ${i('type', 'Employment type', f.type, 'placeholder="Defaults to the job type"')}${i('location', 'Work location', f.location, 'placeholder="Defaults to the job location"')}
    ${i('reporting', 'Reporting manager', f.reporting)}${i('deadline', 'Response deadline', f.deadline, 'type="date"')}${i('signatory', 'Authorised signatory *', f.signatory || me.name, '', 'full')}
    <div class="full"><label for="o_terms">Terms and conditions (editable)</label><textarea id="o_terms">${esc(f.terms ?? DEFAULT_TERMS)}</textarea></div></div>
    <div class="actions"><button class="btn" id="prev">Preview letter</button></div></div>`, true);
  const body = () => { const b = {}; ['salary', 'startDate', 'type', 'location', 'reporting', 'deadline', 'signatory', 'terms'].forEach(k => b[k] = $('o_' + k).value); return b; };
  $('prev').onclick = () => busy($('prev'), async () => {
    const data = body(), L = await api(`/applications/${a.id}/offer-preview`, 'POST', data);
    $('oc').innerHTML = `<h3>Review before sending</h3>${letterHtml(L)}<div class="actions"><button class="btn ghost" id="back">Back to edit</button><button class="btn" id="send">Send Offer</button></div>`;
    $('back').onclick = () => { m.close(); offerForm(a, data, reload); };
    $('send').onclick = async () => {
      if (!(await ask(`Send this offer letter to ${a.name}? The sent letter cannot be changed. You can send a revised version later.`, 'Send Offer'))) return;
      try { await api(`/applications/${a.id}/offer`, 'POST', data); m.close(); toast('Offer sent'); reload(); } catch (e) { toast(e.message, true); }
    };
  });
}

async function selected(el) {
  const list = (await api('/applicants')).filter(a => ['Selected', 'Offer Sent', 'Offer Accepted', 'Offer Declined'].includes(a.status));
  el.innerHTML = `<h2>Selected Candidates</h2>${list.map(applicantCard).join('') || '<div class="card muted">No selected candidates yet.</div>'}`;
  el.onclick = e => handle(e, list, () => selected(el));
}

async function offers(el) {
  const list = await api('/offers');
  el.innerHTML = `<h2>Offer Letters</h2>${list.map(o => `<div class="card"><div class="row"><div><h3>${esc(o.toName)} - ${esc(o.jobTitle)}</h3><small>Version ${o.version} - ${esc(o.date)}</small></div>${tag(o.status === 'sent' ? 'Offer Sent' : o.status)}</div>
    ${o.reply ? `<p class="muted">Worker reply: ${esc(o.reply)}</p>` : ''}<details><summary>View letter</summary>${letterHtml(o)}</details></div>`).join('') || '<div class="card muted">No offers sent yet. Select a candidate first.</div>'}`;
}

async function company(el) {
  const c = await api('/company');
  el.innerHTML = `<h2>Company Profile</h2><div class="card"><label for="c_name">Company name</label><input id="c_name" value="${esc(c.name)}">
    <label for="c_location">Company location</label><input id="c_location" value="${esc(c.location)}"><label for="c_details">About the company</label><textarea id="c_details">${esc(c.details)}</textarea>
    <div class="actions"><button class="btn" id="csave">Save</button></div><p class="muted"><small>Changes apply to jobs you post from now on.</small></p></div>`;
  $('csave').onclick = () => busy($('csave'), async () => { await api('/company', 'PUT', { name: $('c_name').value, location: $('c_location').value, details: $('c_details').value }); toast('Company profile saved'); });
}
