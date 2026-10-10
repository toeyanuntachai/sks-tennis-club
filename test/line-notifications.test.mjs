import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { lineNotifications } from '../line-notifications.mjs';

const settings = { token: 'test-only-token', groupId: 'C' + 'a'.repeat(32), liffId: '123-test', inviteCode: 'test-invite-' + 'a'.repeat(24) };
const event = {
  id: 'event', title: 'นัดเย็น', date: '2026-10-09', start: '18:00', end: '21:00',
  venue: 'สนามสวน', courts: 1, courtNames: '4', organizerName: 'ต้น',
  confirmed: 2, capacity: 2, waiting: 0, participants: [{ nickname: 'ต้น' }, { nickname: 'เมย์' }]
};
function setup(t, options = settings) {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE events(id TEXT PRIMARY KEY); INSERT INTO events VALUES ('event');");
  t.after(() => db.close());
  t.mock.method(console, 'error', () => {});
  return { db, notifications: lineNotifications(db, options) };
}

test('notifications are opt-in and use only an explicitly configured group', async t => {
  const { db, notifications } = setup(t, { ...settings, groupId: '' });
  t.mock.method(globalThis, 'fetch', () => { assert.fail('must not send'); });
  notifications.enqueue(event, 'created');
  await notifications.flush();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM line_notifications').get().n, 0);
  assert.throws(() => lineNotifications(db, { ...settings, groupId: 'U' + 'a'.repeat(32) }), /group ID/);
});

test('creation is deduplicated while each full transition gets a new notification, even after reinitializing', async t => {
  const { db, notifications } = setup(t);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.line.me/v2/bot/message/push');
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    assert.match(options.headers['X-Line-Retry-Key'], /^[0-9a-f-]{36}$/);
    calls.push(JSON.parse(options.body));
    return Response.json({});
  });
  notifications.enqueue(event, 'created');
  notifications.enqueue(event, 'created');
  notifications.enqueue(event, 'full');
  await Promise.all([notifications.flush(), notifications.flush()]);
  const restarted = lineNotifications(db, settings);
  restarted.enqueue(event, 'full');
  await restarted.flush();
  assert.equal(calls.length, 3);
  assert.equal(calls[0].to, settings.groupId);
  assert.equal(calls[0].notificationDisabled, false);
  assert.equal(calls[0].messages[0].altText, 'เปิดนัดใหม่: นัดเย็น');
  const message = calls[1].messages[0];
  assert.equal(message.altText, 'คนเต็มแล้ว: นัดเย็น');
  assert.equal(message.contents.styles.body.backgroundColor, '#FFFDF8');
  assert.equal(message.contents.footer.contents[0].color, '#1D3C51');
  assert.match(JSON.stringify(message), /1\. ต้น\\n2\. เมย์/);
  const link = new URL(message.contents.footer.contents[0].action.uri);
  assert.equal(link.searchParams.get('event'), event.id);
  assert.equal(link.searchParams.get('invite'), settings.inviteCode);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM line_notifications WHERE status='sent'").get().n, 3);
  const fullKeys = db.prepare("SELECT retry_key FROM line_notifications WHERE kind='full'").all();
  assert.notEqual(fullKeys[0].retry_key, fullKeys[1].retry_key);
});

test('legacy queues preserve every payload, retry key and delivery state when allowing full notifications again', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`CREATE TABLE events(id TEXT PRIMARY KEY);
    INSERT INTO events VALUES ('event'), ('second');
    CREATE TABLE line_notifications (
      event_id TEXT NOT NULL REFERENCES events(id), kind TEXT NOT NULL CHECK(kind IN ('created', 'full')),
      retry_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
      first_attempt_at INTEGER, next_attempt_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(event_id, kind)
    );`);
  const insert = db.prepare('INSERT INTO line_notifications VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  insert.run('event', 'created', 'created-key', '{"sent":true}', 'sent', 100, 0, 1);
  insert.run('event', 'full', 'full-key', '{"pending":true}', 'pending', 200, 300, 2);
  insert.run('second', 'created', 'failed-key', '{"failed":true}', 'failed', 400, 0, 1);
  const before = db.prepare('SELECT * FROM line_notifications ORDER BY retry_key').all();
  const notifications = lineNotifications(db, settings);
  assert.deepEqual(db.prepare('SELECT * FROM line_notifications ORDER BY retry_key').all(), before);
  notifications.enqueue(event, 'created');
  notifications.enqueue(event, 'full');
  lineNotifications(db, settings).enqueue(event, 'created');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM line_notifications').get().n, 4);
  assert.deepEqual(db.prepare('SELECT * FROM line_notifications WHERE retry_key IN (?, ?, ?) ORDER BY retry_key').all('created-key', 'full-key', 'failed-key'), before);
});

