---
name: verify-sks-tennis-club
description: Drive the SKS Tennis Club web app on an isolated local Node server and prove what a visitor sees. Use after a change to the club UI or server.mjs, when unit tests do not show the served page.
---

# Verify SKS Tennis Club

Drive the Node server and the React page it serves. Use this after a change to the club UI or `server.mjs`, when `npm test` does not show what a visitor sees.

The verification instance is a separate process. It uses a temporary SQLite file and a free localhost port. Launch does not read `.env`, so LINE stays unset and `/api/config` reports `ready: false`. Do not point it at `data/sks.sqlite`, port 4317, or port 5173.

Two instances can run if they use different ports and database files. This helper allows one verification server. Leave a normal `npm start` alone. Never drive a server this run did not start.

## Launch

From the repo root:

```sh
node .cursor/skills/verify-sks-tennis-club/verify.mjs launch
```

If `dist/index.html` is missing, launch runs `npm run build` first. It then starts `node server.mjs` with empty `LINE_LOGIN_CHANNEL_ID`, `LINE_LIFF_ID`, and `SKS_INVITE_CODE`. Ready means `GET /api/config` returns `{"liffId":"","ready":false}`. The command prints JSON with `origin`, `pid`, and `databasePath`, and writes `.cursor/skills/verify-sks-tennis-club/run.json`.

If `run.json` names a pid that is still listening, launch exits with an error. Run cleanup, then launch again.

## Doctor

```sh
node .cursor/skills/verify-sks-tennis-club/verify.mjs doctor
```

Doctor is read-only. Exit 0 only when all of these hold.

- The pid in `run.json` is alive.
- That pid is the listener on the recorded port.
- `GET /` returns 200 and HTML that contains `SKS Tennis Club` and `id="root"`.
- `GET /api/config` returns `ready: false` and an empty `liffId`.
- `GET /api/events` returns 401 and `กรุณาเข้าใช้งานผ่าน LINE`.
- `GET /sks-logo.png` returns 200 with `image/png`.
- The database path is under the system temp directory, contains `sks-verify-`, and the file exists.

The report is written to `.cursor/skills/verify-sks-tennis-club/artifacts/doctor/report.txt`. If doctor fails, stop. Do not drive the page.

## Drive

Read `features/README.md`, then the feature file you are proving. Browser steps use the Cursor browser against the origin doctor printed.

1. `browser_navigate` to that origin with no extra path.
2. `browser_lock` the tab before further actions.
3. `browser_snapshot` for the accessibility tree.
4. `browser_take_screenshot` for the visible page.
5. `browser_lock` with action `unlock` when the drive is finished.

On the closed welcome page the snapshot must show heading text `นัดตีครั้งหน้า` and text `กำลังเตรียมเปิดใช้งาน`. It must not show a button named `เข้าใช้งานผ่าน LINE` or `+ เปิดนัด`. The logo image name is `โลโก้ SKS Tennis Club`.

`GET /` returns the HTML shell. Inside `#root` that shell only has `กำลังเปิดนัดตีของกลุ่ม…`. That string is not proof the closed state rendered. The snapshot is.

Write the snapshot text to `.cursor/skills/verify-sks-tennis-club/artifacts/welcome/snapshot.txt`. `browser_take_screenshot` stores the image outside the repo. Copy that file to `.cursor/skills/verify-sks-tennis-club/artifacts/welcome/welcome.png`. Write the feature id, entry point, and that path to `.cursor/skills/verify-sks-tennis-club/artifacts/welcome/proof.txt`.

Signed-in screens need a real LINE login on this same origin. This launch does not create a session. When the snapshot is the closed welcome, record event list, signup, and payment as unreachable. Do not insert into `sessions`, do not call `POST /api/auth` with a made-up token, and do not load `.env` to borrow the club database.

## Evidence

A pass includes the doctor report, the snapshot, and the screenshot of the same page. The action is opening the origin. The resulting state is the closed welcome, and `GET /api/events` returns 401 in the doctor report.

Evidence stays in `.cursor/skills/verify-sks-tennis-club/artifacts/`. Cleanup does not delete that directory.

Mocks stay at the LINE verify call the server already makes to `https://api.line.me/oauth2/v2.1/verify`. This skill does not add a stand-in for that call. A dry name is not proof. Doctor observes `ready: false` from `/api/config`.

## Cleanup

```sh
node .cursor/skills/verify-sks-tennis-club/verify.mjs cleanup
```

Cleanup sends SIGTERM to the pid only when that pid is still listening on the recorded port. It then deletes the temp database directory and `run.json`. It leaves `artifacts/` in place. After cleanup, confirm `artifacts/doctor/report.txt` and any feature proof files still exist.

## Helpers

The helper is `.cursor/skills/verify-sks-tennis-club/verify.mjs`. Invoke it as shown above. Commands are `launch`, `doctor`, and `cleanup`.
