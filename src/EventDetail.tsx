import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EventBadge } from "./EventList";
import { EventMatches } from "./EventMatches";
import {
  api,
  type EventDetail as Detail,
  dateLabel,
  errorMessage,
  eventPath,
  type Member,
  money,
  type Participant,
  paymentQrUrl,
} from "./lib/api";
import type { Config, LineSession } from "./line-session";
import { type ParticipantDraft, ParticipantForm } from "./ParticipantForm";

type DialogState =
  | { type: "participant"; draft: ParticipantDraft }
  | { type: "remove"; person: Participant }
  | { type: "cancel" | "qr" | "withdraw" }
  | { type: "share"; text: string }
  | null;
export function EventDetail({
  initial,
  member,
  config,
  line,
  onBack,
  onEdit,
  onError,
  notify,
  onWorking,
}: {
  initial: Detail;
  member: Member;
  config: Config;
  line: LineSession;
  onBack(): void;
  onEdit(event: Detail): void;
  onError(error: unknown): void;
  notify(message: string): void;
  onWorking(pending: boolean): void;
}) {
  const [event, setEvent] = useState(initial),
    [dialog, setDialog] = useState<DialogState>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    onWorking(pending);
    return () => onWorking(false);
  }, [pending, onWorking]);
  const revision = useRef(0),
    lock = useRef(false);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const dialogCancel = useRef<HTMLButtonElement | null>(null);
  const path = eventPath(event.id),
    canManage = event.canManage ?? event.isOrganizer,
    editable = canManage && !event.cancelled && !event.ended;
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    revision.current++;
    setPending(true);
    setError("");
    try {
      await work();
    } catch (err) {
      setError(errorMessage(err));
      onError(err);
    } finally {
      lock.current = false;
      setPending(false);
    }
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
        void api<{ event: Detail }>(path)
          .then((result) => {
            if (active && revision.current === current) setEvent(result.event);
          })
          .catch((err) => {
            if (active) onError(err);
          });
      }
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [path, pending, dialog, onError]);
  async function mutate(
    suffix: string,
    method: string,
    data: unknown,
    message: string,
  ) {
    const result = await api<{ event: Detail }>(path + suffix, method, data);
    setEvent(result.event);
    setDialog(null);
    notify(message);
  }
  function openDialog(next: DialogState, trigger = document.activeElement) {
    dialogTrigger.current = trigger instanceof HTMLElement ? trigger : null;
    setError("");
    setDialog(next);
  }
  async function participantForm(
    mode: ParticipantDraft["mode"],
    person?: Participant,
  ) {
    const trigger = document.activeElement;
    const members =
      mode === "rename"
        ? []
        : (await api<{ members: Member[] }>(path + "/available-members"))
            .members;
    openDialog(
      { type: "participant", draft: { mode, person, members } },
      trigger,
    );
  }
  async function signup() {
    const withdrawing = Boolean(event.myPosition);
    const result = await api<{ event: Detail }>(
      path + "/signup",
      withdrawing ? "DELETE" : "POST",
      {},
    );
    setEvent(result.event);
    setDialog(null);
    const promoted = event.waitlist[0];
    notify(
      withdrawing
        ? "ถอนชื่อแล้ว" +
            (event.myPosition! <= event.capacity && promoted
              ? " · " + promoted.nickname + " ได้เลื่อนเข้าแทน"
              : "")
        : result.event.myPosition! > result.event.capacity
          ? "เข้าคิวสำรองแล้ว"
          : "ลงชื่อเรียบร้อยแล้ว",
    );
  }
  async function share() {
    const trigger = document.activeElement;
    const { event: current } = await api<{ event: Detail }>(path);
    setEvent(current);
    const { url } = await api<{ url: string }>("/invite");
    const link = new URL(url);
    link.searchParams.set("event", current.id);
    const full = current.confirmed >= current.capacity;
    const billing =
      !current.cancelled &&
      (full || current.ended) &&
      current.sharePerPersonSatang != null;
    const lines = [
      current.cancelled
        ? "นัดนี้ยกเลิกแล้ว"
        : current.ended
          ? "สรุปนัดที่จบแล้ว 🎾"
          : billing
            ? "คนครบแล้ว เย้!! ได้เวลาโอนค่าตีน้าาา 🎾"
            : full
              ? "คนครบแล้ว 🎾"
              : "ชวนมาตีเทนนิส 🎾",
      current.title,
      "📅 " +
        dateLabel(current.date) +
        " · " +
        current.start +
        "–" +
        current.end,
      "📍 " + current.venue + " · คอร์ท " + current.courtNames,
      "ผู้จัด: " + current.organizerName,
      "ผู้ได้ที่ " +
        current.confirmed +
        "/" +
        current.capacity +
        " คน · คิวสำรอง " +
        current.waiting +
        " คน",
    ];
    if (!current.cancelled && current.totalCostSatang != null) {
      lines.push(
        "",
        "💰 ค่าใช้จ่ายรวม " + money(current.totalCostSatang) + " บาท",
      );
      if (current.sharePerPersonSatang != null)
        lines.push(
          (full || current.ended ? "คนละ " : "ยอดหารปัจจุบันคนละ ") +
            money(current.sharePerPersonSatang) +
            " บาท (หารผู้ได้ที่ " +
            current.sharePeople +
            " คน)",
        );
      if (!full && !current.ended)
        lines.push("ยอดต่อคนอาจเปลี่ยนเมื่อจำนวนผู้ได้ที่เปลี่ยน");
    }
    const footer = [
      "",
      billing
        ? current.hasPaymentQr
          ? "เปิดนัดเพื่อดู QR และตรวจยอดล่าสุดก่อนโอน แล้วติ๊ก ‘จ่ายแล้ว’ ด้วยน้าาา 🙏"
          : "เปิดนัดเพื่อตรวจยอดล่าสุด และติดต่อผู้จัดเรื่องช่องทางโอน แล้วติ๊ก ‘จ่ายแล้ว’ ด้วยน้าาา 🙏"
        : current.cancelled
          ? "ดูรายละเอียดนัด"
          : current.ended
            ? "เปิดนัด / ดูรายชื่อ"
            : "เปิดนัด / ดูรายชื่อ / ลงชื่อ",
      link.href,
    ].join("\n");
    const lists = [
      "",
      "ผู้ได้ที่",
      ...current.participants.map(
        (person, i) => i + 1 + ". " + person.nickname,
      ),
      ...(current.waitlist.length
        ? [
            "",
            "คิวสำรอง",
            ...current.waitlist.map(
              (person, i) => i + 1 + ". " + person.nickname,
            ),
          ]
        : []),
    ].join("\n");
    const summary = lines.join("\n");
    const text =
      summary +
      (summary.length + lists.length + footer.length <= 5000
        ? lists
        : "\n\nดูรายชื่อทั้งหมดและคิวสำรองในนัด") +
      footer;
    const result = await line.share(config, text);
    if (result === "shared") notify("แชร์นัดแล้ว");
    if (result === "copied") notify("คัดลอกข้อความแล้ว นำไปส่งในกลุ่ม LINE ได้เลย");
    if (result === "manual") openDialog({ type: "share", text }, trigger);
  }
  function paymentStatus(p: Participant, label: string) {
    return !event.cancelled && (canManage || p.id === member.id) ? (
      <Label className="flex min-h-11 shrink-0 gap-2 text-sm font-normal">
        <Checkbox
          checked={p.paid}
          disabled={pending}
          aria-label={label}
          onCheckedChange={(paid) =>
            void run(() =>
              mutate(
                "/payment",
                "PATCH",
                { memberId: p.id, paid: paid === true },
                "บันทึกสถานะจ่ายเงินแล้ว",
              ),
            )
          }
        />
        <span>{p.paid ? "จ่ายแล้ว" : "ยังไม่จ่าย"}</span>
      </Label>
    ) : (
      <span
        className={
          "shrink-0 text-sm " +
          (p.paid ? "font-semibold text-leaf" : "text-muted-foreground")
        }
      >
        {p.paid ? "จ่ายแล้ว" : "ยังไม่จ่าย"}
      </span>
    );
  }
  function roster(people: Participant[], withdrawn = false) {
    const action = (p: Participant, label: string, work: () => void) => (
      <Button
        key={label}
        variant="link"
        disabled={pending}
        aria-label={label + ": " + p.nickname}
        onClick={work}
        className="px-0"
      >
        {label}
      </Button>
    );
    return people.length ? (
      <ol className="divide-y divide-border">
        {people.map((p, i) => (
          <li key={p.id} className="py-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="relative grid size-9 shrink-0 place-items-center rounded-full bg-sage text-sm"
              >
                {Array.from(p.nickname)[0]}
                {p.pictureUrl && (
                  <img
                    key={p.pictureUrl}
                    src={p.pictureUrl}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="absolute inset-0 size-9 rounded-full object-cover"
                    onError={(e) => {
                      e.currentTarget.hidden = true;
                    }}
                  />
                )}
                <small className="absolute -right-1 -bottom-1 rounded-full bg-background px-1 text-xs">
                  {i + 1}
                </small>
              </span>
              <span className="min-w-0 flex-1 break-words">
                {p.nickname}
                {p.id === member.id && (
                  <small className="ml-2 text-leaf">คุณ</small>
                )}
                {p.isGuest && (
                  <small className="mt-1 block text-xs text-muted-foreground">
                    เพิ่มโดยผู้จัด
                  </small>
                )}
              </span>
              {paymentStatus(p, "จ่ายแล้ว: " + p.nickname)}
            </div>
            {editable && (
              <div className="ml-12 flex flex-wrap gap-x-4">
                {withdrawn
                  ? action(
                      p,
                      "เพิ่มกลับ",
                      () =>
                        void run(() =>
                          mutate(
                            "/participants",
                            "POST",
                            { memberId: p.id },
                            "เพิ่มกลับแล้ว · เก็บสถานะจ่ายเดิม",
                          ),
                        ),
                    )
                  : action(p, "ถอนชื่อ", () =>
                      openDialog({ type: "remove", person: p }),
                    )}
                {p.isGuest && (
                  <>
                    {action(
                      p,
                      "แก้ชื่อ",
                      () => void run(() => participantForm("rename", p)),
                    )}
                    {action(
                      p,
                      "ผูกบัญชี",
                      () => void run(() => participantForm("link", p)),
                    )}
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    ) : (
      <p className="py-3 text-muted-foreground">ยังไม่มีรายชื่อ</p>
    );
  }
  const status = !event.myPosition
    ? event.withdrawn.some((person) => person.id === member.id)
      ? "คุณถอนชื่อแล้ว"
      : "ยังไม่ได้ลงชื่อ"
    : event.myPosition <= event.capacity
      ? "คุณได้ที่ในนัดนี้แล้ว"
      : "คุณอยู่คิวสำรองลำดับ " + (event.myPosition - event.capacity);
  const myRecord = [
    ...event.participants,
    ...event.waitlist,
    ...event.withdrawn,
  ].find((person) => person.id === member.id);
  const myConfirmed = event.participants.some(
    (person) => person.id === member.id,
  );
  const fact = (label: string, value: string) => (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
  return (
    <div aria-busy={pending}>
      <div className="mb-3 flex justify-between md:mb-6">
        <Button variant="ghost" disabled={pending} onClick={onBack}>
          ← นัดทั้งหมด
        </Button>
        <Button
          variant="link"
          disabled={pending}
          onClick={() => void run(refresh)}
        >
          อัปเดตรายชื่อ
        </Button>
      </div>
      <div className="mb-5 grid gap-3 md:grid-cols-[1.4fr_1fr] md:gap-5">
        <section className="panel">
          <EventBadge event={event} />
          <h1
            id="page-title"
            tabIndex={-1}
            className="my-2 text-2xl font-bold md:my-4 md:text-3xl"
          >
            {event.title}
          </h1>
          <p>{event.venue}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 md:mt-6 md:gap-5">
            {fact("วันตี", dateLabel(event.date))}
            {fact("เวลา", event.start + "–" + event.end)}
            {fact("คอร์ตที่จอง", event.courtNames)}
            {fact("ผู้จัดนัด", event.organizerName)}
          </dl>
        </section>
        <aside className="panel flex flex-col justify-center bg-sage">
          <p className="hidden text-xs font-semibold tracking-wide text-leaf md:block">
            ลงชื่อทั้งนัด
          </p>
          <p className="order-first font-semibold md:order-last md:mt-3">
            {event.cancelled ? "นัดนี้ยกเลิกแล้ว" : status}
          </p>
          <p className="my-1 text-base md:my-3 md:text-5xl md:font-bold">
            {event.confirmed}{" "}
            <span className="font-normal md:text-xl">
              / {event.capacity} คน
            </span>
          </p>
          <p>คิวสำรอง {event.waiting} คน</p>
          {myRecord && (
            <section
              className="mt-3 border-t border-border pt-3 md:hidden"
              aria-label="สรุปของฉัน"
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <p>
                  {event.cancelled
                    ? "สถานะจ่ายที่บันทึกไว้"
                    : myConfirmed
                      ? event.sharePerPersonSatang != null
                        ? (event.ended ? "ยอดเมื่อจบนัด " : "ยอดปัจจุบัน ") +
                          money(event.sharePerPersonSatang) +
                          " บาท/คน"
                        : "ยังไม่ระบุยอดต่อคน"
                      : "ไม่รวมในยอดหาร"}
                </p>
                {paymentStatus(myRecord, "สถานะจ่ายของฉัน")}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                บันทึกด้วยมือ ไม่ยืนยันยอดโอน
                {myConfirmed &&
                  !event.ended &&
                  !event.cancelled &&
                  " · ยอดเปลี่ยนได้แม้ติ๊กจ่ายแล้ว"}
              </p>
              {event.hasPaymentQr && !event.cancelled && (
                <Button
                  variant="outline"
                  disabled={pending}
                  className="mt-3 w-full"
                  onClick={() => openDialog({ type: "qr" })}
                >
                  ดู QR จ่ายเงิน
                </Button>
              )}
            </section>
          )}
        </aside>
      </div>
      {event.ended && !event.cancelled && (
        <p className="mb-5 rounded-xl bg-sage p-4">
          นัดนี้จบแล้ว ไม่รับลงชื่อหรือแก้รายชื่อและรายละเอียดนัด ยังบันทึกสถานะจ่ายเงินและผลแมตช์ได้
        </p>
      )}
      {event.cancelled ? (
        <p className="mb-5 rounded-xl bg-sage p-4">
          นัดนี้ยกเลิกแล้ว รายชื่อด้านล่างเป็นประวัติของนัด
        </p>
      ) : (
        <div className="mb-5 flex flex-wrap gap-3">
          <Button
            disabled={pending || event.ended}
            variant={event.myPosition ? "ghost" : "default"}
            onClick={() =>
              event.myPosition
                ? openDialog({ type: "withdraw" })
                : void run(signup)
            }
            className={event.myPosition ? "text-red-800" : "flex-1"}
          >
            {event.ended
              ? "นัดจบแล้ว"
              : event.myPosition
                ? "ถอนชื่อของฉัน"
                : event.confirmed >= event.capacity
                  ? "เข้าคิวสำรอง"
                  : "ลงชื่อนัดนี้"}
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void run(share)}
          >
            แชร์นัดใน LINE
          </Button>
        </div>
      )}
      {(event.totalCostSatang != null || event.hasPaymentQr) && (
        <section className="panel mb-5">
          <h2 className="mb-4 text-xl font-bold">ค่าใช้จ่ายและการจ่ายเงิน</h2>
          <div
            className={
              "grid gap-6 " + (event.hasPaymentQr ? "sm:grid-cols-2" : "")
            }
          >
            {event.totalCostSatang != null && (
              <div>
                <dl className="space-y-2">
                  {event.courtCostSatang != null && (
                    <div className="flex justify-between gap-3">
                      <dt>ค่าคอร์ตรวม</dt>
                      <dd>{money(event.courtCostSatang)} บาท</dd>
                    </div>
                  )}
                  {event.ballCostSatang != null && (
                    <div className="flex justify-between gap-3">
                      <dt>ค่าลูกเทนนิสรวม</dt>
                      <dd>{money(event.ballCostSatang)} บาท</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-3 border-t border-border pt-3 font-semibold">
                    <dt>รวมค่าใช้จ่ายที่ระบุ</dt>
                    <dd>{money(event.totalCostSatang)} บาท</dd>
                  </div>
                </dl>
                {event.sharePerPersonSatang == null ? (
                  <p className="mt-5 text-muted-foreground">
                    รอผู้เข้าร่วมเพื่อคำนวณยอดต่อคน
                  </p>
                ) : (
                  <div className="mt-5 rounded-xl bg-sage p-4">
                    <p className="text-sm">
                      {event.ended ? "ยอดหารเมื่อจบนัด" : "ยอดหารปัจจุบัน"}
                      {" · ผู้ได้ที่ "}
                      {event.sharePeople} คน
                    </p>
                    <p className="mt-2 text-3xl font-bold">
                      {money(event.sharePerPersonSatang)}{" "}
                      <span className="text-base font-normal">บาท/คน</span>
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      ปัดขึ้นเป็นบาท · ส่วนเกินรวม{" "}
                      {money(event.roundingSurplusSatang!)} บาท
                    </p>
                    <p className="mt-3 text-sm">
                      {event.ended
                        ? "ไม่รวมคิวสำรองและคนถอนชื่อ"
                        : "ยอดต่อคนเปลี่ยนได้เมื่อจำนวนผู้ได้ที่เปลี่ยน แม้ติ๊กจ่ายแล้ว โปรดเทียบยอดที่โอนกับยอดล่าสุด ผู้จัดตรวจส่วนต่างเอง"}
                    </p>
                  </div>
                )}
              </div>
            )}
            {event.hasPaymentQr && (
              <div>
                <p className="mb-3 font-semibold">QR จ่ายเงิน</p>
                <button
                  type="button"
                  aria-label="ขยาย QR จ่ายเงิน"
                  onClick={() => openDialog({ type: "qr" })}
                  className="block rounded-xl border border-border bg-white p-3"
                >
                  <img
                    src={paymentQrUrl(event.id)}
                    alt="QR จ่ายเงินที่ผู้จัดแนบ"
                    className="max-h-64 w-56 max-w-full object-contain"
                  />
                </button>
                <p className="mt-2 text-sm text-muted-foreground">
                  แตะรูปเพื่อขยาย
                </p>
              </div>
            )}
          </div>
        </section>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 basis-full space-y-1 text-sm sm:flex-1 sm:basis-auto">
          <p className="font-semibold">
            สถานะจ่ายเป็นบันทึกด้วยมือ ไม่ใช่การยืนยันยอดโอนจากธนาคาร
          </p>
          <p className="text-muted-foreground">
            สมาชิกติ๊กของตัวเองเมื่อโอนแล้ว ผู้เปิดนัดและแอดมินแก้ไขได้ทุกคน
            สถานะจ่ายเดิมยังอยู่แม้ยอดต่อคนเปลี่ยน
          </p>
        </div>
        {editable && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void run(() => participantForm("member"))}
          >
            + เพิ่มรายชื่อ
          </Button>
        )}
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel">
          <h2 className="mb-3 text-xl font-bold">
            ผู้เข้าร่วม · {event.confirmed} คน
          </h2>
          {roster(event.participants)}
        </section>
        <section className="panel">
          <h2 className="mb-3 text-xl font-bold">
            คิวสำรอง · {event.waiting} คน
          </h2>
          <p className="mb-2 text-sm text-muted-foreground">
            {event.ended
              ? "คิวสำรองเมื่อจบนัด เรียงตามลำดับลงชื่อ"
              : "เรียงตามลำดับลงชื่อ คนแรกได้เลื่อนเข้าแทนเมื่อมีคนถอน"}
          </p>
          <p className="mb-2 text-sm text-muted-foreground">
            คิวสำรองไม่รวมในยอดหาร หากจ่ายไว้แล้ว ผู้จัดตรวจสอบยอดแยก
          </p>
          {roster(event.waitlist)}
        </section>
      </div>
      {event.withdrawn.length > 0 && (
        <section className="panel mt-5">
          <h2 className="mb-2 text-xl font-bold">
            ถอนชื่อแล้ว · {event.withdrawn.length} คน
          </h2>
          <p className="mb-2 text-sm text-muted-foreground">
            ไม่รวมในยอดหารและไม่ใช้ที่นั่ง เก็บสถานะจ่ายเดิมไว้ให้ผู้จัดตรวจสอบยอดที่จ่ายไว้
          </p>
          {roster(event.withdrawn, true)}
        </section>
      )}
      {editable && (
        <div className="mt-6 flex gap-3">
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => onEdit(event)}
          >
            แก้ไขนัด
          </Button>
          <Button
            variant="outline"
            disabled={pending}
            className="text-red-800"
            onClick={() => openDialog({ type: "cancel" })}
          >
            ยกเลิกนัด
          </Button>
        </div>
      )}
      <EventMatches
        event={event}
        onError={onError}
        onWorking={onWorking}
        notify={notify}
        onChanged={() => void refresh().catch(onError)}
      />
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null);
        }}
      >
        <DialogContent
          showCloseButton={!pending}
          className="max-h-[90dvh] overflow-y-auto bg-surface"
          onOpenAutoFocus={(e) => {
            if (dialog?.type === "withdraw") {
              e.preventDefault();
              dialogCancel.current?.focus();
            }
          }}
          onEscapeKeyDown={(e) => {
            if (pending) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (pending) e.preventDefault();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const target = dialogTrigger.current;
            (target?.isConnected
              ? target
              : document.getElementById("page-title")
            )?.focus({ preventScroll: true });
          }}
        >
          {dialog?.type === "participant" && (
            <ParticipantForm
              eventId={event.id}
              draft={dialog.draft}
              onPending={(value) => {
                lock.current = value;
                revision.current++;
                setPending(value);
              }}
              onClose={() => setDialog(null)}
              onError={onError}
              onSaved={(updated) => {
                setEvent(updated);
                setDialog(null);
                notify(
                  dialog.draft.mode === "link"
                    ? "ผูกบัญชีแล้ว"
                    : dialog.draft.mode === "rename"
                      ? "บันทึกชื่อแล้ว"
                      : "เพิ่มรายชื่อแล้ว",
                );
              }}
            />
          )}
          {dialog?.type === "withdraw" && (
            <>
              <DialogTitle>ถอนชื่อของฉัน?</DialogTitle>
              <DialogDescription>
                {event.myPosition! <= event.capacity
                  ? "คุณจะเสียที่ในนัดนี้ คนแรกในคิวสำรองจะเลื่อนเข้าแทนหากมีคนรอ"
                  : "คุณจะออกจากคิวสำรอง"}
                {" หากลงชื่อใหม่ จะเรียงต่อท้ายตามลำดับลงชื่อ สถานะจ่ายเงินเดิมยังอยู่"}
              </DialogDescription>
              <Button
                disabled={pending}
                variant="destructive"
                onClick={() => void run(signup)}
              >
                {pending ? "กำลังถอนชื่อ…" : "ยืนยันถอนชื่อ"}
              </Button>
            </>
          )}
          {dialog?.type === "remove" && (
            <>
              <DialogTitle>ถอนชื่อ {dialog.person.nickname}?</DialogTitle>
              <DialogDescription>
                เก็บสถานะจ่ายเงินไว้ และเพิ่มกลับได้จากส่วนถอนชื่อแล้ว
                คนในคิวสำรองจะเลื่อนเข้าแทนตามลำดับ
              </DialogDescription>
              <Button
                disabled={pending}
                variant="destructive"
                onClick={() =>
                  void run(() =>
                    mutate(
                      "/participants/" + encodeURIComponent(dialog.person.id),
                      "DELETE",
                      {},
                      "ถอนชื่อแล้ว · เก็บสถานะจ่ายเดิม",
                    ),
                  )
                }
              >
                ยืนยันถอนชื่อ
              </Button>
            </>
          )}
          {dialog?.type === "cancel" && (
            <>
              <DialogTitle>ยกเลิกนัดนี้?</DialogTitle>
              <DialogDescription>
                นัดจะไม่รับลงชื่อเพิ่ม และสมาชิกยังดูประวัติรายชื่อได้
              </DialogDescription>
              <Button
                disabled={pending}
                variant="destructive"
                onClick={() =>
                  void run(() => mutate("/cancel", "POST", {}, "ยกเลิกนัดแล้ว"))
                }
              >
                ยืนยันยกเลิกนัด
              </Button>
            </>
          )}
          {dialog?.type === "qr" && (
            <>
              <DialogTitle>QR จ่ายเงิน</DialogTitle>
              <DialogDescription>รูป QR จ่ายเงินที่ผู้จัดแนบ</DialogDescription>
              <img
                src={paymentQrUrl(event.id)}
                alt="QR จ่ายเงินขนาดใหญ่"
                className="mx-auto max-h-[60dvh] max-w-full bg-white object-contain"
              />
            </>
          )}
          {dialog?.type === "share" && (
            <>
              <DialogTitle>ลิงก์นัดสำหรับแชร์ในกลุ่ม</DialogTitle>
              <DialogDescription>คนที่มีลิงก์นี้เข้าร่วมกลุ่มและลงชื่อได้</DialogDescription>
              <Label htmlFor="share-text">คัดลอกข้อความไปส่งใน LINE</Label>
              <Textarea
                id="share-text"
                rows={7}
                readOnly
                value={dialog.text}
                onFocus={(e) => e.target.select()}
              />
            </>
          )}
          {dialog && dialog.type !== "participant" && (
            <>
              {error && (
                <p role="alert" className="text-sm text-red-800">
                  {error}
                </p>
              )}
              <Button
                ref={dialogCancel}
                variant="outline"
                disabled={pending}
                onClick={() => setDialog(null)}
              >
                {dialog.type === "qr" || dialog.type === "share"
                  ? "ปิด"
                  : "กลับไปก่อน"}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
