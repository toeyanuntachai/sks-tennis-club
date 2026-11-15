# Payment

The organizer records who has paid. Other members can see `จ่ายแล้ว` or `ยังไม่จ่าย` and cannot change it. Optional court cost, ball cost, and a payment QR show on the event. The split uses only people who have a spot.

## Sub-features

- `pay-mark` lets the organizer set `จ่ายแล้ว` for a participant.
- `pay-locked` shows the same mark to another member with no checkbox they can change.
- `pay-split` shows `บาท/คน` from the costs on the event.
- `pay-qr` opens `QR จ่ายเงิน` from the control named `ขยาย QR จ่ายเงิน`.

## How to get to it (user POV)

- Open an event that has a participant.
- The paid control is the checkbox labeled `จ่ายแล้ว: ` plus the nickname, shown to the organizer.
- Everyone else sees the text `จ่ายแล้ว` or `ยังไม่จ่าย`.
- Costs and the QR are in the section `ค่าใช้จ่ายและการจ่ายเงิน`.

## Driving it with verify-sks

Preconditions:

- Doctor exits 0 on a server this run started.
- The organizer and one other member have real LINE sessions on this origin.
- The organizer created an event, set a court cost, attached a PNG QR, and the other member has a spot.
- The default launch does not meet the LINE precondition.

- **Closed instance.** If the root snapshot says `กำลังเตรียมเปิดใช้งาน`, record `pay-mark` as unreachable and stop.
- **Mark paid.** As the organizer, open the event and check the checkbox named `จ่ายแล้ว: ` plus the member nickname. Run `browser_click` on that checkbox. The row shows `จ่ายแล้ว`.
- **Other member.** In the other member's session, open the same event. The row shows `จ่ายแล้ว` and there is no checkbox named `จ่ายแล้ว: `.
- **Split.** The section `ค่าใช้จ่ายและการจ่ายเงิน` shows `บาท/คน`. With one confirmed player, the per-person amount matches the court cost rounded up to a baht.
- **QR.** Choose the button named `ขยาย QR จ่ายเงิน`. The dialog heading is `QR จ่ายเงิน`. Close it with `ปิด`.
- **Proof.** Snapshot the paid row and the `บาท/คน` line. Screenshot the dialog. Save both under `.cursor/skills/verify-sks-tennis-club/artifacts/payment/`.

## Gotchas

- A member who is not the organizer never gets the paid checkbox. Seeing the words `จ่ายแล้ว` is the other member's proof.
- Waitlist and withdrawn people are outside the split. Prove the amount from the text `หารผู้ได้ที่ในนัด`, not from a private calculation alone.
- The server does not check a bank transfer. The proof is the mark on the page and the same mark in the other member's session.
