import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./App";
import { EventForm } from "./EventForm";
import { EventList } from "./EventList";
import { dateLabel, type EventDetail } from "./lib/api";

const owner = { id: "owner", nickname: "ผู้จัด" };
const guest = {
  id: "guest",
  nickname: "เพื่อน <ใหม่>",
  isGuest: true,
  paid: true,
};
function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: "e",
    title: "นัดที่แชร์",
    venue: "สนาม",
    date: "2026-10-10",
    start: "18:00",
    end: "20:00",
    courts: 2,
    courtNames: "1, 2",
    capacity: 1,
    cancelled: false,
    ended: false,
    organizerName: owner.nickname,
    confirmed: 1,
    waiting: 0,
    myPosition: null,
    isOrganizer: true,
    participants: [guest],
    waitlist: [],
    withdrawn: [
      { id: "withdrawn", nickname: "ถอน", isGuest: false, paid: true },
    ],
    courtCostSatang: null,
    ballCostSatang: null,
    totalCostSatang: null,
    sharePeople: 1,
    sharePerPersonSatang: null,
    roundingSurplusSatang: null,
    hasPaymentQr: false,
    ...overrides,
  };
}
type Request = { path: string; method: string; data: Record<string, unknown> };
function backend(
  event: EventDetail,
  handle?: (request: Request) => Response | Promise<Response> | undefined,
) {
  const requests: Request[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options: RequestInit = {}) => {
      const request = {
        path,
        method: options.method || "GET",
        data: options.body ? JSON.parse(String(options.body)) : {},
      };
      requests.push(request);
      const response = await handle?.(request);
      if (response) return response;
      if (path === "/api/config")
        return Response.json({ ready: false, liffId: "" });
      if (path === "/api/me") return Response.json({ member: owner });
      if (path === "/api/events") return Response.json({ events: [event] });
      if (
        /^\/api\/events\/[^/]+\/matches$/.test(path) &&
        request.method === "GET"
      )
        return Response.json({ matches: [], players: [], canRecord: false });
      if (path === "/api/events/e" && request.method === "GET")
        return Response.json({ event });
      if (path === "/api/events/e/available-members")
        return Response.json({
          members: [{ id: "registered", nickname: "สมาชิกหนึ่ง" }],
        });
      if (path === "/api/invite")
        return Response.json({
          url: "https://liff.line.me/test/?invite=test-only",
        });
      throw new Error("Unexpected route: " + request.method + " " + path);
    }),
  );
  return requests;
}
beforeEach(() => {
  history.replaceState(null, "", "/?event=e");
  delete window.liff;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  // jsdom has no image decoder; browser QA verifies the actual PNG/JPEG decode.
  Object.defineProperty(Image.prototype, "decode", {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test.each([null, 1, 2])(
  "ended events close attendance and organizer commands but retain payment and scoring (position %s)",
  async (myPosition) => {
    const event = detail({
      ended: true,
      myPosition,
      hasPaymentQr: true,
      totalCostSatang: 10000,
      sharePerPersonSatang: 10000,
    });
    const players = [
      owner,
      ...["a", "b", "c"].map((id) => ({ id, nickname: id })),
    ];
    const requests = backend(event, ({ path }) => {
      if (path.endsWith("/matches"))
        return Response.json({ matches: [], players, canRecord: true });
      if (path.endsWith("/payment"))
        return Response.json({
          event: { ...event, participants: [{ ...guest, paid: false }] },
        });
    });
    const user = userEvent.setup();
    render(<App />);
    const signup = await screen.findByRole("button", { name: "นัดจบแล้ว" });
    expect((signup as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("จบแล้ว")).toBeTruthy();
    for (const name of [
      "+ เพิ่มรายชื่อ",
      "แก้ไขนัด",
      "ยกเลิกนัด",
      "ถอนชื่อ: " + guest.nickname,
      "เพิ่มกลับ: ถอน",
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    await user.click(signup);
    expect(requests.some((r) => r.path.endsWith("/signup"))).toBe(false);
    const payment = screen.getByRole("checkbox", {
      name: "จ่ายแล้ว: " + guest.nickname,
    });
    expect((payment as HTMLButtonElement).disabled).toBe(false);
    await user.click(payment);
    await screen.findByText("บันทึกสถานะจ่ายเงินแล้ว");
    expect(
      requests.some((r) => r.path.endsWith("/payment") && r.method === "PATCH"),
    ).toBe(true);
    expect(
      (
        (await screen.findByRole("button", {
          name: "+ บันทึกผล",
        })) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.getByAltText("QR จ่ายเงินที่ผู้จัดแนบ")).toBeTruthy();
  },
);

test("ended events are kept in history and remain openable", async () => {
  const past = detail({
    id: "past",
    title: "นัดเก่า",
    ended: true,
    myPosition: 1,
  });
  const older = detail({
    id: "older",
    title: "นัดเก่ากว่า",
    date: "2026-10-08",
    ended: true,
  });
  const upcoming = detail({ title: "นัดถัดไป", date: "2026-10-16" });
  const later = detail({ id: "later", title: "นัดถัดจากนั้น", date: "2026-10-17" });
  const cancelled = detail({
    id: "cancelled",
    title: "นัดที่ยกเลิก",
    ended: true,
    cancelled: true,
  });
  backend(upcoming, ({ path }) =>
    path === "/api/events"
      ? Response.json({ events: [later, older, cancelled, past, upcoming] })
      : undefined,
  );
  const open = vi.fn();
  const user = userEvent.setup();
  render(<EventList onOpen={open} onCreate={vi.fn()} onError={vi.fn()} />);
  await screen.findByRole("heading", { name: "นัดถัดไป" });
  const upcomingSection = screen.getByRole("region", { name: "นัดที่กำลังจะมาถึง" });
  const pastSection = screen.getByRole("region", { name: "นัดที่ผ่านมา" });
  expect(within(upcomingSection).getByText("2 นัด")).toBeTruthy();
  expect(within(pastSection).getByText("2 นัด")).toBeTruthy();
  expect(
    within(upcomingSection)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent),
  ).toEqual(["นัดถัดไป", "นัดถัดจากนั้น"]);
  expect(
    within(pastSection)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent),
  ).toEqual(["นัดเก่า", "นัดเก่ากว่า"]);
  expect(screen.getByText("นัดที่ยกเลิก · 1 นัด")).toBeTruthy();
  const row = screen
    .getByRole("heading", { name: "นัดเก่า" })
    .closest("article")!;
  expect(within(row).getByText("จบแล้ว")).toBeTruthy();
  expect(within(row).queryByText("คุณลงชื่อแล้ว")).toBeNull();
  await user.click(
    within(row).getByRole("button", {
      name: `ดูประวัติ: ${past.title} · ${dateLabel(past.date)}`,
    }),
  );
  expect(open).toHaveBeenCalledWith("past");
  await user.click(
    within(upcomingSection).getByRole("button", {
      name: `ดูนัด: ${upcoming.title} · ${dateLabel(upcoming.date)}`,
    }),
  );
  expect(open).toHaveBeenCalledWith("e");
  await user.click(screen.getByText("นัดที่ยกเลิก · 1 นัด"));
  await user.click(
    screen.getByRole("button", {
      name: `ดูประวัติ: ${cancelled.title} · ${dateLabel(cancelled.date)}`,
    }),
  );
  expect(open).toHaveBeenCalledWith("cancelled");
});

test("list manual refresh announces progress, prevents duplicate requests, and updates the success time", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  let result: Promise<Response> | undefined;
  const requests = backend(detail(), ({ path }) =>
    path === "/api/events" ? result : undefined,
  );
  await act(async () => {
    render(<EventList onOpen={vi.fn()} onCreate={vi.fn()} onError={vi.fn()} />);
  });
  expect(screen.getByText("อัปเดตล่าสุด 17:00:00")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("");
  let finish!: (response: Response) => void;
  result = new Promise((resolve) => {
    finish = resolve;
  });
  const refresh = screen.getByRole("button", { name: "อัปเดตรายชื่อ" });
  fireEvent.click(refresh);
  fireEvent.click(refresh);
  expect((refresh as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("status").textContent).toBe("กำลังอัปเดตนัด…");
  expect(requests.filter((r) => r.path === "/api/events")).toHaveLength(2);
  vi.setSystemTime(new Date("2026-10-15T10:01:00Z"));
  await act(async () => {
    finish(Response.json({ events: [detail({ title: "นัดอัปเดตแล้ว" })] }));
  });
  expect(screen.getByRole("heading", { name: "นัดอัปเดตแล้ว" })).toBeTruthy();
  expect(screen.getByText("อัปเดตล่าสุด 17:01:00")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("อัปเดตนัดแล้ว");
  expect((refresh as HTMLButtonElement).disabled).toBe(false);
  result = undefined;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(screen.getByRole("status").textContent).toBe("");
  expect(screen.getByText("อัปเดตล่าสุด 17:01:15")).toBeTruthy();
});

test("list keeps stale-data guidance and the last success time after polling fails, then clears them on retry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  let fail = false;
  backend(detail(), ({ path }) =>
    path === "/api/events" && fail
      ? Response.json({ message: "โหลดไม่ได้" }, { status: 500 })
      : undefined,
  );
  const onError = vi.fn();
  await act(async () => {
    render(<EventList onOpen={vi.fn()} onCreate={vi.fn()} onError={onError} />);
  });
  fail = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(onError).toHaveBeenCalledOnce();
  expect(screen.getByRole("heading", { name: "นัดที่แชร์" })).toBeTruthy();
  expect(screen.getByText("อัปเดตล่าสุด 17:00:00")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000);
  });
  expect(screen.getByText(/ข้อมูลที่แสดงอาจไม่ใช่ล่าสุด/)).toBeTruthy();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "อัปเดตรายชื่อ" }));
  });
  expect(onError).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status").textContent).toBe(
    "อัปเดตนัดไม่สำเร็จ กรุณาลองใหม่",
  );
  expect(screen.getByText(/ข้อมูลที่แสดงอาจไม่ใช่ล่าสุด/)).toBeTruthy();
  fail = false;
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "อัปเดตรายชื่อ" }));
  });
  expect(screen.queryByText(/ข้อมูลที่แสดงอาจไม่ใช่ล่าสุด/)).toBeNull();
  expect(screen.getByText("อัปเดตล่าสุด 17:00:21")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("อัปเดตนัดแล้ว");
});

