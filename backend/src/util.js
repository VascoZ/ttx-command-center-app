const { HttpError } = require('./auth');

/** Bungkus handler async agar error diteruskan ke middleware error. */
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function id(v, name = 'id') {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, `${name} tidak valid`);
  return n;
}

function optId(v) {
  if (v === null || v === undefined || v === '' || v === 'null') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function str(v, { max = 10000, required = false, name = 'field' } = {}) {
  if (v === null || v === undefined) {
    if (required) throw new HttpError(400, `${name} wajib diisi`);
    return null;
  }
  const s = String(v).trim();
  if (required && !s) throw new HttpError(400, `${name} wajib diisi`);
  return s.slice(0, max);
}

function oneOf(v, list, def) {
  return list.includes(v) ? v : def;
}

function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

function forbid(msg = 'Anda tidak memiliki akses untuk tindakan ini') {
  throw new HttpError(403, msg);
}

function notFound(msg = 'Data tidak ditemukan') {
  throw new HttpError(404, msg);
}

function bad(msg) {
  throw new HttpError(400, msg);
}

module.exports = { ah, id, optId, str, oneOf, bool, forbid, notFound, bad, HttpError };
