import { randomUUID } from "node:crypto";

function welcomeMessage(liffId, inviteCode) {
  const url = new URL("https://liff.line.me/" + encodeURIComponent(liffId) + "/");
  url.searchParams.set("invite", inviteCode);
  return {
    type: "flex",
    altText: "ยินดีต้อนรับสู่ SKS Tennis Club 🎾💚 · วิธีลงชื่อนัด",
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        header: { backgroundColor: "#E7EBDF" },
        body: { backgroundColor: "#FFFDF8" },
        footer: { backgroundColor: "#F8F4EC" },
      },
      header: { type: "box", layout: "vertical", contents: [
        { type: "text", text: "ยินดีต้อนรับสู่ SKS Tennis Club 🎾💚", color: "#576B4F", weight: "bold", wrap: true },
      ] },
      body: { type: "box", layout: "vertical", paddingAll: "20px", contents: [
        { type: "text", color: "#1D3C51", wrap: true, text: `ดีใจที่ได้มาเป็นก๊วนเดียวกันครับ!

📋 วิธีลงชื่อนัด
1. กดปุ่ม “เปิดตารางนัด” ด้านล่าง
2. เข้าใช้งานผ่าน LINE และตั้งชื่อเล่นครั้งแรกให้เพื่อน ๆ จำได้
3. เลือกนัดที่สะดวก แล้วกด “ลงชื่อนัดนี้”

🙋 ถ้านัดเต็มแล้ว ระบบจะให้เข้าคิวสำรอง หากมีคนถอนชื่อ จะเลื่อนคิวให้ตามลำดับ
หากลงชื่อแล้วมาไม่ได้ อย่าลืมถอนชื่อในระบบด้วยน้าาา

💸 เมื่อคนครบ ระบบจะแจ้งยอดค่าใช้จ่ายหารตามจำนวนผู้ได้ที่ในนัด ดู QR จ่ายเงินได้ในหน้านัด และเมื่อโอนแล้วให้ติ๊ก “จ่ายแล้ว” ด้วยครับ

แล้วเจอกันในคอร์ตน้าาา 🎾✨` },
      ] },
      footer: { type: "box", layout: "vertical", contents: [
        { type: "button", style: "primary", color: "#1D3C51", height: "sm", action: { type: "uri", label: "เปิดตารางนัด", uri: url.href } },
      ] },
    },
  };
}

