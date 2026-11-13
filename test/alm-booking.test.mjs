import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  BookingError,
  bookingConfig,
  bookingPlan,
  bookingStore,
  checkConfig,
  dueBooking,
  startBookingScheduler,
} from "../alm-booking.mjs";
import {
  completeSelection,
  historyBooking,
  matchingBookings,
  parseBaht,
  previewBooking,
  runBooking,
  validateSubmission,
} from "../alm-browser.mjs";

const plan = bookingPlan("2026-10-30");
const selection = plan.courts.map((court_id) => ({
  court_id,
  time_slots: plan.slots,
}));
const courts = () =>
  plan.courts.map((code) => ({
    id: code,
    code,
    status: "active",
    available_slots: plan.slots.map((time_slot) => ({
      time_slot,
      is_booked: false,
      price: 350,
    })),
  }));
function memoryStore(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const store = bookingStore(db);
  store.claim(plan, plan.prepareAt);
  return { db, store };
}
function adapter(status = "paid") {
  let submitted = 0;
  let reads = 0;
  return {
    get submitted() {
      return submitted;
    },
    checkLogin: async () => {},
    preview: async (candidate) => ({
      selection: completeSelection(candidate, courts()),
      total: 210000,
    }),
    verifyPaymentPage: async (id) => "https://www.almximpact.com/payment/" + id,
    submit: async (chosen, preview, beforeSubmit) => {
      beforeSubmit();
      submitted++;
      return {
        id: "booking-1",
        selection: preview.selection,
        amount: 2100,
        paymentUrl:
          "https://www.almximpact.com/payment/booking-1?date=" + chosen.date,
        expiresAt: plan.releaseAt + 300000,
        expectedDeadline: true,
      };
    },
    history: async () =>
      ++reads === 1
        ? []
        : [{ id: "booking-1", date: plan.date, items: selection, status }],
  };
}
const runOptions = (clock = { time: plan.releaseAt }) => ({
  now: () => clock.time,
  wait: async (ms) => {
    clock.time += ms;
  },
});

test("Bangkok schedules use six calendar days, including year boundaries and exact window edges", () => {
  assert.deepEqual(plan.courts, ["US7", "US8", "US9"]);
  assert.deepEqual(plan.fallbackSlots, [
    "20:00-21:00",
    "21:00-22:00",
    "22:00-23:00",
  ]);
  const friday = bookingPlan("2027-01-01");
  assert.deepEqual(friday.courts, ["US7", "US8", "US9"]);
  assert.deepEqual(friday.slots, ["19:00-20:00", "20:00-21:00", "21:00-22:00"]);
  assert.equal(friday.releaseAt, Date.parse("2026-12-26T06:00:00+07:00"));
  assert.equal(dueBooking(plan.prepareAt - 1), null);
  assert.equal(dueBooking(Date.parse("2026-12-25T06:00:00+07:00")), null);
  assert.equal(dueBooking(plan.prepareAt).date, plan.date);
  assert.equal(dueBooking(plan.stopAt - 1).date, plan.date);
  assert.equal(dueBooking(plan.stopAt), null);
  assert.equal(dueBooking(Date.parse("2026-10-21T06:00:00+07:00")), null);
  assert.throws(() => bookingPlan("2026-02-30"));
  assert.throws(() => bookingPlan("2026-10-28"));
});

test("booking is disabled by default and missing verified configuration leaves the app alone", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const messages = [];
  t.mock.method(console, "error", (message) => messages.push(message));
  assert.equal(bookingConfig({}).enabled, false);
  startBookingScheduler(db, ":memory:", {})();
  startBookingScheduler(db, ":memory:", { ALM_BOOKING_ENABLED: "1" })();
  assert.match(messages[0], /supervised_verification_required/);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n,
    0,
  );
});

test("migration backs up WAL data once and never changes community rows", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "sks-alm-migration-"));
  const path = join(directory, "club.sqlite");
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE members(id TEXT PRIMARY KEY); INSERT INTO members VALUES('existing');",
  );
  const store = bookingStore(db, path);
  assert.equal(store.claim(plan), true);
  assert.equal(store.claim(plan), false);
  store.submitting(plan.date);
  assert.throws(
    () => store.submitting(plan.date),
    /submission_already_claimed/,
  );
  bookingStore(db, path);
  const backups = readdirSync(directory).filter((name) =>
    name.includes("before-alm-booking"),
  );
  assert.equal(backups.length, 1);
  const backup = new DatabaseSync(join(directory, backups[0]));
  try {
    assert.equal(backup.prepare("SELECT id FROM members").get().id, "existing");
  } finally {
    backup.close();
  }
  assert.equal(db.prepare("SELECT id FROM members").get().id, "existing");
});

