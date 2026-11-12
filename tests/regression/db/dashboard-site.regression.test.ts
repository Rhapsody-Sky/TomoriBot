import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { createHmac, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Client } from "discord.js";
import { runMigrations } from "@/db/migrationRunner";
import { resetDatabaseConnection, sql } from "@/utils/db/client";
import { initializeDatabase } from "@/utils/db/initializeDatabase";
import { DashboardSiteRepository } from "@/utils/db/repositories/DashboardSiteRepository";
import { initializeLocalizer } from "@/utils/text/localizer";
import { DashboardSessionStore, SESSION_COOKIE } from "@/web/dashboard/auth";
import { createDashboardApp } from "@/web/dashboard/server";
import { DB_TESTS_AVAILABLE, executeTestSqlFile, setupTestDb, testSql } from "./setup/testDb";

const migration = "900_dashboard_site_entries";
const up = resolve(`src/db/migrations/${migration}.sql`);
const down = resolve(`src/db/migrations/${migration}.down.sql`);
const visibilityMigration = "901_dashboard_link_visibility";
const visibilityUp = resolve(`src/db/migrations/${visibilityMigration}.sql`);
const visibilityDown = resolve(`src/db/migrations/${visibilityMigration}.down.sql`);
const client = { application: { id: "123456789012345678" }, guilds: { cache: new Map() } } as unknown as Client;
const page = {
  kind: "page" as const,
  title: "Information",
  content: "<h2>Contact</h2><p>Example organisation</p>",
  url: "",
  enabled: true,
  position: 2,
};
const storedPage = { id: "imprint", ...page, showOnLogin: false, showInSidebar: false };

function authenticatedApp() {
  const { app, config } = createDashboardApp(client);
  const session = new DashboardSessionStore().create(
    { id: "987654321098765432", username: "Mirri" },
    "test-token",
    3600,
  );
  config.globalAdminIds = [session.user.id];
  spyOn(DashboardSessionStore.prototype, "get").mockImplementation((id) => (id === session.id ? session : null));
  const signature = createHmac("sha256", config.sessionSecret).update(session.id).digest("base64url");
  return {
    app,
    headers: {
      Cookie: `${SESSION_COOKIE}=${session.id}.${signature}`,
      "X-CSRF-Token": session.csrfToken,
      "Content-Type": "application/json",
    },
  };
}

