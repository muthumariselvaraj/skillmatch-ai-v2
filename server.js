// SkillMatch AI - backend (Node.js, no npm packages needed)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
try { // tiny .env loader
  for (const l of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch (e) {}
const { extractText } = require('./lib/resume');
const { LEVELS, matchScore, detect } = require('./lib/match');
const { offerPdf } = require('./lib/pdf');

const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET || 'dev-only-secret-change-me';
const MAX_MB = Number(process.env.MAX_RESUME_MB) || 3;
const DATA = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA, 'db.json'), UPLOADS = path.join(DATA, 'uploads');
const JOB_TYPES = ['Full-Time', 'Part-Time', 'Internship', 'Contract'];
const STATUS_OPEN = ['Applied', 'Under Review'];

// ---------- database (JSON file; swap for a real DB in production) ----------
fs.mkdirSync(DATA, { recursive: true });
const db = Object.assign({ users: [], jobs: [], apps: [], offers: [], messages: [], notes: [], resets: [] },
  fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE)) : {});
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
const id = () => crypto.randomBytes(6).toString('hex');
const fail = (msg, code = 400) => { const e = new Error(msg); e.code = code; throw e; };
const str = (v, n = 200) => String(v ?? '').trim().slice(0, n);
const list = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => str(s, 60)).filter(Boolean).slice(0, 40);
const fmt = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const note = (userId, text) => db.notes.push({ id: id(), userId, text, at: Date.now(), read: false });
const setStatus = (a, status, by) => { a.status = status; a.history.push({ status, at: Date.now(), by }); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

// ---------- passwords and tokens ----------
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const sign = p => crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
const makeToken = (data, ms) => { const p = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + ms })).toString('base64url'); return p + '.' + sign(p); };
function readToken(t) {
  try { const [p, s] = String(t).split('.'); if (s !== sign(p)) return null;
    const d = JSON.parse(Buffer.from(p, 'base64url')); return d.exp > Date.now() ? d : null; } catch (e) { return null; }
}
const userFromToken = t => { const d = readToken(t); return d && d.id ? db.users.find(u => u.id === d.id) : null; };
const strongPw = p => /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(String(p || ''));
const tries = {};
function throttle(key) {
  const t = tries[key] = (tries[key] || []).filter(x => Date.now() - x < 6e5);
  if (t.length >= 15) fail('Too many attempts. Please try again in a few minutes.', 429);
  t.push(Date.now());
}

// ---------- profiles ----------
const EMPTY = { education: '', college: '', skills: [], otherSkills: '', experience: '', role: '', location: '', prefLocation: '', resumeName: '', resumeFile: '', resumeText: '' };
const profileOf = u => (u.profile = { ...EMPTY, ...u.profile });
function missingFields(u) {
  const p = profileOf(u), m = [];
  if (!p.education) m.push('Education'); if (!p.skills.length) m.push('Technical skills');
  if (!p.experience) m.push('Experience level'); if (!p.role) m.push('Preferred job role');
  if (!p.location) m.push('Current location'); if (!p.resumeName) m.push('Resume');
  return m;
}
function publicUser(u) {
  const o = { id: u.id, name: u.name, email: u.email, role: u.role };
  if (u.role === 'worker') {
    const p = profileOf(u);
    o.profile = { ...p, resumeText: undefined, resumeFile: undefined, hasResume: !!p.resumeName, detected: detect(p.resumeText) };
    o.missing = missingFields(u);
  } else o.company = u.company;
  return o;
}

// ---------- jobs ----------
const expired = j => j.deadline && Date.parse(j.deadline + 'T23:59:59Z') < Date.now();
function cleanJob(b, company) {
  const j = {
    title: str(b.title, 80), location: str(b.location, 80) || company.location, type: str(b.type), experience: str(b.experience),
    skills: list(b.skills), preferred: list(b.preferred), description: str(b.description, 3000), minQual: str(b.minQual, 120),
    openings: parseInt(b.openings), deadline: str(b.deadline)
  };
  if (!j.title || !j.skills.length || !j.description) fail('Job title, required skills and description are needed');
  if (!JOB_TYPES.includes(j.type)) fail('Choose a job type');
  if (!LEVELS.includes(j.experience)) fail('Choose the experience requirement');
  if (!(j.openings > 0)) fail('Number of vacancies must be at least 1');
  if (j.deadline && !isDate(j.deadline)) fail('Invalid application deadline');
  return j;
}

