const app = document.getElementById('app'), account = document.getElementById('account');
const params = new URLSearchParams(location.search);
let invite = params.get('invite') || '', requestedEvent = params.get('event');
let config, member = null, events = [], selected = null, screen = 'welcome', busy = false, toastTimer, suggestedNickname = '', liffReady;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const dateLabel = value => new Intl.DateTimeFormat('th-TH', { weekday:'short', day:'numeric', month:'short' }).format(new Date(value + 'T12:00:00'));
const today = () => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p => [p.type,p.value]));
  return parts.year+'-'+parts.month+'-'+parts.day;
};
async function api(path, method = 'GET', data) {
  const response = await fetch('/api' + path, {
    method, credentials:'same-origin', headers:{'Content-Type':'application/json'},
    ...(data === undefined ? {} : {body:JSON.stringify(data)})
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message || 'โหลดข้อมูลไม่สำเร็จ'), {status:response.status});
  return result;
}
function notify(message) {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 6000);
}
async function run(work) {
  if (busy) return;
  busy = true;
  app.setAttribute('aria-busy', 'true');
  const controls = [...document.querySelectorAll('button,input')].map(el => ({el, disabled:el.disabled}));
  controls.forEach(({el}) => el.disabled = true);
  try { await work(); }
  catch (error) {
    if (error.status === 401 || !member) {member = null; screen = 'welcome'; render();}
    notify(error.message);
  } finally {
    controls.forEach(({el, disabled}) => el.disabled = disabled);
    busy = false;
    app.setAttribute('aria-busy', 'false');
  }
}
function badge(event) {
  if (event.cancelled) return '<span class="badge bg-stone-200 text-stone-600">ยกเลิกแล้ว</span>';
  if (event.myPosition > event.capacity) return '<span class="badge bg-amber-100 text-amber">คุณอยู่คิวสำรอง '+(event.myPosition-event.capacity)+'</span>';
  if (event.myPosition) return '<span class="badge">คุณลงชื่อแล้ว</span>';
  return event.confirmed >= event.capacity ? '<span class="badge bg-amber-100 text-amber">เต็ม · มีคิวสำรอง</span>' : '<span class="badge">ว่าง '+(event.capacity-event.confirmed)+' ที่</span>';
}
function renderWelcome() {
  return '<section class="mx-auto max-w-xl rounded-3xl border border-line bg-surface px-6 py-10 text-center sm:px-10 sm:py-14">'+
    '<img src="/sks-logo.png" alt="" width="112" height="112" class="mx-auto mb-6 size-28 rounded-full">'+
    '<p class="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-leaf">SKS Tennis Club</p>'+
    '<h1 id="page-title" tabindex="-1" class="mb-4 text-3xl font-bold sm:text-4xl">นัดตีครั้งหน้า<br>เจอกันที่คอร์ต</h1>'+
    '<p class="mb-8 text-muted">ดูนัดของกลุ่ม ลงชื่อเล่นทั้งนัด<br>ถ้าเต็มก็เข้าคิวสำรองได้</p>'+
    (config?.ready ? '<button id="login-button" data-login class="btn btn-primary w-full">เข้าใช้งานผ่าน LINE</button><p class="mt-4 text-xs text-muted">สมาชิกใหม่เข้าร่วมผ่านลิงก์เชิญจากกลุ่ม</p>' : '<p class="rounded-xl bg-sage p-4 text-sm text-leaf">กำลังเตรียมเปิดใช้งาน<br>ผู้จัดกลุ่มจะแชร์ลิงก์เมื่อพร้อมครับ</p>')+
    '</section>';
}
function renderList() {
  const active = events.filter(e => !e.cancelled), cancelled = events.filter(e => e.cancelled);
  function rows(list) {
    return list.map(e => '<article class="flex flex-wrap items-center gap-4 border-b border-line py-5 last:border-0">'+
      '<div class="w-14 shrink-0 rounded-xl bg-sage py-2 text-center"><b class="block text-2xl">'+new Date(e.date+'T12:00:00').getDate()+'</b><small>'+new Intl.DateTimeFormat('th-TH',{month:'short'}).format(new Date(e.date+'T12:00:00'))+'</small></div>'+
      '<div class="min-w-40 flex-1">'+badge(e)+'<h2 class="mt-2 text-lg font-bold">'+esc(e.title)+'</h2><p class="text-sm text-muted">'+dateLabel(e.date)+' · '+e.start+'–'+e.end+' · '+e.courts+' คอร์ต</p><p class="text-sm text-muted">'+esc(e.venue)+'</p></div>'+
      '<div class="ml-18 text-sm sm:ml-0">'+e.confirmed+' / '+e.capacity+' คน'+(e.waiting?'<br><span class="text-muted">สำรอง '+e.waiting+' คน</span>':'')+'</div>'+
      '<button id="event-'+esc(e.id)+'" data-go="'+esc(e.id)+'" class="btn ml-auto">ดูนัด →</button></article>').join('');
  }
  return '<div class="mb-6 flex items-start justify-between gap-4"><div><p class="mb-2 text-xs font-semibold tracking-wide text-muted">จองคอร์ตแล้ว นัดเพื่อนได้เลย</p><h1 id="page-title" tabindex="-1" class="text-3xl font-bold">นัดตีของกลุ่ม</h1><p class="mt-2 text-muted">ลงชื่อครั้งเดียว เจอกันทั้งนัด</p></div><button id="create-button" data-create class="btn btn-primary shrink-0">+ เปิดนัด</button></div>'+
    '<div class="mb-4 flex justify-end"><button id="refresh-button" data-refresh class="text-sm underline underline-offset-4">อัปเดตรายชื่อ</button></div>'+
    (active.length?'<section class="panel py-0">'+rows(active)+'</section>':'<section class="panel py-12 text-center"><h2 class="mb-2 text-lg font-bold">ยังไม่มีนัดที่เปิดอยู่</h2><p class="text-muted">จองคอร์ตแล้วกด “เปิดนัด” เพื่อชวนเพื่อนลงชื่อได้เลย</p></section>')+
    (cancelled.length?'<details class="mt-6"><summary class="cursor-pointer text-sm text-muted">นัดที่ยกเลิก · '+cancelled.length+' นัด</summary><section class="panel mt-3 py-0">'+rows(cancelled)+'</section></details>':'');
}
function roster(people, waiting = false) {
  return people.length?'<ol class="divide-y divide-line">'+people.map((p,i)=>'<li class="flex items-center gap-3 py-3"><span class="grid size-9 shrink-0 place-items-center rounded-full bg-sage text-sm">'+(waiting?i+1:esc(p.nickname?.slice(0,1)))+'</span><span>'+esc(p.nickname)+'</span>'+(p.id===member.id?'<span class="ml-auto text-xs font-semibold text-leaf">คุณ</span>':'')+'</li>').join('')+'</ol>':'<p class="py-3 text-muted">ยังไม่มีรายชื่อ</p>';
}
function renderDetail(e) {
  const status = !e.myPosition ? 'ยังไม่ได้ลงชื่อ' : e.myPosition <= e.capacity ? 'คุณได้ที่ในนัดนี้แล้ว' : 'คุณอยู่คิวสำรองลำดับ '+(e.myPosition-e.capacity);
  const fact=(label,value)=>'<div><dt class="text-sm text-muted">'+label+'</dt><dd class="mt-1 font-semibold">'+esc(value)+'</dd></div>';
  return '<button id="back-link" data-list class="mb-6 min-h-11 text-sm font-semibold">← นัดทั้งหมด</button>'+
    '<div class="mb-5 grid gap-5 md:grid-cols-[1.4fr_1fr]"><section class="panel">'+badge(e)+'<h1 id="page-title" tabindex="-1" class="my-4 text-3xl font-bold">'+esc(e.title)+'</h1><p>'+esc(e.venue)+'</p><dl class="mt-6 grid grid-cols-2 gap-5">'+fact('วันตี',dateLabel(e.date))+fact('เวลา',e.start+'–'+e.end)+fact('คอร์ตที่จอง',e.courtNames)+fact('ผู้จัดนัด',e.organizerName)+'</dl></section>'+
    '<aside class="panel flex flex-col justify-center bg-sage"><p class="text-xs font-semibold tracking-wide text-leaf">ลงชื่อทั้งนัด</p><p class="my-3 text-5xl font-bold">'+e.confirmed+' <span class="text-xl font-normal">/ '+e.capacity+' คน</span></p><p>คิวสำรอง '+e.waiting+' คน</p><p class="mt-3 font-semibold">'+status+'</p></aside></div>'+
    (e.cancelled?'<p class="mb-5 rounded-xl bg-sage p-4">นัดนี้ยกเลิกแล้ว รายชื่อด้านล่างเป็นประวัติของนัด</p>':'<div class="mb-5 flex flex-wrap gap-3"><button id="signup-button" data-signup class="btn '+(e.myPosition?'btn-danger':'btn-primary')+' flex-1">'+(e.myPosition?'ถอนชื่อของฉัน':e.confirmed>=e.capacity?'เข้าคิวสำรอง':'ลงชื่อนัดนี้')+'</button><button id="share-button" data-share class="btn">แชร์นัดใน LINE</button></div>')+
    '<div class="grid gap-5 md:grid-cols-2"><section class="panel"><h2 class="mb-3 text-xl font-bold">ผู้เข้าร่วม · '+e.confirmed+' คน</h2>'+roster(e.participants)+'</section><section class="panel"><h2 class="mb-3 text-xl font-bold">คิวสำรอง · '+e.waiting+' คน</h2><p class="mb-2 text-sm text-muted">เรียงตามลำดับลงชื่อ คนแรกได้เลื่อนเข้าแทนเมื่อมีคนถอน</p>'+roster(e.waitlist,true)+'</section></div>'+
    (e.isOrganizer&&!e.cancelled?'<div class="mt-6 flex gap-3"><button id="edit-button" data-edit class="btn">แก้ไขนัด</button><button id="cancel-button" data-cancel class="btn btn-danger">ยกเลิกนัด</button></div>':'');
}
function renderForm() {
  const e = selected || {title:'',venue:'',date:today(),start:'18:00',end:'20:00',courts:2,courtNames:'',capacity:12};
  const field=(name,label,type,value,extra='',wide=false)=>'<label class="label '+(wide?'col-span-2':'')+'">'+label+'<input class="field" name="'+name+'" type="'+type+'" value="'+esc(value)+'" required '+extra+'></label>';
  return '<section class="mx-auto max-w-2xl"><button data-back class="mb-6 min-h-11 text-sm font-semibold">← กลับ</button><h1 id="page-title" tabindex="-1" class="mb-3 text-3xl font-bold">'+(selected?'แก้ไขนัด':'เปิดนัดใหม่')+'</h1><p class="mb-6 text-muted">ใส่รายละเอียดคอร์ตที่จองไว้ สมาชิกลงชื่อทั้งนัด</p><form id="event-form" class="panel"><div class="grid grid-cols-2 gap-4">'+
    field('title','ชื่อนัด','text',e.title,'maxlength="80"',true)+field('venue','สนาม','text',e.venue,'maxlength="120"',true)+field('date','วันที่','date',e.date,'',true)+field('start','เริ่ม','time',e.start)+field('end','สิ้นสุด','time',e.end)+field('courts','จำนวนคอร์ต','number',e.courts,'min="1" max="10000" step="1"')+field('capacity','จำนวนคนที่รับ','number',e.capacity,'min="'+Math.max(1,selected?.confirmed||1)+'" max="10000" step="1"')+field('courtNames','ชื่อหรือหมายเลขคอร์ต','text',e.courtNames,'maxlength="100" placeholder="เช่น คอร์ต 1, 2"',true)+
    '</div><p class="mt-4 text-sm text-muted">เมื่อเต็ม คนถัดไปเข้าคิวสำรอง ผู้จัดต้องลงชื่อเองหากจะร่วมเล่น</p><button type="submit" class="btn btn-primary mt-6 w-full">'+(selected?'บันทึกการแก้ไข':'สร้างนัด')+'</button></form></section>';
}
function renderProfile() {
  return '<section class="panel mx-auto max-w-md"><h1 id="page-title" tabindex="-1" class="mb-3 text-2xl font-bold">'+(member.nickname?'ชื่อเล่นในกลุ่ม':'เข้าร่วม SKS Tennis Club')+'</h1><p class="mb-6 text-muted">ใช้ชื่อที่เพื่อนในสนามรู้จัก เพื่อให้หาในรายชื่อได้ง่าย</p><form id="profile-form"><label class="label">ชื่อเล่น<input id="nickname" class="field" name="nickname" maxlength="40" value="'+esc(member.nickname||suggestedNickname)+'" autocomplete="nickname" required></label><button type="submit" class="btn btn-primary mt-5 w-full">บันทึกชื่อเล่น</button></form></section>';
}
function render() {
  const focusedId = document.activeElement?.id;
  account.innerHTML = member?.nickname ? '<button id="profile-button" data-profile class="text-sm font-semibold underline underline-offset-4">'+esc(member.nickname)+'</button><button id="logout-button" data-logout class="ml-3 min-h-11 text-xs text-muted">ออก</button>' : '';
  app.innerHTML = screen === 'welcome' ? renderWelcome() : screen === 'profile' ? renderProfile() : screen === 'form' ? renderForm() : screen === 'detail' && selected ? renderDetail(selected) : renderList();
  document.getElementById(focusedId)?.focus({preventScroll:true});
}
function move(next) {
  screen = next;
  if (next === 'detail' || next === 'list') {
    const url = new URL(location.href);
    if (next === 'detail') url.searchParams.set('event', selected.id);
    else url.searchParams.delete('event');
    url.searchParams.delete('invite'); history.replaceState(null,'',url);
  }
  render(); window.scrollTo(0,0); document.getElementById('page-title')?.focus({preventScroll:true});
}
async function refresh(silent = false) {
  if (!member?.nickname) return;
  if (screen === 'detail' && selected) {
    const result = await api('/events/'+encodeURIComponent(selected.id));
    if (silent && JSON.stringify(result.event) === JSON.stringify(selected)) return;
    selected = result.event;
  } else {
    const result = await api('/events');
    if (silent && JSON.stringify(result.events) === JSON.stringify(events)) return;
    events = result.events;
  }
  render();
}
async function list() { screen = 'list'; selected = null; await refresh(); move('list'); }
async function openEvent(id) {
  selected = (await api('/events/'+encodeURIComponent(id))).event;
  move('detail');
}
function initializeLiff() {
  if (!window.liff) throw new Error('โหลด LINE ไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่');
  return liffReady ||= liff.init({liffId:config.liffId}).catch(error => {liffReady = null; throw error;});
}
async function enter() {
  await initializeLiff();
  if (!liff.isLoggedIn()) {liff.login({redirectUri:location.href}); return;}
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error('เข้าใช้งาน LINE ไม่สำเร็จ กรุณาลองใหม่');
  const result = await api('/auth','POST',{idToken,invite});
  member = result.member; suggestedNickname = result.suggestedNickname;
  invite = '';
  const url = new URL(location.href); url.searchParams.delete('invite'); history.replaceState(null,'',url);
  if (!member.nickname) move('profile');
  else if (requestedEvent) {const id=requestedEvent;requestedEvent=null;await openEvent(id);}
  else await list();
}
async function share() {
  const e = selected;
  const {url} = await api('/invite');
  const link = new URL(url); link.searchParams.set('event',e.id);
  const text = '🎾 '+e.title+'\n'+dateLabel(e.date)+' '+e.start+'–'+e.end+'\n'+e.venue+' · '+e.courtNames+'\nรับ '+e.capacity+' คน ลงชื่อ '+e.confirmed+' คน\n'+link.href;
  if (window.liff) {
    await initializeLiff();
    if (liff.isApiAvailable('shareTargetPicker') && liff.isLoggedIn()) {
      const result = await liff.shareTargetPicker([{type:'text',text}]);
      if (result) notify('แชร์นัดแล้ว');
      return;
    }
  }
  try {await navigator.clipboard.writeText(text);notify('คัดลอกข้อความแล้ว นำไปส่งในกลุ่ม LINE ได้เลย');}
  catch {document.getElementById('share-text').value=text;document.getElementById('share-dialog').showModal();document.getElementById('share-text').select();}
}
document.addEventListener('click',event=>{
  const button = event.target.closest('button'); if(!button || button.disabled) return;
  if(button.hasAttribute('data-login'))return run(enter);
  if(button.hasAttribute('data-list'))return run(list);
  if(button.dataset.go)return run(()=>openEvent(button.dataset.go));
  if(button.hasAttribute('data-refresh'))return run(()=>refresh());
  if(button.hasAttribute('data-create')){selected=null;return move('form');}
  if(button.hasAttribute('data-edit'))return move('form');
  if(button.hasAttribute('data-back'))return selected?move('detail'):run(list);
  if(button.hasAttribute('data-profile'))return move('profile');
  if(button.hasAttribute('data-logout'))return run(async()=>{await api('/logout','POST',{});member=null;selected=null;events=[];move('welcome');});
  if(button.hasAttribute('data-share'))return run(share);
  if(button.hasAttribute('data-cancel'))return document.getElementById('confirm-dialog').showModal();
  if(button.hasAttribute('data-signup'))return run(async()=>{
    const withdrawing = Boolean(selected.myPosition), previous = selected;
    selected = (await api('/events/'+encodeURIComponent(selected.id)+'/signup',withdrawing?'DELETE':'POST',{})).event;
    render();
    const promoted = previous.waitlist[0];
    notify(withdrawing ? 'ถอนชื่อแล้ว'+(previous.myPosition<=previous.capacity&&promoted?' · '+promoted.nickname+' ได้เลื่อนเข้าแทน':'') : selected.myPosition>selected.capacity?'เข้าคิวสำรองแล้ว':'ลงชื่อเรียบร้อยแล้ว');
  });
});
document.addEventListener('submit',event=>{
  if(event.target.id==='profile-form'){
    event.preventDefault();const nickname=new FormData(event.target).get('nickname');
    return run(async()=>{member=(await api('/me','PATCH',{nickname})).member;if(requestedEvent){const id=requestedEvent;requestedEvent=null;await openEvent(id);}else await list();notify('บันทึกชื่อเล่นแล้ว');});
  }
  if(event.target.id==='event-form'){
    event.preventDefault();const fields=Object.fromEntries(new FormData(event.target));fields.courts=Number(fields.courts);fields.capacity=Number(fields.capacity);
    return run(async()=>{selected=(await api(selected?'/events/'+encodeURIComponent(selected.id):'/events',selected?'PATCH':'POST',fields)).event;move('detail');notify('บันทึกนัดแล้ว');});
  }
});
document.getElementById('dismiss-cancel').onclick=()=>document.getElementById('confirm-dialog').close();
document.getElementById('confirm-cancel').onclick=()=>run(async()=>{selected=(await api('/events/'+encodeURIComponent(selected.id)+'/cancel','POST',{})).event;document.getElementById('confirm-dialog').close();render();notify('ยกเลิกนัดแล้ว');});
setInterval(()=>{
  if(!document.hidden && !busy && member?.nickname && ['list','detail'].includes(screen) && !document.querySelector('dialog[open]')){
    run(()=>refresh(true));
  }
},15000);
async function boot() {
  config = await api('/config');
  if (config.ready && window.liff) {
    await initializeLiff();
    const redirected = new URLSearchParams(location.search);
    invite = redirected.get('invite') || invite;
    requestedEvent = redirected.get('event') || requestedEvent;
  }
  try {member=(await api('/me')).member;} catch(error) {if(error.status!==401)throw error;}
  if(member){
    if(!member.nickname)move('profile');
    else if(requestedEvent){const id=requestedEvent;requestedEvent=null;await openEvent(id);}
    else await list();
  } else if(config.ready && window.liff) {
    if(liff.isLoggedIn())await enter();else render();
  } else render();
}
run(boot);