test('network failures survive restart and reuse the exact payload and retry key', async t => {
  const { db, notifications } = setup(t);
  const attempts = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    attempts.push({ body: options.body, key: options.headers['X-Line-Retry-Key'] });
    if (attempts.length === 1) throw new Error('network unavailable');
    return new Response(null, { status: 409, headers: { 'x-line-accepted-request-id': 'already-accepted' } });
  });
  notifications.enqueue(event, 'created');
  await notifications.flush();
  const pending = db.prepare('SELECT * FROM line_notifications').get();
  assert.equal(pending.status, 'pending');
  assert.equal(pending.attempts, 1);
  assert.ok(pending.next_attempt_at > Date.now());
  await notifications.flush();
  assert.equal(attempts.length, 1);
  db.prepare('UPDATE line_notifications SET next_attempt_at=0').run();
  const restarted = lineNotifications(db, settings);
  restarted.enqueue({ ...event, title: 'changed title' }, 'created');
  await restarted.flush();
  assert.deepEqual(attempts[1], attempts[0]);
  await restarted.flush();
  assert.equal(attempts.length, 2);
  assert.equal(db.prepare('SELECT status FROM line_notifications').get().status, 'sent');
});

test('permanent LINE errors do not retry or consume quota with another notification', async t => {
  const { db, notifications } = setup(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 429 }); });
  notifications.enqueue(event, 'created');
  await notifications.flush();
  notifications.enqueue(event, 'created');
  await notifications.flush();
  assert.equal(calls, 1);
  assert.equal(db.prepare('SELECT status FROM line_notifications').get().status, 'failed');
});

test('server errors retry within the key window but expired retries never send', async t => {
  const { db, notifications } = setup(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(null, { status: 503 }); });
  notifications.enqueue(event, 'full');
  await notifications.flush();
  assert.equal(db.prepare('SELECT status FROM line_notifications').get().status, 'pending');
  db.prepare('UPDATE line_notifications SET first_attempt_at=?, next_attempt_at=0').run(Date.now() - 23 * 60 * 60 * 1000);
  await notifications.flush();
  assert.equal(calls, 1);
  assert.equal(db.prepare('SELECT status FROM line_notifications').get().status, 'failed');
});

test('full notifications show all 24 participants in order, including long nicknames', t => {
  const { db, notifications } = setup(t);
  const participants = Array.from({ length: 24 }, (_, i) => ({ nickname: String(i + 1).padStart(2, '0') + 'ช'.repeat(38) }));
  notifications.enqueue({ ...event, capacity: 24, confirmed: 24, participants }, 'full');
  const payload = JSON.parse(db.prepare('SELECT payload FROM line_notifications').get().payload);
  const contents = payload.messages[0].contents.body.contents;
  assert.equal(contents.at(-1).text, participants.map((person, i) => `${i + 1}. ${person.nickname}`).join('\n'));
  assert.ok(Buffer.byteLength(JSON.stringify(payload.messages[0].contents)) < 30000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM line_notifications').get().n, 1);
});

test('full cards collect the current per-person amount and include the QR in the same message', t => {
  const { db, notifications } = setup(t);
  const billing = { ...event, totalCostSatang: 120000, sharePeople: 2, sharePerPersonSatang: 60000, paymentQrUrl: 'https://club.example/api/line/payment-qr/example?signature=fictional' };
  notifications.enqueue(billing, 'created');
  notifications.enqueue(billing, 'full');
  const messages = db.prepare('SELECT payload FROM line_notifications ORDER BY rowid').all().map(row => JSON.parse(row.payload).messages);
  assert.equal(messages[1].length, 1);
  const card = messages[1][0];
  assert.equal(card.altText, 'คนครบแล้ว เย้!! ได้เวลาโอนค่าตีน้าาา 🎾: นัดเย็น');
  assert.match(JSON.stringify(card), /คนละ 600 บาท/);
  assert.match(JSON.stringify(card), /ค่าใช้จ่ายรวม 1,200 บาท ÷ ผู้ได้ที่ 2 คน/);
  assert.equal(card.contents.body.contents.find(component => component.type === 'image').url, billing.paymentQrUrl);
  assert.equal(card.contents.footer.contents[0].action.label, 'เปิดนัด / ตรวจยอดล่าสุด');
  assert.doesNotMatch(JSON.stringify(messages[0]), /คนละ|payment-qr/);
  notifications.enqueue({ ...billing, sharePerPersonSatang: 0, totalCostSatang: 0, paymentQrUrl: undefined }, 'full');
  const withoutQr = JSON.parse(db.prepare('SELECT payload FROM line_notifications ORDER BY rowid DESC LIMIT 1').get().payload).messages[0];
  assert.match(JSON.stringify(withoutQr), /คนละ 0 บาท/);
  assert.equal(withoutQr.contents.body.contents.some(component => component.type === 'image'), false);
  assert.match(JSON.stringify(withoutQr), /เปิดนัดเพื่อดูช่องทางชำระเงิน/);
});

test('large rosters keep the Flex bubble under the LINE JSON size limit', async t => {
  const { db, notifications } = setup(t);
  notifications.enqueue({ ...event, capacity: 10000, confirmed: 10000, totalCostSatang: 100000000, sharePeople: 10000, sharePerPersonSatang: 10000, paymentQrUrl: 'https://club.example/api/line/payment-qr/example?signature=' + 'a'.repeat(64), participants: Array.from({ length: 10000 }, () => ({ nickname: 'ช'.repeat(40) })) }, 'full');
  const payload = JSON.parse(db.prepare('SELECT payload FROM line_notifications').get().payload);
  assert.ok(Buffer.byteLength(JSON.stringify(payload.messages[0].contents)) < 30000);
  assert.match(JSON.stringify(payload), /ดูรายชื่อทั้งหมดในนัด/);
  assert.ok(payload.messages[0].contents.body.contents.at(-2).text.split('\n').length > 24);
});