// ---------- offer letters ----------
function cleanOffer(b, job) {
  const f = { type: str(b.type) || job.type, location: str(b.location, 80) || job.location, startDate: str(b.startDate), salary: str(b.salary, 80),
    reporting: str(b.reporting, 80), deadline: str(b.deadline), terms: String(b.terms || '').slice(0, 2000), signatory: str(b.signatory, 80) };
  if (!f.salary || !isDate(f.startDate) || !f.signatory) fail('Compensation, start date and authorised signatory are required');
  if (f.deadline && !isDate(f.deadline)) fail('Invalid response deadline');
  return f;
}
function letterData(o) {
  const a = db.apps.find(x => x.id === o.appId), j = db.jobs.find(x => x.id === a.jobId);
  const w = db.users.find(x => x.id === a.workerId), m = db.users.find(x => x.id === j.managerId), f = o.fields;
  const details = [['Position', j.title], ['Employment type', f.type], ['Work location', f.location], ['Start date', fmt(f.startDate)], ['Compensation', f.salary]];
  if (f.reporting) details.push(['Reporting manager', f.reporting]);
  if (f.deadline) details.push(['Please respond by', fmt(f.deadline)]);
  return {
    id: o.id, appId: a.id, fields: f, version: o.version, status: o.status, reply: o.reply, deadline: f.deadline, jobTitle: j.title,
    ref: 'OL-' + a.id.slice(0, 6).toUpperCase() + '-V' + o.version, date: fmt(o.createdAt), company: j.company,
    companyLocation: (m.company && m.company.location) || j.location, toName: w.name, toEmail: w.email, subject: 'Offer of Employment - ' + j.title,
    intro: ['Dear ' + w.name + ',', `We are pleased to offer you the position of ${j.title} at ${j.company}, following the review of your application and resume. The key terms of your offer are listed below.`],
    details, terms: f.terms.split(/\n+/).map(s => s.trim()).filter(Boolean),
    closing: ['Please confirm your decision by responding to this offer in the SkillMatch AI portal' + (f.deadline ? ' on or before ' + fmt(f.deadline) : '') + '.', 'We look forward to welcoming you to our team.'],
    signatory: f.signatory, signatoryRole: j.company
  };
}

