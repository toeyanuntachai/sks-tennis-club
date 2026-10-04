# SKS Tennis Club

เว็บลงชื่อนัดตีสำหรับกลุ่ม LINE ปกติ ใช้ Tailwind CSS และสีจากโลโก้ SKS: กรมท่า ครีม และเขียวใบไม้ รุ่นแรกยังไม่มีคะแนนหรือ ranking

## สิ่งที่ทำแล้ว

- สมาชิกเข้าร่วมครั้งแรกผ่านลิงก์เชิญ ยืนยันตัวตนด้วย LINE และตั้งชื่อเล่น
- สมาชิกทุกคนเปิดนัดได้หลังจองคอร์ตเอง ระบุสนาม วัน เวลา คอร์ต และจำนวนคนที่รับ
- ลงชื่อทั้งนัดและถอนชื่อของตัวเอง เมื่อเต็มให้เข้าคิวสำรองตามลำดับลงชื่อ
- เมื่อถอนชื่อ คนแรกในคิวสำรองเลื่อนเข้าแทนทันที ลงชื่อใหม่เริ่มต่อท้ายคิว
- ผู้สร้างนัดแก้ไขหรือยกเลิกนัดของตนเองได้ ลดจำนวนที่รับต่ำกว่าผู้ที่ได้ที่แล้วไม่ได้
- ผู้จัดไม่ได้ถูกลงชื่ออัตโนมัติ นัดที่ยกเลิกเก็บรายชื่อเป็นประวัติและไม่รับการลงชื่อ/ถอนชื่อเพิ่ม
- รายชื่อผู้เข้าร่วมและคิวสำรองแสดง “จ่ายแล้ว / ยังไม่จ่าย” ผู้เปิดนัดติ๊กหรือแก้สถานะได้ สมาชิกคนอื่นดูได้
- ถ้าคนที่มีบันทึกสถานะจ่ายถอนชื่อ จะแสดงแยกใน “ถอนชื่อแล้ว” โดยไม่ใช้ที่นั่ง ลงชื่อใหม่ยังใช้สถานะจ่ายเดิมในนัดนั้น นัดที่ยกเลิกแสดงสถานะเป็นประวัติและแก้ไขไม่ได้
- ผู้เปิดนัดเพิ่มสมาชิกเดิมหรือพิมพ์ชื่อคนที่ยังไม่มีบัญชีได้ รายชื่อใหม่ต่อท้ายคิวและเริ่มยังไม่จ่าย ชื่อที่พิมพ์แสดง “เพิ่มโดยผู้จัด” และแก้ชื่อได้
- ผู้เปิดนัดถอนชื่อแทนและเพิ่มกลับจาก “ถอนชื่อแล้ว” ได้ โดยเก็บสถานะจ่ายเดิมและต่อท้ายคิวเมื่อเพิ่มกลับ
- ผู้เปิดนัดผูกชื่อที่พิมพ์กับบัญชีสมาชิกได้เอง ถ้าลงชื่อซ้ำจะรวมใช้คิวที่ลงก่อนและถือว่าจ่ายแล้วหากรายการใดจ่ายแล้ว ทั้งสองรายการถอนอยู่จะยังถอนอยู่ ไม่จับคู่จากชื่อเล่นอัตโนมัติ
- แชร์ข้อความและลิงก์นัดผ่านตัวเลือกผู้รับของ LINE หรือคัดลอกไปส่งเอง
- ดึงรายชื่อใหม่ทุก 15 วินาทีขณะเปิดหน้ารายการ/รายละเอียด และมีปุ่มอัปเดตเอง