describe.skipIf(!DB_TESTS_AVAILABLE)("dashboard site PostgreSQL integration", () => {
  beforeAll(async () => {
    initializeLocalizer();
    await setupTestDb();
  }, 60_000);

  afterEach(async () => {
    mock.restore();
    await executeTestSqlFile(up);
    await executeTestSqlFile(visibilityUp);
    await testSql`DELETE FROM dashboard_site_entries`;
    await runMigrations(testSql);
    await sql.close();
    resetDatabaseConnection();
  });

  it("creates the extension on fresh startup and upgrades an existing database exactly once", async () => {
    const marker = () => testSql`SELECT name FROM schema_migrations WHERE name = ${migration}`;
    expect(await marker()).toHaveLength(1);
    expect(await new DashboardSiteRepository().list()).toEqual([]);

    await sql.close();
    resetDatabaseConnection();
    await executeTestSqlFile(down);
    await testSql`DELETE FROM schema_migrations WHERE name IN (${migration}, ${visibilityMigration})`;
    await initializeDatabase({ client: testSql, includeRag: false });
    expect(await marker()).toHaveLength(1);

    await new DashboardSiteRepository().save(storedPage);
    await initializeDatabase({ client: testSql, includeRag: false });
    await sql.close();
    resetDatabaseConnection();
    expect(await marker()).toHaveLength(1);
    expect(await new DashboardSiteRepository().list()).toEqual([storedPage]);
  }, 60_000);

  it("keeps existing entries when migrating and refuses a destructive rollback", async () => {
    const stored = { ...storedPage, enabled: false };
    await new DashboardSiteRepository().save(stored);
    await testSql`DELETE FROM schema_migrations WHERE name = ${migration}`;
    await runMigrations(testSql);
    expect(await new DashboardSiteRepository().list()).toEqual([stored]);
    await expect(executeTestSqlFile(down)).rejects.toMatchObject({ errno: "P0001" });
    expect(await new DashboardSiteRepository().list()).toEqual([stored]);

    await testSql`DELETE FROM dashboard_site_entries`;
    await sql.close();
    resetDatabaseConnection();
    await executeTestSqlFile(down);
    await executeTestSqlFile(down);
    const [result] = await testSql`SELECT to_regclass('dashboard_site_entries') AS name`;
    expect(result.name).toBeNull();
    await executeTestSqlFile(up);
    await executeTestSqlFile(visibilityUp);
    expect(await new DashboardSiteRepository().list()).toEqual([]);
  });

  it("preserves both placements for existing links and refuses to discard different placements", async () => {
    await executeTestSqlFile(visibilityDown);
    await testSql`DELETE FROM schema_migrations WHERE name = ${visibilityMigration}`;
    const enabledId = randomUUID();
    const hiddenId = randomUUID();
    await testSql`
      INSERT INTO dashboard_site_entries (id, kind, title, url, enabled)
      VALUES (${enabledId}, 'link', 'Support', 'https://example.org/support', true),
             (${hiddenId}, 'link', 'Docs', 'https://example.org/docs', false)
    `;
    await runMigrations(testSql);
    const repo = new DashboardSiteRepository();
    const entries = await repo.list();
    const enabled = entries.find((entry) => entry.id === enabledId);
    expect(enabled).toMatchObject({ showOnLogin: true, showInSidebar: true });
    expect(entries.find((entry) => entry.id === hiddenId)).toMatchObject({ showOnLogin: false, showInSidebar: false });
    if (!enabled) throw new Error("Missing migrated link");
    await repo.save({ ...enabled, showOnLogin: false });
    await executeTestSqlFile(visibilityUp);
    await expect(executeTestSqlFile(visibilityDown)).rejects.toMatchObject({ errno: "P0001" });
    expect((await repo.list()).find((entry) => entry.id === enabledId)).toMatchObject({
      showOnLogin: false,
      showInSidebar: true,
    });
  });

  it("persists HTTP edits and hides public pages after reconnecting without deleting their drafts", async () => {
    const { app, headers } = authenticatedApp();
    const write = (payload: typeof page) =>
      app.request("/settings/api/site-admin/entries/imprint", {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });
    expect((await write(page)).status).toBe(200);
    expect(await new DashboardSiteRepository().list()).toEqual([storedPage]);
    const edited = { ...page, content: "<p><strong>Updated content</strong></p>", title: "Updated information" };
    expect((await write(edited)).status).toBe(200);
    await sql.close();
    resetDatabaseConnection();
    const { app: reopened } = createDashboardApp(client);
    const publicPage = await reopened.request("/settings/pages/imprint");
    expect(publicPage.status).toBe(200);
    expect(await publicPage.text()).toContain(edited.content);
    const navigation = await (await reopened.request("/settings/api/site")).json();
    expect(navigation.entries.some((entry: { id: string }) => entry.id === "imprint")).toBe(true);

    expect((await write({ ...edited, enabled: false })).status).toBe(200);
    await sql.close();
    resetDatabaseConnection();
    expect((await reopened.request("/settings/pages/imprint")).status).toBe(404);
    const afterHide = await (await reopened.request("/settings/api/site")).json();
    expect(afterHide.entries.some((entry: { id: string }) => entry.id === "imprint")).toBe(false);
    expect(await new DashboardSiteRepository().list()).toEqual([{ ...storedPage, ...edited, enabled: false }]);
    const admin = await (await app.request("/settings/api/site-admin/entries", { headers })).json();
    expect(admin.entries.find((entry: { id: string }) => entry.id === "imprint").content).toBe(edited.content);
    expect((await write(edited)).status).toBe(200);
    expect((await reopened.request("/settings/pages/imprint")).status).toBe(200);
  });

  it("persists external link visibility, ordering and deletion through the HTTP routes", async () => {
    const { app, headers } = authenticatedApp();
    const id = randomUUID();
    const link = { kind: "link", title: "Support", content: "", url: "https://example.org/support", position: 0 };
    const write = (entryId: string, payload: object) =>
      app.request(`/settings/api/site-admin/entries/${entryId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });
    expect((await write("imprint", page)).status).toBe(200);
    for (const [showOnLogin, showInSidebar] of [
      [true, true],
      [false, true],
      [true, false],
      [false, false],
    ]) {
      const visibility = { showOnLogin, showInSidebar };
      expect((await write(id, { ...link, ...visibility })).status).toBe(200);
      await sql.close();
      resetDatabaseConnection();
      const { app: reopened } = createDashboardApp(client);
      const publicSite = await (await reopened.request("/settings/api/site")).json();
      const ordered = publicSite.entries.map((entry: { id: string }) => entry.id);
      expect(ordered.includes(id)).toBe(showOnLogin);
      if (showOnLogin) expect(ordered.indexOf(id)).toBeLessThan(ordered.indexOf("imprint"));
      const publicPage = await (await reopened.request("/settings/pages/imprint")).text();
      expect(publicPage.includes(link.url)).toBe(showOnLogin);
      const signedIn = await (await reopened.request("/settings/api/site", { headers })).json();
      const signedInLink = signedIn.entries.find((entry: { id: string }) => entry.id === id);
      if (showOnLogin || showInSidebar) expect(signedInLink).toMatchObject(visibility);
      else expect(signedInLink).toBeUndefined();
      expect((await new DashboardSiteRepository().list()).find((entry) => entry.id === id)).toMatchObject(visibility);
    }
    expect((await app.request(`/settings/api/site-admin/entries/${id}`, { method: "DELETE", headers })).status).toBe(
      200,
    );
    expect(await new DashboardSiteRepository().list()).toEqual([storedPage]);
  });
});
