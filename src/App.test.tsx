import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { EventForm } from './EventForm';
import type { EventDetail } from './lib/api';

const owner = { id: 'owner', nickname: 'ผู้จัด' };
const guest = { id: 'guest', nickname: 'เพื่อน <ใหม่>', isGuest: true, paid: true };
function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return { id: 'e', title: 'นัดที่แชร์', venue: 'สนาม', date: '2026-10-10', start: '18:00', end: '20:00', courts: 2, courtNames: '1, 2', capacity: 1, cancelled: false, organizerName: owner.nickname, confirmed: 1, waiting: 0, myPosition: null, isOrganizer: true, participants: [guest], waitlist: [], withdrawn: [{ id: 'withdrawn', nickname: 'ถอน', isGuest: false, paid: true }], courtCostSatang: null, ballCostSatang: null, totalCostSatang: null, sharePeople: 1, sharePerPersonSatang: null, roundingSurplusSatang: null, hasPaymentQr: false, ...overrides };
}
type Request = { path: string; method: string; data: Record<string, unknown> };
function backend(event: EventDetail, handle?: (request: Request) => Response | Promise<Response> | undefined) {
  const requests: Request[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit = {}) => {
    const request = { path, method: options.method || 'GET', data: options.body ? JSON.parse(String(options.body)) : {} };
    requests.push(request);
    const response = await handle?.(request); if (response) return response;
    if (path === '/api/config') return Response.json({ ready: false, liffId: '' });
    if (path === '/api/me') return Response.json({ member: owner });
    if (path === '/api/events') return Response.json({ events: [event] });
    if (/^\/api\/events\/[^/]+\/matches$/.test(path) && request.method === 'GET') return Response.json({ matches: [], players: [], canRecord: false });
    if (path === '/api/events/e' && request.method === 'GET') return Response.json({ event });
    if (path === '/api/events/e/available-members') return Response.json({ members: [{ id: 'registered', nickname: 'สมาชิกหนึ่ง' }] });
    if (path === '/api/invite') return Response.json({ url: 'https://liff.line.me/test/?invite=test-only' });
    throw new Error('Unexpected route: ' + request.method + ' ' + path);
  }));
  return requests;
}
beforeEach(() => {
  history.replaceState(null, '', '/?event=e');
  delete window.liff;
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // jsdom has no image decoder; browser QA verifies the actual PNG/JPEG decode.
  Object.defineProperty(Image.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

test('roster photos appear in each list, fall back on failure, and retry when the URL changes', async () => {
  const pictureUrl = 'https://profile.line-scdn.net/player';
  const player = { id: 'player', nickname: 'ต้น', paid: false, isGuest: false, pictureUrl };
  const event = detail({ participants: [player, guest], waitlist: [{ ...player, id: 'waiting' }], withdrawn: [{ ...player, id: 'withdrawn' }] });
  backend(event, ({ path }) => path.endsWith('/payment') ? Response.json({ event: { ...event, participants: [{ ...player, pictureUrl: pictureUrl + '-new' }, guest] } }) : undefined);
  render(<App />);
  await screen.findByRole('heading', { name: 'นัดที่แชร์' });
  const photos = document.querySelectorAll<HTMLImageElement>('img[src="' + pictureUrl + '"]');
  expect(photos).toHaveLength(3);
  const row = photos[0].closest('li')!;
  expect(photos[0].alt).toBe('');
  expect(photos[0].getAttribute('referrerpolicy')).toBe('no-referrer');
  fireEvent.error(photos[0]);
  expect(photos[0].hidden).toBe(true);
  expect(within(row).getByText('ต')).toBeTruthy();
  expect(screen.getByText(guest.nickname).closest('li')!.querySelector('img')).toBeNull();
  await userEvent.click(within(row).getByRole('checkbox'));
  await waitFor(() => expect(document.querySelector('img[src="' + pictureUrl + '-new"]')).toBeTruthy());
  expect(document.querySelector<HTMLImageElement>('img[src="' + pictureUrl + '-new"]')!.hidden).toBe(false);
});

test('shared event is read after LIFF normalizes the URL; member names remain text and organizer actions stay hidden', async () => {
  history.replaceState(null, '', '/?liff.state=redirect');
  const calls: string[] = [];
  const event = detail({ isOrganizer: false, myPosition: 1, hasPaymentQr: true });
  backend(event, ({ path }) => {
    calls.push(path);
    if (path === '/api/config') return Response.json({ ready: true, liffId: 'test-liff' });
    if (path === '/api/me') return Response.json({ member: { id: 'guest', nickname: '<img src=x onerror=alert(1)>' } });
  });
  window.liff = {
    async init({ liffId }) { expect(liffId).toBe('test-liff'); calls.push('init'); history.replaceState(null, '', '/?event=e&invite=test-only'); },
    isLoggedIn: () => true, login: vi.fn(), getIDToken: () => 'test-token', isApiAvailable: () => false, shareTargetPicker: vi.fn(),
  };
  render(<App />);
  await screen.findByRole('heading', { name: 'นัดที่แชร์' });
  expect(calls).toEqual(['/api/config', 'init', '/api/me', '/api/events/e', '/api/events/e/matches']);
  expect(screen.getByRole('button', { name: 'ถอนชื่อของฉัน' })).toBeTruthy();
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  expect(screen.getByRole('checkbox', { name: 'จ่ายแล้ว: ' + guest.nickname })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '+ เพิ่มรายชื่อ' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'แก้ไขนัด' })).toBeNull();
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  expect(document.querySelector('img[src="x"]')).toBeNull();
  expect(location.search).toBe('?event=e');
  await userEvent.click(screen.getByRole('button', { name: 'ขยาย QR จ่ายเงิน' }));
  expect(within(screen.getByRole('dialog')).getByAltText('QR จ่ายเงินขนาดใหญ่').getAttribute('src')).toBe('/api/events/e/payment-qr');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'ขยาย QR จ่ายเงิน' })));
});

