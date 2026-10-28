import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { createHmac } from "node:crypto";
import type { Client } from "discord.js";
import { createDashboardApp } from "@/web/dashboard/server";
import { TomoriDashboardCore } from "@/web/dashboard/core";
import { DashboardSessionStore, SESSION_COOKIE } from "@/web/dashboard/auth";
import { configSpriteOperations } from "@/utils/discord/interactions/configSpriteOperations";
import { personaSpriteRepository } from "@/utils/db/repositories";
import { initializeLocalizer, localizer } from "@/utils/text/localizer";
import { SPRITE_UPLOAD_MAX_BYTES } from "@/web/dashboard/spriteService";
import { createPersona, createServerConfig, createUserRow } from "../../helpers/fixtures";

const guildId = "123456789012345678";
const base = `/settings/api/guilds/${guildId}/personas/9/sprites`;
const client = {
  application: { id: guildId },
  user: { id: guildId },
  guilds: { cache: new Map() },
} as unknown as Client;

describe("dashboard sprites", () => {
  beforeAll(() => initializeLocalizer());
  afterEach(() => mock.restore());

  function setup(canManage = true) {
    const { app, config } = createDashboardApp(client);
    const session = new DashboardSessionStore().create({ id: "987654321098765432", username: "Mirri" }, "test", 3600);
    session.guildCache = {
      fetchedAt: Date.now(),
      guilds: [{ id: guildId, name: "Test", iconUrl: null, memberCount: 5, canManage }],
    };
    spyOn(DashboardSessionStore.prototype, "get").mockReturnValue(session);
    spyOn(TomoriDashboardCore.prototype, "ensureUser").mockResolvedValue(
      createUserRow({ user_id: 7, user_disc_id: session.user.id }),
    );
    const persona = createPersona({ persona_id: 9, server_id: 42, is_pointer: true });
    spyOn(TomoriDashboardCore.prototype, "loadGuildSnapshot").mockResolvedValue({
      serverId: 42,
      serverDiscordId: guildId,
      config: createServerConfig(),
      rawPersonas: [persona],
      personas: [],
    });
    const signature = createHmac("sha256", config.sessionSecret).update(session.id).digest("base64url");
    const headers = { Cookie: `${SESSION_COOKIE}=${session.id}.${signature}`, "X-CSRF-Token": session.csrfToken };
    return { app, session, headers, persona };
  }

  function form() {
    const body = new FormData();
    body.set("name", "Happy");
    body.set("instructions", "Use when celebrating.");
    body.set("identity", "true");
    body.set("file", new File(["png-fixture"], "happy.png", { type: "image/png" }));
    return body;
  }

  it("requires authentication and server management for every sprite route", async () => {
    const { app } = createDashboardApp(client);
    for (const suffix of ["", "/image?key=happy", "/export"])
      expect((await app.request(base + suffix)).status).toBe(401);
    const member = setup(false);
    for (const [method, suffix] of [
      ["GET", ""],
      ["GET", "/image?key=happy"],
      ["GET", "/export"],
      ["POST", ""],
      ["PUT", "?key=happy"],
      ["DELETE", "?key=happy"],
      ["POST", "/import"],
    ]) {
      expect((await member.app.request(base + suffix, { method, headers: member.headers })).status).toBe(403);
    }
  });

  it("rejects CSRF failures, foreign personas and oversized bodies before mutation", async () => {
    const { app, headers } = setup();
    const write = spyOn(configSpriteOperations, "addSprite");
    expect(
      (await app.request(base, { method: "POST", headers: { Cookie: headers.Cookie }, body: form() })).status,
    ).toBe(403);
    expect((await app.request(base.replace("/9/", "/99/"), { headers })).status).toBe(404);
    expect(
      (
        await app.request(base, {
          method: "POST",
          headers: { ...headers, "Content-Length": String(SPRITE_UPLOAD_MAX_BYTES + 100000) },
          body: "x",
        })
      ).status,
    ).toBe(413);
    expect(write).not.toHaveBeenCalled();
  });

  it("passes browser uploads and persona ownership to the shared Discord operations", async () => {
    const { app, headers, persona } = setup();
    const add = spyOn(configSpriteOperations, "addSprite").mockResolvedValue({
      status: "success",
      spriteName: "Happy",
      replaced: false,
    });
    const response = await app.request(base, { method: "POST", headers, body: form() });
    expect(response.status).toBe(200);
    expect((await response.json()).message).toBe(localizer("en-US", "general.dashboard.sprite_saved"));
    expect(add).toHaveBeenCalledTimes(1);
    const input = add.mock.calls[0][0];
    expect(input.persona).toBe(persona);
    expect(input.serverDiscId).toBe(guildId);
    expect(input.isIdentity).toBe(true);
    expect(input.attachment).toBeInstanceOf(File);
    expect(await (input.attachment as File).text()).toBe("png-fixture");
  });

  it("edits by stable sprite key without requiring a replacement image", async () => {
    const { app, headers } = setup();
    const edit = spyOn(configSpriteOperations, "editSprite").mockResolvedValue({ status: "no-changes" });
    const body = form();
    body.delete("file");
    expect((await app.request(`${base}?key=happy`, { method: "PUT", headers, body })).status).toBe(200);
    expect(edit.mock.calls[0][0]).toMatchObject({ currentSpriteKey: "happy", attachment: null });
  });

  it("rejects URL uploads, duplicate fields and invalid identity values", async () => {
    const { app, headers } = setup();
    const add = spyOn(configSpriteOperations, "addSprite");
    for (const mutate of [
      (body: FormData) => body.set("file", "http://localhost/private.png"),
      (body: FormData) => body.append("name", "Other"),
      (body: FormData) => body.set("identity", "yes"),
    ]) {
      const body = form();
      mutate(body);
      expect((await app.request(base, { method: "POST", headers, body })).status).toBe(422);
    }
    expect(add).not.toHaveBeenCalled();
  });

  it("maps shared validation and quota errors without reporting success", async () => {
    const { app, headers } = setup();
    const add = spyOn(configSpriteOperations, "addSprite").mockResolvedValue({
      status: "invalid-name",
      reason: "invalid_chars",
    });
    expect((await app.request(base, { method: "POST", headers, body: form() })).status).toBe(422);
    add.mockResolvedValue({ status: "quota-exceeded", resetAt: null });
    expect((await app.request(base, { method: "POST", headers, body: form() })).status).toBe(429);
  });

  it("does not materialize or delete when the sprite is absent", async () => {
    const { app, headers } = setup();
    spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([]);
    const remove = spyOn(configSpriteOperations, "removeSprite");
    expect((await app.request(`${base}?key=missing`, { method: "DELETE", headers })).status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
    const response = await app.request(base, { headers });
    expect(await response.json()).toMatchObject({ inherited: true, sprites: [] });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("imports ZIPs with the actor's quota and reports partial results", async () => {
    const { app, headers, session } = setup();
    const load = spyOn(configSpriteOperations, "importSprites").mockResolvedValue({
      status: "success",
      created: 2,
      replaced: 1,
      failed: 1,
    });
    const body = new FormData();
    body.set("file", new File(["zip-fixture"], "sprites.zip", { type: "application/zip" }));
    const response = await app.request(`${base}/import`, { method: "POST", headers, body });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ created: 2, replaced: 1, failed: 1 });
    expect(load.mock.calls[0][0].quotaKey).toBe(session.user.id);
  });

  it("uses scoped image proxies and shared deletion without exposing stored paths", async () => {
    const { app, headers } = setup();
    spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([
      {
        sprite_id: 1,
        persona_id: 9,
        sprite_name: "Happy",
        sprite_key: "happy",
        avatar_url: "data/avatars/servers/private/sprites/happy.png",
        usage_instructions: "Celebrate",
        is_identity: false,
      },
    ]);
    const response = await app.request(base, { headers });
    const data = await response.json();
    expect(data.sprites[0].imageUrl).toBe(`${base}/image?key=happy`);
    expect(JSON.stringify(data)).not.toContain("data/avatars");
    expect((await app.request(`${base}/image?key=missing`, { headers })).status).toBe(404);
    const remove = spyOn(configSpriteOperations, "removeSprite").mockResolvedValue({
      status: "success",
      spriteName: "Happy",
    });
    expect((await app.request(`${base}?key=happy`, { method: "DELETE", headers })).status).toBe(200);
    expect(remove.mock.calls[0][0]).toMatchObject({ serverDiscId: guildId, spriteKey: "happy" });
  });

  it("exports the shared archive with skipped-image metadata", async () => {
    const { app, headers } = setup();
    spyOn(configSpriteOperations, "exportSprites").mockResolvedValue({
      status: "success",
      buffer: Buffer.from("zip-fixture"),
      filename: "mirri-sprites.zip",
      spriteCount: 2,
      skippedCount: 1,
    });
    const response = await app.request(`${base}/export`, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("x-sprite-skipped")).toBe("1");
    expect(await response.text()).toBe("zip-fixture");
  });
});
