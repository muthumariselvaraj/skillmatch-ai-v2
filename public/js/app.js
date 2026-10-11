// Shared helpers for every page
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const chip = (s, c = '') => `<span class="chip ${c}">${esc(s)}</span>`;
const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const tag = s => `<span class="tag s-${String(s).toLowerCase().replace(/\s+/g, '-')}">${esc(s)}</span>`;
const token = () => localStorage.getItem('token');
const isMsg = n => n.text.startsWith('New message');
const openMessages = () => { window.pre = 'latest'; go('msgs'); };
const logout = () => { localStorage.clear(); location.href = '/'; };

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token() || '') }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && token() && !path.startsWith('/auth')) logout(); throw new Error(d.error || 'Something went wrong'); }
  return d;
}
function messagePopup(text) { // banner at the top of the page when a new message arrives
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'alert');
  t.style.cssText = 'top:20px;bottom:auto;right:20px;cursor:pointer;background:#3b6cff';
  t.innerHTML = esc(text) + '<br><small>Click to open Messages</small>';
  t.onclick = () => { t.remove(); openMessages(); };
  document.body.appendChild(t); setTimeout(() => t.remove(), 8000);
}
function toast(msg, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3500);
}
async function busy(btn, fn) { // loading state for buttons
  const label = btn.textContent; btn.disabled = true; btn.textContent = 'Please wait...';
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; btn.textContent = label; }
}
function modal(html, wide, onClose) {
  const o = document.createElement('div'); o.className = 'overlay';
  o.innerHTML = `<div class="dialog ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="x" aria-label="Close">&times;</button>${html}</div>`;
  document.body.appendChild(o);
  const close = () => { o.remove(); if (onClose) onClose(); };
  o.querySelector('.x').onclick = close; o.onclick = e => { if (e.target === o) close(); };
  return { el: o.querySelector('.dialog'), close };
}
function ask(msg, okLabel = 'Confirm') { // confirmation dialog
  return new Promise(res => {
    const m = modal(`<p>${esc(msg)}</p><div class="actions"><button class="btn ghost" id="c_no">Cancel</button><button class="btn" id="c_yes">${okLabel}</button></div>`, false, () => res(false));
    m.el.querySelector('#c_no').onclick = m.close;
    m.el.querySelector('#c_yes').onclick = () => { m.el.parentNode.remove(); res(true); };
  });
}
const download = async (url, name) => {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token() } });
  if (!r.ok) return toast('File not available', true);
  const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = name; a.click();
};
const matchBlock = m => m.incomplete ? `<small class="muted">${esc(m.reason || 'Incomplete profile')}</small>` :
  `<div class="score"><b>${m.score}%</b><small>AI match</small></div>`;
const matchChips = m => m.incomplete ? '' :
  m.matched.map(s => chip(s, 'ok')).join('') + m.missing.map(s => chip(s + ' (missing)', 'no')).join('') +
  m.prefMatched.map(s => chip(s, 'pref')).join('') + `<br><small class="muted">${esc(m.explanation)}</small>`;
const letterHtml = L => `<div class="letter"><div class="lh"><b>${esc(L.company)}</b><small>${esc(L.companyLocation)}</small></div>
  <div class="lmeta"><span>Ref: ${esc(L.ref)}</span><span>Date: ${esc(L.date)}</span></div>
  <p><b>${esc(L.toName)}</b><br>${esc(L.toEmail)}</p><p><b>${esc(L.subject)}</b></p>
  ${L.intro.map(p => `<p>${esc(p)}</p>`).join('')}<table>${L.details.map(([a, b]) => `<tr><th>${esc(a)}</th><td>${esc(b)}</td></tr>`).join('')}</table>
  ${L.terms.map(p => `<p>${esc(p)}</p>`).join('')}${L.closing.map(p => `<p>${esc(p)}</p>`).join('')}
  <p>Yours sincerely,<br><br><b>${esc(L.signatory)}</b><br>${esc(L.signatoryRole)}</p></div>`;