function notificationMessage(event, kind, liffId, inviteCode) {
  const full = kind === "full";
  const billing = full && event.sharePerPersonSatang != null;
  const heading = billing ? "คนครบแล้ว เย้!! ได้เวลาโอนค่าตีน้าาา 🎾" : full ? "คนเต็มแล้ว" : "เปิดนัดใหม่";
  const money = satang => new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 }).format(satang / 100);
  const url = new URL(
    "https://liff.line.me/" + encodeURIComponent(liffId) + "/",
  );
  url.searchParams.set("invite", inviteCode);
  url.searchParams.set("event", event.id);
  const text = (value, color = "#1D3C51") => ({
    type: "text",
    text: value,
    color,
    wrap: true,
  });
  const date = new Intl.DateTimeFormat("th-TH", {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(event.date + "T12:00:00+07:00"));
  const contents = [
    { ...text(event.title), size: "lg", weight: "bold" },
    text("📅 " + date),
    text("⏰ " + event.start + "–" + event.end, "#576B4F"),
    text("📍 " + event.venue),
    text("คอร์ต: " + event.courtNames + " · " + event.courts + " คอร์ต"),
    text("ผู้เปิดนัด: " + event.organizerName, "#626F6A"),
    { type: "separator", color: "#DEDFD4", margin: "md" },
    {
      ...text(
        "ลงชื่อ " +
          event.confirmed +
          "/" +
          event.capacity +
          " คน" +
          (event.waiting ? " · สำรอง " + event.waiting + " คน" : ""),
        "#576B4F",
      ),
      weight: "bold",
      margin: "md",
    },
  ];
  if (billing) {
    contents.push(
      { ...text("💰 คนละ " + money(event.sharePerPersonSatang) + " บาท", "#576B4F"), size: "xl", weight: "bold", margin: "md" },
      text("ค่าใช้จ่ายรวม " + money(event.totalCostSatang) + " บาท ÷ ผู้ได้ที่ " + event.sharePeople + " คน", "#626F6A"),
      text("ปัดขึ้นเป็นบาท ไม่รวมคิวสำรอง", "#626F6A"),
    );
    if (event.paymentQrUrl)
      contents.push({ type: "image", url: event.paymentQrUrl, size: "full", aspectRatio: "1:1", aspectMode: "fit", margin: "md", action: { type: "uri", uri: url.href } });
    else contents.push(text("เปิดนัดเพื่อดูช่องทางชำระเงิน", "#626F6A"));
    contents.push(
      text("เมื่อโอนแล้ว ให้ทำเครื่องหมาย “จ่ายแล้ว” ในระบบด้วยน้าาา 💚"),
      text("หากจำนวนผู้ร่วมเปลี่ยน กรุณาตรวจยอดล่าสุดในนัดก่อนโอน", "#626F6A"),
    );
  }
  if (full) {
    const names = [];
    let rosterBytes = 0;
    for (const [i, person] of event.participants.entries()) {
      const line = i + 1 + ". " + person.nickname;
      const lineBytes = Buffer.byteLength(JSON.stringify(line));
      // ponytail: reserve room for the rest of LINE's 30 KB bubble; oversized lists use the button.
      if (rosterBytes + lineBytes > 20000) break;
      names.push(line);
      rosterBytes += lineBytes;
    }
    contents.push(text(names.join("\n")));
    if (names.length < event.participants.length)
      contents.push(text("ดูรายชื่อทั้งหมดในนัด", "#626F6A"));
  }
  return {
    type: "flex",
    altText: heading + ": " + event.title,
    contents: {
      type: "bubble",
      size: "mega",
      styles: {
        header: { backgroundColor: "#E7EBDF" },
        body: { backgroundColor: "#FFFDF8" },
        footer: { backgroundColor: "#F8F4EC" },
      },
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            ...text("SKS Tennis Club · " + heading, "#576B4F"),
            weight: "bold",
          },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "20px",
        contents,
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#1D3C51",
            height: "sm",
            action: {
              type: "uri",
              label: billing ? "เปิดนัด / ตรวจยอดล่าสุด" : full ? "ดูรายชื่อ" : "เปิดนัด / ลงชื่อ",
              uri: url.href,
            },
          },
        ],
      },
    },
  };
}

