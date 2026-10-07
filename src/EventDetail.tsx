import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ParticipantForm, type ParticipantDraft } from './ParticipantForm';
import { EventBadge } from './EventList';
import { EventMatches } from './EventMatches';
import { api, dateLabel, errorMessage, eventPath, money, paymentQrUrl, type EventDetail as Detail, type Member, type Participant } from './lib/api';
import type { Config, LineSession } from './line-session';

type DialogState = { type: 'participant'; draft: ParticipantDraft } | { type: 'remove'; person: Participant } | { type: 'cancel' | 'qr' } | { type: 'share'; text: string } | null;
export function EventDetail({ initial, member, config, line, onBack, onEdit, onError, notify, onWorking }: {
  initial: Detail; member: Member; config: Config; line: LineSession;
  onBack(): void; onEdit(event: Detail): void; onError(error: unknown): void; notify(message: string): void;
  onWorking(pending: boolean): void;
}) {
  const [event, setEvent] = useState(initial), [dialog, setDialog] = useState<DialogState>(null);
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => { onWorking(pending); return () => onWorking(false); }, [pending, onWorking]);
  const revision = useRef(0), lock = useRef(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const path = eventPath(event.id), editable = event.isOrganizer && !event.cancelled;
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; revision.current++; setPending(true); setError('');
    try { await work(); } catch (err) { setError(errorMessage(err)); onError(err); }
    finally { lock.current = false; setPending(false); }
  }
  async function refresh() {
    const current = ++revision.current;
    const result = await api<{ event: Detail }>(path);
    if (revision.current === current) setEvent(result.event);
  }
  useEffect(() => {
    if (pending || dialog) return;
    let active = true;
    const interval = window.setInterval(() => {
      if (!document.hidden && !lock.current) {
        const current = ++revision.current;
        void api<{ event: Detail }>(path).then(result => { if (active && revision.current === current) setEvent(result.event); }).catch(err => { if (active) onError(err); });
      }
    }, 15000);
    return () => { active = false; window.clearInterval(interval); };
  }, [path, pending, dialog, onError]);
  async function mutate(suffix: string, method: string, data: unknown, message: string) {
    const result = await api<{ event: Detail }>(path + suffix, method, data);
    setEvent(result.event); setDialog(null); notify(message);
  }
  function openDialog(next: DialogState, trigger = document.activeElement) {
    dialogTrigger.current = trigger instanceof HTMLElement ? trigger : null;
    setError(''); setDialog(next);
  }
  async function participantForm(mode: ParticipantDraft['mode'], person?: Participant) {
    const trigger = document.activeElement;
    const members = mode === 'rename' ? [] : (await api<{ members: Member[] }>(path + '/available-members')).members;
    openDialog({ type: 'participant', draft: { mode, person, members } }, trigger);
  }
  async function signup() {
    const withdrawing = Boolean(event.myPosition);
    const result = await api<{ event: Detail }>(path + '/signup', withdrawing ? 'DELETE' : 'POST', {});
    setEvent(result.event);
    const promoted = event.waitlist[0];
    notify(withdrawing ? 'ถอนชื่อแล้ว' + (event.myPosition! <= event.capacity && promoted ? ' · ' + promoted.nickname + ' ได้เลื่อนเข้าแทน' : '') : result.event.myPosition! > result.event.capacity ? 'เข้าคิวสำรองแล้ว' : 'ลงชื่อเรียบร้อยแล้ว');
  }
  async function share() {
    const trigger = document.activeElement;
    const { url } = await api<{ url: string }>('/invite');
    const link = new URL(url); link.searchParams.set('event', event.id);
    const text = '🎾 ' + event.title + '\n' + dateLabel(event.date) + ' ' + event.start + '–' + event.end + '\n' + event.venue + ' · ' + event.courtNames + '\nรับ ' + event.capacity + ' คน ลงชื่อ ' + event.confirmed + ' คน\n' + link.href;
    const result = await line.share(config, text);
    if (result === 'shared') notify('แชร์นัดแล้ว');
    if (result === 'copied') notify('คัดลอกข้อความแล้ว นำไปส่งในกลุ่ม LINE ได้เลย');
    if (result === 'manual') openDialog({ type: 'share', text }, trigger);
  }
  function roster(people: Participant[], withdrawn = false) {
    const action = (p: Participant, label: string, work: () => void) => <Button key={label} variant="link" disabled={pending} aria-label={label + ': ' + p.nickname} onClick={work} className="px-0">{label}</Button>;
    return people.length ? <ol className="divide-y divide-border">{people.map((p, i) => <li key={p.id} className="py-3"><div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sage text-sm">{i + 1}</span>
      <span className="min-w-0 flex-1 break-words">{p.nickname}{p.id === member.id && <small className="ml-2 text-leaf">คุณ</small>}{p.isGuest && <small className="mt-1 block text-xs text-muted-foreground">เพิ่มโดยผู้จัด</small>}</span>
      {editable ? <Label className="flex min-h-11 shrink-0 gap-2 text-sm font-normal"><Checkbox checked={p.paid} disabled={pending} aria-label={'จ่ายแล้ว: ' + p.nickname} onCheckedChange={paid => void run(() => mutate('/payment', 'PATCH', { memberId: p.id, paid: paid === true }, 'บันทึกสถานะจ่ายเงินแล้ว'))} /><span>{p.paid ? 'จ่ายแล้ว' : 'ยังไม่จ่าย'}</span></Label> : <span className={'shrink-0 text-sm ' + (p.paid ? 'font-semibold text-leaf' : 'text-muted-foreground')}>{p.paid ? 'จ่ายแล้ว' : 'ยังไม่จ่าย'}</span>}
    </div>{editable && <div className="ml-12 flex flex-wrap gap-x-4">
      {withdrawn ? action(p, 'เพิ่มกลับ', () => void run(() => mutate('/participants', 'POST', { memberId: p.id }, 'เพิ่มกลับแล้ว · เก็บสถานะจ่ายเดิม'))) : action(p, 'ถอนชื่อ', () => openDialog({ type: 'remove', person: p }))}
      {p.isGuest && <>{action(p, 'แก้ชื่อ', () => void run(() => participantForm('rename', p)))}{action(p, 'ผูกบัญชี', () => void run(() => participantForm('link', p)))}</>}
    </div>}</li>)}</ol> : <p className="py-3 text-muted-foreground">ยังไม่มีรายชื่อ</p>;
  }
  const status = !event.myPosition ? 'ยังไม่ได้ลงชื่อ' : event.myPosition <= event.capacity ? 'คุณได้ที่ในนัดนี้แล้ว' : 'คุณอยู่คิวสำรองลำดับ ' + (event.myPosition - event.capacity);
  const fact = (label: string, value: string) => <div><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold">{value}</dd></div>;
  return <div aria-busy={pending}>
    <div className="mb-6 flex justify-between"><Button variant="ghost" disabled={pending} onClick={onBack}>← นัดทั้งหมด</Button><Button variant="link" disabled={pending} onClick={() => void run(refresh)}>อัปเดตรายชื่อ</Button></div>
    <div className="mb-5 grid gap-5 md:grid-cols-[1.4fr_1fr]"><section className="panel"><EventBadge event={event} /><h1 id="page-title" tabIndex={-1} className="my-4 text-3xl font-bold">{event.title}</h1><p>{event.venue}</p><dl className="mt-6 grid grid-cols-2 gap-5">{fact('วันตี', dateLabel(event.date))}{fact('เวลา', event.start + '–' + event.end)}{fact('คอร์ตที่จอง', event.courtNames)}{fact('ผู้จัดนัด', event.organizerName)}</dl></section>
      <aside className="panel flex flex-col justify-center bg-sage"><p className="text-xs font-semibold tracking-wide text-leaf">ลงชื่อทั้งนัด</p><p className="my-3 text-5xl font-bold">{event.confirmed} <span className="text-xl font-normal">/ {event.capacity} คน</span></p><p>คิวสำรอง {event.waiting} คน</p><p className="mt-3 font-semibold">{status}</p></aside></div>
    {event.cancelled ? <p className="mb-5 rounded-xl bg-sage p-4">นัดนี้ยกเลิกแล้ว รายชื่อด้านล่างเป็นประวัติของนัด</p> : <div className="mb-5 flex flex-wrap gap-3"><Button disabled={pending} variant={event.myPosition ? 'outline' : 'default'} onClick={() => void run(signup)} className={'flex-1 ' + (event.myPosition ? 'text-red-800' : '')}>{event.myPosition ? 'ถอนชื่อของฉัน' : event.confirmed >= event.capacity ? 'เข้าคิวสำรอง' : 'ลงชื่อนัดนี้'}</Button><Button variant="outline" disabled={pending} onClick={() => void run(share)}>แชร์นัดใน LINE</Button></div>}
    {(event.totalCostSatang != null || event.hasPaymentQr) && <section className="panel mb-5"><h2 className="mb-4 text-xl font-bold">ค่าใช้จ่ายและการจ่ายเงิน</h2><div className={'grid gap-6 ' + (event.hasPaymentQr ? 'sm:grid-cols-2' : '')}>
      {event.totalCostSatang != null && <div><dl className="space-y-2">{event.courtCostSatang != null && <div className="flex justify-between gap-3"><dt>ค่าคอร์ตรวม</dt><dd>{money(event.courtCostSatang)} บาท</dd></div>}{event.ballCostSatang != null && <div className="flex justify-between gap-3"><dt>ค่าลูกเทนนิสรวม</dt><dd>{money(event.ballCostSatang)} บาท</dd></div>}<div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold"><dt>รวมค่าใช้จ่ายที่ระบุ</dt><dd>{money(event.totalCostSatang)} บาท</dd></div></dl>
        {event.sharePerPersonSatang == null ? <p className="mt-5 text-muted-foreground">รอผู้เข้าร่วมเพื่อคำนวณยอดต่อคน</p> : <div className="mt-5 rounded-xl bg-sage p-4"><p className="text-sm">หารผู้ได้ที่ในนัด {event.sharePeople} คน</p><p className="mt-2 text-3xl font-bold">{money(event.sharePerPersonSatang)} <span className="text-base font-normal">บาท/คน</span></p><p className="mt-2 text-sm text-muted-foreground">ปัดขึ้นเป็นบาท · ส่วนเกินรวม {money(event.roundingSurplusSatang!)} บาท</p></div>}
        <p className="mt-3 text-sm text-muted-foreground">ยอดเปลี่ยนตามจำนวนผู้เข้าร่วม ไม่รวมคิวสำรองและคนถอนชื่อ เช็คจ่ายเดิมยังอยู่ ผู้จัดตรวจส่วนต่างเอง</p></div>}
      {event.hasPaymentQr && <div><p className="mb-3 font-semibold">QR จ่ายเงิน</p><button type="button" aria-label="ขยาย QR จ่ายเงิน" onClick={() => openDialog({ type: 'qr' })} className="block rounded-xl border border-border bg-white p-3"><img src={paymentQrUrl(event.id)} alt="QR จ่ายเงินที่ผู้จัดแนบ" className="max-h-64 w-56 max-w-full object-contain" /></button><p className="mt-2 text-sm text-muted-foreground">แตะรูปเพื่อขยาย</p></div>}
    </div></section>}
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted-foreground">สถานะจ่ายเงินบันทึกโดยผู้เปิดนัด{editable && ' · ติ๊กเมื่อได้รับเงินแล้ว'}</p>{editable && <Button variant="outline" disabled={pending} onClick={() => void run(() => participantForm('member'))}>+ เพิ่มรายชื่อ</Button>}</div>
    <div className="grid gap-5 md:grid-cols-2"><section className="panel"><h2 className="mb-3 text-xl font-bold">ผู้เข้าร่วม · {event.confirmed} คน</h2>{roster(event.participants)}</section><section className="panel"><h2 className="mb-3 text-xl font-bold">คิวสำรอง · {event.waiting} คน</h2><p className="mb-2 text-sm text-muted-foreground">เรียงตามลำดับลงชื่อ คนแรกได้เลื่อนเข้าแทนเมื่อมีคนถอน</p>{roster(event.waitlist)}</section></div>
    {event.withdrawn.length > 0 && <section className="panel mt-5"><h2 className="mb-2 text-xl font-bold">ถอนชื่อแล้ว · {event.withdrawn.length} คน</h2><p className="mb-2 text-sm text-muted-foreground">เก็บสถานะจ่ายไว้ให้ผู้จัดตรวจสอบ ไม่นับเป็นผู้เข้าร่วมหรือคิวสำรอง</p>{roster(event.withdrawn, true)}</section>}
    {editable && <div className="mt-6 flex gap-3"><Button variant="outline" disabled={pending} onClick={() => onEdit(event)}>แก้ไขนัด</Button><Button variant="outline" disabled={pending} className="text-red-800" onClick={() => openDialog({ type: 'cancel' })}>ยกเลิกนัด</Button></div>}
    <EventMatches event={event} onError={onError} onWorking={onWorking} notify={notify} onChanged={() => void refresh().catch(onError)} />
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open && !pending) setDialog(null); }}><DialogContent showCloseButton={!pending} className="max-h-[90dvh] overflow-y-auto bg-surface" onEscapeKeyDown={e => { if (pending) e.preventDefault(); }} onInteractOutside={e => { if (pending) e.preventDefault(); }} onCloseAutoFocus={e => { e.preventDefault(); const target = dialogTrigger.current; (target?.isConnected ? target : document.getElementById('page-title'))?.focus({ preventScroll: true }); }}>
      {dialog?.type === 'participant' && <ParticipantForm eventId={event.id} draft={dialog.draft} onPending={value => { lock.current = value; revision.current++; setPending(value); }} onClose={() => setDialog(null)} onError={onError} onSaved={updated => { setEvent(updated); setDialog(null); notify(dialog.draft.mode === 'link' ? 'ผูกบัญชีแล้ว' : dialog.draft.mode === 'rename' ? 'บันทึกชื่อแล้ว' : 'เพิ่มรายชื่อแล้ว'); }} />}
      {dialog?.type === 'remove' && <><DialogTitle>ถอนชื่อ {dialog.person.nickname}?</DialogTitle><DialogDescription>เก็บสถานะจ่ายเงินไว้ และเพิ่มกลับได้จากส่วนถอนชื่อแล้ว คนในคิวสำรองจะเลื่อนเข้าแทนตามลำดับ</DialogDescription><Button disabled={pending} variant="destructive" onClick={() => void run(() => mutate('/participants/' + encodeURIComponent(dialog.person.id), 'DELETE', {}, 'ถอนชื่อแล้ว · เก็บสถานะจ่ายเดิม'))}>ยืนยันถอนชื่อ</Button></>}
      {dialog?.type === 'cancel' && <><DialogTitle>ยกเลิกนัดนี้?</DialogTitle><DialogDescription>นัดจะไม่รับลงชื่อเพิ่ม และสมาชิกยังดูประวัติรายชื่อได้</DialogDescription><Button disabled={pending} variant="destructive" onClick={() => void run(() => mutate('/cancel', 'POST', {}, 'ยกเลิกนัดแล้ว'))}>ยืนยันยกเลิกนัด</Button></>}
      {dialog?.type === 'qr' && <><DialogTitle>QR จ่ายเงิน</DialogTitle><DialogDescription>รูป QR จ่ายเงินที่ผู้จัดแนบ</DialogDescription><img src={paymentQrUrl(event.id)} alt="QR จ่ายเงินขนาดใหญ่" className="mx-auto max-h-[60dvh] max-w-full bg-white object-contain" /></>}
      {dialog?.type === 'share' && <><DialogTitle>ลิงก์นัดสำหรับแชร์ในกลุ่ม</DialogTitle><DialogDescription>คนที่มีลิงก์นี้เข้าร่วมกลุ่มและลงชื่อได้</DialogDescription><Label htmlFor="share-text">คัดลอกข้อความไปส่งใน LINE</Label><Textarea id="share-text" rows={7} readOnly value={dialog.text} onFocus={e => e.target.select()} /></>}
      {dialog && dialog.type !== 'participant' && <>{error && <p role="alert" className="text-sm text-red-800">{error}</p>}<Button variant="outline" disabled={pending} onClick={() => setDialog(null)}>{dialog.type === 'qr' || dialog.type === 'share' ? 'ปิด' : 'กลับไปก่อน'}</Button></>}
    </DialogContent></Dialog>
  </div>;
}
