import {
  ALM_API,
  ALM_ORIGIN,
  BookingError,
  bookingPlan,
} from "./alm-booking.mjs";

const compact = (value) =>
  String(value ?? "")
    .replace(/\s/g, "")
    .toUpperCase();
const same = (a, b) =>
  a.length === b.length &&
  [...a].sort().every((value, i) => value === [...b].sort()[i]);

export function completeSelection(plan, courts) {
  if (!Array.isArray(courts))
    throw new BookingError("availability_contract_changed");
  return plan.courts.map((code) => {
    const matches = courts.filter(
      (court) => compact(court.code || court.court_name || court.name) === code,
    );
    if (matches.length !== 1) throw new BookingError("court_mapping_changed");
    const court = matches[0];
    if (!court.id || !Array.isArray(court.available_slots))
      throw new BookingError("availability_contract_changed");
    if (court.is_closed || (court.status && court.status !== "active"))
      throw new BookingError("unavailable");
    for (const time of plan.slots) {
      const slots = court.available_slots.filter(
        (slot) => slot.time_slot === time,
      );
      const slot = slots[0];
      if (slots.length > 1 || (slot && typeof slot.is_booked !== "boolean"))
        throw new BookingError("availability_contract_changed");
      if (
        !slot ||
        slot.is_booked ||
        slot.is_closed ||
        slot.closure_category ||
        slot.activity_type ||
        slot.event_type ||
        (slot.status && !["available", "active"].includes(slot.status))
      )
        throw new BookingError("unavailable");
    }
    return { court_id: court.id, time_slots: plan.slots };
  });
}

export function validateSubmission(body, plan, selection) {
  if (
    !body ||
    body.booking_date !== plan.date ||
    !Array.isArray(body.items) ||
    body.items.length !== selection.length ||
    body.court_id ||
    body.time_slot ||
    body.coach_mode !== "none" ||
    Number(body.credit_requested_amount || 0) !== 0 ||
    body.coach_id ||
    body.promo_code ||
    (body.booking_type && body.booking_type !== "court")
  )
    throw new BookingError("checkout_changed");
  for (const item of selection) {
    const matches = body.items.filter(
      (candidate) => candidate.court_id === item.court_id,
    );
    if (
      matches.length !== 1 ||
      !Array.isArray(matches[0].time_slots) ||
      !same(matches[0].time_slots, item.time_slots)
    )
      throw new BookingError("checkout_changed");
  }
}

