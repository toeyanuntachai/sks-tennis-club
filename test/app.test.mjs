import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('existing members open the shared event after LIFF finishes redirect initialization', async () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const nodes = Object.fromEntries(['app','account','toast','confirm-dialog','share-dialog','dismiss-cancel','confirm-cancel'].map(id => [id, {
    innerHTML:'',setAttribute(){},classList:{add(){},remove(){}},focus(){}
  }]));
  const location = new URL('https://club.example/?liff.state=redirect-state');
  const calls = [];
  const member = {id:'member-1',nickname:'<img src=x onerror=alert(1)>'};
  const event = {
    id:'event-1',title:'นัดที่แชร์',venue:'สนาม',date:'2026-10-10',start:'18:00',end:'20:00',
    courts:2,courtNames:'1, 2',capacity:1,cancelled:false,organizerName:'ผู้จัด',
    confirmed:1,waiting:0,myPosition:1,isOrganizer:false,participants:[{...member,paid:true}],waitlist:[],withdrawn:[]
  };
  const liff = {
    async init({liffId}) {
      assert.equal(liffId,'test-liff'); calls.push('init');
      location.search='?event=event-1&invite=test-invite';
    },
    isLoggedIn(){return true;}
  };
  const context = {
    URL,URLSearchParams,Intl,Date,FormData,setTimeout,clearTimeout,
    setInterval(){},location,liff,window:{liff,scrollTo(){}},
    document:{getElementById(id){return nodes[id] || null;},querySelectorAll(){return [];},addEventListener(){},activeElement:null},
    history:{replaceState(_state,_title,url){location.href=url.href;}},
    async fetch(path) {
      calls.push(path);
      if(path==='/api/config')return Response.json({ready:true,liffId:'test-liff'});
      if(path==='/api/me')return Response.json({member});
      if(path==='/api/events/event-1')return Response.json({event});
      throw new Error('Unexpected route: '+path);
    }
  };
  await runInNewContext(source,context);
  assert.deepEqual(calls,['/api/config','init','/api/me','/api/events/event-1']);
  assert.match(nodes.app.innerHTML,/นัดที่แชร์/);
  assert.match(nodes.app.innerHTML,/ถอนชื่อของฉัน/);
  assert.doesNotMatch(nodes.app.innerHTML,/data-edit|data-cancel|data-payment|<img src=x/);
  assert.match(nodes.app.innerHTML,/จ่ายแล้ว/);
  assert.match(nodes.app.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(location.searchParams.get('event'),'event-1');
  assert.equal(location.searchParams.has('invite'),false);
});

test('organizers mark payments, retain withdrawn names, and recover the checkbox after a failed save', async () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const nodes = Object.fromEntries(['app','account','toast','confirm-dialog','share-dialog','dismiss-cancel','confirm-cancel'].map(id => [id, {
    innerHTML:'',setAttribute(){},classList:{add(){},remove(){}},focus(){}
  }]));
  const location = new URL('https://club.example/?event=event-1');
  const member = {id:'organizer',nickname:'ผู้จัด'};
  const event = {
    id:'event-1',title:'นัดตี',venue:'สนาม',date:'2026-10-10',start:'18:00',end:'20:00',
    courts:2,courtNames:'1, 2',capacity:1,cancelled:false,organizerName:'ผู้จัด',
    confirmed:1,waiting:1,myPosition:null,isOrganizer:true,
    participants:[{id:'member-1',nickname:'ต้น',paid:false}],
    waitlist:[{id:'member-2',nickname:'เมย์',paid:true}],
    withdrawn:[{id:'member-3',nickname:'โบว์',paid:true}]
  };
  const handlers = {}, requests = [];
  const context = {
    URL,URLSearchParams,Intl,Date,FormData,setTimeout(){},clearTimeout(){},setInterval(){},location,window:{scrollTo(){}},
    document:{getElementById(id){return nodes[id] || null;},querySelectorAll(){return [];},addEventListener(type,handler){handlers[type]=handler;},activeElement:null},
    history:{replaceState(_state,_title,url){location.href=url.href;}},
    async fetch(path,options) {
      if(path==='/api/config')return Response.json({ready:false,liffId:''});
      if(path==='/api/me')return Response.json({member});
      if(path==='/api/events/event-1')return Response.json({event});
      assert.equal(path,'/api/events/event-1/payment');
      assert.equal(options.method,'PATCH');
      const data=JSON.parse(options.body);requests.push(data);
      if(requests.length===2)return Response.json({message:'บันทึกไม่สำเร็จ'}, {status:500});
      event.participants[0].paid=data.paid;
      return Response.json({event});
    }
  };
  await runInNewContext(source,context);
  assert.match(nodes.app.innerHTML,/ถอนชื่อแล้ว · 1 คน/);
  assert.match(nodes.app.innerHTML,/id="payment-member-2"[^>]+checked/);
  const input={hasAttribute(name){return name==='data-payment';},dataset:{payment:'member-1'},checked:true};
  await handlers.change({target:input});
  assert.deepEqual(requests[0],{memberId:'member-1',paid:true});
  assert.match(nodes.app.innerHTML,/id="payment-member-1"[^>]+checked/);
  input.checked=false;
  await handlers.change({target:input});
  assert.match(nodes.app.innerHTML,/id="payment-member-1"[^>]+checked/);
  assert.equal(nodes.toast.textContent,'บันทึกไม่สำเร็จ');
  event.cancelled=true;
  await runInNewContext('refresh()',context);
  assert.doesNotMatch(nodes.app.innerHTML,/data-payment/);
});
