'use strict';
/* SIPROPEMPERDA — backend tanpa dependensi eksternal (Node.js >= 18) */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;

// ---------- Konfigurasi (.env sederhana) ----------
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}

const env = process.env;
const PORT = Number(env.PORT) || 3000;
const HOST = env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(env.DATA_DIR || path.join(ROOT, 'data'));
const UPLOAD_DIR = path.resolve(env.UPLOAD_DIR || path.join(ROOT, 'uploads'));
const PUBLIC_DIR = path.join(ROOT, 'public');
const ROOT_STATIC_FILES = new Map([
  ['/', 'frontend.html'],
  ['/admin/', 'index.html'],
]);
const MAX_UPLOAD_MB = Number(env.MAX_UPLOAD_MB) || 25;
const MAX_UPLOAD = MAX_UPLOAD_MB * 1024 * 1024;
const SESSION_HOURS = 12;
const COOKIE_SECURE = env.COOKIE_SECURE === '1';
const TRUST_PROXY = env.TRUST_PROXY === '1';
const CORS_ORIGIN = env.CORS_ORIGIN || '';
for (const d of [DATA_DIR, UPLOAD_DIR, path.join(DATA_DIR, 'backup')]) fs.mkdirSync(d, { recursive: true });

// ---------- Konstanta domain ----------
const STAGES = ['Perencanaan', 'Penyusunan', 'Pembahasan', 'Persetujuan Bersama', 'Penetapan dan Pengundangan'];
const INITIATORS = ['Pemerintah Daerah', 'DPRD'];
const UPLOAD_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png']);
const UPLOAD_NAME = /^[a-z0-9][a-z0-9-]*-[a-f0-9]{10}\.[a-z0-9]{2,5}$/;
const SURVEY = [
  { title: 'A. Kemudahan Penggunaan', questions: ['Dashboard SIPROPEMPERDA mudah dipahami.', 'Menu dan fitur mudah digunakan.', 'Informasi dapat ditemukan dengan cepat.'] },
  { title: 'B. Kualitas Informasi', questions: ['Informasi yang ditampilkan lengkap.', 'Data yang tersedia mudah dipahami.', 'Informasi yang disajikan sesuai kebutuhan pekerjaan.'] },
  { title: 'C. Efektivitas Pemantauan', questions: ['Dashboard memudahkan pemantauan perkembangan Propemperda.', 'Dashboard mempercepat proses monitoring dibanding cara manual.', 'Dashboard membantu mengetahui status setiap Ranperda secara lebih cepat.'] },
  { title: 'D. Manfaat', questions: ['Dashboard membantu meningkatkan efisiensi pekerjaan.', 'Dashboard mempermudah penyusunan laporan atau penyampaian informasi.', 'Dashboard mendukung koordinasi antarbagian.'] },
  { title: 'E. Kepuasan Pengguna', questions: ['Saya puas dengan tampilan Dashboard SIPROPEMPERDA.', 'Dashboard layak digunakan sebagai media monitoring Propemperda.', 'Saya merekomendasikan Dashboard SIPROPEMPERDA untuk digunakan secara berkelanjutan.'] },
];
const SURVEY_QUESTIONS = SURVEY.flatMap((g) => g.questions);
const OPEN_FIELDS = ['kelebihan', 'kekurangan', 'fitur', 'saran'];

// ---------- Penyimpanan (berkas JSON, penulisan atomik) ----------
const dataFile = (n) => path.join(DATA_DIR, n);
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(dataFile(name), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    console.error(`\nBerkas data/${name} rusak atau tidak bisa dibaca: ${e.message}\nPulihkan dari data/backup/ lalu jalankan ulang.\n`);
    process.exit(1);
  }
}
function writeJson(name, obj) {
  const tmp = dataFile(name) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, dataFile(name));
}
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // tanggal WITA