test("event sections explain empty upcoming and past lists", async () => {
  backend(detail(), ({ path }) =>
    path === "/api/events" ? Response.json({ events: [] }) : undefined,
  );
  render(<EventList onOpen={vi.fn()} onCreate={vi.fn()} onError={vi.fn()} />);
  const upcoming = await screen.findByRole("region", { name: "นัดที่กำลังจะมาถึง" });
  const past = screen.getByRole("region", { name: "นัดที่ผ่านมา" });
  expect(within(upcoming).getByText("0 นัด")).toBeTruthy();
  expect(within(upcoming).getByText("ยังไม่มีนัดที่เปิดอยู่")).toBeTruthy();
  expect(within(past).getByText("0 นัด")).toBeTruthy();
  expect(within(past).getByText("ยังไม่มีนัดที่ผ่านมา")).toBeTruthy();
  expect(screen.getByRole("button", { name: "+ เปิดนัด" })).toBeTruthy();
});

test.each([false, true])(
  "admins see their role and can manage other organizers' payments while respecting ended events (%s)",
  async (ended) => {
    const event = detail({
      isOrganizer: false,
      canManage: true,
      organizerName: "ผู้จัดนัดคนอื่น",
      ended,
    });
    backend(event, ({ path }) => {
      if (path === "/api/me")
        return Response.json({ member: { ...owner, isAdmin: true } });
      if (path.endsWith("/payment"))
        return Response.json({
          event: { ...event, participants: [{ ...guest, paid: false }] },
        });
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: event.title });
    expect(screen.getByText("แอดมิน", { exact: true })).toBeTruthy();
    expect(screen.getByText("ผู้จัดนัดคนอื่น", { exact: true })).toBeTruthy();
    for (const name of ["+ เพิ่มรายชื่อ", "แก้ไขนัด", "ยกเลิกนัด"]) {
      expect(Boolean(screen.queryByRole("button", { name }))).toBe(!ended);
    }
    await user.click(
      screen.getByRole("checkbox", { name: "จ่ายแล้ว: " + guest.nickname }),
    );
    await screen.findByText("บันทึกสถานะจ่ายเงินแล้ว");
  },
);