// ---------- dashboard shell: sidebar, notifications, view switching ----------
function shell(role, items) {
  const u = JSON.parse(localStorage.getItem('user') || 'null');
  if (!token() || !u || u.role !== role) { location.href = `/${role}-login.html`; return; }
  $('who').textContent = u.name;
  $('side').innerHTML = items.map(([k, l]) => `<button data-k="${k}">${l}</button>`).join('') + '<button data-k="logout">Logout</button>';
  $('side').onclick = e => { const k = e.target.dataset.k; if (k === 'logout') logout(); else if (k) go(k); };
  window.go = async k => {
    [...$('side').children].forEach(b => b.classList.toggle('on', b.dataset.k === k));
    const view = $('view'); view.onclick = null; view.innerHTML = '<p class="muted">Loading...</p>';
    try { await items.find(i => i[0] === k)[2](view); } catch (e) { view.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
    refreshCount();
  };
  $('bell').onclick = async () => {
    const n = await api('/notifications');
    const m = modal(`<h3>Notifications</h3>${n.items.map(x => `<div class="card" ${isMsg(x) ? 'data-msg="1" role="button" tabindex="0"' : ''} style="padding:12px;margin-bottom:8px;${x.read ? '' : 'border-color:var(--cyan);'}${isMsg(x) ? 'cursor:pointer' : ''}">${esc(x.text)}${isMsg(x) ? '<br><small style="color:var(--cyan)">Click to open Messages</small>' : ''}<br><small>${fmt(x.at)}</small></div>`).join('') || '<p class="muted">Nothing yet.</p>'}`, false, refreshCount);
    m.el.onclick = e => { if (e.target.closest('[data-msg]')) { m.close(); openMessages(); } };
    m.el.onkeydown = e => { if (e.key === 'Enter' && e.target.dataset.msg) { m.close(); openMessages(); } };
    await api('/notifications/read', 'POST');
  };
  let lastUnread = null;
  async function refreshCount() {
    try {
      const n = await api('/notifications');
      $('cnt').textContent = n.unread ? n.unread : ''; $('cnt').className = n.unread ? 'badge' : '';
      const newest = n.items.find(x => !x.read);
      if (lastUnread !== null && n.unread > lastUnread && newest && isMsg(newest)) messagePopup(newest.text);
      lastUnread = n.unread;
    } catch (e) {}
  }
  setInterval(refreshCount, 10000);
  go(items[0][0]);
}

// ---------- messages (shared by worker and manager) ----------
async function messagesView(el, pre) {
  const threads = await api('/threads');
  if (pre === 'latest' && threads.length) pre = threads[0].appId;
  window.pre = null;
  el.innerHTML = `<h2>Messages</h2><div class="chat"><div class="card" style="padding:10px">${threads.map(t => `<button class="thread" data-id="${t.appId}"><b>${esc(t.with)}</b><small>${esc(t.title)} - ${esc(t.status)}</small><small>${esc(t.last || 'No messages yet')}</small></button>`).join('') || '<p class="muted" style="padding:10px">Conversations appear here once there is an application.</p>'}</div><div class="card" id="pane"><p class="muted">Select a conversation.</p></div></div>`;
  async function open(appId) {
    [...el.querySelectorAll('.thread')].forEach(b => b.classList.toggle('on', b.dataset.id === appId));
    const msgs = await api('/messages/' + appId);
    $('pane').innerHTML = `<div class="msgs" id="msgs">${msgs.map(m => `<div class="bubble ${m.mine ? 'mine' : ''}">${esc(m.text)}<small>${esc(m.fromName)} - ${fmt(m.at)}</small></div>`).join('') || '<p class="muted">No messages yet. Say hello.</p>'}</div>
      <div class="row" style="flex-wrap:nowrap"><input id="mtext" placeholder="Write a message" maxlength="1000"><button class="btn" id="msend">Send</button></div>`;
    $('msgs').scrollTop = 1e6;
    $('msend').onclick = () => busy($('msend'), async () => { await api('/messages/' + appId, 'POST', { text: $('mtext').value }); await open(appId); });
  }
  el.querySelector('.chat').onclick = e => { const b = e.target.closest('.thread'); if (b) open(b.dataset.id); };
  if (pre && threads.some(t => t.appId === pre)) open(pre);
}

// ---------- login / registration page ----------
function authPage(role) {
  const W = role === 'worker', card = $('card');
  let mode = new URLSearchParams(location.search).get('reset') ? 'reset' : 'login';
  const pw = (id, label, auto) => `<label for="${id}">${label}</label><div class="pw"><input id="${id}" type="password" autocomplete="${auto}"><button type="button" class="eye" onclick="const i=$('${id}');i.type=i.type==='password'?'text':'password';this.textContent=i.type==='password'?'Show':'Hide'">Show</button></div>`;
  const field = (id, label, type = 'text', auto = '') => `<label for="${id}">${label}</label><input id="${id}" type="${type}" autocomplete="${auto}">`;
  const emailOk = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  const pwOk = p => /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(p);
  const v = id => $(id).value.trim();
  const screens = {
    login: () => `<h2>${W ? 'Worker' : 'Manager'} Login</h2>${field('email', W ? 'Email address' : 'Registered email', 'email', 'email')}${pw('pw', 'Password', 'current-password')}<div class="err" id="err" role="alert"></div><button class="btn" id="go" style="width:100%">Login</button><div class="links"><a data-m="forgot">Forgot password?</a><a data-m="register">Create account</a></div>`,
    register: () => `<h2>Create ${W ? 'worker' : 'manager'} account</h2>${field('name', W ? 'Full name' : 'Manager full name', 'text', 'name')}${field('email', W ? 'Email address' : 'Work email', 'email', 'email')}${W ? '' : field('company', 'Company name') + field('companyLocation', 'Company location')}${pw('pw', 'Password (8+ characters, letter and number)', 'new-password')}${pw('pw2', 'Confirm password', 'new-password')}<div class="err" id="err" role="alert"></div><button class="btn" id="go" style="width:100%">Create account</button><div class="links"><a data-m="login">Back to login</a></div>`,
    forgot: () => `<h2>Reset your password</h2><p class="muted">Enter your registered email and we will prepare a reset link.</p>${field('email', 'Email address', 'email', 'email')}<div class="err" id="err" role="alert"></div><button class="btn" id="go" style="width:100%">Send reset link</button><div class="links"><a data-m="login">Back to login</a></div>`,
    reset: () => `<h2>Choose a new password</h2>${pw('pw', 'New password', 'new-password')}${pw('pw2', 'Confirm password', 'new-password')}<div class="err" id="err" role="alert"></div><button class="btn" id="go" style="width:100%">Save password</button>`
  };
  const err = m => { $('err').textContent = m; return false; };
  const actions = {
    login: async () => {
      if (!emailOk(v('email'))) return err('Enter a valid email address.'); if (!$('pw').value) return err('Enter your password.');
      const d = await api('/auth/login', 'POST', { role, email: v('email'), password: $('pw').value }); done(d);
    },
    register: async () => {
      if (!v('name')) return err('Enter your full name.'); if (!emailOk(v('email'))) return err('Enter a valid email address.');
      if (!W && (!v('company') || !v('companyLocation'))) return err('Enter your company name and location.');
      if (!pwOk($('pw').value)) return err('Password needs 8+ characters with at least one letter and one number.');
      if ($('pw').value !== $('pw2').value) return err('Passwords do not match.');
      done(await api('/auth/register', 'POST', { role, name: v('name'), email: v('email'), password: $('pw').value, company: W ? '' : v('company'), companyLocation: W ? '' : v('companyLocation') }));
    },
    forgot: async () => {
      if (!emailOk(v('email'))) return err('Enter a valid email address.');
      const d = await api('/auth/forgot', 'POST', { role, email: v('email') });
      $('err').className = 'ok-msg'; $('err').innerHTML = esc(d.message) + (d.devLink ? `<br>Local dev link: <a href="${d.devLink}">open reset page</a>` : '');
    },
    reset: async () => {
      if (!pwOk($('pw').value)) return err('Password needs 8+ characters with at least one letter and one number.');
      if ($('pw').value !== $('pw2').value) return err('Passwords do not match.');
      await api('/auth/reset', 'POST', { token: new URLSearchParams(location.search).get('reset'), password: $('pw').value });
      history.replaceState(null, '', location.pathname); mode = 'login'; draw(); $('err').className = 'ok-msg'; $('err').textContent = 'Password updated. Please log in.';
    }
  };
  const done = d => { localStorage.setItem('token', d.token); localStorage.setItem('user', JSON.stringify(d.user)); location.href = `/${role}.html`; };
  function draw() {
    card.innerHTML = screens[mode]();
    card.querySelectorAll('[data-m]').forEach(a => a.onclick = () => { mode = a.dataset.m; draw(); });
    $('go').onclick = () => busy($('go'), async () => { try { await actions[mode](); } catch (e) { err(e.message); } });
    card.onkeydown = e => { if (e.key === 'Enter') $('go').click(); };
  }
  draw();
}