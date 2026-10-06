import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, errorMessage, eventPath, paymentQrUrl, type EventDetail, type EventFields } from './lib/api';

function today() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}
function costSatang(value: string) {
  if (value === '') return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('ค่าใช้จ่ายต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง');
  const [baht, fraction = ''] = value.split('.');
  const satang = Number(baht) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(satang)) throw new Error('ค่าใช้จ่ายสูงเกินไป');
  return satang;
}
async function readPaymentQr(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) throw new Error('รูป QR ต้องไม่เกิน 2 MB');
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('รูป QR ต้องเป็นไฟล์ PNG หรือ JPEG');
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('อ่านรูป QR ไม่สำเร็จ กรุณาเลือกไฟล์อีกครั้ง'));
    reader.readAsDataURL(file);
  });
  const image = new Image(); image.src = src;
  try { await image.decode(); }
  catch { throw new Error('เปิดรูป QR ไม่สำเร็จ กรุณาเลือกไฟล์ PNG หรือ JPEG ที่สมบูรณ์'); }
  return src;
}

export function EventForm({ event, onBack, onSaved, onError, onWorking }: {
  event: EventDetail | null; onBack(): void; onSaved(event: EventDetail): void; onError(error: unknown): void;
  onWorking?(pending: boolean): void;
}) {
  const initial = event || { title: '', venue: '', date: today(), start: '18:00', end: '20:00', courts: 2, capacity: 12, courtNames: '', courtCostSatang: null, ballCostSatang: null };
  const [draft, setDraft] = useState({ ...initial, courts: String(initial.courts), capacity: String(initial.capacity), courtCost: initial.courtCostSatang == null ? '' : String(initial.courtCostSatang / 100), ballCost: initial.ballCostSatang == null ? '' : String(initial.ballCostSatang / 100) });
  const [qr, setQr] = useState<{ value: string | null | undefined; preview: string }>({ value: undefined, preview: event?.hasPaymentQr ? paymentQrUrl(event.id) : '' });
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => { onWorking?.(pending); return () => onWorking?.(false); }, [pending, onWorking]);
  const fileInput = useRef<HTMLInputElement>(null);
  async function chooseFile(file?: File) {
    if (!file || pending) return;
    setPending(true); setError('');
    try { const preview = await readPaymentQr(file); setQr({ value: preview.split(',')[1], preview }); }
    catch (err) { if (fileInput.current) fileInput.current.value = ''; setError(errorMessage(err)); }
    finally { setPending(false); }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (pending) return;
    setPending(true); setError('');
    try {
      const fields: EventFields = {
        title: draft.title, venue: draft.venue, date: draft.date, start: draft.start, end: draft.end,
        courts: Number(draft.courts), capacity: Number(draft.capacity), courtNames: draft.courtNames,
        courtCostSatang: costSatang(draft.courtCost), ballCostSatang: costSatang(draft.ballCost),
        ...(qr.value === undefined ? {} : { paymentQr: qr.value }),
      };
      const result = await api<{ event: EventDetail }>(event ? eventPath(event.id) : '/events', event ? 'PATCH' : 'POST', fields);
      onSaved(result.event);
    } catch (err) { setError(errorMessage(err)); onError(err); }
    finally { setPending(false); }
  }
  function field(name: 'title' | 'venue' | 'date' | 'start' | 'end' | 'courts' | 'capacity' | 'courtNames' | 'courtCost' | 'ballCost', label: string, type: string, extra: React.ComponentProps<typeof Input> = {}, wide = false) {
    return <div className={wide ? 'col-span-2' : ''}><Label htmlFor={name}>{label}</Label><Input id={name} name={name} type={type} value={draft[name]} onChange={e => { const value = e.target.value; setDraft(current => ({ ...current, [name]: value })); }} required className="mt-2" {...extra} /></div>;
  }
  return <section className="mx-auto max-w-2xl">
    <Button variant="ghost" disabled={pending} onClick={onBack} className="mb-6">← กลับ</Button>
    <h1 id="page-title" tabIndex={-1} className="mb-3 text-3xl font-bold">{event ? 'แก้ไขนัด' : 'เปิดนัดใหม่'}</h1>
    <p className="mb-6 text-muted-foreground">ใส่รายละเอียดคอร์ตที่จองไว้ สมาชิกลงชื่อทั้งนัด</p>
    <form className="panel" onSubmit={save} aria-busy={pending}><fieldset disabled={pending}>
      <div className="grid grid-cols-2 gap-4">
        {field('title', 'ชื่อนัด', 'text', { maxLength: 80 }, true)}
        {field('venue', 'สนาม', 'text', { maxLength: 120 }, true)}
        {field('date', 'วันที่', 'date', { disabled: Boolean(event?.dateLocked) }, true)}
        {event?.dateLocked && <p className="col-span-2 text-sm text-muted-foreground">นัดนี้มีผลแมตช์แล้ว จึงเปลี่ยนวันไม่ได้เพื่อรักษารอบอันดับ</p>}
        {field('start', 'เริ่ม', 'time')}{field('end', 'สิ้นสุด', 'time')}
        {field('courts', 'จำนวนคอร์ต', 'number', { min: 1, max: 10000, step: 1 })}
        {field('capacity', 'จำนวนคนที่รับ', 'number', { min: Math.max(1, event?.confirmed || 1), max: 10000, step: 1 })}
        {field('courtNames', 'ชื่อหรือหมายเลขคอร์ต', 'text', { maxLength: 100, placeholder: 'เช่น คอร์ต 1, 2' }, true)}
      </div>
      <fieldset className="mt-6 border-t border-border pt-5"><legend className="pt-5 text-lg font-bold">ค่าใช้จ่ายและ QR (ไม่บังคับ)</legend>
        <div className="mt-4 grid grid-cols-2 gap-4">
          {field('courtCost', 'ค่าคอร์ตรวม (บาท)', 'number', { required: false, min: 0, step: '0.01', inputMode: 'decimal', placeholder: 'ไม่ระบุ' })}
          {field('ballCost', 'ค่าลูกเทนนิสรวม (บาท)', 'number', { required: false, min: 0, step: '0.01', inputMode: 'decimal', placeholder: 'ไม่ระบุ' })}
        </div>
        <p className="mt-3 text-sm text-muted-foreground">รวมค่าใช้จ่ายที่ระบุ หารเฉพาะผู้ได้ที่ในนัด และปัดขึ้นเป็นบาท</p>
        <Label htmlFor="payment-qr-file" className="mt-5">รูป QR จ่ายเงิน</Label>
        <Input ref={fileInput} id="payment-qr-file" type="file" accept="image/png,image/jpeg" className="mt-2" onChange={e => void chooseFile(e.target.files?.[0])} />
        <p className="mt-2 text-sm text-muted-foreground">PNG หรือ JPEG ไม่เกิน 2 MB</p>
        {qr.preview && <div className="mt-3"><img src={qr.preview} alt="ตัวอย่าง QR จ่ายเงิน" className="max-h-56 max-w-full rounded-xl border border-border bg-white p-2" /><Button type="button" variant="ghost" className="mt-2 text-red-800" onClick={() => { setQr({ value: null, preview: '' }); if (fileInput.current) fileInput.current.value = ''; }}>ลบรูป QR</Button></div>}
      </fieldset>
      <p className="mt-4 text-sm text-muted-foreground">เมื่อเต็ม คนถัดไปเข้าคิวสำรอง ผู้จัดต้องลงชื่อเองหากจะร่วมเล่น</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
      <Button type="submit" className="mt-6 w-full">{pending ? 'กำลังบันทึก…' : event ? 'บันทึกการแก้ไข' : 'สร้างนัด'}</Button>
    </fieldset></form>
  </section>;
}