const db = readJson('db.json', { propemperda: [], ranperda: [] });
const surveys = readJson('survey.json', []);
const stats = readJson('stats.json', { total: 0, days: {} });
let auth = readJson('admin.json', null);

function saveDb() {
  const backupDir = path.join(DATA_DIR, 'backup');
  const bk = path.join(backupDir, `db-${today()}.json`);
  if (!fs.existsSync(bk) && fs.existsSync(dataFile('db.json'))) fs.copyFileSync(dataFile('db.json'), bk);
  fs.readdirSync(backupDir).filter((f) => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -30).forEach((f) => fs.unlinkSync(path.join(backupDir, f)));
  writeJson('db.json', db);
  gcUploads();
}
// Hapus berkas unggahan yang tidak lagi dipakai data mana pun (setelah 24 jam, agar unggahan yang belum disimpan aman)
function gcUploads() {
  const used = new Set([...JSON.stringify(db).matchAll(/\/uploads\/([\w.-]+)/g)].map((m) => m[1]));
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    if (used.has(f) || !UPLOAD_NAME.test(f)) continue;
    try {
      const p = path.join(UPLOAD_DIR, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 864e5) fs.unlinkSync(p);
    } catch {}
  }
}
let statsTimer = null;
const scheduleStats = () => { if (!statsTimer) statsTimer = setTimeout(flushStats, 10000); };
function flushStats() {
  clearTimeout(statsTimer);
  statsTimer = null;
  writeJson('stats.json', stats);
}

// ---------- Akun admin & sesi ----------
const scrypt = (pw, salt) => crypto.scryptSync(pw, salt, 64);
function setAdmin(username, password) {
  const salt = crypto.randomBytes(16).toString('hex');
  auth = { username, salt, hash: scrypt(password, salt).toString('hex'), secret: crypto.randomBytes(32).toString('hex') };
  writeJson('admin.json', auth);
}
function checkPw(pw) {
  const h = scrypt(String(pw), auth.salt);
  return crypto.timingSafeEqual(h, Buffer.from(auth.hash, 'hex'));
}

const cliIdx = process.argv.indexOf('--reset-admin');
if (cliIdx !== -1) {
  const [user, pw] = process.argv.slice(cliIdx + 1);
  if (!user || !pw || pw.length < 8) {
    console.error('Pemakaian: node server.js --reset-admin <username> <kata-sandi-min-8-karakter>');
    process.exit(1);
  }
  setAdmin(user, pw);
  console.log(`Akun admin diatur ulang. Username: ${user}`);
  process.exit(0);
}
if (!auth) {
  const pw = env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  setAdmin(env.ADMIN_USER || 'admin', pw);
  console.log('\n=== Akun admin dibuat ===');
  console.log(`Username : ${auth.username}`);
  console.log(env.ADMIN_PASSWORD ? 'Password : (sesuai ADMIN_PASSWORD di .env)' : `Password : ${pw}   <- catat, lalu segera ganti di menu Akun`);
  console.log('=========================\n');
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (s) => crypto.createHmac('sha256', auth.secret).update(s).digest('base64url');
const makeToken = () => {
  const p = b64(JSON.stringify({ u: auth.username, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  return `${p}.${sign(p)}`;
};
const sessionCookie = (v, maxAge) => `sid=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${COOKIE_SECURE ? '; Secure' : ''}`;
function readSession(req) {
  const m = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [p, s] = m[1].split('.');
  if (!p || !s) return null;
  const good = sign(p);
  if (s.length !== good.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(good))) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    return d.exp > Date.now() && d.u === auth.username ? d : null;
  } catch {
    return null;
  }
}

// ---------- Pembatas laju permintaan ----------
const buckets = new Map();
const blocked = (key, max) => { const b = buckets.get(key); return !!b && b.reset > Date.now() && b.n >= max; };
function strike(key, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < now) buckets.set(key, (b = { n: 0, reset: now + windowMs }));
  b.n++;
}
setInterval(() => { const n = Date.now(); for (const [k, b] of buckets) if (b.reset < n) buckets.delete(k); }, 6e4).unref();
const clientIp = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

// ---------- Utilitas HTTP ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => new HttpError(status, msg);
const newId = () => crypto.randomBytes(6).toString('hex');
function json(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}
function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) { reject(bad('Data terlalu besar', 413)); chunks.length = 0; } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJsonBody(req) {
  const raw = (await readBody(req)).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { throw bad('Format JSON tidak valid'); }
}
async function readSurveyBody(req) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/x-www-form-urlencoded') return readJsonBody(req);
  const raw = (await readBody(req, 64 * 1024)).toString('utf8');
  return Object.fromEntries(new URLSearchParams(raw));
}
function saveUpload(req, name) {
  return new Promise((resolve, reject) => {
    const file = path.join(UPLOAD_DIR, name);
    const out = fs.createWriteStream(file, { flags: 'wx' });
    let size = 0, failed = false;
    const fail = (e) => { if (failed) return; failed = true; out.destroy(); fs.unlink(file, () => {}); reject(e); };
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_UPLOAD && !failed) { req.unpipe(out); fail(bad(`Ukuran berkas melebihi batas ${MAX_UPLOAD_MB} MB`, 413)); }
    });
    out.on('finish', () => { if (!failed) resolve(size); });
    out.on('error', fail);
    req.on('error', fail);
    req.on('aborted', () => fail(bad('Unggahan dibatalkan')));
    req.pipe(out);
  });
}

