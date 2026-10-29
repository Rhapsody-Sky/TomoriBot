import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { createHmac } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Client } from "discord.js";
import { createDashboardApp } from "@/web/dashboard/server";
import { TomoriDashboardCore } from "@/web/dashboard/core";
import { DashboardSessionStore, SESSION_COOKIE } from "@/web/dashboard/auth";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createServerConfig, createUserRow } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";
import type { DashboardServerStats } from "@/web/dashboard/core";
import { type PersonalMemoryRow, PrivacyLevel } from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";

const fakeClient = {
  application: { id: "123456789012345678" },
  user: { id: "123456789012345678" },
  guilds: { cache: new Map() },
} as unknown as Client;

describe("dashboard HTTP shell", () => {
  const { app } = createDashboardApp(fakeClient);

  it("serves the branded HTML shell with security headers", async () => {
    const response = await app.request("http://localhost/settings");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(html).toContain("TomoriBot Control Room");
    expect(html).toContain("/settings/assets/tomori_companion_logo.svg");
    expect(html).toContain("/settings/assets/companion.css");
    expect(html).toContain("/settings/assets/app.js");
  });

  it("serves every dashboard asset from the source tree", async () => {
    for (const [asset, contentType] of [
      ["app.css", "text/css"],
      ["companion.css", "text/css"],
      ["app.js", "application/javascript"],
      ["navigation-icons.svg", "image/svg+xml"],
      ["tomoribot_logo.png", "image/png"],
      ["tomori_companion_logo.svg", "image/svg+xml"],
      ["tomori_texture5.png", "image/png"],
      ["noto-sans-jp.ttf", "font/ttf"],
      ["noto-sans-jp-bold.ttf", "font/ttf"],
    ]) {
      const response = await app.request(`http://localhost/settings/assets/${asset}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain(contentType);
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(100);
    }
  });

  it("revalidates the navigation sprite so added icons do not remain missing after an update", async () => {
    for (const suffix of ["", "?v=2"]) {
      const response = await app.request(`/settings/assets/navigation-icons.svg${suffix}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-cache");
      expect(await response.text()).toContain('id="refresh-cw"');
    }
  });

  it("ships the persona workspace and checkbox-based multi selections", async () => {
    const response = await app.request("/settings/assets/app.js");
    const source = await response.text();
    const css = await (await app.request("/settings/assets/app.css")).text();
    const companionCss = await (await app.request("/settings/assets/companion.css")).text();

    expect(source).toContain('data-persona-panel="personal"');
    expect(source).toContain('data-persona-panel="server"');
    expect(source).toContain('data-persona-panel="appearance"');
    expect(source).toContain("Appearance &amp; image prompt");
    expect(source).toContain("Visual character prompt");
    expect(source).toContain("This is not the persona's main conversation prompt");
    expect(source).toContain("data-auto-grow");
    expect(source).toContain("resizeAutoGrowTextarea");
    expect(source).not.toContain("Core identity, behavior, speaking style, and boundaries");
    expect(source).toContain("data-persona-create-open");
    expect(source).toContain("data-persona-import-open");
    expect(source).toContain("data-persona-attributes");
    expect(source).toContain('id="persona-test-chat-form"');
    expect(source).toContain("event.ctrlKey");
    expect(source).toContain("input.form?.requestSubmit()");
    expect(css).toContain(".test-chat-compose .button");
    expect(css).toContain("justify-self: end");
    expect(css).toContain(".persona-test-panel {\n  position: sticky;\n  top: 0;");
    expect(css).toContain("height: calc(100dvh - 94px)");
    expect(css).toContain(".test-chat-messages");
    expect(css).toContain(".test-chat-assistant");
    expect(css).toContain("background: var(--primary-soft)");
    expect(css).toContain(".test-chat-compose textarea");
    expect(css).toContain("field-sizing: content");
    expect(css).toContain(".persona-appearance-grid");
    expect(css).toContain(".avatar-editor-showcase .persona-appearance-avatar");
    expect(css).toContain("height: clamp(180px, 20vw, 260px)");
    expect(css).toContain(".memory-item:hover");
    expect(css).toContain("background: var(--surface-raised)");
    expect(css).toContain("background: var(--surface-solid)");
    expect(companionCss).toContain(".switch-row input:checked + i::after");
    expect(companionCss).toContain("transform: translateX(21px)");
    expect(source).toContain('class="switch-row"><span><strong>');
    expect(source).toContain('role="switch"');
    expect(source).toContain('"notice-switches"');
    expect(companionCss).toContain(".nav-stack {\n  gap: 3px;\n  overflow-x: hidden;\n  overflow-y: auto;");
    expect(source).toContain("data-avatar-fallback");
    expect(source).toContain("'s memories about you");
    expect(source).toContain("Private facts about you that are only available to this persona when you are around.");
    expect(source).toContain("data-palette-choice");
    expect(source).toContain("data-theme-toggle");
    expect(source).toContain("function renderBootScreen()");
    expect(source).not.toContain("/settings/assets/tomoribot_logo.png");
    expect(source).toContain("const loginMessages = [");
    expect(source).toContain("Math.floor(Math.random() * loginMessages.length)");
    expect(source).toContain("motherfucker");
    expect(source).not.toContain("Your Tomori, in one quiet place.");
    expect(source).toContain("syncAppearanceControls()");
    expect(source).toContain("updateServerStatsSection()");
    expect(source).toContain(`aria-busy="\${state.serverStatsLoading}"`);
    expect(source).toContain("fieldLabel(field.label, field.hint)");
    expect(source).toContain("field-hint");
    expect(source).toContain('class="check-option"');
    expect(source).toContain('label: "Models & sampling"');
    expect(source).toContain('title: "Context"');
    expect(source).toContain('title: "Triggers & cooldowns"');
    expect(source).toContain('title: "Output"');
    expect(source).toContain('fields: ["match_limit", "cascade_limit"]');
    expect(source).toContain("data-settings-sections");
    expect(source).not.toContain("settings-category-heading");
    expect(source).toContain('id="server-models-form"');
    expect(source).toContain("already_available");
    expect(source).not.toContain("selectedOptions");
    expect(source).not.toContain(" multiple ");
    expect(source).toContain("data-server-picker-open");
    expect(source).toContain('id="server-picker-dialog"');
    expect(source).toContain("data-guild-select");
    expect(source).not.toContain('id="guild-switcher"');
    expect(source).toContain("data-stats-timeframe");
    expect(source).toContain("/stats?timeframe=");
    expect(css).toContain(".server-picker-grid");
    expect(css).toContain("@keyframes server-choice-enter");
    expect(css).toContain(".stats-summary-grid");
  });

  it("rejects unauthenticated API access", async () => {
    const response = await app.request("http://localhost/settings/api/session");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "auth_required",
        message: "Sign in required.",
      },
    });
  });

  it("protects the server statistics endpoint", async () => {
    const response = await app.request("http://localhost/settings/api/guilds/123456789012345678/stats?timeframe=week");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "auth_required",
        message: "Sign in required.",
      },
    });
  });

  it("fills daily gaps and groups long periods without losing tokens or the highest-usage day", async () => {
    const source = await Bun.file("src/web/dashboard/assets/app.js").text();
    const ast = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let declaration = "";
    const walk = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "buildUsageHistory") declaration = node.getText(ast);
      ts.forEachChild(node, walk);
    };
    walk(ast);
    type Day = { date: string; inputTokens: number; outputTokens: number };
    const build = runInNewContext(`${declaration}\nbuildUsageHistory`) as (
      history: NonNullable<DashboardServerStats["history"]>,
    ) => {
      monthly: boolean;
      points: Array<Day & { through: string }>;
      peakDay: Day | null;
    };
    const days = [
      { date: "2024-02-28", inputTokens: 10, outputTokens: 2 },
      { date: "2024-03-01", inputTokens: 30, outputTokens: 4 },
    ];
    const daily = build({ from: "2024-02-28", through: "2024-03-01", days, models: null });
    expect(daily.monthly).toBe(false);
    expect(daily.points.map((point) => [point.date, point.inputTokens + point.outputTokens])).toEqual([
      ["2024-02-28", 12],
      ["2024-02-29", 0],
      ["2024-03-01", 34],
    ]);
    expect(daily.peakDay).toEqual(days[1]);
    const monthly = build({ from: "2023-12-30", through: "2024-03-01", days, models: null });
    expect(monthly.monthly).toBe(true);
    expect(monthly.points.map((point) => [point.date, point.through, point.inputTokens + point.outputTokens])).toEqual([
      ["2023-12-30", "2023-12-31", 0],
      ["2024-01-01", "2024-01-31", 0],
      ["2024-02-01", "2024-02-29", 12],
      ["2024-03-01", "2024-03-01", 34],
    ]);
    expect(monthly.peakDay).toEqual(days[1]);
    expect(build({ from: "2024-03-01", through: "2024-03-01", days: [], models: null }).points).toEqual([
      { date: "2024-03-01", through: "2024-03-01", inputTokens: 0, outputTokens: 0 },
    ]);
  });

  it("keeps model token totals separate from server totals and accounts for models beyond the top five", async () => {
    await initializeLocalizer();
    const source = await Bun.file("src/web/dashboard/assets/app.js").text();
    const ast = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const declarations: string[] = [];
    const walk = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "renderModelUsage")
        declarations.push(node.getText(ast));
      if (ts.isVariableDeclaration(node) && ["escapeHtml", "formatUsd"].includes(node.name.getText(ast))) {
        declarations.push(`const ${node.getText(ast)};`);
      }
      ts.forEachChild(node, walk);
    };
    walk(ast);
    const render = runInNewContext(`${declarations.join("\n")}\nrenderModelUsage`, {
      Intl,
      ui: (key: string) => localizedCopy("en-US", `general.dashboard.interface_${key}`),
    }) as (stats: DashboardServerStats) => string;
    const stats: DashboardServerStats = {
      timeframe: "all_time",
      history: null,
      totals: {
        messages: 10,
        commands: 2,
        inputTokens: 1000,
        outputTokens: 100,
        estimatedCost: 0.1,
        textGenerations: 12,
        imageGenerations: 0,
        videoGenerations: 0,
      },
      models: [
        { name: "sample/model-a", inputTokens: 200, outputTokens: 20, cost: 0.02 },
        { name: "sample/model-b", inputTokens: 150, outputTokens: 15, cost: 0.015 },
        { name: "sample/model-c", inputTokens: 140, outputTokens: 14, cost: 0.014 },
        { name: "sample/model-d", inputTokens: 110, outputTokens: 11, cost: 0.011 },
        { name: "sample/model-e", inputTokens: 100, outputTokens: 10, cost: 0.01 },
      ],
      personas: [],
      tools: [],
      topCommands: [],
    };
    const html = render(stats);
    const rows: string[][] = [];
    let row: string[];
    await new HTMLRewriter()
      .on("tr", {
        element() {
          row = [];
          rows.push(row);
        },
      })
      .on("th,td", {
        text(chunk) {
          if (chunk.text.trim()) row.push(chunk.text.trim());
        },
      })
      .transform(new Response(html))
      .text();
    expect(rows[1]).toContain("200");
    expect(rows[1]).toContain("20");
    expect(rows[1]).toContain("220");
    expect(rows[1]).not.toContain(new Intl.NumberFormat().format(1100));
    expect(rows[6]).toContain(localizedCopy("en-US", "general.dashboard.interface_stats_other_models"));
    expect(rows[6]).toContain("330");
    expect(rows[7]).toContain(new Intl.NumberFormat().format(1100));
    expect(html).toContain('value="20"');
    expect(html).not.toContain('style="');
    const complete = render({ ...stats, totals: { ...stats.totals, inputTokens: 700, outputTokens: 70 } });
    expect(complete).not.toContain(localizedCopy("en-US", "general.dashboard.interface_stats_other_models"));
    const empty = render({ ...stats, models: [], totals: { ...stats.totals, inputTokens: 0, outputTokens: 0 } });
    expect(empty).not.toContain("<table");
    expect(empty).not.toContain("NaN");
    expect(
      render({ ...stats, models: [{ ...stats.models[0], name: '<img src=x onerror="alert(1)">' }] }),
    ).not.toContain("<img");
  });
});

