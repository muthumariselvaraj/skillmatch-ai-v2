// LOCAL DEVELOPMENT ONLY: creates demo accounts and vacancies. Run with: npm run seed
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const DATA = process.env.DATA_DIR || __dirname, FILE = path.join(DATA, 'db.json');
const db = Object.assign({ users: [], jobs: [], apps: [], offers: [], messages: [], notes: [], resets: [] }, fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {});
const id = () => crypto.randomBytes(6).toString('hex');
const pw = p => { const s = crypto.randomBytes(8).toString('hex'); return s + ':' + crypto.scryptSync(p, s, 32).toString('hex'); };
if (db.users.some(u => u.email === 'asha@demo.test')) { console.log('Demo data already exists.'); process.exit(); }
const mgr = { id: id(), role: 'manager', name: 'Asha Rao', email: 'asha@demo.test', pw: pw('Demo@1234'), createdAt: Date.now(), company: { name: 'Nova Tech Solutions', location: 'Chennai', details: 'Demo company for local testing.' } };
const wrk = { id: id(), role: 'worker', name: 'Arun Kumar', email: 'arun@demo.test', pw: pw('Demo@1234'), createdAt: Date.now(),
  profile: { education: 'B.E Computer Science', college: 'Demo Institute of Technology', skills: ['Python', 'SQL', 'Git'], otherSkills: 'Communication', experience: '1-2 years', role: 'Python Developer', location: 'Chennai', prefLocation: 'Chennai' } };
db.users.push(mgr, wrk);
const jobs = [
  ['Python Developer', ['Python', 'SQL', 'Django', 'Git'], ['Docker'], '0-1 years', 'Build and maintain backend APIs for our products.'],
  ['Java Developer', ['Java', 'Spring Boot', 'SQL'], [], '1-2 years', 'Develop enterprise services in Java.'],
  ['Full Stack Developer', ['JavaScript', 'React', 'Node.js', 'SQL'], ['Git'], '1-2 years', 'Work across our React front end and Node.js back end.']
];
for (const [title, skills, preferred, experience, description] of jobs)
  db.jobs.push({ id: id(), managerId: mgr.id, company: mgr.company.name, title, location: 'Chennai', type: 'Full-Time', experience, skills, preferred, description, minQual: 'B.E / B.Tech', openings: 2, deadline: '', filled: 0, status: 'active', postedAt: Date.now() });
fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 1));
console.log('Demo data created.\n  Manager: asha@demo.test / Demo@1234\n  Worker:  arun@demo.test / Demo@1234 (upload a resume before applying)');
