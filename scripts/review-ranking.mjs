// Local review fixture only. Uses a fresh temporary database and binds to loopback.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = 4399;
const origin = 'http://127.0.0.1:' + port;
process.env.SKS_ORIGIN = origin;
process.env.SKS_DATABASE_PATH = join(mkdtempSync(join(tmpdir(), 'sks-ranking-review-')), 'review.sqlite');
process.env.LINE_LOGIN_CHANNEL_ID = ''; process.env.LINE_LIFF_ID = ''; process.env.SKS_INVITE_CODE = '';
const { handleRequest } = await import('../server.mjs');
const db = new DatabaseSync(process.env.SKS_DATABASE_PATH);
const ids = ['ต้น', 'เมย์', 'โบว์', 'บอย', 'นัท'].map(nickname => {
  const id = randomUUID(); db.prepare('INSERT INTO members(id,line_id,nickname) VALUES (?,?,?)').run(id, 'review-' + id, nickname); return id;
});
const token = randomBytes(32).toString('base64url'), hash = createHash('sha256').update(token).digest('hex');
const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()).map(p=>[p.type,p.value]));
const date = `${parts.year}-${parts.month}-${parts.day}`;
const previous = new Date(Number(parts.year), Number(parts.month)-2, 15);
const previousDate = previous.getFullYear() + '-' + String(previous.getMonth()+1).padStart(2,'0') + '-15';
function addEvent(day, title) {
  const id=randomUUID();
  db.prepare(`INSERT INTO events(id,organizer_id,title,venue,date,start,end,courts,court_names,capacity,court_cost_satang,ball_cost_satang)
    VALUES (?,?,?,?,?,'00:00','23:59',2,'คอร์ต 1, 2',4,120000,24000)`).run(id,ids[0],title,'สนามทดลอง SKS',day);
  for (const [i,member] of ids.entries()) {
    db.prepare('INSERT INTO registrations(event_id,member_id) VALUES (?,?)').run(id,member);
    db.prepare('INSERT INTO event_payments VALUES (?,?,?)').run(id,member,i<2?1:0);
  }
  return id;
}
const todayEvent=addEvent(date,'ทดลอง Ranking · นัดวันนี้'), oldEvent=addEvent(previousDate,'ทดลอง Ranking · เดือนก่อน');
const now=Date.now();
function result(event, players, a, b, offset) {
  const signature=JSON.stringify([{players:players.slice(0,2).sort(),score:a},{players:players.slice(2).sort(),score:b}].sort((x,y)=>x.players.join(',').localeCompare(y.players.join(','))));
  db.prepare(`INSERT INTO matches(id,event_id,player1,player2,player3,player4,score_a,score_b,signature,request_id,created_by,created_at,updated_by,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(),event,...players,a,b,signature,randomUUID(),ids[0],now-offset,ids[0],now-offset);
}
result(todayEvent,ids.slice(0,4),4,2,3000);
result(todayEvent,[ids[0],ids[2],ids[1],ids[3]],1,4,2000);
result(todayEvent,[ids[0],ids[3],ids[1],ids[2]],3,3,1000);
result(oldEvent,ids.slice(0,4),4,0,4000);
createServer((req,res) => {
  if (new URL(req.url,origin).pathname === '/') {
    db.prepare('INSERT INTO sessions VALUES (?,?,?) ON CONFLICT(token_hash) DO UPDATE SET expires=excluded.expires').run(hash,ids[0],Date.now()+86400000);
    res.setHeader('Set-Cookie',`sks_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  }
  void handleRequest(req,res);
}).listen(port,'127.0.0.1',()=>console.log('Ranking review (sample data only): ' + origin + '/?event=' + todayEvent));