test("management controls use server permissions instead of trusting the admin badge", async () => {
  backend(detail({ isOrganizer: false, canManage: false }), ({ path }) =>
    path === "/api/me"
      ? Response.json({ member: { ...owner, isAdmin: true } })
      : undefined,
  );
  render(<App />);
  await screen.findByRole("heading", { name: "นัดที่แชร์" });
  expect(screen.queryByRole("button", { name: "แก้ไขนัด" })).toBeNull();
  expect(screen.queryByRole("button", { name: "+ เพิ่มรายชื่อ" })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("roster photos appear in each list, fall back on failure, and retry when the URL changes", async () => {
  const pictureUrl = "https://profile.line-scdn.net/player";
  const player = {
    id: "player",
    nickname: "ต้น",
    paid: false,
    isGuest: false,
    pictureUrl,
  };
  const event = detail({
    participants: [player, guest],
    waitlist: [{ ...player, id: "waiting" }],
    withdrawn: [{ ...player, id: "withdrawn" }],
  });
  backend(event, ({ path }) =>
    path.endsWith("/payment")
      ? Response.json({
          event: {
            ...event,
            participants: [
              { ...player, pictureUrl: pictureUrl + "-new" },
              guest,
            ],
          },
        })
      : undefined,
  );
  render(<App />);
  await screen.findByRole("heading", { name: "นัดที่แชร์" });
  const photos = document.querySelectorAll<HTMLImageElement>(
    'img[src="' + pictureUrl + '"]',
  );
  expect(photos).toHaveLength(3);
  const row = photos[0].closest("li")!;
  expect(photos[0].alt).toBe("");
  expect(photos[0].getAttribute("referrerpolicy")).toBe("no-referrer");
  fireEvent.error(photos[0]);
  expect(photos[0].hidden).toBe(true);
  expect(within(row).getByText("ต")).toBeTruthy();
  expect(
    screen.getByText(guest.nickname).closest("li")!.querySelector("img"),
  ).toBeNull();
  await userEvent.click(within(row).getByRole("checkbox"));
  await waitFor(() =>
    expect(
      document.querySelector('img[src="' + pictureUrl + '-new"]'),
    ).toBeTruthy(),
  );
  expect(
    document.querySelector<HTMLImageElement>(
      'img[src="' + pictureUrl + '-new"]',
    )!.hidden,
  ).toBe(false);
});

test("shared event is read after LIFF normalizes the URL; member names remain text and organizer actions stay hidden", async () => {
  history.replaceState(null, "", "/?liff.state=redirect");
  const calls: string[] = [];
  const event = detail({
    isOrganizer: false,
    myPosition: 1,
    hasPaymentQr: true,
  });
  backend(event, ({ path }) => {
    calls.push(path);
    if (path === "/api/config")
      return Response.json({ ready: true, liffId: "test-liff" });
    if (path === "/api/me")
      return Response.json({
        member: { id: "guest", nickname: "<img src=x onerror=alert(1)>" },
      });
  });
  window.liff = {
    async init({ liffId }) {
      expect(liffId).toBe("test-liff");
      calls.push("init");
      history.replaceState(null, "", "/?event=e&invite=test-only");
    },
    isLoggedIn: () => true,
    login: vi.fn(),
    getIDToken: () => "test-token",
    isApiAvailable: () => false,
    shareTargetPicker: vi.fn(),
  };
  render(<App />);
  await screen.findByRole("heading", { name: "นัดที่แชร์" });
  expect(calls).toEqual([
    "/api/config",
    "init",
    "/api/me",
    "/api/events/e",
    "/api/events/e/matches",
  ]);
  expect(screen.getByRole("button", { name: "ถอนชื่อของฉัน" })).toBeTruthy();
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  expect(
    screen.getByRole("checkbox", { name: "จ่ายแล้ว: " + guest.nickname }),
  ).toBeTruthy();
  expect(screen.queryByRole("button", { name: "+ เพิ่มรายชื่อ" })).toBeNull();
  expect(screen.queryByRole("button", { name: "แก้ไขนัด" })).toBeNull();
  expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
  expect(document.querySelector('img[src="x"]')).toBeNull();
  expect(location.search).toBe("?event=e");
  await userEvent.click(screen.getByRole("button", { name: "ขยาย QR จ่ายเงิน" }));
  expect(
    within(screen.getByRole("dialog"))
      .getByAltText("QR จ่ายเงินขนาดใหญ่")
      .getAttribute("src"),
  ).toBe("/api/events/e/payment-qr");
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "ขยาย QR จ่ายเงิน" }),
    ),
  );
});

test("new LINE member keeps invite and requested event through profile completion; external browser opens LINE login", async () => {
  const event = detail({ isOrganizer: false });
  let loggedIn = false;
  const requests = backend(event, ({ path, method }) => {
    if (path === "/api/config")
      return Response.json({ ready: true, liffId: "test-liff" });
    if (path === "/api/me" && method === "GET")
      return Response.json({ message: "login" }, { status: 401 });
    if (path === "/api/auth")
      return Response.json({
        member: { id: "new", nickname: null },
        suggestedNickname: "ชื่อจาก LINE",
      });
    if (path === "/api/me" && method === "PATCH")
      return Response.json({ member: { id: "new", nickname: "เพื่อนใหม่" } });
  });
  window.liff = {
    init: vi.fn(async () => {
      history.replaceState(null, "", "/?event=e&invite=test-only");
    }),
    isLoggedIn: () => loggedIn,
    login: vi.fn(() => {
      loggedIn = true;
    }),
    getIDToken: () => "test-token",
    isApiAvailable: () => false,
    shareTargetPicker: vi.fn(),
  };
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "เข้าใช้งานผ่าน LINE" }),
  );
  expect(window.liff.login).toHaveBeenCalledWith({
    redirectUri: location.href,
  });
  await userEvent.click(
    screen.getByRole("button", { name: "เข้าใช้งานผ่าน LINE" }),
  );
  const input = await screen.findByRole("textbox", { name: "ชื่อเล่น" });
  expect((input as HTMLInputElement).value).toBe("ชื่อจาก LINE");
  await userEvent.clear(input);
  await userEvent.type(input, "เพื่อนใหม่");
  await userEvent.click(screen.getByRole("button", { name: "บันทึกชื่อเล่น" }));
  await screen.findByRole("heading", { name: "นัดที่แชร์" });
  expect(requests.find((r) => r.path === "/api/auth")?.data).toEqual({
    idToken: "test-token",
    invite: "test-only",
  });
  expect(location.search).toBe("?event=e");
  expect(window.liff.init).toHaveBeenCalledTimes(1);
});

