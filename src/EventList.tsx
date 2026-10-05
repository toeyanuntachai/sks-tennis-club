import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, dateLabel, type ClubEvent } from './lib/api';

export function EventBadge({ event: e }: { event: ClubEvent }) {
  if (e.cancelled) return <span className="badge bg-stone-200 text-stone-600">ยกเลิกแล้ว</span>;
  if (e.myPosition && e.myPosition > e.capacity) return <span className="badge bg-amber-100 text-amber">คุณอยู่คิวสำรอง {e.myPosition - e.capacity}</span>;
  if (e.myPosition) return <span className="badge">คุณลงชื่อแล้ว</span>;
  return e.confirmed >= e.capacity ? <span className="badge bg-amber-100 text-amber">เต็ม · มีคิวสำรอง</span> : <span className="badge">ว่าง {e.capacity - e.confirmed} ที่</span>;
}
export function EventList({ onOpen, onCreate, onError }: { onOpen(id: string): void; onCreate(): void; onError(error: unknown): void }) {
  const [events, setEvents] = useState<ClubEvent[]>([]), [pending, setPending] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const activeRequest = useRef(false), mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (activeRequest.current) return;
    activeRequest.current = true;
    setPending(true);
    try { const result = await api<{ events: ClubEvent[] }>('/events'); if (mounted.current) { setEvents(result.events); setLoaded(true); } }
    catch (err) { if (mounted.current) onError(err); }
    finally { activeRequest.current = false; if (mounted.current) setPending(false); }
  }, [onError]);
  useEffect(() => {
    mounted.current = true; void refresh();
    const interval = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
    return () => { mounted.current = false; window.clearInterval(interval); };
  }, [refresh]);
  function rows(list: ClubEvent[]) {
    return list.map(e => <article key={e.id} className="flex flex-wrap items-center gap-4 border-b border-border py-5 last:border-0">
      <div className="w-14 shrink-0 rounded-xl bg-sage py-2 text-center"><b className="block text-2xl">{new Date(e.date + 'T12:00:00').getDate()}</b><small>{new Intl.DateTimeFormat('th-TH', { month: 'short' }).format(new Date(e.date + 'T12:00:00'))}</small></div>
      <div className="min-w-40 flex-1"><EventBadge event={e} /><h2 className="mt-2 text-lg font-bold">{e.title}</h2><p className="text-sm text-muted-foreground">{dateLabel(e.date)} · {e.start}–{e.end} · {e.courts} คอร์ต</p><p className="text-sm text-muted-foreground">{e.venue}</p></div>
      <div className="ml-18 text-sm sm:ml-0">{e.confirmed} / {e.capacity} คน{e.waiting > 0 && <><br /><span className="text-muted-foreground">สำรอง {e.waiting} คน</span></>}</div>
      <Button variant="outline" onClick={() => onOpen(e.id)} className="ml-auto">ดูนัด →</Button>
    </article>);
  }
  const active = events.filter(e => !e.cancelled), cancelled = events.filter(e => e.cancelled);
  return <div aria-busy={pending}>
    <div className="mb-6 flex items-start justify-between gap-4"><div><p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">จองคอร์ตแล้ว นัดเพื่อนได้เลย</p><h1 id="page-title" tabIndex={-1} className="text-3xl font-bold">นัดตีของกลุ่ม</h1><p className="mt-2 text-muted-foreground">ลงชื่อครั้งเดียว เจอกันทั้งนัด</p></div><Button onClick={onCreate}>+ เปิดนัด</Button></div>
    <div className="mb-4 flex justify-end"><Button variant="link" disabled={pending} onClick={() => void refresh()}>อัปเดตรายชื่อ</Button></div>
    {!loaded ? <p role="status" className="py-12 text-center text-muted-foreground">{pending ? 'กำลังโหลดนัด…' : 'โหลดนัดไม่สำเร็จ กดอัปเดตเพื่อลองใหม่'}</p> : active.length ? <section className="panel py-0">{rows(active)}</section> : <section className="panel py-12 text-center"><h2 className="mb-2 text-lg font-bold">ยังไม่มีนัดที่เปิดอยู่</h2><p className="text-muted-foreground">จองคอร์ตแล้วกด “เปิดนัด” เพื่อชวนเพื่อนลงชื่อได้เลย</p></section>}
    {cancelled.length > 0 && <details className="mt-6"><summary className="cursor-pointer text-sm text-muted-foreground">นัดที่ยกเลิก · {cancelled.length} นัด</summary><section className="panel mt-3 py-0">{rows(cancelled)}</section></details>}
  </div>;
}
