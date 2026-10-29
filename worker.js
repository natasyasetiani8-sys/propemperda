'use strict';

const STAGES = ['Perencanaan', 'Penyusunan', 'Pembahasan', 'Persetujuan Bersama', 'Penetapan dan Pengundangan'];
const INITIATORS = ['Pemerintah Daerah', 'DPRD'];
const UPLOAD_EXT = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png']);
const OPEN_FIELDS = ['kelebihan', 'kekurangan', 'fitur', 'saran'];
const SURVEY = [
  { title: 'A. Kemudahan Penggunaan', questions: ['Dashboard SIPROPEMPERDA mudah dipahami.', 'Menu dan fitur mudah digunakan.', 'Informasi dapat ditemukan dengan cepat.'] },
  { title: 'B. Kualitas Informasi', questions: ['Informasi yang ditampilkan lengkap.', 'Data yang tersedia mudah dipahami.', 'Informasi yang disajikan sesuai kebutuhan pekerjaan.'] },
  { title: 'C. Efektivitas Pemantauan', questions: ['Dashboard memudahkan pemantauan perkembangan Propemperda.', 'Dashboard mempercepat proses monitoring dibanding cara manual.', 'Dashboard membantu mengetahui status setiap Ranperda secara lebih cepat.'] },
  { title: 'D. Manfaat', questions: ['Dashboard membantu meningkatkan efisiensi pekerjaan.', 'Dashboard mempermudah penyusunan laporan atau penyampaian informasi.', 'Dashboard mendukung koordinasi antarbagian.'] },
  { title: 'E. Kepuasan Pengguna', questions: ['Saya puas dengan tampilan Dashboard SIPROPEMPERDA.', 'Dashboard layak digunakan sebagai media monitoring Propemperda.', 'Saya merekomendasikan Dashboard SIPROPEMPERDA untuk digunakan secara berkelanjutan.'] },
];
const SURVEY_QUESTIONS = SURVEY.flatMap((group) => group.questions);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const SESSION_SECONDS = 12 * 60 * 60;
const PBKDF2_ITERATIONS = 20000;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (message, status = 400) => new HttpError(status, message);
const utf8 = new TextEncoder();
const decodeUtf8 = new TextDecoder();
const randomHex = (length) => [...crypto.getRandomValues(new Uint8Array(length))].map((v) => v.toString(16).padStart(2, '0')).join('');
const newId = () => randomHex(6);
const base64url = (value) => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromBase64url = (value) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), (c) => c.charCodeAt(0));
const toHex = (bytes) => [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/.{2}/g) || [], (v) => parseInt(v, 16));
const str = (value, max) => String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const average = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