test("event form retains typed fields and the chosen QR after failure, saves satang, and then expands the saved QR", async () => {
  const event = detail();
  let fail = true;
  const requests = backend(event, ({ path, method, data }) => {
    if (path === "/api/events/e" && method === "PATCH") {
      if (fail)
        return Response.json({ message: "บันทึกไม่สำเร็จ" }, { status: 500 });
      return Response.json({
        event: {
          ...event,
          title: data.title,
          hasPaymentQr: true,
          courtCostSatang: 100050,
          totalCostSatang: 100050,
          sharePerPersonSatang: 100100,
          roundingSurplusSatang: 50,
        },
      });
    }
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "แก้ไขนัด" }));
  const title = screen.getByRole("textbox", { name: "ชื่อนัด" });
  await user.clear(title);
  await user.type(title, "นัดแก้ไข");
  await user.type(screen.getByLabelText("ค่าคอร์ตรวม (บาท)"), "1000.50");
  const costValue = (
    screen.getByLabelText("ค่าคอร์ตรวม (บาท)") as HTMLInputElement
  ).value;
  const file = new File(["png"], "qr.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("รูป QR จ่ายเงิน"), file);
  await screen.findByAltText("ตัวอย่าง QR จ่ายเงิน");
  await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
  await screen.findByRole("alert");
  expect((title as HTMLInputElement).value).toBe("นัดแก้ไข");
  expect(
    (screen.getByLabelText("รูป QR จ่ายเงิน") as HTMLInputElement).files?.[0],
  ).toBe(file);
  expect(screen.getByAltText("ตัวอย่าง QR จ่ายเงิน").getAttribute("src")).toBe(
    "data:image/png;base64,cG5n",
  );
  expect(
    (screen.getByLabelText("ค่าคอร์ตรวม (บาท)") as HTMLInputElement).value,
  ).toBe(costValue);
  fail = false;
  await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
  await screen.findByRole("heading", { name: "นัดแก้ไข" });
  expect(requests.filter((r) => r.method !== "GET").at(-1)?.data).toMatchObject(
    { courtCostSatang: 100050, ballCostSatang: null, paymentQr: "cG5n" },
  );
  expect(screen.getByText("ปัดขึ้นเป็นบาท · ส่วนเกินรวม 0.5 บาท")).toBeTruthy();
});

test("existing QR is omitted when unchanged, null when removed; optional costs permit blank and zero", async () => {
  const event = detail({ hasPaymentQr: true });
  const saved = vi.fn();
  const requests = backend(event, ({ path, method }) =>
    path === "/api/events/e" && method === "PATCH"
      ? Response.json({ event })
      : undefined,
  );
  const user = userEvent.setup();
  render(
    <EventForm
      event={event}
      onBack={vi.fn()}
      onSaved={saved}
      onError={vi.fn()}
    />,
  );
  await user.type(screen.getByLabelText("ค่าลูกเทนนิสรวม (บาท)"), "0");
  await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(requests[0].data).toMatchObject({
    courtCostSatang: null,
    ballCostSatang: 0,
  });
  expect(requests[0].data).not.toHaveProperty("paymentQr");
  await user.click(screen.getByRole("button", { name: "ลบรูป QR" }));
  expect(screen.queryByAltText("ตัวอย่าง QR จ่ายเงิน")).toBeNull();
  await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(requests[1].data.paymentQr).toBeNull();
});

