import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxEmpty, ComboboxList, ComboboxItem } from '@/components/ui/combobox';
import { api, ApiError, errorMessage, eventPath, type ClubMatch, type EventDetail, type MatchDetail, type Member } from './lib/api';

export function EventMatches({ event, onError, onWorking, notify, onChanged }: {
  event: Pick<EventDetail, 'id' | 'cancelled'>; onError(error: unknown): void; onWorking(pending: boolean): void; notify(message: string): void; onChanged(): void;
}) {
  const [data, setData] = useState<MatchDetail | null>(null), [error, setError] = useState('');
  const [draft, setDraft] = useState<{ match: ClubMatch | null } | null>(null), [voiding, setVoiding] = useState<ClubMatch | null>(null);
  const [pending, setPending] = useState(false), [reload, setReload] = useState(0);
  const lock = useRef(false), revision = useRef(0);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement>(null);
  const path = eventPath(event.id) + '/matches';
  useEffect(() => {
    let active = true; const current = ++revision.current;
    void api<MatchDetail>(path).then(result => { if (active && revision.current === current) { setData(result); setError(''); } }).catch(err => { if (active && revision.current === current) { setError(errorMessage(err)); onError(err); } });
    return () => { active = false; };
  }, [path, event, reload, onError]);
  useEffect(() => { onWorking(pending); return () => onWorking(false); }, [pending, onWorking]);
  function saved(result: MatchDetail) { revision.current++; setData(result); setDraft(null); onChanged(); notify('บันทึกผลแล้ว · อันดับคำนวณจากผลล่าสุด'); }
  async function voidMatch() {
    if (!voiding || lock.current) return;
    lock.current = true; revision.current++; setPending(true); setError('');
    try { const result = await api<MatchDetail>(path + '/' + encodeURIComponent(voiding.id), 'DELETE', { version: voiding.version }); revision.current++; setData(result); setVoiding(null); onChanged(); notify('ยกเลิกผลแล้ว · ไม่นับแต้มแมตช์นี้'); }
    catch (err) { setError(errorMessage(err)); onError(err); }
    finally { lock.current = false; setPending(false); }
  }
  const teamName = (team: Member[]) => team.map(p => p.nickname).join(' + ');
  function openMatch(match: ClubMatch | null, cancel = false) {
    dialogTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError('');
    if (cancel) setVoiding(match); else setDraft({ match });
  }
  function restoreFocus(e: Event) { e.preventDefault(); (dialogTrigger.current?.isConnected ? dialogTrigger.current : refreshButton.current)?.focus(); }
  return <section className="panel mt-6" aria-busy={pending}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">ผลแมตช์ในนัดนี้</h2><div className="flex gap-2"><Button ref={refreshButton} variant="ghost" disabled={pending} onClick={() => setReload(value => value + 1)}>อัปเดตผล</Button>{data?.canRecord && <Button disabled={pending || data.players.length < 4} onClick={() => openMatch(null)}>+ บันทึกผล</Button>}</div></div>
    <p className="mt-3 text-sm text-muted-foreground">เล่นคู่ · ชนะ +3 / เสมอ +1 / แพ้ +0 ต่อคน · นับเดือนตามวันนัด</p>
    {data && !data.canRecord && <p className="mt-3 text-sm text-muted-foreground">{event.cancelled ? 'นัดยกเลิกแล้ว ผลที่เล่นจริงยังนับแต้ม แก้หรือยกเลิกผลเดิมได้ตามสิทธิ์' : 'บันทึกผลได้ตั้งแต่เวลาเริ่มนัด'}</p>}
    {data?.canRecord && data.players.length < 4 && <p className="mt-3 text-sm text-muted-foreground">ต้องมีสมาชิกที่มีบัญชีอย่างน้อย 4 คนในนัด ให้ผู้จัดเพิ่มรายชื่อหรือผูกบัญชีก่อน</p>}
    {error && !voiding && <p role="alert" className="mt-4 text-red-800">{error}</p>}
    {!data ? <p role="status" className="mt-5 text-muted-foreground">{error ? 'โหลดผลไม่สำเร็จ กดอัปเดตผลเพื่อลองอีกครั้ง' : 'กำลังโหลดผล…'}</p> : data.matches.length === 0 ? <p className="mt-6 text-muted-foreground">ยังไม่มีผลแมตช์</p> : <ol className="mt-5 divide-y divide-border" aria-label="ประวัติแมตช์">{data.matches.map(match => <li key={match.id} className={'py-5 ' + (match.voided ? 'opacity-70' : '')}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3"><p className="min-w-0 break-all font-semibold">{teamName(match.teamA)}</p><p className="rounded-xl bg-sage px-3 py-2 text-xl font-bold">{match.scoreA}–{match.scoreB}</p><p className="min-w-0 break-all text-right font-semibold">{teamName(match.teamB)}</p></div>
      <p className="mt-3 text-sm text-leaf">{match.voided ? 'ยกเลิกผล · ไม่นับแต้ม' : match.scoreA === match.scoreB ? 'เสมอ · ทุกคน +1 แต้ม' : `ทีม ${match.scoreA > match.scoreB ? 'A' : 'B'} ชนะ · ผู้ชนะคนละ +3 แต้ม`}</p>
      <p className="mt-2 text-xs text-muted-foreground">บันทึกโดย {match.createdBy.nickname}{match.version > 1 && ` · ${match.voided ? 'ยกเลิก' : 'แก้ล่าสุด'}โดย ${match.updatedBy.nickname} · ${new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' }).format(match.updatedAt)}`}</p>
      {match.canEdit && <div className="mt-2 flex gap-3"><Button variant="link" className="px-0" disabled={pending} onClick={() => openMatch(match)} aria-label={'แก้ผล ' + teamName(match.teamA)}>แก้ผล</Button><Button variant="link" className="px-0 text-red-800" disabled={pending} onClick={() => openMatch(match, true)} aria-label={'ยกเลิกผล ' + teamName(match.teamA)}>ยกเลิกผล</Button></div>}
    </li>)}</ol>}
    <Dialog open={Boolean(draft)} onOpenChange={open => { if (!open && !pending) setDraft(null); }}><DialogContent onCloseAutoFocus={restoreFocus} onEscapeKeyDown={e => { if (pending) e.preventDefault(); }} onInteractOutside={e => { if (pending) e.preventDefault(); }}>{draft && data && <MatchForm key={draft.match?.id || 'new'} path={path} players={data.players} match={draft.match} onSaved={saved} onClose={() => setDraft(null)} onPending={setPending} onError={onError} />}</DialogContent></Dialog>
    <Dialog open={Boolean(voiding)} onOpenChange={open => { if (!open && !pending) setVoiding(null); }}><DialogContent onCloseAutoFocus={restoreFocus} onEscapeKeyDown={e => { if (pending) e.preventDefault(); }} onInteractOutside={e => { if (pending) e.preventDefault(); }}><DialogTitle>ยกเลิกผลแมตช์นี้?</DialogTitle><DialogDescription>ผลยังอยู่ในประวัติ แต่จะไม่นับแต้มและสถิติของทั้งสี่คน</DialogDescription>{voiding && <p>{teamName(voiding.teamA)} {voiding.scoreA}–{voiding.scoreB} {teamName(voiding.teamB)}</p>}{error && <p role="alert" className="text-red-800">{error}</p>}<div className="flex gap-3"><Button disabled={pending} onClick={() => void voidMatch()}>{pending ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกผล'}</Button><Button variant="outline" disabled={pending} onClick={() => setVoiding(null)}>กลับไปก่อน</Button></div></DialogContent></Dialog>
  </section>;
}

function MatchForm({ path, players, match, onSaved, onClose, onPending, onError }: {
  path: string; players: Member[]; match: ClubMatch | null; onSaved(data: MatchDetail): void; onClose(): void; onPending(pending: boolean): void; onError(error: unknown): void;
}) {
  const [selected, setSelected] = useState<(Member | null)[]>(match ? [...match.teamA, ...match.teamB] : [null, null, null, null]);
  const [score, setScore] = useState(match ? `${match.scoreA}-${match.scoreB}` : '');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [duplicate, setDuplicate] = useState(false);
  const formRef = useRef<HTMLFormElement>(null), lock = useRef(false);
  const request = useRef({ payload: '', id: crypto.randomUUID() });
  const change = () => { setDuplicate(false); setError(''); };
  async function save(e: FormEvent) {
    e.preventDefault(); if (lock.current) return;
    if (selected.some(p => !p) || new Set(selected.map(p => p?.id)).size !== 4 || !score) { setError('เลือกผู้เล่น 4 คนไม่ซ้ำกัน และเลือกสกอร์'); return; }
    const [scoreA, scoreB] = score.split('-').map(Number);
    const fields = { teamA: selected.slice(0, 2).map(p => p!.id), teamB: selected.slice(2).map(p => p!.id), scoreA, scoreB };
    const payload = JSON.stringify(fields);
    if (request.current.payload && request.current.payload !== payload) request.current.id = crypto.randomUUID();
    request.current.payload = payload;
    lock.current = true; setPending(true); onPending(true); setError('');
    try { onSaved(await api<MatchDetail>(path + (match ? '/' + encodeURIComponent(match.id) : ''), match ? 'PATCH' : 'POST', { ...fields, requestId: request.current.id, ...(match ? { version: match.version } : {}), confirmDuplicate: duplicate })); }
    catch (err) { setError(errorMessage(err)); if (err instanceof ApiError && err.code === 'duplicate-match') setDuplicate(true); else onError(err); }
    finally { lock.current = false; setPending(false); onPending(false); }
  }
  return <><DialogTitle>{match ? 'แก้ผลแมตช์' : 'บันทึกผลแมตช์'}</DialogTitle><DialogDescription>เลือกสมาชิกที่ลงเล่นจริง รวมคนสำรองหรือถอนชื่อได้ ทั้งสองคนในทีมได้แต้มเท่ากัน</DialogDescription>
    <form ref={formRef} onSubmit={save} aria-busy={pending}><fieldset disabled={pending} className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">{['A', 'B'].map((team, t) => <fieldset key={team} className="min-w-0 rounded-xl bg-sage p-3"><legend className="font-semibold">ทีม {team}</legend><div className="space-y-3">{[0, 1].map(slot => {
        const index = t * 2 + slot, id = 'match-player-' + index;
        const items = players.filter(p => selected[index]?.id === p.id || !selected.some(person => person?.id === p.id));
        return <div key={id}><Label htmlFor={id}>ทีม {team} ผู้เล่น {slot + 1}</Label><Combobox items={items} value={selected[index]} onValueChange={person => { change(); setSelected(current => current.map((p, i) => i === index ? person : p)); }} itemToStringLabel={p => p.nickname || ''} itemToStringValue={p => p.id} disabled={pending}><ComboboxInput id={id} placeholder="ค้นหาชื่อ" className="mt-2" /><ComboboxContent container={formRef}><ComboboxEmpty>ไม่พบสมาชิก</ComboboxEmpty><ComboboxList>{(p: Member) => <ComboboxItem key={p.id} value={p} className="min-h-11 break-all">
          <span aria-hidden="true" className="relative grid size-8 shrink-0 place-items-center rounded-full bg-sage text-sm">
            {Array.from(p.nickname || '')[0]}
            {p.pictureUrl && <img key={p.pictureUrl} src={p.pictureUrl} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 size-8 rounded-full object-cover" onError={e => { e.currentTarget.hidden = true; }} />}
          </span>
          <span className="min-w-0">{p.nickname}<span className="ml-2 text-xs text-muted-foreground">{p.id.slice(0, 6)}</span></span>
        </ComboboxItem>}</ComboboxList></ComboboxContent></Combobox></div>;
      })}</div></fieldset>)}</div>
      <div><Label htmlFor="match-score">สกอร์ ทีม A – ทีม B</Label><NativeSelect id="match-score" required value={score} onChange={e => { change(); setScore(e.target.value); }} className="mt-2"><option value="">เลือกสกอร์</option>{['4-0', '4-1', '4-2', '3-3', '0-4', '1-4', '2-4', '6-0', '6-1', '6-2', '6-3', '6-4', '5-5', '0-6', '1-6', '2-6', '3-6', '4-6'].map(value => <option key={value} value={value}>{value.replace('-', '–')}{['3-3', '5-5'].includes(value) ? ' · เสมอ' : ''}</option>)}</NativeSelect></div>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {duplicate && <p className="rounded-xl bg-sage p-3 text-sm">หากเป็นแมตช์เดียวกัน ให้กลับไปตรวจประวัติ หากเล่นซ้ำจริง ให้ยืนยันว่าเป็นแมตช์ใหม่</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit">{pending ? 'กำลังบันทึก…' : duplicate ? 'ยืนยันว่าเป็นคนละแมตช์' : match ? 'บันทึกการแก้ผล' : 'บันทึกผล'}</Button><Button type="button" variant="outline" onClick={onClose}>กลับไปก่อน</Button></div>
    </fieldset></form>
  </>;
}
