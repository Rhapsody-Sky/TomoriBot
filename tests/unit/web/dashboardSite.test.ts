import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { createHmac } from "node:crypto";
import type { Client } from "discord.js";
import { DashboardSiteRepository, type DashboardSiteEntry } from "@/utils/db/repositories/DashboardSiteRepository";
import { initializeLocalizer } from "@/utils/text/localizer";
import { DashboardSessionStore, OAUTH_STATE_COOKIE, SESSION_COOKIE } from "@/web/dashboard/auth";
import { createDashboardApp } from "@/web/dashboard/server";
import { cleanSiteHtml, DashboardSiteService } from "@/web/dashboard/siteService";

const client = { application: { id: "123456789012345678" }, guilds: { cache: new Map() } } as unknown as Client;

const page = {
  kind: "page",
  title: "Information",
  content: "<p>Sample content</p>",
  url: "",
  enabled: true,
  position: 0,
} as const;
const storedPage: DashboardSiteEntry = { id: "imprint", ...page, showOnLogin: false, showInSidebar: false };
const link = {
  kind: "link",
  title: "Support",
  content: "",
  url: "https://example.org/support",
  showOnLogin: true,
  showInSidebar: false,
  position: 0,
} as const;

describe("dashboard public pages", () => {
  beforeAll(() => initializeLocalizer());
  afterEach(() => mock.restore());

  function setup(globalAdmin = false) {
    let entries: DashboardSiteEntry[] = [];
    spyOn(DashboardSiteRepository.prototype, "list").mockImplementation(async () => entries);
    const save = spyOn(DashboardSiteRepository.prototype, "save").mockImplementation(async (entry) => {
      entries = [...entries.filter((item) => item.id !== entry.id), entry];
    });
    const remove = spyOn(DashboardSiteRepository.prototype, "deleteLink").mockImplementation(async (id) => {
      entries = entries.filter((item) => item.id !== id);
    });
    const { app, config } = createDashboardApp(client);
    const session = new DashboardSessionStore().create(
      { id: "987654321098765432", username: "Mirri" },
      "test-token",
      3600,
    );
    session.guildCache = {
      fetchedAt: Date.now(),
      guilds: [{ id: "123456789012345678", name: "Example", iconUrl: null, canManage: true, memberCount: 2 }],
    };
    config.globalAdminIds = globalAdmin ? [session.user.id] : [];
    spyOn(DashboardSessionStore.prototype, "get").mockImplementation((id) => (id === session.id ? session : null));
    const signature = createHmac("sha256", config.sessionSecret).update(session.id).digest("base64url");
    const headers = {
      Cookie: `${SESSION_COOKIE}=${session.id}.${signature}`,
      "X-CSRF-Token": session.csrfToken,
      "Content-Type": "application/json",
    };
    return {
      app,
      headers,
      save,
      remove,
      seed: (value: DashboardSiteEntry[]) => {
        entries = value;
      },
    };
  }

  it("publishes a cookie notice without sign-in and lets an administrator hide it", async () => {
    const { app, headers, save } = setup(true);
    const nav = await (await app.request("/settings/api/site")).json();
    expect(nav.entries.some((entry: DashboardSiteEntry) => entry.id === "cookies")).toBe(true);
    const response = await app.request("/settings/pages/cookies");
    expect(response.status).toBe(200);
    expect(response.headers.has("set-cookie")).toBe(false);
    const html = await response.text();
    expect(html).not.toContain("data-dashboard-entry=");
    expect(html).toContain(OAUTH_STATE_COOKIE);
    expect(html).toContain(SESSION_COOKIE);
    expect(html).toContain('href="https://discord.com/terms/cookie-policy"');
    expect(html).toContain('href="/settings/pages/cookies" aria-current="page"');
    expect(save).not.toHaveBeenCalled();
    const admin = await (await app.request("/settings/api/site-admin/entries", { headers })).json();
    const { title, content, position } = admin.entries.find((entry: DashboardSiteEntry) => entry.id === "cookies");
    expect(
      (
        await app.request("/settings/api/site-admin/entries/cookies", {
          method: "PUT",
          headers,
          body: JSON.stringify({ kind: "page", title, content, position, url: "", enabled: false }),
        })
      ).status,
    ).toBe(200);
    expect((await app.request("/settings/pages/cookies")).status).toBe(404);
    const updated = await (await app.request("/settings/api/site")).json();
    expect(updated.entries.some((entry: DashboardSiteEntry) => entry.id === "cookies")).toBe(false);
  });

  it("keeps hidden content out of public navigation and direct URLs", async () => {
    const { app, seed } = setup();
    seed([
      storedPage,
      { ...storedPage, id: "cookies", enabled: false, content: "<p>unpublished</p>" },
      { id: "9bcd3efa-4408-4389-819a-93091ae8f0ec", ...link, enabled: false, showOnLogin: false, showInSidebar: true },
    ]);
    const response = await app.request("/settings/api/site");
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.entries.map((entry: DashboardSiteEntry) => entry.id)).toEqual(["imprint"]);
    expect(payload.entries[0].content).toBeUndefined();
    expect((await app.request("/settings/pages/cookies")).status).toBe(404);
    const publicPage = await app.request("/settings/pages/imprint");
    expect(publicPage.status).toBe(200);
    expect(publicPage.headers.get("cache-control")).toBe("no-store");
    const html = await publicPage.text();
    expect(html).toContain("<p>Sample content</p>");
    expect(html).not.toContain('href="/settings/pages/cookies"');
    expect(html).not.toContain(link.url);
  });

  it("requires an installation admin and CSRF even when the user manages a server", async () => {
    const { app, headers, save, remove } = setup();
    expect((await app.request("/settings/api/site-admin/entries")).status).toBe(401);
    for (const [method, path] of [
      ["GET", "entries"],
      ["PUT", "entries/imprint"],
      ["DELETE", "entries/test"],
      ["POST", "preview"],
    ]) {
      const response = await app.request(`/settings/api/site-admin/${path}`, { method, headers });
      expect(response.status).toBe(403);
    }
    expect(save).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("publishes, edits and hides a page without losing its content", async () => {
    const { app, headers } = setup(true);
    const { id } = storedPage;
    const noCsrf = { ...headers, "X-CSRF-Token": "incorrect" };
    expect(
      (
        await app.request(`/settings/api/site-admin/entries/${id}`, {
          method: "PUT",
          headers: noCsrf,
          body: JSON.stringify(page),
        })
      ).status,
    ).toBe(403);
    const write = (enabled: boolean) =>
      app.request(`/settings/api/site-admin/entries/${id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ ...page, enabled }),
      });
    expect((await write(true)).status).toBe(200);
    expect((await app.request(`/settings/pages/${id}`)).status).toBe(200);
    expect((await write(false)).status).toBe(200);
    expect((await app.request(`/settings/pages/${id}`)).status).toBe(404);
    const admin = await (await app.request("/settings/api/site-admin/entries", { headers })).json();
    expect(admin.entries.find((entry: DashboardSiteEntry) => entry.id === id).content).toBe(page.content);
  });

  it("rejects unsafe links and empty published pages without writing", async () => {
    const { save } = setup(true);
    const service = new DashboardSiteService();
    await expect(service.save(storedPage.id, { ...page, content: "<p><br></p>" })).rejects.toMatchObject({
      status: 422,
    });
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,test",
      "https://user:secret@example.org",
      "//example.org",
    ]) {
      await expect(service.save("9bcd3efa-4408-4389-819a-93091ae8f0ec", { ...link, url })).rejects.toMatchObject({
        status: 422,
      });
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("preserves rich text while removing scripts, embeds, handlers and unsafe destinations", () => {
    const html = cleanSiteHtml(
      '<h2>Title</h2><p><strong>Bold</strong> <em>Italic</em><a href="https://example.org" onclick="alert(1)">Link</a></p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://example.org"></iframe><a href="javascript:alert(1)">bad</a><ul><li>Item</li></ul>',
    );
    expect(html).toContain("<h2>");
    expect(html).toContain("<strong>");
    expect(html).toContain("<ul><li>");
    expect(html).toContain('href="https://example.org"');
    expect(html).not.toMatch(/script|iframe|img|onclick|onerror|javascript:/);
  });

  it("creates and removes external links while keeping fixed pages", async () => {
    const { app, headers, remove } = setup(true);
    const id = "9bcd3efa-4408-4389-819a-93091ae8f0ec";
    const response = await app.request(`/settings/api/site-admin/entries/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(link),
    });
    expect(response.status).toBe(200);
    expect((await (await app.request("/settings/api/site")).json()).entries[0].url).toBe(link.url);
    expect((await app.request(`/settings/api/site-admin/entries/${id}`, { method: "DELETE", headers })).status).toBe(
      200,
    );
    const remaining = await (await app.request("/settings/api/site")).json();
    expect(remaining.entries.some((entry: DashboardSiteEntry) => entry.id === id)).toBe(false);
    expect((await app.request("/settings/api/site-admin/entries/imprint", { method: "DELETE", headers })).status).toBe(
      422,
    );
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