// ---------- Validasi ----------
const str = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const okUrl = (u) => u.length <= 2000 && (/^https?:\/\/[^\s<>"']+$/i.test(u) || /^\/uploads\/[\w.-]+$/.test(u));
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
function cleanYear(v) {
  const y = Number(v);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw bad('Tahun tidak valid');
  return y;
}
function cleanDate(v, optional = true) {
  const d = str(v, 10);
  if (!d && optional) return '';
  if (!okDate(d)) throw bad('Format tanggal tidak valid');
  return d;
}
function cleanUrl(v, where) {
  const u = str(v, 2000);
  if (!u) throw bad(`${where}: tautan atau berkas wajib diisi`);
  if (!okUrl(u)) throw bad(`${where}: tautan harus diawali http:// atau https://`);
  return u;
}
function cleanDoc(d, stage) {
  const where = `Dokumen tahap ${stage}`;
  const label = str(d?.label, 200);
  if (!label) throw bad(`${where}: nama dokumen wajib diisi`);
  return { label, date: cleanDate(d.date), note: str(d.note, 600), url: cleanUrl(d.url, `${where} "${label}"`) };
}
function cleanRanperda(b, id) {
  const title = str(b.title, 400);
  if (!title) throw bad('Judul Ranperda wajib diisi');
  if (!INITIATORS.includes(b.initiator)) throw bad('Pengusul tidak valid');
  const completed = Number(b.completed);
  if (!Number.isInteger(completed) || completed < 0 || completed > STAGES.length) throw bad('Tahap tidak valid');
  const docs = {};
  for (const s of STAGES) docs[s] = (Array.isArray(b.docs?.[s]) ? b.docs[s] : []).slice(0, 50).map((d) => cleanDoc(d, s));
  return { id, year: cleanYear(b.year), title, initiator: b.initiator, completed, docs };
}
function cleanPropemperda(b, id) {
  const title = str(b.title, 200);
  if (!title) throw bad('Judul dokumen wajib diisi');
  return { id, year: cleanYear(b.year), title, date: cleanDate(b.date), url: cleanUrl(b.url, 'Dokumen') };
}
const findIdx = (list, id) => {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw bad('Data tidak ditemukan', 404);
  return i;
};
const slug = (s) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'berkas';
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // cegah injeksi rumus di Excel
  return `"${s.replace(/"/g, '""')}"`;
};
const average = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// ---------- Rute ----------
const routes = [];
const on = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp(`^${pattern}$`), handler, ...opts });
const ID = '(?<id>[a-f0-9]+)';

