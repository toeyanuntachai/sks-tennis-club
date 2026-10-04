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
  assert.doesNotMatch(nodes.app.innerHTML,/data-edit|data-cancel|data-payment|data-add-participant|data-remove-participant|data-link-participant|<img src=x/);
  assert.match(nodes.app.innerHTML,/จ่ายแล้ว/);
  assert.match(nodes.app.innerHTML,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(location.searchParams.get('event'),'event-1');
  assert.equal(location.searchParams.has('invite'),false);
});

test('organizer forms add names, retain input after save failure, and expose restore and link actions', async () => {
  const nodes=Object.fromEntries(['app','account','toast','confirm-dialog','share-dialog','dismiss-cancel','confirm-cancel','participant-dialog','participant-content','participant-error','remove-name','remove-participant-dialog','remove-participant-error','remove-participant-confirm'].map(id=>[id,{
    innerHTML:'',open:false,dataset:{},setAttribute(){},classList:{add(){},remove(){}},focus(){},showModal(){this.open=true;},close(){this.open=false;}
  }]));
  const handlers={}, requests=[], location=new URL('https://club.example/?event=e');
  const member={id:'owner',nickname:'ผู้จัด'};
  const guest={id:'guest',nickname:'เพื่อน <ใหม่>',isGuest:true,paid:true};
  const event={id:'e',title:'นัด',venue:'สนาม',date:'2026-10-10',start:'18:00',end:'20:00',courts:2,courtNames:'1,2',capacity:1,cancelled:false,organizerName:'ผู้จัด',confirmed:1,waiting:0,myPosition:null,isOrganizer:true,participants:[guest],waitlist:[],withdrawn:[{id:'withdrawn',nickname:'ถอน',isGuest:false,paid:true}]};
  let failSave=true;
  const context={
    URL,URLSearchParams,Intl,Date,setTimeout(){},clearTimeout(){},setInterval(){},location,window:{scrollTo(){}},
    FormData:class {constructor(form){this.fields=form.fields;}[Symbol.iterator](){return Object.entries(this.fields)[Symbol.iterator]();}},
    document:{getElementById(id){return nodes[id]||null;},querySelectorAll(){return [];},addEventListener(type,fn){handlers[type]=fn;},activeElement:null},
    history:{replaceState(_state,_title,url){location.href=url.href;}},
    async fetch(path,options) {
      if(path==='/api/config')return Response.json({ready:false});
      if(path==='/api/me')return Response.json({member});
      if(path==='/api/events/e')return Response.json({event});
      if(path==='/api/events/e/available-members')return Response.json({members:[{id:'registered',nickname:'สมาชิก <หนึ่ง>'}]});
      requests.push({path,method:options.method,data:JSON.parse(options.body)});
      if(failSave)return Response.json({message:'บันทึกไม่สำเร็จ'}, {status:500});
      return Response.json({event});
    }
  };
  await runInNewContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
  const click=(attribute,dataset={},id='')=>handlers.click({target:{closest(){return {id,dataset,hasAttribute(name){return name===attribute;}};}}});
  assert.match(nodes.app.innerHTML,/เพิ่มโดยผู้จัด/);
  assert.match(nodes.app.innerHTML,/data-restore-participant="withdrawn"/);
  await click('data-add-participant');
  assert.equal(nodes['participant-dialog'].open,true);
  assert.match(nodes['participant-content'].innerHTML,/สมาชิก &lt;หนึ่ง&gt;/);
  handlers.change({target:{id:'participant-mode',value:'name'}});
  assert.match(nodes['participant-content'].innerHTML,/name="nickname"/);
  const submit=()=>handlers.submit({target:{id:'participant-form',fields:{nickname:'เพื่อนใหม่'}},preventDefault(){}});
  await submit();
  assert.equal(nodes['participant-dialog'].open,true);
  assert.equal(nodes.toast.textContent,'บันทึกไม่สำเร็จ');
  assert.equal(nodes['participant-error'].textContent,'บันทึกไม่สำเร็จ');
  assert.match(nodes['participant-content'].innerHTML,/name="nickname"/);
  failSave=false;await submit();
  assert.equal(nodes['participant-dialog'].open,false);
  assert.deepEqual(requests.at(-1),{path:'/api/events/e/participants',method:'POST',data:{nickname:'เพื่อนใหม่'}});
  await click('',{linkParticipant:'guest'});
  assert.match(nodes['participant-content'].innerHTML,/ผูกบัญชีให้ เพื่อน &lt;ใหม่&gt;/);
  assert.match(nodes['participant-content'].innerHTML,/ใช้คิวที่ลงก่อน/);
  await handlers.submit({target:{id:'participant-form',fields:{memberId:'registered'}},preventDefault(){}});
  assert.deepEqual(requests.at(-1),{path:'/api/events/e/participants/guest',method:'PATCH',data:{memberId:'registered'}});
  await click('',{restoreParticipant:'withdrawn'});
  assert.deepEqual(requests.at(-1),{path:'/api/events/e/participants',method:'POST',data:{memberId:'withdrawn'}});
  await click('',{removeParticipant:'guest'});
  assert.equal(nodes['remove-name'].textContent,guest.nickname);
  assert.equal(nodes['remove-participant-dialog'].open,true);
  await click('',nodes['remove-participant-confirm'].dataset,'remove-participant-confirm');
  assert.deepEqual(requests.at(-1),{path:'/api/events/e/participants/guest',method:'DELETE',data:{}});
  event.cancelled=true;await runInNewContext('refresh()',context);
  assert.doesNotMatch(nodes.app.innerHTML,/data-add-participant|data-restore-participant|data-remove-participant|data-link-participant/);
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

test('optional cost and QR forms retain drafts on failure, save satang, clear QR, and expand it for members', async () => {
  const nodes=Object.fromEntries(['app','account','toast','confirm-dialog','share-dialog','dismiss-cancel','confirm-cancel','event-error','payment-qr-file','payment-qr-preview','payment-qr-dialog','payment-qr-large'].map(id=>[id,{
    innerHTML:'',value:'',open:false,setAttribute(){},classList:{add(){},remove(){}},focus(){},showModal(){this.open=true;},close(){this.open=false;}
  }]));
  const handlers={}, requests=[], location=new URL('https://club.example/?event=e');
  const member={id:'owner',nickname:'ผู้จัด'};
  const event={id:'e',title:'นัด',venue:'สนาม',date:'2026-10-10',start:'18:00',end:'20:00',courts:2,courtNames:'1,2',capacity:3,cancelled:false,organizerName:'ผู้จัด',confirmed:2,waiting:1,myPosition:null,isOrganizer:true,participants:[],waitlist:[],withdrawn:[],courtCostSatang:100000,ballCostSatang:null,totalCostSatang:100000,sharePeople:2,sharePerPersonSatang:50000,roundingSurplusSatang:0,hasPaymentQr:true};
  const png=readFileSync(new URL('../public/sks-logo.png',import.meta.url)).toString('base64');
  let failSave=true;
  const context={
    URL,URLSearchParams,Intl,Date,setTimeout(){},clearTimeout(){},setInterval(){},location,window:{scrollTo(){}},
    FormData:class {constructor(form){this.fields=form.fields;}[Symbol.iterator](){return Object.entries(this.fields)[Symbol.iterator]();}},
    FileReader:class {readAsDataURL(){this.result='data:image/png;base64,'+png;this.onload();}},
    Image:class {async decode(){}},
    document:{getElementById(id){return nodes[id]||null;},querySelectorAll(){return [];},addEventListener(type,fn){handlers[type]=fn;},activeElement:null},
    history:{replaceState(_state,_title,url){location.href=url.href;}},
    async fetch(path,options) {
      if(path==='/api/config')return Response.json({ready:false});
      if(path==='/api/me')return Response.json({member});
      if(options.method==='GET'&&path==='/api/events/e')return Response.json({event});
      assert.equal(path,'/api/events/e');assert.equal(options.method,'PATCH');
      const data=JSON.parse(options.body);requests.push(data);
      if(failSave)return Response.json({message:'บันทึกไม่สำเร็จ'}, {status:500});
      Object.assign(event,{courtCostSatang:data.courtCostSatang,ballCostSatang:data.ballCostSatang,hasPaymentQr:data.paymentQr!==null,totalCostSatang:data.courtCostSatang+data.ballCostSatang,sharePerPersonSatang:21300,roundingSurplusSatang:50});
      return Response.json({event});
    }
  };
  await runInNewContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
  assert.match(nodes.app.innerHTML,/500 <span[^>]*>บาท\/คน/);
  assert.match(nodes.app.innerHTML,/หารผู้ได้ที่ในนัด 2 คน/);
  const click=attribute=>handlers.click({target:{closest(){return {dataset:{},hasAttribute(name){return name===attribute;}};}}});
  await click('data-expand-qr');assert.equal(nodes['payment-qr-dialog'].open,true);assert.equal(nodes['payment-qr-large'].src,'/api/events/e/payment-qr');
  await click('data-edit');
  assert.doesNotMatch(nodes.app.innerHTML,/name="(?:courtCost|ballCost)"[^>]*required/);
  assert.match(nodes.app.innerHTML,/ตัวอย่าง QR จ่ายเงิน/);
  await handlers.change({target:{id:'payment-qr-file',files:[{size:100,type:'image/png'}]}});
  assert.match(nodes['payment-qr-preview'].innerHTML,/data:image\/png;base64/);
  const originalForm=nodes.app.innerHTML;
  const fields={title:'แก้ค่า',venue:'สนาม',date:'2026-10-10',start:'18:00',end:'20:00',courts:'2',courtNames:'1,2',capacity:'3',courtCost:'125.50',ballCost:'300'};
  const submit=values=>handlers.submit({target:{id:'event-form',fields:values},preventDefault(){}});
  await submit(fields);
  assert.equal(nodes['event-error'].textContent,'บันทึกไม่สำเร็จ');assert.equal(nodes.app.innerHTML,originalForm);
  assert.equal(requests.at(-1).courtCostSatang,12550);assert.equal(requests.at(-1).ballCostSatang,30000);assert.equal(requests.at(-1).paymentQr,png);
  await submit({...fields,courtCost:'-1'});assert.equal(requests.length,1);
  failSave=false;await submit(fields);assert.equal(requests.length,2);assert.equal(requests.at(-1).paymentQr,png);
  assert.match(nodes.app.innerHTML,/213 <span[^>]*>บาท\/คน/);
  await click('data-edit');await submit({...fields,courtCost:'',ballCost:'0'});
  assert.equal(Object.hasOwn(requests.at(-1),'paymentQr'),false);assert.equal(requests.at(-1).courtCostSatang,null);assert.equal(requests.at(-1).ballCostSatang,0);
  await click('data-edit');await click('data-remove-qr');await submit({...fields,courtCost:'',ballCost:''});
  assert.equal(requests.at(-1).paymentQr,null);
  event.totalCostSatang=null;event.hasPaymentQr=false;await runInNewContext('refresh()',context);
  assert.doesNotMatch(nodes.app.innerHTML,/ค่าใช้จ่ายและการจ่ายเงิน/);
  event.totalCostSatang=100000;event.sharePerPersonSatang=null;event.sharePeople=0;event.hasPaymentQr=true;event.isOrganizer=false;
  await runInNewContext('refresh()',context);
  assert.match(nodes.app.innerHTML,/รอผู้เข้าร่วมเพื่อคำนวณยอดต่อคน/);assert.match(nodes.app.innerHTML,/data-expand-qr/);assert.doesNotMatch(nodes.app.innerHTML,/data-edit/);
});
