import type { Client, GuildBasedChannel } from "discord.js";
import { resolve } from "node:path";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { log } from "@/utils/misc/logger";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  DashboardSessionStore,
  assertGuildAccess,
  clearDashboardCookie,
  discordAvatarUrl,
  exchangeOAuthCode,
  getSession,
  getSharedGuilds,
  loadOAuthUser,
  randomToken,
  readSignedCookie,
  requireCsrf,
  setSignedCookie,
} from "./auth";
import { type DashboardStatsTimeframe, TomoriDashboardCore } from "./core";
import { DashboardServiceError } from "./errors";
import { DashboardMemoryService } from "./memoryService";
import { DashboardProviderService } from "./providerService";
import { DashboardPersonaChatService } from "./personaChatService";
import { DashboardPersonaService } from "./personaService";
import { getDashboardRuntimeConfig } from "./runtimeConfig";
import { SETTINGS_CATALOG, isSettingsSectionId, serializeSettingsValues } from "./settingsCatalog";
import { DashboardSettingsService } from "./settingsService";
import type {
  DashboardActor,
  DashboardGuildSnapshot,
  DashboardSession,
  DiscordOAuthUser,
  RegisteredDashboardUser,
} from "./types";
import { renderDashboardHtml } from "./ui";

const BASE_PATH = "/settings";
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DASHBOARD_STATS_TIMEFRAMES = new Set<DashboardStatsTimeframe>(["today", "week", "month", "year", "all_time"]);

const memoryImportSchema = z
  .object({
    kind: z.enum(["personal", "server"]),
    lineageId: z.number().int().nonnegative(),
    memories: z
      .array(
        z.object({
          content: z.string().trim().min(1),
          tags: z.array(z.string().trim().min(1).max(32)).max(5).optional().default([]),
        }),
      )
      .max(500),
  })
  .strict();

const dashboardAssets = {
  "app.css": { path: "src/web/dashboard/assets/app.css", contentType: "text/css; charset=utf-8" },
  "companion.css": { path: "src/web/dashboard/assets/companion.css", contentType: "text/css; charset=utf-8" },
  "app.js": { path: "src/web/dashboard/assets/app.js", contentType: "application/javascript; charset=utf-8" },
  "tomoribot_logo.png": { path: "src/web/assets/tomoribot_logo.png", contentType: "image/png" },
  "tomori_companion_logo.svg": {
    path: "src/web/assets/tomori_companion_logo.svg",
    contentType: "image/svg+xml",
  },
  "noto-sans-jp.ttf": { path: "assets/fonts/NotoSansJP-Regular.ttf", contentType: "font/ttf" },
  "tomori_texture5.png": { path: "src/web/assets/tomori_texture5.png", contentType: "image/png" },
} as const;

type DashboardServer = ReturnType<typeof Bun.serve>;
let runningServer: DashboardServer | null = null;

function displayName(user: DiscordOAuthUser): string {
  return user.global_name?.trim() || user.username;
}