export function lineNotifications(db, { token, groupId, liffId, inviteCode }) {
  if (groupId && !/^C[0-9a-f]{32}$/.test(groupId))
    throw new Error("LINE_NOTIFY_GROUP_ID must be a LINE group ID.");
  const enabled = Boolean(
    token && groupId && liffId && inviteCode.length >= 24,
  );
  const schema = `CREATE TABLE IF NOT EXISTS line_notifications (
    event_id TEXT NOT NULL REFERENCES events(id), kind TEXT NOT NULL CHECK(kind IN ('created', 'full')),
    retry_key TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'failed')),
    first_attempt_at INTEGER, next_attempt_at INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0
  );`;
  if (db.prepare("PRAGMA table_info(line_notifications)").all().some(column => column.name === "event_id" && column.pk)) {
    // Preserve queued payloads and retry keys when removing the once-per-event full limit.
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(schema.replace("line_notifications (", "line_notifications_new ("));
      db.exec(`INSERT INTO line_notifications_new SELECT * FROM line_notifications;
        DROP TABLE line_notifications;
        ALTER TABLE line_notifications_new RENAME TO line_notifications;`);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } else db.exec(schema);
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS line_notifications_created ON line_notifications(event_id) WHERE kind='created'");
  let sending;
  async function drain() {
    const jobs = db
      .prepare(
        "SELECT * FROM line_notifications WHERE status='pending' AND next_attempt_at<=? ORDER BY rowid",
      )
      .all(Date.now());
    for (const job of jobs) {
      const now = Date.now();
      // LINE deduplicates retry keys for 24 hours; stop before that window expires.
      if (
        job.first_attempt_at !== null &&
        now - job.first_attempt_at >= 23 * 60 * 60 * 1000
      ) {
        db.prepare(
          "UPDATE line_notifications SET status='failed' WHERE retry_key=?",
        ).run(job.retry_key);
        console.error(
          "LINE notification retry window expired:",
          job.event_id,
          job.kind,
        );
        continue;
      }
      db.prepare(
        "UPDATE line_notifications SET first_attempt_at=COALESCE(first_attempt_at, ?), attempts=attempts+1 WHERE retry_key=?",
      ).run(now, job.retry_key);
      let response;
      try {
        response = await fetch("https://api.line.me/v2/bot/message/push", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
            "X-Line-Retry-Key": job.retry_key,
          },
          body: job.payload,
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        // A timeout may occur after LINE accepted the message; reuse the exact payload and key.
      }
      const accepted =
        response?.ok ||
        (response?.status === 409 &&
          response.headers.has("x-line-accepted-request-id"));
      if (accepted)
        db.prepare(
          "UPDATE line_notifications SET status='sent' WHERE retry_key=?",
        ).run(job.retry_key);
      else if (response && response.status < 500) {
        db.prepare(
          "UPDATE line_notifications SET status='failed' WHERE retry_key=?",
        ).run(job.retry_key);
        console.error(
          "LINE notification rejected:",
          response.status,
          job.event_id,
          job.kind,
        );
      } else {
        const delay = Math.min(
          30 * 60 * 1000,
          30000 * 2 ** Math.min(job.attempts, 6),
        );
        db.prepare(
          "UPDATE line_notifications SET next_attempt_at=? WHERE retry_key=?",
        ).run(now + delay, job.retry_key);
        console.error("LINE notification will retry:", job.event_id, job.kind);
      }
    }
  }
  return {
    async welcome(event) {
      if (!enabled || event?.type !== "memberJoined" || event.source?.type !== "group" || event.source.groupId !== groupId ||
        typeof event.replyToken !== "string" || !event.replyToken || event.replyToken.length > 256 ||
        !Array.isArray(event.joined?.members) || !event.joined.members.some(person => person?.type === "user" && /^U[0-9a-f]{32}$/.test(person.userId))) return;
      let response;
      try {
        response = await fetch("https://api.line.me/v2/bot/message/reply", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
          body: JSON.stringify({ replyToken: event.replyToken, messages: [welcomeMessage(liffId, inviteCode)], notificationDisabled: false }),
          signal: AbortSignal.timeout(8000),
        });
      } catch {}
      if (!response || response.status >= 500 || response.status === 429) {
        console.error("LINE welcome reply failed; webhook can be redelivered.");
        throw Object.assign(new Error("ส่งข้อความต้อนรับ LINE ไม่สำเร็จ กรุณาลองใหม่"), { status: 502 });
      }
      // A used/expired reply token cannot send again, including on webhook redelivery.
      if (!response.ok) console.error("LINE welcome reply rejected:", response.status);
    },
    enqueue(event, kind) {
      if (!enabled) return;
      const payload = JSON.stringify({
        to: groupId,
        messages: [notificationMessage(event, kind, liffId, inviteCode)],
        notificationDisabled: false,
      });
      db.prepare(
        "INSERT INTO line_notifications(event_id, kind, retry_key, payload) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING",
      ).run(event.id, kind, randomUUID(), payload);
    },
    flush() {
      if (!enabled) return Promise.resolve();
      return (sending ||= drain()
        .catch(() => console.error("LINE notification queue failed."))
        .finally(() => {
          sending = undefined;
        }));
    },
  };
}
