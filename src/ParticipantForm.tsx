import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  Combobox, ComboboxInput, ComboboxContent, ComboboxEmpty, ComboboxList,
  ComboboxItem, ComboboxChips, ComboboxChip, ComboboxChipsInput, ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { api, errorMessage, eventPath, type EventDetail, type Member, type Participant } from './lib/api';

export type ParticipantDraft = { mode: 'member' | 'rename' | 'link'; person?: Participant; members: Member[] };
export function ParticipantForm({ eventId, draft, onSaved, onClose, onError, onPending }: {
  eventId: string; draft: ParticipantDraft; onSaved(event: EventDetail): void; onClose(): void;
  onError(error: unknown): void; onPending(pending: boolean): void;
}) {
  const [typing, setTyping] = useState(draft.mode === 'rename');
  const [nickname, setNickname] = useState(draft.person?.nickname || "");
  const [selectedMembers, setSelectedMembers] = useState<Member[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const chipsRef = useComboboxAnchor();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const linking = draft.mode === 'link', renaming = draft.mode === 'rename';
  async function save(e: FormEvent) {
    e.preventDefault(); if (pending) return;
    if (!typing && !selectedMembers.length) {
      setError("กรุณาเลือกสมาชิกอย่างน้อยหนึ่งคน");
      return;
    }
    setPending(true); onPending(true); setError('');
    try {
      const data = typing ? { nickname } : linking
        ? { memberId: selectedMembers[0].id }
        : { memberIds: selectedMembers.map((member) => member.id) };
      const path = eventPath(eventId) + '/participants' + (draft.person ? '/' + encodeURIComponent(draft.person.id) : '');
      const result = await api<{ event: EventDetail }>(path, draft.person ? 'PATCH' : 'POST', data);
      onSaved(result.event);
    } catch (err) { setError(errorMessage(err)); onError(err); }
    finally { setPending(false); onPending(false); }
  }
  const options = (
    <ComboboxContent anchor={linking ? undefined : chipsRef} container={formRef}>
      <ComboboxEmpty>ไม่พบสมาชิก</ComboboxEmpty>
      <ComboboxList>
        {(member: Member) => (
          <ComboboxItem key={member.id} value={member} className="min-h-11 break-all">
            {member.nickname}
          </ComboboxItem>
        )}
      </ComboboxList>
    </ComboboxContent>
  );
  return <>
    <DialogTitle>{linking ? 'ผูกบัญชีให้ ' + draft.person?.nickname : renaming ? 'แก้ชื่อที่เพิ่ม' : 'เพิ่มรายชื่อ'}</DialogTitle>
    <DialogDescription>{linking ? 'เลือกบัญชีของเจ้าของชื่อนี้ หากลงชื่อซ้ำจะรวมเป็นคนเดียว ใช้คิวที่ลงก่อนและเก็บสถานะจ่ายแล้วจากทั้งสองรายการ' : renaming ? 'เปลี่ยนเฉพาะชื่อในนัดนี้' : 'ต่อท้ายคิวตามลำดับ เมื่อเต็มจะเข้าคิวสำรอง'}</DialogDescription>
    <form ref={formRef} onSubmit={save} aria-busy={pending}><fieldset disabled={pending} className="space-y-4">
      {!linking && !renaming && <div><Label htmlFor="participant-mode">วิธีเพิ่ม</Label><NativeSelect id="participant-mode" value={typing ? 'name' : 'member'} onChange={e => setTyping(e.target.value === 'name')} className="mt-2"><option value="member">เลือกสมาชิกที่มีบัญชี</option><option value="name">พิมพ์ชื่อคนที่ยังไม่มีบัญชี</option></NativeSelect></div>}
      {typing ? <div><Label htmlFor="participant-nickname">ชื่อเล่น</Label><Input id="participant-nickname" name="nickname" required maxLength={40} autoComplete="off" value={nickname} onChange={e => setNickname(e.target.value)} className="mt-2" /></div> : <div><Label htmlFor="participant-member">สมาชิก</Label>
              {linking ? (
                <Combobox
                  items={draft.members}
                  value={selectedMembers[0] || null}
                  onValueChange={(member) => setSelectedMembers(member ? [member] : [])}
                  itemToStringLabel={(member) => member.nickname || ""}
                  itemToStringValue={(member) => member.id}
                  disabled={pending}
                >
                  <ComboboxInput id="participant-member" placeholder="ค้นหาและเลือกสมาชิก" className="mt-2" />
                  {options}
                </Combobox>
              ) : (
                <Combobox
                  multiple
                  items={draft.members}
                  value={selectedMembers}
                  onValueChange={setSelectedMembers}
                  itemToStringLabel={(member) => member.nickname || ""}
                  itemToStringValue={(member) => member.id}
                  disabled={pending}
                >
                  <ComboboxChips ref={chipsRef} className="mt-2">
                    <ComboboxValue>
                      {selectedMembers.map((member) => (
                        <ComboboxChip key={member.id} className="whitespace-normal break-all">
                          {member.nickname}
                        </ComboboxChip>
                      ))}
                    </ComboboxValue>
                    <ComboboxChipsInput id="participant-member" placeholder="ค้นหาและเลือกสมาชิก" className="min-h-10" />
                  </ComboboxChips>
                  {options}
                </Combobox>
              )}
              {!linking && <p className="mt-2 text-sm text-muted-foreground">เลือกได้หลายคน · เพิ่มตามลำดับที่เลือก</p>}
</div>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-3"><Button type="submit">{pending ? 'กำลังบันทึก…' : linking ? 'ยืนยันผูกบัญชี' : renaming ? 'บันทึกชื่อ' : 'เพิ่มรายชื่อ'}</Button><Button type="button" variant="outline" onClick={onClose}>กลับไปก่อน</Button></div>
    </fieldset></form>
  </>;
}
