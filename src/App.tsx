import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EventForm } from './EventForm';
import { EventList } from './EventList';
import { EventDetail } from './EventDetail';
import { api, ApiError, errorMessage, eventPath, type EventDetail as Detail, type Member } from './lib/api';
import { lineSession, type Config } from './line-session';

type Screen = { page: 'welcome' | 'loading' | 'list' | 'profile' } | { page: 'detail'; event: Detail } | { page: 'form'; event: Detail | null };
export function App() {
  const [screen, setScreen] = useState<Screen>({ page: 'loading' }), [member, setMember] = useState<Member | null>(null);
  const [config, setConfig] = useState<Config>({ ready: false, liffId: '' }), [busy, setBusy] = useState(false);
  const [working, setWorking] = useState(false);
  const [suggested, setSuggested] = useState(''), [toast, setToast] = useState('');
  const [line] = useState(lineSession);
  const actionLock = useRef(false);
  const notify = useCallback((message: string) => setToast(message), []);
  const onError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) { setMember(null); setScreen({ page: 'welcome' }); }
    notify(errorMessage(error));
  }, [notify]);
  const move = useCallback((next: Screen) => {
    if (next.page === 'detail' || next.page === 'list') {
      const url = new URL(location.href);
      if (next.page === 'detail') url.searchParams.set('event', next.event.id); else url.searchParams.delete('event');
      url.searchParams.delete('invite'); history.replaceState(null, '', url);
    }
    setScreen(next);
  }, []);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 6000); return () => window.clearTimeout(timer); }, [toast]);
  useEffect(() => { window.scrollTo(0, 0); document.getElementById('page-title')?.focus({ preventScroll: true }); }, [screen]);
  async function memberScreen(current: Member) {
    if (!current.nickname) { move({ page: 'profile' }); return; }
    const id = line.takeEvent();
    if (id) move({ page: 'detail', event: (await api<{ event: Detail }>(eventPath(id))).event });
    else move({ page: 'list' });
  }
  async function enter(settings = config) {
    const result = await line.login(settings);
    if (result) { setMember(result.member); setSuggested(result.suggestedNickname); await memberScreen(result.member); }
  }
  async function run(work: () => Promise<void>) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(true);
    try { await work(); } catch (error) { onError(error); }
    finally { actionLock.current = false; setBusy(false); }
  }
  useEffect(() => {
    // No StrictMode double boot: init/auth may redirect or create a session.
    void run(async () => {
      try {
        const settings = await api<Config>('/config'); setConfig(settings);
        if (settings.ready && window.liff) await line.initialize(settings);
        let current: Member | null = null;
        try { current = (await api<{ member: Member }>('/me')).member; }
        catch (error) { if (!(error instanceof ApiError) || error.status !== 401) throw error; }
        if (current) { setMember(current); await memberScreen(current); }
        else if (settings.ready && window.liff?.isLoggedIn()) await enter(settings);
        else move({ page: 'welcome' });
      } catch (error) { move({ page: 'welcome' }); throw error; }
    });
  }, []);
  return <>
    <a className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-surface focus:p-3" href="#app">ข้ามไปเนื้อหา</a>
    <header inert={busy || working} className="mx-auto flex max-w-5xl items-center justify-between gap-4 border-b border-border px-4 py-5 sm:px-6"><a href="/" className="flex min-w-0 items-center gap-3"><img src="/sks-logo.png" alt="โลโก้ SKS Tennis Club" width={56} height={56} className="size-12 shrink-0 rounded-full sm:size-14" /><span className="font-serif text-lg font-bold tracking-wide sm:text-xl">SKS Tennis Club<span className="mt-1 block font-sans text-xs font-normal tracking-normal text-muted-foreground">สังกะสีเทนนิสคลับ</span></span></a>
      {member?.nickname && <div className="shrink-0"><Button variant="link" disabled={busy} className="px-1" onClick={() => move({ page: 'profile' })}>{member.nickname}</Button><Button variant="ghost" disabled={busy} className="ml-1 px-1 text-xs text-muted-foreground" onClick={() => void run(async () => { await api('/logout', 'POST', {}); setMember(null); move({ page: 'welcome' }); })}>ออก</Button></div>}
    </header>
    <main id="app" className="mx-auto max-w-5xl px-4 py-8 pb-24 sm:px-6" aria-busy={busy}><fieldset disabled={busy} className="min-w-0">
      {screen.page === 'loading' && <p role="status" className="py-20 text-center text-muted-foreground">กำลังเปิดนัดตีของกลุ่ม…</p>}
      {screen.page === 'welcome' && <section className="mx-auto max-w-xl rounded-3xl border border-border bg-surface px-6 py-10 text-center sm:px-10 sm:py-14"><img src="/sks-logo.png" alt="" width={112} height={112} className="mx-auto mb-6 size-28 rounded-full" /><p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-leaf">SKS Tennis Club</p><h1 id="page-title" tabIndex={-1} className="mb-4 text-3xl font-bold sm:text-4xl">นัดตีครั้งหน้า<br />เจอกันที่คอร์ต</h1><p className="mb-8 text-muted-foreground">ดูนัดของกลุ่ม ลงชื่อเล่นทั้งนัด<br />ถ้าเต็มก็เข้าคิวสำรองได้</p>{config.ready ? <><Button disabled={busy} className="w-full" onClick={() => void run(() => enter())}>เข้าใช้งานผ่าน LINE</Button><p className="mt-4 text-xs text-muted-foreground">สมาชิกใหม่เข้าร่วมผ่านลิงก์เชิญจากกลุ่ม</p></> : <p className="rounded-xl bg-sage p-4 text-sm text-leaf">กำลังเตรียมเปิดใช้งาน<br />ผู้จัดกลุ่มจะแชร์ลิงก์เมื่อพร้อมครับ</p>}</section>}
      {screen.page === 'profile' && member && <Profile key={member.id} member={member} suggested={suggested} onWorking={setWorking} onError={onError} onSaved={current => void run(async () => { setMember(current); await memberScreen(current); notify('บันทึกชื่อเล่นแล้ว'); })} />}
      {screen.page === 'list' && member && <EventList onError={onError} onCreate={() => move({ page: 'form', event: null })} onOpen={id => void run(async () => move({ page: 'detail', event: (await api<{ event: Detail }>(eventPath(id))).event }))} />}
      {screen.page === 'form' && member && <EventForm key={screen.event?.id || 'new'} event={screen.event} onWorking={setWorking} onError={onError} onBack={() => move(screen.event ? { page: 'detail', event: screen.event } : { page: 'list' })} onSaved={event => { move({ page: 'detail', event }); notify('บันทึกนัดแล้ว'); }} />}
      {screen.page === 'detail' && member && <EventDetail key={screen.event.id} initial={screen.event} member={member} config={config} line={line} notify={notify} onWorking={setWorking} onError={onError} onBack={() => move({ page: 'list' })} onEdit={event => move({ page: 'form', event })} />}
    </fieldset></main>
    <footer className="px-4 pb-8 text-center text-xs text-muted-foreground">SKS Tennis Club · เจอกันที่คอร์ต</footer>
    {toast && <div role="status" aria-live="polite" className="fixed bottom-6 left-1/2 z-[60] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-xl bg-navy px-5 py-3 text-sm text-cream shadow-lg">{toast}</div>}
  </>;
}
function Profile({ member, suggested, onSaved, onError, onWorking }: { member: Member; suggested: string; onSaved(member: Member): void; onError(error: unknown): void; onWorking(pending: boolean): void }) {
  const [nickname, setNickname] = useState(member.nickname || suggested), [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => { onWorking(pending); return () => onWorking(false); }, [pending, onWorking]);
  async function save(e: FormEvent) {
    e.preventDefault(); if (pending) return;
    setPending(true); setError('');
    try { onSaved((await api<{ member: Member }>('/me', 'PATCH', { nickname })).member); }
    catch (err) { setError(errorMessage(err)); onError(err); }
    finally { setPending(false); }
  }
  return <section className="panel mx-auto max-w-md"><h1 id="page-title" tabIndex={-1} className="mb-3 text-2xl font-bold">{member.nickname ? 'ชื่อเล่นในกลุ่ม' : 'เข้าร่วม SKS Tennis Club'}</h1><p className="mb-6 text-muted-foreground">ใช้ชื่อที่เพื่อนในสนามรู้จัก เพื่อให้หาในรายชื่อได้ง่าย</p><form onSubmit={save}><fieldset disabled={pending}><Label htmlFor="nickname">ชื่อเล่น</Label><Input id="nickname" name="nickname" maxLength={40} autoComplete="nickname" required value={nickname} onChange={e => setNickname(e.target.value)} className="mt-2" />{error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}<Button type="submit" className="mt-5 w-full">{pending ? 'กำลังบันทึก…' : 'บันทึกชื่อเล่น'}</Button></fieldset></form></section>;
}