// Publik
on('GET', '/api/public', ({ res }) => {
  const years = [...new Set([...db.propemperda, ...db.ranperda].map((x) => x.year))].sort();
  json(res, 200, { years, propemperda: db.propemperda, ranperda: db.ranperda, survey: SURVEY, visits: stats.total });
}, { cors: true });

on('POST', '/api/visit', ({ res, ip }) => {
  if (blocked(`visit:${ip}`, 60)) throw bad('Terlalu banyak permintaan', 429);
  strike(`visit:${ip}`, 36e5);
  stats.total++;
  const d = today();
  stats.days[d] = (stats.days[d] || 0) + 1;
  Object.keys(stats.days).sort().slice(0, -120).forEach((k) => delete stats.days[k]);
  scheduleStats();
  json(res, 200, { total: stats.total });
}, { cors: true });

on('POST', '/api/survey', async ({ req, res, ip }) => {
  if (blocked(`survey:${ip}`, 5)) throw bad('Terlalu banyak pengiriman. Coba lagi nanti.', 429);
  const b = await readSurveyBody(req);
  const nama = str(b.nama, 100);
  if (!nama) throw bad('Nama wajib diisi');
  const q = SURVEY_QUESTIONS.map((_, i) => {
    const v = Number(b[`q${i + 1}`]);
    if (!Number.isInteger(v) || v < 1 || v > 5) throw bad(`Penilaian nomor ${i + 1} belum diisi`);
    return v;
  });
  const entry = { id: newId(), at: new Date().toISOString(), nama, q };
  for (const f of OPEN_FIELDS) entry[f] = str(b[f], 2000);
  surveys.push(entry);
  writeJson('survey.json', surveys);
  strike(`survey:${ip}`, 36e5);
  json(res, 201, { status: 'success', ok: true });
}, { cors: true });

// Autentikasi
on('POST', '/api/admin/login', async ({ req, res, ip }) => {
  const key = `login:${ip}`;
  if (blocked(key, 8)) throw bad('Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.', 429);
  const b = await readJsonBody(req);
  const okPw = checkPw(b.password ?? '');
  if (!(okPw && str(b.username, 100) === auth.username)) {
    strike(key, 15 * 60e3);
    throw bad('Nama pengguna atau kata sandi salah', 401);
  }
  buckets.delete(key);
  json(res, 200, { username: auth.username }, { 'Set-Cookie': sessionCookie(makeToken(), SESSION_HOURS * 3600) });
});
on('POST', '/api/admin/logout', ({ res }) => json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) }));
on('GET', '/api/admin/me', ({ res }) => json(res, 200, { username: auth.username }), { admin: true });
on('POST', '/api/admin/password', async ({ req, res }) => {
  const b = await readJsonBody(req);
  if (!checkPw(b.current ?? '')) throw bad('Kata sandi saat ini salah', 403);
  const next = String(b.next ?? '');
  if (next.length < 8) throw bad('Kata sandi baru minimal 8 karakter');
  setAdmin(auth.username, next);
  json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(makeToken(), SESSION_HOURS * 3600) });
}, { admin: true });

