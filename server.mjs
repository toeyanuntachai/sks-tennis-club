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
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
const memberColumns = db.prepare('PRAGMA table_info(members)').all();
if (memberColumns.some(column => column.name === 'line_id' && column.notnull)) {
  // VACUUM includes committed WAL data in a consistent backup before changing the schema.
  if (databasePath !== ':memory:') {
    const backup = resolve(databasePath) + '.before-guests-' + Date.now() + '-' + randomUUID() + '.sqlite';
    db.prepare('VACUUM INTO ?').run(backup);
    console.log('SQLite backup created before guest migration: ' + backup);
  }
  db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
  try {
    const counts = ['members', 'sessions', 'events', 'registrations', 'event_payments']
      .filter(table => db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get('table', table))
      .map(table => [table, db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n]);
    db.exec(`CREATE TABLE members_new (
      id TEXT PRIMARY KEY, line_id TEXT UNIQUE, nickname TEXT,
      guest_event_id TEXT REFERENCES events(id)
    );
    INSERT INTO members_new(id, line_id, nickname) SELECT id, line_id, nickname FROM members;
    DROP TABLE members;
    ALTER TABLE members_new RENAME TO members;`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Guest migration failed foreign key check');
    for (const [table, count] of counts) {
      if (db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n !== count) throw new Error('Guest migration changed row count: ' + table);
    }
    db.exec('COMMIT');
    console.log('Guest member migration completed; foreign keys valid; preserved rows: ' + JSON.stringify(Object.fromEntries(counts)));
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys = ON'); }
}
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    line_id TEXT UNIQUE,
    nickname TEXT,
    guest_event_id TEXT REFERENCES events(id)
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
    cancelled INTEGER NOT NULL DEFAULT 0 CHECK(cancelled IN (0, 1)),
    court_cost_satang INTEGER CHECK(court_cost_satang >= 0),
    ball_cost_satang INTEGER CHECK(ball_cost_satang >= 0)
  );
  CREATE TABLE IF NOT EXISTS registrations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL REFERENCES events(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    UNIQUE(event_id, member_id)
  );
  CREATE INDEX IF NOT EXISTS registrations_event ON registrations(event_id, sequence);
  CREATE TABLE IF NOT EXISTS event_payments (
    event_id TEXT NOT NULL REFERENCES events(id),
    member_id TEXT NOT NULL REFERENCES members(id),
    paid INTEGER NOT NULL CHECK(paid IN (0, 1)),
    PRIMARY KEY(event_id, member_id)
  );
`);

const paymentQrSchema = `CREATE TABLE IF NOT EXISTS event_payment_qr (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  image BLOB NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png', 'image/jpeg'))
);`;
const costColumns = db.prepare('PRAGMA table_info(events)').all();
if (!costColumns.some(column => column.name === 'court_cost_satang')) {
  if (databasePath !== ':memory:') {
    const backup = resolve(databasePath) + '.before-costs-' + Date.now() + '-' + randomUUID() + '.sqlite';
    db.prepare('VACUUM INTO ?').run(backup);
    console.log('SQLite backup created before cost migration: ' + backup);
  }
  atomic(() => {
    const tables = ['members', 'sessions', 'events', 'registrations', 'event_payments'];
    const counts = tables.map(table => [table, db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n]);
    db.exec(`ALTER TABLE events ADD COLUMN court_cost_satang INTEGER CHECK(court_cost_satang >= 0);
      ALTER TABLE events ADD COLUMN ball_cost_satang INTEGER CHECK(ball_cost_satang >= 0);`);
    db.exec(paymentQrSchema);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Cost migration failed foreign key check');
    for (const [table, count] of counts) {
      if (db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n !== count) throw new Error('Cost migration changed row count: ' + table);
    }
    console.log('Cost migration validated; preserved rows: ' + JSON.stringify(Object.fromEntries(counts)));
  });
  console.log('Cost migration completed.');
}
db.exec(paymentQrSchema);

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
    WHERE s.token_hash = ? AND s.expires > ? AND m.line_id IS NOT NULL`).get(digest(token), Date.now()) || null;
}
async function body(req, limit = 16384) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'กรุณาส่งข้อมูลแบบ JSON');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > limit) fail(413, 'ข้อมูลยาวเกินไป');
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
function paymentFields(data, previous = {}) {
  const cost = (key, column) => {
    const value = Object.hasOwn(data, key) ? data[key] : previous[column] ?? null;
    if (value !== null && (!Number.isSafeInteger(value) || value < 0)) fail(400, 'ค่าใช้จ่ายต้องเป็นจำนวนเต็มหน่วยสตางค์และไม่ติดลบ');
    return value;
  };
  const courtCostSatang = cost('courtCostSatang', 'court_cost_satang'), ballCostSatang = cost('ballCostSatang', 'ball_cost_satang');
  // Leave room for rounding up at the maximum event size without losing integer precision.
  if ((courtCostSatang ?? 0) + (ballCostSatang ?? 0) > Number.MAX_SAFE_INTEGER - 1000000) fail(400, 'ค่าใช้จ่ายสูงเกินไป');
  let qr = undefined;
  if (Object.hasOwn(data, 'paymentQr')) {
    if (data.paymentQr === null) qr = null;
    else {
      if (typeof data.paymentQr !== 'string') fail(400, 'ข้อมูลรูป QR ไม่ถูกต้อง');
      if (data.paymentQr.length > 2796204) fail(413, 'รูป QR ต้องไม่เกิน 2 MB');
      const image = Buffer.from(data.paymentQr, 'base64');
      if (image.length > 2 * 1024 * 1024) fail(413, 'รูป QR ต้องไม่เกิน 2 MB');
      if (image.toString('base64') !== data.paymentQr) fail(400, 'ข้อมูลรูป QR ไม่ถูกต้อง');
      const png = image.length >= 45 && image.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
        && image.readUInt32BE(8) === 13 && image.subarray(12, 16).toString() === 'IHDR'
        && image.readUInt32BE(16) > 0 && image.readUInt32BE(20) > 0
        && image.subarray(-12).toString('hex') === '0000000049454e44ae426082';
      const jpeg = image.length >= 4 && image.subarray(0, 3).toString('hex') === 'ffd8ff' && image.subarray(-2).toString('hex') === 'ffd9';
      if (!png && !jpeg) fail(400, 'รูป QR ต้องเป็นไฟล์ PNG หรือ JPEG');
      qr = { image, mimeType: png ? 'image/png' : 'image/jpeg' };
    }
  }
  return { courtCostSatang, ballCostSatang, qr };
}
function savePaymentQr(id, qr) {
  if (qr === null) db.prepare('DELETE FROM event_payment_qr WHERE event_id = ?').run(id);
  else if (qr !== undefined) db.prepare(`INSERT INTO event_payment_qr VALUES (?, ?, ?)
    ON CONFLICT(event_id) DO UPDATE SET image = excluded.image, mime_type = excluded.mime_type`).run(id, qr.image, qr.mimeType);
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
  const row = eventRow(id), event = eventView(row, member);
  const courtCostSatang = row.court_cost_satang, ballCostSatang = row.ball_cost_satang;
  const totalCostSatang = courtCostSatang === null && ballCostSatang === null ? null : (courtCostSatang ?? 0) + (ballCostSatang ?? 0);
  const divisor = BigInt(event.confirmed) * 100n;
  const sharePerPersonSatang = totalCostSatang !== null && event.confirmed ? Number((BigInt(totalCostSatang) + divisor - 1n) / divisor) * 100 : null;
  const rows = db.prepare(`SELECT m.id, m.nickname, m.line_id IS NULL AS isGuest, COALESCE(p.paid, 0) AS paid FROM registrations r
    JOIN members m ON m.id = r.member_id
    LEFT JOIN event_payments p ON p.event_id = r.event_id AND p.member_id = r.member_id
    WHERE r.event_id = ? ORDER BY r.sequence`).all(id).map(p => ({ ...p, isGuest: Boolean(p.isGuest), paid: Boolean(p.paid) }));
  const withdrawn = db.prepare(`SELECT m.id, m.nickname, m.line_id IS NULL AS isGuest, p.paid FROM event_payments p
    JOIN members m ON m.id = p.member_id
    WHERE p.event_id = ? AND NOT EXISTS (
      SELECT 1 FROM registrations r WHERE r.event_id = p.event_id AND r.member_id = p.member_id
    ) ORDER BY m.nickname, m.id`).all(id).map(p => ({ ...p, isGuest: Boolean(p.isGuest), paid: Boolean(p.paid) }));
  return {
    ...event,
    courtCostSatang, ballCostSatang, totalCostSatang, sharePeople: event.confirmed, sharePerPersonSatang,
    roundingSurplusSatang: sharePerPersonSatang === null ? null : sharePerPersonSatang * event.confirmed - totalCostSatang,
    hasPaymentQr: Boolean(db.prepare('SELECT 1 FROM event_payment_qr WHERE event_id = ?').get(id)),
    participants: rows.slice(0, event.capacity),
    waitlist: rows.slice(event.capacity),
    withdrawn
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
      const data = await body(req, 3 * 1024 * 1024), fields = eventFields(data), payment = paymentFields(data), id = randomUUID();
      atomic(() => {
        db.prepare(`INSERT INTO events(id, organizer_id, title, venue, date, start, end, courts, court_names, capacity, court_cost_satang, ball_cost_satang)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, member.id, fields.title, fields.venue, fields.date, fields.start, fields.end, fields.courts, fields.courtNames, fields.capacity, payment.courtCostSatang, payment.ballCostSatang);
        savePaymentQr(id, payment.qr);
      });
      return send(res, 201, { event: detail(id, member) });
    }
    const match = path.match(/^\/api\/events\/([^/]+)(?:\/(signup|cancel|payment|payment-qr|available-members|participants)(?:\/([^/]+))?)?$/);
    if (!match) fail(404, 'ไม่พบข้อมูลนี้');
    const [, id, action, participantId] = match;
    if (participantId && action !== 'participants') fail(404, 'ไม่พบข้อมูลนี้');
    if (req.method === 'GET' && !action) return send(res, 200, { event: detail(id, member) });
    if (req.method === 'GET' && action === 'payment-qr') {
      eventRow(id);
      const qr = db.prepare('SELECT image, mime_type FROM event_payment_qr WHERE event_id = ?').get(id);
      if (!qr) fail(404, 'นัดนี้ยังไม่มีรูป QR จ่ายเงิน');
      res.writeHead(200, { 'Content-Type': qr.mime_type });
      res.end(Buffer.from(qr.image));
      return;
    }
    if (action === 'available-members' || action === 'participants') {
      // Check authority again inside the write transaction before touching any roster data.
      const organizerEvent = () => {
        const event = eventRow(id);
        if (event.organizer_id !== member.id) fail(403, 'เฉพาะผู้สร้างนัดเท่านั้นที่จัดการรายชื่อคนอื่นได้');
        if (event.cancelled) fail(409, 'นัดนี้ยกเลิกแล้ว');
      };
      if (req.method === 'GET' && action === 'available-members') {
        organizerEvent();
        return send(res, 200, { members: db.prepare('SELECT id, nickname FROM members WHERE line_id IS NOT NULL AND nickname IS NOT NULL ORDER BY nickname, id').all() });
      }
      const data = await body(req);
      atomic(() => {
        organizerEvent();
        if (req.method === 'POST' && !participantId && action === 'participants') {
          if (Object.hasOwn(data, 'memberId') === Object.hasOwn(data, 'nickname')) fail(400, 'เลือกสมาชิกหรือพิมพ์ชื่ออย่างใดอย่างหนึ่ง');
          let memberId;
          if (Object.hasOwn(data, 'nickname')) {
            const nickname = text(data.nickname, 'ชื่อเล่น', 40);
            memberId = randomUUID();
            db.prepare('INSERT INTO members(id, nickname, guest_event_id) VALUES (?, ?, ?)').run(memberId, nickname, id);
          } else {
            memberId = text(data.memberId, 'สมาชิก', 64);
            const target = db.prepare('SELECT line_id, nickname, guest_event_id FROM members WHERE id = ?').get(memberId);
            if (!target?.nickname || (target.line_id === null && target.guest_event_id !== id)) fail(404, 'ไม่พบสมาชิกที่เพิ่มในนัดนี้ได้');
          }
          db.prepare('INSERT INTO registrations(event_id, member_id) VALUES (?, ?) ON CONFLICT(event_id, member_id) DO NOTHING').run(id, memberId);
          db.prepare('INSERT INTO event_payments VALUES (?, ?, 0) ON CONFLICT(event_id, member_id) DO NOTHING').run(id, memberId);
        } else if (participantId && action === 'participants' && ['DELETE', 'PATCH'].includes(req.method)) {
          const target = db.prepare(`SELECT m.* FROM members m WHERE m.id = ? AND (
            EXISTS(SELECT 1 FROM registrations WHERE event_id = ? AND member_id = m.id)
            OR EXISTS(SELECT 1 FROM event_payments WHERE event_id = ? AND member_id = m.id))`).get(participantId, id, id);
          if (!target) fail(404, 'ไม่พบสมาชิกในรายชื่อนัดนี้');
          if (req.method === 'DELETE') {
            db.prepare('INSERT INTO event_payments VALUES (?, ?, 0) ON CONFLICT(event_id, member_id) DO NOTHING').run(id, participantId);
            db.prepare('DELETE FROM registrations WHERE event_id = ? AND member_id = ?').run(id, participantId);
          } else {
            if (target.line_id !== null || target.guest_event_id !== id) fail(409, 'แก้ชื่อหรือผูกบัญชีได้เฉพาะชื่อที่ผู้จัดเพิ่ม');
            if (Object.hasOwn(data, 'memberId') === Object.hasOwn(data, 'nickname')) fail(400, 'แก้ชื่อหรือผูกบัญชีอย่างใดอย่างหนึ่ง');
            if (Object.hasOwn(data, 'nickname')) {
              db.prepare('UPDATE members SET nickname = ? WHERE id = ?').run(text(data.nickname, 'ชื่อเล่น', 40), participantId);
            } else {
              const memberId = text(data.memberId, 'สมาชิก', 64);
              if (!db.prepare('SELECT 1 FROM members WHERE id = ? AND line_id IS NOT NULL AND nickname IS NOT NULL').get(memberId)) fail(404, 'ไม่พบบัญชีสมาชิกที่เลือก');
              const registrations = db.prepare('SELECT sequence, member_id FROM registrations WHERE event_id = ? AND member_id IN (?, ?) ORDER BY sequence').all(id, participantId, memberId);
              if (registrations.length === 2) db.prepare('DELETE FROM registrations WHERE sequence = ?').run(registrations[1].sequence);
              if (registrations[0]) db.prepare('UPDATE registrations SET member_id = ? WHERE sequence = ?').run(memberId, registrations[0].sequence);
              const payments = db.prepare('SELECT paid FROM event_payments WHERE event_id = ? AND member_id IN (?, ?)').all(id, participantId, memberId);
              db.prepare('DELETE FROM event_payments WHERE event_id = ? AND member_id = ?').run(id, participantId);
              db.prepare(`INSERT INTO event_payments VALUES (?, ?, ?)
                ON CONFLICT(event_id, member_id) DO UPDATE SET paid = excluded.paid`).run(id, memberId, Number(payments.some(p => p.paid)));
              db.prepare('DELETE FROM members WHERE id = ? AND line_id IS NULL AND guest_event_id = ?').run(participantId, id);
            }
          }
        } else fail(404, 'ไม่พบข้อมูลนี้');
      });
      return send(res, 200, { event: detail(id, member) });
    }
    if (req.method === 'PATCH' && action === 'payment') {
      const data = await body(req);
      const memberId = text(data.memberId, 'สมาชิก', 64);
      if (typeof data.paid !== 'boolean') fail(400, 'สถานะจ่ายเงินไม่ถูกต้อง');
      atomic(() => {
        const event = eventRow(id);
        if (event.organizer_id !== member.id) fail(403, 'เฉพาะผู้สร้างนัดเท่านั้นที่เปลี่ยนสถานะจ่ายเงินได้');
        if (event.cancelled) fail(409, 'นัดนี้ยกเลิกแล้ว');
        const registered = db.prepare('SELECT 1 FROM registrations WHERE event_id = ? AND member_id = ?').get(id, memberId);
        const payment = db.prepare('SELECT 1 FROM event_payments WHERE event_id = ? AND member_id = ?').get(id, memberId);
        if (!registered && !payment) fail(404, 'ไม่พบสมาชิกในรายชื่อนัดนี้');
        db.prepare(`INSERT INTO event_payments(event_id, member_id, paid) VALUES (?, ?, ?)
          ON CONFLICT(event_id, member_id) DO UPDATE SET paid = excluded.paid`).run(id, memberId, Number(data.paid));
      });
      return send(res, 200, { event: detail(id, member) });
    }
    if (req.method === 'PATCH' && !action) {
      const current = eventRow(id);
      if (current.organizer_id !== member.id) fail(403, 'เฉพาะผู้สร้างนัดเท่านั้นที่แก้ไขได้');
      if (current.cancelled) fail(409, 'นัดนี้ยกเลิกแล้ว');
      const data = await body(req, 3 * 1024 * 1024), fields = eventFields(data);
      atomic(() => {
        const event = eventRow(id);
        if (event.organizer_id !== member.id) fail(403, 'เฉพาะผู้สร้างนัดเท่านั้นที่แก้ไขได้');
        if (event.cancelled) fail(409, 'นัดนี้ยกเลิกแล้ว');
        if (fields.capacity < Math.min(event.total, event.capacity)) fail(409, 'จำนวนที่รับต้องไม่น้อยกว่าคนที่ได้ที่แล้ว');
        const payment = paymentFields(data, event);
        db.prepare('UPDATE events SET title=?, venue=?, date=?, start=?, end=?, courts=?, court_names=?, capacity=?, court_cost_satang=?, ball_cost_satang=? WHERE id=?')
          .run(fields.title, fields.venue, fields.date, fields.start, fields.end, fields.courts, fields.courtNames, fields.capacity, payment.courtCostSatang, payment.ballCostSatang, id);
        savePaymentQr(id, payment.qr);
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
