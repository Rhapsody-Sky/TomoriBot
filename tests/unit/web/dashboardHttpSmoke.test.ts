import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { createHmac } from "node:crypto";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import {
  ChannelType,
  Collection,
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
  RESTJSONErrorCodes,
  type Client,
  type Guild,
} from "discord.js";
import { createDashboardApp } from "@/web/dashboard/server";
import { TomoriDashboardCore } from "@/web/dashboard/core";
import { DashboardLorebookService } from "@/web/dashboard/lorebookService";
import { DashboardServiceError } from "@/web/dashboard/errors";
import { DashboardSessionStore, OAUTH_STATE_COOKIE, SESSION_COOKIE } from "@/web/dashboard/auth";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createServerConfig, createUserRow } from "../../helpers/fixtures";
import { localizedCopy } from "../../helpers/localeCases";
import type { DashboardServerStats } from "@/web/dashboard/core";
import {
  customEndpointSchema,
  type PersonalMemoryRow,
  personalMemorySchema,
  PrivacyLevel,
  randomTriggerSchema,
  serverMemorySchema,
  type TomoriPresetRow,
} from "@/types/db/schema";
import { log } from "@/utils/misc/logger";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { humanizerSettingsFromDegree } from "@/constants/humanizer";
import { configPersonaOperations } from "@/utils/discord/interactions/configPersonaOperations";
import { configModelOperations } from "@/utils/discord/interactions/configModelOperations";
import { providerPanelOperations } from "@/utils/provider/providerPanelOperations";
import * as customEndpointService from "@/utils/provider/customEndpointService";
import type { EndpointProviderPanelEntry } from "@/types/discord/providerPanel";
import { personalConfigOperations } from "@/utils/discord/interactions/personalConfigOperations";
import * as personalConfigLoaders from "@/utils/discord/interactions/personalConfigLoaders";
import { personalMemoriesOperations } from "@/utils/discord/interactions/personalMemoriesRoutes";
import { serverMemoriesOperations } from "@/utils/discord/interactions/memoriesRoutes";
import { responseDraftingOperations } from "@/utils/discord/interactions/responseDraftingOperations";
import {
  configRepository,
  llmProviderRepo,
  personaRepository,
  serverScheduleRepository,
  userRepository,
} from "@/utils/db/repositories";
import * as stPresetCache from "@/utils/cache/stPresetCache";
import { conditioningMemoryRepository } from "@/utils/db/repositories/ConditioningMemoryRepository";
import { personaSpriteRepository } from "@/utils/db/repositories/PersonaSpriteRepository";
import { naturalNudgePanelDependencies } from "@/modules/natural-nudges/discord/operations";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import * as speechTargets from "@/utils/provider/speechEndpointResolver";
import * as speechRepository from "@/utils/db/repositories/SpeechRepository";
import * as moderation from "@/utils/moderation/moderationOperations";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { PRESET_EXPORT_VERSION, presetExportSchema } from "@/types/preset/presetExport";
import { embedMetadataInPNG, extractMetadataFromPNG } from "@/utils/image/pngMetadata";
import * as avatarStorage from "@/utils/storage/avatarStorage";
import * as guildIdentity from "@/utils/discord/guildIdentity";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { lorebookEntryRowSchema } from "@/modules/lorebooks/db/types";
import { createLlmRow, createPersona } from "../../helpers/fixtures";

const fakeClient = {
  application: { id: "123456789012345678" },
  user: { id: "123456789012345678" },
  guilds: { cache: new Map() },
} as unknown as Client;