describe("dashboard memory and naming authorization", () => {
  beforeAll(() => initializeLocalizer());
  afterEach(() => mock.restore());

  function setup(
    canManage = false,
    configOverrides: Parameters<typeof createServerConfig>[0] = {},
    privacyLevel = PrivacyLevel.MINIMAL,
  ) {
    const { app, config } = createDashboardApp(fakeClient);
    const session = new DashboardSessionStore().create(
      { id: "987654321098765432", username: "Mirri" },
      "test-token",
      3600,
    );
    session.guildCache = {
      fetchedAt: Date.now(),
      guilds: [{ id: "123456789012345678", name: "Test server", iconUrl: null, memberCount: 5, canManage }],
    };
    spyOn(DashboardSessionStore.prototype, "get").mockImplementation((id) => (id === session.id ? session : null));
    spyOn(TomoriDashboardCore.prototype, "ensureUser").mockResolvedValue(
      createUserRow({ user_id: 7, user_disc_id: session.user.id, privacy_level: privacyLevel }),
    );
    spyOn(TomoriDashboardCore.prototype, "loadGuildSnapshot").mockResolvedValue({
      serverId: 42,
      serverDiscordId: "123456789012345678",
      config: createServerConfig(configOverrides),
      rawPersonas: [],
      personas: [
        {
          personaId: 9,
          lineageId: 77,
          nickname: "Tomori",
          isAlter: true,
          isPointer: false,
          avatarUrl: null,
          triggerWords: [],
          personaPrompt: null,
          attributes: [],
          sampleDialogues: [],
          contextNote: null,
          contextNoteDepth: 0,
          physicalAppearanceTags: [],
          humanizerOverride: null,
        },
      ],
    });
    const namingWrite = spyOn(TomoriDashboardCore.prototype, "updatePersonaNaming").mockResolvedValue(true);
    const categoryWrite = spyOn(TomoriDashboardCore.prototype, "updateStmCategories").mockResolvedValue(true);
    const signature = createHmac("sha256", config.sessionSecret).update(session.id).digest("base64url");
    const headers = {
      Cookie: `${SESSION_COOKIE}=${session.id}.${signature}`,
      "X-CSRF-Token": session.csrfToken,
      "Content-Type": "application/json",
    };
    return { app, headers, session, namingWrite, categoryWrite };
  }

  it("reports duplicate, invalid and failed import entries without hiding partial writes or exposing errors", async () => {
    const { app, headers } = setup();
    const rows: PersonalMemoryRow[] = [
      { personal_memory_id: 1, user_id: 7, persona_lineage_id: 77, content: "Existing fact", tags: [] },
    ];
    const list = spyOn(TomoriDashboardCore.prototype, "listPersonalMemories").mockImplementation(async () => rows);
    const internalError = new Error("Private database connection details");
    const write = spyOn(TomoriDashboardCore.prototype, "addPersonalMemory").mockImplementation(
      async (_userId, lineageId, content, tags) => {
        if (content === "Database failure") throw internalError;
        if (content === "Limit reached") return null;
        const row = { personal_memory_id: 2, user_id: 7, persona_lineage_id: lineageId, content, tags };
        rows.push(row);
        return row;
      },
    );
    const errorLog = spyOn(log, "error").mockResolvedValue();
    spyOn(log, "warn").mockImplementation(() => {});
    spyOn(log, "metric").mockImplementation(() => {});
    const response = await app.request("/settings/api/guilds/123456789012345678/memories/import", {
      method: "POST",
      headers,
      body: JSON.stringify({
        kind: "personal",
        lineageId: 77,
        memories: [
          { content: "New fact", tags: ["profile"] },
          { content: " existing FACT " },
          null,
          { content: "x".repeat(getMemoryLimits().maxMemoryLength + 1) },
          { content: "Bad tags", tags: ["x".repeat(33)] },
          { content: "Database failure" },
          { content: "Limit reached" },
          { content: "NEW FACT" },
        ],
      }),
    });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({
      inserted: 1,
      skipped: 2,
      invalid: 3,
      failed: 2,
      issues: [
        { index: 1, code: "duplicate_memory" },
        { index: 2, code: "invalid_memory" },
        { index: 3, code: "invalid_memory" },
        { index: 4, code: "invalid_memory" },
        { index: 5, code: "import_failed" },
        { index: 6, code: "memory_limit_or_write_failed" },
        { index: 7, code: "duplicate_memory" },
      ],
    });
    expect(JSON.stringify(payload)).not.toContain(internalError.message);
    expect(write).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenCalledWith(7, 77);
    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(errorLog.mock.calls[0]?.[1]).toBe(internalError);
    expect(rows).toHaveLength(2);
  });

  for (const scenario of [
    { name: "foreign personal scope", kind: "personal", lineageId: 999, code: "lineage_forbidden" },
    { name: "global server scope", kind: "server", lineageId: 0, code: "lineage_forbidden" },
    { name: "privacy opt-out", kind: "personal", lineageId: 77, code: "privacy_opt_out" },
    { name: "disabled member teaching", kind: "server", lineageId: 77, code: "server_teaching_disabled" },
    { name: "blacklisted member", kind: "server", lineageId: 77, code: "user_blacklisted" },
  ]) {
    it(`rejects imports for ${scenario.name} before validating entries or writing`, async () => {
      const { app, headers } = setup(
        false,
        { server_memteaching_enabled: scenario.code !== "server_teaching_disabled" },
        scenario.code === "privacy_opt_out" ? PrivacyLevel.FULL : PrivacyLevel.MINIMAL,
      );
      spyOn(TomoriDashboardCore.prototype, "isUserBlacklisted").mockResolvedValue(scenario.code === "user_blacklisted");
      const personalList = spyOn(TomoriDashboardCore.prototype, "listPersonalMemories").mockResolvedValue([]);
      const serverList = spyOn(TomoriDashboardCore.prototype, "listServerMemoryContents").mockResolvedValue([]);
      const personalWrite = spyOn(TomoriDashboardCore.prototype, "addPersonalMemory").mockResolvedValue(null);
      const serverWrite = spyOn(TomoriDashboardCore.prototype, "addServerMemory").mockResolvedValue(null);
      const response = await app.request("/settings/api/guilds/123456789012345678/memories/import", {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: scenario.kind, lineageId: scenario.lineageId, memories: [null] }),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: scenario.code } });
      expect(personalList).not.toHaveBeenCalled();
      expect(serverList).not.toHaveBeenCalled();
      expect(personalWrite).not.toHaveBeenCalled();
      expect(serverWrite).not.toHaveBeenCalled();
    });
  }

  it("rejects malformed import envelopes without reading or writing memories", async () => {
    const { app, headers } = setup();
    const list = spyOn(TomoriDashboardCore.prototype, "listPersonalMemories").mockResolvedValue([]);
    const write = spyOn(TomoriDashboardCore.prototype, "addPersonalMemory").mockResolvedValue(null);
    for (const body of [
      { kind: "unknown", lineageId: 77, memories: [] },
      { kind: "personal", lineageId: 1.5, memories: [] },
      { kind: "personal", lineageId: 77, memories: Array.from({ length: 501 }, () => ({ content: "Fact" })) },
    ]) {
      const response = await app.request("/settings/api/guilds/123456789012345678/memories/import", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ error: { code: "invalid_import" } });
    }
    expect(list).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it("restricts persona model overrides to administrators with CSRF", async () => {
    const member = setup();
    const path = "/settings/api/guilds/123456789012345678/personas/9/text-model";
    expect((await member.app.request(path, { method: "GET", headers: member.headers })).status).toBe(403);
    expect(
      (
        await member.app.request(path, {
          method: "PUT",
          headers: member.headers,
          body: JSON.stringify({ modelId: 11 }),
        })
      ).status,
    ).toBe(403);
    const admin = setup(true);
    const read = spyOn(TomoriDashboardCore.prototype, "loadPersonaTextModelWorkspace").mockResolvedValue({
      options: [{ id: 11, provider: "openrouter", label: "Model" }],
      selected: null,
    });
    const write = spyOn(TomoriDashboardCore.prototype, "setPersonaTextModelOverride").mockResolvedValue(true);
    expect((await admin.app.request(path, { method: "GET", headers: admin.headers })).status).toBe(200);
    const request = (body: unknown, csrf = admin.session.csrfToken) =>
      admin.app.request(path, {
        method: "PUT",
        headers: { ...admin.headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    expect((await request({ modelId: null })).status).toBe(200);
    expect(write).toHaveBeenCalledWith(expect.anything(), 9, null);
    expect((await request({ modelId: 11 }, "invalid")).status).toBe(403);
    expect((await request({ modelId: 11, personaId: 10 })).status).toBe(422);
    expect(write).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("requires administrator permission and CSRF for provider-specific server parameters", async () => {
    const path = "/settings/api/guilds/123456789012345678/providers/server/parameters";
    const member = setup();
    const body = { provider: "openrouter", patch: { temperature: 0.5 } };
    expect(
      (await member.app.request(path, { method: "PATCH", headers: member.headers, body: JSON.stringify(body) })).status,
    ).toBe(403);
    const admin = setup(true);
    const write = spyOn(TomoriDashboardCore.prototype, "setServerProviderParameters").mockResolvedValue({
      status: "success",
    });
    const request = (value: unknown, csrf = admin.session.csrfToken) =>
      admin.app.request(path, {
        method: "PATCH",
        headers: { ...admin.headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(value),
      });
    expect((await request(body)).status).toBe(200);
    expect(write).toHaveBeenCalledWith(expect.anything(), "openrouter", body.patch);
    expect((await request(body, "invalid")).status).toBe(403);
    expect((await request({ ...body, serverId: 99 })).status).toBe(422);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("scopes personal parameter edits to the authenticated member and requires CSRF and membership", async () => {
    const { app, headers, session } = setup();
    const write = spyOn(TomoriDashboardCore.prototype, "setPersonalProviderParameters").mockResolvedValue({
      status: "success",
    });
    const request = (body: unknown, csrf = session.csrfToken) =>
      app.request("/settings/api/guilds/123456789012345678/providers/personal/parameters", {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    const body = { provider: "openrouter", patch: { temperature: 0.5 } };
    expect((await request(body)).status).toBe(200);
    expect(write).toHaveBeenCalledWith(7, session.user.id, "openrouter", body.patch);
    expect((await request(body, "invalid")).status).toBe(403);
    expect((await request({ ...body, userId: 99 })).status).toBe(422);
    session.guildCache = { fetchedAt: Date.now(), guilds: [] };
    expect((await request(body)).status).toBe(403);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("scopes personal model selection to the authenticated member and requires CSRF and membership", async () => {
    const { app, headers, session } = setup();
    const write = spyOn(TomoriDashboardCore.prototype, "setPersonalPrimaryModel").mockResolvedValue(true);
    const request = (body: unknown, csrf = session.csrfToken) =>
      app.request("/settings/api/guilds/123456789012345678/providers/personal/model", {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    const body = { capability: "text", provider: "openrouter", modelId: 11 };
    expect((await request(body)).status).toBe(200);
    expect(write).toHaveBeenCalledWith(7, session.user.id, "text", "openrouter", 11);
    expect((await request(body, "invalid")).status).toBe(403);
    expect((await request({ ...body, userId: 99 })).status).toBe(422);
    session.guildCache = { fetchedAt: Date.now(), guilds: [] };
    expect((await request(body)).status).toBe(403);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("allows only the member's personal fallback chain and requires CSRF and guild membership", async () => {
    const { app, headers, session } = setup();
    const refs = [{ type: "llm" as const, id: 12 }];
    spyOn(TomoriDashboardCore.prototype, "loadPersonalFallbackWorkspace").mockResolvedValue({
      fallbackOptions: [{ ref: refs[0], label: "Backup" }],
      fallbackRefs: [],
      randomizerEnabled: false,
    });
    const write = spyOn(TomoriDashboardCore.prototype, "setPersonalFallbacks").mockResolvedValue(true);
    const request = (scope: string, body: unknown, csrf = session.csrfToken) =>
      app.request(`/settings/api/guilds/123456789012345678/providers/${scope}/fallbacks`, {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    const response = await request("personal", { refs });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ refs });
    expect(write).toHaveBeenCalledWith(7, session.user.id, refs);
    expect((await request("server", { refs })).status).toBe(403);
    expect((await request("personal", { refs }, "invalid")).status).toBe(403);
    expect((await request("personal", { refs, userId: 99 })).status).toBe(422);
    session.guildCache = { fetchedAt: Date.now(), guilds: [] };
    expect((await request("personal", { refs })).status).toBe(403);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("allows a member's own naming preferences but denies server category writes", async () => {
    const { app, headers, namingWrite, categoryWrite } = setup();
    const preference = { nickname: "Mirri", prefix: "", suffix: null };
    const response = await app.request("/settings/api/guilds/123456789012345678/personas/9/naming", {
      method: "PUT",
      headers,
      body: JSON.stringify(preference),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ preference });
    expect(namingWrite).toHaveBeenCalledWith({
      userId: 7,
      userDiscId: "987654321098765432",
      personaLineageId: 77,
      ...preference,
    });
    const denied = await app.request("/settings/api/guilds/123456789012345678/stm/categories", {
      method: "PUT",
      headers,
      body: JSON.stringify({ categories: [] }),
    });
    expect(denied.status).toBe(403);
    expect(categoryWrite).not.toHaveBeenCalled();
  });

  it("requires authentication, membership and CSRF even for administrators", async () => {
    const { app, headers, namingWrite, categoryWrite } = setup(true);
    for (const route of ["personas/9/naming", "stm/categories"]) {
      const url = `/settings/api/guilds/123456789012345678/${route}`;
      expect((await app.request(url, { method: "PUT" })).status).toBe(401);
      expect((await app.request(url, { method: "PUT", headers: { Cookie: headers.Cookie } })).status).toBe(403);
      expect(
        (await app.request(url.replace("123456789012345678", "111111111111111111"), { method: "PUT", headers })).status,
      ).toBe(403);
    }
    expect(namingWrite).not.toHaveBeenCalled();
    expect(categoryWrite).not.toHaveBeenCalled();
  });

  it("rejects foreign personas and user spoofing without writes, including for admins", async () => {
    const { app, headers, namingWrite } = setup(true);
    const preference = { nickname: null, prefix: null, suffix: null };
    for (const [personaId, body, status] of [
      [10, preference, 404],
      [9, { ...preference, userId: 8 }, 422],
      ["9junk", preference, 404],
    ] as const) {
      const response = await app.request(`/settings/api/guilds/123456789012345678/personas/${personaId}/naming`, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(status);
    }
    expect(namingWrite).not.toHaveBeenCalled();
  });

  it("returns validation errors for bad categories and permits valid admin writes", async () => {
    const { app, headers, categoryWrite } = setup(true);
    const url = "/settings/api/guilds/123456789012345678/stm/categories";
    const invalid = await app.request(url, {
      method: "PUT",
      headers,
      body: JSON.stringify({ categories: [{ label: "Goals", description: "" }] }),
    });
    expect(invalid.status).toBe(422);
    expect(categoryWrite).not.toHaveBeenCalled();
    const categories = [{ label: "Goals", description: "Current goals" }];
    const saved = await app.request(url, { method: "PUT", headers, body: JSON.stringify({ categories }) });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ categories });
    expect(categoryWrite).toHaveBeenCalledWith(42, categories);
  });
});
