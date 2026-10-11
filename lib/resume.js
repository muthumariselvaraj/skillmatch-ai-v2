// Reads text out of PDF and DOCX resumes (no external packages).
const zlib = require('zlib');

function unzipEntry(buf, name) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  if (eocd < 0) return null;
  let count = buf.readUInt16LE(eocd + 10), p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method ? zlib.inflateRawSync(data) : data;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function docxText(buf) {
  const xml = unzipEntry(buf, 'word/document.xml');
  if (!xml) return '';
  return xml.toString('utf8').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function pdfText(buf) {
  let out = '';
  const s = buf.toString('latin1'), re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = re.exec(s))) {
    let d = Buffer.from(m[1], 'latin1');
    try { d = zlib.inflateSync(d); } catch (e) {}
    for (const x of d.toString('latin1').matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj|\[((?:\\.|[^\]])*)\]\s*TJ/g)) {
      const parts = x[1] !== undefined ? [x[1]] : [...x[2].matchAll(/\(((?:\\.|[^\\)])*)\)/g)].map(y => y[1]);
      out += parts.join('').replace(/\\(.)/g, '$1') + ' ';
    }
  }
  return out;
}

function extractText(buf, ext) {
  try { return ext === '.docx' ? docxText(buf) : pdfText(buf); } catch (e) { return ''; }
}
module.exports = { extractText };
