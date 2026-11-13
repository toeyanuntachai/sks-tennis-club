import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright";
import { ALM_API, ALM_ORIGIN, bookingPlan } from "../alm-booking.mjs";
import { AlmBrowser, previewBooking } from "../alm-browser.mjs";

const plan = bookingPlan("2026-10-30");
const courts = plan.courts.map((code) => ({
  id: code,
  code,
  status: "active",
  available_slots: plan.slots.map((time_slot) => ({
    time_slot,
    is_booked: false,
  })),
}));

// A small checkout fixture exercises real browser clicks and request interception.
// Signed-in ALM history/payment contracts still require supervised live verification.
const fixture = `<!doctype html><html lang="th"><head><meta charset="utf-8"></head><body><section>
<button onclick="fetch('${ALM_API}/api/v1/courts?date=2026-10-30')">ศุกร์30ตค.</button>
<button aria-label="เลือกสนาม US 7" onclick="choose('US7')">US 7</button>
<button aria-label="เลือกสนาม US 8" onclick="choose('US8')">US 8</button>
<button aria-label="เลือกสนาม US 9" onclick="choose('US9')">US 9</button>
<div id="slots"></div>
<button onclick="document.querySelector('#summary').hidden=false">ถัดไป: ตรวจสอบข้อมูล</button>
<section id="summary" hidden><h2>ใบแจ้งชำระการจอง</h2><p>2026-10-30 US 7 US 8 US 9</p>
<span class="text-3xl">฿2,700</span>
<button aria-pressed="false" onclick="this.setAttribute('aria-pressed','true');document.querySelector('#submit').disabled=false">ยอมรับกฎระเบียบของสนาม</button>
<button id="submit" disabled onclick="submitBooking()">ยืนยันและชำระเงิน</button></section></section>
<script>
const items = {};
function choose(id) {
  items[id] ||= [];
  document.querySelector('#slots').replaceChildren(...${JSON.stringify([...plan.slots, plan.fallbackSlots.at(-1)])}.map(time => {
    const button = document.createElement('button'); button.textContent=time.replace('-',' – ')+' ฿450';
    button.setAttribute('aria-pressed', String(items[id].includes(time)));
    button.onclick=()=>{items[id].push(time);button.setAttribute('aria-pressed','true')};return button;
  }));
}
function submitBooking() {
  fetch('${ALM_API}/api/v1/queues/book', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({booking_date:'2026-10-30',items:Object.entries(items).map(([court_id,time_slots])=>({court_id,time_slots})),coach_mode:'none',credit_requested_amount:0})}).then(response => response.json()).then(data => { if (data.booking_id) history.pushState({}, "", "/payment/" + data.booking_id); }).catch(()=>{});
}
</script></body></html>`;

async function setup(t, maxSatang = 300000, availability = courts) {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({ timezoneId: "Asia/Bangkok" });
  let requests = 0;
  await context.route("**/*", async (route) => {
    if (route.request().url().startsWith(ALM_ORIGIN))
      return route.fulfill({ contentType: "text/html", body: fixture });
    if (
      route
        .request()
        .url()
        .startsWith(ALM_API + "/api/v1/courts?")
    )
      return route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": ALM_ORIGIN },
        body: JSON.stringify({ courts: availability }),
      });
    if (route.request().url() === ALM_API + "/api/v1/queues/book") {
      if (route.request().method() === "OPTIONS")
        return route.fulfill({
          headers: {
            "access-control-allow-origin": ALM_ORIGIN,
            "access-control-allow-headers": "content-type",
          },
        });
      requests++;
      return route.fulfill({
        contentType: "application/json",
        headers: { "access-control-allow-origin": ALM_ORIGIN },
        body: JSON.stringify({
          booking_id: "fixture-booking",
          fee_to_pay: 2700,
        }),
      });
    }
    return route.abort();
  });
  const adapter = new AlmBrowser(context, { maxSatang });
  adapter.read = async () => ({ courts: availability });
  await adapter.open();
  return { adapter, requests: () => requests };
}

test("preview selects all nine court-hours and physically blocks accidental reservation POSTs", async (t) => {
  const { adapter, requests } = await setup(t);
  const preview = await adapter.preview(plan);
  assert.equal(preview.total, 270000);
  assert.equal(preview.selection.length, 3);
  await adapter.page.evaluate(() => submitBooking());
  await adapter.page.waitForTimeout(100);
  assert.equal(requests(), 0);
  assert.equal(await adapter.page.locator("#submit").isEnabled(), false);
});

test("price cap stops before confirmation", async (t) => {
  const { adapter, requests } = await setup(t, 200000);
  await assert.rejects(adapter.preview(plan), /spending_limit_exceeded/);
  assert.equal(requests(), 0);
});

test("live request guard allows one exact checkout and rejects duplicates", async (t) => {
  const { adapter, requests } = await setup(t);
  const preview = await adapter.preview(plan);
  const currentPlan = {
    ...plan,
    releaseAt: Date.now() - 1000,
    stopAt: Date.now() + 60000,
  };
  let recorded = 0;
  const result = await adapter.submit(currentPlan, preview, () => {
    recorded++;
  });
  assert.equal(result.id, "fixture-booking");
  assert.equal(
    await adapter.verifyPaymentPage(result.id),
    ALM_ORIGIN + "/payment/fixture-booking",
  );
  assert.equal(result.amount, 2700);
  assert.equal(result.expectedDeadline, true);
  assert.equal(recorded, 1);
  assert.equal(requests(), 1);
  await adapter.page.evaluate(() => submitBooking());
  await adapter.page.waitForTimeout(100);
  assert.equal(requests(), 1);
});

test("last-second changed checkout is blocked before external submission", async (t) => {
  const { adapter, requests } = await setup(t);
  const preview = await adapter.preview(plan);
  await adapter.page.evaluate(() => {
    items.US8.pop();
  });
  // Make the response wait short without waiting 20 seconds for an intentionally aborted request.
  adapter.page.waitForResponse = () => Promise.resolve(null);
  await assert.rejects(
    adapter.submit(
      { ...plan, releaseAt: 0, stopAt: Date.now() + 60000 },
      preview,
      () => assert.fail("must not record submission"),
    ),
    /checkout_changed/,
  );
  assert.equal(requests(), 0);
});

test("fallback checkout uses the later hours on every court and verifies the payment page", async (t) => {
  const availability = structuredClone(courts);
  for (const court of availability)
    court.available_slots.push({
      time_slot: plan.fallbackSlots.at(-1),
      is_booked: false,
    });
  availability[2].available_slots[0].is_booked = true;
  const { adapter, requests } = await setup(t, 300000, availability);
  const selected = await previewBooking(adapter, {
    ...plan,
    releaseAt: Date.now() - 1000,
    stopAt: Date.now() + 60000,
  });
  const details = await adapter.submit(
    selected.plan,
    selected.preview,
    () => {},
  );
  assert.deepEqual(
    details.selection.map((item) => item.time_slots),
    plan.courts.map(() => plan.fallbackSlots),
  );
  assert.equal(
    new URL(details.paymentUrl).searchParams.get("time"),
    "20:00-23:00",
  );
  assert.equal(
    await adapter.verifyPaymentPage(details.id),
    ALM_ORIGIN + "/payment/fixture-booking",
  );
  assert.equal(requests(), 1);
});
