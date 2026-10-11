// End-to-end test: starts the server on a temporary folder and walks the whole hiring flow.
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const PORT = 3199, BASE = 'http://localhost:' + PORT, DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'skillmatch-'));
const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: DATA }, stdio: 'ignore' });
let pass = 0;
const ok = (c, m) => { if (!c) { console.log('FAIL: ' + m); cleanup(1); } console.log('PASS: ' + m); pass++; };
function cleanup(code) { srv.kill(); fs.rmSync(DATA, { recursive: true, force: true }); process.exit(code); }
async function call(method, url, body, token) {
  const r = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (token || '') }, body: body ? JSON.stringify(body) : undefined });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, data: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const pdf = text => Buffer.from(`%PDF-1.4\n1 0 obj\n<<>>\nstream\nBT /F1 12 Tf (${text}) Tj ET\nendstream\nendobj\n%%EOF`).toString('base64');
(async () => {
  await new Promise(r => setTimeout(r, 800));
  const reg = (b) => call('POST', '/api/auth/register', b);
  let r = await reg({ role: 'worker', name: 'Arun Kumar', email: 'arun@test.dev', password: 'weak' }); ok(r.status === 400, 'weak password rejected');
  r = await reg({ role: 'worker', name: 'Arun Kumar', email: 'arun@test.dev', password: 'Demo@1234' }); const W = r.data.token; ok(!!W, 'worker registered');
  r = await reg({ role: 'worker', name: 'Arun Kumar', email: 'arun@test.dev', password: 'Demo@1234' }); ok(r.status === 400, 'duplicate account rejected');
  r = await reg({ role: 'manager', name: 'Asha Rao', email: 'asha@test.dev', password: 'Demo@1234', company: 'Nova Tech', companyLocation: 'Chennai' }); const M = r.data.token; ok(!!M, 'manager registered');
  r = await reg({ role: 'manager', name: 'Other Boss', email: 'other@test.dev', password: 'Demo@1234', company: 'Rival Soft', companyLocation: 'Pune' }); const M2 = r.data.token;
  r = await call('POST', '/api/auth/login', { role: 'manager', email: 'asha@test.dev', password: 'wrongpass1' }); ok(r.status === 401, 'wrong password rejected');
  r = await call('POST', '/api/auth/login', { role: 'worker', email: 'asha@test.dev', password: 'Demo@1234' }); ok(r.status === 401, 'manager cannot log in on worker page');

  r = await call('POST', '/api/jobs', { title: 'Python Developer', type: 'Full-Time', experience: '0-1 years', skills: 'Python, SQL, Django, Git', description: 'Build APIs.', openings: 2 }, W); ok(r.status === 403, 'worker cannot post jobs');
  r = await call('POST', '/api/jobs', { title: 'Python Developer', type: 'Full-Time', experience: '0-1 years', skills: 'Python, SQL, Django, Git', description: 'Build APIs.', openings: 2 }, M); const job = r.data; ok(!!job.id, 'manager posted job');
  r = await call('GET', '/api/jobs', null, W); ok(r.data.length === 1 && r.data[0].match.incomplete, 'worker sees job, match incomplete before profile');
  r = await call('POST', '/api/apply', { jobId: job.id }, W); ok(r.status === 400, 'apply blocked until profile + resume complete');

  await call('PUT', '/api/profile', { education: 'B.E Computer Science', skills: 'Python, SQL', experience: '1-2 years', role: 'Python Developer', location: 'Chennai' }, W);
  r = await call('POST', '/api/resume', { filename: 'cv.pdf', data: Buffer.from('not a pdf').toString('base64') }, W); ok(r.status === 400, 'fake PDF rejected');
  r = await call('POST', '/api/resume', { filename: 'cv.pdf', data: pdf('Python developer. Worked with SQL and Git on web projects.') }, W); ok(r.data.profile.hasResume, 'resume uploaded');
  r = await call('GET', '/api/jobs', null, W); const m = r.data[0].match; ok(m.score === 80 && m.matched.join() === 'Python,SQL,Git' && m.missing.join() === 'Django', 'match computed: 80% (3/4 required skills, experience ok)');

  r = await call('POST', '/api/apply', { jobId: job.id }, W); ok(r.status === 200, 'applied');
  r = await call('POST', '/api/apply', { jobId: job.id }, W); ok(r.status === 400, 'duplicate application rejected');
  r = await call('GET', '/api/applicants', null, M); const app = r.data[0]; ok(r.data.length === 1 && app.match.score === 80, 'manager sees applicant with score');
  r = await call('GET', '/api/applicants', null, M2); ok(r.data.length === 0, 'other company sees no applicants');
  r = await call('POST', '/api/resume-token/' + app.id, null, M2); ok(r.status === 404, 'other company cannot open resume');
  r = await call('POST', '/api/resume-token/' + app.id, null, W); ok(r.status === 403, 'worker cannot request resume token');
  r = await call('POST', '/api/resume-token/' + app.id, null, M); ok(r.data.kind === 'pdf', 'manager gets short-lived resume link');
  const v = await call('GET', r.data.url); ok(v.status === 200 && v.data.subarray(0, 4).toString() === '%PDF', 'resume previews inline');
  r = await call('GET', '/api/applicants', null, M); ok(r.data[0].status === 'Under Review', 'status moved to Under Review');

  r = await call('POST', `/api/applications/${app.id}/offer`, { salary: 'Rs. 6,00,000', startDate: '2026-12-01', signatory: 'Asha Rao' }, M); ok(r.status === 400, 'offer blocked before selection');
  r = await call('POST', `/api/applications/${app.id}/status`, { action: 'select' }, W); ok(r.status === 403, 'worker cannot select');
  r = await call('POST', `/api/applications/${app.id}/status`, { action: 'select' }, M); ok(r.status === 200, 'manager selected candidate');
  r = await call('POST', `/api/applications/${app.id}/status`, { action: 'reject' }, M); ok(r.status === 400, 'cannot reject after selecting');
  r = await call('POST', `/api/applications/${app.id}/offer`, { startDate: '2026-12-01' }, M); ok(r.status === 400, 'offer needs salary and signatory');
  const terms = { salary: 'Rs. 6,00,000 per year', startDate: '2026-12-01', signatory: 'Asha Rao', reporting: 'Team Lead', terms: 'Subject to document verification.' };
  r = await call('POST', `/api/applications/${app.id}/offer-preview`, terms, M); ok(r.data.ref.endsWith('-V1'), 'offer preview works');
  r = await call('POST', `/api/applications/${app.id}/offer`, terms, M); ok(r.status === 200, 'offer sent');
  r = await call('POST', `/api/applications/${app.id}/offer`, { ...terms, salary: 'Rs. 6,50,000 per year' }, M); ok(r.status === 200, 'revised offer sent');
  r = await call('GET', '/api/offers', null, W); ok(r.data.length === 2 && r.data[0].version === 2 && r.data[1].status === 'superseded', 'worker sees v2, v1 preserved as superseded');
  const o2 = r.data[0];
  const pdfRes = await call('GET', `/api/offers/${o2.id}/pdf`, null, W); ok(pdfRes.status === 200 && pdfRes.data.subarray(0, 5).toString() === '%PDF-', 'worker downloads offer PDF');
  r = await call('GET', `/api/offers/${o2.id}/pdf`, null, M); ok(r.status === 404, 'manager cannot download offer PDF');
  r = await call('POST', `/api/offers/${r.data.id || o2.id}/respond`, { accept: true, message: 'Thank you, I accept.' }, W); ok(r.status === 200, 'worker accepted offer');
  r = await call('GET', '/api/applications', null, W); ok(r.data[0].status === 'Offer Accepted', 'status is Offer Accepted');
  r = await call('POST', `/api/applications/${app.id}/offer`, terms, M); ok(r.status === 400, 'cannot revise after acceptance');

  r = await call('POST', '/api/messages/' + app.id, { text: 'Welcome aboard!' }, M); ok(r.status === 200, 'manager sends message');
  r = await call('GET', '/api/messages/' + app.id, null, W); ok(r.data.length === 2, 'worker sees message thread');
  r = await call('GET', '/api/messages/' + app.id, null, M2); ok(r.status === 404, 'other manager cannot read thread');
  r = await call('GET', '/api/notifications', null, W); ok(r.data.unread >= 4, 'worker has unread notifications');
  console.log(`\nAll ${pass} checks passed.`); cleanup(0);
})().catch(e => { console.log('ERROR', e); cleanup(1); });