เผยแพร่แล้วที่ [SKS Tennis Club](https://sks-tennis-club-production.up.railway.app/) และตั้งค่า LINE Login Channel ID `2011854065` กับ LIFF ID `2011854065-FGuLpgtP` แล้ว LIFF SDK โหลดได้และปุ่มเข้าใช้งานเปิดหน้า LINE Login ได้ แต่ **ยังต้องตรวจรับการล็อกอินและแชร์ด้วยบัญชี LINE จริง** ก่อนเปิดให้ทั้งกลุ่ม

## เปิดในเครื่อง

ใช้ Node.js 22.13 ขึ้นไป ซึ่งมี `node:sqlite` ในตัว ไม่ต้องติดตั้งฐานข้อมูลแยก

```sh
cd /Users/anuntachai/workspaces/side-projects/sks-tennis-club
npm ci
npm run build
npm test
npm start
```

เปิด http://127.0.0.1:4317 โดยไม่ต้องมี `.env` เพื่อดูหน้าต้อนรับ ต้อง build ใหม่เมื่อแก้ HTML, JavaScript หรือคลาส Tailwind แล้วรีเฟรชหน้าเว็บ

## ตั้งค่า LINE และเปิดให้กลุ่มใช้

1. เตรียมเว็บบนเซิร์ฟเวอร์ที่รัน Node.js ได้และมี HTTPS ที่รากโดเมน เช่น `https://club.example/` ใช้ไฟล์ฐานข้อมูลบนดิสก์ถาวร
2. ลงชื่อเข้า [LINE Developers Console](https://developers.line.biz/console/) สร้างหรือเลือก provider และ LINE Login channel สำหรับเว็บ แล้วจด **Channel ID**
3. ที่ channel เปิดแท็บ **LIFF → Add** ตั้งชื่อ `SKS Tennis Club`, ขนาด `Full`, Endpoint URL เป็น URL ของเว็บพร้อม `/` และ scopes `openid`, `profile` แล้วจด **LIFF ID** ไม่ต้องขอ email หรือส่งข้อความเข้าห้องแชตอัตโนมัติ ดูรายละเอียดใน [คู่มือเพิ่ม LIFF](https://developers.line.biz/en/docs/liff/registering-liff-apps/)
4. เปิดใช้ **Share target picker** และยอมรับเงื่อนไขของฟังก์ชันนี้ใน LIFF settings ตาม [คู่มือแชร์ของ LINE](https://developers.line.biz/en/docs/liff/developing-liff-apps/#sending-messages-to-a-users-friend-share-target-picker)
5. คัดลอก `.env.example` เป็น `.env` เติม `LINE_LOGIN_CHANNEL_ID`, `LINE_LIFF_ID`, `SKS_ORIGIN` ให้ตรงกับโดเมนจริง และสร้าง `SKS_INVITE_CODE` แบบสุ่มอย่างน้อย 24 ตัวอักษร เก็บค่านี้ใน `.env` ของเซิร์ฟเวอร์ ไม่ต้องใช้ Channel Secret
6. ตั้ง `SKS_DATABASE_PATH` เป็นตำแหน่งไฟล์บนดิสก์ถาวร และ `SKS_PORT`/`SKS_BIND_ADDRESS` ตามโฮสต์ หากผ่าน reverse proxy ต้องรักษา Origin header ของเบราว์เซอร์ไว้ แล้ว restart เซิร์ฟเวอร์
7. ทดสอบกับบัญชีผู้ดูแล/ผู้ทดสอบก่อน เมื่อพร้อมให้สมาชิกทั่วไปเข้าได้จึงเปลี่ยน LINE Login channel เป็น Published ตาม [ข้อกำหนดผู้ใช้ของ LINE](https://developers.line.biz/en/docs/line-login/managing-users/)

ลิงก์เริ่มต้นสำหรับผู้จัดคือ `https://liff.line.me/<LIFF_ID>/?invite=<SKS_INVITE_CODE>` เมื่อเข้าร่วมและสร้างนัดแล้ว ปุ่มแชร์นัดจะสร้างลิงก์ให้เอง คนที่มีลิงก์เข้าร่วมได้ตามกติกาที่ตกลงไว้ เว็บไม่ได้ตรวจรายชื่อสมาชิกจากกลุ่ม LINE

สร้าง invite code แบบส่วนตัวด้วยคำสั่งนี้ แล้วนำค่าที่ได้ใส่ `.env`:

```sh
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

## ตรวจรับก่อนแชร์ให้กลุ่ม

- เปิดลิงก์เชิญจาก LINE ด้วยสองบัญชี ตั้งชื่อเล่น และกลับเข้าได้เมื่อปิดแล้วเปิดใหม่
- บัญชีแรกเปิดนัดรับ 1 คน อีกบัญชีลงชื่อ คนถัดไปเข้าคิวสำรอง
- ถอนคนที่ได้ที่แล้วและตรวจว่าคนแรกในคิวสำรองเลื่อนแทน ตรวจการลงชื่อซ้ำและกลับมาต่อท้ายคิว
- บัญชีอื่นไม่มีสิทธิ์แก้/ยกเลิกนัด ผู้จัดแก้ข้อมูลและยกเลิกได้
- ผู้จัดติ๊กจ่ายแล้ว สมาชิกอื่นเห็นสถานะ แต่แก้ไม่ได้ ถอนชื่อแล้วสถานะยังอยู่ในส่วน “ถอนชื่อแล้ว” และกลับมาลงใหม่ยังใช้สถานะเดิม
- แชร์เข้ากลุ่มที่เลือกและตรวจว่าลิงก์เปิดตรงนัดทั้งสมาชิกเดิมและสมาชิกใหม่
- ตรวจจอมือถือใน LINE ทั้ง iOS/Android และเบราว์เซอร์ภายนอก
- restart เซิร์ฟเวอร์แล้วนัดและรายชื่อยังอยู่

## การเก็บข้อมูลและข้อจำกัด

รันแอปหนึ่ง instance ด้วย SQLite ข้อมูลอยู่ที่ `data/sks.sqlite` โดยค่าเริ่มต้น เก็บ LINE user ID ฝั่งเซิร์ฟเวอร์เพื่อผูกสมาชิก ส่วน API รายชื่อส่งเฉพาะรหัสสมาชิกภายในและชื่อเล่น Session cookie เป็น HttpOnly และเก็บเฉพาะ hash ของ token ในฐานข้อมูล

เซิร์ฟเวอร์ตรวจ ID token กับ LINE โดยใช้ Channel ID ของแอป ไม่รับชื่อหรือ user ID ที่เบราว์เซอร์อ้างเอง ตาม [LINE ID token verification](https://developers.line.biz/en/reference/line-login/#verify-id-token) การทดสอบอัตโนมัติจำลองคำตอบ LINE จึงยังไม่ยืนยันการเข้าสู่ระบบหรือแชร์ใน LINE จริง

ใช้ดิสก์ถาวร สำรอง SQLite ด้วย backup API หรือหยุดแอปก่อนสำเนาไฟล์พร้อมข้อมูล WAL หลีกเลี่ยงโฮสต์ที่ล้างไฟล์ทุก deploy หรือรันหลาย instance โดยใช้ไฟล์แยกกัน การเปลี่ยน invite code ปิดลิงก์เชิญเก่า แต่สมาชิกที่เข้าร่วมแล้วกลับเข้าได้

สถานะจ่ายเป็นบันทึกด้วยมือแยกตามนัด ไม่ตรวจยอดโอน ไม่รับชำระเงิน และไม่คำนวณยอดหรือการคืนเงิน ฐานข้อมูลเดิมเพิ่มตารางสถานะจ่ายเมื่อเริ่มเซิร์ฟเวอร์ โดยคงสมาชิก นัด และลำดับลงชื่อเดิมไว้ รายชื่อที่ยังไม่มีบันทึกสถานะเริ่มเป็น “ยังไม่จ่าย”

ชื่อที่ผู้จัดพิมพ์เก็บ `line_id` เป็น NULL และผูกกับนัดเดียว ไม่เป็นบัญชีล็อกอินและไม่อยู่ในตัวเลือกสมาชิก การเริ่มเซิร์ฟเวอร์กับ schema เดิมจะสำรอง SQLite ด้วย `VACUUM INTO` เป็นไฟล์ `.before-guests-<timestamp>-<uuid>.sqlite` ข้างฐานข้อมูลบน Volume ก่อนเปลี่ยนตาราง members ใน transaction ตรวจ foreign keys แล้วจึง commit หากสำรองหรือ migration ไม่สำเร็จ เซิร์ฟเวอร์จะไม่เริ่มรับคำขอ เมื่อรันซ้ำจะไม่ทำ migration เดิมอีก ควรเก็บไฟล์สำรองไว้ก่อนตรวจรับรุ่นนี้

ยังไม่มีระบบปิดรับลงชื่อตามเวลา แจ้งเตือนคิวอัตโนมัติ รับชำระเงิน หรือหลายกลุ่ม ผู้ใช้อนุญาตให้นำโค้ดขึ้น repository `toeyanuntachai/sks-tennis-club` เพื่อ deploy บน Railway แล้ว

## Deploy บน Railway

โครงการ [sks-tennis-club](https://railway.com/project/48d7e695-2a07-4927-9af3-367a05080def) เชื่อม GitHub branch `main` แล้ว รันหนึ่ง instance ใน Singapore และเก็บ SQLite บน Volume ที่ `/data` ตั้ง `PORT=8080`, `SKS_ORIGIN` และ invite code ไว้ใน Railway Variables แล้ว ไม่ต้องสร้าง invite code ใหม่

ใช้ `https://sks-tennis-club-production.up.railway.app/` เป็น LIFF Endpoint URL ตั้ง `LINE_LOGIN_CHANNEL_ID` และ `LINE_LIFF_ID` ใน Railway Variables และ deploy แล้ว เข้าครั้งแรกด้วยลิงก์ LIFF ที่มี invite code จาก Railway Variables จากนั้นตรวจรับการเข้าสู่ระบบ/แชร์ด้วย LINE จริง

ใช้ Node.js 24 ตาม `.node-version` Railway ตรวจคำสั่ง build/start จาก `package.json` โดย `prebuild` ทดสอบก่อน build Tailwind ตั้ง Healthcheck Path ของ service เป็น `/`

1. สร้าง service จาก GitHub repository `toeyanuntachai/sks-tennis-club` บน branch `main`
2. เพิ่ม Volume เชื่อมกับ service โดย mount ที่ `/data` และใช้ service เพียงหนึ่ง instance
3. ตั้ง `SKS_DATABASE_PATH=/data/sks.sqlite`, `SKS_BIND_ADDRESS=0.0.0.0` ไม่ต้องตั้ง `SKS_PORT` เพราะแอปรับ `PORT` ที่ Railway ให้
4. Deploy แล้วไป Settings → Networking → Generate Domain เพื่อได้ URL แบบ HTTPS
5. ตั้ง `SKS_ORIGIN` ให้ตรงกับ URL ที่ได้โดยไม่มี path แล้ว deploy การเปลี่ยนแปลง
6. ใช้ URL พร้อม `/` เป็น LIFF endpoint จากนั้นใส่ `LINE_LOGIN_CHANNEL_ID`, `LINE_LIFF_ID` และ invite code ใน Railway Variables เท่านั้น

ก่อนตั้งค่า LINE ครบ เว็บจะแสดงหน้ารอเปิดใช้งาน ระบบ API รายชื่อยังต้องยืนยันตัวตน และจะไม่เปิดเผยข้อมูลให้ผู้เข้าชมทั่วไป

อ้างอิง: [Railpack Node.js](https://railpack.com/languages/node/), [Volumes](https://docs.railway.com/volumes), [สร้างโดเมน](https://docs.railway.com/networking/domains/working-with-domains)

## ตรวจสอบโค้ด

`npm test` ตรวจ API กับ SQLite จริง: การปฏิเสธ token/ลิงก์เชิญที่ผิด สิทธิ์ผู้จัด การลงชื่อของตัวเอง FIFO การถอน/เลื่อนคิว การเพิ่ม/ลดจำนวนที่รับ การยกเลิก และการเก็บข้อมูล รวมถึงสิทธิ์บันทึกสถานะจ่าย สถานะเมื่อถอนชื่อ/กลับมาลงใหม่ การแยกสถานะตามนัด และ UI เมื่อบันทึกไม่สำเร็จ ทดสอบการเปิดลิงก์หลัง LIFF initialization ด้วย SDK จำลอง

การทดสอบรายชื่อที่ผู้จัดเพิ่มครอบคลุมขอบเขตนัด คิวเมื่อเต็ม การเพิ่มซ้ำ ถอน/เพิ่มกลับ ผูกบัญชีทั้งมีและไม่มีรายการซ้ำ รวมคิวและสถานะจ่าย การเลื่อนสำรอง และการปฏิเสธ session ของชื่อที่ไม่มี LINE ID รวมถึง migration จากฐานข้อมูลเดิมที่มี WAL โดยตรวจสมาชิก session นัด sequence และสถานะจ่ายทั้งในไฟล์สำรองและหลัง migration และตรวจว่ารันซ้ำไม่เปลี่ยน schema เพิ่ม

`npm run build` สร้าง CSS ด้วย Tailwind CLI จาก `src/styles.css` และคลาสใน `public/` ตาม [Tailwind CLI](https://tailwindcss.com/docs/installation/tailwind-cli) ไม่มี Tailwind CDN สำหรับ production

ตรวจ deploy วันที่ 4 ตุลาคม 2026: build และการทดสอบผ่านบน Node.js 24, หน้าเว็บ/CSS/โลโก้ตอบ 200 ผ่าน HTTPS, API รายชื่อปฏิเสธผู้ไม่ล็อกอินด้วย 401 และ URL ไฟล์ฐานข้อมูลตอบ 404

`npm audit --omit=dev` ไม่พบช่องโหว่ ส่วน audit รวมเครื่องมือ build พบ 4 รายการจาก dependency chain ของ Tailwind CLI → watcher → micromatch → braces ตาม [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) ซึ่งยังไม่มี patched version ของ braces ณ วันที่ตรวจ เครื่องมือเหล่านี้ใช้ build CSS จากไฟล์ใน repository; เซิร์ฟเวอร์รับคำขอใช้เฉพาะโมดูล Node.js ในตัว ติดตามการแก้ไข upstream ก่อนอัปเดต dependency