const tinyPersonaAvatar = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
  "base64",
);

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
    expect(html).toContain("/settings/assets/ui-kit.css");
    expect(html).not.toContain("/settings/assets/companion.css");
    expect(html).not.toContain("/settings/assets/app.css");
    expect(html).toContain("/settings/assets/app.js");
    expect(html).toContain('data-dashboard-entry="loading" aria-busy="true"');
    expect(html).toContain('role="progressbar" aria-labelledby="entry-title"');
  });

  it("renders Discord sign-in failures without starting a dashboard session", async () => {
    await initializeLocalizer();
    const { app, config } = createDashboardApp(fakeClient);
    config.clientId = "";
    const unavailable = await app.request("/settings/login");
    const invalid = await app.request("/settings/oauth/callback");

    config.clientId = "123456789012345678";
    config.clientSecret = "test";
    const login = await app.request("/settings/login");
    expect(login.status).toBe(302);
    const state = new URL(login.headers.get("location") ?? "").searchParams.get("state");
    const oauthCookie = login.headers.get("set-cookie")?.split(";")[0] ?? "";
    const fetchDiscord = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 503 }));
    try {
      const failed = await app.request(`/settings/oauth/callback?code=test&state=${state}`, {
        headers: { Cookie: oauthCookie },
      });
      expect(fetchDiscord).toHaveBeenCalledTimes(1);
      for (const [response, status, key] of [
        [unavailable, 503, "site_oauth_unconfigured"],
        [invalid, 400, "site_oauth_invalid_state"],
        [failed, 502, "site_oauth_failed"],
      ] as const) {
        expect(response.status).toBe(status);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(response.headers.get("set-cookie") ?? "").not.toContain(`${SESSION_COOKIE}=`);
        const html = await response.text();
        expect(html).toContain(localizedCopy("en-US", `general.dashboard.${key}`));
        expect(html).toContain('href="/settings"');
        expect(html).not.toContain("/settings/assets/app.js");
      }
      expect(failed.headers.get("set-cookie")).toContain(`${OAUTH_STATE_COOKIE}=`);
    } finally {
      fetchDiscord.mockRestore();
    }
  });

  it("serves every dashboard asset from the source tree", async () => {
    for (const [asset, contentType] of [
      ["app.css", "text/css"],
      ["companion.css", "text/css"],
      ["app.js", "application/javascript"],
      ["collection.css", "text/css"],
      ["design.js", "application/javascript"],
      ["fx.js", "application/javascript"],
      ["navigation-icons.svg", "image/svg+xml"],
      ["persona-art-tomori.png", "image/png"],
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

    expect(source).toContain('ui("persona_visual_prompt")');
    expect(source).toContain('ui("persona_visual_prompt_hint")');
    expect(source).toContain("data-auto-grow");
    expect(source).toContain("resizeAutoGrowTextarea");
    expect(source).not.toContain("Core identity, behavior, speaking style, and boundaries");
    expect(source).toContain("data-persona-create-open");
    expect(source).toContain("data-persona-import-open");
    expect(source).toContain("data-persona-entry-form");
    expect(source).toContain('id="persona-test-chat-form"');
    expect(source).toContain("event.ctrlKey");
    expect(source).toContain("input.form?.requestSubmit()");
    expect(source).toContain('role="switch"');
    expect(source).toContain("data-avatar-fallback");
    expect(source).toContain("data-persona-memory-search");
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
    expect(source).toContain('class="choice"');
    expect(source).toContain('labelKey: "settings_models_group"');
    expect(source).toContain('titleKey: "settings_context"');
    expect(source).toContain('titleKey: "settings_triggers"');
    expect(source).toContain('titleKey: "settings_output"');
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
    expect(source).toContain("data-history-timeframe");
    expect(source).toContain("/stats?");
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
      if (ts.isFunctionDeclaration(node) && ["renderModelUsage", "statsModelUsage"].includes(node.name?.text ?? ""))
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
    }) as (stats: DashboardServerStats, selectedModel?: string | null) => string;
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
    expect(html).toContain('data-share-value="20"');
    const shareCells: string[] = [];
    let modelNameShares = 0;
    await new HTMLRewriter()
      .on("tbody td.model-share-cell .share-track span", {
        element(element) {
          shareCells.push(element.getAttribute("data-share-value") ?? "");
        },
      })
      .on("tbody th .share-track, meter", {
        element() {
          modelNameShares += 1;
        },
      })
      .transform(new Response(html))
      .text();
    const expectedShares = [20, 15, 14, 11, 10, 30];
    expect(shareCells).toHaveLength(expectedShares.length);
    shareCells.forEach((share, index) => {
      expect(Number(share)).toBeCloseTo(expectedShares[index]);
    });
    expect(modelNameShares).toBe(0);
    expect(html).not.toContain('style="');
    const complete = render({ ...stats, totals: { ...stats.totals, inputTokens: 700, outputTokens: 70 } });
    expect(complete).not.toContain(localizedCopy("en-US", "general.dashboard.interface_stats_other_models"));
    const empty = render({ ...stats, models: [], totals: { ...stats.totals, inputTokens: 0, outputTokens: 0 } });
    expect(empty).not.toContain("<table");
    expect(empty).not.toContain("NaN");
    expect(
      render({ ...stats, models: [{ ...stats.models[0], name: '<img src=x onerror="alert(1)">' }] }),
    ).not.toContain("<img");
    const filteredStats: DashboardServerStats = {
      ...stats,
      history: {
        from: "2024-03-01",
        through: "2024-03-02",
        days: [],
        models: [
          { date: "2024-03-01", model: "sample/model-f", inputTokens: 20, outputTokens: 4, cost: 0.01 },
          { date: "2024-03-02", model: "sample/model-f", inputTokens: 30, outputTokens: 6, cost: 0.02 },
          { date: "2024-03-01", model: "sample/model-a", inputTokens: 200, outputTokens: 20, cost: 0.03 },
        ],
      },
    };
    const filtered = render(filteredStats, "sample/model-f");
    expect(filtered).toContain("sample/model-f");
    expect(filtered).not.toContain("sample/model-a");
    expect(filtered).toContain('data-share-value="100"');
    const filteredCells: string[] = [];
    await new HTMLRewriter()
      .on("tbody td:not(.model-share-cell)", {
        text(chunk) {
          if (chunk.text.trim()) filteredCells.push(chunk.text.trim());
        },
      })
      .transform(new Response(filtered))
      .text();
    expect(filteredCells).toEqual(["50", "10", "60", "-"]);
    expect(filtered).toContain(localizedCopy("en-US", "general.dashboard.interface_stats_cost_unavailable"));
    expect(filtered).not.toContain('style="');
  });

  it("keeps the complete selected period and model-specific costs in the tile trends", async () => {
    const source = await Bun.file("src/web/dashboard/assets/app.js").text();
    const ast = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    let declaration = "";
    const walk = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === "statsTrendBuckets") declaration = node.getText(ast);
      ts.forEachChild(node, walk);
    };
    walk(ast);
    const build = runInNewContext(`${declaration}\nstatsTrendBuckets`) as (
      history: NonNullable<DashboardServerStats["history"]>,
      model: string | null,
    ) => Array<{ inputTokens: number; outputTokens: number; cost: number }>;
    const history = {
      from: "2024-01-01",
      through: "2024-03-30",
      days: [
        { date: "2024-01-01", inputTokens: 100, outputTokens: 4 },
        { date: "2024-03-30", inputTokens: 10, outputTokens: 40 },
      ],
      models: [
        { date: "2024-01-01", model: "a", inputTokens: 100, outputTokens: 4, cost: 2 },
        { date: "2024-03-30", model: "b", inputTokens: 10, outputTokens: 40, cost: 5 },
      ],
    };
    const all = build(history, null);
    expect(all).toHaveLength(30);
    expect(all[0]).toEqual({ inputTokens: 100, outputTokens: 4, cost: 2 });
    expect(all[1]).toEqual({ inputTokens: 0, outputTokens: 0, cost: 0 });
    expect(all.at(-1)).toEqual({ inputTokens: 10, outputTokens: 40, cost: 5 });
    const model = build(history, "a");
    expect(model[0]).toEqual({ inputTokens: 100, outputTokens: 4, cost: 2 });
    expect(model.at(-1)).toEqual({ inputTokens: 0, outputTokens: 0, cost: 0 });
    expect(build({ ...history, through: history.from }, null)).toEqual([]);
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
    spyOn(TomoriDashboardCore.prototype, "loadAllowedChannelIds").mockResolvedValue([]);
    spyOn(TomoriDashboardCore.prototype, "loadGuildSnapshot").mockResolvedValue({
      serverId: 42,
      serverDiscordId: "123456789012345678",
      config: createServerConfig(configOverrides),
      rawPersonas: [createPersona({ server_id: 42, persona_id: 9 })],
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

  it("lets authors restrict server memories to current visible allowed channels without dropping unavailable scopes", async () => {
    const { app, headers } = setup(true, { channel_memory_enabled: true, server_memteaching_enabled: true });
    const path = "/settings/api/guilds/123456789012345678/memories/server";
    const visible = "123456789012345679";
    const other = "123456789012345680";
    const hidden = "123456789012345681";
    const excluded = "123456789012345682";
    const channels = new Collection(
      [visible, other, hidden, excluded].map((id) => [
        id,
        {
          id,
          name: `channel-${id.slice(-1)}`,
          type: ChannelType.GuildText,
          isTextBased: () => true,
          isThread: () => false,
          permissionsFor: () => new PermissionsBitField(id === hidden ? 0n : PermissionFlagsBits.ViewChannel),
        },
      ]),
    );
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      channels: { cache: channels },
      members: { fetch: async () => ({ permissions: new PermissionsBitField(0n) }) },
    } as unknown as Guild);
    spyOn(TomoriDashboardCore.prototype, "loadAllowedChannelIds").mockResolvedValue([visible, other, hidden]);
    spyOn(TomoriDashboardCore.prototype, "isUserBlacklisted").mockResolvedValue(false);
    const saved = serverMemorySchema.parse({
      server_memory_id: 8,
      server_id: 42,
      persona_id: 9,
      persona_lineage_id: 77,
      user_id: 7,
      content: "Sample fact",
      channel_disc_ids: [visible],
    });
    const unavailable = { ...saved, server_memory_id: 9, channel_disc_ids: [hidden], channel_scope_pending: true };
    const load = spyOn(TomoriDashboardCore.prototype, "listServerMemories").mockImplementation(
      async (_serverId, _lineageId, authorId) => (authorId === 7 ? [saved, unavailable] : []),
    );
    spyOn(TomoriDashboardCore.prototype, "listServerMemoryContents").mockResolvedValue([]);
    const add = spyOn(TomoriDashboardCore.prototype, "addServerMemory").mockResolvedValue(saved);
    const text = spyOn(TomoriDashboardCore.prototype, "updateServerMemory").mockResolvedValue(unavailable);
    const edit = spyOn(serverMemoriesOperations, "edit").mockResolvedValue({
      status: "success",
      row: { ...saved, channel_disc_ids: [other] },
    });
    const read = await app.request(`${path}?lineageId=77`, { headers });
    expect(read.status).toBe(200);
    expect(read.headers.get("Cache-Control")).toBe("private, no-store");
    const response = await read.json();
    expect(response.channels.map(({ id }: { id: string }) => id)).toEqual([visible, other]);
    expect(response.memories[1]).toMatchObject({
      channelDiscIds: [],
      unavailableChannelCount: 1,
      channelScopePending: true,
    });
    expect(load).toHaveBeenCalledWith(42, 77, 7);

    const write = (id: number | null, value: Record<string, unknown>) =>
      app.request(id ? `${path}/${id}` : path, {
        method: id ? "PATCH" : "POST",
        headers,
        body: JSON.stringify({ lineageId: 77, content: saved.content, ...value }),
      });
    expect((await write(null, { channelDiscIds: [hidden] })).status).toBe(422);
    expect((await write(null, { channelDiscIds: [excluded] })).status).toBe(422);
    expect(add).not.toHaveBeenCalled();
    expect((await write(null, { channelDiscIds: [visible] })).status).toBe(201);
    expect(add.mock.calls[0]?.[5]).toEqual([visible]);

    expect((await write(999, { channelDiscIds: [other] })).status).toBe(404);
    expect((await write(9, { channelDiscIds: [] })).status).toBe(409);
    expect(edit).not.toHaveBeenCalled();
    expect((await write(9, { content: "Revised sample fact" })).status).toBe(200);
    expect(text.mock.calls[0]?.slice(1)).toEqual([9, 77, "Revised sample fact", 7]);
    const scopeEdit = await write(8, { channelDiscIds: [other] });
    expect(scopeEdit.status).toBe(200);
    expect((await scopeEdit.json()).memory.channelDiscIds).toEqual([other]);
    expect(edit).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: 42,
        personaLineageId: 77,
        taughtByUserId: 7,
        memoryId: 8,
        channelDiscIds: [other],
      }),
    );
  });

  it("returns only the signed-in user's active STM count and accepts only an authenticated CSRF-protected clear", async () => {
    const { app, headers, session } = setup(false, {}, PrivacyLevel.FULL);
    session.guildCache = { fetchedAt: Date.now(), guilds: [] };
    const path = "/settings/api/profile/short-term-memory";
    const target = "111111111111111111";
    const count = spyOn(personalConfigLoaders, "getStmCount").mockResolvedValue(3);
    const clear = spyOn(personalMemoriesOperations, "clearStm").mockResolvedValue();

    expect((await app.request(path)).status).toBe(401);
    expect((await app.request(path, { method: "DELETE" })).status).toBe(401);
    expect(count).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();

    const read = await app.request(`${path}?userDiscId=${target}`, { headers });
    expect(read.status).toBe(200);
    expect(read.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await read.json()).toEqual({ count: 3 });
    expect(count).toHaveBeenCalledWith(session.user.id);
    expect(count).not.toHaveBeenCalledWith(target);

    expect(
      (await app.request(path, { method: "DELETE", headers: { ...headers, "X-CSRF-Token": "invalid" } })).status,
    ).toBe(403);
    expect(clear).not.toHaveBeenCalled();

    const removal = await app.request(`${path}?userDiscId=${target}`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ userDiscId: target }),
    });
    expect(removal.status).toBe(202);
    expect(await removal.text()).toBe("");
    expect(clear.mock.calls).toEqual([[session.user.id]]);
    expect(count).toHaveBeenCalledTimes(1);
  });

  it("preserves legacy cooldown settings on unrelated saves and requires a positive duration to enable a new scope", async () => {
    const config = createServerConfig({ cooldown_type: 4, cooldown_length: 0 });
    const { app, headers } = setup(true, config);
    const write = spyOn(TomoriDashboardCore.prototype, "updateSettings").mockResolvedValue(config);
    const patch = (value: unknown) =>
      app.request("/settings/api/guilds/123456789012345678/settings/triggers", {
        method: "PATCH",
        headers,
        body: JSON.stringify(value),
      });

    expect((await patch({ cooldown_type: 1 })).status).toBe(422);
    expect(write).not.toHaveBeenCalled();

    const unrelated = await patch({ always_reply_enabled: true });
    expect(unrelated.status).toBe(200);
    expect((await unrelated.json()).values).toMatchObject({ cooldown_type: 4, cooldown_length: 0 });
    expect(write.mock.calls[0]?.[2]).toEqual({ always_reply_enabled: true });

    expect((await patch({ cooldown_type: 0 })).status).toBe(200);
    expect((await patch({ cooldown_type: 1, cooldown_length: 10 })).status).toBe(200);
    expect(write.mock.calls[2]?.[2]).toEqual({ cooldown_type: 1, cooldown_length: 10 });
  });

  it("lets managers preview prompt presets without writing and rejects changes when a SillyTavern preset takes over", async () => {
    const { app, headers } = setup(true);
    const path = "/settings/api/guilds/123456789012345678/settings";
    let canManage = false;
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      channels: { cache: new Collection() },
      members: {
        fetch: async () => ({ permissions: new PermissionsBitField(canManage ? PermissionFlagsBits.ManageGuild : 0n) }),
      },
    } as unknown as Guild);
    const cached = spyOn(stPresetCache, "getCachedActivePreset").mockResolvedValue(null);
    const load = spyOn(configRepository, "loadSystemPromptPresets").mockResolvedValue([
      {
        system_prompt_preset_id: 3,
        system_prompt_preset_name: "example",
        system_prompt_preset_desc: "Example",
        preset_prompt_text: "Answer briefly.",
      },
    ]);
    const write = spyOn(TomoriDashboardCore.prototype, "updateSettings").mockResolvedValue(createServerConfig());
    expect((await app.request(`${path}/system-prompt-presets`, { headers })).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
    canManage = true;
    const choices = await app.request(`${path}/system-prompt-presets`, { headers });
    expect(await choices.json()).toEqual({
      locked: false,
      presets: [{ id: 3, name: "example", text: "Answer briefly." }],
    });
    expect(write).not.toHaveBeenCalled();
    cached.mockResolvedValue({
      preset: { preset_id: 6, server_id: 42, preset_name: "Example", raw_json: {}, is_active: true },
      nodes: [],
    });
    expect(await (await app.request(`${path}/system-prompt-presets`, { headers })).json()).toEqual({
      locked: true,
      presets: [],
    });
    expect(
      (
        await app.request(`${path}/chat`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ system_prompt: "Alternate prompt" }),
        })
      ).status,
    ).toBe(409);
    expect(write).not.toHaveBeenCalled();
    expect(
      (
        await app.request(`${path}/chat`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ system_prompt: null, timezone_offset: 2 }),
        })
      ).status,
    ).toBe(200);
    expect(write.mock.calls[0]?.[2]).toEqual({ timezone_offset: 2 });
  });

  it("normalizes literal tool triggers while preserving saved regular expressions and other tool groups", async () => {
    const saved = { image: [{ type: "regex" as const, value: "a[bc]" }], dice: ["roll"] };
    const { app, headers, session } = setup(true, { deliberate_tool_triggers: saved });
    const path = "/settings/api/guilds/123456789012345678/settings/tool-triggers";
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({
          permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        }),
      },
    } as unknown as Guild);
    const write = spyOn(configRepository, "updateTriggerBehaviorConfig").mockResolvedValue(true);
    const patch = (value: unknown, csrf = session.csrfToken) =>
      app.request(path, {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(value),
      });
    expect((await patch({ action: "add", target: "image", value: "sample" }, "invalid")).status).toBe(403);
    expect((await patch({ action: "add", target: "unknown", value: "sample" })).status).toBe(422);
    expect((await patch({ action: "add", target: "dice", value: " Roll " })).status).toBe(409);
    expect(write).not.toHaveBeenCalled();
    expect((await patch({ action: "add", target: "image", value: " DRAW   THIS " })).status).toBe(200);
    expect(write).toHaveBeenLastCalledWith(42, {
      deliberate_tool_triggers: { dice: ["roll"], image: [...saved.image, "draw this"] },
    });
    expect((await patch({ action: "remove", target: "image", kind: "regex", value: "a[bc]" })).status).toBe(200);
    expect(write).toHaveBeenLastCalledWith(42, { deliberate_tool_triggers: { dice: ["roll"] } });
  });

  it("edits schedules only in visible text channels and keeps the target of an existing schedule fixed", async () => {
    const { app, headers, session } = setup(true);
    const path = "/settings/api/guilds/123456789012345678/settings/random-triggers";
    const visible = "123456789012345679";
    const hidden = "123456789012345680";
    const excluded = "123456789012345681";
    const guildChannels = new Collection(
      [visible, hidden, excluded].map((id) => [
        id,
        {
          id,
          name: `channel-${id.slice(-1)}`,
          type: ChannelType.GuildText,
          isTextBased: () => true,
          isThread: () => false,
          permissionsFor: () => new PermissionsBitField(id === hidden ? 0n : PermissionFlagsBits.ViewChannel),
        },
      ]),
    );
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      channels: { cache: guildChannels },
      members: { fetch: async () => ({ permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) }) },
    } as unknown as Guild);
    spyOn(TomoriDashboardCore.prototype, "loadAllowedChannelIds").mockResolvedValue([visible]);
    const entry = randomTriggerSchema.parse({
      trigger_id: 4,
      server_id: 42,
      channel_disc_id: visible,
      persona_id: null,
      timer_hours: 24,
      chance_percent: 20,
      next_trigger_at: new Date(0),
    });
    spyOn(serverScheduleRepository, "getServerTriggers").mockResolvedValue([
      entry,
      { ...entry, trigger_id: 8, channel_disc_id: hidden },
    ]);
    spyOn(serverScheduleRepository, "getServerTriggerCount").mockResolvedValue(2);
    const insert = spyOn(serverScheduleRepository, "insertTrigger").mockResolvedValue(entry);
    const edit = spyOn(serverScheduleRepository, "upsertTrigger").mockResolvedValue(entry);
    const remove = spyOn(serverScheduleRepository, "deleteTrigger").mockResolvedValue(true);
    const data = {
      channelDiscId: visible,
      personaId: null,
      timerHours: 8,
      chancePercent: 30,
      randomOffsetRange: 0,
      silenceThresholdHours: null,
      failureThreshold: null,
      respondToSelf: false,
      customPrompt: null,
    };
    const request = (method: string, id?: number, value?: unknown, csrf = session.csrfToken) =>
      app.request(id ? `${path}/${id}` : path, {
        method,
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: value === undefined ? undefined : JSON.stringify(value),
      });
    const read = await (await request("GET")).json();
    expect(read.channels.map(({ id }: { id: string }) => id)).toContain(visible);
    expect(read.channels.map(({ id }: { id: string }) => id)).not.toContain(hidden);
    expect(read.triggers.map(({ trigger_id }: { trigger_id: number }) => trigger_id)).toEqual([4]);
    expect((await request("POST", undefined, { ...data, channelDiscId: hidden })).status).toBe(422);
    expect((await request("POST", undefined, { ...data, channelDiscId: excluded })).status).toBe(422);
    expect((await request("POST", undefined, { ...data, personaId: 999 })).status).toBe(422);
    expect((await request("POST", undefined, data, "invalid")).status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
    expect((await request("POST", undefined, data)).status).toBe(201);
    expect(insert).toHaveBeenCalledWith({ serverId: 42, ...data });
    expect((await request("PATCH", 4, { ...data, channelDiscId: excluded })).status).toBe(422);
    expect((await request("PATCH", 8, data)).status).toBe(404);
    expect(edit).not.toHaveBeenCalled();
    expect((await request("PATCH", 4, data)).status).toBe(200);
    expect(edit).toHaveBeenCalledWith(4, { serverId: 42, ...data });
    expect((await request("DELETE", 8)).status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
    expect((await request("DELETE", 4)).status).toBe(200);
    expect(remove).toHaveBeenCalledWith(4);
  });

  it("removes only saved providers that do not supply the server's current text model", async () => {
    const { app, headers, session } = setup(true);
    const serverId = "123456789012345678";
    let manageGuild = false;
    const fetch = mock(async () => ({
      permissions: new PermissionsBitField(manageGuild ? PermissionFlagsBits.ManageGuild : 0n),
    }));
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({ members: { fetch } } as unknown as Guild);
    const entries = ["google", "openrouter"].map((provider) => ({
      id: `provider:${provider}`,
      kind: "provider" as const,
      provider,
      displayName: provider,
      savedAt: null,
      capabilities: [],
      rotationKeyCount: 0,
    }));
    const panel = {
      scopeKind: "server" as const,
      state: createPersona({
        server_id: 42,
        llm: createLlmRow({ llm_provider: "openrouter", llm_codename: "sample/text" }),
      }),
      data: { entries, initialEntryId: "provider:openrouter", readStatus: "fresh" as const },
    };
    const load = spyOn(providerPanelOperations, "loadServerProviderPanelScope").mockResolvedValue(panel);
    const remove = spyOn(providerPanelOperations, "removeServerProviderEntry");
    const write = spyOn(llmProviderRepo, "deleteServerProviderRegistration").mockResolvedValue(true);
    const request = (provider: string, csrf = session.csrfToken) =>
      app.request(`/settings/api/guilds/${serverId}/providers/server/credentials/${encodeURIComponent(provider)}`, {
        method: "DELETE",
        headers: { ...headers, "X-CSRF-Token": csrf },
      });

    expect((await request("openrouter")).status).toBe(403);
    expect(fetch).toHaveBeenCalledWith({ user: session.user.id, force: true });
    manageGuild = true;
    expect((await request("openrouter", "invalid")).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
    expect((await request("brave")).status).toBe(404);
    expect((await request("custom:5")).status).toBe(404);
    expect(remove).not.toHaveBeenCalled();
    load.mockResolvedValueOnce({ ...panel, data: { ...panel.data, readStatus: "stale" } });
    expect((await request("openrouter")).status).toBe(503);
    expect(remove).not.toHaveBeenCalled();

    const active = await request("google");
    expect(active.status).toBe(409);
    expect(await active.json()).toMatchObject({ error: { code: "provider_active" } });
    expect(write).not.toHaveBeenCalled();

    const response = await request("openrouter");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(load).toHaveBeenCalledWith(serverId);
    expect(write).toHaveBeenCalledWith(42, "openrouter");
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("keeps Brave Search and rotation writes server scoped and returns no saved keys", async () => {
    const { app, headers, session } = setup(true);
    const serverId = "123456789012345678";
    const base = `/settings/api/guilds/${serverId}/providers`;
    let manageGuild = false;
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({
          permissions: new PermissionsBitField(manageGuild ? PermissionFlagsBits.ManageGuild : 0n),
        }),
      },
    } as unknown as Guild);
    const add = spyOn(providerPanelOperations, "addServerProvider").mockResolvedValue({ status: "validation-failed" });
    const edit = spyOn(providerPanelOperations, "editServerProvider").mockResolvedValue({
      status: "success",
      entryId: "provider:openrouter",
      changed: ["rotation-key"],
    });
    const remove = spyOn(providerPanelOperations, "removeServerProviderEntry").mockResolvedValue({
      status: "success",
      entryId: "brave",
      displayName: "Brave Search",
    });
    spyOn(providerPanelOperations, "loadServerProviderPanelScope").mockResolvedValue({
      state: createPersona({ server_id: 42 }),
      data: {
        readStatus: "fresh",
        initialEntryId: "provider:openrouter",
        entries: [
          { kind: "brave", id: "brave", displayName: "Brave Search", savedAt: null },
          {
            kind: "provider",
            id: "provider:openrouter",
            provider: "openrouter",
            displayName: "OpenRouter",
            savedAt: null,
            capabilities: [],
            rotationKeyCount: 2,
          },
        ],
      },
    });
    const send = (path: string, method: string, value?: unknown, csrf = session.csrfToken) =>
      app.request(base + path, {
        method,
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: value === undefined ? undefined : JSON.stringify(value),
      });
    const credential = { provider: "brave", apiKey: "test-brave-key" };
    const rotation = "/server/credentials/openrouter/rotation";
    expect((await send("/server/credentials", "POST", credential)).status).toBe(403);
    expect((await send(rotation, "GET")).status).toBe(403);
    manageGuild = true;
    expect((await send("/personal/credentials", "POST", credential)).status).toBe(422);
    expect((await send("/server/credentials", "POST", credential, "invalid")).status).toBe(403);
    expect(add).not.toHaveBeenCalled();
    const invalid = await send("/server/credentials", "POST", credential);
    expect(invalid.status).toBe(422);
    expect(await invalid.text()).not.toContain(credential.apiKey);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ ...credential, serverDiscId: serverId }));
    add.mockResolvedValue({ status: "success", entryId: "brave", displayName: "Brave Search", updated: false });
    expect(await (await send("/server/credentials", "POST", credential)).json()).toEqual({ saved: true });
    expect((await send("/server/credentials/brave", "DELETE")).status).toBe(200);
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ entry: expect.objectContaining({ kind: "brave" }) }));
    const info = await send(rotation, "GET");
    expect(info.headers.get("cache-control")).toBe("no-store");
    expect(await info.json()).toEqual({ name: "OpenRouter", count: 2 });
    expect((await send(rotation, "PATCH", { action: "clear", key: "test-rotation-key" })).status).toBe(422);
    expect((await send(rotation, "PATCH", { action: "clear" }, "invalid")).status).toBe(403);
    expect(edit).not.toHaveBeenCalled();
    expect((await send(rotation, "PATCH", { action: "add", key: "test-rotation-key" })).status).toBe(200);
    expect(edit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        apiKey: "",
        rotationKey: "test-rotation-key",
        deleteRotationKeys: false,
      }),
    );
    expect((await send(rotation, "PATCH", { action: "clear" })).status).toBe(200);
    expect(edit).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: "openrouter", apiKey: "", rotationKey: "", deleteRotationKeys: true }),
    );
  });

  it("adds a model to the selected connection with its saved configuration and scope", async () => {
    const { app, headers } = setup(true);
    const guildId = "123456789012345678";
    const state = createPersona({ server_id: 42 });
    let managesGuild = false;
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({
          permissions: new PermissionsBitField(managesGuild ? PermissionFlagsBits.ManageGuild : 0n),
        }),
      },
    } as unknown as Guild);
    const entry: EndpointProviderPanelEntry = {
      id: "endpoint:81",
      kind: "endpoint",
      displayName: "Local",
      savedAt: null,
      isPreset: false,
      connectionIds: [81, 82],
      connectionDetails: [
        {
          connectionId: 81,
          endpointUrl: "https://example.invalid/v1",
          apiStyle: "openai-compatible",
          capability: "text",
          vramHandoff: null,
        },
        {
          connectionId: 82,
          endpointUrl: "https://example.invalid/workflow",
          apiStyle: "comfyui",
          capability: "image",
          vramHandoff: null,
        },
      ],
      capabilities: [],
    };
    const data = { entries: [entry], initialEntryId: entry.id, readStatus: "fresh" as const };
    const personal = spyOn(providerPanelOperations, "loadPersonalProviderPanelScope").mockResolvedValue({
      scopeKind: "personal",
      ownerId: 7,
      state,
      data,
    });
    spyOn(providerPanelOperations, "loadServerProviderPanelScope").mockResolvedValue({ state, data });
    const row = customEndpointSchema.parse({
      user_id: 7,
      server_id: null,
      connection_id: 81,
      custom_endpoint_id: 23,
      label: "Local",
      capability: "text",
      api_style: "openai-compatible",
      endpoint_url: "https://example.invalid/v1",
      model_name: "sample/already-added",
      requires_auth: true,
    });
    spyOn(llmProviderRepo, "loadCustomEndpointsByConnectionId").mockResolvedValue([row]);
    const register = spyOn(customEndpointService, "registerCustomEndpoint").mockResolvedValue({
      provider: "custom:81",
      customEndpoint: row,
      modelId: 104,
    });
    const request = (scope: string, connectionId: number, value?: unknown) =>
      app.request(`/settings/api/guilds/${guildId}/providers/${scope}/connections/${connectionId}/models`, {
        method: value === undefined ? "GET" : "POST",
        headers,
        body: value === undefined ? undefined : JSON.stringify(value),
      });

    expect((await request("server", 81, { codeName: "sample/new" })).status).toBe(403);
    expect((await request("personal", 83, { codeName: "sample/new" })).status).toBe(404);
    personal.mockResolvedValueOnce({ scopeKind: "personal", ownerId: 8, state, data });
    expect((await request("personal", 81, { codeName: "sample/new" })).status).toBe(404);
    expect(
      (await request("personal", 81, { codeName: "sample/new", endpointUrl: "https://unrelated.invalid/" })).status,
    ).toBe(422);
    expect((await request("personal", 81, { codeName: "sample/already-added" })).status).toBe(409);
    expect((await request("personal", 82, { codeName: "sample/new" })).status).toBe(422);
    expect(register).not.toHaveBeenCalled();

    const editor = await request("personal", 81);
    expect(editor.headers.get("cache-control")).toBe("no-store");
    expect(await editor.json()).toMatchObject({ capability: "text", codeName: "", flags: { seesVideos: false } });
    expect(
      (await request("personal", 81, { codeName: "sample/new", numCtx: 8192, flags: { seesVideos: true } })).status,
    ).toBe(201);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ kind: "personal", ownerId: 7 }),
        existingConnectionId: 81,
        modelName: "sample/new",
        endpointUrl: "https://example.invalid/v1",
        label: "Local",
        numCtx: 8192,
        seesVideos: true,
      }),
    );
    expect(register.mock.calls[0][0]).not.toHaveProperty("authToken");

    managesGuild = true;
    const workflow = { output: { class_type: "SaveImage" } };
    expect((await request("server", 82, { codeName: "sample/image", workflow })).status).toBe(201);
    expect(register).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scope: expect.objectContaining({ kind: "server", ownerId: 42 }),
        existingConnectionId: 82,
        apiStyle: "comfyui",
        extraConfig: expect.objectContaining({ workflow }),
      }),
    );
  });

  it("edits an owned endpoint model in place and keeps its other flags and workflow", async () => {
    const { app, headers } = setup(true);
    const serverId = "123456789012345678";
    const state = createPersona({ server_id: 42 });
    const entry: EndpointProviderPanelEntry = {
      id: "endpoint:81",
      kind: "endpoint",
      displayName: "Local",
      savedAt: null,
      isPreset: false,
      connectionIds: [81, 82],
      connectionDetails: [],
      capabilities: [],
    };
    const data = { entries: [entry], initialEntryId: entry.id, readStatus: "fresh" as const };
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({
          permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild),
        }),
      },
    } as unknown as Guild);
    spyOn(providerPanelOperations, "loadServerProviderPanelScope").mockResolvedValue({ state, data });
    spyOn(providerPanelOperations, "loadPersonalProviderPanelScope").mockResolvedValue({
      scopeKind: "personal",
      ownerId: 7,
      state,
      data,
    });
    const row = customEndpointSchema.parse({
      server_id: 42,
      user_id: null,
      connection_id: 81,
      custom_endpoint_id: 23,
      label: "Local",
      model_ref_id: 104,
      capability: "text",
      api_style: "openai-compatible",
      endpoint_url: "https://example.invalid/v1",
      model_name: "sample/text",
      requires_auth: true,
      num_ctx: 32768,
      sees_videos: true,
      supports_assistant_prefill: true,
    });
    const lookup = spyOn(llmProviderRepo, "loadCustomEndpointsByIds").mockResolvedValue([row]);
    const textWrite = spyOn(customEndpointService, "registerCustomEndpoint").mockResolvedValue({
      provider: "custom:81",
      customEndpoint: row,
      modelId: 104,
    });
    const modelWrite = spyOn(providerPanelOperations, "saveProviderModel").mockResolvedValue({
      status: "success",
      entryId: entry.id,
      codeName: "sample/image",
    });
    const request = (scope: string, connectionId: number, patch?: unknown) =>
      app.request(`/settings/api/guilds/${serverId}/providers/${scope}/connections/${connectionId}/models/23`, {
        method: patch ? "PATCH" : "GET",
        headers,
        body: patch ? JSON.stringify(patch) : undefined,
      });
    expect((await request("personal", 81, { codeName: "another model" })).status).toBe(404);
    expect((await request("server", 82, { codeName: "another model" })).status).toBe(404);
    expect((await request("server", 81, { endpointUrl: "https://unrelated.invalid/" })).status).toBe(422);
    expect(textWrite).not.toHaveBeenCalled();
    const editor = await request("server", 81);
    expect(editor.headers.get("cache-control")).toBe("no-store");
    expect(await editor.json()).toMatchObject({
      capability: "text",
      codeName: "sample/text",
      flags: { seesVideos: true },
    });
    expect((await request("server", 81, { codeName: "sample/renamed" })).status).toBe(200);
    expect(textWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        editingEndpointId: 23,
        modelName: "sample/renamed",
        numCtx: 32768,
        seesVideos: true,
        supportsAssistantPrefill: true,
      }),
    );
    lookup.mockResolvedValue([
      customEndpointSchema.parse({ ...row, capability: "image", model_name: "sample/image", api_style: "comfyui" }),
    ]);
    expect((await request("server", 81, { flags: { hasTools: true } })).status).toBe(422);
    expect(modelWrite).not.toHaveBeenCalled();
    expect((await request("server", 81, { imageSupports: ["txt2img"] })).status).toBe(200);
    expect(modelWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: "endpoint:81",
        editingModelId: 104,
        capability: "image",
        imageSupportValues: ["txt2img"],
        workflow: undefined,
      }),
    );
  });

  it("edits the scoped Discord connection group without resending an unchanged URL or saved credential", async () => {
    const { app, headers, session } = setup(true);
    const serverId = "123456789012345678";
    const base = `/settings/api/guilds/${serverId}/providers`;
    let manageGuild = false;
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({
          permissions: new PermissionsBitField(manageGuild ? PermissionFlagsBits.ManageGuild : 0n),
        }),
      },
    } as unknown as Guild);
    const entry: EndpointProviderPanelEntry = {
      kind: "endpoint",
      id: "endpoint:81",
      displayName: "local",
      savedAt: null,
      isPreset: false,
      connectionIds: [81, 82],
      capabilities: [],
      connectionDetails: [
        {
          connectionId: 81,
          endpointUrl: "https://example.invalid/v1",
          apiStyle: "openai-compatible",
          capability: "text",
          vramHandoff: null,
        },
        {
          connectionId: 82,
          endpointUrl: "https://example.invalid/v1",
          apiStyle: "openai-compatible",
          capability: "embedding",
          vramHandoff: null,
        },
      ],
    };
    const persona = createPersona({ server_id: 42 });
    const data = { entries: [entry], initialEntryId: entry.id, readStatus: "fresh" as const };
    const server = spyOn(providerPanelOperations, "loadServerProviderPanelScope").mockResolvedValue({
      state: persona,
      data,
    });
    const personal = spyOn(providerPanelOperations, "loadPersonalProviderPanelScope").mockResolvedValue({
      scopeKind: "personal",
      state: persona,
      ownerId: 7,
      data,
    });
    const write = spyOn(providerPanelOperations, "editServerEndpoint").mockResolvedValue({
      status: "success",
      entryId: entry.id,
      label: "renamed",
    });
    const patch = (scope: "server" | "personal", value: unknown, csrf = session.csrfToken, id = "82") =>
      app.request(`${base}/${scope}/connections/${id}`, {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(value),
      });
    expect((await patch("server", { label: "renamed" })).status).toBe(403);
    expect((await patch("personal", { label: "renamed" }, "invalid")).status).toBe(403);
    expect(server).not.toHaveBeenCalled();
    expect(personal).not.toHaveBeenCalled();
    expect((await patch("personal", { label: "renamed" }, session.csrfToken, "99")).status).toBe(404);
    expect((await patch("personal", { endpointUrl: "file:///etc/passwd" })).status).toBe(422);
    expect((await patch("personal", { ownerId: 99 })).status).toBe(422);
    expect(write).not.toHaveBeenCalled();
    const editor = await app.request(`${base}/personal/connections/82`, { headers });
    expect(editor.headers.get("cache-control")).toBe("no-store");
    expect(await editor.json()).toEqual({
      label: "local",
      endpointUrl: "https://example.invalid/v1",
      isPreset: false,
      unloadDuringComfyUi: false,
    });
    expect(personal).toHaveBeenCalledWith(session.user.id, serverId);
    expect(await (await patch("personal", { label: " renamed " })).json()).toEqual({ updated: true });
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scopeKind: "personal",
        ownerId: 7,
        entryId: "endpoint:81",
        label: "renamed",
        endpointUrl: "",
        authToken: "",
        unloadDuringComfyUi: undefined,
      }),
    );
    manageGuild = true;
    expect(
      (await patch("server", { endpointUrl: "https://gateway.example.invalid/v1", unloadDuringComfyUi: true })).status,
    ).toBe(200);
    expect(write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        state: persona,
        serverDiscId: serverId,
        entryId: "endpoint:81",
        label: "local",
        endpointUrl: "https://gateway.example.invalid/v1",
        authToken: "",
        unloadDuringComfyUi: true,
      }),
    );
    write.mockResolvedValue({ status: "unreachable", reason: "private upstream response", credentialsWithheld: false });
    const failed = await patch("server", { endpointUrl: "https://gateway.example.invalid/v1" });
    expect(failed.status).toBe(422);
    const error = await failed.json();
    expect(error.error.code).toBe("endpoint_edit_unreachable");
    expect(JSON.stringify(error)).not.toContain("private upstream response");
  });

  it("keeps the preset ElevenLabs name, address, and behavior outside the edit API", async () => {
    const { app, headers } = setup();
    const entry: EndpointProviderPanelEntry = {
      kind: "endpoint",
      id: "endpoint:81",
      displayName: "ElevenLabs",
      savedAt: null,
      isPreset: true,
      connectionIds: [81],
      capabilities: [],
      connectionDetails: [
        {
          connectionId: 81,
          endpointUrl: "https://api.elevenlabs.io",
          apiStyle: "elevenlabs",
          capability: "speech",
          vramHandoff: null,
        },
      ],
    };
    spyOn(providerPanelOperations, "loadPersonalProviderPanelScope").mockResolvedValue({
      scopeKind: "personal",
      state: null,
      ownerId: 7,
      data: { entries: [entry], initialEntryId: entry.id, readStatus: "fresh" },
    });
    const write = spyOn(providerPanelOperations, "editServerEndpoint").mockResolvedValue({
      status: "success",
      entryId: entry.id,
      label: "ElevenLabs",
    });
    const path = "/settings/api/guilds/123456789012345678/providers/personal/connections/81";
    const patch = (value: unknown) => app.request(path, { method: "PATCH", headers, body: JSON.stringify(value) });
    expect((await patch({ label: "renamed" })).status).toBe(409);
    expect((await patch({ endpointUrl: "https://other.example.invalid" })).status).toBe(409);
    expect((await patch({ unloadDuringComfyUi: false })).status).toBe(409);
    expect(write).not.toHaveBeenCalled();
    expect((await patch({ authToken: "replacement-token" })).status).toBe(200);
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ label: "ElevenLabs", endpointUrl: "", authToken: "replacement-token" }),
    );
  });

  it("requires current Manage Server permission for moderation reads, member search, and writes", async () => {
    const { app, headers, session } = setup(true);
    const guildId = "123456789012345678";
    const path = `/settings/api/guilds/${guildId}/moderation`;
    const memberId = "987654321098765433";
    let canManage = false;
    const fetch = mock(async () => ({
      id: session.user.id,
      permissions: new PermissionsBitField(canManage ? PermissionFlagsBits.ManageGuild : 0n),
    }));
    const search = mock(
      async () =>
        new Collection([
          [memberId, { id: memberId, displayName: "Juno", user: { bot: false, username: "juno" } }],
          [guildId, { id: guildId, displayName: "Bot", user: { bot: true, username: "bot" } }],
        ]),
    );
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      id: guildId,
      members: { fetch, search },
    } as unknown as Guild);
    const load = spyOn(moderation, "loadModerationScopeData").mockResolvedValue(null);
    const save = (token = session.csrfToken) =>
      app.request(path, {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": token },
        body: JSON.stringify({ action: "quota", quotaType: "text", dailyUserQuota: 10 }),
      });
    expect((await app.request(path, { headers })).status).toBe(403);
    expect((await app.request(`${path}/members?q=Juno`, { headers })).status).toBe(403);
    expect((await save()).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();

    canManage = true;
    expect((await save("invalid")).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith({ user: session.user.id, force: true });
    const result = await app.request(`${path}/members?q=Juno`, { headers });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ members: [{ id: memberId, name: "Juno", username: "juno" }] });
    expect(search).toHaveBeenCalledWith({ query: "Juno", limit: 15 });
  });

  it("scopes moderation edits to the selected server and delegates valid targets and quota changes", async () => {
    const { app, headers, session } = setup(true);
    const guildId = "123456789012345678";
    const roleId = "123456789012345679";
    const otherRole = "123456789012345680";
    const memberId = "987654321098765433";
    const botId = "987654321098765434";
    const path = `/settings/api/guilds/${guildId}/moderation`;
    const expiry = new Date(Date.now() + 3_600_000);
    const quota = { daily_user_quota: 0, serverwide_quota: 50, serverwide_quota_resets_in: 30 };
    const scope: moderation.ModerationScopeData = {
      guildId,
      serverId: 42,
      readStatus: "fresh",
      memberAccess: {
        serverMemteachingEnabled: false,
        promptSnapshotEnabled: false,
        personaExportEnabled: false,
      },
      serverModelAccess: { allowServerModels: true },
      userBlacklist: {
        personalizationUserIds: [memberId],
        personaBlocks: [
          {
            server_id: 42,
            persona_id: 9,
            user_disc_id: memberId,
            persona_name: "Tomori",
            block_type: "mute",
            reason: "Private context",
            expires_at: expiry,
          },
        ],
      },
      whitelist: { channels: [], personaChannels: [], roles: [], personaNames: new Map() },
      quotas: { text: quota, image: quota, video: quota },
    };
    const load = spyOn(moderation, "loadModerationScopeData").mockResolvedValue(scope);
    const guild = {
      id: guildId,
      members: {
        fetch: async ({ user }: { user: string }) =>
          user === session.user.id
            ? { permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) }
            : { user: { bot: user === botId } },
        cache: new Map([[memberId, { displayName: "Juno" }]]),
      },
      roles: {
        fetch: async (id?: string) =>
          id
            ? id === roleId
              ? { guild: { id: guildId } }
              : null
            : new Collection([
                [guildId, { id: guildId, name: "@everyone" }],
                [roleId, { id: roleId, name: "Readers" }],
              ]),
      },
    };
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue(guild as unknown as Guild);
    const allow = spyOn(moderation.moderationOperations, "addWhitelistRole").mockResolvedValue({
      status: "success",
      roleId,
    });
    const block = spyOn(moderation.moderationOperations, "addUserToBlacklist").mockResolvedValue({
      status: "success",
      targetUserId: memberId,
    });
    const lift = spyOn(moderation.moderationOperations, "removePersonaUserBlock").mockResolvedValue({
      status: "not_found",
      personaId: 9,
      targetUserId: memberId,
    });
    const save = spyOn(moderation.moderationOperations, "updateQuotaSettings").mockResolvedValue({
      status: "success",
      quotaType: "text",
      appliedFields: ["daily_user_quota"],
    });
    const request = (body: unknown) => app.request(path, { method: "PATCH", headers, body: JSON.stringify(body) });

    const response = await app.request(path, { headers });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.roles).toEqual([{ id: roleId, name: "Readers" }]);
    expect(data.serverBlocks).toEqual([{ userId: memberId, name: "Juno" }]);
    expect(data.personaBlocks).toEqual([
      {
        userId: memberId,
        name: "Juno",
        personaId: 9,
        personaName: "Tomori",
        type: "mute",
        expiresAt: expiry.toISOString(),
      },
    ]);

    expect((await request({ action: "addRole", roleId: guildId })).status).toBe(404);
    expect((await request({ action: "addRole", roleId: otherRole })).status).toBe(404);
    expect((await request({ action: "blockUser", userId: botId })).status).toBe(404);
    expect((await request({ action: "removePersonaBlock", userId: memberId, personaId: 99 })).status).toBe(200);
    expect((await request({ action: "quota", quotaType: "video", dailyUserQuota: 101 })).status).toBe(422);
    expect(allow).not.toHaveBeenCalled();
    expect(block).not.toHaveBeenCalled();
    expect(lift).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();

    expect((await request({ action: "addRole", roleId })).status).toBe(200);
    expect(allow).toHaveBeenCalledWith({ guildId, serverId: 42, roleId });
    expect((await request({ action: "blockUser", userId: memberId })).status).toBe(200);
    expect(block).toHaveBeenCalledWith({ guildId, serverId: 42, targetUserId: memberId, isBot: false });
    expect((await request({ action: "removePersonaBlock", userId: memberId, personaId: 9 })).status).toBe(200);
    expect(lift).toHaveBeenCalledWith({ guildId, serverId: 42, targetUserId: memberId, personaId: 9 });
    const saved = await request({
      action: "quota",
      quotaType: "text",
      dailyUserQuota: 10,
      serverwideQuotaResetsIn: 30,
    });
    expect(saved.status).toBe(200);
    expect(save).toHaveBeenCalledWith({
      serverId: 42,
      quotaType: "text",
      dailyUserQuota: 10,
      serverwideQuota: undefined,
      serverwideQuotaResetsIn: undefined,
    });
    expect(await saved.json()).toEqual({ quota: { ...quota, daily_user_quota: 10 } });
    load.mockResolvedValue({ ...scope, readStatus: "stale" });
    expect((await request({ action: "quota", quotaType: "image", serverwideQuota: 100 })).status).toBe(503);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps personal character references scoped to the signed-in user and requires CSRF", async () => {
    const { app, headers, session } = setup(false);
    const write = spyOn(TomoriDashboardCore.prototype, "replaceUserCharacterReference").mockResolvedValue(true);
    const read = spyOn(TomoriDashboardCore.prototype, "loadUserCharacterReference").mockResolvedValue(
      Buffer.from("image"),
    );
    const url = "/settings/api/profile/character-reference";
    expect((await app.request(url)).status).toBe(401);
    const preview = await app.request(url, { headers });
    expect(preview.status).toBe(200);
    expect(preview.headers.get("cache-control")).toBe("private, no-store");
    expect(read.mock.calls[0][1]).toBe(session.user.id);
    expect(
      (await app.request(url, { method: "DELETE", headers: { ...headers, "X-CSRF-Token": "wrong" } })).status,
    ).toBe(403);
    expect(write).not.toHaveBeenCalled();
    const invalid = new FormData();
    invalid.set("file", new File(["not an image"], "reference.txt", { type: "text/plain" }));
    const uploadHeaders = new Headers(headers);
    uploadHeaders.delete("Content-Type");
    expect((await app.request(url, { method: "PUT", headers: uploadHeaders, body: invalid })).status).toBe(422);
    expect(write).not.toHaveBeenCalled();
    expect((await app.request(url, { method: "DELETE", headers })).status).toBe(200);
    expect(write.mock.calls[0][1]).toBe(session.user.id);
    expect(write.mock.calls[0][2]).toBeNull();
    const image = new FormData();
    image.set(
      "file",
      new File([await (await app.request("/settings/assets/tomori_texture5.png")).arrayBuffer()], "reference.png", {
        type: "image/png",
      }),
    );
    const uploaded = await app.request(url, { method: "PUT", headers: uploadHeaders, body: image });
    expect(uploaded.status).toBe(200);
    expect((await uploaded.json()).hasCharacterReference).toBe(true);
    expect(write.mock.calls[1][1]).toBe(session.user.id);
    expect(write.mock.calls[1][2]?.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });

  it("filters overview channels, category metadata and allowlist IDs using the signed-in member's permissions", async () => {
    const { app, headers, session } = setup();
    const visibleId = "123456789012345679";
    const privateId = "123456789012345680";
    const categoryId = "123456789012345681";
    const path = "/settings/api/guilds/123456789012345678/overview";
    const hidden = new PermissionsBitField(0n);
    const visible = new PermissionsBitField(PermissionFlagsBits.ViewChannel);
    const parent = { id: categoryId, name: "Staff category", position: 2, permissionsFor: () => hidden };
    const member = { id: session.user.id };
    const fetchMember = mock(async () => member);
    const privatePermissions = mock(() => hidden);
    const visiblePermissions = mock(() => visible);
    const channel = (id: string, name: string, permissionsFor: () => PermissionsBitField) => ({
      id,
      name,
      type: ChannelType.GuildText,
      parentId: categoryId,
      parent,
      position: 1,
      isTextBased: () => true,
      isThread: () => false,
      permissionsFor,
    });
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: { fetch: fetchMember },
      channels: {
        cache: new Collection([
          [visibleId, channel(visibleId, "general", visiblePermissions)],
          [privateId, channel(privateId, "staff-only", privatePermissions)],
        ]),
      },
    } as unknown as Guild);
    spyOn(TomoriDashboardCore.prototype, "loadAllowedChannelIds").mockResolvedValue([privateId]);
    spyOn(TomoriDashboardCore.prototype, "loadPersonaNaming").mockResolvedValue({});

    const response = await app.request(path, { headers });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain("staff-only");
    expect(body).not.toContain(privateId);
    expect(body).not.toContain("Staff category");
    expect(body).not.toContain(categoryId);
    expect(JSON.parse(body)).toMatchObject({
      channels: [{ id: visibleId, name: "general", parentId: null, parentName: null }],
      allowedChannelIds: [],
      channelWhitelistActive: true,
    });
    expect(fetchMember).toHaveBeenCalledWith({ user: session.user.id, force: true });
    expect(visiblePermissions).toHaveBeenCalledWith(member);
    expect(privatePermissions).toHaveBeenCalledWith(member);

    privatePermissions.mockReturnValue(visible);
    const changed = await app.request(path, { headers });
    expect((await changed.json()).allowedChannelIds).toEqual([privateId]);

    fetchMember.mockRejectedValueOnce(
      new DiscordAPIError(
        { code: RESTJSONErrorCodes.UnknownMember, message: "Unknown Member" },
        RESTJSONErrorCodes.UnknownMember,
        404,
        "GET",
        "https://discord.com/api/v10/guilds/members",
        {},
      ),
    );
    const removed = await app.request(path, { headers });
    expect(removed.status).toBe(403);
    expect(await removed.text()).not.toContain(visibleId);
  });

  it("requires guild management and CSRF for channel settings", async () => {
    const member = setup(false);
    expect(
      (
        await member.app.request("/settings/api/guilds/123456789012345678/channel-settings", {
          headers: member.headers,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await member.app.request("/settings/api/guilds/123456789012345678/channel-settings", {
          method: "PATCH",
          headers: member.headers,
          body: "{}",
        })
      ).status,
    ).toBe(403);
    mock.restore();
    const admin = setup(true);
    expect(
      (
        await admin.app.request("/settings/api/guilds/123456789012345678/channel-settings", {
          method: "PATCH",
          headers: { ...admin.headers, "X-CSRF-Token": "invalid" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
  });

  it("applies global naming and language through personal operations without clearing untouched affixes", async () => {
    const { app, headers, session } = setup();
    const existing = createUserRow({
      user_id: 7,
      user_disc_id: session.user.id,
      user_nickname: "Mirri",
      suffix_override: "-san",
    });
    spyOn(TomoriDashboardCore.prototype, "loadUser")
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce({ ...existing, prefix_override: "Captain", language_pref: "ja" });
    const naming = spyOn(personalConfigOperations, "setNaming").mockResolvedValue({ status: "success" });
    const language = spyOn(personalConfigOperations, "setLanguage").mockResolvedValue({ status: "success" });
    const request = (body: unknown, csrf = session.csrfToken) =>
      app.request("/settings/api/profile", {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    expect((await request({ prefix_override: "Captain" }, "invalid")).status).toBe(403);
    expect((await request({ prefix_override: "Captain", language_pref: "unsupported" })).status).toBe(422);
    expect(naming).not.toHaveBeenCalled();
    expect(language).not.toHaveBeenCalled();
    const saved = await request({ prefix_override: "  Captain  ", language_pref: "ja" });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ profile: { prefix: "Captain", suffix: "-san", language: "ja" } });
    expect(naming).toHaveBeenCalledWith({
      userId: 7,
      userDiscId: session.user.id,
      nickname: "Mirri",
      prefix: "Captain",
      suffix: "-san",
    });
    expect(language).toHaveBeenCalledWith({ userId: 7, userDiscId: session.user.id, language: "ja" });
  });

  it("requires a saved personal fallback to enable the authenticated member's randomizer", async () => {
    const { app, headers, session } = setup();
    const setRandomizer = spyOn(personalConfigOperations, "setRandomizer")
      .mockResolvedValueOnce({ status: "requires-fallbacks" })
      .mockResolvedValueOnce({ status: "success", enabled: true });
    const request = (body: unknown, csrf = session.csrfToken) =>
      app.request("/settings/api/profile/model-randomizer", {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    expect((await request({ enabled: true }, "invalid")).status).toBe(403);
    expect((await request({ enabled: true, userId: 9 })).status).toBe(422);
    expect(setRandomizer).not.toHaveBeenCalled();
    expect((await request({ enabled: true })).status).toBe(422);
    const saved = await request({ enabled: true });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toEqual({ enabled: true });
    expect(setRandomizer).toHaveBeenLastCalledWith({ userId: 7, userDiscId: session.user.id, enabled: true });
  });

  it("toggles only the requested capability for the signed-in user and rejects unavailable models", async () => {
    const { app, headers, session } = setup();
    const toggle = spyOn(personalConfigOperations, "setCapabilityEnabled")
      .mockResolvedValueOnce({ status: "missing-model" })
      .mockResolvedValue({ status: "success" });
    const request = (body: unknown, csrf = session.csrfToken) =>
      app.request("/settings/api/profile/capability", {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    const selection = { capability: "transcription", enabled: true };
    expect((await request(selection, "invalid")).status).toBe(403);
    expect((await request({ ...selection, provider: "openrouter" })).status).toBe(422);
    expect((await request({ ...selection, capability: "decision" })).status).toBe(422);
    expect(toggle).not.toHaveBeenCalled();
    expect((await request(selection)).status).toBe(422);
    const disabled = await request({ ...selection, enabled: false });
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({ enabled: false });
    expect(toggle).toHaveBeenLastCalledWith({
      userId: 7,
      userDiscId: session.user.id,
      capability: "transcription",
      enabled: false,
    });
  });

  it("lists and changes only the member's own spotlights and only offers visible guild text channels", async () => {
    const { app, headers, session } = setup();
    const path = "/settings/api/guilds/123456789012345678/personal-spotlights";
    const visible = "123456789012345679";
    const privateChannel = "123456789012345680";
    const voiceChannel = "123456789012345681";
    const makeChannel = (id: string, name: string, type: ChannelType, canView: boolean) => ({
      id,
      name,
      type,
      parentId: null,
      isTextBased: () => true,
      isThread: () => false,
      permissionsFor: () => new PermissionsBitField(canView ? PermissionFlagsBits.ViewChannel : 0n),
    });
    const fetchMember = mock(async () => ({ id: session.user.id }));
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: { fetch: fetchMember },
      channels: {
        cache: new Collection([
          [visible, makeChannel(visible, "general", ChannelType.GuildText, true)],
          [privateChannel, makeChannel(privateChannel, "private-room", ChannelType.GuildText, false)],
          [voiceChannel, makeChannel(voiceChannel, "voice-room", ChannelType.GuildVoice, true)],
        ]),
      },
    } as unknown as Guild);
    const expiry = new Date(Date.now() + 3_600_000);
    const stored = {
      serverId: 42,
      userId: 7,
      channelDiscId: visible,
      personaIds: [9],
      autoTriggerPersonaId: null,
      expiresAt: expiry,
      createdAt: null,
      updatedAt: null,
    };
    const list = spyOn(userRepository, "getActivePersonalSpotlightsForUser").mockResolvedValue([stored]);
    const load = spyOn(userRepository, "getPersonalSpotlightStatus").mockResolvedValue(stored);
    const save = spyOn(personalConfigOperations, "setSpotlight").mockResolvedValue({ status: "success" });
    const remove = spyOn(personalConfigOperations, "removeSpotlights").mockResolvedValue({
      status: "success",
      removedCount: 1,
    });
    const request = (body: unknown, csrf = session.csrfToken) =>
      app.request(path, {
        method: "PUT",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    const selection = { channelId: visible, personaIds: [9], autoTriggerPersonaId: 9, durationHours: 0 };
    expect((await request(selection, "invalid")).status).toBe(403);
    expect(fetchMember).not.toHaveBeenCalled();
    expect((await request({ ...selection, channelId: privateChannel })).status).toBe(403);
    expect((await request({ ...selection, channelId: voiceChannel })).status).toBe(403);
    expect((await request({ ...selection, personaIds: [999] })).status).toBe(422);
    expect((await request({ ...selection, autoTriggerPersonaId: 999 })).status).toBe(422);
    expect((await request({ ...selection, userId: 8 })).status).toBe(422);
    expect(save).not.toHaveBeenCalled();
    const response = await app.request(path, { headers });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.channels.map((channel: { id: string }) => channel.id)).toEqual([visible]);
    expect(data.spotlights).toEqual([
      { channelId: visible, personaIds: [9], autoTriggerPersonaId: null, expiresAt: expiry.toISOString() },
    ]);
    expect(list).toHaveBeenCalledWith(42, 7);
    expect(fetchMember).toHaveBeenCalledWith({ user: session.user.id, force: true });
    expect((await request(selection)).status).toBe(200);
    expect(save).toHaveBeenLastCalledWith({
      serverId: 42,
      userId: 7,
      userDiscId: session.user.id,
      channelId: visible,
      personaIds: [9],
      autoTriggerPersonaId: 9,
      expiresAt: null,
    });
    expect((await request({ ...selection, durationHours: null })).status).toBe(200);
    expect(load).toHaveBeenCalledWith(42, 7, visible);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ expiresAt: expiry }));
    const removePath = `${path}/${visible}`;
    expect(
      (await app.request(removePath, { method: "DELETE", headers: { ...headers, "X-CSRF-Token": "invalid" } })).status,
    ).toBe(403);
    expect(remove).not.toHaveBeenCalled();
    expect((await app.request(removePath, { method: "DELETE", headers })).status).toBe(200);
    expect(remove).toHaveBeenCalledWith({
      serverId: 42,
      userId: 7,
      userDiscId: session.user.id,
      channelIds: [visible],
    });
  });

  it("sets or clears a single advanced server model through the Discord operation", async () => {
    const path = "/settings/api/guilds/123456789012345678/providers/server/model-targets";
    const member = setup();
    expect(
      (await member.app.request(path, { method: "PATCH", headers: member.headers, body: '{"decision":null}' })).status,
    ).toBe(403);
    mock.restore();
    const { app, headers, session } = setup(true);
    const state = createPersona({ server_id: 42 });
    spyOn(personaRepository, "loadState").mockResolvedValue(state);
    const set = spyOn(configModelOperations, "setCapabilityModel")
      .mockResolvedValueOnce({ status: "not-found" })
      .mockResolvedValue({ status: "success", modelName: "Local", reembedded: false });
    const clear = spyOn(configModelOperations, "clearCapabilityModel").mockResolvedValue({ status: "success" });
    const request = (body: unknown, csrf = session.csrfToken) =>
      app.request(path, { method: "PATCH", headers: { ...headers, "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    const endpoint = { provider: "custom:12", modelId: 8 };
    expect((await request({ speech_design: endpoint }, "invalid")).status).toBe(403);
    expect((await request({ speech_design: endpoint, decision: null })).status).toBe(422);
    expect(set).not.toHaveBeenCalled();
    expect((await request({ speech_design: { ...endpoint, provider: "custom:99" } })).status).toBe(422);
    expect((await request({ speech_design: endpoint })).status).toBe(200);
    expect(set).toHaveBeenLastCalledWith({
      tomoriState: state,
      serverDiscId: "123456789012345678",
      capability: "tts-design",
      ...endpoint,
    });
    expect((await request({ decision: null })).status).toBe(200);
    expect(clear).toHaveBeenCalledWith({
      tomoriState: state,
      serverDiscId: "123456789012345678",
      capability: "decision",
    });
  });

  it("validates and persists logit bias changes using Discord's add, import and removal operations", async () => {
    const path = "/settings/api/guilds/123456789012345678/settings/logit-bias";
    const member = setup();
    expect((await member.app.request(path, { method: "POST", headers: member.headers, body: "{}" })).status).toBe(403);
    mock.restore();
    const { app, headers, session } = setup(true);
    const state = createPersona({ server_id: 42, config: createServerConfig({ llm_logit_biases: [] }) });
    spyOn(personaRepository, "loadState").mockImplementation(async () => structuredClone(state));
    const write = spyOn(configRepository, "updateChatConfig").mockImplementation(async (_id, patch) => {
      state.config.llm_logit_biases = patch.llm_logit_biases ?? [];
      return true;
    });
    const request = (body: unknown, csrf = session.csrfToken) =>
      app.request(path, { method: "POST", headers: { ...headers, "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    const add = { action: "add", terms: "42", bias: "-5.5" };
    expect((await request(add, "invalid")).status).toBe(403);
    expect((await request({ ...add, bias: "101" })).status).toBe(422);
    expect((await request({ action: "import", payload: [{ text: "42" }] })).status).toBe(422);
    expect(write).not.toHaveBeenCalled();
    const added = await request(add);
    expect(added.status).toBe(200);
    const {
      entries: [entry],
    } = await added.json();
    expect(entry).toEqual({ id: expect.any(String), text: "42", value: -5.5, kind: "token_id" });
    const imported = await request({
      action: "import",
      payload: [
        { text: "42", value: 2 },
        { text: "43", value: 1 },
      ],
    });
    expect(imported.status).toBe(200);
    expect((await imported.json()).entries).toEqual([
      { ...entry, value: 2 },
      { id: expect.any(String), text: "43", value: 1, kind: "token_id" },
    ]);
    expect((await app.request(`${path}/missing`, { method: "DELETE", headers })).status).toBe(409);
    const removed = await app.request(`${path}/${entry.id}`, { method: "DELETE", headers });
    expect(removed.status).toBe(200);
    expect((await removed.json()).entries.map((value: { text: string }) => value.text)).toEqual(["43"]);
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("only lets server managers set or clear reviewers and compatible rule checkers", async () => {
    const path = "/settings/api/guilds/123456789012345678/settings/response-drafting";
    const member = setup();
    expect((await member.app.request(path, { headers: member.headers })).status).toBe(403);
    expect(
      (await member.app.request(path, { method: "PATCH", headers: member.headers, body: '{"checker":null}' })).status,
    ).toBe(403);
    mock.restore();
    const admin = setup(true);
    const setModel = spyOn(responseDraftingOperations, "setModel")
      .mockResolvedValueOnce("stale")
      .mockResolvedValue("success");
    const setChecker = spyOn(responseDraftingOperations, "setChecker").mockResolvedValue("success");
    const request = (body: unknown, csrf = admin.session.csrfToken) =>
      admin.app.request(path, {
        method: "PATCH",
        headers: { ...admin.headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    const reviewer = { id: 12, provider: "openrouter" };
    const checker = { scope: "workspace", registrationId: 3, toolName: "check_slop" };
    expect((await request({ checker }, "invalid")).status).toBe(403);
    expect((await request({ reviewer, checker })).status).toBe(422);
    expect(setModel).not.toHaveBeenCalled();
    expect(setChecker).not.toHaveBeenCalled();
    expect((await request({ reviewer })).status).toBe(422);
    expect((await request({ reviewer: null })).status).toBe(200);
    expect(setModel).toHaveBeenLastCalledWith(
      expect.objectContaining({ server_id: 42 }),
      "123456789012345678",
      "",
      null,
    );
    expect((await request({ checker })).status).toBe(200);
    expect(setChecker).toHaveBeenLastCalledWith(
      expect.objectContaining({ server_id: 42 }),
      "123456789012345678",
      checker,
    );
  });

  it("keeps instance administrators separate from guild permissions", async () => {
    const previous = process.env.WEB_SETTINGS_GLOBAL_ADMIN_IDS;
    try {
      for (const [ids, canManage, expected] of [
        ["", true, false],
        ["123456789012345678, 987654321098765432", false, true],
        ["987654321098765432x", true, false],
      ] as const) {
        process.env.WEB_SETTINGS_GLOBAL_ADMIN_IDS = ids;
        const { app, headers } = setup(canManage);
        const response = await app.request("/settings/api/session", { headers });
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.user.isGlobalAdmin).toBe(expected);
        expect(payload.guilds[0].canManage).toBe(canManage);
        expect(payload.globalAdminIds).toBeUndefined();
        mock.restore();
      }
    } finally {
      if (previous === undefined) delete process.env.WEB_SETTINGS_GLOBAL_ADMIN_IDS;
      else process.env.WEB_SETTINGS_GLOBAL_ADMIN_IDS = previous;
    }
  });

  it("validates custom statistics dates and forwards the inclusive range", async () => {
    const { app, headers } = setup();
    const load = spyOn(TomoriDashboardCore.prototype, "loadServerStats").mockResolvedValue({} as DashboardServerStats);
    const base = "/settings/api/guilds/123456789012345678/stats?timeframe=custom";
    for (const query of [
      "",
      "&from=2024-02-30&through=2024-03-01",
      "&from=2024-03-01&through=2024-02-29",
      "&from=2024-01-01&through=9999-01-01",
      "&from=2024-1-01&through=2024-02-01",
    ]) {
      expect((await app.request(base + query, { headers })).status).toBe(400);
    }
    expect(load).not.toHaveBeenCalled();
    const response = await app.request(`${base}&from=2024-02-29&through=2024-03-01`, { headers });
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith(expect.anything(), "custom", { from: "2024-02-29", through: "2024-03-01" });
  });

  it("reports duplicate, invalid and failed import entries without hiding partial writes or exposing errors", async () => {
    const { app, headers } = setup();
    const rows: PersonalMemoryRow[] = [
      personalMemorySchema.parse({
        personal_memory_id: 1,
        user_id: 7,
        persona_lineage_id: 77,
        content: "Existing fact",
        tags: [],
      }),
    ];
    const list = spyOn(TomoriDashboardCore.prototype, "listPersonalMemories").mockImplementation(async () => rows);
    const internalError = new Error("Private database connection details");
    const write = spyOn(TomoriDashboardCore.prototype, "addPersonalMemory").mockImplementation(
      async (_userId, lineageId, content, tags) => {
        if (content === "Database failure") throw internalError;
        if (content === "Limit reached") return null;
        const row = personalMemorySchema.parse({
          personal_memory_id: 2,
          user_id: 7,
          persona_lineage_id: lineageId,
          content,
          tags,
          manually_written: true,
        });
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

  it("refuses server memory transfers without reading or writing scoped memories", async () => {
    const { app, headers } = setup(true);
    const list = spyOn(TomoriDashboardCore.prototype, "listServerMemories").mockResolvedValue([]);
    const write = spyOn(TomoriDashboardCore.prototype, "addServerMemory").mockResolvedValue(null);
    const exportResponse = await app.request(
      "/settings/api/guilds/123456789012345678/memories/export?kind=server&lineageId=77",
      { headers },
    );
    const importResponse = await app.request("/settings/api/guilds/123456789012345678/memories/import", {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "server", lineageId: 77, memories: [{ content: "Fact", tags: ["legacy"] }] }),
    });
    for (const response of [exportResponse, importResponse]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "server_memory_transfer_unavailable" } });
    }
    expect(list).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
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

  it("allows lorebook reads and restricts writes to administrators with CSRF", async () => {
    const path = "/settings/api/guilds/123456789012345678/lorebooks";
    const member = setup();
    const list = spyOn(DashboardLorebookService.prototype, "list").mockResolvedValue({ books: [], entries: [] });
    const write = spyOn(DashboardLorebookService.prototype, "book").mockResolvedValue({ status: "success", bookId: 2 });
    expect((await member.app.request(`${path}?lineageId=0`, { headers: member.headers })).status).toBe(200);
    expect(
      (
        await member.app.request(`${path}/books`, {
          method: "POST",
          headers: member.headers,
          body: JSON.stringify({ name: "World" }),
        })
      ).status,
    ).toBe(403);
    const admin = setup(true);
    const request = (csrf: string) =>
      admin.app.request(`${path}/books`, {
        method: "POST",
        headers: { ...admin.headers, "X-CSRF-Token": csrf },
        body: JSON.stringify({ name: "World" }),
      });
    expect((await request("invalid")).status).toBe(403);
    expect((await request(admin.session.csrfToken)).status).toBe(200);
    expect(list).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("routes lorebook content edits only for administrators with CSRF", async () => {
    const path = "/settings/api/guilds/123456789012345678/lorebooks/entries/5/content";
    const body = { lineageId: 0, bookId: 2, title: "Place", content: "Details" };
    const member = setup();
    const write = spyOn(DashboardLorebookService.prototype, "entry").mockResolvedValue({ status: "success" });
    expect(
      (await member.app.request(path, { method: "PATCH", headers: member.headers, body: JSON.stringify(body) })).status,
    ).toBe(403);
    const admin = setup(true);
    const request = (csrf: string) =>
      admin.app.request(path, {
        method: "PATCH",
        headers: { ...admin.headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    expect((await request("invalid")).status).toBe(403);
    expect((await request(admin.session.csrfToken)).status).toBe(200);
    expect(write).toHaveBeenCalledWith(expect.anything(), expect.anything(), 5, "content", body, expect.any(Set));
    const keys = { lineageId: 0, bookId: 2, keys: [] };
    expect(
      (
        await admin.app.request(path.replace(/content$/, "keys"), {
          method: "PATCH",
          headers: admin.headers,
          body: JSON.stringify(keys),
        })
      ).status,
    ).toBe(200);
    expect(write).toHaveBeenCalledWith(expect.anything(), expect.anything(), 5, "keys", keys, expect.any(Set));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("localizes lorebook failures without exposing internal error text", async () => {
    const { app, headers } = setup(true);
    const list = spyOn(DashboardLorebookService.prototype, "list");
    for (const [code, status, suffix] of [
      ["lorebook_too_large", 413, "too_large"],
      ["lorebook_limit", 422, "limit"],
      ["lorebook_exists", 422, "exists"],
      ["lorebook_missing", 404, "missing"],
      ["lorebook_unavailable", 503, "unavailable"],
      ["invalid_lorebook_channel", 422, "channel"],
      ["forbidden", 403, "forbidden"],
      ["invalid_lorebook", 422, "invalid"],
      ["lorebook_failed", 500, "failed"],
    ] as const) {
      list.mockRejectedValueOnce(new DashboardServiceError(code, status, "Internal detail"));
      const response = await app.request("/settings/api/guilds/123456789012345678/lorebooks?lineageId=0", {
        headers,
      });
      expect(response.status).toBe(status);
      expect(await response.json()).toMatchObject({
        error: { code, message: localizedCopy("en-US", `general.dashboard.lorebook_error_${suffix}`) },
      });
    }
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
    expect((await request({ ...body, capability: "transcription" })).status).toBe(200);
    expect(write).toHaveBeenCalledWith(7, session.user.id, "transcription", "openrouter", 11);
    expect((await request(body, "invalid")).status).toBe(403);
    expect((await request({ ...body, userId: 99 })).status).toBe(422);
    session.guildCache = { fetchedAt: Date.now(), guilds: [] };
    expect((await request(body)).status).toBe(403);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("restricts Humanizer overrides to a persona in the managed server and supports inheritance", async () => {
    const { app, headers, session } = setup(true);
    const write = spyOn(configPersonaOperations, "setHumanizerOverride").mockResolvedValue({ status: "success" });
    const request = (personaId: number, override: unknown, csrf = session.csrfToken) =>
      app.request(`/settings/api/guilds/123456789012345678/personas/${personaId}/humanizer`, {
        method: "PATCH",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify({ override }),
      });
    const override = humanizerSettingsFromDegree(2);
    expect((await request(9, override, "invalid")).status).toBe(403);
    expect((await request(99, override)).status).toBe(404);
    expect((await request(9, { humanizer_streaming_enabled: true })).status).toBe(422);
    expect(write).not.toHaveBeenCalled();

    expect((await request(9, override)).status).toBe(200);
    expect((await request(9, null)).status).toBe(200);
    expect(write.mock.calls.map(([input]) => input.value)).toEqual([override, null]);
    const guild = session.guildCache?.guilds[0];
    if (!guild) throw new Error("Missing test guild");
    guild.canManage = false;
    expect((await request(9, override)).status).toBe(403);
    expect(write).toHaveBeenCalledTimes(2);
    guild.canManage = true;
    write.mockRestore();
    const invalid = await request(9, { ...override, humanizer_streaming_enabled: false });
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toMatchObject({ error: { code: "invalid_humanizer" } });
  });

  it("edits a persona's naming habits through the Discord operation without writing personal overrides", async () => {
    const { app, headers, namingWrite, session } = setup(true);
    let liveManager = false;
    const fetch = mock(async () => ({
      permissions: new PermissionsBitField(liveManager ? PermissionFlagsBits.ManageGuild : 0n),
    }));
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({ members: { fetch } } as unknown as Guild);
    const write = spyOn(configPersonaOperations, "setNamingHabits").mockResolvedValue({
      status: "success",
      style: "neutral",
    });
    const path = "/settings/api/guilds/123456789012345678/personas";
    const request = (id: number, body: unknown, csrf = session.csrfToken) =>
      app.request(`${path}/${id}/naming-habits`, {
        method: "PUT",
        headers: { ...headers, "X-CSRF-Token": csrf },
        body: JSON.stringify(body),
      });
    const values = { style: "neutral", prefix: "Friend", suffix: "", addressTerm: "companion" };
    expect((await request(9, values)).status).toBe(403);
    expect(fetch).toHaveBeenCalledWith({ user: session.user.id, force: true });
    liveManager = true;
    expect((await request(9, values, "invalid")).status).toBe(403);
    expect((await request(99, values)).status).toBe(404);
    expect((await request(9, { ...values, style: "other" })).status).toBe(422);
    expect((await request(9, { ...values, suffix: "x".repeat(101) })).status).toBe(422);
    expect(write).not.toHaveBeenCalled();
    const response = await request(9, { ...values, prefix: " Friend " });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ values });
    expect(write).toHaveBeenCalledWith({
      ...values,
      serverDiscId: "123456789012345678",
      persona: expect.objectContaining({ persona_id: 9, server_id: 42 }),
    });
    write.mockResolvedValue({ status: "invalid-config" });
    expect((await request(9, { ...values, addressTerm: "" })).status).toBe(422);
    expect(namingWrite).not.toHaveBeenCalled();
  });

  it("validates persona reference and ATTG changes before writing through their Discord repositories", async () => {
    const { app, headers } = setup(true);
    let isManager = false;
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({ permissions: new PermissionsBitField(isManager ? PermissionFlagsBits.ManageGuild : 0n) }),
      },
    } as unknown as Guild);
    const clear = spyOn(configPersonaOperations, "replaceCharacterReference").mockResolvedValue({
      status: "success",
      cleared: true,
    });
    const writeReference = spyOn(personaRepository, "setCharRef").mockResolvedValue(true);
    const writeAttg = spyOn(personaRepository, "setNaiAttg").mockResolvedValue(true);
    const base = "/settings/api/guilds/123456789012345678/personas";
    const fields = {
      nai_attg_author: " Juno ",
      nai_attg_title: "",
      nai_attg_tags: "  ",
      nai_attg_genre: "Fantasy",
      nai_attg_stars: 4,
    };
    const saveAttg = (id: number, value: unknown) =>
      app.request(`${base}/${id}/attg`, { method: "PUT", headers, body: JSON.stringify(value) });
    const { "Content-Type": _contentType, ...uploadHeaders } = headers;
    const upload = new FormData();
    upload.set("file", new File(["not an image"], "reference.png", { type: "image/png" }));
    expect((await app.request(`${base}/9/character-reference`, { headers })).status).toBe(403);
    expect((await saveAttg(9, fields)).status).toBe(403);
    isManager = true;
    expect(
      (await app.request(`${base}/9/character-reference`, { method: "PUT", headers: uploadHeaders, body: upload }))
        .status,
    ).toBe(422);
    expect(
      (
        await app.request(`${base}/9/character-reference`, {
          method: "PUT",
          headers: uploadHeaders,
          body: new FormData(),
        })
      ).status,
    ).toBe(422);
    expect((await saveAttg(99, fields)).status).toBe(404);
    expect((await saveAttg(9, { ...fields, nai_attg_stars: 6 })).status).toBe(422);
    expect(writeAttg).not.toHaveBeenCalled();
    expect(writeReference).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    const reference = await app.request(`${base}/9/character-reference`, { method: "DELETE", headers });
    expect(await reference.json()).toEqual({ hasCharacterReference: false });
    expect(clear).toHaveBeenCalledWith({
      persona: expect.objectContaining({ persona_id: 9 }),
      serverDiscId: "123456789012345678",
      attachment: null,
    });
    expect((await saveAttg(9, fields)).status).toBe(200);
    expect(writeAttg).toHaveBeenCalledWith(9, {
      ...fields,
      nai_attg_author: "Juno",
      nai_attg_title: null,
      nai_attg_tags: null,
    });
  });

  it("keeps voice inputs independent and accepts only samples belonging to the selected server", async () => {
    const { app, headers } = setup(true);
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: { fetch: async () => ({ permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) }) },
    } as unknown as Guild);
    const snapshot = await new TomoriDashboardCore().loadGuildSnapshot("123456789012345678");
    if (!snapshot) throw new Error("Expected guild fixture");
    Object.assign(snapshot.rawPersonas[0], {
      speech_voice_sample_id: 10,
      speech_voice_id: "saved-provider-voice",
      speech_voice_name: "Quiet narration",
      speech_voice_design_prompt: "Softly spoken.",
    });
    spyOn(speechTargets, "resolveSpeechTargets").mockResolvedValue({ design: null, clone: null });
    const samples = spyOn(speechRepository, "loadVoiceSamples").mockResolvedValue([
      {
        sample_id: 11,
        server_id: 42,
        name: "Bright conversation",
        file_path: "sample.wav",
        ref_text: "Hi there",
        duration_ms: 900,
        created_at: new Date(),
      },
    ]);
    const write = spyOn(personaRepository, "setVoiceConfig").mockResolvedValue(true);
    const path = "/settings/api/guilds/123456789012345678/personas/9/voice";
    const patch = (body: unknown, csrf = headers["X-CSRF-Token"]) =>
      app.request(path, { method: "PATCH", headers: { ...headers, "X-CSRF-Token": csrf }, body: JSON.stringify(body) });
    expect((await patch({ priority: "clone" }, "invalid")).status).toBe(403);
    expect((await patch({ assignment: { mode: "sample", id: 99 } })).status).toBe(409);
    expect((await patch({ assignment: { mode: "elevenlabs", id: "unavailable" } })).status).toBe(409);
    expect(write).not.toHaveBeenCalled();
    expect((await patch({ priority: "clone" })).status).toBe(200);
    expect(write).toHaveBeenLastCalledWith(9, {
      speech_voice_sample_id: 10,
      speech_voice_id: "saved-provider-voice",
      speech_voice_name: "Quiet narration",
      speech_voice_design_prompt: "Softly spoken.",
      voice_source_priority: "clone",
    });
    expect((await patch({ designPrompt: " ", assignment: { mode: "sample", id: 11 } })).status).toBe(200);
    expect(samples).toHaveBeenCalledWith(42);
    expect(write).toHaveBeenLastCalledWith(
      9,
      expect.objectContaining({
        speech_voice_sample_id: 11,
        speech_voice_id: "saved-provider-voice",
        speech_voice_name: "Bright conversation",
        speech_voice_design_prompt: null,
      }),
    );
  });

  it("exports only an authorized persona as an importable JSON or PNG card", async () => {
    const { app, headers } = setup(true);
    const guildId = "123456789012345678";
    const root = `/settings/api/guilds/${guildId}/personas`;
    let canManage = false;
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({ permissions: new PermissionsBitField(canManage ? PermissionFlagsBits.ManageGuild : 0n) }),
      },
    } as unknown as Guild);
    const snapshot = await new TomoriDashboardCore().loadGuildSnapshot(guildId);
    if (!snapshot) throw new Error("Expected guild fixture");
    const avatarUrl = "data/avatars/servers/123456789012345678/personas/9/avatar.png";
    Object.assign(snapshot.rawPersonas[0], { is_alter: true, webhook_avatar_url: avatarUrl });
    const preset = presetExportSchema.parse({
      version: PRESET_EXPORT_VERSION,
      type: "preset",
      exported_at: new Date().toISOString(),
      data: {
        tomori_nickname: "Mirri",
        attribute_list: ["Studies the stars."],
        attribute_public_flags: [false],
        sample_dialogues_in: [],
        sample_dialogues_out: [],
        trigger_words: ["Mirri"],
      },
    });
    const exportData = spyOn(presetRepository, "exportPresetData").mockResolvedValue({ success: true, data: preset });
    const avatar = spyOn(avatarStorage, "loadStoredPersonaAvatarBuffer").mockResolvedValue(tinyPersonaAvatar);
    expect((await app.request(`${root}/9/export?format=json`)).status).toBe(401);
    expect((await app.request(`${root}/9/export?format=json`, { headers })).status).toBe(403);
    canManage = true;
    expect((await app.request(`${root}/10/export?format=json`, { headers })).status).toBe(404);
    expect((await app.request(`${root}/9/export?format=zip`, { headers })).status).toBe(422);
    expect(exportData).not.toHaveBeenCalled();

    const json = await app.request(`${root}/9/export?format=json`, { headers });
    expect(json.status).toBe(200);
    expect(json.headers.get("Content-Disposition")).toMatch(/^attachment; filename="tomori-preset-Mirri-\d+\.json"$/i);
    expect(json.headers.get("Cache-Control")).toBe("private, no-store");
    expect(presetExportSchema.parse(await json.json())).toEqual(preset);
    expect(avatar).not.toHaveBeenCalled();

    const png = await app.request(`${root}/9/export?format=png`, { headers });
    expect(png.status).toBe(200);
    expect(png.headers.get("Content-Type")).toBe("image/png");
    expect(png.headers.get("Content-Disposition")).toMatch(/\.png"$/);
    expect(extractMetadataFromPNG(Buffer.from(await png.arrayBuffer()))).toEqual(preset);
    expect(exportData).toHaveBeenLastCalledWith(guildId, 9);
    expect(avatar).toHaveBeenCalledWith(avatarUrl);
  });

  it("reviews an official main-persona switch before applying Discord's preset pointer operation", async () => {
    const { app, headers } = setup(true);
    const guildId = "123456789012345678";
    const path = `/settings/api/guilds/${guildId}/personas/main/replacement`;
    const nickname = mock(async () => null);
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        me: { setNickname: nickname },
        fetch: async () => ({ permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) }),
      },
    } as unknown as Guild);
    const snapshot = await new TomoriDashboardCore().loadGuildSnapshot(guildId);
    if (!snapshot) throw new Error("Expected guild fixture");
    const main = snapshot.rawPersonas[0];
    const preset = {
      persona_preset_id: 13,
      persona_preset_name: "Juno",
      persona_preset_desc: "Catalog description",
      preset_lineage_id: 88,
      preset_language: "en-US",
      preset_attribute_list: [],
      preset_attribute_public_flags: [],
      preset_sample_dialogues_in: [],
      preset_sample_dialogues_out: [],
      preset_trigger_words: [],
      preset_naming_config: EMPTY_PERSONA_NAMING_CONFIG,
      is_nsfw: false,
      natural_nudge_interests: [],
      natural_nudge_talkativeness: 2,
      natural_nudge_idle_nudges: [],
    } satisfies TomoriPresetRow;
    spyOn(configRepository, "loadPresetRowsByLocale").mockResolvedValue([preset]);
    const listLore = spyOn(lorebookRepository, "listScope").mockResolvedValue({ status: "fresh", entries: [] });
    const apply = spyOn(personaRepository, "applyPresetPointerToPersona").mockResolvedValue(main);
    const importCard = spyOn(presetRepository, "importPresetData");
    spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([]);
    spyOn(personaRepository, "markServerMainAvatarSynced").mockResolvedValue(undefined);
    spyOn(guildIdentity, "setGuildBotAvatar").mockResolvedValue({ success: true });
    const request = (method: "POST" | "PUT", revision?: string) =>
      app.request(path, {
        method,
        headers: { Cookie: headers.Cookie, "X-CSRF-Token": headers["X-CSRF-Token"] },
        body: new URLSearchParams({ source: "preset", presetId: "13", ...(revision ? { revision } : {}) }),
      });
    expect(await (await app.request(path, { headers })).json()).toEqual({ presets: [{ id: "13", name: "Juno" }] });
    expect((await request("PUT")).status).toBe(409);
    const review = await request("POST");
    expect(review.status).toBe(200);
    const plan = await review.json();
    expect(plan).toMatchObject({
      sourceName: "Juno",
      currentLineageId: main.persona_lineage_id,
      targetLineageId: 88,
      incomingLoreCount: null,
    });
    expect(apply).not.toHaveBeenCalled();
    expect((await request("PUT", plan.revision)).status).toBe(200);
    expect(listLore).toHaveBeenCalledWith(42, 88);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ personaId: 9, personaLineageId: 88, preset }));
    expect(importCard).not.toHaveBeenCalled();
  });

  it("requires a fresh review before a card can replace a shared lineage lorebook", async () => {
    const { app, headers } = setup(true);
    const guildId = "123456789012345678";
    const path = `/settings/api/guilds/${guildId}/personas/main/replacement`;
    let canManage = true;
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({ permissions: new PermissionsBitField(canManage ? PermissionFlagsBits.ManageGuild : 0n) }),
      },
    } as unknown as Guild);
    const snapshot = await new TomoriDashboardCore().loadGuildSnapshot(guildId);
    if (!snapshot) throw new Error("Expected guild fixture");
    snapshot.rawPersonas.push(
      createPersona({
        server_id: 42,
        persona_id: 10,
        persona_lineage_id: 88,
        persona_nickname: "Juno",
        is_alter: true,
      }),
    );
    const entry = lorebookEntryRowSchema.parse({
      entry_id: 5,
      server_id: 42,
      persona_lineage_id: 88,
      title: "Place",
      content: "Details",
      keys: ["place"],
      secondary_keys: [],
      selective_logic: 0,
      scan_depth: 5,
      trigger_chance: 100,
      insertion_order: 100,
      placement: 0,
      constant: false,
      enabled: true,
      channel_disc_ids: [],
    });
    const listLore = spyOn(lorebookRepository, "listScope").mockResolvedValue({ status: "fresh", entries: [entry] });
    const importCard = spyOn(presetRepository, "importPresetData").mockResolvedValue({
      success: true,
      mainPersonaIsPointer: false,
      itemsImported: { nickname: "Bau", attributeCount: 0, dialogueCount: 0, triggerWordCount: 0 },
    });
    spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([]);
    spyOn(personaSpriteRepository, "deleteAllForPersona").mockResolvedValue([]);
    spyOn(guildIdentity, "setGuildBotNickname").mockResolvedValue({ success: true });
    const makeCard = (lorebook_entries?: []) =>
      presetExportSchema.parse({
        type: "preset",
        version: PRESET_EXPORT_VERSION,
        exported_at: new Date(0).toISOString(),
        data: {
          tomori_nickname: "Bau",
          persona_lineage_id: 88,
          attribute_list: [],
          sample_dialogues_in: [],
          sample_dialogues_out: [],
          trigger_words: [],
          lorebook_entries,
        },
      });
    const request = (
      method: "POST" | "PUT",
      card = makeCard([]),
      identityMode = "preserve",
      revision?: string,
      csrf = headers["X-CSRF-Token"],
      file = new File([JSON.stringify(card)], "persona.json", { type: "application/json" }),
    ) => {
      const body = new FormData();
      body.set("source", "card");
      body.set("identityMode", identityMode);
      body.set("file", file);
      if (revision) body.set("revision", revision);
      return app.request(path, { method, headers: { Cookie: headers.Cookie, "X-CSRF-Token": csrf }, body });
    };
    const plan = await (await request("POST")).json();
    expect(plan).toMatchObject({
      targetLineageId: 88,
      existingLoreCount: 1,
      incomingLoreCount: 0,
      sharedPersonas: ["Juno"],
    });
    const keep = await (await request("POST", makeCard())).json();
    expect(keep.incomingLoreCount).toBeNull();
    const fork = await (await request("POST", makeCard([]), "fork")).json();
    expect(fork).toMatchObject({ targetLineageId: null, existingLoreCount: 0, sharedPersonas: [] });
    canManage = false;
    expect((await request("PUT", makeCard([]), "preserve", plan.revision)).status).toBe(403);
    canManage = true;
    expect((await request("PUT", makeCard([]), "preserve", plan.revision, "invalid")).status).toBe(403);
    expect((await request("PUT", makeCard(), "preserve", plan.revision)).status).toBe(409);
    listLore.mockResolvedValue({ status: "fresh", entries: [{ ...entry, content: "Edited after review" }] });
    expect((await request("PUT", makeCard([]), "preserve", plan.revision)).status).toBe(409);
    expect(importCard).not.toHaveBeenCalled();
    const current = await (await request("POST")).json();
    expect((await request("PUT", makeCard([]), "preserve", current.revision)).status).toBe(200);
    expect(importCard).toHaveBeenCalledWith(
      guildId,
      expect.objectContaining({ persona_lineage_id: 88, lorebook_entries: [] }),
      "preserve",
    );
    const savedAvatarUrl = "data/avatars/servers/123456789012345678/personas/9/new.png";
    const uploadAvatar = spyOn(avatarStorage, "uploadPersonaAvatarToStorage").mockResolvedValue(savedAvatarUrl);
    const saveAvatar = spyOn(personaRepository, "setAvatar").mockResolvedValue(true);
    const discordAvatar = spyOn(guildIdentity, "setGuildBotAvatar").mockResolvedValue({ success: true });
    const card = makeCard();
    const png = new File([new Uint8Array(embedMetadataInPNG(tinyPersonaAvatar, card))], "persona.png", {
      type: "image/png",
    });
    const pngRequest = (method: "POST" | "PUT", revision?: string) =>
      request(method, card, "fork", revision, undefined, png);
    const pngPlan = await (await pngRequest("POST")).json();
    expect(pngPlan.targetLineageId).toBeNull();
    expect(uploadAvatar).not.toHaveBeenCalled();
    expect((await pngRequest("PUT", pngPlan.revision)).status).toBe(200);
    expect(importCard).toHaveBeenLastCalledWith(guildId, expect.objectContaining({ persona_lineage_id: 88 }), "fork");
    expect(saveAvatar).toHaveBeenCalledWith(9, savedAvatarUrl);
    expect(discordAvatar).toHaveBeenCalledWith(guildId, expect.stringMatching(/^data:image\/png;base64,/));
  });

  it("rejects stale preset confirmation and uses Discord's resync operation for the reviewed identity", async () => {
    const { app, headers } = setup(true);
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: { fetch: async () => ({ permissions: new PermissionsBitField(PermissionFlagsBits.ManageGuild) }) },
    } as unknown as Guild);
    const snapshot = await new TomoriDashboardCore().loadGuildSnapshot("123456789012345678");
    if (!snapshot) throw new Error("Expected guild fixture");
    const persona = snapshot.rawPersonas[0];
    Object.assign(persona, {
      is_pointer: false,
      preset_lineage_id: 4,
      preset_language: "en-US",
      persona_prompt: "Original description",
    });
    const preset = {
      persona_preset_id: 1,
      persona_preset_name: "Juno",
      persona_preset_desc: "Default description",
      preset_lineage_id: 4,
      preset_attribute_list: [],
      preset_attribute_public_flags: [],
      preset_sample_dialogues_in: [],
      preset_sample_dialogues_out: [],
      preset_language: "en-US",
      preset_trigger_words: [],
      preset_naming_config: EMPTY_PERSONA_NAMING_CONFIG,
      is_nsfw: false,
      natural_nudge_interests: [],
      natural_nudge_talkativeness: 2,
      natural_nudge_idle_nudges: [],
    };
    const load = spyOn(configRepository, "loadPresetByReference").mockResolvedValue(preset);
    spyOn(naturalNudgePanelDependencies, "loadPersonaConfig").mockResolvedValue(null);
    spyOn(personaSpriteRepository, "listForPersona").mockResolvedValue([]);
    const resync = spyOn(configPersonaOperations, "resyncToPreset").mockResolvedValue({
      status: "success",
      avatarSynced: false,
    });
    const path = "/settings/api/guilds/123456789012345678/personas/9/preset";
    const preview = async () =>
      (await app.request(path, { headers })).json() as Promise<{ revision: string; name: string }>;
    const confirm = (revision: string) =>
      app.request(`${path}/resync`, { method: "POST", headers, body: JSON.stringify({ revision }) });
    const first = await preview();
    expect(first.name).toBe(preset.persona_preset_name);
    persona.persona_prompt = "Changed after reviewing";
    expect((await confirm(first.revision)).status).toBe(409);
    expect(resync).not.toHaveBeenCalled();
    expect(await (await confirm((await preview()).revision)).json()).toEqual({ avatarSynced: false });
    expect(load).toHaveBeenCalledWith(4, "en-US");
    expect(resync).toHaveBeenCalledWith(
      expect.objectContaining({ persona, preset, guildIdentity: expect.any(Object) }),
    );
  });

  it("lets current managers remove only a conditioning group from the selected persona's current history", async () => {
    const { app, headers, session } = setup(true);
    let liveManager = false;
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({
          permissions: new PermissionsBitField(liveManager ? PermissionFlagsBits.ManageGuild : 0n),
        }),
      },
    } as unknown as Guild);
    const group = {
      conditioningType: "reward" as const,
      actionKey: "headpat",
      reasonText: "Welcomed a new member.",
      reasonNormalized: "welcomed a new member.",
      actionText: null,
      totalCount: 1,
      updatedAt: new Date(),
      userDiscIds: [session.user.id],
      personaActors: [],
      conditioningIds: [15],
    };
    const read = spyOn(conditioningMemoryRepository, "loadGroupsForPersona").mockResolvedValue([
      group,
      { ...group, reasonText: "", reasonNormalized: "", conditioningIds: [16] },
    ]);
    const remove = spyOn(configPersonaOperations, "removeConditioning").mockResolvedValue({
      status: "success",
      deletedRows: 1,
    });
    const path = "/settings/api/guilds/123456789012345678/personas/9/conditioning";
    const deleteEntry = (id: string, csrf = session.csrfToken) =>
      app.request(`${path}/${id}`, { method: "DELETE", headers: { ...headers, "X-CSRF-Token": csrf } });
    expect((await app.request(path, { headers })).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    liveManager = true;
    expect((await app.request(path.replace("/9/", "/99/"), { headers })).status).toBe(404);
    const response = await app.request(path, { headers });
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.entries).toEqual([
      { id: expect.any(String), type: "reward", action: "headpat", reason: group.reasonText, count: 1 },
    ]);
    expect(read).toHaveBeenCalledWith(42, 100);
    const id = data.entries[0].id;
    expect((await deleteEntry(id, "invalid")).status).toBe(403);
    read.mockResolvedValue([{ ...group, totalCount: 2 }]);
    expect((await deleteEntry(id)).status).toBe(409);
    expect(remove).not.toHaveBeenCalled();
    read.mockResolvedValue([group]);
    expect((await deleteEntry(id)).status).toBe(200);
    expect(remove).toHaveBeenCalledWith({
      serverId: 42,
      personaLineageId: 100,
      groups: [{ conditioningType: "reward", actionKey: "headpat", reasonNormalized: group.reasonNormalized }],
    });
  });

  it("restricts persona nudges to current managers, the selected guild and valid changes", async () => {
    const { app, headers, session } = setup(true);
    let liveManager = false;
    spyOn(fakeClient.guilds.cache, "get").mockReturnValue({
      members: {
        fetch: async () => ({
          permissions: new PermissionsBitField(liveManager ? PermissionFlagsBits.ManageGuild : 0n),
        }),
      },
    } as unknown as Guild);
    const read = spyOn(naturalNudgePanelDependencies, "loadPersonaConfig").mockResolvedValue({
      persona_id: 9,
      talkativeness: 2,
      interests: [{ label: "Constellations", description: "Which ones are visible from town." }],
      idle_nudges: [],
      disabled_idle_nudge_ids: [],
      has_override: true,
      idle_nudges_override: false,
      idle_nudges_inherited: false,
    });
    const write = spyOn(naturalNudgePanelDependencies.operations, "setTalkativeness").mockResolvedValue("success");
    const path = "/settings/api/guilds/123456789012345678/personas/9/nudges";
    const patch = (level: number, csrf = session.csrfToken) =>
      app.request(path, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ action: "talkativeness", level }),
      });
    expect((await app.request(path, { headers })).status).toBe(403);
    expect((await patch(3)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    liveManager = true;
    expect((await app.request(path.replace("/9/", "/999/"), { headers })).status).toBe(404);
    expect((await patch(3, "invalid")).status).toBe(403);
    expect((await patch(5)).status).toBe(422);
    expect(write).not.toHaveBeenCalled();
    const response = await app.request(path, { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      level: 2,
      interests: [{ label: "Constellations", revision: expect.any(String) }],
    });
    expect((await patch(3)).status).toBe(200);
    expect(write).toHaveBeenCalledWith(9, 3);
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