// Data
on('GET', '/api/admin/data', ({ res }) => json(res, 200, { propemperda: db.propemperda, ranperda: db.ranperda, survey: SURVEY }), { admin: true });
on('GET', '/api/admin/summary', ({ res }) => {
  let count = 0, bytes = 0;
  for (const f of fs.readdirSync(UPLOAD_DIR)) {
    try { const st = fs.statSync(path.join(UPLOAD_DIR, f)); if (st.isFile()) { count++; bytes += st.size; } } catch {}
  }
  json(res, 200, {
    visits: { total: stats.total, today: stats.days[today()] || 0 },
    surveys: surveys.length,
    uploads: { count, bytes },
    limits: { maxUploadMB: MAX_UPLOAD_MB, extensions: [...UPLOAD_EXT] },
  });
}, { admin: true });
on('GET', '/api/admin/backup', ({ res }) => {
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), ...db, surveys }, null, 2);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="sipropemperda-backup-${today()}.json"`, 'Cache-Control': 'no-store' });
  res.end(body);
}, { admin: true });

on('POST', '/api/admin/propemperda', async ({ req, res }) => {
  const item = cleanPropemperda(await readJsonBody(req), newId());
  db.propemperda.push(item);
  saveDb();
  json(res, 201, item);
}, { admin: true });
on('PUT', `/api/admin/propemperda/${ID}`, async ({ req, res, params }) => {
  const i = findIdx(db.propemperda, params.id);
  db.propemperda[i] = cleanPropemperda(await readJsonBody(req), params.id);
  saveDb();
  json(res, 200, db.propemperda[i]);
}, { admin: true });
on('DELETE', `/api/admin/propemperda/${ID}`, ({ res, params }) => {
  db.propemperda.splice(findIdx(db.propemperda, params.id), 1);
  saveDb();
  json(res, 200, { ok: true });
}, { admin: true });

on('POST', '/api/admin/ranperda', async ({ req, res }) => {
  const item = cleanRanperda(await readJsonBody(req), newId());
  db.ranperda.push(item);
  saveDb();
  json(res, 201, item);
}, { admin: true });
on('PUT', `/api/admin/ranperda/${ID}`, async ({ req, res, params }) => {
  const i = findIdx(db.ranperda, params.id);
  db.ranperda[i] = cleanRanperda(await readJsonBody(req), params.id);
  saveDb();
  json(res, 200, db.ranperda[i]);
}, { admin: true });
on('DELETE', `/api/admin/ranperda/${ID}`, ({ res, params }) => {
  db.ranperda.splice(findIdx(db.ranperda, params.id), 1);
  saveDb();
  json(res, 200, { ok: true });
}, { admin: true });
on('POST', `/api/admin/ranperda/${ID}/move`, async ({ req, res, params }) => {
  const dir = (await readJsonBody(req)).dir === -1 ? -1 : 1;
  const list = db.ranperda;
  const i = findIdx(list, params.id);
  let j = i + dir;
  while (list[j] && list[j].year !== list[i].year) j += dir; // hanya tukar dengan Ranperda di tahun yang sama
  if (list[j]) { [list[i], list[j]] = [list[j], list[i]]; saveDb(); }
  json(res, 200, { ok: true });
}, { admin: true });

on('POST', '/api/admin/upload', async ({ req, res, url }) => {
  const orig = str(url.searchParams.get('name'), 200);
  const ext = path.extname(orig).toLowerCase();
  if (!UPLOAD_EXT.has(ext)) throw bad(`Jenis berkas "${ext || 'tanpa ekstensi'}" tidak diizinkan. Gunakan: ${[...UPLOAD_EXT].join(', ')}`, 415);
  if (Number(req.headers['content-length'] || 0) > MAX_UPLOAD) throw bad(`Ukuran berkas melebihi batas ${MAX_UPLOAD_MB} MB`, 413);
  const name = `${slug(path.basename(orig, ext))}-${crypto.randomBytes(5).toString('hex')}${ext}`;
  const size = await saveUpload(req, name);
  json(res, 201, { url: `/uploads/${name}`, name: orig, size });
}, { admin: true });

on('GET', '/api/admin/surveys', ({ res }) => json(res, 200, surveys), { admin: true });
on('DELETE', `/api/admin/surveys/${ID}`, ({ res, params }) => {
  surveys.splice(findIdx(surveys, params.id), 1);
  writeJson('survey.json', surveys);
  json(res, 200, { ok: true });
}, { admin: true });
on('GET', '/api/admin/surveys.csv', ({ res }) => {
  const head = ['Waktu', 'Nama', ...SURVEY_QUESTIONS.map((q, i) => `${i + 1}. ${q}`), 'Rata-rata', 'Kelebihan', 'Kekurangan', 'Fitur yang perlu ditambahkan', 'Saran'];
  const rows = surveys.map((s) => [s.at, s.nama, ...s.q, average(s.q).toFixed(2), s.kelebihan, s.kekurangan, s.fitur, s.saran]);
  const csv = '\ufeff' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="survei-sipropemperda-${today()}.csv"`, 'Cache-Control': 'no-store' });
  res.end(csv);
}, { admin: true });

