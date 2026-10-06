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
      getHeader(key){return result.headers[key.toLowerCase()];},
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
  assert.deepEqual(event.withdrawn,[{id:bob.id,nickname:'เมย์',isGuest:false,paid:true}]);
  event=(await request('PATCH',payment,alice.cookie,{memberId:bob.id,paid:false})).data.event;
  assert.equal(event.withdrawn[0].paid,false);
  await request('PATCH',payment,alice.cookie,{memberId:bob.id,paid:true});
  await request('POST',signup,bob.cookie,{});
  await request('DELETE',signup,alice.cookie,{});
  event=(await request('GET',path,alice.cookie)).data.event;
  assert.deepEqual(event.participants.map(p=>p.id),[cara.id]);
  assert.deepEqual(event.waitlist.map(p=>p.id),[bob.id]);
  assert.equal(event.waitlist[0].paid,true);
  assert.deepEqual(event.withdrawn,[{id:alice.id,nickname:'ต้น',isGuest:false,paid:false}]);
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
  // Organizer additions share the same FIFO and payment records as self signup.
  const rosterId=(await request('POST','/api/events',alice.cookie,{...fields,capacity:2})).data.event.id;
  const rosterPath='/api/events/'+rosterId, people=rosterPath+'/participants';
  // Multi-selection is one atomic batch, in selection order, with existing entries unchanged.
  const batchId=(await request('POST','/api/events',alice.cookie,fields)).data.event.id;
  const batchPath='/api/events/'+batchId, batchPeople=batchPath+'/participants';
  assert.equal((await request('POST',batchPeople,'',{memberIds:[bob.id]})).status,401);
  assert.equal((await request('POST',batchPeople,bob.cookie,{memberIds:[bob.id]})).status,403);
  for(const data of [{memberIds:[]},{memberIds:'bad'},{memberIds:[null]},{memberIds:[bob.id],memberId:bob.id},{memberIds:[bob.id],nickname:'ชื่อ'}]) {
    assert.equal((await request('POST',batchPeople,alice.cookie,data)).status,400);
  }
  assert.equal((await request('POST',batchPeople,alice.cookie,{memberIds:[bob.id,'missing']})).status,404);
  const batchDb=new DatabaseSync(databasePath);
  assert.equal(batchDb.prepare('SELECT COUNT(*) AS n FROM registrations WHERE event_id=?').get(batchId).n,0);
  assert.equal(batchDb.prepare('SELECT COUNT(*) AS n FROM event_payments WHERE event_id=?').get(batchId).n,0);
  let batch=(await request('POST',batchPeople,alice.cookie,{memberIds:[cara.id,bob.id,cara.id,dan.id]})).data.event;
  assert.deepEqual(batch.participants.map(p=>p.id),[cara.id]);
  assert.deepEqual(batch.waitlist.map(p=>p.id),[bob.id,dan.id]);
  assert.equal(batch.participants[0].paid,false);
  await request('PATCH',batchPath+'/payment',alice.cookie,{memberId:bob.id,paid:true});
  batch=(await request('POST',batchPeople,alice.cookie,{memberIds:[dan.id,bob.id,cara.id]})).data.event;
  assert.deepEqual(batch.waitlist.map(p=>p.id),[bob.id,dan.id]);assert.equal(batch.waitlist[0].paid,true);
  await request('DELETE',batchPeople+'/'+bob.id,alice.cookie,{});
  batch=(await request('POST',batchPeople,alice.cookie,{memberIds:[bob.id]})).data.event;
  assert.deepEqual(batch.waitlist.map(p=>p.id),[dan.id,bob.id]);assert.equal(batch.waitlist[1].paid,true);
  batch=(await request('POST',batchPeople,alice.cookie,{nickname:'ชื่อไม่มีบัญชี'})).data.event;
  assert.equal((await request('POST',batchPeople,alice.cookie,{memberIds:[batch.waitlist.at(-1).id]})).status,404);
  await request('POST',batchPath+'/cancel',alice.cookie,{});
  assert.equal((await request('POST',batchPeople,alice.cookie,{memberIds:[alice.id]})).status,409);
  batchDb.close();
  assert.equal((await request('GET',rosterPath+'/available-members',bob.cookie)).status,403);
  const available=(await request('GET',rosterPath+'/available-members',alice.cookie)).data.members;
  assert.equal(available.length,4);
  assert.deepEqual(Object.keys(available[0]).sort(),['id','nickname']);
  assert.equal((await request('POST',people,bob.cookie,{nickname:'เพื่อน'})).status,403);
  assert.equal((await request('POST',people,'',{nickname:'เพื่อน'})).status,401);
  assert.equal((await request('POST',people,alice.cookie,{nickname:'เพื่อน'},'https://other.example')).status,403);
  for(const data of [{},{memberId:bob.id,nickname:'เพื่อน'},{nickname:' '},{nickname:'x'.repeat(41)},{memberId:'missing'}]) {
    assert.equal((await request('POST',people,alice.cookie,data)).status,data.memberId==='missing'?404:400);
  }
  await request('POST',people,alice.cookie,{memberId:bob.id});
  let roster=(await request('POST',people,alice.cookie,{nickname:'เพื่อนใหม่'})).data.event;
  const guest=roster.participants[1];
  assert.equal(guest.isGuest,true);assert.equal(guest.paid,false);
  assert.equal(roster.participants[0].isGuest,false);
  await request('POST',people,alice.cookie,{memberId:cara.id});
  roster=(await request('POST',people,alice.cookie,{memberId:bob.id})).data.event;
  assert.deepEqual(roster.participants.map(p=>p.id),[bob.id,guest.id]);
  assert.deepEqual(roster.waitlist.map(p=>p.id),[cara.id]);
  assert.equal((await request('GET',rosterPath+'/available-members',alice.cookie)).data.members.length,4);
  assert.equal((await request('POST','/api/events/'+otherEvent.id+'/participants',bob.cookie,{memberId:guest.id})).status,404);
  assert.equal((await request('PATCH',people+'/'+guest.id,bob.cookie,{nickname:'แอบแก้'})).status,403);
  assert.equal((await request('PATCH',people+'/'+guest.id,bob.cookie,{memberId:dan.id})).status,403);
  assert.equal((await request('DELETE',people+'/'+bob.id,cara.cookie,{})).status,403);
  assert.equal((await request('PATCH',people+'/'+bob.id,alice.cookie,{nickname:'แก้สมาชิก'})).status,409);
  assert.equal((await request('PATCH',people+'/'+guest.id,alice.cookie,{nickname:'แก้',memberId:dan.id})).status,400);
  roster=(await request('PATCH',people+'/'+guest.id,alice.cookie,{nickname:'ชื่อที่แก้'})).data.event;
  assert.equal(roster.participants[1].nickname,'ชื่อที่แก้');
  assert.equal((await request('PATCH',people+'/'+guest.id,alice.cookie,{memberId:guest.id})).status,404);
  assert.equal((await request('PATCH',people+'/'+guest.id,alice.cookie,{memberId:'missing'})).status,404);
  assert.deepEqual((await request('GET',rosterPath,alice.cookie)).data.event.participants.map(p=>p.id),[bob.id,guest.id]);
  await request('PATCH',rosterPath+'/payment',alice.cookie,{memberId:guest.id,paid:true});
  roster=(await request('DELETE',people+'/'+guest.id,alice.cookie,{})).data.event;
  assert.deepEqual(roster.participants.map(p=>p.id),[bob.id,cara.id]);
  assert.equal(roster.withdrawn[0].paid,true);
  roster=(await request('POST',people,alice.cookie,{memberId:guest.id})).data.event;
  assert.deepEqual(roster.waitlist.map(p=>p.id),[guest.id]);
  assert.equal(roster.waitlist[0].paid,true);
  // Linking to a new account keeps the original position and transferred payment.
  roster=(await request('PATCH',people+'/'+guest.id,alice.cookie,{memberId:dan.id})).data.event;
  assert.deepEqual(roster.waitlist.map(p=>p.id),[dan.id]);
  assert.equal(roster.waitlist[0].paid,true);assert.equal(roster.waitlist[0].isGuest,false);
  assert.equal((await request('POST',people,alice.cookie,{memberId:guest.id})).status,404);
  // Merge both orders: the earlier queue entry wins; either paid entry wins.
  for(const guestFirst of [true,false]) {
    const mergeId=(await request('POST','/api/events',alice.cookie,{...fields,capacity:2})).data.event.id;
    const mergePath='/api/events/'+mergeId, mergePeople=mergePath+'/participants';
    if(!guestFirst)await request('POST',mergePeople,alice.cookie,{memberId:bob.id});
    let merged=(await request('POST',mergePeople,alice.cookie,{nickname:'เมย์'})).data.event;
    const duplicate=merged.participants.find(p=>p.isGuest);
    if(guestFirst)await request('POST',mergePeople,alice.cookie,{memberId:bob.id});
    await request('POST',mergePeople,alice.cookie,{memberId:cara.id});
    await request('PATCH',mergePath+'/payment',alice.cookie,{memberId:guestFirst?duplicate.id:bob.id,paid:true});
    merged=(await request('PATCH',mergePeople+'/'+duplicate.id,alice.cookie,{memberId:bob.id})).data.event;
    assert.deepEqual(merged.participants.map(p=>p.id),[bob.id,cara.id]);
    assert.deepEqual(merged.waitlist,[]);assert.equal(merged.participants[0].paid,true);
    // Same nickname never auto-links; both withdrawn entries remain withdrawn on merge.
    merged=(await request('POST',mergePeople,alice.cookie,{nickname:'เมย์'})).data.event;
    const withdrawnGuest=merged.waitlist[0];assert.equal(withdrawnGuest.isGuest,true);
    await request('DELETE',mergePeople+'/'+withdrawnGuest.id,alice.cookie,{});
    await request('DELETE',mergePeople+'/'+bob.id,alice.cookie,{});
    merged=(await request('PATCH',mergePeople+'/'+withdrawnGuest.id,alice.cookie,{memberId:bob.id})).data.event;
    assert.deepEqual(merged.participants.map(p=>p.id),[cara.id]);
    assert.equal(merged.withdrawn.length,1);assert.equal(merged.withdrawn[0].id,bob.id);assert.equal(merged.withdrawn[0].paid,true);
    merged=(await request('POST',mergePeople,alice.cookie,{memberId:bob.id})).data.event;
    assert.deepEqual(merged.participants.map(p=>p.id),[cara.id,bob.id]);assert.equal(merged.participants[1].paid,true);
  }
  // Linking a withdrawn guest to an active account leaves the account's queue intact.
  const oneId=(await request('POST','/api/events',alice.cookie,fields)).data.event.id;
  const onePath='/api/events/'+oneId, onePeople=onePath+'/participants';
  let one=(await request('POST',onePeople,alice.cookie,{nickname:'คนเดียว'})).data.event;
  const inactiveGuest=one.participants[0];
  await request('PATCH',onePath+'/payment',alice.cookie,{memberId:inactiveGuest.id,paid:true});
  await request('DELETE',onePeople+'/'+inactiveGuest.id,alice.cookie,{});
  await request('POST',onePeople,alice.cookie,{memberId:bob.id});
  await request('POST',onePeople,alice.cookie,{memberId:cara.id});
  one=(await request('PATCH',onePeople+'/'+inactiveGuest.id,alice.cookie,{memberId:bob.id})).data.event;
  assert.deepEqual(one.participants.map(p=>p.id),[bob.id]);
  assert.deepEqual(one.waitlist.map(p=>p.id),[cara.id]);assert.equal(one.participants[0].paid,true);
  // A withdrawn guest linked to an account with no entry stays withdrawn too.
  one=(await request('POST',onePeople,alice.cookie,{nickname:'ยังถอนอยู่'})).data.event;
  const loneGuest=one.waitlist.find(p=>p.isGuest);
  await request('DELETE',onePeople+'/'+loneGuest.id,alice.cookie,{});
  one=(await request('PATCH',onePeople+'/'+loneGuest.id,alice.cookie,{memberId:dan.id})).data.event;
  assert.deepEqual(one.participants.map(p=>p.id),[bob.id]);
  assert.deepEqual(one.waitlist.map(p=>p.id),[cara.id]);
  assert.deepEqual(one.withdrawn.map(p=>p.id),[dan.id]);assert.equal(one.withdrawn[0].paid,false);
  const securityDb=new DatabaseSync(databasePath);
  const guestEvent=(await request('POST',people,alice.cookie,{nickname:'ยังไม่มีบัญชี'})).data.event;
  const anonymous=guestEvent.waitlist.find(p=>p.isGuest);
  assert.equal(securityDb.prepare('SELECT line_id, guest_event_id FROM members WHERE id=?').get(anonymous.id).line_id,null);
  const guestToken='g'.repeat(43);
  const {createHash}=await import('node:crypto');
  securityDb.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(createHash('sha256').update(guestToken).digest('hex'),anonymous.id,Date.now()+60000);
  assert.equal((await request('GET','/api/me','sks_session='+guestToken)).status,401);
  securityDb.close();
  await request('POST',rosterPath+'/cancel',alice.cookie,{});
  for(const [method,url,data] of [['POST',people,{nickname:'ไม่ได้'}],['DELETE',people+'/'+anonymous.id,{}],['PATCH',people+'/'+anonymous.id,{nickname:'ไม่ได้'}],['PATCH',people+'/'+anonymous.id,{memberId:alice.id}],['POST',people,{memberId:bob.id}]]) {
    assert.equal((await request(method,url,alice.cookie,data)).status,409);
  }
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
  const home = await request('GET','/');
  assert.equal(home.status,200);
  const html = home.bytes.toString();
  const nonce = html.match(/name="csp-nonce" content="([^\"]+)"/)[1];
  assert.match(home.headers['content-security-policy'],new RegExp("style-src 'self' 'nonce-"+nonce.replace(/[+]/g,'\\+')+"'"));
  assert.doesNotMatch(home.headers['content-security-policy'],/unsafe-inline|unsafe-eval/);
  assert.notEqual((await request('GET','/')).bytes.toString().match(/name="csp-nonce" content="([^\"]+)"/)[1],nonce);
  const script = html.match(/src="(\/assets\/[^\"]+\.js)"/)[1];
  const style = html.match(/href="(\/assets\/[^\"]+\.css)"/)[1];
  assert.equal((await request('GET',script)).status,200);
  assert.equal((await request('GET',style)).status,200);
  assert.equal((await request('GET','/api/missing',alice.cookie)).status,404);
  assert.equal((await request('GET','/api/missing')).status,401);
  assert.equal((await request('GET','/assets/server.mjs')).status,404);
  assert.equal((await request('GET','/assets/%2e%2e%2fserver.mjs')).status,404);
  assert.equal((await request('GET','/data/sks.sqlite')).status,404);
  assert.equal((await request('POST','/api/logout',alice.cookie,{})).status,200);
  assert.equal((await request('GET','/api/me',alice.cookie)).status,401);
});
