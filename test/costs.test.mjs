import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

test('optional costs and QR save atomically, follow confirmed attendance, and obey organizer permissions', async t => {
  const origin='https://club.example';
  process.env.SKS_ORIGIN=origin;
  process.env.SKS_DATABASE_PATH=join(mkdtempSync(join(tmpdir(),'sks-costs-')),'club.sqlite');
  const {handleRequest}=await import('../server.mjs');
  const db=new DatabaseSync(process.env.SKS_DATABASE_PATH);
  const cookies={};
  for(const id of ['owner','other','third']) {
    db.prepare('INSERT INTO members(id,line_id,nickname) VALUES (?,?,?)').run(id,'line-'+id,id);
    const token=createHash('sha256').update(id).digest('base64url');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+600000);
    cookies[id]='sks_session='+token;
  }
  async function request(method,url,who='owner',data,suppliedOrigin=origin) {
    const req=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);
    Object.assign(req,{method,url,headers:{'content-type':'application/json',origin:suppliedOrigin,cookie:cookies[who]||''}});
    const result={headers:{}};
    await handleRequest(req,{
      setHeader(key,value){result.headers[key.toLowerCase()]=value;},
      writeHead(status,headers){result.status=status;for(const [key,value] of Object.entries(headers||{}))this.setHeader(key,value);},
      end(bytes){result.bytes=Buffer.from(bytes);}
    });
    if(result.headers['content-type']?.startsWith('application/json'))result.data=JSON.parse(result.bytes.toString());
    return result;
  }
  const fields={title:'นัดทดสอบ',venue:'สนาม',date:'2026-10-10',start:'18:00',end:'20:00',courts:2,courtNames:'1,2',capacity:3};
  const png=readFileSync(new URL('../public/sks-logo.png',import.meta.url)), paymentQr=png.toString('base64');
  assert.ok(png.length>16384);
  let response=await request('POST','/api/events','owner',fields);
  const emptyPath='/api/events/'+response.data.event.id;
  assert.equal(response.status,201);
  for(const key of ['courtCostSatang','ballCostSatang','totalCostSatang','sharePerPersonSatang','roundingSurplusSatang'])assert.equal(response.data.event[key],null);
  assert.equal(response.data.event.hasPaymentQr,false);
  assert.equal((await request('GET',emptyPath+'/payment-qr','')).status,401);
  assert.equal((await request('GET',emptyPath+'/payment-qr')).status,404);
  for(const data of [{courtCostSatang:0},{ballCostSatang:12345},{paymentQr}]) {
    response=await request('POST','/api/events','owner',{...fields,...data});
    assert.equal(response.status,201);
    assert.equal(response.data.event.sharePerPersonSatang,null);
    if(data.paymentQr)assert.equal(response.data.event.totalCostSatang,null);
    else assert.equal(response.data.event.totalCostSatang,Object.values(data)[0]);
  }
  for(const value of [-1,1.5,'123',Number.MAX_SAFE_INTEGER]) {
    assert.equal((await request('POST','/api/events','owner',{...fields,courtCostSatang:value})).status,400);
  }
  for(const value of [Buffer.from('<svg></svg>').toString('base64'),'bad base64',png.subarray(0,40).toString('base64')]) {
    assert.equal((await request('POST','/api/events','owner',{...fields,paymentQr:value})).status,400);
  }
  assert.equal((await request('POST','/api/events','owner',{...fields,paymentQr:Buffer.alloc(2*1024*1024+1).toString('base64')})).status,413);
  assert.equal((await request('POST','/api/events','owner',{...fields,paymentQr:'x'.repeat(3*1024*1024)})).status,413);
  response=await request('POST','/api/events','owner',{...fields,courtCostSatang:90000,ballCostSatang:10000,paymentQr});
  const path='/api/events/'+response.data.event.id;
  assert.equal(response.data.event.totalCostSatang,100000);
  assert.equal(response.data.event.sharePeople,0);
  assert.equal(response.data.event.hasPaymentQr,true);
  assert.deepEqual((await request('GET',path+'/payment-qr','other')).bytes,png);
  assert.equal((await request('GET',path+'/payment-qr')).headers['content-type'],'image/png');
  assert.equal((await request('PATCH',path,'other',{...fields,courtCostSatang:0,paymentQr:null})).status,403);
  assert.equal((await request('PATCH',path,'owner',{...fields,paymentQr:null},'https://other.example')).status,403);
  for(const memberId of ['owner','other'])await request('POST',path+'/participants','owner',{memberId});
  let event=(await request('POST',path+'/participants','owner',{nickname:'เพื่อนที่ไม่มีบัญชี'})).data.event;
  const guest=event.participants[2];
  assert.equal(event.sharePeople,3);assert.equal(event.sharePerPersonSatang,33400);assert.equal(event.roundingSurplusSatang,200);
  event=(await request('POST',path+'/participants','owner',{memberId:'third'})).data.event;
  assert.equal(event.sharePeople,3);assert.equal(event.sharePerPersonSatang,33400);
  await request('PATCH',path+'/payment','owner',{memberId:guest.id,paid:true});
  // Merging duplicate seats reduces the divisor only after the queue has promoted normally.
  event=(await request('PATCH',path+'/participants/'+guest.id,'owner',{memberId:'other'})).data.event;
  assert.equal(event.sharePeople,3);assert.equal(event.waiting,0);assert.equal(event.participants.find(p=>p.id==='other').paid,true);
  event=(await request('DELETE',path+'/participants/third','owner',{})).data.event;
  assert.equal(event.sharePeople,2);assert.equal(event.sharePerPersonSatang,50000);
  event=(await request('POST',path+'/participants','owner',{memberId:'third'})).data.event;
  assert.equal(event.sharePerPersonSatang,33400);
  await request('DELETE',path+'/participants/third','owner',{});
  event=(await request('POST',path+'/participants','owner',{nickname:'ซ้ำอีกครั้ง'})).data.event;
  const duplicate=event.participants[2];
  event=(await request('PATCH',path+'/participants/'+duplicate.id,'owner',{memberId:'other'})).data.event;
  assert.equal(event.sharePeople,2);assert.equal(event.sharePerPersonSatang,50000);
  assert.equal(event.participants.find(p=>p.id==='other').paid,true);
  event=(await request('PATCH',path,'owner',{...fields,title:'แก้ชื่ออย่างเดียว'})).data.event;
  assert.equal(event.courtCostSatang,90000);assert.equal(event.ballCostSatang,10000);assert.equal(event.hasPaymentQr,true);
  assert.deepEqual((await request('GET',path+'/payment-qr')).bytes,png);
  // A forced storage failure rolls back both event details and QR changes.
  t.mock.method(console,'error',()=>{});
  db.exec("CREATE TRIGGER fail_qr_insert BEFORE INSERT ON event_payment_qr BEGIN SELECT RAISE(ABORT,'fixture write failure'); END;");
  const count=db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
  assert.equal((await request('POST','/api/events','owner',{...fields,paymentQr})).status,500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n,count);
  assert.equal((await request('PATCH',path,'owner',{...fields,title:'ต้องไม่ถูกบันทึก',courtCostSatang:1,paymentQr})).status,500);
  event=(await request('GET',path)).data.event;
  assert.equal(event.title,'แก้ชื่ออย่างเดียว');assert.equal(event.courtCostSatang,90000);
  assert.deepEqual((await request('GET',path+'/payment-qr')).bytes,png);
  db.exec('DROP TRIGGER fail_qr_insert');
  event=(await request('PATCH',path,'owner',{...fields,courtCostSatang:12550,ballCostSatang:null,paymentQr:null})).data.event;
  assert.equal(event.totalCostSatang,12550);assert.equal(event.sharePerPersonSatang,6300);assert.equal(event.roundingSurplusSatang,50);
  assert.equal(event.hasPaymentQr,false);assert.equal((await request('GET',path+'/payment-qr')).status,404);
  // MIME type is inferred from bytes, with no user-supplied file path or MIME trusted.
  const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==','base64');
  event=(await request('PATCH',path,'owner',{...fields,paymentQr:jpeg.toString('base64'),courtCostSatang:null,ballCostSatang:null})).data.event;
  assert.equal(event.totalCostSatang,null);assert.equal(event.hasPaymentQr,true);
  const image=await request('GET',path+'/payment-qr');
  assert.equal(image.headers['content-type'],'image/jpeg');assert.deepEqual(image.bytes,jpeg);
  const list=(await request('GET','/api/events')).data.events;
  assert.equal(list.some(e=>Object.hasOwn(e,'paymentQr')||Object.hasOwn(e,'image')),false);
  assert.equal((await request('PATCH',path+'/payment','owner',{memberId:'other',paid:false,padding:'x'.repeat(17000)})).status,413);
  await request('POST',path+'/cancel','owner',{});
  assert.equal((await request('PATCH',path,'owner',{...fields,paymentQr:null,courtCostSatang:0})).status,409);
  assert.equal((await request('GET',path+'/payment-qr','other')).status,200);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  db.close();
});
