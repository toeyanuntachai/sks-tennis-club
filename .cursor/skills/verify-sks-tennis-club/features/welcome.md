# Closed welcome

Before LINE settings exist, a visitor sees the club name and a notice that the organizer will share a link later. There is no login button and no event list.

## Sub-features

- `welcome-closed` shows the closed notice when `/api/config` has `ready: false`.
- `welcome-gate` keeps event data behind login. `GET /api/events` returns 401.

## How to get to it (user POV)

- Open the site root in a browser.

## Driving it with verify-sks

Preconditions:

- `verify.mjs doctor` exits 0.
- Doctor reports `line is unset` with `{"liffId":"","ready":false}`.

- **Open the root.** Visit the doctor origin. Run `browser_navigate` to that origin. The snapshot heading is `นัดตีครั้งหน้า`. The page contains `กำลังเตรียมเปิดใช้งาน` and `ผู้จัดกลุ่มจะแชร์ลิงก์เมื่อพร้อมครับ`.
- **Confirm the gate.** Run `browser_snapshot`. There is no button named `เข้าใช้งานผ่าน LINE`, no button named `+ เปิดนัด`, and no heading `นัดตีของกลุ่ม`.
- **Confirm the server.** Doctor already recorded `GET /api/events` as 401 with `กรุณาเข้าใช้งานผ่าน LINE`. Do not treat the HTML shell text `กำลังเปิดนัดตีของกลุ่ม…` as the closed notice. That string is only in the document before React runs.
- **Proof.** Run `browser_take_screenshot`. Copy the saved image to `.cursor/skills/verify-sks-tennis-club/artifacts/welcome/welcome.png`. The browser tool does not write into the repo. Save the snapshot text to `snapshot.txt` in that same directory. Save `proof.txt` with feature id `welcome-closed`, entry point `site root`, and the copied screenshot path. The screenshot shows the SKS logo and `กำลังเตรียมเปิดใช้งาน`.

## Gotchas

- `GET /` does not contain `กำลังเตรียมเปิดใช้งาน`. React paints that after `/api/config` returns.
- If doctor reports `ready: true`, stop. That process loaded LINE settings. Do not drive it.
- The button `เข้าใช้งานผ่าน LINE` belongs to a configured server. Its absence is the proof on this instance.
- Do not load `.env` and do not reuse port 4317.
