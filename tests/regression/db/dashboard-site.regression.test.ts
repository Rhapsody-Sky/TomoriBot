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
const client = { application: { id: "123456789012345678" }, guilds: { cache: new Map() } } as unknown as Client;
const page = {
  kind: "page" as const,
  title: "Information",
  content: "<h2>Contact</h2><p>Example organisation</p>",
  url: "",
  enabled: true,
  position: 2,
};

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
    await testSql`DELETE FROM schema_migrations WHERE name = ${migration}`;
    await initializeDatabase({ client: testSql, includeRag: false });
    expect(await marker()).toHaveLength(1);

    await new DashboardSiteRepository().save({ id: "imprint", ...page });
    await initializeDatabase({ client: testSql, includeRag: false });
    await sql.close();
    resetDatabaseConnection();
    expect(await marker()).toHaveLength(1);
    expect(await new DashboardSiteRepository().list()).toEqual([{ id: "imprint", ...page }]);
  }, 60_000);

  it("keeps existing entries when migrating and refuses a destructive rollback", async () => {
    const stored = { id: "imprint", ...page, enabled: false };
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
    expect(await new DashboardSiteRepository().list()).toEqual([]);
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
    expect(await new DashboardSiteRepository().list()).toEqual([{ id: "imprint", ...page }]);
    const edited = { ...page, content: "<p><strong>Updated content</strong></p>", title: "Updated information" };
    expect((await write(edited)).status).toBe(200);
    await sql.close();
    resetDatabaseConnection();
    const { app: reopened } = createDashboardApp(client);
    const publicPage = await reopened.request("/settings/pages/imprint");
    expect(publicPage.status).toBe(200);
    expect(await publicPage.text()).toContain(edited.content);
    const navigation = await (await reopened.request("/settings/api/site")).json();
    expect(navigation.entries.map((entry: { id: string }) => entry.id)).toEqual(["imprint"]);

    expect((await write({ ...edited, enabled: false })).status).toBe(200);
    await sql.close();
    resetDatabaseConnection();
    expect((await reopened.request("/settings/pages/imprint")).status).toBe(404);
    expect((await (await reopened.request("/settings/api/site")).json()).entries).toEqual([]);
    expect(await new DashboardSiteRepository().list()).toEqual([{ id: "imprint", ...edited, enabled: false }]);
    const admin = await (await app.request("/settings/api/site-admin/entries", { headers })).json();
    expect(admin.entries.find((entry: { id: string }) => entry.id === "imprint").content).toBe(edited.content);
    expect((await write(edited)).status).toBe(200);
    expect((await reopened.request("/settings/pages/imprint")).status).toBe(200);
  });

  it("persists external link visibility, ordering and deletion through the HTTP routes", async () => {
    const { app, headers } = authenticatedApp();
    const id = randomUUID();
    const link = { ...page, kind: "link", content: "", url: "https://example.org/support", position: 0 };
    const write = (entryId: string, payload: object) =>
      app.request(`/settings/api/site-admin/entries/${entryId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      });
    expect((await write("imprint", page)).status).toBe(200);
    expect((await write(id, link)).status).toBe(200);
    const listed = await (await app.request("/settings/api/site")).json();
    expect(listed.entries.map((entry: { id: string }) => entry.id)).toEqual([id, "imprint"]);
    expect((await write(id, { ...link, enabled: false })).status).toBe(200);
    expect(
      (await (await app.request("/settings/api/site")).json()).entries.map((entry: { id: string }) => entry.id),
    ).toEqual(["imprint"]);
    expect((await new DashboardSiteRepository().list()).find((entry) => entry.id === id)?.enabled).toBe(false);
    expect((await app.request(`/settings/api/site-admin/entries/${id}`, { method: "DELETE", headers })).status).toBe(
      200,
    );
    expect(await new DashboardSiteRepository().list()).toEqual([{ id: "imprint", ...page }]);
  });
});
