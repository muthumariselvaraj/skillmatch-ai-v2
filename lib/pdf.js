// Offer letter PDF writer (no external packages).
const clean = t => String(t ?? '').replace(/₹/g, 'Rs. ').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .replace(/[^\x20-\x7e]/g, '?').replace(/([()\\])/g, '\\$1');
function wrap(text, max) {
  const lines = []; let line = '';
  for (const w of String(text).split(/\s+/)) {
    if (line && (line + ' ' + w).length > max) { lines.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function offerPdf(L) {
  const pages = []; let ops, y;
  const newPage = () => { ops = []; pages.push(ops); y = 800; };
  const put = (t, o = {}) => ops.push(`${o.color || '0 g'}\nBT /${o.font || 'F1'} ${o.size || 10.5} Tf ${o.x || 60} ${y} Td (${clean(t)}) Tj ET`);
  const down = n => { y -= n; if (y < 70) newPage(); };
  const para = t => { for (const l of wrap(t, 88)) { put(l); down(15); } down(6); };
  const blue = '0.15 0.3 0.85 rg';

  newPage();
  put(L.company, { size: 20, font: 'F2', color: blue }); down(16);
  if (L.companyLocation) { put(L.companyLocation, { size: 10, color: '0.4 g' }); down(10); }
  ops.push(`${blue} 60 ${y} 475 2 re f`); down(30);
  put('OFFER OF EMPLOYMENT', { size: 13, font: 'F2' }); down(24);
  put('Ref: ' + L.ref, { size: 10 }); put('Date: ' + L.date, { size: 10, x: 400 }); down(26);
  put(L.toName, { font: 'F2' }); down(14); put(L.toEmail, { size: 10 }); down(24);
  put('Subject: ' + L.subject, { font: 'F2' }); down(24);
  L.intro.forEach(para);
  for (const [label, value] of L.details) {
    const lines = wrap(value, 62);
    put(label, { font: 'F2' });
    lines.forEach(l => { put(l, { x: 210 }); down(15); });
  }
  down(8);
  L.terms.forEach(para);
  L.closing.forEach(para);
  down(10); put('Yours sincerely,'); down(40);
  put(L.signatory, { font: 'F2' }); down(15); put(L.signatoryRole);

  const objs = ['<</Type/Catalog/Pages 2 0 R>>',
    `<</Type/Pages/Kids[${pages.map((_, i) => `${5 + 2 * i} 0 R`).join(' ')}]/Count ${pages.length}>>`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica/Encoding/WinAnsiEncoding>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica-Bold/Encoding/WinAnsiEncoding>>'];
  pages.forEach((p, i) => {
    const s = p.join('\n');
    objs.push(`<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents ${6 + 2 * i} 0 R/Resources<</Font<</F1 3 0 R/F2 4 0 R>>>>>>`);
    objs.push(`<</Length ${Buffer.byteLength(s, 'latin1')}>>\nstream\n${s}\nendstream`);
  });
  let out = '%PDF-1.4\n'; const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(n => String(n).padStart(10, '0') + ' 00000 n \n').join('')
    + `trailer\n<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
module.exports = { offerPdf };
