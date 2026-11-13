import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import {
  ALM_ORIGIN,
  BookingError,
  bookingConfig,
  bookingPlan,
  bookingStore,
  checkConfig,
} from "../alm-booking.mjs";
import { AlmBrowser, previewBooking, runBooking } from "../alm-browser.mjs";

const [command, date] = process.argv.slice(2);
const databasePath = resolve(
  process.env.SKS_DATABASE_PATH || "data/sks.sqlite",
);
const config = bookingConfig(process.env, databasePath);
let browser;
let db;
try {
  if (command === "status") {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const initialized = db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='alm_booking_runs'")
      .get();
    console.log(
      JSON.stringify(
        initialized
          ? db
              .prepare(
                "SELECT date,state,error,updated_at,plan,details FROM alm_booking_runs ORDER BY date DESC LIMIT 20",
              )
              .all()
              .map(({ details, plan, ...row }) => {
                const booking = details ? JSON.parse(details) : null;
                return {
                  ...row,
                  courts: JSON.parse(plan).courts,
                  bookingReference: booking?.id ?? null,
                  paymentUrl: booking?.paymentUrl ?? null,
                  paymentPageVerified: booking?.paymentPageVerified ?? false,
                  slots: booking?.selection?.[0]?.time_slots ?? null,
                  amountBaht: booking?.amount ?? null,
                  amountExceedsLimit: booking?.amountExceedsLimit ?? false,
                  deadline: Number.isFinite(booking?.expiresAt)
                    ? new Date(booking.expiresAt).toISOString()
                    : null,
                  expectedDeadline: booking?.expectedDeadline ?? null,
                };
              })
          : [],
        null,
        2,
      ),
    );
  } else if (["login", "preview", "worker", "reconcile"].includes(command)) {
    if (command === "worker") {
      if (!config.enabled) throw new BookingError("booking_disabled");
      checkConfig(config);
    }
    if (command === "preview" && !config.maxSatang)
      throw new BookingError("spending_limit_required");
    const storageState =
      command !== "login" && existsSync(config.sessionPath)
        ? JSON.parse(readFileSync(config.sessionPath, "utf8"))
        : undefined;
    browser = await chromium.launch({ headless: command !== "login" });
    const context = await browser.newContext({
      storageState,
      timezoneId: "Asia/Bangkok",
      locale: "th-TH",
      serviceWorkers: "block",
    });
    const adapter = new AlmBrowser(context, config);
    if (command === "login") {
      const page = await context.newPage();
      await page.goto(ALM_ORIGIN + "/auth");
      const input = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        await input.question(
          "Complete phone/OTP login in the browser, then press Enter here. No booking will be made.\n",
        );
      } finally {
        input.close();
      }
      await adapter.checkLogin();
      mkdirSync(dirname(config.sessionPath), { recursive: true, mode: 0o700 });
      const temporary = config.sessionPath + ".tmp-" + process.pid;
      writeFileSync(
        temporary,
        JSON.stringify(await context.storageState({ indexedDB: true })),
        { mode: 0o600, flag: "wx" },
      );
      renameSync(temporary, config.sessionPath);
      chmodSync(config.sessionPath, 0o600);
      console.log(
        "ALM session saved privately. Verify reuse with booking:preview.",
      );
    } else {
      await adapter.open();
      if (command === "preview") {
        let authenticated = false;
        try {
          await adapter.checkLogin();
          authenticated = true;
        } catch (error) {
          if (error.code !== "login_required") throw error;
        }
        const { plan, preview } = await previewBooking(
          adapter,
          bookingPlan(date),
        );
        if (authenticated) await adapter.history();
        console.log(
          JSON.stringify(
            {
              mode: "preview-only",
              date,
              courts: plan.courts,
              slots: plan.slots,
              totalBaht: preview.total / 100,
              authenticated,
              historyChecked: authenticated,
            },
            null,
            2,
          ),
        );
      } else {
        if (!existsSync(databasePath))
          throw new BookingError("existing_database_required");
        db = new DatabaseSync(databasePath);
        db.exec(
          "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;",
        );
        const store = bookingStore(db, databasePath);
        await runBooking(adapter, store, date, {
          reconcileOnly: command === "reconcile",
        });
        console.log("ALM run finished; use booking:status for the result.");
      }
    }
  } else {
    throw new BookingError(
      "usage: login | preview YYYY-MM-DD | status | reconcile YYYY-MM-DD",
    );
  }
} catch (error) {
  // Browser and HTTP errors may include session data.
  console.error(
    "ALM: " +
      (error instanceof BookingError
        ? error.code
        : "operation_failed_check_setup"),
  );
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (db) db.close();
}