export function parseBaht(text) {
  const match = /^฿\s*(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?$/.exec(
    text.trim(),
  );
  if (!match) throw new BookingError("price_contract_changed");
  const satang =
    Number(match[1].replaceAll(",", "")) * 100 + Number(match[2] || 0);
  if (!Number.isSafeInteger(satang) || satang <= 0)
    throw new BookingError("invalid_price");
  return satang;
}

// Fail closed on unknown history shapes; validate these fields during supervised setup.
export function historyBooking(row) {
  if (
    !row ||
    typeof row !== "object" ||
    !/^[\w-]+$/.test(String(row.booking_id ?? row.id ?? "")) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(row.booking_date)
  )
    throw new BookingError("history_contract_changed");
  const items = row.items ?? [row];
  if (!Array.isArray(items) || !items.length)
    throw new BookingError("history_contract_changed");
  const normalized = items.map((item) => {
    const slots = item.time_slots ?? (item.time_slot ? [item.time_slot] : null);
    if (
      !item.court_id ||
      !Array.isArray(slots) ||
      !slots.length ||
      slots.some(
        (slot) =>
          typeof slot !== "string" || !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(slot),
      )
    )
      throw new BookingError("history_contract_changed");
    return { court_id: item.court_id, time_slots: slots };
  });
  const status = String(row.payment_status || row.status || "").toLowerCase();
  if (!status) throw new BookingError("history_contract_changed");
  return {
    id: String(row.booking_id ?? row.id),
    date: row.booking_date,
    items: normalized,
    status,
    raw: row,
  };
}

export function matchingBookings(rows, plan, selection) {
  return rows.filter(
    (row) =>
      row.date === plan.date &&
      row.items.some((item) =>
        selection.some(
          (wanted) =>
            item.court_id === wanted.court_id &&
            item.time_slots.some((slot) => wanted.time_slots.includes(slot)),
        ),
      ),
  );
}

export class AlmBrowser {
  constructor(context, config) {
    this.context = context;
    this.config = config;
  }

  summary() {
    return this.page
      .getByRole("heading", { name: "ใบแจ้งชำระการจอง", exact: true })
      .locator("xpath=ancestor::section[1]");
  }

  async open() {
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(8000);
    this.page.setDefaultNavigationTimeout(20000);
    // The preview must not be able to reserve anything, including accidental UI changes.
    await this.context.route("**/*", async (route) => {
      if (
        !["GET", "HEAD", "OPTIONS"].includes(route.request().method()) &&
        route.request() !== this.authorizedRequest
      )
        return route.abort();
      await route.fallback();
    });
    await this.page.goto(ALM_ORIGIN + "/booking?mode=court");
    const cookie = this.page.getByRole("button", {
      name: "เฉพาะที่จำเป็น",
      exact: true,
    });
    if (await cookie.isVisible()) await cookie.click();
  }

  async token() {
    const state = await this.context.storageState();
    const raw = state.origins
      .find((origin) => origin.origin === ALM_ORIGIN)
      ?.localStorage.find((item) => item.name === "alm_member_session")?.value;
    try {
      const session = JSON.parse(raw);
      if (typeof session.accessToken !== "string" || !session.accessToken)
        throw new Error();
      return session.accessToken;
    } catch {
      throw new BookingError("login_required");
    }
  }

  async read(path, authenticated = true) {
    const headers = authenticated
      ? { Authorization: "Bearer " + (await this.token()) }
      : {};
    const response = await this.context.request.get(ALM_API + path, {
      headers,
      timeout: 15000,
      maxRetries: 0,
    });
    if ([401, 403].includes(response.status()))
      throw new BookingError("login_required");
    if (!response.ok()) throw new BookingError("alm_read_failed");
    return response.json();
  }

  async checkLogin() {
    await this.read("/api/v1/member/bootstrap");
  }

  async selection(plan) {
    const data = await this.read(
      "/api/v1/courts?date=" + plan.date + "&fresh=true",
      false,
    );
    return completeSelection(plan, data.courts);
  }

  async history() {
    const rows = [];
    for (let offset = 0; offset < 200; offset += 20) {
      const data = await this.read(
        `/api/v1/member/bookings?status=current&limit=20&offset=${offset}&fresh=true`,
      );
      if (!Array.isArray(data.items))
        throw new BookingError("history_contract_changed");
      rows.push(...data.items.map(historyBooking));
      if (data.items.length < 20) return rows;
    }
    throw new BookingError("history_page_limit");
  }

  async preview(plan) {
    await this.page.goto(ALM_ORIGIN + "/booking?mode=court");
    await this.stopOnChallenge();
    const selection = await this.selection(plan);
    await this.page
      .getByRole("button", { name: "เลือกสนาม US 7", exact: true })
      .waitFor();
    const date = new Date(plan.date + "T12:00:00+07:00");
    const weekday = new Intl.DateTimeFormat("th-TH", {
      weekday: "short",
      timeZone: "Asia/Bangkok",
    })
      .format(date)
      .replaceAll(".", "");
    const month = new Intl.DateTimeFormat("th-TH", {
      month: "short",
      timeZone: "Asia/Bangkok",
    })
      .format(date)
      .replaceAll(".", "");
    const dateName = new RegExp(
      `^${weekday}\\s*${Number(plan.date.slice(8))}\\s*${month}\\.?$`,
    );
    const dateButton = this.page.getByRole("button", {
      name: dateName,
      exact: true,
    });
    if (!(await dateButton.isVisible()) || !(await dateButton.isEnabled()))
      throw new BookingError("booking_date_not_open");
    const loaded = this.page
      .waitForResponse(
        (response) => {
          const url = new URL(response.url());
          return (
            url.origin === ALM_API &&
            url.pathname === "/api/v1/courts" &&
            url.searchParams.get("date") === plan.date
          );
        },
        { timeout: 8000 },
      )
      .catch(() => null);
    await dateButton.click();
    const response = await loaded;
    if (!response?.ok()) throw new BookingError("alm_read_failed");
    completeSelection(plan, (await response.json()).courts);
    for (let i = 0; i < plan.courts.length; i++) {
      const label = "US " + plan.courts[i].slice(2);
      await this.page
        .getByRole("button", { name: "เลือกสนาม " + label, exact: true })
        .click();
      for (const slot of plan.slots) {
        const [start, end] = slot.split("-");
        const control = this.page.getByRole("button", {
          name: new RegExp(`${start}\\s*[–-]\\s*${end}`),
        });
        if ((await control.getAttribute("aria-pressed")) !== "true")
          await control.click({ timeout: 3000 });
      }
    }
    await this.page
      .getByRole("button", { name: "ถัดไป: ตรวจสอบข้อมูล", exact: true })
      .click();
    const summary = this.summary();
    await summary.waitFor();
    const text = await summary.innerText();
    if (
      !text.includes(plan.date) ||
      !plan.courts.every((code) => text.includes("US " + code.slice(2)))
    )
      throw new BookingError("checkout_changed");
    // QR transfer only: never spend existing customer credit implicitly.
    const credit = summary.getByRole("button", {
      name: "ใช้เครดิตแล้ว",
      exact: true,
    });
    if (await credit.isVisible()) await credit.click();
    const total = parseBaht(await summary.locator("span.text-3xl").innerText());
    if (!this.config.maxSatang || total > this.config.maxSatang)
      throw new BookingError("spending_limit_exceeded");
    await this.stopOnChallenge();
    return { selection, total };
  }

  async stopOnChallenge() {
    if (
      await this.page
        .locator(
          'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"]',
        )
        .count()
    )
      throw new BookingError("captcha_requires_attention");
    if (new URL(this.page.url()).pathname.startsWith("/auth"))
      throw new BookingError("login_required");
  }

  async submit(plan, preview, beforeSubmit) {
    let submitted = false;
    let submittedAt;
    let rejection = null;
    await this.context.route(ALM_API + "/api/v1/queues/book", async (route) => {
      if (route.request().method() === "OPTIONS") return route.fallback();
      try {
        if (
          submitted ||
          Date.now() < plan.releaseAt ||
          Date.now() >= plan.stopAt
        )
          throw new BookingError("outside_booking_window");
        validateSubmission(
          route.request().postDataJSON(),
          plan,
          preview.selection,
        );
        if (
          parseBaht(
            await this.summary().locator("span.text-3xl").innerText(),
          ) !== preview.total
        )
          throw new BookingError("price_changed");
        submittedAt = Date.now();
        if (submittedAt >= plan.stopAt)
          throw new BookingError("outside_booking_window");
        beforeSubmit();
        submitted = true;
        this.authorizedRequest = route.request();
        await route.fallback();
      } catch (error) {
        rejection =
          error instanceof BookingError
            ? error
            : new BookingError("checkout_changed");
        await route.abort();
      }
    });
    await this.page
      .getByRole("button", { name: "ยอมรับกฎระเบียบของสนาม", exact: true })
      .click();
    const responsePromise = this.page
      .waitForResponse(
        (response) =>
          response.url() === ALM_API + "/api/v1/queues/book" &&
          response.request().method() === "POST",
        { timeout: 20000 },
      )
      .catch(() => null);
    await this.page
      .getByRole("button", { name: "ยืนยันและชำระเงิน", exact: true })
      .click();
    const response = await responsePromise;
    if (rejection) throw rejection;
    if (!response?.ok())
      throw new BookingError(
        submitted ? "submission_uncertain" : "checkout_changed",
      );
    // A full-page redirect can interrupt access to the checkout response body.
    let bodyTimeout;
    const data = await Promise.race([
      response.json(),
      new Promise((_, reject) => {
        bodyTimeout = setTimeout(
          () => reject(new BookingError("submission_uncertain")),
          5000,
        );
      }),
    ]).finally(() => clearTimeout(bodyTimeout));
    if (!/^[\w-]+$/.test(String(data.booking_id ?? "")))
      throw new BookingError("submission_uncertain");
    const amount =
      Number.isFinite(data.fee_to_pay) && data.fee_to_pay > 0
        ? data.fee_to_pay
        : null;
    const params = new URLSearchParams({
      court: plan.courts.join(", "),
      date: plan.date,
      time: `${plan.slots[0].split("-")[0]}-${plan.slots.at(-1).split("-")[1]}`,
      hours: String(plan.courts.length * plan.slots.length),
      ...(amount === null ? {} : { amount: String(amount) }),
    });
    const siteDeadline = Date.parse(
      data.payment_expires_at ?? data.expires_at ?? "",
    );
    return {
      id: String(data.booking_id),
      selection: preview.selection,
      amount,
      amountExceedsLimit:
        amount !== null && Math.round(amount * 100) > this.config.maxSatang,
      paymentUrl: `${ALM_ORIGIN}/payment/${data.booking_id}?${params}`,
      expiresAt: Number.isFinite(siteDeadline)
        ? siteDeadline
        : submittedAt + 5 * 60000,
      expectedDeadline: !Number.isFinite(siteDeadline),
    };
  }
  async verifyPaymentPage(id) {
    const matches = (url) =>
      url.origin === ALM_ORIGIN && url.pathname === "/payment/" + id;
    await this.page.waitForURL(matches, {
      timeout: 8000,
      waitUntil: "domcontentloaded",
    });
    await this.stopOnChallenge();
    const url = new URL(this.page.url());
    if (!matches(url)) throw new BookingError("payment_page_unverified");
    return url.href;
  }
}

export async function previewBooking(adapter, plan) {
  try {
    return { plan, preview: await adapter.preview(plan) };
  } catch (error) {
    if (error.code !== "unavailable") throw error;
    const fallback = { ...plan, slots: plan.fallbackSlots };
    return { plan: fallback, preview: await adapter.preview(fallback) };
  }
}

export async function runBooking(
  adapter,
  store,
  date,
  {
    now = Date.now,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    reconcileOnly = false,
  } = {},
) {
  let row = store.get(date);
  if (!row) throw new BookingError("run_not_found");
  if (
    reconcileOnly
      ? !["submitting", "pending", "uncertain"].includes(row.state)
      : !["preparing", "submitting"].includes(row.state)
  )
    return;
  const finish = (state, code) => store.update(date, state, null, code);
  try {
    if (row.state === "preparing") {
      const schedule = bookingPlan(date);
      if (now() >= schedule.stopAt)
        return finish("failed", "missed_booking_window");
      await adapter.checkLogin();
      if (now() < schedule.releaseAt) await wait(schedule.releaseAt - now());
      let selected;
      while (now() < schedule.stopAt) {
        try {
          selected = await previewBooking(adapter, schedule);
          break;
        } catch (error) {
          if (!["unavailable", "booking_date_not_open"].includes(error.code))
            throw error;
          await wait(Math.min(5000, Math.max(0, schedule.stopAt - now())));
        }
      }
      if (!selected || now() >= schedule.stopAt)
        return finish("unavailable", "complete_slot_unavailable");
      const { plan, preview } = selected;
      if (
        matchingBookings(await adapter.history(), plan, preview.selection)
          .length
      )
        return finish("uncertain", "existing_booking_requires_review");
      let details;
      try {
        details = await adapter.submit(plan, preview, () =>
          store.submitting(date, {
            selection: preview.selection,
            total: preview.total,
          }),
        );
      } catch (error) {
        // A lost response can still have created a booking. Read history; never click again.
        if (store.get(date).state !== "submitting") throw error;
      }
      if (details) {
        store.update(date, "submitting", {
          ...details,
          paymentPageVerified: false,
        });
        try {
          const paymentUrl = await adapter.verifyPaymentPage(details.id);
          return store.update(date, "pending", {
            ...details,
            paymentUrl,
            paymentPageVerified: true,
          });
        } catch {
          return finish("uncertain", "payment_page_unverified");
        }
      }
      row = store.get(date);
    } else {
      await adapter.checkLogin();
    }

    const selection = row.details?.selection;
    if (!selection) return finish("uncertain", "missing_submission_details");
    const matches = matchingBookings(
      await adapter.history(),
      row.plan,
      selection,
    );
    const exact = matches.filter(
      (booking) =>
        booking.items.length === selection.length &&
        selection.every((wanted) =>
          booking.items.some(
            (item) =>
              item.court_id === wanted.court_id &&
              same(item.time_slots, wanted.time_slots),
          ),
        ) &&
        (!row.details?.id || booking.id === row.details.id),
    );
    if (matches.length !== 1 || exact.length !== 1)
      return finish("uncertain", "history_requires_review");
    const booking = exact[0];
    const details = row.details?.id
      ? row.details
      : {
          ...row.details,
          id: booking.id,
          amount: null,
          paymentUrl: ALM_ORIGIN + "/my-bookings",
          expiresAt: row.submitted_at + 5 * 60000,
          expectedDeadline: true,
          paymentPageVerified: false,
        };
    if (booking.status === "paid") return store.update(date, "paid", details);
    if (["expired", "cancelled"].includes(booking.status))
      return store.update(date, "expired", details, "site_" + booking.status);
    if (
      !["pending", "pending_payment", "awaiting_payment", "unpaid"].includes(
        booking.status,
      )
    )
      return store.update(
        date,
        "uncertain",
        details,
        "payment_status_requires_review",
      );
    store.update(
      date,
      "pending",
      details,
      details.paymentPageVerified ? null : "payment_page_unverified",
    );
  } catch (error) {
    const current = store.get(date);
    const code = error instanceof BookingError ? error.code : "browser_failed";
    finish(
      ["submitting", "pending", "uncertain"].includes(current.state)
        ? "uncertain"
        : "failed",
      code,
    );
  }
}
