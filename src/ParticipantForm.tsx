import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { api, errorMessage, eventPath, type EventDetail, type Member, type Participant } from './lib/api';

export type ParticipantDraft = { mode: 'member' | 'rename' | 'link'; person?: Participant; members: Member[] };
export function ParticipantForm({ eventId, draft, onSaved, onClose, onError, onPending }: {
  eventId: string; draft: ParticipantDraft; onSaved(event: EventDetail): void; onClose(): void;
  onError(error: unknown): void; onPending(pending: boolean): void;
}) {
  const [typing, setTyping] = useState(draft.mode === 'rename');
  const [nickname, setNickname] = useState(draft.person?.nickname || ''), [memberId, setMemberId] = useState('');
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const linking = draft.mode === 'link', renaming = draft.mode === 'rename';
  async function save(e: FormEvent) {
    e.preventDefault(); if (pending) return;
    setPending(true); onPending(true); setError('');
    try {
      const data = typing ? { nickname } : { memberId };
      const path = eventPath(eventId) + '/participants' + (draft.person ? '/' + encodeURIComponent(draft.person.id) : '');
      const result = await api<{ event: EventDetail }>(path, draft.person ? 'PATCH' : 'POST', data);
      onSaved(result.event);
    } catch (err) { setError(errorMessage(err)); onError(err); }
    finally { setPending(false); onPending(false); }
  }
  return <>
    <DialogTitle>{linking ? 'ผูกบัญชีให้ ' + draft.person?.nickname : renaming ? 'แก้ชื่อที่เพิ่ม' : 'เพิ่มรายชื่อ'}</DialogTitle>
    <DialogDescription>{linking ? 'เลือกบัญชีของเจ้าของชื่อนี้ หากลงชื่อซ้ำจะรวมเป็นคนเดียว ใช้คิวที่ลงก่อนและเก็บสถานะจ่ายแล้วจากทั้งสองรายการ' : renaming ? 'เปลี่ยนเฉพาะชื่อในนัดนี้' : 'ต่อท้ายคิวตามลำดับ เมื่อเต็มจะเข้าคิวสำรอง'}</DialogDescription>
    <form onSubmit={save} aria-busy={pending}><fieldset disabled={pending} className="space-y-4">
      {!linking && !renaming && <div><Label htmlFor="participant-mode">วิธีเพิ่ม</Label><NativeSelect id="participant-mode" value={typing ? 'name' : 'member'} onChange={e => setTyping(e.target.value === 'name')} className="mt-2"><option value="member">เลือกสมาชิกที่มีบัญชี</option><option value="name">พิมพ์ชื่อคนที่ยังไม่มีบัญชี</option></NativeSelect></div>}
      {typing ? <div><Label htmlFor="participant-nickname">ชื่อเล่น</Label><Input id="participant-nickname" name="nickname" required maxLength={40} autoComplete="off" value={nickname} onChange={e => setNickname(e.target.value)} className="mt-2" /></div> : <div><Label htmlFor="participant-member">สมาชิก</Label><NativeSelect id="participant-member" name="memberId" required value={memberId} onChange={e => setMemberId(e.target.value)} className="mt-2"><option value="">เลือกสมาชิก</option>{draft.members.map(m => <option key={m.id} value={m.id}>{m.nickname}</option>)}</NativeSelect></div>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit">{pending ? 'กำลังบันทึก…' : linking ? 'ยืนยันผูกบัญชี' : renaming ? 'บันทึกชื่อ' : 'เพิ่มรายชื่อ'}</Button><Button type="button" variant="outline" onClick={onClose}>กลับไปก่อน</Button></div>
    </fieldset></form>
  </>;
}
