import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('OA announces creation once and each not-full to full transition, with signed webhook setup', async t => {
  const origin = 'https://club.example', invite = 'test-invite-' + 'a'.repeat(24);
  const groupId = 'C' + 'a'.repeat(32), secret = 'test-only-secret';
  const databasePath = join(mkdtempSync(join(tmpdir(), 'sks-notify-')), 'club.sqlite');
  Object.assign(process.env, {
    SKS_ORIGIN: origin, SKS_DATABASE_PATH: databasePath, SKS_INVITE_CODE: invite,
    LINE_LOGIN_CHANNEL_ID: '123', LINE_LIFF_ID: '123-test',
    LINE_MESSAGING_CHANNEL_ACCESS_TOKEN: 'test-only-token', LINE_MESSAGING_CHANNEL_SECRET: secret, LINE_NOTIFY_GROUP_ID: groupId
  });
  const pushes = [], replies = [], logs = [];
  let pushStatus = 200;
  let replyStatus = 200;
  t.mock.method(console, 'log', (...args) => logs.push(args));
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === 'https://api.line.me/v2/bot/message/reply') {
      replies.push(JSON.parse(options.body));
      return new Response(null, { status: replyStatus });
    }
    if (url === 'https://api.line.me/v2/bot/message/push') {
      pushes.push(JSON.parse(options.body));
      return new Response(null, { status: pushStatus });
    }
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    return Response.json({ iss: 'https://access.line.me', aud: '123', sub: options.body.get('id_token'), name: 'test', exp: Math.floor(Date.now() / 1000) + 3600 });
  });
  const { handleRequest } = await import('../server.mjs');
  async function request(method, path, cookie = '', data, extraHeaders = {}) {
    const raw = data === undefined ? '' : typeof data === 'string' ? data : JSON.stringify(data);
    const req = Readable.from(raw ? [Buffer.from(raw)] : []);
    Object.assign(req, { method, url: path, headers: { origin, cookie, 'content-type': 'application/json', ...extraHeaders }, socket: { remoteAddress: '127.0.0.1' } });
    const result = { headers: {}, status: 0 };
    const res = {
      setHeader(key, value) { result.headers[key.toLowerCase()] = value; },
      getHeader(key) { return result.headers[key.toLowerCase()]; },
      writeHead(status, headers) { result.status = status; for (const [key, value] of Object.entries(headers || {})) this.setHeader(key, value); },
      end(value) {
        result.bytes = Buffer.from(value);
        if (result.headers['content-type']?.startsWith('application/json')) result.data = JSON.parse(value);
      }
    };
    await handleRequest(req, res);
    await new Promise(resolve => setImmediate(resolve));
    return result;
  }
  async function login(id) {
    const auth = await request('POST', '/api/auth', '', { idToken: id, invite });
    assert.equal(auth.status, 200);
    const cookie = auth.headers['set-cookie'].split(';')[0];
    assert.equal((await request('PATCH', '/api/me', cookie, { nickname: id })).status, 200);
    return { id: auth.data.member.id, cookie };
  }
  const alice = await login('ต้น'), bob = await login('เมย์'), cara = await login('โบว์');
  const fields = { title: 'นัดเย็น', venue: 'สนามสวน', date: '2026-10-09', start: '18:00', end: '20:00', courts: 1, courtNames: '4', capacity: 2 };
  assert.equal((await request('POST', '/api/events', alice.cookie, { ...fields, capacity: 0 })).status, 400);
  assert.equal(pushes.length, 0);
  const created = await request('POST', '/api/events', alice.cookie, fields);
  assert.equal(created.status, 201);
  const path = '/api/events/' + created.data.event.id;
  assert.equal(pushes.length, 1);
  assert.match(pushes[0].messages[0].altText, /^เปิดนัดใหม่:/);
  await request('POST', path + '/signup', alice.cookie, {});
  assert.equal(pushes.length, 1);
  await Promise.all([request('POST', path + '/signup', bob.cookie, {}), request('POST', path + '/signup', bob.cookie, {})]);
  assert.equal(pushes.length, 2);
  assert.match(pushes[1].messages[0].altText, /^คนเต็มแล้ว:/);
  await request('POST', path + '/signup', cara.cookie, {}); // Waitlist and its promotion stay quiet.
  assert.equal(pushes.length, 2);
  await request('DELETE', path + '/signup', bob.cookie, {});
  assert.equal(pushes.length, 2);
  await request('DELETE', path + '/signup', cara.cookie, {});
  assert.equal(pushes.length, 2);
  await request('POST', path + '/signup', bob.cookie, {}); // Full a second time.
  assert.equal(pushes.length, 3);
  assert.match(pushes.at(-1).messages[0].altText, /^คนเต็มแล้ว:/);
  await request('POST', path + '/signup', bob.cookie, {});
  await request('PATCH', path + '/payment', alice.cookie, { memberId: alice.id, paid: true });
  await request('PATCH', path, alice.cookie, { ...fields, title: 'แก้ชื่อ' });
  await request('GET', path, alice.cookie);
  assert.equal(pushes.length, 3);
  await request('POST', path + '/cancel', alice.cookie, {});
  assert.equal((await request('POST', path + '/signup', cara.cookie, {})).status, 409);
  assert.equal(pushes.length, 3);

  const roster = '/api/events/' + (await request('POST', '/api/events', alice.cookie, fields)).data.event.id;
  const beforeBatch = pushes.length;
  assert.equal((await request('POST', roster + '/participants', alice.cookie, { memberIds: [bob.id, 'missing'] })).status, 404);
  assert.equal(pushes.length, beforeBatch);
  await request('POST', roster + '/participants', alice.cookie, { nickname: 'เพื่อนใหม่' });
  assert.equal(pushes.length, beforeBatch);
  await request('POST', roster + '/participants', alice.cookie, { memberIds: [bob.id, cara.id] });
  assert.equal(pushes.length, beforeBatch + 1);
  assert.match(pushes.at(-1).messages[0].altText, /^คนเต็มแล้ว:/);
  await request('POST', roster + '/participants', alice.cookie, { memberIds: [bob.id, cara.id] });
  assert.equal(pushes.length, beforeBatch + 1);

  const reduced = '/api/events/' + (await request('POST', '/api/events', alice.cookie, { ...fields, capacity: 3 })).data.event.id;
  await request('POST', reduced + '/participants', alice.cookie, { memberIds: [alice.id, bob.id] });
  const beforeReduction = pushes.length;
  await request('PATCH', reduced, alice.cookie, fields);
  assert.equal(pushes.length, beforeReduction + 1);
  await request('PATCH', reduced, alice.cookie, { ...fields, capacity: 3 });
  await request('POST', reduced + '/signup', cara.cookie, {});
  assert.equal(pushes.length, beforeReduction + 2);

  // LINE failures must never turn a committed event/signup into a failed API request.
  pushStatus = 503;
  const failedPush = await request('POST', '/api/events', alice.cookie, { ...fields, capacity: 1 });
  assert.equal(failedPush.status, 201);
  const failedPath = '/api/events/' + failedPush.data.event.id;
  assert.equal((await request('POST', failedPath + '/signup', alice.cookie, {})).status, 200);
  const persisted = new DatabaseSync(databasePath);
  t.after(() => persisted.close());
  assert.equal(persisted.prepare("SELECT COUNT(*) AS n FROM line_notifications WHERE event_id=? AND status='pending'").get(failedPush.data.event.id).n, 2);

  // Bill only on full transitions; the signed image link grants access only to that QR version.
  pushStatus = 200;
  const png = readFileSync(new URL('../public/sks-logo.png', import.meta.url));
  const billingFields = { ...fields, capacity: 3, courtCostSatang: 90000, ballCostSatang: 10000, paymentQr: png.toString('base64') };
  const billingId = (await request('POST', '/api/events', alice.cookie, billingFields)).data.event.id;
  const billingPath = '/api/events/' + billingId;
  const beforeBilling = pushes.length;
  await request('POST', billingPath + '/signup', alice.cookie, {});
  await request('POST', billingPath + '/signup', bob.cookie, {});
  assert.equal(pushes.length, beforeBilling);
  const guest = (await request('POST', billingPath + '/participants', alice.cookie, { nickname: 'เพื่อน' })).data.event.participants[2];
  assert.equal(pushes.length, beforeBilling + 1);
  const bill = pushes.at(-1).messages[0];
  assert.equal(pushes.at(-1).messages.length, 1);
  assert.match(bill.altText, /^คนครบแล้ว เย้!! ได้เวลาโอนค่าตีน้าาา 🎾:/);
  assert.match(JSON.stringify(bill), /คนละ 334 บาท/);
  assert.match(JSON.stringify(bill), /ค่าใช้จ่ายรวม 1,000 บาท ÷ ผู้ได้ที่ 3 คน/);
  await request('POST', billingPath + '/signup', cara.cookie, {});
  assert.equal(pushes.length, beforeBilling + 1);
  const qrUrl = new URL(bill.contents.body.contents.find(component => component.type === 'image').url);
  const imagePath = qrUrl.pathname + qrUrl.search;
  const image = await request('GET', imagePath, '', undefined, { origin: undefined });
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.deepEqual(image.bytes, png);
  assert.equal((await request('GET', billingPath + '/payment-qr')).status, 401);
  assert.equal((await request('GET', qrUrl.pathname)).status, 403);
  for (const key of ['signature', 'version', 'expires']) {
    const tampered = new URL(qrUrl);
    tampered.searchParams.set(key, key === 'expires' ? String(Number(qrUrl.searchParams.get(key)) + 1) : '0'.repeat(64));
    assert.equal((await request('GET', tampered.pathname + tampered.search)).status, 403);
  }
  assert.equal((await request('GET', qrUrl.pathname.replace(billingId, created.data.event.id) + qrUrl.search)).status, 403);
  const expired = new URL(qrUrl);
  expired.searchParams.set('expires', String(Math.floor(Date.now() / 1000) - 1));
  expired.searchParams.set('signature', createHmac('sha256', secret).update('payment-qr:' + billingId + ':' + expired.searchParams.get('version') + ':' + expired.searchParams.get('expires')).digest('hex'));
  assert.equal((await request('GET', expired.pathname + expired.search)).status, 403);
  const replacement = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await request('PATCH', billingPath, alice.cookie, { ...billingFields, paymentQr: replacement.toString('base64') });
  assert.equal((await request('GET', imagePath)).status, 404);
  assert.equal(pushes.length, beforeBilling + 1);
  await request('DELETE', billingPath + '/signup', cara.cookie, {});
  await request('DELETE', billingPath + '/participants/' + guest.id, alice.cookie, {});
  await request('PATCH', billingPath, alice.cookie, { ...fields, capacity: 2 });
  assert.equal(pushes.length, beforeBilling + 2);
  assert.match(JSON.stringify(pushes.at(-1)), /คนละ 500 บาท/);
  const updatedQr = new URL(pushes.at(-1).messages[0].contents.body.contents.find(component => component.type === 'image').url);
  assert.deepEqual((await request('GET', updatedQr.pathname + updatedQr.search)).bytes, replacement);
  await request('PATCH', billingPath, alice.cookie, { ...fields, paymentQr: null });
  assert.equal((await request('GET', updatedQr.pathname + updatedQr.search)).status, 404);

  // The webhook alone bypasses browser Origin/session checks, and authenticates raw bytes instead.
  const webhook = '/api/line/webhook';
  const payload = JSON.stringify({ events: [{ type: 'join', source: { type: 'group', groupId } }] });
  const sign = raw => createHmac('sha256', secret).update(raw).digest('base64');
  const beforeWebhook = pushes.length;
  logs.length = 0;
  for (const signature of [undefined, 'wrong', 'ก'.repeat(44)]) {
    assert.equal((await request('POST', webhook, '', payload, { origin: undefined, 'x-line-signature': signature })).status, 401);
  }
  assert.equal(logs.length, 0);
  assert.equal(replies.length, 0);
  assert.equal((await request('POST', webhook, '', payload, { origin: undefined, 'x-line-signature': sign(payload) })).status, 200);
  assert.deepEqual(logs, [['LINE group ID:', groupId]]);
  const empty = '{"events":[]}';
  assert.equal((await request('POST', webhook, '', empty, { origin: undefined, 'x-line-signature': sign(empty) })).status, 200);
  assert.equal((await request('POST', webhook, '', '{"events":[null]}', { origin: undefined, 'x-line-signature': sign(empty) })).status, 401);
  assert.equal((await request('POST', webhook, '', 'bad-json', { origin: undefined, 'x-line-signature': sign('bad-json') })).status, 400);
  assert.equal((await request('POST', webhook, '', '{}', { origin: undefined, 'x-line-signature': sign('{}') })).status, 400);
  assert.equal((await request('POST', webhook, '', 'a'.repeat(1024 * 1024 + 1), { origin: undefined })).status, 413);
  assert.equal(pushes.length, beforeWebhook);
  const newcomer = { type: 'memberJoined', replyToken: 'test-only-reply-token', source: { type: 'group', groupId }, joined: { members: [{ type: 'user', userId: 'U' + 'b'.repeat(32) }] } };
  const greet = async (event, signature) => {
    const raw = JSON.stringify({ events: [event] });
    return request('POST', webhook, '', raw, { origin: undefined, 'x-line-signature': signature ?? sign(raw) });
  };
  assert.equal((await greet(newcomer, 'wrong')).status, 401);
  assert.equal(replies.length, 0);
  assert.equal((await greet({ ...newcomer, source: { type: 'group', groupId: 'C' + 'c'.repeat(32) } })).status, 200);
  assert.equal(replies.length, 0);
  assert.equal((await greet(newcomer)).status, 200);
  assert.equal(replies.length, 1);
  assert.match(replies[0].messages[0].altText, /ยินดีต้อนรับ/);
  replyStatus = 503;
  assert.equal((await greet(newcomer)).status, 502);
  replyStatus = 400;
  assert.equal((await greet({ ...newcomer, deliveryContext: { isRedelivery: true } })).status, 200);
  assert.equal(pushes.length, beforeWebhook);
  assert.equal((await request('POST', '/api/events', alice.cookie, fields, { origin: undefined })).status, 403);
  const config = (await request('GET', '/api/config')).data;
  assert.deepEqual(Object.keys(config).sort(), ['liffId', 'ready']);
});