// ---------- API ----------
function route(method, url, query, body, user) {
  let x;
  const R = (m, p) => (method === m ? url.match(new RegExp('^' + p + '$')) : null);
  const need = r => { if (user.role !== r) fail('Not allowed for your role', 403); };
  const ownApp = appId => { // application on one of this manager's vacancies
    const a = db.apps.find(y => y.id === appId), j = a && db.jobs.find(y => y.id === a.jobId);
    if (!a || j.managerId !== user.id) fail('Application not found', 404);
    return a;
  };
  const sharedApp = appId => { // either side of an application
    const a = db.apps.find(y => y.id === appId), j = a && db.jobs.find(y => y.id === a.jobId);
    if (!a || (a.workerId !== user.id && j.managerId !== user.id)) fail('Not found', 404);
    return { a, j };
  };

  if (R('GET', '/api/config')) return { maxResumeMb: MAX_MB, levels: LEVELS, jobTypes: JOB_TYPES };

  if (R('POST', '/api/auth/register')) {
    const email = str(body.email, 120).toLowerCase(), role = body.role;
    if (!['worker', 'manager'].includes(role)) fail('Invalid role');
    if (!str(body.name, 80)) fail('Enter your full name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Enter a valid email address');
    if (!strongPw(body.password)) fail('Password needs 8+ characters with a letter and a number');
    if (role === 'manager' && (!str(body.company) || !str(body.companyLocation))) fail('Enter your company name and location');
    if (db.users.some(u => u.email === email && u.role === role)) fail('An account with this email already exists');
    const salt = crypto.randomBytes(8).toString('hex');
    const u = { id: id(), role, name: str(body.name, 80), email, pw: salt + ':' + hashPw(body.password, salt), createdAt: Date.now() };
    if (role === 'manager') u.company = { name: str(body.company, 80), location: str(body.companyLocation, 80), details: '' };
    db.users.push(u); save();
    return { token: makeToken({ id: u.id }, 8 * 3600e3), user: publicUser(u) };
  }
  if (R('POST', '/api/auth/login')) {
    const email = str(body.email, 120).toLowerCase();
    throttle('login:' + email);
    const u = db.users.find(y => y.email === email && y.role === body.role);
    const [salt, hash] = u ? u.pw.split(':') : ['x', 'x'.repeat(64)];
    const ok = crypto.timingSafeEqual(Buffer.from(hashPw(String(body.password || ''), salt)), Buffer.from(u ? hash : hashPw('x', salt)));
    if (!u || !ok) fail('Wrong email or password', 401);
    return { token: makeToken({ id: u.id }, 8 * 3600e3), user: publicUser(u) };
  }
  if (R('POST', '/api/auth/forgot')) {
    throttle('forgot:' + str(body.email).toLowerCase());
    const u = db.users.find(y => y.email === str(body.email, 120).toLowerCase() && y.role === body.role);
    const out = { message: 'If this email is registered, a reset link has been sent.' };
    if (u) {
      const token = crypto.randomBytes(24).toString('hex');
      db.resets.push({ token: sign(token), userId: u.id, exp: Date.now() + 30 * 60e3 }); save();
      const link = `/${u.role}-login.html?reset=${token}`;
      console.log('[password reset link, no email service connected] http://localhost:' + PORT + link);
      if (process.env.DEV_SHOW_RESET_LINK === '1') out.devLink = link;
    }
    return out;
  }
  if (R('POST', '/api/auth/reset')) {
    const r = db.resets.find(y => y.token === sign(String(body.token || '')) && y.exp > Date.now());
    if (!r) fail('This reset link is invalid or has expired');
    if (!strongPw(body.password)) fail('Password needs 8+ characters with a letter and a number');
    const u = db.users.find(y => y.id === r.userId), salt = crypto.randomBytes(8).toString('hex');
    u.pw = salt + ':' + hashPw(body.password, salt);
    db.resets = db.resets.filter(y => y !== r); save();
    return { ok: 1 };
  }

  // ----- file view with a short-lived token (the token itself is the credential for the iframe) -----
  if (R('GET', '/api/resume-view')) {
    const t = readToken(query.t);
    if (!t || t.k !== 'resume') fail('This resume link has expired. Open it again.', 401);
    const a = db.apps.find(y => y.id === t.a), j = a && db.jobs.find(y => y.id === a.jobId);
    if (!a || j.managerId !== t.u) fail('Not allowed', 403);
    const w = db.users.find(y => y.id === a.workerId), p = profileOf(w);
    return { file: path.join(UPLOADS, p.resumeFile), text: p.resumeText };
  }

  if (!user) fail('Please log in', 401);

  if (R('GET', '/api/me')) return publicUser(user);
  if (R('GET', '/api/notifications')) {
    const mine = db.notes.filter(n => n.userId === user.id).sort((a, b) => b.at - a.at).slice(0, 60);
    return { items: mine, unread: mine.filter(n => !n.read).length };
  }
  if (R('POST', '/api/notifications/read')) { db.notes.filter(n => n.userId === user.id).forEach(n => n.read = true); save(); return { ok: 1 }; }

  // ----- messages (both sides of an application) -----
  if (R('GET', '/api/threads')) {
    const apps = user.role === 'worker' ? db.apps.filter(a => a.workerId === user.id)
      : db.apps.filter(a => db.jobs.find(j => j.id === a.jobId).managerId === user.id);
    return apps.map(a => {
      const j = db.jobs.find(y => y.id === a.jobId), other = db.users.find(y => y.id === (user.role === 'worker' ? j.managerId : a.workerId));
      const last = db.messages.filter(m => m.appId === a.id).pop();
      return { appId: a.id, title: j.title, company: j.company, with: other.name, status: a.status, last: last ? last.text : '', at: last ? last.at : a.createdAt };
    }).sort((a, b) => b.at - a.at);
  }
  if ((x = R('GET', '/api/messages/(\\w+)'))) {
    sharedApp(x[1]);
    return db.messages.filter(m => m.appId === x[1]).map(m => ({ ...m, mine: m.from === user.id, fromName: db.users.find(u => u.id === m.from).name }));
  }
  if ((x = R('POST', '/api/messages/(\\w+)'))) {
    const { a, j } = sharedApp(x[1]), text = str(body.text, 1000);
    if (!text) fail('Write a message first');
    db.messages.push({ id: id(), appId: a.id, from: user.id, text, at: Date.now() });
    note(user.id === a.workerId ? j.managerId : a.workerId, 'New message from ' + user.name + ' about ' + j.title);
    save(); return { ok: 1 };
  }

  // ===== worker =====
  if (R('PUT', '/api/profile')) {
    need('worker'); const p = profileOf(user);
    if (body.experience && !LEVELS.includes(body.experience)) fail('Invalid experience level');
    Object.assign(p, { education: str(body.education, 120), college: str(body.college, 120), skills: list(body.skills), otherSkills: str(body.otherSkills, 300),
      experience: str(body.experience), role: str(body.role, 80), location: str(body.location, 80), prefLocation: str(body.prefLocation, 80) });
    if (str(body.name, 80)) user.name = str(body.name, 80);
    save(); return publicUser(user);
  }
  if (R('POST', '/api/resume')) {
    need('worker');
    const ext = path.extname(str(body.filename)).toLowerCase();
    if (!['.pdf', '.docx'].includes(ext)) fail('Upload a PDF or DOCX resume');
    const buf = Buffer.from(String(body.data || ''), 'base64');
    if (!buf.length || buf.length > MAX_MB * 1e6) fail(`Resume must be under ${MAX_MB} MB`);
    if ((ext === '.pdf' && buf.subarray(0, 4).toString() !== '%PDF') || (ext === '.docx' && buf.subarray(0, 2).toString() !== 'PK')) fail('This file does not look like a valid ' + ext.slice(1).toUpperCase());
    const p = profileOf(user);
    fs.mkdirSync(UPLOADS, { recursive: true });
    if (p.resumeFile) { try { fs.unlinkSync(path.join(UPLOADS, p.resumeFile)); } catch (e) {} }
    p.resumeFile = user.id + '-' + Date.now() + ext;
    fs.writeFileSync(path.join(UPLOADS, p.resumeFile), buf);
    p.resumeName = path.basename(str(body.filename)).slice(0, 80);
    p.resumeText = extractText(buf, ext).slice(0, 60000);
    save(); return publicUser(user);
  }
  if (R('GET', '/api/jobs')) {
    need('worker'); const p = profileOf(user);
    return db.jobs.filter(j => j.status === 'active' && !expired(j) && j.filled < j.openings).sort((a, b) => b.postedAt - a.postedAt).map(j => {
      const app = db.apps.find(a => a.jobId === j.id && a.workerId === user.id);
      return { ...j, left: j.openings - j.filled, appStatus: app ? app.status : null, match: matchScore(p, j) };
    });
  }
  if (R('POST', '/api/apply')) {
    need('worker');
    const j = db.jobs.find(y => y.id === body.jobId);
    if (!j || j.status !== 'active' || expired(j) || j.filled >= j.openings) fail('This vacancy is no longer open');
    const miss = missingFields(user);
    if (miss.length) fail('Complete your profile first. Missing: ' + miss.join(', '));
    if (db.apps.some(a => a.jobId === j.id && a.workerId === user.id)) fail('You have already applied for this job');
    const a = { id: id(), jobId: j.id, workerId: user.id, status: 'Applied', createdAt: Date.now(), history: [], match: matchScore(profileOf(user), j) };
    setStatus(a, 'Applied', user.name); db.apps.push(a);
    note(user.id, 'Your application for ' + j.title + ' at ' + j.company + ' was submitted.');
    note(j.managerId, user.name + ' applied for ' + j.title);
    save(); return { ok: 1 };
  }
  if (R('GET', '/api/applications')) {
    need('worker');
    return db.apps.filter(a => a.workerId === user.id).sort((a, b) => b.createdAt - a.createdAt).map(a => {
      const j = db.jobs.find(y => y.id === a.jobId);
      return { id: a.id, status: a.status, createdAt: a.createdAt, history: a.history, title: j.title, company: j.company, location: j.location };
    });
  }
  if (R('GET', '/api/offers')) {
    const apps = user.role === 'worker' ? db.apps.filter(a => a.workerId === user.id)
      : db.apps.filter(a => db.jobs.find(j => j.id === a.jobId).managerId === user.id);
    return db.offers.filter(o => apps.some(a => a.id === o.appId)).sort((a, b) => b.createdAt - a.createdAt)
      .map(o => ({ ...letterData(o), appStatus: db.apps.find(a => a.id === o.appId).status, latest: !db.offers.some(p => p.appId === o.appId && p.version > o.version) }));
  }
  if ((x = R('POST', '/api/offers/(\\w+)/respond'))) {
    need('worker');
    const o = db.offers.find(y => y.id === x[1]), a = o && db.apps.find(y => y.id === o.appId);
    if (!o || a.workerId !== user.id) fail('Offer not found', 404);
    if (o.status !== 'sent' || a.status !== 'Offer Sent') fail('This offer is no longer open for a response');
    if (o.fields.deadline && Date.parse(o.fields.deadline + 'T23:59:59Z') < Date.now()) fail('The response deadline has passed');
    const j = db.jobs.find(y => y.id === a.jobId), accept = !!body.accept, text = str(body.message, 1000);
    if (accept) {
      if (j.filled >= j.openings) fail('Sorry, all vacancies are now filled');
      j.filled++; if (j.filled >= j.openings) j.status = 'closed';
    }
    o.status = accept ? 'accepted' : 'declined'; o.reply = text;
    setStatus(a, accept ? 'Offer Accepted' : 'Offer Declined', user.name);
    if (text) db.messages.push({ id: id(), appId: a.id, from: user.id, text, at: Date.now() });
    note(j.managerId, `${user.name} ${accept ? 'accepted' : 'declined'} the offer for ${j.title}` + (text ? ': "' + text + '"' : ''));
    save(); return { ok: 1 };
  }

  // ===== manager =====
  if (R('GET', '/api/company')) { need('manager'); return user.company; }
  if (R('PUT', '/api/company')) {
    need('manager');
    if (!str(body.name) || !str(body.location)) fail('Company name and location are required');
    user.company = { name: str(body.name, 80), location: str(body.location, 80), details: str(body.details, 600) };
    save(); return user.company;
  }
  if (R('POST', '/api/jobs')) {
    need('manager');
    const j = { id: id(), managerId: user.id, company: user.company.name, ...cleanJob(body, user.company), filled: 0, status: 'active', postedAt: Date.now() };
    db.jobs.push(j); save(); return j;
  }
  if (R('GET', '/api/jobs/mine')) {
    need('manager');
    return db.jobs.filter(j => j.managerId === user.id).sort((a, b) => b.postedAt - a.postedAt)
      .map(j => ({ ...j, applicants: db.apps.filter(a => a.jobId === j.id).length }));
  }
  if ((x = R('PUT', '/api/jobs/(\\w+)'))) {
    need('manager');
    const j = db.jobs.find(y => y.id === x[1] && y.managerId === user.id);
    if (!j) fail('Vacancy not found', 404);
    if (body.status) {
      if (!['active', 'closed'].includes(body.status)) fail('Invalid status');
      if (body.status === 'active' && j.filled >= j.openings) fail('All vacancies are filled. Increase the number of vacancies first.');
      j.status = body.status;
    } else Object.assign(j, cleanJob(body, user.company));
    save(); return j;
  }
  if (R('GET', '/api/applicants')) {
    need('manager'); const out = [];
    for (const a of db.apps) {
      const j = db.jobs.find(y => y.id === a.jobId); if (j.managerId !== user.id) continue;
      const w = db.users.find(y => y.id === a.workerId), p = profileOf(w);
      a.match = matchScore(p, j);
      out.push({ id: a.id, jobId: j.id, jobTitle: j.title, name: w.name, email: w.email, education: p.education, college: p.college, skills: p.skills,
        experience: p.experience, location: p.location, hasResume: !!p.resumeName, resumeExt: p.resumeFile ? path.extname(p.resumeFile) : '',
        status: a.status, createdAt: a.createdAt, history: a.history, match: a.match });
    }
    save(); return out.sort((a, b) => (b.match.score || -1) - (a.match.score || -1));
  }
  if ((x = R('POST', '/api/resume-token/(\\w+)'))) {
    need('manager'); const a = ownApp(x[1]), p = profileOf(db.users.find(y => y.id === a.workerId));
    if (!p.resumeFile) fail('No resume uploaded', 404);
    if (a.status === 'Applied') { setStatus(a, 'Under Review', user.name); note(a.workerId, 'Your application for ' + db.jobs.find(j => j.id === a.jobId).title + ' is now under review.'); save(); }
    return { url: '/api/resume-view?t=' + makeToken({ k: 'resume', a: a.id, u: user.id }, 5 * 60e3), kind: path.extname(p.resumeFile) === '.pdf' ? 'pdf' : 'text' };
  }
  if ((x = R('POST', '/api/applications/(\\w+)/status'))) {
    need('manager'); const a = ownApp(x[1]), j = db.jobs.find(y => y.id === a.jobId);
    if (!STATUS_OPEN.includes(a.status)) fail('This application was already ' + a.status.toLowerCase() + '. It cannot be changed.');
    if (body.action === 'select') {
      setStatus(a, 'Selected', user.name); note(a.workerId, `Congratulations! You were selected for ${j.title} at ${j.company}. An offer letter will follow.`);
    } else if (body.action === 'reject') {
      setStatus(a, 'Rejected', user.name); note(a.workerId, `Thank you for applying for ${j.title} at ${j.company}. After careful review, we will not be moving forward with your application.`);
    } else fail('Invalid action');
    save(); return { ok: 1 };
  }
  if ((x = R('POST', '/api/applications/(\\w+)/offer(-preview)?'))) {
    need('manager'); const a = ownApp(x[1]), j = db.jobs.find(y => y.id === a.jobId);
    if (!['Selected', 'Offer Sent'].includes(a.status)) fail('Select the candidate before creating an offer letter');
    const prev = db.offers.filter(o => o.appId === a.id);
    const o = { id: id(), appId: a.id, version: prev.length + 1, fields: cleanOffer(body, j), createdAt: Date.now(), status: 'sent', reply: '' };
    if (x[2]) return letterData(o);
    prev.forEach(p => { if (p.status === 'sent') p.status = 'superseded'; });
    db.offers.push(o);
    if (a.status !== 'Offer Sent') setStatus(a, 'Offer Sent', user.name);
    note(a.workerId, (o.version > 1 ? 'A revised offer letter' : 'An offer letter') + ` for ${j.title} at ${j.company} is waiting in Offer Letters.`);
    save(); return { ok: 1, offerId: o.id };
  }

  fail('Not found', 404);
}

