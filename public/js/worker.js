// Worker dashboard
shell('worker', [['dash', 'Dashboard', dash], ['profile', 'My Profile', profile], ['jobs', 'Find Jobs', jobs],
  ['apps', 'My Applications', apps], ['offers', 'Offer Letters', offers], ['msgs', 'Messages', el => messagesView(el, window.pre)]]);

async function dash(el) {
  const [me, list, mine] = await Promise.all([api('/me'), api('/jobs'), api('/applications')]);
  const done = 6 - me.missing.length;
  el.innerHTML = `<h2>Welcome, ${esc(me.name)}</h2>
  <div class="stats"><div class="card stat"><b>${list.length}</b><span>Open vacancies</span></div><div class="card stat"><b>${mine.length}</b><span>Applications</span></div>
  <div class="card stat"><b>${mine.filter(a => a.status === 'Offer Sent').length}</b><span>Offers waiting</span></div></div>
  <div class="card"><h3>Profile completeness: ${done} of 6</h3><div class="bar"><i style="width:${done / 6 * 100}%"></i></div>
  ${me.missing.length ? `<p class="muted">Still needed: ${esc(me.missing.join(', '))}</p><button class="btn sm" onclick="go('profile')">Complete profile</button>` : '<p class="muted">Your profile is complete. You can apply for jobs.</p>'}</div>`;
}

