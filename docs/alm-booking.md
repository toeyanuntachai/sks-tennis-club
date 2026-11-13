# ALMxIMPACT booking bot

The bot shares the existing SKS Railway service and `/data` volume. It does not create community events. Automation is off unless both `ALM_BOOKING_ENABLED=1` and `ALM_BOOKING_VERIFIED=1` are set. No new server, public endpoint, or dashboard is needed.

## Fixed booking rules

All times use Asia/Bangkok, independently of the server timezone. Prepare at 05:59 on Friday seven days before play, begin checkout at 06:00, and stop new submissions at 06:02.

| Play | Required courts | Hours |
| --- | --- | --- |
| Friday | US 7, US 8, and US 9 | 19:00–22:00 first; 20:00–23:00 if unavailable |

All courts and all three hours must be available in one checkout. A private maximum total applies to the whole checkout, not each court. No substitutions, shorter sessions, automatic replacement bookings, customer credit, or bank transfers are performed.

The worker stops after confirming the ALM payment page and saves the booking reference, link, hours, amount, and deadline. Open ALM **My Bookings** or use the saved link from `booking:status`. Transfer the payment and upload the slip yourself. Follow ALM's payment deadline; if none is supplied, allow about five minutes from confirmation. The bot sends no notifications.

## Local setup and read-only preview

Use Node 24. Install dependencies and Chromium:

```sh
npm ci
npx playwright install chromium
```

Keep `ALM_BOOKING_ENABLED=0` and `ALM_BOOKING_VERIFIED=0` in your private `.env`. Set `ALM_MAX_TOTAL_BAHT` to the maximum you actually authorize for one complete booking. No default spending limit is provided. Do not put tokens, phone numbers, OTPs, or saved sessions in Git or chat.

```sh
npm run booking:login
npm run booking:preview -- YYYY-MM-DD
```

Replace `YYYY-MM-DD` with an actual Friday offered by ALM. Login opens a visible browser; complete the phone/OTP flow yourself, then press Enter in the terminal. The command checks the account profile before saving the session. The file defaults to `data/alm-session.json`, with owner-only permissions, beside `SKS_DATABASE_PATH`. Keep a custom `ALM_SESSION_PATH` inside this ignored private directory, never under `public` or `dist`.

Preview physically blocks non-read requests to the ALM API and never accepts court rules or presses confirmation. It checks all three courts and the price, and reports the selected window. Only confirmed court or hour unavailability triggers the fallback. With a saved session it also verifies login and parses booking history. Without a session it can inspect the public checkout, but reports `authenticated: false`; this does not satisfy verification. `unavailable` means it refused a partial booking, not that the bot can be enabled safely. `history_contract_changed` requires inspecting and adapting the signed-in history response before activation.

## Existing Railway service

These are deployment instructions for a later reviewed deployment, not automatic setup:

1. Use the existing SKS service, one replica, existing `/data` volume, `SKS_DATABASE_PATH=/data/sks.sqlite`, and existing origin/LINE settings. The Dockerfile installs Node 24, Chromium/system dependencies, and builds the app. Keep healthcheck `/`. Railway normally detects a root Dockerfile; verify the chosen builder and start command in the existing service. Do not deploy around 05:59–06:08 on booking days.
2. Disable **Settings → Deploy → Serverless**. An in-process timer cannot run while the service sleeps. Check memory/CPU headroom for Chromium and verify that the community app remains responsive during a preview. Existing Railway resource charges may increase.
3. Set the ALM variables privately, initially keeping both activation flags `0`. Set `ALM_SESSION_PATH=/data/alm-session.json`.
4. Transfer the saved session through authenticated Railway SSH, not a public upload route or build argument. After signing in/linking the Railway CLI to the existing project/service and registering your SSH key, the following copies through SSH stdin without printing the session. Execute it from the repository directory:

```sh
railway ssh -- sh -c 'umask 077; cat > /data/alm-session.json.new && chmod 600 /data/alm-session.json.new && mv /data/alm-session.json.new /data/alm-session.json' < data/alm-session.json
railway ssh -- npm run booking:preview -- YYYY-MM-DD
```

Use your configured local session path if it differs. Transfer only to your existing SKS service. `railway run` executes locally and does not place a session on the server. A saved session is a credential; repeat interactive login and transfer when ALM expires it. There is no OTP bypass or automatic OTP retrieval.

## Verification and activation

Before setting `ALM_BOOKING_VERIFIED=1`, verify all of the following as the account holder:

- The saved session works in a fresh browser on Railway without a fresh OTP, including after restarting the service.
- A signed-in preview can parse existing multi-court history correctly, including court IDs, hourly slots, booking reference, payment status, and pagination. Public availability and checkout controls were inspected; authenticated history and payment responses still need live verification.
- During a supervised real booking through ALM's normal UI, all required courts appear in one booking, and you can reopen the payment link on your device, transfer the payment, and upload the slip. Sign in to the same ALM account if required.
- The site explicitly reports paid after payment and expired/cancelled after expiry. If fields differ from the guarded adapter, adjust it and rerun tests before enabling. Review the current court rules yourself before authorizing the scheduled checkout.
- The spending limit is correct and Chromium does not exhaust the existing service's resources.

After review, set both activation flags to `1` and supervise the first scheduled attempt. Be ready to open ALM at 06:00 Bangkok time and pay before the deadline.

## Status, failure recovery, and disabling

```sh
npm run booking:status
npm run booking:reconcile -- YYYY-MM-DD
```

Run these inside Railway SSH for production records. Status shows the saved payment details and whether the page was verified. Reconcile checks the current ALM status for an existing reservation once; it never submits a booking.

Each playing date has one durable run record. Before sending a checkout POST, the worker atomically marks it `submitting`. On restart, interrupted `submitting` runs check history without booking again. `pending` runs are left for manual payment and reconciliation. Unknown responses, worker timeouts, mismatching history, or expired login require human review; do not delete run records to retry. A reservation may exist even when the client did not receive confirmation.

If the payment page cannot be verified, use the saved reference to find the reservation in ALM. Existing notification records remain untouched and are never sent.

Set `ALM_BOOKING_ENABLED=0` and restart/redeploy to stop scheduling. Any reservation already submitted still needs payment or expiry handling. Missing/invalid configuration disables the bot while leaving the community app available. The first enabled startup creates a consistent SQLite backup before adding the booking table. No existing community rows are changed.

The worker has a ten-minute timeout and a separate process group so browser crashes are isolated. Host downtime across the release window means that day's booking is missed; there is no late catch-up or availability guarantee.

## Checks

```sh
npm test
npm run test:booking-browser
docker build -t sks-tennis-club .
```

The normal test suite includes scheduler/date logic, full availability, checkout guards, migration backups, duplicate protection, ambiguous submissions, restart recovery, and manual payment handoff. Browser tests use intercepted fixtures and require the Chromium installation above. They do not connect to live ALM and cannot make real bookings. A Docker build and a Railway preview are separate deployment checks.

References: [Playwright authentication](https://playwright.dev/docs/auth), [Playwright Docker dependencies](https://playwright.dev/docs/docker), [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles), [Railway Serverless](https://docs.railway.com/deployments/serverless), [Railway SSH and piped commands](https://docs.railway.com/cli/ssh).