test("all courts and every requested hour must be available; changed checkout and credit fail closed", () => {
  assert.deepEqual(completeSelection(plan, courts()), selection);
  for (const change of [
    (data) => {
      data.pop();
    },
    (data) => {
      data[1].available_slots[2].is_booked = true;
    },
    (data) => {
      data[1].available_slots.pop();
    },
    (data) => {
      data[1].is_closed = true;
    },
    (data) => {
      data[1].available_slots[0].activity_type = "camp";
    },
  ]) {
    const data = courts();
    change(data);
    assert.throws(() => completeSelection(plan, data));
  }
  const payload = {
    booking_date: plan.date,
    items: selection,
    coach_mode: "none",
  };
  validateSubmission(payload, plan, selection);
  for (const changed of [
    { ...payload, booking_date: "2026-11-06" },
    { ...payload, items: selection.slice(0, 1) },
    { ...payload, items: [selection[0], selection[0]] },
    { ...payload, credit_requested_amount: 1 },
    { ...payload, coach_mode: "external" },
    { ...payload, booking_type: "buffet" },
  ])
    assert.throws(() => validateSubmission(changed, plan, selection));
  assert.equal(parseBaht("฿2,100"), 210000);
  assert.equal(parseBaht("฿350.50"), 35050);
  for (const value of ["฿0", "฿-1", "฿2,10", "350", "฿350 plus fee"])
    assert.throws(() => parseBaht(value));
});

test("booking config needs no Telegram credentials and leaves old notification records untouched", async (t) => {
  const { db, store } = memoryStore(t);
  assert.doesNotThrow(() =>
    checkConfig(
      bookingConfig({
        ALM_BOOKING_VERIFIED: "1",
        ALM_MAX_TOTAL_BAHT: "4000",
        ALM_SESSION_PATH: new URL(import.meta.url).pathname,
      }),
    ),
  );
  db.exec(
    "CREATE TABLE alm_booking_messages(text TEXT, sent_at INTEGER); INSERT INTO alm_booking_messages VALUES('old', NULL)",
  );
  const site = adapter();
  await runBooking(site, store, plan.date, runOptions());
  assert.equal(site.submitted, 1);
  assert.equal(store.get(plan.date).state, "pending");
  assert.equal(
    db.prepare("SELECT sent_at FROM alm_booking_messages").get().sent_at,
    null,
  );
});

test("preview prefers the complete primary and falls back only for confirmed unavailability", async () => {
  const data = courts();
  for (const court of data)
    court.available_slots.push({ time_slot: "22:00-23:00", is_booked: false });
  const site = {
    preview: async (candidate) => ({
      selection: completeSelection(candidate, data),
    }),
  };
  assert.deepEqual((await previewBooking(site, plan)).plan.slots, plan.slots);
  data[2].available_slots[0].is_booked = true;
  assert.deepEqual(
    (await previewBooking(site, plan)).plan.slots,
    plan.fallbackSlots,
  );
  data[2].available_slots[1].is_booked = true;
  await assert.rejects(previewBooking(site, plan), /unavailable/);
  for (const code of [
    "login_required",
    "alm_read_failed",
    "spending_limit_exceeded",
    "checkout_changed",
  ]) {
    let attempts = 0;
    await assert.rejects(
      previewBooking(
        {
          preview: async () => {
            attempts++;
            throw new BookingError(code);
          },
        },
        plan,
      ),
      { code },
    );
    assert.equal(attempts, 1);
  }
});

test("successful fallback saves its actual slots, verifies payment, and stops without polling", async (t) => {
  const { store } = memoryStore(t);
  const site = adapter();
  site.preview = async (candidate) => {
    if (candidate.slots === candidate.fallbackSlots)
      return {
        selection: candidate.courts.map((court_id) => ({
          court_id,
          time_slots: candidate.slots,
        })),
        total: 210000,
      };
    throw new BookingError("unavailable");
  };
  let reads = 0;
  site.history = async () => {
    reads++;
    return [];
  };
  await runBooking(site, store, plan.date, runOptions());
  await runBooking(site, store, plan.date, runOptions());
  const row = store.get(plan.date);
  assert.equal(row.state, "pending");
  assert.equal(row.details.paymentPageVerified, true);
  assert.deepEqual(row.details.selection[2].time_slots, plan.fallbackSlots);
  assert.equal(site.submitted, 1);
  assert.equal(reads, 1);
});

test("failed payment-page verification preserves accepted booking and never resubmits", async (t) => {
  const { store } = memoryStore(t);
  const site = adapter();
  site.verifyPaymentPage = async () => {
    throw new Error("redirect missing");
  };
  await runBooking(site, store, plan.date, runOptions());
  await runBooking(site, store, plan.date, runOptions());
  assert.equal(store.get(plan.date).state, "uncertain");
  assert.equal(store.get(plan.date).error, "payment_page_unverified");
  assert.equal(store.get(plan.date).details.id, "booking-1");
  assert.equal(site.submitted, 1);
});

test("a queued Wednesday cannot submit, but existing Wednesday reservations can reconcile", async (t) => {
  const { store } = memoryStore(t);
  const date = "2026-10-28";
  store.claim({ ...plan, date });
  const site = adapter();
  await runBooking(site, store, date, runOptions());
  assert.equal(store.get(date).error, "not_a_playing_day");
  assert.equal(site.submitted, 0);
  store.update(date, "pending", { selection, id: "old-wednesday" });
  site.history = async () => [
    { id: "old-wednesday", date, items: selection, status: "paid" },
  ];
  await runBooking(site, store, date, { ...runOptions(), reconcileOnly: true });
  assert.equal(store.get(date).state, "paid");
});

