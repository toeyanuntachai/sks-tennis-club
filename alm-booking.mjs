import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ALM_ORIGIN = "https://www.almximpact.com";
export const ALM_API = "https://alm-x-impact-tennis-production.up.railway.app";
const workerPath = fileURLToPath(
  new URL("./scripts/alm-booking.mjs", import.meta.url),
);
const dayMs = 86400000;
const leadDays = 6;

export class BookingError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export function bookingPlan(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BookingError("invalid_date");
  const time = Date.parse(date + "T00:00:00Z");
  if (
    !Number.isFinite(time) ||
    new Date(time).toISOString().slice(0, 10) !== date
  )
    throw new BookingError("invalid_date");
  const weekday = new Date(time).getUTCDay();
  if (weekday !== 5) throw new BookingError("not_a_playing_day");
  const releaseDate = new Date(time - leadDays * dayMs)
    .toISOString()
    .slice(0, 10);
  const releaseAt = Date.parse(releaseDate + "T06:00:00+07:00");
  return {
    date,
    courts: ["US7", "US8", "US9"],
    slots: ["19:00-20:00", "20:00-21:00", "21:00-22:00"],
    fallbackSlots: ["20:00-21:00", "21:00-22:00", "22:00-23:00"],
    releaseAt,
    prepareAt: releaseAt - 60000,
    stopAt: releaseAt + 120000,
  };
}

export function dueBooking(now = Date.now()) {
  const date = new Date(now + 7 * 3600000 + leadDays * dayMs)
    .toISOString()
    .slice(0, 10);
  if (new Date(date + "T00:00:00Z").getUTCDay() !== 5) return null;
  const plan = bookingPlan(date);
  return now >= plan.prepareAt && now < plan.stopAt ? plan : null;
}

export function bookingConfig(
  env = process.env,
  databasePath = "data/sks.sqlite",
) {
  const maxBaht = Number(env.ALM_MAX_TOTAL_BAHT);
  return {
    enabled: env.ALM_BOOKING_ENABLED === "1",
    verified: env.ALM_BOOKING_VERIFIED === "1",
    maxSatang:
      Number.isSafeInteger(maxBaht) && maxBaht > 0 && maxBaht <= 1000000
        ? maxBaht * 100
        : 0,
    sessionPath: resolve(
      env.ALM_SESSION_PATH || join(dirname(databasePath), "alm-session.json"),
    ),
  };
}

export function checkConfig(config) {
  if (!config.verified)
    throw new BookingError("supervised_verification_required");
  if (!config.maxSatang) throw new BookingError("spending_limit_required");
  if (!existsSync(config.sessionPath))
    throw new BookingError("session_required");
}

export function bookingStore(db, databasePath = ":memory:") {
  if (
    !db
      .prepare("SELECT 1 FROM sqlite_master WHERE name='alm_booking_runs'")
      .get()
  ) {
    if (databasePath !== ":memory:") {
      const backup =
        resolve(databasePath) +
        ".before-alm-booking-" +
        Date.now() +
        "-" +
        randomUUID() +
        ".sqlite";
      db.prepare("VACUUM INTO ?").run(backup);
      console.log(
        "SQLite backup created before ALM booking migration: " + backup,
      );
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`CREATE TABLE alm_booking_runs (
        date TEXT PRIMARY KEY, plan TEXT NOT NULL, state TEXT NOT NULL,
        started_at INTEGER NOT NULL, submitted_at INTEGER, updated_at INTEGER NOT NULL,
        details TEXT, error TEXT
      );`);
      if (db.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("ALM migration failed foreign key check");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    get(date) {
      const row = db
        .prepare("SELECT * FROM alm_booking_runs WHERE date=?")
        .get(date);
      return (
        row && {
          ...row,
          plan: JSON.parse(row.plan),
          details: row.details ? JSON.parse(row.details) : null,
        }
      );
    },
    claim(plan, now = Date.now()) {
      return (
        db
          .prepare(
            "INSERT OR IGNORE INTO alm_booking_runs(date,plan,state,started_at,updated_at) VALUES(?,?,'preparing',?,?)",
          )
          .run(plan.date, JSON.stringify(plan), now, now).changes === 1
      );
    },
    update(date, state, details = null, error = null) {
      db.prepare(
        "UPDATE alm_booking_runs SET state=?,details=COALESCE(?,details),error=?,updated_at=?,submitted_at=CASE WHEN ?='submitting' THEN COALESCE(submitted_at,?) ELSE submitted_at END WHERE date=?",
      ).run(
        state,
        details ? JSON.stringify(details) : null,
        error,
        Date.now(),
        state,
        Date.now(),
        date,
      );
    },
    submitting(date, details) {
      const now = Date.now();
      if (
        db
          .prepare(
            "UPDATE alm_booking_runs SET state='submitting',submitted_at=?,updated_at=?,details=? WHERE date=? AND state='preparing'",
          )
          .run(now, now, details ? JSON.stringify(details) : null, date)
          .changes !== 1
      )
        throw new BookingError("submission_already_claimed");
    },
    unfinished() {
      return db
        .prepare(
          "SELECT date FROM alm_booking_runs WHERE state IN ('preparing','submitting') ORDER BY started_at",
        )
        .all()
        .map((row) => this.get(row.date));
    },
  };
}

export function startBookingScheduler(db, databasePath, env = process.env) {
  const config = bookingConfig(env, databasePath);
  if (!config.enabled) return () => {};
  try {
    checkConfig(config);
  } catch (error) {
    console.error("ALM booking disabled: " + error.code);
    return () => {};
  }
  let store;
  try {
    store = bookingStore(db, databasePath);
  } catch {
    console.error("ALM booking disabled: database_setup_failed");
    return () => {};
  }
  let active = null;
  let stopped = false;
  function launch(row) {
    const child = spawn(process.execPath, [workerPath, "worker", row.date], {
      env: { ...env, SKS_DATABASE_PATH: databasePath },
      stdio: "ignore",
      detached: true,
    });
    active = child;
    let killed = false;
    const kill = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* Process group already exited. */
      }
    };
    // Bound browser startup, booking, and interrupted-checkout recovery.
    const timeout = setTimeout(() => {
      killed = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 3000).unref();
    }, 10 * 60000);
    const finish = () => {
      clearTimeout(timeout);
      if (active !== child) return;
      active = null;
      const current = store.get(row.date);
      if (["preparing", "submitting"].includes(current.state)) {
        const uncertain = current.state !== "preparing";
        store.update(
          row.date,
          uncertain ? "uncertain" : "failed",
          null,
          killed ? "worker_timeout" : "worker_stopped",
        );
      }
    };
    child.once("error", finish);
    child.once("exit", finish);
  }
  function tick() {
    if (stopped) return;
    try {
      if (!active) {
        const unfinished = store.unfinished();
        const row = unfinished[0];
        if (row) launch(row);
        else {
          const plan = dueBooking();
          if (plan && store.claim(plan)) launch(store.get(plan.date));
        }
      }
    } catch {
      console.error("ALM scheduler failed; community app remains running.");
    }
  }
  const timer = setInterval(() => {
    tick();
  }, 5000);
  timer.unref();
  tick();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    if (active?.pid) {
      try {
        process.kill(-active.pid, "SIGTERM");
      } catch {
        /* Already exited. */
      }
    }
  };
  return stop;
}