// ---------- static files and HTTP ----------
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serveFile(url, res) {
  const root = path.join(__dirname, 'public'), file = path.join(root, url === '/' ? 'index.html' : decodeURIComponent(url));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}
const sendJson = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  let raw = '';
  req.on('data', d => { raw += d; if (raw.length > (MAX_MB * 1.4 + 1) * 1e6) { res.writeHead(413); res.end(); req.destroy(); } });
  req.on('end', () => {
    const [url, qs] = req.url.split('?'), query = Object.fromEntries(new URLSearchParams(qs || ''));
    if (!url.startsWith('/api/')) return serveFile(url, res);
    const user = userFromToken((req.headers.authorization || '').slice(7));
    let body = {}; try { body = JSON.parse(raw || '{}'); } catch (e) {}
    try {
      // short-lived resume preview (read-only, never cached)
      if (req.method === 'GET' && url === '/api/resume-view') {
        const f = route('GET', url, query, {}, null);
        const hdr = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' };
        if (f.file.endsWith('.pdf')) { res.writeHead(200, { ...hdr, 'Content-Type': 'application/pdf' }); return res.end(fs.readFileSync(f.file)); }
        res.writeHead(200, { ...hdr, 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(f.text.trim() || 'Text could not be extracted from this file.');
      }
      // offer letter PDF: only the worker the letter was issued to
      let m;
      if (req.method === 'GET' && (m = url.match(/^\/api\/offers\/(\w+)\/pdf$/))) {
        const o = db.offers.find(y => y.id === m[1]), a = o && db.apps.find(y => y.id === o.appId);
        if (!user || !o || a.workerId !== user.id) fail('Offer letter not found', 404);
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' });
        return res.end(offerPdf(letterData(o)));
      }
      const out = route(req.method, url, query, body, user);
      sendJson(res, 200, out); if (req.method !== 'GET') save();
    } catch (e) { sendJson(res, e.code || 500, { error: e.message }); }
  });
}).listen(PORT, () => console.log('SkillMatch AI running on http://localhost:' + PORT));