async function profile(el) {
  const [me, cfg] = await Promise.all([api('/me'), api('/config')]); const p = me.profile;
  const f = (id, label, val, ph = '', cls = '') => `<div class="${cls}"><label for="f_${id}">${label}</label><input id="f_${id}" value="${esc(val)}" placeholder="${ph}"></div>`;
  el.innerHTML = `<h2>My Profile</h2><div class="card"><div class="grid2">
    ${f('name', 'Full name', me.name)}<div><label>Email address</label><input value="${esc(me.email)}" disabled></div>
    ${f('education', 'Education and qualification *', p.education, 'e.g. B.E Computer Science')}${f('college', 'College or institution', p.college)}
    ${f('skills', 'Technical skills * (comma separated)', p.skills.join(', '), 'e.g. Python, SQL, Git', 'full')}
    ${f('otherSkills', 'Other relevant skills', p.otherSkills, 'e.g. Communication, Teamwork', 'full')}
    <div><label for="f_experience">Experience level *</label><select id="f_experience"><option value="">Select</option>${cfg.levels.map(l => `<option ${p.experience === l ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${f('role', 'Preferred job role *', p.role, 'e.g. Python Developer')}${f('location', 'Current location *', p.location)}${f('prefLocation', 'Preferred job location', p.prefLocation)}
    </div><div class="actions"><button class="btn" id="save">Save profile</button></div></div>
  <div class="card"><h3>Resume *</h3>
    ${p.hasResume ? `<p>Uploaded: <b>${esc(p.resumeName)}</b></p>` : '<p class="muted">No resume uploaded yet. A resume is required to apply.</p>'}
    ${p.detected.length ? `<p class="muted">Skills detected in your resume:</p>${p.detected.map(s => chip(s, 'ok')).join('')}` : ''}
    <label class="btn ghost sm" for="rf" style="margin-top:12px">${p.hasResume ? 'Replace resume' : 'Upload resume'}</label>
    <input id="rf" type="file" accept=".pdf,.docx" hidden><p class="muted"><small>PDF or DOCX, up to ${cfg.maxResumeMb} MB.</small></p></div>`;
  $('save').onclick = () => busy($('save'), async () => {
    const body = {}; ['name', 'education', 'college', 'skills', 'otherSkills', 'experience', 'role', 'location', 'prefLocation'].forEach(k => body[k] = $('f_' + k).value);
    await api('/profile', 'PUT', body); toast('Profile saved'); profile(el);
  });
  $('rf').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    if (!['pdf', 'docx'].includes(file.name.split('.').pop().toLowerCase())) return toast('Only PDF or DOCX files are allowed', true);
    if (file.size > cfg.maxResumeMb * 1e6) return toast(`File is larger than ${cfg.maxResumeMb} MB`, true);
    const data = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(file); });
    try { await api('/resume', 'POST', { filename: file.name, data }); toast('Resume uploaded'); profile(el); } catch (err) { toast(err.message, true); }
  };
}

async function jobs(el) {
  const list = await api('/jobs');
  const card = j => `<div class="card"><div class="row"><div><h3>${esc(j.title)}</h3><small>${esc(j.company)} - ${esc(j.location)} - ${esc(j.type)} - ${esc(j.experience)}</small></div>${matchBlock(j.match)}</div>
    <p class="muted">${esc(j.description.slice(0, 150))}${j.description.length > 150 ? '...' : ''}</p>${j.skills.map(s => chip(s)).join('')}<br><small>Posted ${fmt(j.postedAt)}</small>
    <div class="actions"><button class="btn ghost sm" data-act="view" data-id="${j.id}">View Details</button>
    ${j.appStatus ? tag(j.appStatus) : `<button class="btn sm" data-act="apply" data-id="${j.id}">Apply Now</button>`}</div></div>`;
  const draw = q => {
    const rows = list.filter(j => (j.title + j.company + j.skills.join(' ')).toLowerCase().includes(q.toLowerCase()));
    $('jlist').innerHTML = rows.map(card).join('') || '<div class="card muted">No active vacancies found.</div>';
  };
  el.innerHTML = `<h2>Find Jobs</h2><input id="jq" placeholder="Search by role, company or skill" style="margin-bottom:16px"><div id="jlist"></div>`;
  draw(''); $('jq').oninput = e => draw(e.target.value);
  const apply = async id => {
    const j = list.find(x => x.id === id);
    if (await ask(`Apply for ${j.title} at ${j.company}? Your profile and resume will be shared with the manager.`, 'Apply')) {
      try { await api('/apply', 'POST', { jobId: id }); toast('Application submitted'); jobs(el); } catch (e) { toast(e.message, true); }
    }
  };
  el.onclick = e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const j = list.find(x => x.id === b.dataset.id);
    if (b.dataset.act === 'apply') return apply(j.id);
    const m = modal(`<h3>${esc(j.title)}</h3><p class="muted">${esc(j.company)} - ${esc(j.location)} - ${esc(j.type)}</p>
      <p>${esc(j.description)}</p><p><b>Experience:</b> ${esc(j.experience)}${j.minQual ? `<br><b>Qualification:</b> ${esc(j.minQual)}` : ''}<br><b>Vacancies left:</b> ${j.left}${j.deadline ? `<br><b>Apply by:</b> ${fmt(j.deadline)}` : ''}</p>
      <b>Required skills</b><br>${j.skills.map(s => chip(s)).join('')}${j.preferred.length ? `<br><b>Preferred skills</b><br>${j.preferred.map(s => chip(s, 'pref')).join('')}` : ''}
      ${j.match.incomplete ? `<p class="muted">${esc(j.match.reason)}</p>` : `<p><b>Your AI match: ${j.match.score}%</b></p>${matchChips(j.match)}`}
      <div class="actions">${j.appStatus ? tag(j.appStatus) : '<button class="btn" id="dapply">Apply Now</button>'}</div>`, true);
    if ($('dapply')) $('dapply').onclick = () => { m.close(); apply(j.id); };
  };
}

async function apps(el) {
  const list = await api('/applications');
  el.innerHTML = `<h2>My Applications</h2>${list.map(a => `<div class="card"><div class="row"><div><h3>${esc(a.title)}</h3><small>${esc(a.company)} - ${esc(a.location)} - applied ${fmt(a.createdAt)}</small></div>${tag(a.status)}</div>
    <p class="timeline">${a.history.map(h => `${esc(h.status)} (${fmt(h.at)})`).join(' &rarr; ')}</p>
    <button class="btn ghost sm" data-id="${a.id}">Message manager</button></div>`).join('') || '<div class="card muted">You have not applied for any job yet. Open Find Jobs to start.</div>'}`;
  el.onclick = e => { const b = e.target.closest('[data-id]'); if (b) { window.pre = b.dataset.id; go('msgs'); } };
}

async function offers(el) {
  const list = await api('/offers');
  el.innerHTML = `<h2>Offer Letters</h2>${list.map(o => `<div class="card"><div class="row"><div><h3>${esc(o.company)} - ${esc(o.jobTitle)}</h3><small>Version ${o.version} - ${esc(o.date)}${o.deadline ? ' - respond by ' + fmt(o.deadline) : ''}</small></div>${tag(o.status === 'sent' ? 'Offer Sent' : o.status)}</div>
    <details ${o.latest ? 'open' : ''}><summary>${o.latest ? 'Hide' : 'Show'} offer letter</summary>${letterHtml(o)}</details>
    <div class="actions"><button class="btn ghost sm" data-act="pdf" data-id="${o.id}">Download PDF</button></div>
    ${o.reply ? `<p class="muted">Your reply: ${esc(o.reply)}</p>` : ''}
    ${o.latest && o.status === 'sent' ? `<label for="r${o.id}">Reply to the manager (optional)</label><textarea id="r${o.id}"></textarea>
      <div class="actions"><button class="btn ok" data-act="yes" data-id="${o.id}">Accept offer</button><button class="btn bad" data-act="no" data-id="${o.id}">Decline offer</button></div>` : ''}</div>`).join('') || '<div class="card muted">No offer letters yet.</div>'}`;
  el.onclick = async e => {
    const b = e.target.closest('[data-act]'); if (!b) return; const id = b.dataset.id;
    if (b.dataset.act === 'pdf') return download(`/api/offers/${id}/pdf`, 'Offer-Letter.pdf');
    const accept = b.dataset.act === 'yes';
    if (!(await ask(accept ? 'Accept this offer?' : 'Decline this offer? This cannot be undone.', accept ? 'Accept' : 'Decline'))) return;
    try { await api(`/offers/${id}/respond`, 'POST', { accept, message: $('r' + id).value }); toast(accept ? 'Offer accepted' : 'Offer declined'); offers(el); } catch (err) { toast(err.message, true); }
  };
}