test("both unavailable windows retry only to the cutoff without submission", async (t) => {
  const { store } = memoryStore(t);
  const site = adapter();
  let attempts = 0;
  site.preview = async () => {
    attempts++;
    throw new BookingError("unavailable");
  };
  const clock = { time: plan.stopAt - 7000 };
  await runBooking(site, store, plan.date, runOptions(clock));
  assert.equal(clock.time, plan.stopAt);
  assert.equal(attempts, 4);
  assert.equal(site.submitted, 0);
  assert.equal(store.get(plan.date).state, "unavailable");
});

test("ambiguous submit and server restart reconcile without ever resubmitting", async (t) => {
  const { store } = memoryStore(t);
  const site = adapter();
  site.submit = async (_plan, _preview, beforeSubmit) => {
    beforeSubmit();
    throw new Error("response lost");
  };
  await runBooking(site, store, plan.date, runOptions());
  assert.equal(store.get(plan.date).state, "paid");
  store.update(plan.date, "uncertain");
  site.history = async () => [
    { id: "booking-1", date: plan.date, items: selection, status: "paid" },
  ];
  site.submit = async () => {
    assert.fail("must not resubmit");
  };
  await runBooking(site, store, plan.date, {
    ...runOptions(),
    reconcileOnly: true,
  });
  assert.equal(store.get(plan.date).state, "paid");
  store.update(plan.date, "submitting");
  await runBooking(site, store, plan.date, runOptions());
  assert.equal(store.get(plan.date).state, "paid");
});

test("restart reconciles the persisted fallback hours instead of trying the primary", async (t) => {
  const { store } = memoryStore(t);
  const fallback = selection.map((item) => ({
    ...item,
    time_slots: plan.fallbackSlots,
  }));
  store.submitting(plan.date, { selection: fallback, total: 210000 });
  const site = adapter();
  site.preview = async () => assert.fail("must not preview again");
  site.history = async () => [
    {
      id: "fallback-booking",
      date: plan.date,
      items: fallback,
      status: "pending",
    },
  ];
  await runBooking(site, store, plan.date, runOptions());
  const row = store.get(plan.date);
  assert.equal(row.state, "pending");
  assert.equal(row.details.id, "fallback-booking");
  assert.deepEqual(row.details.selection, fallback);
  assert.equal(site.submitted, 0);
});

test("manual reconciliation records only explicit payment status", async (t) => {
  for (const [status, expected] of [
    ["pending", "pending"],
    ["expired", "expired"],
    ["unknown", "uncertain"],
  ]) {
    const { store } = memoryStore(t);
    const site = adapter();
    await runBooking(site, store, plan.date, runOptions());
    site.history = async () => [
      { id: "booking-1", date: plan.date, items: selection, status },
    ];
    await runBooking(site, store, plan.date, {
      ...runOptions(),
      reconcileOnly: true,
    });
    assert.equal(store.get(plan.date).state, expected);
    assert.equal(site.submitted, 1);
  }
});

test("history contract and overlapping bookings fail safely", () => {
  const row = historyBooking({
    booking_id: "b-1",
    booking_date: plan.date,
    items: selection,
    payment_status: "paid",
  });
  assert.equal(matchingBookings([row], plan, selection).length, 1);
  assert.equal(
    matchingBookings([{ ...row, date: "2026-11-06" }], plan, selection).length,
    0,
  );
  assert.throws(() =>
    historyBooking({
      id: "b-1",
      booking_date: plan.date,
      items: [],
      status: "paid",
    }),
  );
  assert.throws(() =>
    historyBooking({
      id: "b-1",
      booking_date: plan.date,
      items: [{ court_id: "US7", time_slots: ["20:00"] }],
      status: "paid",
    }),
  );
});

test("reconciling a completed run never overwrites paid status when login has expired", async (t) => {
  const { store } = memoryStore(t);
  store.update(plan.date, "paid");
  const site = adapter();
  site.checkLogin = async () => {
    assert.fail("terminal run must not access ALM");
  };
  await runBooking(site, store, plan.date, {
    ...runOptions(),
    reconcileOnly: true,
  });
  assert.equal(store.get(plan.date).state, "paid");
  assert.equal(site.submitted, 0);
});

test("the worker waits until 06:00 and retries if the date has not opened", async (t) => {
  const { store } = memoryStore(t);
  const site = adapter();
  const clock = { time: plan.prepareAt };
  const originalPreview = site.preview;
  let previews = 0;
  site.preview = async (candidate) => {
    assert.ok(clock.time >= plan.releaseAt);
    if (++previews === 1) throw new BookingError("booking_date_not_open");
    return originalPreview(candidate);
  };
  await runBooking(site, store, plan.date, runOptions(clock));
  assert.equal(previews, 2);
  assert.equal(clock.time, plan.releaseAt + 5000);
  assert.equal(site.submitted, 1);
});
