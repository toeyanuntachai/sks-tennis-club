import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const origin = new URL(process.env.SKS_ORIGIN || 'http://127.0.0.1:4317').origin;
const originUrl = new URL(origin);
if (originUrl.protocol !== 'https:' && !(originUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(originUrl.hostname))) {
  throw new Error('SKS_ORIGIN must use HTTPS except on localhost.');
}
const channelId = process.env.LINE_LOGIN_CHANNEL_ID || '';
const liffId = process.env.LINE_LIFF_ID || '';
const inviteCode = process.env.SKS_INVITE_CODE || '';
const ready = Boolean(channelId && liffId && inviteCode.length >= 24);
const databasePath = process.env.SKS_DATABASE_PATH || resolve(root, 'data/sks.sqlite');
if (databasePath !== ':memory:') mkdirSync(dirname(resolve(databasePath)), { recursive: true });
// ponytail: synchronous SQLite suits this one small group; move to a shared database before running multiple app servers.
const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    line_id TEXT NOT NULL UNIQUE,
    nickname TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    member_id TEXT NOT NULL REFERENCES members(id),
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    organizer_id TEXT NOT NULL REFERENCES members(id),
    title TEXT NOT NULL,
    venue TEXT NOT NULL,
    date TEXT NOT NULL,
    start TEXT NOT NULL,
    end TEXT NOT NULL,
    courts INTEGER NOT NULL CHECK(courts > 0),
    court_names TEXT NOT NULL,
    capacity INTEGER NOT NULL CHECK(capacity > 0),
    cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS registrations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL REFERENCES events(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    UNIQUE(event_id, member_id)
  );
  CREATE INDEX IF NOT EXISTS registrations_event ON registrations(event_id, sequence);
