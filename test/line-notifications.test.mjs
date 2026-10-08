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

test('each event has two themed notifications at most, even after reinitializing', async t => {
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
  assert.equal(calls.length, 2);
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
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM line_notifications WHERE status='sent'").get().n, 2);
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

test('large rosters keep the Flex bubble under the LINE JSON size limit', async t => {
  const { db, notifications } = setup(t);
  notifications.enqueue({ ...event, capacity: 10000, confirmed: 10000, participants: Array.from({ length: 10000 }, () => ({ nickname: 'ช'.repeat(40) })) }, 'full');
  const payload = JSON.parse(db.prepare('SELECT payload FROM line_notifications').get().payload);
  assert.ok(Buffer.byteLength(JSON.stringify(payload.messages[0].contents)) < 30000);
  assert.match(JSON.stringify(payload), /ดูรายชื่อทั้งหมดในนัด/);
});