// ---------- Berkas statis & unggahan ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const INLINE = new Set(['.pdf', '.png', '.jpg', '.jpeg']);
function sendFile(req, res, file, { upload = false } = {}) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Halaman atau berkas tidak ditemukan'); }
    const ext = path.extname(file).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size };
    if (upload) {
      headers['Cache-Control'] = 'public, max-age=86400';
      headers['Content-Disposition'] = `${INLINE.has(ext) ? 'inline' : 'attachment'}; filename="${path.basename(file)}"`;
    } else {
      headers['Cache-Control'] = ext === '.html' || file.includes(`${path.sep}admin${path.sep}`) ? 'no-cache' : 'public, max-age=3600';
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}
function serveStatic(req, res, pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { throw bad('Alamat tidak valid'); }
  if (p.includes('\0')) throw bad('Alamat tidak valid');
  if (p === '/admin') { res.writeHead(301, { Location: '/admin/' }); return res.end(); }
  if (p.startsWith('/uploads/')) {
    const name = p.slice(9);
    if (!/^[\w][\w.-]*$/.test(name)) throw bad('Berkas tidak ditemukan', 404);
    return sendFile(req, res, path.join(UPLOAD_DIR, name), { upload: true });
  }
  const rootFile = ROOT_STATIC_FILES.get(p);
  if (rootFile) {
    const file = p === '/admin/' && fs.existsSync(path.join(PUBLIC_DIR, 'admin', 'index.html'))
      ? path.join(PUBLIC_DIR, 'admin', 'index.html')
      : path.join(ROOT, rootFile);
    return sendFile(req, res, file);
  }
  if (p.endsWith('/')) p += 'index.html';
  const file = path.resolve(PUBLIC_DIR, '.' + p);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw bad('Akses ditolak', 403);
  sendFile(req, res, file);
}

// ---------- Server ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');

    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw bad('Metode tidak diizinkan', 405);
      return serveStatic(req, res, pathname);
    }

    const route = routes.find((r) => r.method === req.method && r.re.test(pathname));
    const cors = CORS_ORIGIN && (route?.cors || req.method === 'OPTIONS');
    if (cors) {
      res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (!route) throw bad('Endpoint tidak ditemukan', 404);

    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && origin !== CORS_ORIGIN) {
        let host = '';
        try { host = new URL(origin).host; } catch {}
        if (host !== req.headers.host) throw bad('Asal permintaan ditolak', 403);
      }
    }
    if (route.admin) {
      if (!readSession(req)) throw bad('Sesi berakhir. Silakan masuk lagi.', 401);
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') throw bad('Permintaan tidak valid', 403);
    }
    await route.handler({ req, res, url, ip: clientIp(req), params: route.re.exec(pathname).groups || {} });
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.destroy();
    const headers = status === 413 ? { Connection: 'close' } : {};
    json(res, status, { error: status === 500 ? 'Terjadi kesalahan pada server' : e.message }, headers);
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flushStats(); process.exit(0); });
gcUploads();
server.listen(PORT, HOST, () => {
  console.log(`SIPROPEMPERDA berjalan di http://localhost:${PORT}`);
  console.log(`Panel admin             : http://localhost:${PORT}/admin/`);
});