test('new LINE member keeps invite and requested event through profile completion; external browser opens LINE login', async () => {
  const event = detail({ isOrganizer: false });
  let loggedIn = false;
  const requests = backend(event, ({ path, method }) => {
    if (path === '/api/config') return Response.json({ ready: true, liffId: 'test-liff' });
    if (path === '/api/me' && method === 'GET') return Response.json({ message: 'login' }, { status: 401 });
    if (path === '/api/auth') return Response.json({ member: { id: 'new', nickname: null }, suggestedNickname: 'ชื่อจาก LINE' });
    if (path === '/api/me' && method === 'PATCH') return Response.json({ member: { id: 'new', nickname: 'เพื่อนใหม่' } });
  });
  window.liff = {
    init: vi.fn(async () => { history.replaceState(null, '', '/?event=e&invite=test-only'); }), isLoggedIn: () => loggedIn,
    login: vi.fn(() => { loggedIn = true; }), getIDToken: () => 'test-token', isApiAvailable: () => false, shareTargetPicker: vi.fn(),
  };
  render(<App />);
  await userEvent.click(await screen.findByRole('button', { name: 'เข้าใช้งานผ่าน LINE' }));
  expect(window.liff.login).toHaveBeenCalledWith({ redirectUri: location.href });
  await userEvent.click(screen.getByRole('button', { name: 'เข้าใช้งานผ่าน LINE' }));
  const input = await screen.findByRole('textbox', { name: 'ชื่อเล่น' });
  expect((input as HTMLInputElement).value).toBe('ชื่อจาก LINE');
  await userEvent.clear(input); await userEvent.type(input, 'เพื่อนใหม่');
  await userEvent.click(screen.getByRole('button', { name: 'บันทึกชื่อเล่น' }));
  await screen.findByRole('heading', { name: 'นัดที่แชร์' });
  expect(requests.find(r => r.path === '/api/auth')?.data).toEqual({ idToken: 'test-token', invite: 'test-only' });
  expect(location.search).toBe('?event=e');
  expect(window.liff.init).toHaveBeenCalledTimes(1);
});