test("invalid and oversized QR and negative costs never submit or replace the current preview", async () => {
  const requests = backend(detail());
  const user = userEvent.setup({ applyAccept: false });
  render(
    <EventForm
      event={detail({ hasPaymentQr: true })}
      onBack={vi.fn()}
      onSaved={vi.fn()}
      onError={vi.fn()}
    />,
  );
  await user.upload(
    screen.getByLabelText("รูป QR จ่ายเงิน"),
    new File(["bad"], "qr.svg", { type: "image/svg+xml" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "รูป QR ต้องเป็นไฟล์ PNG หรือ JPEG",
  );
  await user.upload(
    screen.getByLabelText("รูป QR จ่ายเงิน"),
    new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("รูป QR ต้องไม่เกิน 2 MB"),
  );
  expect(screen.getByAltText("ตัวอย่าง QR จ่ายเงิน").getAttribute("src")).toBe(
    "/api/events/e/payment-qr",
  );
  await user.type(screen.getByLabelText("ค่าคอร์ตรวม (บาท)"), "-1");
  await user.click(screen.getByRole("button", { name: "บันทึกการแก้ไข" }));
  expect(requests).toHaveLength(0);
});

test("organizer adds, renames, links, withdraws and restores names; failed dialog save retains actual input", async () => {
  const event = detail();
  let fail = true;
  const requests = backend(event, ({ path, method }) => {
    if (path.includes("/participants") && method !== "GET")
      return fail
        ? Response.json({ message: "บันทึกไม่สำเร็จ" }, { status: 500 })
        : Response.json({ event });
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "+ เพิ่มรายชื่อ" }));
  await user.selectOptions(screen.getByLabelText("วิธีเพิ่ม"), "name");
  await user.type(screen.getByRole("textbox", { name: "ชื่อเล่น" }), "เพื่อนใหม่");
  await user.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "บันทึกไม่สำเร็จ",
  );
  expect(
    (screen.getByRole("textbox", { name: "ชื่อเล่น" }) as HTMLInputElement).value,
  ).toBe("เพื่อนใหม่");
  fail = false;
  await user.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requests.filter((r) => r.method !== "GET").at(-1)).toMatchObject({
    path: "/api/events/e/participants",
    method: "POST",
    data: { nickname: "เพื่อนใหม่" },
  });
  await user.click(
    screen.getByRole("button", { name: "แก้ชื่อ: " + guest.nickname }),
  );
  await user.clear(screen.getByRole("textbox", { name: "ชื่อเล่น" }));
  await user.type(screen.getByRole("textbox", { name: "ชื่อเล่น" }), "ชื่อใหม่");
  await user.click(screen.getByRole("button", { name: "บันทึกชื่อ" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requests.filter((r) => r.method !== "GET").at(-1)).toMatchObject({
    method: "PATCH",
    data: { nickname: "ชื่อใหม่" },
  });
  await user.click(
    screen.getByRole("button", { name: "ผูกบัญชี: " + guest.nickname }),
  );
  await user.click(screen.getByRole("combobox", { name: "สมาชิก" }));
  await user.click(await screen.findByRole("option", { name: "สมาชิกหนึ่ง" }));
  await user.click(screen.getByRole("button", { name: "ยืนยันผูกบัญชี" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requests.filter((r) => r.method !== "GET").at(-1)).toMatchObject({
    path: "/api/events/e/participants/guest",
    method: "PATCH",
    data: { memberId: "registered" },
  });
  await user.click(
    screen.getByRole("button", { name: "ถอนชื่อ: " + guest.nickname }),
  );
  await user.click(screen.getByRole("button", { name: "ยืนยันถอนชื่อ" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requests.filter((r) => r.method !== "GET").at(-1)).toMatchObject({
    method: "DELETE",
    data: {},
  });
  await user.click(screen.getByRole("button", { name: "เพิ่มกลับ: ถอน" }));
  await waitFor(() =>
    expect(requests.filter((r) => r.method !== "GET").at(-1)).toMatchObject({
      path: "/api/events/e/participants",
      method: "POST",
      data: { memberId: "withdrawn" },
    }),
  );
});

test("member combobox searches and selects multiple accounts, removes chips and retains selections after failed batch save", async () => {
  const event = detail();
  let fail = true;
  const requests = backend(event, ({ path, method }) => {
    if (path.endsWith("/available-members"))
      return Response.json({
        members: [
          { id: "first", nickname: "เมย์" },
          { id: "second", nickname: "โบว์" },
          { id: "third", nickname: "เมย์" },
        ],
      });
    if (path.endsWith("/participants") && method === "POST")
      return fail
        ? Response.json({ message: "บันทึกไม่สำเร็จ" }, { status: 500 })
        : Response.json({ event });
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "+ เพิ่มรายชื่อ" }));
  await user.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "กรุณาเลือกสมาชิกอย่างน้อยหนึ่งคน",
  );
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  const input = screen.getByRole("combobox", { name: "สมาชิก" });
  await user.type(input, "โบว์");
  expect(screen.queryByRole("option", { name: "เมย์" })).toBeNull();
  await screen.findByRole("option", { name: "โบว์" });
  await user.keyboard("{ArrowDown}{Enter}");
  expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  await user.type(input, "เมย์");
  const duplicates = await screen.findAllByRole("option", { name: "เมย์" });
  await user.click(duplicates[0]);
  await user.type(input, "เมย์");
  await user.click((await screen.findAllByRole("option", { name: "เมย์" }))[1]);
  await user.click(input);
  expect(input.getAttribute("aria-expanded")).toBe("true");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(input.getAttribute("aria-expanded")).toBe("false");
  await user.click(screen.getByRole("button", { name: "นำออก: โบว์" }));
  expect(screen.queryByRole("button", { name: "นำออก: โบว์" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "บันทึกไม่สำเร็จ",
  );
  expect(screen.getAllByRole("button", { name: "นำออก: เมย์" })).toHaveLength(2);
  expect(requests.filter((r) => r.method !== "GET").at(-1)?.data).toEqual({
    memberIds: ["first", "third"],
  });
  fail = false;
  await user.click(screen.getByRole("button", { name: "เพิ่มรายชื่อ" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(requests.filter((r) => r.method !== "GET").at(-1)?.data).toEqual({
    memberIds: ["first", "third"],
  });
});

test("failed payment leaves the checkbox unchanged; successful response updates roster and server-calculated costs", async () => {
  const event = detail();
  let fail = true;
  backend(event, ({ path, data }) =>
    path.endsWith("/payment")
      ? fail
        ? Response.json({ message: "จ่ายยังไม่บันทึก" }, { status: 500 })
        : Response.json({
            event: {
              ...event,
              participants: [{ ...guest, paid: data.paid }],
              totalCostSatang: 100000,
              sharePeople: 3,
              sharePerPersonSatang: 33400,
              roundingSurplusSatang: 200,
            },
          })
      : undefined,
  );
  const user = userEvent.setup();
  render(<App />);
  const checkbox = await screen.findByRole("checkbox", {
    name: "จ่ายแล้ว: " + guest.nickname,
  });
  await user.click(checkbox);
  await screen.findByText("จ่ายยังไม่บันทึก");
  expect(checkbox.getAttribute("aria-checked")).toBe("true");
  fail = false;
  await user.click(checkbox);
  await waitFor(() =>
    expect(checkbox.getAttribute("aria-checked")).toBe("false"),
  );
  expect(screen.getByText("ปัดขึ้นเป็นบาท · ส่วนเกินรวม 2 บาท")).toBeTruthy();
  expect(screen.getByText("ยอดหารปัจจุบัน · ผู้ได้ที่ 3 คน")).toBeTruthy();
});

test.each(["participants", "waitlist", "withdrawn"] as const)(
  "members can update only their own payment in %s and retry a failed save",
  async (roster) => {
    const self = { ...owner, isGuest: false, paid: false };
    const event = detail({ isOrganizer: false, [roster]: [guest, self] });
    let fail = true;
    const requests = backend(event, ({ path, data }) => {
      if (path.endsWith("/payment"))
        return fail
          ? Response.json({ message: "บันทึกของฉันไม่สำเร็จ" }, { status: 500 })
          : Response.json({
              event: {
                ...event,
                [roster]: [guest, { ...self, paid: data.paid }],
              },
            });
    });
    const user = userEvent.setup();
    render(<App />);
    const checkbox = await screen.findByRole("checkbox", {
      name: "สถานะจ่ายของฉัน",
    });
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "+ เพิ่มรายชื่อ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "แก้ไขนัด" })).toBeNull();
    await user.click(checkbox);
    await screen.findByText("บันทึกของฉันไม่สำเร็จ");
    expect(checkbox.getAttribute("aria-checked")).toBe("false");
    fail = false;
    await user.click(checkbox);
    await waitFor(() =>
      expect(checkbox.getAttribute("aria-checked")).toBe("true"),
    );
    expect(
      screen
        .getByRole("checkbox", { name: "จ่ายแล้ว: " + owner.nickname })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(requests.filter((r) => r.method === "PATCH").at(-1)).toMatchObject({
      path: "/api/events/e/payment",
      data: { memberId: owner.id, paid: true },
    });
    await user.click(checkbox);
    await waitFor(() =>
      expect(checkbox.getAttribute("aria-checked")).toBe("false"),
    );
    expect(requests.filter((r) => r.method === "PATCH").at(-1)?.data).toEqual({
      memberId: owner.id,
      paid: false,
    });
  },
);

test("members cannot edit their own payment in a cancelled event", async () => {
  backend(
    detail({
      isOrganizer: false,
      cancelled: true,
      participants: [{ ...owner, isGuest: false, paid: true }],
    }),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "นัดที่แชร์" });
  expect(screen.getByText("คุณ")).toBeTruthy();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("cancelled event keeps QR, costs and paid history visible while editing commands are absent", async () => {
  backend(
    detail({
      cancelled: true,
      hasPaymentQr: true,
      totalCostSatang: 100000,
      confirmed: 0,
      sharePeople: 0,
    }),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "นัดที่แชร์" });
  expect(screen.getByText("รอผู้เข้าร่วมเพื่อคำนวณยอดต่อคน")).toBeTruthy();
  expect(screen.getByRole("button", { name: "ขยาย QR จ่ายเงิน" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "ถอนชื่อแล้ว · 1 คน" })).toBeTruthy();
  for (const name of [
    "+ เพิ่มรายชื่อ",
    "แก้ไขนัด",
    "ยกเลิกนัด",
    "ลงชื่อนัดนี้",
    "ถอนชื่อ: " + guest.nickname,
  ])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByRole("checkbox")).toBeNull();
});

test("polling pauses while a roster dialog is open and stops when navigating to the event form", async () => {
  const requests = backend(detail());
  vi.useFakeTimers();
  await act(async () => {
    render(<App />);
  });
  expect(screen.getByRole("heading", { name: "นัดที่แชร์" })).toBeTruthy();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(requests.filter((r) => r.path === "/api/events/e")).toHaveLength(2);
  fireEvent.click(
    screen.getByRole("button", { name: "ถอนชื่อ: " + guest.nickname }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(requests.filter((r) => r.path === "/api/events/e")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "กลับไปก่อน" }));
  fireEvent.click(screen.getByRole("button", { name: "แก้ไขนัด" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15000);
  });
  expect(requests.filter((r) => r.path === "/api/events/e")).toHaveLength(2);
});

test("an expired session closes the dialog and returns to LINE login", async () => {
  backend(detail(), ({ path }) => {
    if (path === "/api/config")
      return Response.json({ ready: true, liffId: "test-liff" });
    if (path.includes("/participants/"))
      return Response.json(
        { message: "กรุณาเข้าใช้งานผ่าน LINE" },
        { status: 401 },
      );
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(
    await screen.findByRole("button", { name: "ถอนชื่อ: " + guest.nickname }),
  );
  await user.click(screen.getByRole("button", { name: "ยืนยันถอนชื่อ" }));
  await screen.findByRole("button", { name: "เข้าใช้งานผ่าน LINE" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("list opens a new optional-cost event, signs up and withdraws self, cancels and logs out", async () => {
  history.replaceState(null, "", "/");
  const event = detail({
    id: "created",
    title: "นัดใหม่",
    capacity: 12,
    confirmed: 0,
    participants: [],
    withdrawn: [],
  });
  const requests = backend(detail(), ({ path, method, data }) => {
    if (path === "/api/events" && method === "POST")
      return Response.json(
        { event: { ...event, title: data.title } },
        { status: 201 },
      );
    if (path === "/api/events/created/signup")
      return Response.json({
        event:
          method === "POST"
            ? {
                ...event,
                myPosition: 1,
                confirmed: 1,
                participants: [{ ...owner, isGuest: false, paid: false }],
              }
            : event,
      });
    if (path === "/api/events/created/cancel")
      return Response.json({ event: { ...event, cancelled: true } });
    if (path === "/api/logout") return Response.json({ ok: true });
  });
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "+ เปิดนัด" }));
  await user.type(screen.getByRole("textbox", { name: "ชื่อนัด" }), "นัดใหม่");
  await user.type(screen.getByRole("textbox", { name: "สนาม" }), "สนาม");
  await user.type(
    screen.getByRole("textbox", { name: "ชื่อหรือหมายเลขคอร์ต" }),
    "1, 2",
  );
  await user.click(screen.getByRole("button", { name: "สร้างนัด" }));
  await screen.findByRole("heading", { name: "นัดใหม่" });
  expect(requests.find((r) => r.method === "POST")?.data).toMatchObject({
    courtCostSatang: null,
    ballCostSatang: null,
  });
  expect(requests.find((r) => r.method === "POST")?.data).not.toHaveProperty(
    "paymentQr",
  );
  expect(location.search).toBe("?event=created");
  await user.click(screen.getByRole("button", { name: "ลงชื่อนัดนี้" }));
  await user.click(await screen.findByRole("button", { name: "ถอนชื่อของฉัน" }));
  expect(screen.getByRole("button", { name: "กลับไปก่อน" })).toBe(
    document.activeElement,
  );
  expect(
    requests.filter((r) => r.path.endsWith("/signup")).map((r) => r.method),
  ).toEqual(["POST"]);
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "ถอนชื่อของฉัน" })).toBe(
    document.activeElement,
  );
  await user.click(screen.getByRole("button", { name: "ถอนชื่อของฉัน" }));
  await user.click(screen.getByRole("button", { name: "กลับไปก่อน" }));
  expect(
    requests.filter((r) => r.path.endsWith("/signup")).map((r) => r.method),
  ).toEqual(["POST"]);
  await user.click(screen.getByRole("button", { name: "ถอนชื่อของฉัน" }));
  await user.click(screen.getByRole("button", { name: "ยืนยันถอนชื่อ" }));
  await screen.findByRole("button", { name: "ลงชื่อนัดนี้" });
  expect(
    requests.filter((r) => r.path.endsWith("/signup")).map((r) => r.method),
  ).toEqual(["POST", "DELETE"]);
  await user.click(screen.getByRole("button", { name: "ยกเลิกนัด" }));
  await user.click(screen.getByRole("button", { name: "ยืนยันยกเลิกนัด" }));
  await screen.findByText("นัดนี้ยกเลิกแล้ว รายชื่อด้านล่างเป็นประวัติของนัด");
  await user.click(screen.getByRole("button", { name: "ออก" }));
  await screen.findByRole("heading", { name: /นัดตีครั้งหน้า/ });
  expect(screen.queryByRole("button", { name: owner.nickname })).toBeNull();
});

test.each([1, 2])(
  "self withdrawal explains position %s and preserves confirmation after failure",
  async (myPosition) => {
    const event = detail({
      myPosition,
      waiting: 1,
      waitlist: [{ ...owner, isGuest: false, paid: false }],
    });
    let attempts = 0;
    const requests = backend(event, ({ path, method }) => {
      if (path.endsWith("/signup") && method === "DELETE") {
        attempts++;
        return attempts === 1
          ? Response.json({ error: "ถอนชื่อไม่สำเร็จ ลองอีกครั้ง" }, { status: 500 })
          : Response.json({ event: { ...event, myPosition: null } });
      }
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "ถอนชื่อของฉัน" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        myPosition === 1 ? /คุณจะเสียที่ในนัดนี้/ : /คุณจะออกจากคิวสำรอง/,
      ),
    ).toBeTruthy();
    expect(
      within(dialog).getByText(/หากลงชื่อใหม่ จะเรียงต่อท้ายตามลำดับลงชื่อ/),
    ).toBeTruthy();
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "ยืนยันถอนชื่อ" }));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(
      screen.getByText(
        myPosition === 1 ? "คุณได้ที่ในนัดนี้แล้ว" : "คุณอยู่คิวสำรองลำดับ 1",
      ),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "ยืนยันถอนชื่อ" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(attempts).toBe(2);
  },
);

test.each([
  {
    roster: "participants",
    ended: false,
    cancelled: false,
    amount: null,
    text: "ยังไม่ระบุยอดต่อคน",
  },
  {
    roster: "participants",
    ended: true,
    cancelled: false,
    amount: 36000,
    text: "ยอดเมื่อจบนัด 360 บาท/คน",
  },
  {
    roster: "participants",
    ended: false,
    cancelled: true,
    amount: 36000,
    text: "สถานะจ่ายที่บันทึกไว้",
  },
  {
    roster: "waitlist",
    ended: false,
    cancelled: false,
    amount: 36000,
    text: "ไม่รวมในยอดหาร",
  },
  {
    roster: "withdrawn",
    ended: false,
    cancelled: false,
    amount: 36000,
    text: "ไม่รวมในยอดหาร",
  },
] as const)(
  "personal summary reflects $roster, ended=$ended, cancelled=$cancelled",
  async ({ roster, ended, cancelled, amount, text }) => {
    backend(
      detail({
        participants: [],
        waitlist: [],
        withdrawn: [],
        [roster]: [{ ...owner, isGuest: false, paid: true }],
        myPosition:
          roster === "participants" ? 1 : roster === "waitlist" ? 2 : null,
        ended,
        cancelled,
        sharePerPersonSatang: amount,
      }),
    );
    render(<App />);
    const summary = await screen.findByRole("region", { name: "สรุปของฉัน" });
    expect(within(summary).getByText(text)).toBeTruthy();
    expect(Boolean(within(summary).queryByRole("checkbox"))).toBe(!cancelled);
    if (cancelled) expect(within(summary).getByText("จ่ายแล้ว")).toBeTruthy();
    if (roster === "withdrawn")
      expect(screen.getByText("คุณถอนชื่อแล้ว")).toBeTruthy();
  },
);

test("share uses LINE target picker and preserves the event link without recreating its initial deep-link request", async () => {
  const participants = Array.from({ length: 24 }, (_, i) => ({
    ...guest,
    id: String(i),
    nickname: "ผู้เล่น " + (i + 1),
  }));
  const latest = detail({
    capacity: 24,
    confirmed: 24,
    participants,
    waiting: 1,
    waitlist: [{ ...guest, id: "waiting", nickname: "เพื่อนสำรอง" }],
    totalCostSatang: 240000,
    sharePeople: 24,
    sharePerPersonSatang: 10000,
    hasPaymentQr: true,
  });
  let reads = 0;
  backend(detail(), ({ path, method }) => {
    if (path === "/api/config")
      return Response.json({ ready: true, liffId: "test-liff" });
    if (path === "/api/me" && method === "PATCH")
      return Response.json({ member: owner });
    if (path === "/api/events/e" && ++reads > 1)
      return Response.json({ event: latest });
  });
  window.liff = {
    init: vi.fn().mockResolvedValue(undefined),
    isLoggedIn: () => true,
    login: vi.fn(),
    getIDToken: () => "test-token",
    isApiAvailable: () => true,
    shareTargetPicker: vi.fn().mockResolvedValue({ status: "success" }),
  };
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "แชร์นัดใน LINE" }));
  await screen.findByText("แชร์นัดแล้ว");
  expect(window.liff.shareTargetPicker).toHaveBeenCalledWith([
    {
      type: "text",
      text: expect.stringContaining(
        "https://liff.line.me/test/?invite=test-only&event=e",
      ),
    },
  ]);
  const text = vi.mocked(window.liff.shareTargetPicker).mock.calls[0][0][0]
    .text;
  expect(text).toContain("คนครบแล้ว เย้!! ได้เวลาโอนค่าตีน้าาา 🎾");
  expect(text).toContain("ผู้ได้ที่ 24/24 คน · คิวสำรอง 1 คน");
  expect(text).toContain("คนละ 100 บาท (หารผู้ได้ที่ 24 คน)");
  expect(text).toContain("ค่าใช้จ่ายรวม 2,400 บาท");
  for (let i = 1; i <= 24; i++)
    expect(text).toContain(i + ". ผู้เล่น " + i + "\n");
  expect(text).toContain("คิวสำรอง\n1. เพื่อนสำรอง");
  expect(text).toContain("เปิดนัดเพื่อดู QR และตรวจยอดล่าสุดก่อนโอน");
  expect(text).toContain("จ่ายแล้ว");
  expect(text).not.toContain("ถอน");
  await user.click(screen.getByRole("button", { name: owner.nickname }));
  await user.click(screen.getByRole("button", { name: "บันทึกชื่อเล่น" }));
  await screen.findByRole("heading", { name: "นัดตีของกลุ่ม" });
});

test.each([
  {
    overrides: {
      ended: true,
      capacity: 2,
      totalCostSatang: 20000,
      sharePerPersonSatang: 20000,
      hasPaymentQr: true,
    },
    heading: "สรุปนัดที่จบแล้ว 🎾",
    expected: "คนละ 200 บาท",
    absent: "ยอดต่อคนอาจเปลี่ยน",
  },
  {
    overrides: {
      capacity: 2,
      totalCostSatang: 20000,
      sharePerPersonSatang: 20000,
    },
    heading: "ชวนมาตีเทนนิส 🎾",
    expected: "ยอดหารปัจจุบันคนละ 200 บาท",
    absent: "ได้เวลาโอนค่าตี",
  },
  {
    overrides: {
      cancelled: true,
      totalCostSatang: 20000,
      sharePerPersonSatang: 20000,
      hasPaymentQr: true,
    },
    heading: "นัดนี้ยกเลิกแล้ว",
    expected: "ดูรายละเอียดนัด",
    absent: "คนละ ",
  },
  {
    overrides: {},
    heading: "คนครบแล้ว 🎾",
    expected: "เปิดนัด / ดูรายชื่อ / ลงชื่อ",
    absent: "ได้เวลาโอนค่าตี",
  },
  {
    overrides: { totalCostSatang: 20000, sharePerPersonSatang: 20000 },
    heading: "คนครบแล้ว เย้!! ได้เวลาโอนค่าตีน้าาา 🎾",
    expected: "ติดต่อผู้จัดเรื่องช่องทางโอน",
    absent: "ดู QR",
  },
])(
  "share reflects current status: $heading ($expected)",
  async ({ overrides, heading, expected, absent }) => {
    let reads = 0;
    backend(detail(), ({ path }) =>
      path === "/api/events/e" && ++reads > 1
        ? Response.json({ event: detail(overrides) })
        : undefined,
    );
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, "writeText");
    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "แชร์นัดใน LINE" }),
    );
    await screen.findByText("คัดลอกข้อความแล้ว นำไปส่งในกลุ่ม LINE ได้เลย");
    const text = copy.mock.calls[0][0];
    expect(text.startsWith(heading + "\n")).toBe(true);
    expect(text).toContain(expected);
    expect(text).not.toContain(absent);
  },
);

