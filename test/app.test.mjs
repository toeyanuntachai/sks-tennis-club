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
    confirmed:1,waiting:0,myPosition:1,isOrganizer:false,participants:[member],waitlist:[]
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
  assert.doesNotMatch(nodes.app.innerHTML,/data-edit|data-cancel|<img src=x/);
  assert.match(nodes.app.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(location.searchParams.get('event'),'event-1');
  assert.equal(location.searchParams.has('invite'),false);
});
