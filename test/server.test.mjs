import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('LINE membership, organizer permissions, and durable FIFO signup queue', async t => {
  const origin = 'https://club.example';
  const invite = 'test-invite-code-abcdefghijklmnopqrstuvwxyz';
  const databasePath = join(mkdtempSync(join(tmpdir(), 'sks-test-')), 'club.sqlite');
  process.env.SKS_ORIGIN = origin;
  process.env.SKS_DATABASE_PATH = databasePath;
  process.env.LINE_LOGIN_CHANNEL_ID = '1234567890';
  process.env.LINE_LIFF_ID = '1234567890-test';
  process.env.SKS_INVITE_CODE = invite;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('client_id'), '1234567890');
    const token = options.body.get('id_token');
    calls.push(token);
    if (token === 'tampered') return Response.json({error:'invalid'}, {status:400});
    return Response.json({
      iss: token === 'wrong-issuer' ? 'https://attacker.example' : 'https://access.line.me',
      aud: token === 'wrong-channel' ? '5555555555' : '1234567890',
      sub: 'line-subject-' + token, name: token,
      exp: Math.floor(Date.now()/1000) + (token === 'expired' ? -10 : 3600)
    });
  });
  const { handleRequest } = await import('../server.mjs');
  async function request(method, url, cookie = '', data, suppliedOrigin = origin) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.method = method; req.url = url;
    req.headers = {'content-type':'application/json',origin:suppliedOrigin,cookie};
    req.socket = {remoteAddress:'127.0.0.1'};
    const result = {headers:{},status:0,bytes:Buffer.alloc(0)};
    const res = {
      setHeader(key,value){result.headers[key.toLowerCase()] = value;},
      writeHead(status,headers){result.status=status;for(const [key,value]of Object.entries(headers||{}))this.setHeader(key,value);},
      end(value){result.bytes=Buffer.from(value);}
    };
    await handleRequest(req,res);
    if(result.headers['content-type']?.startsWith('application/json')) result.data=JSON.parse(result.bytes.toString());
    return result;
  }
  async function login(token, nickname) {
    const result = await request('POST','/api/auth','',{idToken:token,invite});
    assert.equal(result.status,200);
    assert.match(result.headers['set-cookie'],/HttpOnly; SameSite=Lax; Max-Age=604800; Secure/);
    const cookie = result.headers['set-cookie'].split(';')[0];
    assert.equal((await request('PATCH','/api/me',cookie,{nickname})).status,200);
    return {cookie,id:result.data.member.id};
  }
  assert.equal((await request('GET','/api/events')).status,401);
  assert.equal((await request('GET','/api/me','sks_session='+'z'.repeat(43))).status,401);
  const before = calls.length;
  assert.equal((await request('POST','/api/auth','',{idToken:'alice',invite},'https://other.example')).status,403);
  assert.equal(calls.length,before);
  for(const token of ['tampered','expired','wrong-channel','wrong-issuer']) {
    const rejected = await request('POST','/api/auth','',{idToken:token,invite});
    assert.equal(rejected.status,401);
    assert.equal(rejected.headers['set-cookie'],undefined);
  }
  assert.equal((await request('POST','/api/auth','',{idToken:'outsider',invite:'wrong'})).status,403);
  assert.equal((await request('POST','/api/auth','',{idToken:'outsider'})).status,403);
  const alice=await login('alice','ต้น'), bob=await login('bob','เมย์'), cara=await login('cara','โบว์'), dan=await login('dan','บอย');
  const fields={title:'นัดเย็น',venue:'สนามสวน',date:'2026-10-10',start:'18:00',end:'20:00',courts:2,courtNames:'คอร์ต 1, 2',capacity:1};
  assert.equal((await request('POST','/api/events',alice.cookie,{...fields,date:'2026-02-31'})).status,400);
  assert.equal((await request('POST','/api/events',alice.cookie,{...fields,end:'17:00'})).status,400);
  assert.equal((await request('POST','/api/events',alice.cookie,{...fields,capacity:1.5})).status,400);
  const created=await request('POST','/api/events',alice.cookie,{...fields,organizerId:bob.id});
  assert.equal(created.status,201);
  assert.equal(created.data.event.organizerId,alice.id);
  assert.equal(created.data.event.confirmed,0);
  const id=created.data.event.id, path='/api/events/'+id, signup=path+'/signup';
  assert.equal((await request('POST',signup,alice.cookie,{})).status,200);
  await Promise.all([
    request('POST',signup,bob.cookie,{memberId:alice.id}),
    request('POST',signup,cara.cookie,{})
  ]);
  let event=(await request('GET',path,alice.cookie)).data.event;
  assert.deepEqual(event.participants.map(p=>p.id),[alice.id]);
  assert.deepEqual(event.waitlist.map(p=>p.id),[bob.id,cara.id]);
  assert.equal(event.participants[0].paid,false);
  assert.deepEqual(event.withdrawn,[]);
  const payment=path+'/payment';
  assert.equal((await request('PATCH',payment,'',{memberId:bob.id,paid:true})).status,401);
  assert.equal((await request('PATCH',payment,bob.cookie,{memberId:bob.id,paid:true})).status,403);
  assert.equal((await request('PATCH',payment,alice.cookie,{memberId:bob.id,paid:'true'})).status,400);
  assert.equal((await request('PATCH',payment,alice.cookie,{memberId:dan.id,paid:true})).status,404);
  assert.equal((await request('PATCH',payment,alice.cookie,{memberId:bob.id,paid:true},'https://other.example')).status,403);
  event=(await request('PATCH',payment,alice.cookie,{memberId:bob.id,paid:true})).data.event;
  assert.equal(event.waitlist.find(p=>p.id===bob.id).paid,true);
  assert.equal(event.waitlist.find(p=>p.id===cara.id).paid,false);
  assert.equal((await request('GET',path,cara.cookie)).data.event.waitlist[0].paid,true);
  const otherEvent=(await request('POST','/api/events',bob.cookie,fields)).data.event;
  await request('POST','/api/events/'+otherEvent.id+'/signup',bob.cookie,{});
  assert.equal((await request('GET','/api/events/'+otherEvent.id,bob.cookie)).data.event.participants[0].paid,false);
  assert.equal((await request('PATCH',payment,bob.cookie,{memberId:bob.id,paid:false})).status,403);
  assert.equal((await request('GET',path,bob.cookie)).data.event.myPosition,2);
  await request('DELETE',signup,bob.cookie,{});
  event=(await request('GET',path,alice.cookie)).data.event;
  assert.deepEqual(event.participants.map(p=>p.id),[alice.id]);
  assert.deepEqual(event.waitlist.map(p=>p.id),[cara.id]);
  assert.deepEqual(event.withdrawn,[{id:bob.id,nickname:'เมย์',paid:true}]);
  event=(await request('PATCH',payment,alice.cookie,{memberId:bob.id,paid:false})).data.event;
  assert.equal(event.withdrawn[0].paid,false);
  await request('PATCH',payment,alice.cookie,{memberId:bob.id,paid:true});
  await request('POST',signup,bob.cookie,{});
  await request('DELETE',signup,alice.cookie,{});
  event=(await request('GET',path,alice.cookie)).data.event;
  assert.deepEqual(event.participants.map(p=>p.id),[cara.id]);
  assert.deepEqual(event.waitlist.map(p=>p.id),[bob.id]);
  assert.equal(event.waitlist[0].paid,true);
  assert.deepEqual(event.withdrawn,[]);
  await request('POST',signup,alice.cookie,{});
  await Promise.all([request('POST',signup,cara.cookie,{}),request('POST',signup,cara.cookie,{})]);
  await request('DELETE',signup,dan.cookie,{memberId:cara.id});
  event=(await request('GET',path,alice.cookie)).data.event;
  assert.equal(event.confirmed+event.waiting,3);
  assert.deepEqual(event.participants.map(p=>p.id),[cara.id]);
  assert.equal((await request('PATCH',path,bob.cookie,{...fields,capacity:2})).status,403);
  assert.equal((await request('POST',path+'/cancel',bob.cookie,{})).status,403);
  event=(await request('PATCH',path,alice.cookie,{...fields,capacity:2})).data.event;
  assert.deepEqual(event.participants.map(p=>p.id),[cara.id,bob.id]);
  assert.equal(event.participants.find(p=>p.id===bob.id).paid,true);
  assert.deepEqual(event.waitlist.map(p=>p.id),[alice.id]);
  assert.equal((await request('PATCH',path,alice.cookie,fields)).status,409);
  assert.equal((await request('POST',path+'/cancel',alice.cookie,{})).status,200);
  assert.equal((await request('POST',signup,dan.cookie,{})).status,409);
  assert.equal((await request('DELETE',signup,cara.cookie,{})).status,409);
  assert.equal((await request('PATCH',payment,alice.cookie,{memberId:bob.id,paid:false})).status,409);
  event=(await request('GET',path,alice.cookie)).data.event;
  assert.equal(event.cancelled,true);
  assert.equal(event.confirmed+event.waiting,3);
  const shared=(await request('GET','/api/invite',alice.cookie)).data.url;
  assert.equal(new URL(shared).searchParams.get('invite'),invite);
  assert.equal((await request('GET','/api/invite')).status,401);
  const secondConnection=new DatabaseSync(databasePath);
  assert.equal(secondConnection.prepare('SELECT title FROM events WHERE id=?').get(id).title,'นัดเย็น');
  assert.equal(secondConnection.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id=?').get(id).n,3);
  assert.equal(secondConnection.prepare('SELECT paid FROM event_payments WHERE event_id=? AND member_id=?').get(id,bob.id).paid,1);
  secondConnection.close();
  const logo=await request('GET','/sks-logo.png');
  assert.equal(logo.status,200);
  assert.equal(logo.bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.match((await request('GET','/')).bytes.toString(),/href="\/styles.css"/);
  assert.equal((await request('GET','/data/sks.sqlite')).status,404);
  assert.equal((await request('POST','/api/logout',alice.cookie,{})).status,200);
  assert.equal((await request('GET','/api/me',alice.cookie)).status,401);
});
