import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api, currentMonth, errorMessage, monthLabel, type Member, type RankingDetail } from './lib/api';

const medals = ['🥇', '🥈', '🥉'];

export function Ranking({ member, onBack, onError }: { member: Member; onBack(): void; onError(error: unknown): void }) {
  const [month, setMonth] = useState(currentMonth), [data, setData] = useState<RankingDetail | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    void api<RankingDetail>('/ranking?month=' + encodeURIComponent(month)).then(result => { if (active) setData(result); }).catch(err => { if (active) { setError(errorMessage(err)); onError(err); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month, reload, onError]);
  const months = [...new Set([currentMonth(), month, ...(data?.months || [])])].sort().reverse();
  return <section aria-busy={loading}>
    <div className="mb-6 flex justify-between gap-3"><Button variant="ghost" onClick={onBack}>← นัดทั้งหมด</Button><Button variant="outline" disabled={loading} onClick={() => setReload(value => value + 1)}>อัปเดตอันดับ</Button></div>
    <p className="text-xs font-semibold tracking-widest text-leaf">ขิงหลังตี</p>
    <h1 id="page-title" tabIndex={-1} className="mt-3 text-3xl font-bold">Ranking ของกลุ่ม</h1>
    <p className="mt-3 text-muted-foreground">ชนะ +3 · เสมอ +1 · แพ้ +0 · แต้มเท่ากันครองอันดับร่วม</p>
    <div className="mt-6 max-w-xs"><Label htmlFor="ranking-month">รอบอันดับ</Label><NativeSelect id="ranking-month" value={month} onChange={e => setMonth(e.target.value)} className="mt-2">{months.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</NativeSelect></div>
    {error && <p role="alert" className="mt-5 text-red-800">{error}</p>}
    {loading ? <p role="status" className="py-12 text-center text-muted-foreground">กำลังคำนวณอันดับ…</p> : !error && data && <>
      <div className="my-6 rounded-2xl bg-sage p-5"><p className="text-sm text-leaf">{member.nickname}{data.mine && medals[data.mine.rank - 1] && <span aria-hidden="true" className="ml-2">{medals[data.mine.rank - 1]}</span>} · {monthLabel(data.month)}</p><p className="mt-2 text-xl font-bold">{data.mine ? `อันดับ ${data.mine.rank} · ${data.mine.points} แต้ม` : 'ยังไม่มีแมตช์เดือนนี้'}</p><p className="mt-2 text-sm text-muted-foreground">เริ่มแต้มใหม่ทุกเดือน · ผลย้อนหลังนับตามวันนัด</p></div>
      {data.standings.length ? <ol className="space-y-3" aria-label="ตารางอันดับ">{data.standings.map(row => <li key={row.id} className={'panel flex gap-4 ' + (row.id === member.id ? 'border-leaf' : '')}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sage text-lg font-bold text-leaf" aria-label={'อันดับ ' + row.rank}>{row.rank}</span>
        <div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><span className="break-all font-semibold">{row.nickname}{medals[row.rank - 1] && <span aria-hidden="true" className="ml-2">{medals[row.rank - 1]}</span>}{row.id === member.id && <span className="ml-2 text-xs text-leaf">คุณ</span>}</span><span className="shrink-0 text-lg font-bold">{row.points} <span className="text-sm font-normal">แต้ม</span></span></div><p className="mt-2 text-sm text-muted-foreground">{row.played} แมตช์ · ชนะ {row.wins} · เสมอ {row.draws} · แพ้ {row.losses}</p><p className="mt-1 text-sm text-leaf">ชนะ {new Intl.NumberFormat('th-TH', { maximumFractionDigits: 1 }).format(row.winPercent)}%</p></div>
      </li>)}</ol> : <p className="panel text-center text-muted-foreground">ยังไม่มีผลแมตช์ในเดือนนี้</p>}
      <p className="mt-5 text-sm text-muted-foreground">เปอร์เซ็นต์ชนะ = ชนะ ÷ แมตช์ทั้งหมด รวมแมตช์เสมอ · คนเล่นบ่อยมีโอกาสสะสมแต้มมากกว่า</p>
    </>}
  </section>;
}
