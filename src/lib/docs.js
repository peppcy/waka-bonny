// Driver documents: ID, vehicle papers, union permit and a photo of the vehicle.
// Phones shrink each photo before uploading, so what arrives here is already small and
// is kept in the database. Images are never public: they are served through a short-lived
// signed link, so an <img> tag can show them without exposing the file to anyone else.
const jwt = require('jsonwebtoken');
const { q } = require('./db');
const { HttpError } = require('./util');

const KINDS = {
  id: 'Photo ID (NIN slip, voter card, driver\'s licence)',
  vehicle: 'Vehicle papers',
  permit: 'Association or union permit',
  photo: 'Photo of the vehicle with its plate visible'
};
const MAX_BYTES = 1_500_000;
const TYPES = { 'image/jpeg': [0xFF, 0xD8, 0xFF], 'image/png': [0x89, 0x50, 0x4E, 0x47], 'image/webp': null };

// Reads a data: URL from the app and checks it really is the image it claims to be
function decodeUpload(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new HttpError(400, 'Upload a photo (JPG, PNG or WEBP).');
  const mime = m[1];
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { throw new HttpError(400, 'That photo could not be read. Try taking it again.'); }
  if (!buf.length) throw new HttpError(400, 'That photo is empty.');
  if (buf.length > MAX_BYTES) throw new HttpError(400, 'That photo is too large even after shrinking. Take a new one in better light.');
  const magic = TYPES[mime];
  const okMagic = magic ? magic.every((b, i) => buf[i] === b)
    : buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP';
  if (!okMagic) throw new HttpError(400, 'That file is not a photo.');
  return { mime, buf };
}

const viewToken = (docId) => jwt.sign({ doc: docId, p: 'doc' }, process.env.JWT_SECRET, { expiresIn: '20m' });
function readViewToken(token) {
  try {
    const p = jwt.verify(String(token || ''), process.env.JWT_SECRET);
    if (p.p !== 'doc') throw new Error();
    return p.doc;
  } catch { throw new HttpError(404, 'This link has expired. Open the page again.'); }
}

// Everything except the image itself, plus a link the browser can load it from
async function listFor(userId) {
  const rows = (await q(`SELECT id, kind, mime, size, status, note, created_at, reviewed_at FROM driver_docs WHERE user_id=$1 ORDER BY kind`, [userId])).rows;
  return rows.map(r => ({ ...r, label: KINDS[r.kind], url: '/api/public/doc/' + viewToken(r.id) }));
}

module.exports = { KINDS, MAX_BYTES, decodeUpload, viewToken, readViewToken, listFor };
