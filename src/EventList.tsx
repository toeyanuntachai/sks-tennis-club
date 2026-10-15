import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { api, type ClubEvent, dateLabel } from "./lib/api";

export function EventBadge({ event: e }: { event: ClubEvent }) {
  if (e.cancelled)
    return <span className="badge bg-stone-200 text-stone-600">ยกเลิกแล้ว</span>;
  if (e.ended)
    return <span className="badge bg-stone-200 text-stone-600">จบแล้ว</span>;
  if (e.myPosition && e.myPosition > e.capacity)
    return (
      <span className="badge bg-amber-100 text-amber">
        คุณอยู่คิวสำรอง {e.myPosition - e.capacity}
      </span>
    );
  if (e.myPosition) return <span className="badge">คุณลงชื่อแล้ว</span>;
  return e.confirmed >= e.capacity ? (
    <span className="badge bg-amber-100 text-amber">เต็ม · มีคิวสำรอง</span>
  ) : (
    <span className="badge">ว่าง {e.capacity - e.confirmed} ที่</span>
  );
}
export function EventList({
  onOpen,
  onCreate,
  onError,
}: {
  onOpen(id: string): void;
  onCreate(): void;
  onError(error: unknown): void;
}) {
  const [events, setEvents] = useState<ClubEvent[]>([]),
    [pending, setPending] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null),
    [refreshFailed, setRefreshFailed] = useState(false),
    [refreshNotice, setRefreshNotice] = useState("");
  const activeRequest = useRef(false),
    mounted = useRef(true);
  const refresh = useCallback(
    async (manual = false) => {
      if (activeRequest.current) return;
      activeRequest.current = true;
      setPending(true);
      setRefreshNotice(manual ? "กำลังอัปเดตนัด…" : "");
      try {
        const result = await api<{ events: ClubEvent[] }>("/events");
        if (mounted.current) {
          setEvents(result.events);
          setLoaded(true);
          setLastUpdated(new Date());
          setRefreshFailed(false);
          if (manual) setRefreshNotice("อัปเดตนัดแล้ว");
        }
      } catch (err) {
        if (mounted.current) {
          setRefreshFailed(true);
          if (manual) setRefreshNotice("อัปเดตนัดไม่สำเร็จ กรุณาลองใหม่");
          onError(err);
        }
      } finally {
        activeRequest.current = false;
        if (mounted.current) setPending(false);
      }
    },
    [onError],
  );
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    return () => {
      mounted.current = false;
      window.clearInterval(interval);
    };
  }, [refresh]);
  function rows(list: ClubEvent[]) {
    return list.map((e) => (
      <article
        key={e.id}
        className="flex flex-wrap items-center gap-4 border-b border-border py-5 last:border-0"
      >
        <div
          className={
            "w-14 shrink-0 rounded-xl py-2 text-center " +
            (e.ended || e.cancelled
              ? "bg-background text-muted-foreground"
              : "bg-sage")
          }
        >
          <b className="block text-2xl">
            {new Date(e.date + "T12:00:00").getDate()}
          </b>
          <small>
            {new Intl.DateTimeFormat("th-TH", { month: "short" }).format(
              new Date(e.date + "T12:00:00"),
            )}
          </small>
        </div>
        <div className="min-w-40 flex-1">
          <EventBadge event={e} />
          <h3 className="mt-2 text-lg font-bold">{e.title}</h3>
          <p className="text-sm text-muted-foreground">
            {dateLabel(e.date)} · {e.start}–{e.end} · {e.courts} คอร์ต
          </p>
          <p className="text-sm text-muted-foreground">{e.venue}</p>
        </div>
        <div className="ml-18 text-sm sm:ml-0">
          {e.confirmed} / {e.capacity} คน
          {e.waiting > 0 && (
            <>
              <br />
              <span className="text-muted-foreground">
                สำรอง {e.waiting} คน
              </span>
            </>
          )}
        </div>
        <Button
          variant="outline"
          onClick={() => onOpen(e.id)}
          aria-label={`${e.ended || e.cancelled ? "ดูประวัติ" : "ดูนัด"}: ${e.title} · ${dateLabel(e.date)}`}
          className="ml-auto"
        >
          {e.ended || e.cancelled ? "ดูประวัติ →" : "ดูนัด →"}
        </Button>
      </article>
    ));
  }
  const active = events
      .filter((e) => !e.cancelled && !e.ended)
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)),
    ended = events
      .filter((e) => !e.cancelled && e.ended)
      .sort((a, b) => (b.date + b.start).localeCompare(a.date + a.start)),
    cancelled = events.filter((e) => e.cancelled);
  return (
    <div aria-busy={pending}>
      <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 sm:mb-6 sm:gap-4">
        <div className="min-w-0">
          <h1
            id="page-title"
            tabIndex={-1}
            className="text-2xl font-bold sm:text-3xl"
          >
            นัดตีของกลุ่ม
          </h1>
          <p className="mt-1 text-sm text-muted-foreground sm:mt-2 sm:text-base">
            ลงชื่อครั้งเดียว เจอกันทั้งนัด
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            จองคอร์ตแล้ว นัดเพื่อนได้เลย
          </p>
        </div>
        <div className="flex flex-col items-end">
          <Button onClick={onCreate}>+ เปิดนัด</Button>
          <Button
            variant="link"
            disabled={pending}
            onClick={() => void refresh(true)}
          >
            อัปเดตรายชื่อ
          </Button>
          {lastUpdated && (
            <p className="text-xs text-muted-foreground">
              อัปเดตล่าสุด{" "}
              {lastUpdated.toLocaleTimeString("th-TH", {
                timeZone: "Asia/Bangkok",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </p>
          )}
        </div>
      </div>
      <span role="status" className="sr-only">
        {refreshNotice}
      </span>
      {loaded && refreshFailed && (
        <p className="mb-4 text-sm text-amber">
          อัปเดตนัดไม่สำเร็จ ข้อมูลที่แสดงอาจไม่ใช่ล่าสุด กด “อัปเดตรายชื่อ” เพื่อลองใหม่
        </p>
      )}
      {!loaded ? (
        <p role="status" className="py-12 text-center text-muted-foreground">
          {pending ? "กำลังโหลดนัด…" : "โหลดนัดไม่สำเร็จ กดอัปเดตเพื่อลองใหม่"}
        </p>
      ) : (
        <>
          <section aria-labelledby="upcoming-events-title">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="upcoming-events-title" className="text-xl font-bold">
                นัดที่กำลังจะมาถึง
              </h2>
              <span className="badge">{active.length} นัด</span>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              นัดที่ยังไม่จบ · เลือกนัดเพื่อดูรายละเอียดและลงชื่อ
            </p>
            {active.length ? (
              <div className="panel py-0">{rows(active)}</div>
            ) : (
              <div className="panel py-8 text-center">
                <p className="mb-2 font-semibold">ยังไม่มีนัดที่เปิดอยู่</p>
                <p className="text-sm text-muted-foreground">
                  จองคอร์ตแล้วกด “เปิดนัด” เพื่อชวนเพื่อนลงชื่อได้เลย
                </p>
              </div>
            )}
          </section>
          <section aria-labelledby="past-events-title" className="mt-8">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="past-events-title" className="text-xl font-bold">
                นัดที่ผ่านมา
              </h2>
              <span className="badge bg-stone-200 text-stone-600">
                {ended.length} นัด
              </span>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">
              จบนัดแล้ว · ดูประวัติ ติ๊กจ่ายเงิน และบันทึกผลแมตช์ได้
            </p>
            {ended.length ? (
              <div className="panel py-0">{rows(ended)}</div>
            ) : (
              <div className="panel py-8 text-center text-sm text-muted-foreground">
                ยังไม่มีนัดที่ผ่านมา
              </div>
            )}
          </section>
        </>
      )}
      {cancelled.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            นัดที่ยกเลิก · {cancelled.length} นัด
          </summary>
          <section className="panel mt-3 py-0">{rows(cancelled)}</section>
        </details>
      )}
    </div>
  );
}
