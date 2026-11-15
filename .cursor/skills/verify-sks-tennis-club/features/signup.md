# Signup

A member joins an event for the whole session. When the event is full, the next person waits in order. Withdrawing a confirmed player promotes the first person in the waitlist.

## Sub-features

- `signup-join` adds the member with `ลงชื่อนัดนี้`.
- `signup-wait` adds a later member with `เข้าคิวสำรอง`.
- `signup-withdraw` removes the member with `ถอนชื่อของฉัน` and promotes the waitlist.

## How to get to it (user POV)

- Open an event from `ดูนัด →` on the list.
- Use the button under `ลงชื่อทั้งนัด`. The label is `ลงชื่อนัดนี้`, `เข้าคิวสำรอง`, or `ถอนชื่อของฉัน`.

## Driving it with verify-sks

Preconditions:

- Doctor exits 0 on a server this run started.
- Two real LINE members on this origin have nicknames.
- An event exists with capacity 1, and neither member is signed up.
- The default launch does not meet the LINE precondition.

- **Open the event.** From `นัดตีของกลุ่ม`, choose `ดูนัด →` for that event. Run `browser_click` on the button named `ดูนัด →`. The snapshot shows `0 / 1 คน` and a button named `ลงชื่อนัดนี้`.
- **Closed instance.** If the page is still `กำลังเตรียมเปิดใช้งาน`, record `signup-join` as unreachable and stop.
- **Join.** Choose `ลงชื่อนัดนี้`. The button becomes `ถอนชื่อของฉัน`, the count becomes `1 / 1 คน`, and the badge says `คุณลงชื่อแล้ว`.
- **Waitlist.** In a second member session, open the same event and choose `เข้าคิวสำรอง`. The aside says `คิวสำรอง 1 คน` and the badge says `คุณอยู่คิวสำรอง 1`.
- **Promote.** In the first session, choose `ถอนชื่อของฉัน`. Refresh with `อัปเดตรายชื่อ`. The second member is under `ผู้เข้าร่วม` and the waitlist count is 0.
- **Proof.** Snapshot both the participant heading and the waitlist heading after the promotion. Save them under `.cursor/skills/verify-sks-tennis-club/artifacts/signup/`.

## Gotchas

- One browser profile holds one session. The waitlist check needs a second LINE member, not a second click in the same profile.
- `ถอนชื่อของฉัน` is the member's own button. `ยืนยันถอนชื่อ` is the organizer dialog for someone else. Do not swap them.
- Opening the closed welcome and calling the API from a unit test does not prove this screen.
