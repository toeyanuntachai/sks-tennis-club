import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

test('monthly doubles ranking, corrections, permissions, duplicate requests and durable history', async t => {
  const now = new Date('2026-10-01T00:05:00+07:00').getTime();
  t.mock.method(Date, 'now', () => now);
  const origin = 'https://ranking.example', databasePath = join(mkdtempSync(join(tmpdir(), 'sks-ranking-')), 'club.sqlite');
  process.env.SKS_ORIGIN = origin; process.env.SKS_DATABASE_PATH = databasePath;
  const { handleRequest } = await import('../server.mjs');
  const db = new DatabaseSync(databasePath);
  for (const id of ['a','b','c','d','e','f']) {
    db.prepare('INSERT INTO members(id,line_id,nickname) VALUES (?,?,?)').run(id, 'line-' + id, id);
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(id.repeat(43)).digest('hex'), id, now + 3600000);
  }
  async function request(method, url, who = 'a', data, suppliedOrigin = origin) {
    const req = Readable.from(data === undefined ? [] : [Buffer.from(JSON.stringify(data))]);
    req.method = method; req.url = url; req.headers = { 'content-type':'application/json', origin:suppliedOrigin, cookie: who ? 'sks_session=' + who.repeat(43) : '' };
    const result = { status:0, headers:{}, data:null };
    const res = { setHeader(key,value){ result.headers[key.toLowerCase()]=value; }, getHeader(key){ return result.headers[key.toLowerCase()]; }, writeHead(status,headers={}){ result.status=status; for (const [key,value] of Object.entries(headers)) this.setHeader(key,value); }, end(value){ result.data=JSON.parse(value); } };
    await handleRequest(req,res); return result;
  }
  const fields = { title:'นัดทดสอบ', venue:'สนาม', date:'2026-09-30', start:'18:00', end:'20:00', courts:2, courtNames:'1,2', capacity:2 };
  async function event(overrides = {}) {
    const result = await request('POST','/api/events','a',{...fields,...overrides}); assert.equal(result.status,201);
    const path='/api/events/'+result.data.event.id;
    await request('POST',path+'/participants','a',{memberIds:['a','b','c','d']});
    return path;
  }
  const path=await event(), matches=path+'/matches';
  const payload={teamA:['a','b'],teamB:['c','d'],scoreA:4,scoreB:2,requestId:'first_request_123456'};
  assert.equal((await request('GET',matches,'')).status,401);
  assert.equal((await request('POST',matches,'b',payload,'https://other.example')).status,403);
  // Withdrawn and waiting members are eligible; unregistered and guest identities are not.
  // Legacy self-signups may not have a payment row yet; withdrawal must retain their identity.
  db.prepare('DELETE FROM event_payments WHERE event_id=? AND member_id=?').run(path.split('/').at(-1),'c');
  await request('DELETE',path+'/signup','c',{});
  assert.deepEqual((await request('GET',matches)).data.players.map(p=>p.id),['a','b','c','d']);
  const guest=(await request('POST',path+'/participants','a',{nickname:'guest'})).data.event.waitlist.find(p=>p.isGuest);
  for (const invalid of [
    {...payload,teamA:['a','a']}, {...payload,teamA:['a']}, {...payload,teamB:['c','e']},
    {...payload,teamB:['c',guest.id]}, {...payload,scoreA:4,scoreB:3}, {...payload,scoreA:'4'}, {...payload,scoreA:6}, {...payload,requestId:'bad'}
  ]) assert.equal((await request('POST',matches,'b',invalid)).status,400);
  const created=await request('POST',matches,'b',payload); assert.equal(created.status,201);
  const match=created.data.matches[0]; assert.equal(match.createdBy.id,'b'); assert.equal(match.canEdit,true);
  assert.equal((await request('GET',matches,'f')).data.matches[0].canEdit,false);
  assert.equal((await request('POST',matches,'b',payload)).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM matches').get().n,1);
  assert.equal((await request('POST',matches,'b',{...payload,scoreB:1})).status,409);
  const mirrored={teamA:['d','c'],teamB:['b','a'],scoreA:2,scoreB:4,requestId:'mirrored_request_123'};
  const duplicate=await request('POST',matches,'e',mirrored);
  assert.equal(duplicate.status,409); assert.equal(duplicate.data.code,'duplicate-match');
  const rematch=await request('POST',matches,'e',{...mirrored,confirmDuplicate:true}); assert.equal(rematch.status,201);
  assert.equal(rematch.data.matches.length,2);
  let board=(await request('GET','/api/ranking?month=2026-09')).data;
  assert.deepEqual(board.standings.map(p=>[p.id,p.rank,p.points,p.played,p.wins,p.draws,p.losses,p.winPercent]),[
    ['a',1,6,2,2,0,0,100],['b',1,6,2,2,0,0,100],['c',3,0,2,0,0,2,0],['d',3,0,2,0,0,2,0]
  ]);
  assert.equal((await request('GET','/api/ranking?month=2026-09','f')).data.mine,null);
  assert.equal((await request('GET','/api/ranking?month=2026-13')).status,400);
  assert.equal((await request('GET','/api/ranking','')).status,401);
  assert.equal((await request('GET','/api/ranking')).data.month,'2026-10');
  assert.equal((await request('GET','/api/ranking?month=2026-10')).data.standings.length,0);
  assert.equal((await request('PATCH',path,'a',{...fields,date:'2026-10-01'})).status,409);
  assert.equal((await request('PATCH',path,'a',{...fields,title:'แก้ชื่อได้'})).status,200);
  assert.equal((await request('GET',path)).data.event.dateLocked,true);
  assert.equal((await request('PATCH',matches+'/'+match.id,'f',{...payload,version:1})).status,403);
  assert.equal((await request('DELETE',matches+'/'+match.id,'f',{version:1})).status,403);
  assert.equal((await request('PATCH',matches+'/'+match.id,'b',{...payload,scoreA:3,scoreB:3,version:1})).status,200);
  assert.equal((await request('PATCH',matches+'/'+match.id,'b',{...payload,version:1})).status,409);
  board=(await request('GET','/api/ranking?month=2026-09')).data;
  assert.deepEqual(board.standings.map(p=>[p.points,p.wins,p.draws,p.losses,p.winPercent]),[[4,1,1,0,50],[4,1,1,0,50],[1,0,1,1,0],[1,0,1,1,0]]);
  // Correct a player as organizer, moving their points without touching attendance/payment.
  await request('POST',path+'/participants','a',{memberId:'e'});
  assert.equal((await request('PATCH',matches+'/'+match.id,'a',{...payload,teamA:['a','e'],scoreA:3,scoreB:3,version:2})).status,200);
  const amended=(await request('GET',matches)).data.matches.find(m=>m.id===match.id);
  assert.equal(amended.updatedBy.id,'a'); assert.equal(amended.createdBy.id,'b');
  assert.equal((await request('POST',path+'/cancel','a',{})).status,200);
  assert.equal((await request('POST',matches,'b',{...payload,requestId:'new_after_cancel_123'})).status,409);
  assert.equal((await request('GET','/api/ranking?month=2026-09')).data.standings.length,5);
  assert.equal((await request('DELETE',matches+'/'+match.id,'a',{version:3})).status,200);
  assert.equal((await request('GET',matches)).data.matches.find(m=>m.id===match.id).voided,true);
  assert.equal((await request('GET','/api/ranking?month=2026-09','e')).data.mine,null);
  assert.equal((await request('PATCH',path,'a',{...fields,date:'2026-10-01'})).status,409);
  assert.equal((await request('DELETE',matches+'/'+match.id,'b',{version:4})).status,409);
  // The Thai month has begun even though UTC is still September; future start is rejected.
  const october=await event({date:'2026-10-01',start:'00:00',end:'01:00'});
  const future=await event({date:'2026-10-01',start:'01:00',end:'02:00'});
  assert.equal((await request('POST',future+'/matches','b',payload)).status,409);
  assert.equal((await request('GET',future+'/matches')).data.canRecord,false);
  // Every accepted score direction and concurrent double-submit.
  for (const [i,[scoreA,scoreB]] of [[4,0],[4,1],[4,2],[3,3],[0,4],[1,4],[2,4]].entries()) {
    const body={...payload,scoreA,scoreB,requestId:'october_score_request_'+i};
    const responses=await Promise.all([request('POST',october+'/matches','b',body),request('POST',october+'/matches','b',body)]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
  }
  board=(await request('GET','/api/ranking')).data;
  assert.deepEqual(board.standings.map(p=>[p.rank,p.points,p.played,p.wins,p.draws,p.losses]),Array(4).fill([1,10,7,3,1,3]));
  assert.deepEqual(board.months,['2026-10','2026-09']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM matches').get().n,9);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  db.close();
  const restarted=execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(new URL('../server.mjs',import.meta.url).href)}); const {DatabaseSync}=await import('node:sqlite'); const db=new DatabaseSync(process.env.SKS_DATABASE_PATH); console.log(JSON.stringify(db.prepare('SELECT COUNT(*) AS total, SUM(voided) AS voided FROM matches').get())); db.close();`],{env:{...process.env,SKS_DATABASE_PATH:databasePath},encoding:'utf8'});
  assert.deepEqual(JSON.parse(restarted),{total:9,voided:1});
});
