# SKS Tennis Club verification map

This directory is the maintained source for verifying what a visitor can do in SKS Tennis Club. Read this index, then use the matching feature file.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-sks-tennis-club/verify.mjs launch`.
- Run `node .cursor/skills/verify-sks-tennis-club/verify.mjs doctor` and require exit 0.
- The origin is the one doctor printed. It is not `http://127.0.0.1:4317` and not `http://127.0.0.1:5173`.
- LINE settings are empty, so `/api/config` has `ready: false`.
- The database path contains `sks-verify-` and lives under the system temp directory.
- Never drive an instance this verification run did not start.

## Driving conventions

- Start from the closed welcome page unless the feature file names another precondition.
- Prefer the accessible name. The stable handles are the Thai labels in each feature file.
- Treat each command as literal.
- Browser actions go through the Cursor browser on the doctor origin.
- Server checks go through `verify.mjs doctor`.
- Do not delete proof files during cleanup.

## Proof and skip reporting

- Capture the action and the resulting state, not only the final screen.
- UI proof is an accessibility snapshot plus a screenshot that shows the SKS logo.
- A 401 from `GET /api/events` belongs with the closed-welcome proof.
- Record the feature id and the entry point with every artifact.
- If a path needs a LINE session and the page is still the closed welcome, write the attempted open and the unmet precondition. Do not mark that feature verified.

## Features

- [Closed welcome](./welcome.md) is the page visitors get before LINE settings exist. This is the path the default server can prove.
- [Event list](./event-list.md) is the signed-in list and the form that opens a new event.
- [Signup](./signup.md) is joining an event, the waitlist, and withdrawing.
- [Payment](./payment.md) is the organizer paid mark, the split cost, and the payment QR.