test('event form retains typed fields and the chosen QR after failure, saves satang, and then expands the saved QR', async () => {
  const event = detail(); let fail = true;
  const requests = backend(event, ({ path, method, data }) => {
    if (path === '/api/events/e' && method === 'PATCH') {
      if (fail) return Response.json({ message: 'บันทึกไม่สำเร็จ' }, { status: 500 });
      return Response.json({ event: { ...event, title: data.title, hasPaymentQr: true, courtCostSatang: 100050, totalCostSatang: 100050, sharePerPersonSatang: 100100, roundingSurplusSatang: 50 } });
    }
  });
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: 'แก้ไขนัด' }));
  const title = screen.getByRole('textbox', { name: 'ชื่อนัด' });
  await user.clear(title); await user.type(title, 'นัดแก้ไข');
  await user.type(screen.getByLabelText('ค่าคอร์ตรวม (บาท)'), '1000.50');
  const costValue = (screen.getByLabelText('ค่าคอร์ตรวม (บาท)') as HTMLInputElement).value;
  const file = new File(['png'], 'qr.png', { type: 'image/png' });
  await user.upload(screen.getByLabelText('รูป QR จ่ายเงิน'), file);
  await screen.findByAltText('ตัวอย่าง QR จ่ายเงิน');
  await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
  await screen.findByRole('alert');
  expect((title as HTMLInputElement).value).toBe('นัดแก้ไข');
  expect((screen.getByLabelText('รูป QR จ่ายเงิน') as HTMLInputElement).files?.[0]).toBe(file);
  expect(screen.getByAltText('ตัวอย่าง QR จ่ายเงิน').getAttribute('src')).toBe('data:image/png;base64,cG5n');
  expect((screen.getByLabelText('ค่าคอร์ตรวม (บาท)') as HTMLInputElement).value).toBe(costValue);
  fail = false; await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
  await screen.findByRole('heading', { name: 'นัดแก้ไข' });
  expect(requests.filter(r => r.method !== 'GET').at(-1)?.data).toMatchObject({ courtCostSatang: 100050, ballCostSatang: null, paymentQr: 'cG5n' });
  expect(screen.getByText('ปัดขึ้นเป็นบาท · ส่วนเกินรวม 0.5 บาท')).toBeTruthy();
});

