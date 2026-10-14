import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { test } from "node:test";

test("admins use permanent authenticated member IDs and manage other events without bypassing ended-event rules", async (t) => {
  const origin = "https://admin.example";
  let now = Date.parse("2026-10-14T19:00:00+07:00");
  t.mock.method(Date, "now", () => now);
  Object.assign(process.env, {
    SKS_ORIGIN: origin,
    SKS_DATABASE_PATH: join(
      mkdtempSync(join(tmpdir(), "sks-admin-")),
      "club.sqlite",
    ),
    SKS_ADMIN_MEMBER_IDS: " admin, guest, ,admin ",
    LINE_LOGIN_CHANNEL_ID: "123",
    LINE_LIFF_ID: "123-test",
    SKS_INVITE_CODE: "test-invite-" + "a".repeat(24),
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.line.me/oauth2/v2.1/verify");
    return Response.json({
      iss: "https://access.line.me",
      aud: "123",
      sub: "line-" + options.body.get("id_token"),
      exp: Math.floor(now / 1000) + 3600,
    });
  });
  const { handleRequest } = await import("../server.mjs");
  const db = new DatabaseSync(process.env.SKS_DATABASE_PATH);
  t.after(() => db.close());
  const cookies = {};
  for (const id of ["owner", "admin", "member", "other", "guest"]) {
    db.prepare("INSERT INTO members(id,line_id,nickname) VALUES (?,?,?)").run(
      id,
      id === "guest" ? null : "line-" + id,
      id === "admin" || id === "member" ? "T𝓞𝐄𝐘" : id,
    );
    const token = createHash("sha256").update(id).digest("base64url");
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      createHash("sha256").update(token).digest("hex"),
      id,
      now + 86400000,
    );
    cookies[id] = "sks_session=" + token;
  }
  async function request(
    method,
    path,
    who = "admin",
    data,
    handler = handleRequest,
  ) {
    const req = Readable.from(
      data === undefined ? [] : [Buffer.from(JSON.stringify(data))],
    );
    Object.assign(req, {
      method,
      url: path,
      headers: {
        origin,
        cookie: cookies[who] || "",
        "content-type": "application/json",
      },
      socket: { remoteAddress: "127.0.0.1" },
    });
    const result = { headers: {} };
    await handler(req, {
      setHeader(key, value) {
        result.headers[key.toLowerCase()] = value;
      },
      writeHead(status, headers = {}) {
        result.status = status;
        Object.assign(result.headers, headers);
      },
      end(value) {
        result.data = JSON.parse(value);
      },
    });
    return result;
  }
  assert.equal((await request("GET", "/api/me")).data.member.isAdmin, true);
  assert.equal(
    (await request("GET", "/api/me", "member")).data.member.isAdmin,
    false,
  );
  assert.equal((await request("GET", "/api/me", "guest")).status, 401);
  assert.equal((await request("GET", "/api/me", "")).status, 401);
  assert.equal(
    (
      await request("POST", "/api/auth", "", {
        idToken: "member",
        memberId: "admin",
        isAdmin: true,
      })
    ).data.member.isAdmin,
    false,
  );
  assert.equal(
    (await request("POST", "/api/auth", "", { idToken: "admin" })).data.member
      .isAdmin,
    true,
  );
  assert.equal(
    (
      await request("PATCH", "/api/me", "member", {
        nickname: "T𝓞𝐄𝐘",
        isAdmin: true,
      })
    ).data.member.isAdmin,
    false,
  );
  assert.equal(
    (await request("PATCH", "/api/me", "admin", { nickname: "เปลี่ยนชื่อแล้ว" }))
      .data.member.isAdmin,
    true,
  );
  const fields = {
    title: "นัดของคนอื่น",
    venue: "สนาม",
    date: "2026-10-14",
    start: "18:00",
    end: "20:00",
    courts: 1,
    courtNames: "1",
    capacity: 4,
  };
  const created = await request("POST", "/api/events", "owner", fields);
  assert.equal(created.status, 201);
  const path = "/api/events/" + created.data.event.id;
  const adminView = (await request("GET", path)).data.event;
  assert.equal(adminView.isOrganizer, false);
  assert.equal(adminView.canManage, true);
  assert.equal(adminView.organizerId, "owner");
  assert.equal(
    (await request("GET", path, "member")).data.event.canManage,
    false,
  );
  assert.equal(
    (await request("GET", "/api/events")).data.events[0].canManage,
    true,
  );
  assert.equal(
    (
      await request("PATCH", path, "member", {
        ...fields,
        isAdmin: true,
        canManage: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("PATCH", path, "admin", { ...fields, title: "แอดมินแก้" }))
      .status,
    200,
  );
  assert.equal((await request("GET", path)).data.event.organizerId, "owner");
  assert.equal((await request("GET", path + "/available-members")).status, 200);
  assert.equal(
    (await request("GET", path + "/available-members", "member")).status,
    403,
  );
  assert.equal(
    (
      await request("POST", path + "/participants", "admin", {
        memberIds: ["owner", "admin", "member", "other"],
      })
    ).status,
    200,
  );
  assert.equal(
    (await request("DELETE", path + "/participants/other")).status,
    200,
  );
  assert.equal(
    (
      await request("POST", path + "/participants", "admin", {
        memberId: "other",
      })
    ).status,
    200,
  );
  const guest = (
    await request("POST", path + "/participants", "admin", { nickname: "แขก" })
  ).data.event.waitlist[0];
  assert.equal(
    (
      await request("PATCH", path + "/participants/" + guest.id, "admin", {
        nickname: "แก้ชื่อแขก",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("PATCH", path + "/participants/" + guest.id, "admin", {
        memberId: "member",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("PATCH", path + "/payment", "other", {
        memberId: "member",
        paid: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("PATCH", path + "/payment", "admin", {
        memberId: "member",
        paid: true,
      })
    ).status,
    200,
  );
  const score = {
    teamA: ["owner", "member"],
    teamB: ["admin", "other"],
    scoreA: 4,
    scoreB: 2,
    requestId: "admin_test_score_1234",
  };
  const match = (await request("POST", path + "/matches", "owner", score)).data
    .matches[0];
  assert.equal(
    (await request("GET", path + "/matches")).data.matches[0].canEdit,
    true,
  );
  assert.equal(
    (
      await request("PATCH", path + "/matches/" + match.id, "other", {
        ...score,
        version: 1,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("PATCH", path + "/matches/" + match.id, "admin", {
        ...score,
        scoreA: 3,
        scoreB: 3,
        version: 1,
      })
    ).status,
    200,
  );
  now = Date.parse("2026-10-14T20:00:00+07:00");
  for (const [method, suffix, data] of [
    ["PATCH", "", fields],
    ["POST", "/cancel", {}],
    ["POST", "/participants", { nickname: "สายไป" }],
    ["DELETE", "/participants/member", {}],
    ["POST", "/signup", {}],
  ]) {
    assert.equal(
      (await request(method, path + suffix, "admin", data)).status,
      409,
    );
  }
  assert.equal(
    (
      await request("PATCH", path + "/payment", "admin", {
        memberId: "member",
        paid: false,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await request("DELETE", path + "/matches/" + match.id, "admin", {
        version: 2,
      })
    ).status,
    200,
  );
  const next = await request("POST", "/api/events", "owner", {
    ...fields,
    date: "2026-10-15",
  });
  assert.equal(
    (
      await request(
        "POST",
        "/api/events/" + next.data.event.id + "/cancel",
        "admin",
        {},
      )
    ).status,
    200,
  );
  // Removing the server allowlist revokes rights even for an existing session.
  process.env.SKS_ADMIN_MEMBER_IDS = "";
  const revoked = await import("../server.mjs?admin-revoked");
  assert.equal(
    (await request("GET", "/api/me", "admin", undefined, revoked.handleRequest))
      .data.member.isAdmin,
    false,
  );
  assert.equal(
    (
      await request(
        "PATCH",
        "/api/events/" + next.data.event.id,
        "admin",
        fields,
        revoked.handleRequest,
      )
    ).status,
    403,
  );
});