test("share keeps payment details and the event link when the roster exceeds LINE text limits", async () => {
  const participants = Array.from({ length: 200 }, (_, i) => ({
    ...guest,
    id: String(i),
    nickname: "🎾".repeat(20),
  }));
  backend(
    detail({
      capacity: 200,
      confirmed: 200,
      participants,
      totalCostSatang: 200000,
      sharePeople: 200,
      sharePerPersonSatang: 1000,
      hasPaymentQr: true,
    }),
  );
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText");
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "แชร์นัดใน LINE" }));
  await screen.findByText("คัดลอกข้อความแล้ว นำไปส่งในกลุ่ม LINE ได้เลย");
  const text = copy.mock.calls[0][0];
  expect(text.length).toBeLessThanOrEqual(5000);
  expect(text).toContain("ดูรายชื่อทั้งหมดและคิวสำรองในนัด");
  expect(text).toContain("คนละ 10 บาท");
  expect(text).toContain("ดู QR");
  expect(
    text.endsWith("https://liff.line.me/test/?invite=test-only&event=e"),
  ).toBe(true);
});

test("share does not send stale payment details if refreshing the event fails", async () => {
  let reads = 0;
  backend(detail(), ({ path }) =>
    path === "/api/events/e" && ++reads > 1
      ? Response.json({ message: "อ่านนัดไม่สำเร็จ" }, { status: 500 })
      : undefined,
  );
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText");
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "แชร์นัดใน LINE" }));
  await screen.findByText("อ่านนัดไม่สำเร็จ");
  expect(copy).not.toHaveBeenCalled();
});

test("share falls back to clipboard, and a denied clipboard shows selectable text in a dialog", async () => {
  backend(detail());
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText");
  render(<App />);
  await user.click(await screen.findByRole("button", { name: "แชร์นัดใน LINE" }));
  await screen.findByText("คัดลอกข้อความแล้ว นำไปส่งในกลุ่ม LINE ได้เลย");
  expect(copy).toHaveBeenCalledWith(expect.stringContaining("&event=e"));
  copy.mockRejectedValue(new Error("denied"));
  await user.click(screen.getByRole("button", { name: "แชร์นัดใน LINE" }));
  expect(
    (
      (await screen.findByLabelText(
        "คัดลอกข้อความไปส่งใน LINE",
      )) as HTMLTextAreaElement
    ).value,
  ).toContain("&event=e");
  await user.click(
    within(screen.getByRole("dialog")).getAllByRole("button", {
      name: "ปิด",
    })[0],
  );
});