function allowedOrigins(env) {
  return String(env.CORS_ORIGIN || '').split(',').map((value) => value.trim()).filter(Boolean);
}
function corsHeaders(request, env) {
  const headers = new Headers({ 'Vary': 'Origin' });
  const origin = request.headers.get('Origin');
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Credentials', 'true');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return headers;
}
function response(request, env, body, status = 200, headers = {}) {
  const outHeaders = corsHeaders(request, env);
  for (const [key, value] of Object.entries(headers)) outHeaders.set(key, value);
  return new Response(body, { status, headers: outHeaders });
}
function json(request, env, status, value, headers = {}) {
  return response(request, env, JSON.stringify(value), status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
}
function csv(request, env, content) {
  return response(request, env, content, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="survei-sipropemperda-${today()}.csv"`,
    'Cache-Control': 'no-store',
  });
}

async function readJsonBody(request) {
  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_JSON_BYTES) throw bad('Data terlalu besar', 413);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_JSON_BYTES) throw bad('Data terlalu besar', 413);
  try { return bytes.byteLength ? JSON.parse(decodeUtf8.decode(bytes)) : {}; }
  catch { throw bad('Format JSON tidak valid'); }
}
function cleanYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw bad('Tahun tidak valid');
  return year;
}
function cleanDate(value, optional = true) {
  const date = str(value, 10);
  if (!date && optional) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw bad('Format tanggal tidak valid');
  return date;
}
function cleanUrl(value, where) {
  const url = str(value, 2000);
  if (!url) throw bad(`${where}: tautan atau berkas wajib diisi`);
  if (!(/^https?:\/\/[^\s<>"']+$/i.test(url) || /^\/uploads\/[\w.-]+$/.test(url))) throw bad(`${where}: tautan harus diawali http:// atau https://`);
  return url;
}
function cleanDoc(doc, stage) {
  const where = `Dokumen tahap ${stage}`;
  const label = str(doc?.label, 200);
  if (!label) throw bad(`${where}: nama dokumen wajib diisi`);
  return { label, date: cleanDate(doc.date), note: str(doc.note, 600), url: cleanUrl(doc.url, `${where} "${label}"`) };
}
function cleanRanperda(body, id) {
  const title = str(body?.title, 400);
  if (!title) throw bad('Judul Ranperda wajib diisi');
  if (!INITIATORS.includes(body.initiator)) throw bad('Pengusul tidak valid');
  const completed = Number(body.completed);
  if (!Number.isInteger(completed) || completed < 0 || completed > STAGES.length) throw bad('Tahap tidak valid');
  const docs = {};
  for (const stage of STAGES) docs[stage] = (Array.isArray(body.docs?.[stage]) ? body.docs[stage] : []).slice(0, 50).map((doc) => cleanDoc(doc, stage));
  return { id, year: cleanYear(body.year), title, initiator: body.initiator, completed, docs };
}
function cleanPropemperda(body, id) {
  const title = str(body?.title, 200);
  if (!title) throw bad('Judul dokumen wajib diisi');
  return { id, year: cleanYear(body.year), title, date: cleanDate(body.date), url: cleanUrl(body.url, 'Dokumen') };
}
function cleanSurvey(body) {
  const name = str(body.nama, 100);
  if (!name) throw bad('Nama wajib diisi');
  const answers = SURVEY_QUESTIONS.map((_, index) => {
    const value = Number(body[`q${index + 1}`]);
    if (!Number.isInteger(value) || value < 1 || value > 5) throw bad(`Penilaian nomor ${index + 1} belum diisi`);
    return value;
  });
  const entry = { id: newId(), at: new Date().toISOString(), nama: name, q: answers };
  for (const field of OPEN_FIELDS) entry[field] = str(body[field], 2000);
  return entry;
}

async function hashPassword(password, saltHex, pepper) {
  const key = await crypto.subtle.importKey('raw', utf8.encode(`${String(password)}\0${pepper}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS }, key, 256);
  return toHex(bits);
}
async function ensureAdmin(env) {
  let admin = await env.DB.prepare('SELECT username, salt, password_hash, session_version FROM admin WHERE id = 1').first();
  if (admin) return admin;
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET || !env.PASSWORD_PEPPER) throw bad('Konfigurasi admin belum lengkap', 503);
  if (env.ADMIN_PASSWORD.length < 16) throw bad('ADMIN_PASSWORD harus minimal 16 karakter', 503);
  const username = str(env.ADMIN_USER || 'admin', 100);
  const salt = randomHex(16);
  const passwordHash = await hashPassword(env.ADMIN_PASSWORD, salt, env.PASSWORD_PEPPER);
  await env.DB.prepare('INSERT OR IGNORE INTO admin (id, username, salt, password_hash, session_version) VALUES (1, ?, ?, ?, 1)')
    .bind(username, salt, passwordHash).run();
  admin = await env.DB.prepare('SELECT username, salt, password_hash, session_version FROM admin WHERE id = 1').first();
  return admin;
}
function cookieValue(request) {
  const match = /(?:^|;\s*)sid=([^;]+)/.exec(request.headers.get('Cookie') || '');
  return match?.[1] || '';
}
async function signToken(env, payload) {
  const key = await crypto.subtle.importKey('raw', utf8.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const encoded = base64url(utf8.encode(JSON.stringify(payload)));
  const signature = base64url(await crypto.subtle.sign('HMAC', key, utf8.encode(encoded)));
  return `${encoded}.${signature}`;
}
async function verifySession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const token = cookieValue(request);
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  try {
    const key = await crypto.subtle.importKey('raw', utf8.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('HMAC', key, fromBase64url(signature), utf8.encode(encoded))) return null;
    const payload = JSON.parse(decodeUtf8.decode(fromBase64url(encoded)));
    const admin = await env.DB.prepare('SELECT username, salt, password_hash, session_version FROM admin WHERE id = 1').first();
    if (!admin || payload.exp <= Date.now() || payload.u !== admin.username || payload.v !== admin.session_version) return null;
    return admin;
  } catch { return null; }
}
function sessionCookie(value, maxAge) {
  return `sid=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}`;
}
async function authenticate(request, env) {
  const admin = await verifySession(request, env);
  if (!admin) throw bad('Sesi berakhir. Silakan masuk lagi.', 401);
  if (request.method !== 'GET' && request.headers.get('X-Requested-With') !== 'fetch') throw bad('Permintaan tidak valid', 403);
  return admin;
}

async function blocked(db, key, max) {
  const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
  return Boolean(row && row.reset_at > Date.now() && row.count >= max);
}
async function strike(db, key, windowMs) {
  const now = Date.now();
  await db.prepare(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN rate_limits.reset_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
    reset_at = CASE WHEN rate_limits.reset_at <= ? THEN excluded.reset_at ELSE rate_limits.reset_at END`)
    .bind(key, now + windowMs, now, now).run();
}
function clientIp(request) { return request.headers.get('CF-Connecting-IP') || 'unknown'; }

const rows = async (db, kind) => (await db.prepare('SELECT data FROM records WHERE kind = ? ORDER BY sort_order, id').bind(kind).all()).results.map((row) => JSON.parse(row.data));
async function recordById(db, kind, id) {
  const row = await db.prepare('SELECT sort_order, data FROM records WHERE kind = ? AND id = ?').bind(kind, id).first();
  if (!row) throw bad('Data tidak ditemukan', 404);
  return row;
}
async function saveRecord(db, kind, item, sortOrder) {
  await db.prepare(`INSERT INTO records (kind, id, year, sort_order, data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(kind, id) DO UPDATE SET year = excluded.year, sort_order = excluded.sort_order, data = excluded.data`)
    .bind(kind, item.id, item.year, sortOrder, JSON.stringify(item)).run();
}
async function createRecord(db, kind, item) {
  const row = await db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS last FROM records WHERE kind = ?').bind(kind).first();
  await saveRecord(db, kind, item, row.last + 1);
}
async function deleteRecord(db, kind, id) {
  await recordById(db, kind, id);
  await db.prepare('DELETE FROM records WHERE kind = ? AND id = ?').bind(kind, id).run();
}
function slug(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'berkas';
}
function contentType(ext) {
  return ({ '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' })[ext] || 'application/octet-stream';
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  const ip = clientIp(request);

  if (pathname === '/api/public' && method === 'GET') {
    const [propemperda, ranperda, visitRow] = await Promise.all([
      rows(env.DB, 'propemperda'), rows(env.DB, 'ranperda'),
      env.DB.prepare("SELECT value FROM settings WHERE key = 'visits.total'").first(),
    ]);
    const years = [...new Set([...propemperda, ...ranperda].map((item) => item.year))].sort((a, b) => a - b);
    return json(request, env, 200, { years, propemperda, ranperda, survey: SURVEY, visits: Number(visitRow?.value || 0) });
  }
  if (pathname === '/api/visit' && method === 'POST') {
    const key = `visit:${ip}`;
    if (await blocked(env.DB, key, 60)) throw bad('Terlalu banyak permintaan', 429);
    await strike(env.DB, key, 36e5);
    const day = today();
    const [total] = await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('visits.total', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(settings.value AS INTEGER) + 1 AS TEXT) RETURNING value"),
      env.DB.prepare('INSERT INTO daily_visits (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1').bind(day),
    ]);
    await env.DB.prepare('DELETE FROM daily_visits WHERE day < ?').bind(new Date(Date.now() + 8 * 3600e3 - 120 * 864e5).toISOString().slice(0, 10)).run();
    return json(request, env, 200, { total: Number(total.results?.[0]?.value || 0) });
  }
  if (pathname === '/api/survey' && method === 'POST') {
    const key = `survey:${ip}`;
    if (await blocked(env.DB, key, 5)) throw bad('Terlalu banyak pengiriman. Coba lagi nanti.', 429);
    const entry = cleanSurvey(await readJsonBody(request));
    await env.DB.prepare('INSERT INTO surveys (id, at, data) VALUES (?, ?, ?)').bind(entry.id, entry.at, JSON.stringify(entry)).run();
    await strike(env.DB, key, 36e5);
    return json(request, env, 201, { ok: true });
  }
  if (pathname === '/api/admin/login' && method === 'POST') {
    const key = `login:${ip}`;
    if (await blocked(env.DB, key, 8)) throw bad('Terlalu banyak percobaan masuk. Coba lagi dalam 15 menit.', 429);
    const body = await readJsonBody(request);
    const admin = await ensureAdmin(env);
    const hash = await hashPassword(body.password ?? '', admin.salt, env.PASSWORD_PEPPER);
    if (str(body.username, 100) !== admin.username || hash !== admin.password_hash) {
      await strike(env.DB, key, 15 * 60e3);
      throw bad('Nama pengguna atau kata sandi salah', 401);
    }
    await env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
    const token = await signToken(env, { u: admin.username, v: admin.session_version, exp: Date.now() + SESSION_SECONDS * 1000 });
    return json(request, env, 200, { username: admin.username }, { 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) });
  }
  if (pathname === '/api/admin/logout' && method === 'POST') return json(request, env, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });

  const admin = await authenticate(request, env);
  if (pathname === '/api/admin/me' && method === 'GET') return json(request, env, 200, { username: admin.username });
  if (pathname === '/api/admin/password' && method === 'POST') {
    const body = await readJsonBody(request);
    const currentHash = await hashPassword(body.current ?? '', admin.salt, env.PASSWORD_PEPPER);
    if (currentHash !== admin.password_hash) throw bad('Kata sandi saat ini salah', 403);
    const nextPassword = String(body.next ?? '');
    if (nextPassword.length < 16) throw bad('Kata sandi baru minimal 16 karakter');
    const salt = randomHex(16);
    const nextHash = await hashPassword(nextPassword, salt, env.PASSWORD_PEPPER);
    const version = admin.session_version + 1;
    await env.DB.prepare('UPDATE admin SET salt = ?, password_hash = ?, session_version = ? WHERE id = 1').bind(salt, nextHash, version).run();
    const token = await signToken(env, { u: admin.username, v: version, exp: Date.now() + SESSION_SECONDS * 1000 });
    return json(request, env, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_SECONDS) });
  }
  if (pathname === '/api/admin/data' && method === 'GET') {
    const [propemperda, ranperda] = await Promise.all([rows(env.DB, 'propemperda'), rows(env.DB, 'ranperda')]);
    return json(request, env, 200, { propemperda, ranperda, survey: SURVEY });
  }
  if (pathname === '/api/admin/summary' && method === 'GET') {
    const [visits, todayVisits, surveyCount] = await Promise.all([
      env.DB.prepare("SELECT value FROM settings WHERE key = 'visits.total'").first(),
      env.DB.prepare('SELECT count FROM daily_visits WHERE day = ?').bind(today()).first(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM surveys').first(),
    ]);
    let count = 0, bytes = 0, cursor;
    do {
      const page = await env.UPLOADS.list({ cursor, limit: 1000 });
      for (const object of page.objects) { count += 1; bytes += object.size; }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    return json(request, env, 200, {
      visits: { total: Number(visits?.value || 0), today: Number(todayVisits?.count || 0) },
      surveys: Number(surveyCount?.count || 0), uploads: { count, bytes },
      limits: { maxUploadMB: Number(env.MAX_UPLOAD_MB || 25), extensions: [...UPLOAD_EXT] },
    });
  }
  if (pathname === '/api/admin/backup' && method === 'GET') {
    const [propemperda, ranperda, surveyRows] = await Promise.all([
      rows(env.DB, 'propemperda'), rows(env.DB, 'ranperda'), env.DB.prepare('SELECT data FROM surveys ORDER BY at, id').all(),
    ]);
    const surveys = surveyRows.results.map((row) => JSON.parse(row.data));
    return json(request, env, 200, { exportedAt: new Date().toISOString(), propemperda, ranperda, surveys }, {
      'Content-Disposition': `attachment; filename="sipropemperda-backup-${today()}.json"`,
    });
  }
  if (pathname === '/api/admin/propemperda' && method === 'POST') {
    const item = cleanPropemperda(await readJsonBody(request), newId());
    await createRecord(env.DB, 'propemperda', item);
    return json(request, env, 201, item);
  }
  if (pathname === '/api/admin/ranperda' && method === 'POST') {
    const item = cleanRanperda(await readJsonBody(request), newId());
    await createRecord(env.DB, 'ranperda', item);
    return json(request, env, 201, item);
  }

  const itemMatch = /^\/api\/admin\/(propemperda|ranperda)\/([a-f0-9]+)$/.exec(pathname);
  if (itemMatch && ['PUT', 'DELETE'].includes(method)) {
    const [, kind, id] = itemMatch;
    const current = await recordById(env.DB, kind, id);
    if (method === 'DELETE') {
      await deleteRecord(env.DB, kind, id);
      return json(request, env, 200, { ok: true });
    }
    const item = kind === 'ranperda' ? cleanRanperda(await readJsonBody(request), id) : cleanPropemperda(await readJsonBody(request), id);
    await saveRecord(env.DB, kind, item, current.sort_order);
    return json(request, env, 200, item);
  }
  const moveMatch = /^\/api\/admin\/ranperda\/([a-f0-9]+)\/move$/.exec(pathname);
  if (moveMatch && method === 'POST') {
    const direction = (await readJsonBody(request)).dir === -1 ? -1 : 1;
    const list = await rows(env.DB, 'ranperda');
    const index = list.findIndex((item) => item.id === moveMatch[1]);
    if (index < 0) throw bad('Data tidak ditemukan', 404);
    let target = index + direction;
    while (list[target] && list[target].year !== list[index].year) target += direction;
    if (list[target]) {
      [list[index], list[target]] = [list[target], list[index]];
      await env.DB.batch(list.map((item, sortOrder) => env.DB.prepare('UPDATE records SET sort_order = ? WHERE kind = ? AND id = ?').bind(sortOrder, 'ranperda', item.id)));
    }
    return json(request, env, 200, { ok: true });
  }
  if (pathname === '/api/admin/upload' && method === 'POST') {
    const original = str(url.searchParams.get('name'), 200);
    const ext = original.slice(original.lastIndexOf('.')).toLowerCase();
    if (!UPLOAD_EXT.has(ext)) throw bad(`Jenis berkas "${ext || 'tanpa ekstensi'}" tidak diizinkan. Gunakan: ${[...UPLOAD_EXT].join(', ')}`, 415);
    const bytes = await request.arrayBuffer();
    const maxUpload = Number(env.MAX_UPLOAD_MB || 25) * 1024 * 1024;
    if (bytes.byteLength > maxUpload) throw bad(`Ukuran berkas melebihi batas ${env.MAX_UPLOAD_MB || 25} MB`, 413);
    const name = `${slug(original.slice(0, -ext.length))}-${randomHex(5)}${ext}`;
    await env.UPLOADS.put(name, bytes, { httpMetadata: { contentType: contentType(ext) } });
    return json(request, env, 201, { url: new URL(`/uploads/${name}`, url.origin).href, name: original, size: bytes.byteLength });
  }
  if (pathname === '/api/admin/surveys' && method === 'GET') {
    const result = await env.DB.prepare('SELECT data FROM surveys ORDER BY at DESC, id').all();
    return json(request, env, 200, result.results.map((row) => JSON.parse(row.data)));
  }
  const surveyMatch = /^\/api\/admin\/surveys\/([a-f0-9]+)$/.exec(pathname);
  if (surveyMatch && method === 'DELETE') {
    const result = await env.DB.prepare('DELETE FROM surveys WHERE id = ?').bind(surveyMatch[1]).run();
    if (!result.meta.changes) throw bad('Data tidak ditemukan', 404);
    return json(request, env, 200, { ok: true });
  }
  if (pathname === '/api/admin/surveys.csv' && method === 'GET') {
    const result = await env.DB.prepare('SELECT data FROM surveys ORDER BY at, id').all();
    const surveys = result.results.map((row) => JSON.parse(row.data));
    const head = ['Waktu', 'Nama', ...SURVEY_QUESTIONS.map((question, index) => `${index + 1}. ${question}`), 'Rata-rata', 'Kelebihan', 'Kekurangan', 'Fitur yang perlu ditambahkan', 'Saran'];
    const rowsCsv = surveys.map((survey) => [survey.at, survey.nama, ...survey.q, average(survey.q).toFixed(2), survey.kelebihan, survey.kekurangan, survey.fitur, survey.saran]);
    return csv(request, env, '\ufeff' + [head, ...rowsCsv].map((row) => row.map(csvCell).join(',')).join('\r\n'));
  }
  throw bad('Endpoint tidak ditemukan', 404);
}

async function serveUpload(request, env, url) {
  const name = decodeURIComponent(url.pathname.slice('/uploads/'.length));
  if (!/^[\w][\w.-]*$/.test(name)) throw bad('Berkas tidak ditemukan', 404);
  const object = await env.UPLOADS.get(name);
  if (!object) throw bad('Berkas tidak ditemukan', 404);
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const inline = ['.pdf', '.png', '.jpg', '.jpeg'].includes(ext);
  return response(request, env, request.method === 'HEAD' ? null : object.body, 200, {
    'Content-Type': object.httpMetadata?.contentType || contentType(ext),
    'Content-Length': String(object.size),
    'Cache-Control': 'public, max-age=86400',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`,
    'X-Content-Type-Options': 'nosniff',
  });
}

async function collectUnusedUploads(env) {
  const [propemperda, ranperda] = await Promise.all([rows(env.DB, 'propemperda'), rows(env.DB, 'ranperda')]);
  const serialized = JSON.stringify({ propemperda, ranperda });
  const used = new Set([...serialized.matchAll(/\/uploads\/([\w.-]+)/g)].map((match) => match[1]));
  const cutoff = Date.now() - 864e5;
  const unused = [];
  let cursor;
  do {
    const page = await env.UPLOADS.list({ cursor, limit: 1000 });
    for (const object of page.objects) {
      if (!used.has(object.key) && object.uploaded.getTime() < cutoff) unused.push(object.key);
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  if (unused.length) await env.UPLOADS.delete(unused);
}

export default {
  async scheduled(_controller, env, context) {
    context.waitUntil(collectUnusedUploads(env));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigins(env).includes(origin)) {
      return json(request, env, 403, { error: 'Asal permintaan ditolak' });
    }
    if (request.method === 'OPTIONS') return response(request, env, null, origin ? 204 : 403);
    if (url.pathname.startsWith('/uploads/')) {
      if (!['GET', 'HEAD'].includes(request.method)) return json(request, env, 405, { error: 'Metode tidak diizinkan' });
      try { return await serveUpload(request, env, url); }
      catch (error) { return json(request, env, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'Terjadi kesalahan pada server' }); }
    }
    if (!url.pathname.startsWith('/api/')) return json(request, env, 404, { error: 'Endpoint tidak ditemukan' });
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) return json(request, env, 405, { error: 'Metode tidak diizinkan' });
    try { return await handleApi(request, env, url); }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      return json(request, env, status, { error: status === 500 ? 'Terjadi kesalahan pada server' : error.message }, status === 413 ? { Connection: 'close' } : {});
    }
  },
};