`);

const digest = value => createHash('sha256').update(value).digest('hex');
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function atomic(work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function cookie(token, expiry = 604800) {
  return 'sks_session=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + expiry + (originUrl.protocol === 'https:' ? '; Secure' : '');
}
function currentMember(req) {
  const token = req.headers.cookie?.match(/(?:^|;\s*)sks_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
  if (!token) return null;
  return db.prepare(`SELECT m.id, m.nickname FROM sessions s JOIN members m ON m.id = s.member_id
    WHERE s.token_hash = ? AND s.expires > ?`).get(digest(token), Date.now()) || null;
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'กรุณาส่งข้อมูลแบบ JSON');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 16384) fail(413, 'ข้อมูลยาวเกินไป');
    chunks.push(Buffer.from(chunk));
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object') fail(400, 'ข้อมูลไม่ถูกต้อง');
    return value;
  } catch (error) {
    if (error.status) throw error;
    fail(400, 'ข้อมูลไม่ถูกต้อง');
  }
}
function text(value, label, max) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(400, label + 'ไม่ถูกต้อง');
  return value.trim();
}
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10000) fail(400, label + 'ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 10000');
  return value;
}
function eventFields(data) {
  const date = text(data.date, 'วันที่', 10);
  const parsed = new Date(date + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail(400, 'วันที่ไม่ถูกต้อง');
  const start = text(data.start, 'เวลาเริ่ม', 5), end = text(data.end, 'เวลาสิ้นสุด', 5);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) fail(400, 'เวลาสิ้นสุดต้องหลังเวลาเริ่มภายในวันเดียว');
  return {
    title: text(data.title, 'ชื่อนัด', 80), venue: text(data.venue, 'สนาม', 120),
    date, start, end, courts: integer(data.courts, 'จำนวนคอร์ต'),
    courtNames: text(data.courtNames, 'รายละเอียดคอร์ต', 100), capacity: integer(data.capacity, 'จำนวนคนที่รับ')
  };
}
function eventRow(id) {
  const event = db.prepare(`SELECT e.*, m.nickname AS organizer_name,
    (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS total
    FROM events e JOIN members m ON m.id = e.organizer_id WHERE e.id = ?`).get(id);
  if (!event) fail(404, 'ไม่พบนัดนี้');
  return event;
}
function eventView(row, member) {
  const registration = db.prepare(`SELECT COUNT(*) AS position FROM registrations
    WHERE event_id = ? AND sequence <= (SELECT sequence FROM registrations WHERE event_id = ? AND member_id = ?)`).get(row.id, row.id, member.id);
  return {
    id: row.id, title: row.title, venue: row.venue, date: row.date, start: row.start, end: row.end,
    courts: row.courts, courtNames: row.court_names, capacity: row.capacity, cancelled: Boolean(row.cancelled),
    organizerId: row.organizer_id, organizerName: row.organizer_name,
    confirmed: Math.min(row.total, row.capacity), waiting: Math.max(0, row.total - row.capacity),
    myPosition: registration.position || null, isOrganizer: row.organizer_id === member.id
  };
}
function detail(id, member) {
  const event = eventView(eventRow(id), member);
  const rows = db.prepare(`SELECT m.id, m.nickname FROM registrations r
    JOIN members m ON m.id = r.member_id WHERE r.event_id = ? ORDER BY r.sequence`).all(id);
  return {
    ...event,
    participants: rows.slice(0, event.capacity),
    waitlist: rows.slice(event.capacity)
  };
}
const loginAttempts = new Map();
function limitLogin(req) {
  const now = Date.now(), key = req.socket?.remoteAddress || 'unknown';
  for (const [ip, entry] of loginAttempts) if (entry.until < now) loginAttempts.delete(ip);
  const entry = loginAttempts.get(key) || { count: 0, until: now + 60000 };
  if (entry.count >= 20 || (loginAttempts.size >= 1000 && !loginAttempts.has(key))) fail(429, 'กรุณารอสักครู่แล้วลองเข้าใช้งานใหม่');
  entry.count++;
  loginAttempts.set(key, entry);
}
async function authenticate(req, res) {
  if (!ready) fail(503, 'เว็บยังไม่เปิดรับสมาชิก กรุณาติดต่อผู้จัดกลุ่ม');
  limitLogin(req);
  const data = await body(req);
  const idToken = text(data.idToken, 'ข้อมูลเข้าใช้งาน LINE', 12000);
  let response;
  try {
    response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }), signal: AbortSignal.timeout(8000)
    });
  } catch { fail(502, 'ติดต่อ LINE ไม่ได้ กรุณาลองใหม่'); }
  if (!response.ok) fail(401, 'การเข้าใช้งาน LINE หมดอายุหรือไม่ถูกต้อง');
  let identity;
  try { identity = await response.json(); } catch { fail(502, 'LINE ส่งข้อมูลไม่ครบ กรุณาลองใหม่'); }
  if (identity.iss !== 'https://access.line.me' || String(identity.aud) !== channelId || typeof identity.sub !== 'string' || !identity.sub || identity.sub.length > 256 || !Number.isFinite(identity.exp) || identity.exp * 1000 <= Date.now()) fail(401, 'ยืนยันบัญชี LINE ไม่สำเร็จ');
  const member = atomic(() => {
    let found = db.prepare('SELECT id, nickname FROM members WHERE line_id = ?').get(identity.sub);
    if (!found) {
      if (typeof data.invite !== 'string' || !timingSafeEqual(Buffer.from(digest(data.invite)), Buffer.from(digest(inviteCode)))) fail(403, 'กรุณาเข้าร่วมผ่านลิงก์เชิญจากกลุ่ม');
      found = { id: randomUUID(), nickname: null };
      db.prepare('INSERT INTO members(id, line_id) VALUES (?, ?)').run(found.id, identity.sub);
    }
    return found;
  });
  const token = randomBytes(32).toString('base64url');
  atomic(() => {
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    const old = req.headers.cookie?.match(/(?:^|;\s*)sks_session=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
    if (old) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(old));
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), member.id, Date.now() + 604800000);
  });
  res.setHeader('Set-Cookie', cookie(token));
  send(res, 200, { member, suggestedNickname: typeof identity.name === 'string' ? identity.name.slice(0, 40) : '' });
}

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/sks-logo.png': ['sks-logo.png', 'image/png']
};
export async function handleRequest(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://static.line-scdn.net; style-src 'self'; img-src 'self' data:; connect-src 'self' https://*.line.me https://*.line-scdn.net; frame-src https://*.line.me; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (req.method === 'GET' && staticFiles[path]) {
      const [file, type] = staticFiles[path];
      let content;
      try { content = readFileSync(resolve(root, 'public', file)); }
      catch { fail(503, 'กรุณาสร้างไฟล์เว็บด้วย npm run build ก่อนเปิดใช้งาน'); }
      res.writeHead(200, { 'Content-Type': type });
      res.end(content);
      return;
    }
    if (!path.startsWith('/api/')) fail(404, 'ไม่พบหน้านี้');
    if (req.method !== 'GET' && req.headers.origin !== origin) fail(403, 'ไม่อนุญาตคำขอจากเว็บอื่น');
    if (req.method === 'GET' && path === '/api/config') return send(res, 200, { liffId, ready });
    if (req.method === 'POST' && path === '/api/auth') return await authenticate(req, res);
    const member = currentMember(req);
    if (!member) fail(401, 'กรุณาเข้าใช้งานผ่าน LINE');
    if (req.method === 'POST' && path === '/api/logout') {
      await body(req);
      const token = req.headers.cookie.match(/sks_session=([A-Za-z0-9_-]{43})/)[1];
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token));
      res.setHeader('Set-Cookie', cookie('', 0));
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && path === '/api/me') return send(res, 200, { member });
    if (req.method === 'PATCH' && path === '/api/me') {
      const nickname = text((await body(req)).nickname, 'ชื่อเล่น', 40);
      db.prepare('UPDATE members SET nickname = ? WHERE id = ?').run(nickname, member.id);
      return send(res, 200, { member: { ...member, nickname } });
    }
    if (!member.nickname) fail(409, 'กรุณาตั้งชื่อเล่นก่อน');
    if (req.method === 'GET' && path === '/api/invite') {
      const url = new URL('https://liff.line.me/' + encodeURIComponent(liffId) + '/');
      url.searchParams.set('invite', inviteCode);
      return send(res, 200, { url: url.href });
    }
    if (req.method === 'GET' && path === '/api/events') {
      const rows = db.prepare(`SELECT e.*, m.nickname AS organizer_name, COUNT(r.sequence) AS total
        FROM events e JOIN members m ON m.id = e.organizer_id
        LEFT JOIN registrations r ON r.event_id = e.id
        GROUP BY e.id ORDER BY e.date, e.start, e.id`).all();
      return send(res, 200, { events: rows.map(row => eventView(row, member)) });
    }
    if (req.method === 'POST' && path === '/api/events') {
      const fields = eventFields(await body(req)), id = randomUUID();
      db.prepare(`INSERT INTO events(id, organizer_id, title, venue, date, start, end, courts, court_names, capacity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, member.id, fields.title, fields.venue, fields.date, fields.start, fields.end, fields.courts, fields.courtNames, fields.capacity);
      return send(res, 201, { event: detail(id, member) });
    }
    const match = path.match(/^\/api\/events\/([^/]+)(?:\/(signup|cancel))?$/);
    if (!match) fail(404, 'ไม่พบข้อมูลนี้');
    const [, id, action] = match;
    if (req.method === 'GET' && !action) return send(res, 200, { event: detail(id, member) });
    if (req.method === 'PATCH' && !action) {
      const fields = eventFields(await body(req));
      atomic(() => {
        const event = eventRow(id);
        if (event.organizer_id !== member.id) fail(403, 'เฉพาะผู้สร้างนัดเท่านั้นที่แก้ไขได้');
        if (event.cancelled) fail(409, 'นัดนี้ยกเลิกแล้ว');
        if (fields.capacity < Math.min(event.total, event.capacity)) fail(409, 'จำนวนที่รับต้องไม่น้อยกว่าคนที่ได้ที่แล้ว');
        db.prepare('UPDATE events SET title=?, venue=?, date=?, start=?, end=?, courts=?, court_names=?, capacity=? WHERE id=?')
          .run(fields.title, fields.venue, fields.date, fields.start, fields.end, fields.courts, fields.courtNames, fields.capacity, id);
      });
      return send(res, 200, { event: detail(id, member) });
    }
    if (req.method === 'POST' && action === 'cancel') {
      await body(req);
      atomic(() => {
        if (eventRow(id).organizer_id !== member.id) fail(403, 'เฉพาะผู้สร้างนัดเท่านั้นที่ยกเลิกได้');
        db.prepare('UPDATE events SET cancelled = 1 WHERE id = ?').run(id);
      });
      return send(res, 200, { event: detail(id, member) });
    }
    if ((req.method === 'POST' || req.method === 'DELETE') && action === 'signup') {
      await body(req);
      atomic(() => {
        if (eventRow(id).cancelled) fail(409, 'นัดนี้ยกเลิกแล้ว');
        if (req.method === 'POST') db.prepare('INSERT INTO registrations(event_id, member_id) VALUES (?, ?) ON CONFLICT(event_id, member_id) DO NOTHING').run(id, member.id);
        else db.prepare('DELETE FROM registrations WHERE event_id = ? AND member_id = ?').run(id, member.id);
      });
      return send(res, 200, { event: detail(id, member) });
    }
    fail(404, 'ไม่พบข้อมูลนี้');
  } catch (error) {
    if (!error.status) console.error('SKS request failed:', error.message);
    send(res, error.status || 500, { message: error.status ? error.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่' });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.SKS_PORT || process.env.PORT || 4317);
  const address = process.env.SKS_BIND_ADDRESS || (process.env.PORT ? '0.0.0.0' : '127.0.0.1');
  createServer(handleRequest).listen(port, address, () => {
    console.log('SKS Tennis Club is running at ' + origin);
    if (!ready) console.log('LINE settings are incomplete. See .env.example and README.md.');
  });
}
