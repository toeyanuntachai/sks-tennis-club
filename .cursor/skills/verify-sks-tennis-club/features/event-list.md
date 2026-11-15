# Event list

A signed-in member sees the group's events and can open a form to create one. The organizer is not signed up automatically.

## Sub-features

- `list-empty` shows `ยังไม่มีนัดที่เปิดอยู่` when the member has no active events.
- `list-open` opens an event from `ดูนัด →`.
- `list-create` opens `เปิดนัดใหม่` from `+ เปิดนัด` and saves it with `สร้างนัด`.

## How to get to it (user POV)

- Finish LINE login and nickname setup. The app then shows the list on its own.
- From an event, choose `← นัดทั้งหมด`.

## Driving it with verify-sks

Preconditions:

- Doctor exits 0 on a server this run started.
- The browser has a real LINE session for this origin, and the member already has a nickname.
- The default launch does not meet that session precondition.

- **Reach the list.** Open the doctor origin. Run `browser_navigate` to that origin, then `browser_snapshot`.
- **Closed instance.** If the heading is `นัดตีครั้งหน้า` and the page says `กำลังเตรียมเปิดใช้งาน`, stop. Record feature `list-empty` as unreachable. The unmet precondition is a LINE session on this origin. Do not create a session by hand.
- **Empty list.** When the heading is `นัดตีของกลุ่ม` and no events exist, the snapshot contains `ยังไม่มีนัดที่เปิดอยู่`.
- **Open the form.** Choose `+ เปิดนัด`. Run `browser_click` on the button named `+ เปิดนัด`. The heading becomes `เปิดนัดใหม่`.
- **Save an event.** Fill `ชื่อนัด` with `นัดตรวจรับ`, `สนาม` with `สนามตรวจรับ`, `วันที่` with a real date, `เริ่ม` with `18:00`, `สิ้นสุด` with `20:00`, `จำนวนคอร์ต` with `1`, `จำนวนคนที่รับ` with `2`, and `ชื่อหรือหมายเลขคอร์ต` with `คอร์ต 1`. Choose `สร้างนัด`. The heading becomes `นัดตรวจรับ` and a status says `บันทึกนัดแล้ว`.
- **See it on the list.** Choose `← นัดทั้งหมด`. The list shows `นัดตรวจรับ` and `ว่าง 2 ที่`. The organizer is not marked `คุณลงชื่อแล้ว`.
- **Proof.** Snapshot and screenshot under `.cursor/skills/verify-sks-tennis-club/artifacts/event-list/`. Reopen the event and confirm the same title.

## Gotchas

- Default verification leaves LINE unset. Reporting the closed welcome as a passed event list is a failed proof.
- `+ เปิดนัด` is the list button. `สร้างนัด` is the form submit. They are different controls.
- A toast `บันทึกนัดแล้ว` is not enough. The list must show the title after `← นัดทั้งหมด`.