function jsonError(context: Context, error: DashboardServiceError | string, status = 500) {
  if (error instanceof DashboardServiceError) {
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  return context.json({ error: { code: "internal_error", message: error } }, status as 500);
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseLineageId(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseNonNegativeInt(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function serializeProfile(actor: DashboardActor) {
  return {
    nickname: actor.user.user_nickname,
    privacyLevel: actor.user.privacy_level,
    personalDtm: actor.user.personal_dtm ?? "follow",
    personalDeliberateToolMode: actor.user.personal_deliberate_tool_mode ?? "follow",
    timezoneOffset: actor.user.timezone_offset ?? null,
    crossServerShortTermMemory: actor.user.shortterm_cache_crossserver_opt_in ?? false,
    impersonationPrompt: actor.user.impersonation_prompt ?? null,
    physicalAppearanceTags: actor.user.physical_appearance_tags ?? [],
  };
}

function serializeChannels(channels: Iterable<GuildBasedChannel>) {
  return Array.from(channels)
    .filter((channel) => channel.isTextBased() && !channel.isThread())
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentName: channel.parent?.name ?? null,
    }))
    .sort(
      (left, right) =>
        (left.parentName ?? "").localeCompare(right.parentName ?? "") || left.name.localeCompare(right.name),
    );
}

async function requireActor(
  context: Context,
  core: TomoriDashboardCore,
  sessionStore: DashboardSessionStore,
  config: ReturnType<typeof getDashboardRuntimeConfig>,
): Promise<{ session: DashboardSession; actor: DashboardActor } | Response> {
  const session = getSession(context, config, sessionStore);
  if (!session) return jsonError(context, new DashboardServiceError("auth_required", 401, "Sign in required."));
  const user = await core.ensureUser(session.user.id, displayName(session.user));
  if (!user?.user_id) {
    return jsonError(context, new DashboardServiceError("user_registration_failed", 500, "User setup failed."));
  }
  return {
    session,
    actor: {
      discordId: session.user.id,
      user: user as RegisteredDashboardUser,
      canManage: false,
    },
  };
}

async function requireGuildContext(
  context: Context,
  client: Client,
  core: TomoriDashboardCore,
  sessionStore: DashboardSessionStore,
  config: ReturnType<typeof getDashboardRuntimeConfig>,
  requireManage = false,
): Promise<
  | {
      session: DashboardSession;
      actor: DashboardActor;
      snapshot: DashboardGuildSnapshot;
      guild: NonNullable<Awaited<ReturnType<typeof assertGuildAccess>>>;
    }
  | Response
> {
  const actorResult = await requireActor(context, core, sessionStore, config);
  if (actorResult instanceof Response) return actorResult;

  const guildId = context.req.param("guildId");
  if (!guildId) {
    return jsonError(context, new DashboardServiceError("guild_required", 422, "A server is required."));
  }
  const guild = await assertGuildAccess(actorResult.session, client, guildId, requireManage);
  if (!guild) {
    return jsonError(
      context,
      new DashboardServiceError(
        requireManage ? "admin_required" : "guild_forbidden",
        403,
        requireManage ? "Manage Server permission is required." : "This server is not available.",
      ),
    );
  }

  const snapshot = await core.loadGuildSnapshot(guildId);
  if (!snapshot) {
    return jsonError(
      context,
      new DashboardServiceError("server_not_setup", 404, "Tomori is not set up in this server."),
    );
  }

  return {
    ...actorResult,
    actor: { ...actorResult.actor, canManage: guild.canManage },
    snapshot,
    guild,
  };
}

function requireMutationCsrf(context: Context, session: DashboardSession): Response | null {
  return requireCsrf(context, session)
    ? null
    : jsonError(context, new DashboardServiceError("csrf_failed", 403, "Security token expired. Refresh the page."));
}

export function createDashboardApp(client: Client) {
  const config = getDashboardRuntimeConfig(client);
  const sessions = new DashboardSessionStore();
  const core = new TomoriDashboardCore();
  const memories = new DashboardMemoryService(core);
  const providers = new DashboardProviderService(core);
  const personas = new DashboardPersonaService(core, client);
  const personaChat = new DashboardPersonaChatService(client);
  const settings = new DashboardSettingsService(core);
  const app = new Hono();
  sessions.startCleanup();

  app.use("*", async (context, next) => {
    await next();
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    context.header("Referrer-Policy", "same-origin");
    context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'self'; form-action 'self' https://discord.com; frame-ancestors 'none'",
    );
  });

  app.get("/", (context) => context.redirect(BASE_PATH));
  app.get(BASE_PATH, (context) => context.html(renderDashboardHtml()));
  app.get(`${BASE_PATH}/assets/:assetName`, async (context) => {
    const assetName = context.req.param("assetName") as keyof typeof dashboardAssets;
    const asset = dashboardAssets[assetName];
    if (!asset) return context.notFound();
    const file = Bun.file(resolve(process.cwd(), asset.path));
    if (!(await file.exists())) return context.notFound();
    context.header("Content-Type", asset.contentType);
    context.header(
      "Cache-Control",
      assetName === "app.js" || assetName === "app.css" || assetName === "companion.css"
        ? "no-cache"
        : "public, max-age=86400",
    );
    return context.body(await file.arrayBuffer());
  });

  app.get(`${BASE_PATH}/login`, (context) => {
    if (!config.clientId || !config.clientSecret) {
      return context.text("Discord OAuth is not configured for the TomoriBot dashboard.", 503);
    }
    const state = randomToken();
    setSignedCookie(context, config, OAUTH_STATE_COOKIE, state, 10 * 60);
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "identify guilds",
      state,
    });
    return context.redirect(`${DISCORD_API_BASE}/oauth2/authorize?${params.toString()}`);
  });

  app.get(`${BASE_PATH}/oauth/callback`, async (context) => {
    const code = context.req.query("code");
    const state = context.req.query("state");
    const expectedState = readSignedCookie(context, config, OAUTH_STATE_COOKIE);
    clearDashboardCookie(context, config, OAUTH_STATE_COOKIE);
    if (!code || !state || !expectedState || state !== expectedState) {
      return context.text("Invalid OAuth state.", 400);
    }

    try {
      const token = await exchangeOAuthCode(config, code);
      const user = await loadOAuthUser(token.access_token);
      const session = sessions.create(user, token.access_token, token.expires_in);
      setSignedCookie(context, config, SESSION_COOKIE, session.id, SESSION_TTL_MS / 1000);
      return context.redirect(BASE_PATH);
    } catch (error) {
      await log.error("Dashboard OAuth callback failed", error);
      return context.text("Discord login failed.", 502);
    }
  });

  app.get(`${BASE_PATH}/logout`, (context) => {
    const session = getSession(context, config, sessions);
    if (session) sessions.delete(session.id);
    clearDashboardCookie(context, config, SESSION_COOKIE);
    return context.redirect(BASE_PATH);
  });

  app.get(`${BASE_PATH}/api/session`, async (context) => {
    const session = getSession(context, config, sessions);
    if (!session) return jsonError(context, new DashboardServiceError("auth_required", 401, "Sign in required."));
    try {
      const guilds = await getSharedGuilds(session, client);
      return context.json({
        user: {
          id: session.user.id,
          username: session.user.username,
          displayName: displayName(session.user),
          avatarUrl: discordAvatarUrl(session.user),
        },
        csrfToken: session.csrfToken,
        guilds,
      });
    } catch (error) {
      await log.error("Dashboard failed to load shared guilds", error);
      return jsonError(context, new DashboardServiceError("discord_unavailable", 502, "Discord is unavailable."));
    }
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/overview`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const cachedGuild = client.guilds.cache.get(result.guild.id);
    const channels = cachedGuild ? serializeChannels(cachedGuild.channels.cache.values()) : [];
    const mainPersona = result.snapshot.rawPersonas[0];

    return context.json({
      guild: result.guild,
      setupComplete: true,
      canManage: result.actor.canManage,
      profile: serializeProfile(result.actor),
      personas: result.snapshot.personas,
      channels,
      memoryPolicy: {
        personalMemoryUseEnabled: result.snapshot.config.personal_memories_enabled !== false,
        serverMemoryTeachingEnabled: result.snapshot.config.server_memteaching_enabled !== false,
        selfTeachingEnabled: result.snapshot.config.self_teaching_enabled !== false,
      },
      modelSummary: {
        text: mainPersona?.llm ? { provider: mainPersona.llm.llm_provider, name: mainPersona.llm.llm_codename } : null,
        vision: mainPersona?.vision_llm
          ? { provider: mainPersona.vision_llm.llm_provider, name: mainPersona.vision_llm.llm_codename }
          : null,
        fallbacks:
          mainPersona?.fallback_chain?.map((entry) =>
            entry.kind === "llm"
              ? { type: "model", label: `${entry.model.llm_provider}/${entry.model.llm_codename}` }
              : { type: "endpoint", label: entry.endpoint.display_name },
          ) ?? [],
      },
      settings: result.actor.canManage
        ? {
            catalog: SETTINGS_CATALOG,
            values: serializeSettingsValues(result.snapshot.config as unknown as Record<string, unknown>),
          }
        : null,
    });
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/stats`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const requested = context.req.query("timeframe") ?? "all_time";
    if (!DASHBOARD_STATS_TIMEFRAMES.has(requested as DashboardStatsTimeframe)) {
      return jsonError(
        context,
        new DashboardServiceError("invalid_timeframe", 422, "Choose a valid statistics timeframe."),
      );
    }
    try {
      return context.json({
        stats: await core.loadServerStats(result.snapshot, requested as DashboardStatsTimeframe),
      });
    } catch (error) {
      await log.error("Dashboard failed to load server statistics", error);
      return jsonError(context, "Server statistics could not be loaded.");
    }
  });

  app.patch(`${BASE_PATH}/api/profile`, async (context) => {
    const result = await requireActor(context, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const body = await context.req.json().catch(() => null);
    try {
      const updated = await settings.updateProfile(result.actor.user.user_id, result.actor.discordId, body);
      return context.json({ profile: serializeProfile({ ...result.actor, user: updated }) });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Profile update failed.");
    }
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/memories/personal`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const lineageId = parseLineageId(context.req.query("lineageId"));
    if (lineageId === null) {
      return jsonError(context, new DashboardServiceError("invalid_lineage", 422, "Invalid memory scope."));
    }
    try {
      return context.json(await memories.listPersonal(result.actor, result.snapshot, lineageId));
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Personal memories failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/memories/personal`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      const input = memories.parseMutation(await context.req.json().catch(() => null));
      return context.json({ memory: await memories.addPersonal(result.actor, result.snapshot, input) }, 201);
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Personal memory save failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/memories/personal/:memoryId`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const memoryId = parsePositiveInt(context.req.param("memoryId"));
    if (!memoryId) return jsonError(context, new DashboardServiceError("invalid_memory_id", 422, "Invalid memory."));
    try {
      const input = memories.parseMutation(await context.req.json().catch(() => null));
      return context.json({ memory: await memories.updatePersonal(result.actor, result.snapshot, memoryId, input) });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Personal memory update failed.");
    }
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/memories/personal/:memoryId`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const memoryId = parsePositiveInt(context.req.param("memoryId"));
    const lineageId = parseLineageId(context.req.query("lineageId"));
    if (!memoryId || lineageId === null) {
      return jsonError(context, new DashboardServiceError("invalid_memory_id", 422, "Invalid memory."));
    }
    try {
      await memories.removePersonal(result.actor, result.snapshot, memoryId, lineageId);
      return context.json({ deleted: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Personal memory delete failed.");
    }
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/memories/server`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const lineageId = parseLineageId(context.req.query("lineageId"));
    if (lineageId === null) {
      return jsonError(context, new DashboardServiceError("invalid_lineage", 422, "Invalid memory scope."));
    }
    try {
      return context.json(await memories.listServer(result.actor, result.snapshot, lineageId));
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server memories failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/memories/server`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      const input = memories.parseMutation(await context.req.json().catch(() => null));
      return context.json({ memory: await memories.addServer(result.actor, result.snapshot, input) }, 201);
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server memory save failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/memories/server/:memoryId`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const memoryId = parsePositiveInt(context.req.param("memoryId"));
    if (!memoryId) return jsonError(context, new DashboardServiceError("invalid_memory_id", 422, "Invalid memory."));
    try {
      const input = memories.parseMutation(await context.req.json().catch(() => null));
      return context.json({ memory: await memories.updateServer(result.actor, result.snapshot, memoryId, input) });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server memory update failed.");
    }
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/memories/server/:memoryId`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const memoryId = parsePositiveInt(context.req.param("memoryId"));
    const lineageId = parseLineageId(context.req.query("lineageId"));
    if (!memoryId || lineageId === null) {
      return jsonError(context, new DashboardServiceError("invalid_memory_id", 422, "Invalid memory."));
    }
    try {
      await memories.removeServer(result.actor, result.snapshot, memoryId, lineageId);
      return context.json({ deleted: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server memory delete failed.");
    }
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/memories/export`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const lineageId = parseLineageId(context.req.query("lineageId"));
    const kind = context.req.query("kind") === "server" ? "server" : "personal";
    if (lineageId === null) {
      return jsonError(context, new DashboardServiceError("invalid_lineage", 422, "Invalid memory scope."));
    }
    try {
      const payload =
        kind === "server"
          ? await memories.listServer(result.actor, result.snapshot, lineageId)
          : await memories.listPersonal(result.actor, result.snapshot, lineageId);
      return context.json({
        format: "tomoribot-dashboard-memory-v2",
        exportedAt: new Date().toISOString(),
        guildId: result.guild.id,
        kind,
        lineageId,
        memories: payload.memories.map((memory) => ({ content: memory.content, tags: memory.tags })),
      });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Memory export failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/memories/import`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const parsed = memoryImportSchema.safeParse(await context.req.json().catch(() => null));
    if (!parsed.success) {
      return jsonError(context, new DashboardServiceError("invalid_import", 422, "Invalid memory import file."));
    }

    let inserted = 0;
    let skipped = 0;
    for (const entry of parsed.data.memories) {
      try {
        const input = memories.parseMutation({
          lineageId: parsed.data.lineageId,
          content: entry.content,
          tags: entry.tags,
        });
        if (parsed.data.kind === "server") {
          await memories.addServer(result.actor, result.snapshot, input);
        } else {
          await memories.addPersonal(result.actor, result.snapshot, input);
        }
        inserted++;
      } catch {
        skipped++;
      }
    }
    return context.json({ inserted, skipped });
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/providers/personal`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    try {
      return context.json(await providers.loadPersonalWorkspace(result.actor, result.snapshot));
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Personal providers failed.");
    }
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/providers/server`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    try {
      return context.json(await providers.loadServerWorkspace(result.snapshot));
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server providers failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/providers/:scope/credentials`, async (context) => {
    const scope = context.req.param("scope");
    if (scope !== "personal" && scope !== "server") {
      return jsonError(
        context,
        new DashboardServiceError("provider_scope_not_found", 404, "Provider scope not found."),
      );
    }
    const result = await requireGuildContext(context, client, core, sessions, config, scope === "server");
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      await providers.saveCredential(scope, result.actor, result.snapshot, await context.req.json().catch(() => null));
      return context.json({ saved: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Provider save failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/providers/personal/:provider/capability`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const provider = context.req.param("provider");
    if (!provider) {
      return jsonError(context, new DashboardServiceError("provider_not_found", 404, "Provider not found."));
    }
    try {
      await providers.setPersonalCapability(result.actor, provider, await context.req.json().catch(() => null));
      return context.json({ saved: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Provider update failed.");
    }
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/providers/personal/:provider`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const provider = context.req.param("provider");
    if (!provider) {
      return jsonError(context, new DashboardServiceError("provider_not_found", 404, "Provider not found."));
    }
    try {
      await providers.removePersonalProvider(result.actor, provider);
      return context.json({ deleted: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Provider delete failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/providers/:scope/endpoints`, async (context) => {
    const scope = context.req.param("scope");
    if (scope !== "personal" && scope !== "server") {
      return jsonError(
        context,
        new DashboardServiceError("provider_scope_not_found", 404, "Provider scope not found."),
      );
    }
    const result = await requireGuildContext(context, client, core, sessions, config, scope === "server");
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      const endpoint = await providers.registerEndpoint(
        scope,
        result.actor,
        result.snapshot,
        await context.req.json().catch(() => null),
      );
      return context.json({ endpoint }, 201);
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Endpoint save failed.");
    }
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/providers/:scope/endpoints/:endpointId`, async (context) => {
    const scope = context.req.param("scope");
    if (scope !== "personal" && scope !== "server") {
      return jsonError(
        context,
        new DashboardServiceError("provider_scope_not_found", 404, "Provider scope not found."),
      );
    }
    const result = await requireGuildContext(context, client, core, sessions, config, scope === "server");
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const endpointId = parsePositiveInt(context.req.param("endpointId"));
    if (!endpointId) {
      return jsonError(context, new DashboardServiceError("invalid_endpoint", 422, "Invalid endpoint."));
    }
    try {
      await providers.removeEndpoint(scope, result.actor, result.snapshot, endpointId);
      return context.json({ deleted: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Endpoint delete failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/providers/:scope/openrouter`, async (context) => {
    const scope = context.req.param("scope");
    if (scope !== "personal" && scope !== "server") {
      return jsonError(
        context,
        new DashboardServiceError("provider_scope_not_found", 404, "Provider scope not found."),
      );
    }
    const result = await requireGuildContext(context, client, core, sessions, config, scope === "server");
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      return context.json(
        await providers.registerOpenRouter(
          scope,
          result.actor,
          result.snapshot,
          await context.req.json().catch(() => null),
        ),
      );
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "OpenRouter registration failed.");
    }
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/providers/:scope/openrouter`, async (context) => {
    const scope = context.req.param("scope");
    if (scope !== "personal" && scope !== "server") {
      return jsonError(
        context,
        new DashboardServiceError("provider_scope_not_found", 404, "Provider scope not found."),
      );
    }
    const result = await requireGuildContext(context, client, core, sessions, config, scope === "server");
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      await providers.removeOpenRouter(
        scope,
        result.actor,
        result.snapshot,
        await context.req.json().catch(() => null),
      );
      return context.json({ deleted: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "OpenRouter removal failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/providers/server/fallbacks`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      const refs = await providers.setFallbacks(result.snapshot, await context.req.json().catch(() => null));
      return context.json({ refs });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Fallback update failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/providers/server/models`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      const models = await providers.setServerModels(result.snapshot, await context.req.json().catch(() => null));
      return context.json({ models });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server model update failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/settings/:sectionId`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const sectionId = context.req.param("sectionId");
    if (!isSettingsSectionId(sectionId)) {
      return jsonError(
        context,
        new DashboardServiceError("settings_section_not_found", 404, "Settings section not found."),
      );
    }
    const cachedGuild = client.guilds.cache.get(result.guild.id);
    const validChannelIds = new Set(cachedGuild?.channels.cache.keys() ?? []);
    try {
      const updated = await settings.updateSettings(
        result.snapshot,
        sectionId,
        await context.req.json().catch(() => null),
        validChannelIds,
      );
      return context.json({
        sectionId,
        values: serializeSettingsValues(updated as unknown as Record<string, unknown>)[sectionId],
      });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Settings update failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/personas`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const guild = client.guilds.cache.get(result.guild.id);
    if (!guild) return jsonError(context, new DashboardServiceError("guild_unavailable", 503, "Server unavailable."));
    try {
      const created = await personas.create(
        result.snapshot,
        guild,
        result.actor.discordId,
        await context.req.json().catch(() => null),
      );
      const snapshot = await core.loadGuildSnapshot(result.guild.id);
      return context.json(
        {
          persona: snapshot?.personas.find((persona) => persona.personaId === created.personaId) ?? null,
        },
        201,
      );
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Persona creation failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/personas/import`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const guild = client.guilds.cache.get(result.guild.id);
    if (!guild) return jsonError(context, new DashboardServiceError("guild_unavailable", 503, "Server unavailable."));
    try {
      const body = await context.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) {
        return jsonError(context, new DashboardServiceError("persona_file_required", 422, "Choose a persona file."));
      }
      const identityMode = body.identityMode === "preserve" ? "preserve" : "fork";
      const imported = await personas.import(result.snapshot, guild, result.actor.discordId, file, identityMode);
      const snapshot = await core.loadGuildSnapshot(result.guild.id);
      return context.json(
        {
          persona: snapshot?.personas.find((persona) => persona.personaId === imported.personaId) ?? null,
        },
        201,
      );
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Persona import failed.");
    }
  });

  app.put(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/attributes`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId) return jsonError(context, new DashboardServiceError("invalid_persona", 422, "Invalid persona."));
    try {
      await personas.replaceAttributes(result.snapshot, personaId, await context.req.json().catch(() => null));
      const snapshot = await core.loadGuildSnapshot(result.guild.id);
      return context.json({ persona: snapshot?.personas.find((persona) => persona.personaId === personaId) ?? null });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Attribute update failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/dialogues`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId) return jsonError(context, new DashboardServiceError("invalid_persona", 422, "Invalid persona."));
    try {
      await personas.addDialogue(result.snapshot, personaId, await context.req.json().catch(() => null));
      const snapshot = await core.loadGuildSnapshot(result.guild.id);
      return context.json(
        { persona: snapshot?.personas.find((persona) => persona.personaId === personaId) ?? null },
        201,
      );
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Sample dialogue creation failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/dialogues/:index`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    const index = parseNonNegativeInt(context.req.param("index"));
    if (!personaId || index === null) {
      return jsonError(context, new DashboardServiceError("invalid_dialogue", 422, "Invalid sample dialogue."));
    }
    try {
      await personas.updateDialogue(result.snapshot, personaId, index, await context.req.json().catch(() => null));
      const snapshot = await core.loadGuildSnapshot(result.guild.id);
      return context.json({ persona: snapshot?.personas.find((persona) => persona.personaId === personaId) ?? null });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Sample dialogue update failed.");
    }
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/dialogues/:index`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    const index = parseNonNegativeInt(context.req.param("index"));
    if (!personaId || index === null) {
      return jsonError(context, new DashboardServiceError("invalid_dialogue", 422, "Invalid sample dialogue."));
    }
    try {
      await personas.removeDialogue(result.snapshot, personaId, index);
      return context.json({ deleted: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Sample dialogue removal failed.");
    }
  });

  app.put(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/avatar`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    const guild = client.guilds.cache.get(result.guild.id);
    if (!personaId || !guild) {
      return jsonError(context, new DashboardServiceError("invalid_persona", 422, "Invalid persona."));
    }
    try {
      const body = await context.req.parseBody();
      const file = body.file;
      if (!(file instanceof File)) {
        return jsonError(context, new DashboardServiceError("avatar_required", 422, "Choose an avatar image."));
      }
      await personas.setAvatar(result.snapshot, guild, personaId, file);
      return context.json({ updated: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Avatar update failed.");
    }
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/avatar`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    const guild = client.guilds.cache.get(result.guild.id);
    if (!personaId || !guild) {
      return jsonError(context, new DashboardServiceError("invalid_persona", 422, "Invalid persona."));
    }
    try {
      await personas.removeAvatar(result.snapshot, guild, personaId);
      return context.json({ deleted: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Avatar removal failed.");
    }
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId) return jsonError(context, new DashboardServiceError("invalid_persona", 422, "Invalid persona."));
    try {
      await personas.remove(result.snapshot, personaId);
      return context.json({ deleted: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Persona removal failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/personas/test-chat`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const guild = client.guilds.cache.get(result.guild.id);
    if (!guild) return jsonError(context, new DashboardServiceError("guild_unavailable", 503, "Server unavailable."));
    try {
      return context.json(
        await personaChat.reply(result.actor, result.snapshot, guild, await context.req.json().catch(() => null)),
      );
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Persona test chat failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/:section`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    const section = context.req.param("section");
    if (!personaId || !["identity", "prompt", "context", "appearance"].includes(section)) {
      return jsonError(context, new DashboardServiceError("invalid_persona", 422, "Invalid persona update."));
    }
    try {
      const body = await context.req.json().catch(() => null);
      await settings.updatePersona(
        result.snapshot,
        personaId,
        section as "identity" | "prompt" | "context" | "appearance",
        body,
      );
      const editedPersona = result.snapshot.personas.find((persona) => persona.personaId === personaId);
      if (
        section === "identity" &&
        editedPersona &&
        !editedPersona.isAlter &&
        body &&
        typeof body === "object" &&
        "nickname" in body &&
        typeof body.nickname === "string"
      ) {
        const guild = client.guilds.cache.get(result.guild.id);
        try {
          const botMember = guild?.members.me ?? (await guild?.members.fetchMe());
          await botMember?.setNickname(body.nickname.trim());
        } catch (error) {
          log.warn("Dashboard persona rename saved, but the Discord server nickname could not be updated.", error);
        }
      }
      const snapshot = await core.loadGuildSnapshot(result.guild.id);
      return context.json({ persona: snapshot?.personas.find((persona) => persona.personaId === personaId) ?? null });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Persona update failed.");
    }
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/avatar`, async (context) => {
    const session = getSession(context, config, sessions);
    if (!session) return jsonError(context, new DashboardServiceError("auth_required", 401, "Sign in required."));
    const guildId = context.req.param("guildId");
    if (!guildId) return context.notFound();
    if (!(await assertGuildAccess(session, client, guildId))) {
      return jsonError(context, new DashboardServiceError("guild_forbidden", 403, "This server is not available."));
    }
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId) return context.notFound();
    const snapshot = await core.loadGuildSnapshot(guildId);
    const persona = snapshot?.personas.find((entry) => entry.personaId === personaId);
    if (!persona) return context.notFound();
    const avatar = await core.loadPersonaAvatar(guildId, personaId);
    if (avatar) {
      context.header("Content-Type", "image/png");
      context.header("Cache-Control", "private, no-store");
      return context.body(new Uint8Array(avatar));
    }

    if (!persona.isAlter) {
      const guild = client.guilds.cache.get(guildId);
      const discordAvatarUrl =
        guild?.members.me?.displayAvatarURL({
          extension: "png",
          forceStatic: true,
          size: 256,
        }) ??
        client.user?.displayAvatarURL({
          extension: "png",
          forceStatic: true,
          size: 256,
        });
      if (discordAvatarUrl) {
        context.header("Cache-Control", "private, no-store");
        return context.redirect(discordAvatarUrl, 302);
      }
    }

    context.header("Cache-Control", "private, max-age=60");
    return context.notFound();
  });

  app.onError(async (error, context) => {
    await log.error("Unhandled dashboard request error", error);
    return jsonError(context, "Dashboard request failed.");
  });

  return { app, config };
}

export function startSettingsWebsite(client: Client): void {
  const config = getDashboardRuntimeConfig(client);
  if (!config.enabled) {
    log.info("Settings dashboard disabled (set WEB_SETTINGS_ENABLED=true to enable)");
    return;
  }
  if (!config.sessionSecret) {
    log.warn("Settings dashboard disabled: WEB_SETTINGS_SESSION_SECRET or CRYPTO_SECRET is required");
    return;
  }
  if (runningServer) {
    log.warn("Settings dashboard is already running");
    return;
  }

  const { app } = createDashboardApp(client);
  try {
    runningServer = Bun.serve({
      hostname: config.host,
      port: config.port,
      fetch: app.fetch,
    });
    log.success(`Settings dashboard listening at ${config.publicUrl}${BASE_PATH}`);
  } catch (error) {
    log.error("Failed to start settings dashboard", error);
  }
}

export function stopSettingsWebsite(): void {
  runningServer?.stop(true);
  runningServer = null;
}