test('existing QR is omitted when unchanged, null when removed; optional costs permit blank and zero', async () => {
  const event = detail({ hasPaymentQr: true });
  const saved = vi.fn();
  const requests = backend(event, ({ path, method }) => path === '/api/events/e' && method === 'PATCH' ? Response.json({ event }) : undefined);
  const user = userEvent.setup(); render(<EventForm event={event} onBack={vi.fn()} onSaved={saved} onError={vi.fn()} />);
  await user.type(screen.getByLabelText('ค่าลูกเทนนิสรวม (บาท)'), '0');
  await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(requests[0].data).toMatchObject({ courtCostSatang: null, ballCostSatang: 0 });
  expect(requests[0].data).not.toHaveProperty('paymentQr');
  await user.click(screen.getByRole('button', { name: 'ลบรูป QR' }));
  expect(screen.queryByAltText('ตัวอย่าง QR จ่ายเงิน')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(requests[1].data.paymentQr).toBeNull();
});

test('invalid and oversized QR and negative costs never submit or replace the current preview', async () => {
  const requests = backend(detail());
  const user = userEvent.setup({ applyAccept: false });
  render(<EventForm event={detail({ hasPaymentQr: true })} onBack={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} />);
  await user.upload(screen.getByLabelText('รูป QR จ่ายเงิน'), new File(['bad'], 'qr.svg', { type: 'image/svg+xml' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'รูป QR ต้องเป็นไฟล์ PNG หรือ JPEG');
  await user.upload(screen.getByLabelText('รูป QR จ่ายเงิน'), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('รูป QR ต้องไม่เกิน 2 MB'));
  expect(screen.getByAltText('ตัวอย่าง QR จ่ายเงิน').getAttribute('src')).toBe('/api/events/e/payment-qr');
  await user.type(screen.getByLabelText('ค่าคอร์ตรวม (บาท)'), '-1');
  await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));
  expect(requests).toHaveLength(0);
});

test('organizer adds, renames, links, withdraws and restores names; failed dialog save retains actual input', async () => {
  const event = detail(); let fail = true;
  const requests = backend(event, ({ path, method }) => {
    if (path.includes('/participants') && method !== 'GET') return fail ? Response.json({ message: 'บันทึกไม่สำเร็จ' }, { status: 500 }) : Response.json({ event });
  });
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: '+ เพิ่มรายชื่อ' }));
  await user.selectOptions(screen.getByLabelText('วิธีเพิ่ม'), 'name');
  await user.type(screen.getByRole('textbox', { name: 'ชื่อเล่น' }), 'เพื่อนใหม่');
  await user.click(screen.getByRole('button', { name: 'เพิ่มรายชื่อ' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'บันทึกไม่สำเร็จ');
  expect((screen.getByRole('textbox', { name: 'ชื่อเล่น' }) as HTMLInputElement).value).toBe('เพื่อนใหม่');
  fail = false; await user.click(screen.getByRole('button', { name: 'เพิ่มรายชื่อ' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests.filter(r => r.method !== 'GET').at(-1)).toMatchObject({ path: '/api/events/e/participants', method: 'POST', data: { nickname: 'เพื่อนใหม่' } });
  await user.click(screen.getByRole('button', { name: 'แก้ชื่อ: ' + guest.nickname }));
  await user.clear(screen.getByRole('textbox', { name: 'ชื่อเล่น' }));
  await user.type(screen.getByRole('textbox', { name: 'ชื่อเล่น' }), 'ชื่อใหม่');
  await user.click(screen.getByRole('button', { name: 'บันทึกชื่อ' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests.filter(r => r.method !== 'GET').at(-1)).toMatchObject({ method: 'PATCH', data: { nickname: 'ชื่อใหม่' } });
  await user.click(screen.getByRole('button', { name: 'ผูกบัญชี: ' + guest.nickname }));
  await user.click(screen.getByRole('combobox', { name: 'สมาชิก' }));
  await user.click(await screen.findByRole('option', { name: 'สมาชิกหนึ่ง' }));
  await user.click(screen.getByRole('button', { name: 'ยืนยันผูกบัญชี' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests.filter(r => r.method !== 'GET').at(-1)).toMatchObject({ path: '/api/events/e/participants/guest', method: 'PATCH', data: { memberId: 'registered' } });
  await user.click(screen.getByRole('button', { name: 'ถอนชื่อ: ' + guest.nickname }));
  await user.click(screen.getByRole('button', { name: 'ยืนยันถอนชื่อ' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests.filter(r => r.method !== 'GET').at(-1)).toMatchObject({ method: 'DELETE', data: {} });
  await user.click(screen.getByRole('button', { name: 'เพิ่มกลับ: ถอน' }));
  await waitFor(() => expect(requests.filter(r => r.method !== 'GET').at(-1)).toMatchObject({ path: '/api/events/e/participants', method: 'POST', data: { memberId: 'withdrawn' } }));
});

test('member combobox searches and selects multiple accounts, removes chips and retains selections after failed batch save', async () => {
  const event = detail(); let fail = true;
  const requests = backend(event, ({ path, method }) => {
    if (path.endsWith('/available-members')) return Response.json({ members: [
      { id: 'first', nickname: 'เมย์' }, { id: 'second', nickname: 'โบว์' }, { id: 'third', nickname: 'เมย์' },
    ] });
    if (path.endsWith('/participants') && method === 'POST') return fail
      ? Response.json({ message: 'บันทึกไม่สำเร็จ' }, { status: 500 }) : Response.json({ event });
  });
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: '+ เพิ่มรายชื่อ' }));
  await user.click(screen.getByRole('button', { name: 'เพิ่มรายชื่อ' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'กรุณาเลือกสมาชิกอย่างน้อยหนึ่งคน');
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
  const input = screen.getByRole('combobox', { name: 'สมาชิก' });
  await user.type(input, 'โบว์');
  expect(screen.queryByRole('option', { name: 'เมย์' })).toBeNull();
  await screen.findByRole('option', { name: 'โบว์' });
  await user.keyboard('{ArrowDown}{Enter}');
  expect(requests.filter(r => r.method === 'POST')).toHaveLength(0);
  await user.type(input, 'เมย์');
  const duplicates = await screen.findAllByRole('option', { name: 'เมย์' });
  await user.click(duplicates[0]);
  await user.type(input, 'เมย์');
  await user.click((await screen.findAllByRole('option', { name: 'เมย์' }))[1]);
  await user.click(input);
  expect(input.getAttribute('aria-expanded')).toBe('true');
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(input.getAttribute('aria-expanded')).toBe('false');
  await user.click(screen.getByRole('button', { name: 'นำออก: โบว์' }));
  expect(screen.queryByRole('button', { name: 'นำออก: โบว์' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'เพิ่มรายชื่อ' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'บันทึกไม่สำเร็จ');
  expect(screen.getAllByRole('button', { name: 'นำออก: เมย์' })).toHaveLength(2);
  expect(requests.filter(r => r.method !== 'GET').at(-1)?.data).toEqual({ memberIds: ['first', 'third'] });
  fail = false;
  await user.click(screen.getByRole('button', { name: 'เพิ่มรายชื่อ' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(requests.filter(r => r.method !== 'GET').at(-1)?.data).toEqual({ memberIds: ['first', 'third'] });
});

test('failed payment leaves the checkbox unchanged; successful response updates roster and server-calculated costs', async () => {
  const event = detail(); let fail = true;
  backend(event, ({ path, data }) => path.endsWith('/payment') ? fail ? Response.json({ message: 'จ่ายยังไม่บันทึก' }, { status: 500 }) : Response.json({ event: { ...event, participants: [{ ...guest, paid: data.paid }], totalCostSatang: 100000, sharePeople: 3, sharePerPersonSatang: 33400, roundingSurplusSatang: 200 } }) : undefined);
  const user = userEvent.setup(); render(<App />);
  const checkbox = await screen.findByRole('checkbox', { name: 'จ่ายแล้ว: ' + guest.nickname });
  await user.click(checkbox);
  await screen.findByText('จ่ายยังไม่บันทึก');
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  fail = false; await user.click(checkbox);
  await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('false'));
  expect(screen.getByText('ปัดขึ้นเป็นบาท · ส่วนเกินรวม 2 บาท')).toBeTruthy();
  expect(screen.getByText('หารผู้ได้ที่ในนัด 3 คน')).toBeTruthy();
});

test.each(['participants', 'waitlist', 'withdrawn'] as const)('members can update only their own payment in %s and retry a failed save', async roster => {
  const self = { ...owner, isGuest: false, paid: false };
  const event = detail({ isOrganizer: false, [roster]: [guest, self] });
  let fail = true;
  const requests = backend(event, ({ path, data }) => {
    if (path.endsWith('/payment')) return fail
      ? Response.json({ message: 'บันทึกของฉันไม่สำเร็จ' }, { status: 500 })
      : Response.json({ event: { ...event, [roster]: [guest, { ...self, paid: data.paid }] } });
  });
  const user = userEvent.setup(); render(<App />);
  const checkbox = await screen.findByRole('checkbox', { name: 'จ่ายแล้ว: ' + owner.nickname });
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '+ เพิ่มรายชื่อ' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'แก้ไขนัด' })).toBeNull();
  await user.click(checkbox);
  await screen.findByText('บันทึกของฉันไม่สำเร็จ');
  expect(checkbox.getAttribute('aria-checked')).toBe('false');
  fail = false; await user.click(checkbox);
  await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('true'));
  expect(requests.filter(r => r.method === 'PATCH').at(-1)).toMatchObject({ path: '/api/events/e/payment', data: { memberId: owner.id, paid: true } });
  await user.click(checkbox);
  await waitFor(() => expect(checkbox.getAttribute('aria-checked')).toBe('false'));
  expect(requests.filter(r => r.method === 'PATCH').at(-1)?.data).toEqual({ memberId: owner.id, paid: false });
});

test('members cannot edit their own payment in a cancelled event', async () => {
  backend(detail({ isOrganizer: false, cancelled: true, participants: [{ ...owner, isGuest: false, paid: true }] }));
  render(<App />); await screen.findByRole('heading', { name: 'นัดที่แชร์' });
  expect(screen.getByText('คุณ')).toBeTruthy();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('cancelled event keeps QR, costs and paid history visible while editing commands are absent', async () => {
  backend(detail({ cancelled: true, hasPaymentQr: true, totalCostSatang: 100000, confirmed: 0, sharePeople: 0 }));
  render(<App />); await screen.findByRole('heading', { name: 'นัดที่แชร์' });
  expect(screen.getByText('รอผู้เข้าร่วมเพื่อคำนวณยอดต่อคน')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'ขยาย QR จ่ายเงิน' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'ถอนชื่อแล้ว · 1 คน' })).toBeTruthy();
  for (const name of ['+ เพิ่มรายชื่อ', 'แก้ไขนัด', 'ยกเลิกนัด', 'ลงชื่อนัดนี้', 'ถอนชื่อ: ' + guest.nickname]) expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
});

test('polling pauses while a roster dialog is open and stops when navigating to the event form', async () => {
  const requests = backend(detail());
  vi.useFakeTimers();
  await act(async () => { render(<App />); });
  expect(screen.getByRole('heading', { name: 'นัดที่แชร์' })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(requests.filter(r => r.path === '/api/events/e')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'ถอนชื่อ: ' + guest.nickname }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(requests.filter(r => r.path === '/api/events/e')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'กลับไปก่อน' }));
  fireEvent.click(screen.getByRole('button', { name: 'แก้ไขนัด' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
  expect(requests.filter(r => r.path === '/api/events/e')).toHaveLength(2);
});

test('an expired session closes the dialog and returns to LINE login', async () => {
  backend(detail(), ({ path }) => {
    if (path === '/api/config') return Response.json({ ready: true, liffId: 'test-liff' });
    if (path.includes('/participants/')) return Response.json({ message: 'กรุณาเข้าใช้งานผ่าน LINE' }, { status: 401 });
  });
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: 'ถอนชื่อ: ' + guest.nickname }));
  await user.click(screen.getByRole('button', { name: 'ยืนยันถอนชื่อ' }));
  await screen.findByRole('button', { name: 'เข้าใช้งานผ่าน LINE' });
  expect(screen.queryByRole('dialog')).toBeNull();
});

test('list opens a new optional-cost event, signs up and withdraws self, cancels and logs out', async () => {
  history.replaceState(null, '', '/');
  const event = detail({ id: 'created', title: 'นัดใหม่', capacity: 12, confirmed: 0, participants: [], withdrawn: [] });
  const requests = backend(detail(), ({ path, method, data }) => {
    if (path === '/api/events' && method === 'POST') return Response.json({ event: { ...event, title: data.title } }, { status: 201 });
    if (path === '/api/events/created/signup') return Response.json({ event: method === 'POST' ? { ...event, myPosition: 1, confirmed: 1, participants: [{ ...owner, isGuest: false, paid: false }] } : event });
    if (path === '/api/events/created/cancel') return Response.json({ event: { ...event, cancelled: true } });
    if (path === '/api/logout') return Response.json({ ok: true });
  });
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: '+ เปิดนัด' }));
  await user.type(screen.getByRole('textbox', { name: 'ชื่อนัด' }), 'นัดใหม่');
  await user.type(screen.getByRole('textbox', { name: 'สนาม' }), 'สนาม');
  await user.type(screen.getByRole('textbox', { name: 'ชื่อหรือหมายเลขคอร์ต' }), '1, 2');
  await user.click(screen.getByRole('button', { name: 'สร้างนัด' }));
  await screen.findByRole('heading', { name: 'นัดใหม่' });
  expect(requests.find(r => r.method === 'POST')?.data).toMatchObject({ courtCostSatang: null, ballCostSatang: null });
  expect(requests.find(r => r.method === 'POST')?.data).not.toHaveProperty('paymentQr');
  expect(location.search).toBe('?event=created');
  await user.click(screen.getByRole('button', { name: 'ลงชื่อนัดนี้' }));
  await user.click(await screen.findByRole('button', { name: 'ถอนชื่อของฉัน' }));
  await screen.findByRole('button', { name: 'ลงชื่อนัดนี้' });
  expect(requests.filter(r => r.path.endsWith('/signup')).map(r => r.method)).toEqual(['POST', 'DELETE']);
  await user.click(screen.getByRole('button', { name: 'ยกเลิกนัด' }));
  await user.click(screen.getByRole('button', { name: 'ยืนยันยกเลิกนัด' }));
  await screen.findByText('นัดนี้ยกเลิกแล้ว รายชื่อด้านล่างเป็นประวัติของนัด');
  await user.click(screen.getByRole('button', { name: 'ออก' }));
  await screen.findByRole('heading', { name: /นัดตีครั้งหน้า/ });
  expect(screen.queryByRole('button', { name: owner.nickname })).toBeNull();
});

test('share uses LINE target picker and preserves the event link without recreating its initial deep-link request', async () => {
  backend(detail(), ({ path, method }) => {
    if (path === '/api/config') return Response.json({ ready: true, liffId: 'test-liff' });
    if (path === '/api/me' && method === 'PATCH') return Response.json({ member: owner });
  });
  window.liff = { init: vi.fn().mockResolvedValue(undefined), isLoggedIn: () => true, login: vi.fn(), getIDToken: () => 'test-token', isApiAvailable: () => true, shareTargetPicker: vi.fn().mockResolvedValue({ status: 'success' }) };
  const user = userEvent.setup(); render(<App />);
  await user.click(await screen.findByRole('button', { name: 'แชร์นัดใน LINE' }));
  await screen.findByText('แชร์นัดแล้ว');
  expect(window.liff.shareTargetPicker).toHaveBeenCalledWith([{ type: 'text', text: expect.stringContaining('https://liff.line.me/test/?invite=test-only&event=e') }]);
  await user.click(screen.getByRole('button', { name: owner.nickname }));
  await user.click(screen.getByRole('button', { name: 'บันทึกชื่อเล่น' }));
  await screen.findByRole('heading', { name: 'นัดตีของกลุ่ม' });
});

test('share falls back to clipboard, and a denied clipboard shows selectable text in a dialog', async () => {
  backend(detail());
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, 'writeText');
  render(<App />);
  await user.click(await screen.findByRole('button', { name: 'แชร์นัดใน LINE' }));
  await screen.findByText('คัดลอกข้อความแล้ว นำไปส่งในกลุ่ม LINE ได้เลย');
  expect(copy).toHaveBeenCalledWith(expect.stringContaining('&event=e'));
  copy.mockRejectedValue(new Error('denied'));
  await user.click(screen.getByRole('button', { name: 'แชร์นัดใน LINE' }));
  expect((await screen.findByLabelText('คัดลอกข้อความไปส่งใน LINE') as HTMLTextAreaElement).value).toContain('&event=e');
  await user.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'ปิด' })[0]);
});
