// Skill matching. Deterministic and explainable (no LLM). Method:
//   Required skills 70 pts (80 if the job lists no preferred skills)
//   Preferred skills 10 pts
//   Experience 15 pts: level meets the job = full, one level below = half, otherwise 0
//   Qualification 5 pts: a word of the job's minimum qualification appears in the worker's education
// A skill counts as matched when it is in the worker's profile skills OR found in the resume text.
const LEVELS = ['Fresher', '0-1 years', '1-2 years', '2-3 years', '3+ years'];
const KNOWN = ['python','java','javascript','typescript','c++','c#','php','ruby','go','kotlin','swift','sql','mysql','postgresql','mongodb','oracle','html','css','react','angular','vue','node.js','express','django','flask','spring boot','spring','hibernate','git','github','docker','kubernetes','aws','azure','linux','rest api','graphql','pandas','numpy','tensorflow','machine learning','data analysis','power bi','tableau','excel','jira','agile','junit','selenium','data structures','algorithms','bootstrap','tailwind','firebase','redis','jenkins','ci/cd','figma','flutter','android'];

const norm = s => String(s).toLowerCase().replace(/[.\s\-_/]/g, '');
const flat = t => ' ' + String(t || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ') + ' ';
function has(skill, text) {
  const k = skill.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9+# ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!k) return false;
  return [k, k.replace(/ /g, ''), k.replace(/ ?js$/, ''), k + ' js', k + 'js'].some(f => text.includes(' ' + f + ' '));
}
const detect = text => { const t = flat(text); return KNOWN.filter(s => has(s, t)); };

function matchScore(p, job) {
  const skills = p.skills || [];
  if (!p.resumeName) return { incomplete: true, reason: 'Upload your resume to see a match score' };
  if (!skills.length && !(p.resumeText || '').trim()) return { incomplete: true, reason: 'Add your technical skills to see a match score' };
  const text = flat((p.resumeText || '') + ' ' + (p.otherSkills || ''));
  const own = skills.map(norm);
  const found = s => own.includes(norm(s)) || has(s, text);
  const req = job.skills || [], pref = job.preferred || [];
  const matched = req.filter(found), missing = req.filter(s => !found(s));
  const prefMatched = pref.filter(found), prefMissing = pref.filter(s => !found(s));
  const reqW = pref.length ? 70 : 80, prefW = pref.length ? 10 : 0;
  const need = Math.max(0, LEVELS.indexOf(job.experience)), have = LEVELS.indexOf(p.experience);
  const exp = have >= need ? 1 : have === need - 1 ? 0.5 : 0;
  const qualWords = flat(job.minQual).split(' ').filter(w => w.length >= 3);
  const qual = !qualWords.length || qualWords.some(w => flat(p.education).includes(' ' + w + ' ')) ? 1 : 0;
  const score = Math.round(
    reqW * (req.length ? matched.length / req.length : 1) +
    prefW * (pref.length ? prefMatched.length / pref.length : 0) + 15 * exp + 5 * qual);
  const parts = [`${matched.length} of ${req.length} required skills matched`];
  if (pref.length) parts.push(`${prefMatched.length} of ${pref.length} preferred`);
  parts.push(exp === 1 ? 'experience meets the requirement' : exp === 0.5 ? 'experience is one level below' : 'experience is below the requirement');
  if (!qual) parts.push('qualification not found in education');
  return { score, matched, missing, prefMatched, prefMissing, explanation: parts.join('; ') + '.' };
}
module.exports = { LEVELS, matchScore, detect };
