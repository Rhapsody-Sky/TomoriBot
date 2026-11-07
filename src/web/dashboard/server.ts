import type { Client, GuildBasedChannel } from "discord.js";
import { resolve } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { z } from "zod";
import { log } from "@/utils/misc/logger";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { localizer } from "@/utils/text/localizer";
import {
  PERSONA_NAMING_VALUE_MAX_LENGTH,
  USER_IDENTITY_FIELD_MAX_LENGTH,
  USER_NICKNAME_MAX_LENGTH,
} from "@/types/personaNaming";
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
import { DashboardLorebookService } from "./lorebookService";
import { DashboardProviderService } from "./providerService";
import { DashboardPersonaChatService } from "./personaChatService";
import { DashboardPersonaService } from "./personaService";
import { DashboardSpriteService, SPRITE_UPLOAD_MAX_BYTES } from "./spriteService";
import { getDashboardRuntimeConfig } from "./runtimeConfig";
import { getSettingsCatalog, isSettingsSectionId, serializeSettingsValues } from "./settingsCatalog";
import { DashboardSettingsService, personaSettingsSectionSchema } from "./settingsService";
import { DashboardChannelService } from "./channelService";
import type {
  DashboardActor,
  DashboardGuildSnapshot,
  DashboardSession,
  DiscordOAuthUser,
  RegisteredDashboardUser,
} from "./types";
import { renderDashboardHtml } from "./ui";
import { DashboardSiteService, cleanSiteHtml, siteCopy, siteInterfaceCopy } from "./siteService";
import { escapeToBuffer } from "hono/utils/html";

const BASE_PATH = "/settings";
function escapeHtml(value: string): string {
  const buffer = [""];
  escapeToBuffer(value, buffer);
  return buffer.join("");
}
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DASHBOARD_STATS_TIMEFRAMES = new Set<DashboardStatsTimeframe>([
  "today",
  "week",
  "month",
  "year",
  "all_time",
  "custom",
]);

type DashboardEnv = {
  Variables: { spriteContext: { snapshot: DashboardGuildSnapshot; personaId: number; actorDiscordId: string } };
};

const memoryImportSchema = z
  .object({
    kind: z.enum(["personal", "server"]),
    lineageId: z.number().int().nonnegative(),
    memories: z.array(z.unknown()).max(500),
  })
  .strict();

const dashboardAssets = {
  "quill.js": { path: "node_modules/quill/dist/quill.js", contentType: "application/javascript; charset=utf-8" },
  "quill.core.css": { path: "node_modules/quill/dist/quill.core.css", contentType: "text/css; charset=utf-8" },
  "site.js": { path: "src/web/dashboard/assets/site.js", contentType: "application/javascript; charset=utf-8" },
  "ui-kit.css": { path: "src/web/dashboard/assets/ui-kit.css", contentType: "text/css; charset=utf-8" },
  "dashboard.css": { path: "src/web/dashboard/assets/dashboard.css", contentType: "text/css; charset=utf-8" },
  "controls.css": { path: "src/web/dashboard/assets/controls.css", contentType: "text/css; charset=utf-8" },
  "controls.js": { path: "src/web/dashboard/assets/controls.js", contentType: "application/javascript; charset=utf-8" },
  "app.css": { path: "src/web/dashboard/assets/app.css", contentType: "text/css; charset=utf-8" },
  "companion.css": { path: "src/web/dashboard/assets/companion.css", contentType: "text/css; charset=utf-8" },
  "app.js": { path: "src/web/dashboard/assets/app.js", contentType: "application/javascript; charset=utf-8" },
  "navigation-icons.svg": { path: "src/web/dashboard/assets/navigation-icons.svg", contentType: "image/svg+xml" },
  "tomoribot_logo.png": { path: "src/web/assets/tomoribot_logo.png", contentType: "image/png" },
  "tomori_companion_logo.svg": {
    path: "src/web/assets/tomori_companion_logo.svg",
    contentType: "image/svg+xml",
  },
  "noto-sans-jp.ttf": { path: "assets/fonts/NotoSansJP-Regular.ttf", contentType: "font/ttf" },
  "noto-sans-jp-bold.ttf": { path: "assets/fonts/NotoSansJP-Bold.ttf", contentType: "font/ttf" },
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

function lorebookError(context: Context, error: unknown) {
  const failure =
    error instanceof DashboardServiceError
      ? error
      : new DashboardServiceError("lorebook_failed", 500, "Lorebook operation failed.");
  const key =
    failure.code === "lorebook_too_large"
      ? "general.dashboard.lorebook_error_too_large"
      : failure.code === "lorebook_limit"
        ? "general.dashboard.lorebook_error_limit"
        : failure.code === "lorebook_exists"
          ? "general.dashboard.lorebook_error_exists"
          : failure.code === "lorebook_missing"
            ? "general.dashboard.lorebook_error_missing"
            : failure.code === "lorebook_unavailable"
              ? "general.dashboard.lorebook_error_unavailable"
              : failure.code === "invalid_lorebook_channel"
                ? "general.dashboard.lorebook_error_channel"
                : failure.status === 403
                  ? "general.dashboard.lorebook_error_forbidden"
                  : failure.status === 422
                    ? "general.dashboard.lorebook_error_invalid"
                    : "general.dashboard.lorebook_error_failed";
  return jsonError(context, new DashboardServiceError(failure.code, failure.status, localizer("en-US", key)));
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
    copy: {
      serverFallback: localizer("en-US", "general.dashboard.server_fallback"),
      serverFallbackHint: localizer("en-US", "general.dashboard.server_fallback_hint"),
      nudgeOptOut: localizer("en-US", "general.dashboard.nudge_opt_out"),
      nudgeOptOutHint: localizer("en-US", "general.dashboard.nudge_opt_out_hint"),
      gender: localizer("en-US", "commands.personal.config.modal_gender_label"),
      genderHint: localizer("en-US", "commands.personal.config.modal_gender_description"),
      pronouns: localizer("en-US", "commands.personal.config.modal_pronouns_label"),
      pronounsHint: localizer("en-US", "commands.personal.config.modal_pronouns_description"),
      addressingStyle: localizer("en-US", "commands.personal.config.modal_style_label"),
      addressingStyleHint: localizer("en-US", "commands.personal.config.modal_style_description"),
      styleDefault: localizer("en-US", "general.dashboard.style_default"),
      styleMasculine: localizer("en-US", "commands.personal.config.style_masculine"),
      styleFeminine: localizer("en-US", "commands.personal.config.style_feminine"),
      styleNeutral: localizer("en-US", "commands.personal.config.style_neutral"),
    },
    limits: { nickname: USER_NICKNAME_MAX_LENGTH, identity: USER_IDENTITY_FIELD_MAX_LENGTH },
    genderIdentity: actor.user.gender_identity ?? null,
    pronouns: actor.user.pronouns ?? null,
    addressingStyle: actor.user.addressing_style ?? null,
    nickname: actor.user.user_nickname,
    privacyLevel: actor.user.privacy_level,
    personalDtm: actor.user.personal_dtm ?? "follow",
    personalDeliberateToolMode: actor.user.personal_deliberate_tool_mode ?? "follow",
    timezoneOffset: actor.user.timezone_offset ?? null,
    crossServerShortTermMemory: actor.user.shortterm_cache_crossserver_opt_in ?? false,
    personalServerFallback: actor.user.personal_server_fallback_enabled,
    naturalNudgeOptOut: actor.user.natural_nudge_opt_out,
    impersonationPrompt: actor.user.impersonation_prompt ?? null,
    physicalAppearanceTags: actor.user.physical_appearance_tags ?? [],
    hasCharacterReference: Boolean(actor.user.char_ref_url),
  };
}

function serializeChannels(channels: Iterable<GuildBasedChannel>) {
  return Array.from(channels)
    .filter((channel) => channel.isTextBased() && !channel.isThread())
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId,
      parentName: channel.parent?.name ?? null,
      parentPosition: channel.parent?.position ?? -1,
      position: "position" in channel ? channel.position : 0,
    }))
    .sort(
      (left, right) =>
        left.parentPosition - right.parentPosition ||
        (left.parentId ?? "").localeCompare(right.parentId ?? "") ||
        left.position - right.position ||
        left.id.localeCompare(right.id),
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
  const guild = await assertGuildAccess(actorResult.session, client, guildId, core, requireManage);
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
  const lorebooks = new DashboardLorebookService();
  const providers = new DashboardProviderService(core);
  const personas = new DashboardPersonaService(core, client);
  const sprites = new DashboardSpriteService();
  const personaChat = new DashboardPersonaChatService(client);
  const settings = new DashboardSettingsService(core);
  const channelSettings = new DashboardChannelService(core);
  const site = new DashboardSiteService();
  const app = new Hono<DashboardEnv>();
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
  app.get(`${BASE_PATH}/api/site`, async (context) => {
    context.header("Cache-Control", "no-store");
    const entries = await site.list();
    return context.json({
      entries: entries.map(({ id, kind, title, url }) => ({ id, kind, title, url })),
      copy: siteCopy(),
      interfaceCopy: siteInterfaceCopy(),
    });
  });
  app.get(`${BASE_PATH}/pages/:pageId`, async (context) => {
    context.header("Cache-Control", "no-store");
    const entries = await site.list();
    const page = entries.find((entry) => entry.kind === "page" && entry.id === context.req.param("pageId"));
    if (!page) return context.text(siteCopy().missing, 404);
    const links = entries
      .map(
        (entry) =>
          `<a href="${escapeHtml(entry.kind === "page" ? `${BASE_PATH}/pages/${entry.id}` : entry.url)}">${escapeHtml(entry.title)}</a>`,
      )
      .join("");
    return context.html(
      renderDashboardHtml(`<main class="public-site-page stack">
      <a class="button" href="${BASE_PATH}">${escapeHtml(siteCopy().back)}</a>
      <article class="panel"><header class="panel-header"><div class="heading"><h1>${escapeHtml(page.title)}</h1></div></header>
      <div class="site-prose">${page.content}</div></article>
      <nav class="site-public-links" aria-label="${escapeHtml(siteCopy().public_links)}">${links}</nav></main>`),
    );
  });
  app.use(`${BASE_PATH}/api/site-admin/*`, async (context, next) => {
    const session = getSession(context, config, sessions);
    if (!session) return jsonError(context, new DashboardServiceError("auth_required", 401, siteCopy().forbidden));
    if (!config.globalAdminIds.includes(session.user.id))
      return jsonError(context, new DashboardServiceError("global_admin_required", 403, siteCopy().forbidden));
    if (context.req.method !== "GET") {
      const error = requireMutationCsrf(context, session);
      if (error) return error;
    }
    context.header("Cache-Control", "no-store");
    await next();
  });
  app.get(`${BASE_PATH}/api/site-admin/entries`, async (context) => context.json({ entries: await site.list(true) }));
  app.post(`${BASE_PATH}/api/site-admin/preview`, bodyLimit({ maxSize: 150_000 }), async (context) => {
    const parsed = z
      .object({ content: z.string().max(100_000) })
      .strict()
      .safeParse(await context.req.json());
    if (!parsed.success)
      return jsonError(context, new DashboardServiceError("invalid_site_entry", 422, siteCopy().invalid));
    return context.json({ content: cleanSiteHtml(parsed.data.content) });
  });
  app.put(`${BASE_PATH}/api/site-admin/entries/:id`, bodyLimit({ maxSize: 150_000 }), async (context) => {
    return context.json({ entry: await site.save(context.req.param("id"), await context.req.json()) });
  });
  app.delete(`${BASE_PATH}/api/site-admin/entries/:id`, async (context) => {
    await site.deleteLink(context.req.param("id"));
    return context.json({ success: true });
  });
  app.get(`${BASE_PATH}/assets/:assetName`, async (context) => {
    const assetName = context.req.param("assetName") as keyof typeof dashboardAssets;
    const asset = dashboardAssets[assetName];
    if (!asset) return context.notFound();
    const file = Bun.file(resolve(process.cwd(), asset.path));
    if (!(await file.exists())) return context.notFound();
    context.header("Content-Type", asset.contentType);
    context.header(
      "Cache-Control",
      assetName === "controls.js" ||
        assetName === "site.js" ||
        assetName === "ui-kit.css" ||
        assetName === "dashboard.css" ||
        assetName === "controls.css" ||
        assetName === "app.js" ||
        assetName === "app.css" ||
        assetName === "companion.css" ||
        assetName === "navigation-icons.svg"
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
      const guilds = await getSharedGuilds(session, client, core);
      return context.json({
        user: {
          id: session.user.id,
          username: session.user.username,
          displayName: displayName(session.user),
          avatarUrl: discordAvatarUrl(session.user),
          isGlobalAdmin: config.globalAdminIds.includes(session.user.id),
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
      interfaceCopy: Object.fromEntries(
        [
          "direct_messages_owner",
          "direct_messages_guild_only",
          "overview_title",
          "lorebooks",
          "lorebook_library_hint",
          "lorebook_selected",
          "lorebook_choose",
          "lorebook_entry_count",
          "lorebook_entry_enabled",
          "lorebook_edit_entry",
          "lorebook_view_entry",
          "lorebook_delete_entry",
          "lorebook_entry_settings",
          "lorebook_when_used",
          "lorebook_additional_rules",
          "lorebook_matching_hint",
          "lorebook_constant_hint",
          "lorebook_constant_no_keys",
          "lorebook_rules_hint",
          "lorebook_rules_always",
          "lorebook_usage_disabled",
          "lorebook_usage_zero",
          "lorebook_usage_always",
          "lorebook_usage_keys",
          "lorebook_usage_any",
          "lorebook_usage_not_all",
          "lorebook_usage_none",
          "lorebook_usage_all",
          "lorebook_usage_chance",
          "lorebook_scope_server",
          "lorebook_scope_persona",
          "lorebook_settings_hint",
          "lorebook_collection_enabled_hint",
          "lorebook_collection_paused",
          "lorebook_save_name",
          "lorebook_save_channels",
          "lorebook_delete_title",
          "lorebook_create_hint",
          "lorebook_new_entry_hint",
          "lorebook_title_hint",
          "lorebook_content_hint",
          "lorebook_new_keys_hint",
          "lorebook_empty_hint",
          "lorebook_no_books",
          "lorebook_no_books_hint",
          "lorebook_no_results",
          "lorebook_search_hint",
          "lorebook_transfer",
          "lorebook_export_heading",
          "lorebook_import_heading",
          "lorebook_transfer_hint",
          "lorebook_import_mode_hint",
          "lorebook_placement_hint",
          "lorebook_disabled",
          "lorebook_secondary_hint",
          "lorebook_scan_hint",
          "lorebook_chance_hint",
          "lorebook_order_hint",
          "lorebook_logic_hint",
          "lorebook_regex_hint",
          "lorebook_receipt_inserted",
          "lorebook_receipt_skipped",
          "lorebook_receipt_unsupported",
          "lorebook_receipt_ignored",
          "lorebook_receipt_collapsed",
          "lorebook_import_invalid",
          "lorebook_serverwide",
          "lorebook_eyebrow",
          "lorebook_page_hint",
          "fallback_primary",
          "lorebook_persona",
          "lorebook_loading",
          "lorebook_failed",
          "lorebook_empty",
          "lorebook_search",
          "lorebook_entries",
          "lorebook_settings",
          "lorebook_settings_title",
          "lorebook_import_mode",
          "lorebook_new_entry",
          "lorebook_edit",
          "lorebook_delete",
          "lorebook_save",
          "lorebook_cancel",
          "lorebook_close",
          "lorebook_title",
          "lorebook_content",
          "lorebook_keys",
          "lorebook_keys_hint",
          "lorebook_secondary",
          "lorebook_logic",
          "lorebook_scan",
          "lorebook_chance",
          "lorebook_order",
          "lorebook_placement",
          "lorebook_before",
          "lorebook_after",
          "lorebook_enabled",
          "lorebook_constant",
          "lorebook_channels",
          "lorebook_channels_hint",
          "lorebook_channels_dependency",
          "lorebook_channel_settings_link",
          "lorebook_new_book",
          "lorebook_book_name",
          "lorebook_rename",
          "lorebook_delete_book",
          "lorebook_delete_book_confirm",
          "lorebook_delete_entry_confirm",
          "lorebook_import",
          "lorebook_import_new",
          "lorebook_export",
          "lorebook_export_hint",
          "lorebook_append",
          "lorebook_replace",
          "lorebook_replace_confirm",
          "lorebook_import_receipt",
          "lorebook_saved",
          "lorebook_deleted",
          "lorebook_logic_any",
          "lorebook_logic_not_all",
          "lorebook_logic_not_any",
          "lorebook_logic_all",
          "lorebook_import_too_large",
          "lorebook_missing_channels",
          "lorebook_pending_channels",
          "overview_hint",
          "overview_personas",
          "overview_open_personas",
          "overview_persona_workspace",
          "overview_no_personas",
          "stats_title",
          "stats_history",
          "stats_history_model_filter",
          "stats_history_filter_error",
          "stats_history_selected_daily",
          "stats_history_selected_monthly",
          "stats_history_daily",
          "stats_history_monthly",
          "stats_history_peak",
          "stats_history_tokens",
          "stats_history_values",
          "stats_history_period",
          "stats_history_hint",
          "stats_history_error",
          "stats_server_total",
          "stats_scope_hint",
          "stats_models",
          "stats_models_hint",
          "stats_model_share",
          "stats_server_activity",
          "stats_server_activity_hint",
          "stats_model",
          "stats_input",
          "stats_output",
          "stats_total_tokens",
          "stats_cost",
          "stats_cost_unavailable",
          "stats_other_models",
          "stats_tokens_hint",
          "stats_cost_hint",
          "stats_replies",
          "stats_replies_hint",
          "stats_generations",
          "stats_generations_hint",
          "stats_personas",
          "stats_tools",
          "stats_commands",
          "stats_images",
          "stats_videos",
          "stats_top_five",
          "stats_reply_unit",
          "stats_use_unit",
          "stats_empty",
          "stats_timeframe",
          "stats_today",
          "stats_week",
          "stats_month",
          "stats_year",
          "stats_all_time",
          "stats_custom",
          "stats_from",
          "stats_through",
          "stats_apply_range",
          "stats_edit_range",
          "stats_range_hint",
          "stats_range_invalid",
          "stats_most_active_persona",
          "primary_models",
          "connection_actions",
          "lorebook_collection_actions",
          "lorebook_book_actions",
          "stats_loading",
          "stats_error",
          "stats_retry",
          "stats_showing",
          "navigation_more",
          "navigation_menu",
          "refresh_all",
          "refresh_memories",
          "refresh_providers",
          "appearance_saved",
          "design_title",
          "design_hint",
          "design_light",
          "design_dark",
          "design_glass",
          "design_palette",
          "design_color_mode",
          "design_colorful",
          "design_reduced",
          "design_angle",
          "design_angle_hint",
          "design_spread",
          "design_intensity",
          "design_motion",
          "design_motion_full",
          "design_motion_subtle",
          "design_motion_off",
          "design_reset",
          "control_adjust",
          "control_drop_file",
          "control_choose_file",
          "control_file_invalid",
          "control_file_ready",
          "control_choose_section",
          "control_close_dialog",
          "control_sections",
          "control_more",
          "control_hold_delete",
          "control_search_options",
          "control_no_matches",
          "control_keep_holding",
          "control_hold_confirmed",
          "persona_add_attribute",
          "persona_add_dialogue",
          "persona_attribute",
          "persona_attribute_public",
          "persona_dialogue_user",
          "persona_cancel",
          "persona_save",
          "persona_edit",
          "persona_delete_entry",
          "persona_choose",
          "persona_search",
          "persona_delete_attribute_detail",
          "persona_saved",
          "lorebook_back_entries",
          "lorebook_select_entry",
          "lorebook_edit_book",
          "lorebook_title_required",
          "lorebook_title_duplicate",
          "appearance_session_only",
          "sprites",
          "sprites_hint",
          "sprite_inherited",
          "sprite_name",
          "sprite_name_hint",
          "sprite_instructions",
          "sprite_instructions_hint",
          "sprite_identity",
          "sprite_identity_hint",
          "sprite_file",
          "sprite_file_hint",
          "sprite_add",
          "sprite_edit",
          "sprite_remove",
          "sprite_remove_title",
          "sprite_remove_detail",
          "sprite_add_detail",
          "sprite_import",
          "sprite_import_detail",
          "sprite_export",
          "sprite_exported",
          "sprite_empty",
          "sprite_retry",
          "sprite_loading",
          "sprite_load_failed",
          "sprite_image_missing",
          "navigation_switch",
          "navigation_close",
          "endpoint_features",
          "memory_server_transfer_unavailable",
          "memory_loading",
          "memory_add",
          "settings_search",
          "settings_search_placeholder",
          "settings_search_count",
          "settings_search_empty",
          "settings_search_partial",
          "character_reference",
          "character_reference_hint",
          "character_reference_upload",
          "character_reference_remove",
          "character_reference_saved",
          "character_reference_failed",
          "character_reference_invalid",
          "providers_loading",
          "provider_key_hint",
          "memory_personal_tags_hint",
          "provider_access",
          "provider_models",
          "connections",
          "connection_models_hint",
          "connection_credentials_hint",
          "connection_available_models_hint",
          "connections_hint",
          "add_provider",
          "connection_empty",
          "connection_select",
          "connection_provider",
          "connection_endpoint",
          "connection_credentials",
          "connection_replace_key",
          "connection_models",
          "connection_register_model",
          "connection_no_models",
          "connection_available_models",
          "connection_no_available_models",
          "model_routing",
          "connection_fallbacks",
          "personal_models",
          "personal_models_hint",
          "personal_model_unassigned",
          "personal_model_enabled",
          "personal_model_disabled",
          "personal_model_unavailable",
          "personal_model_choose",
          "personal_model_save",
          "personal_model_saved",
          "model_text",
          "model_vision",
          "model_embedding",
          "model_image",
          "model_image_nai",
          "model_video",
          "persona_model_title",
          "persona_model_hint",
          "persona_model_label",
          "persona_model_inherit",
          "persona_model_unavailable",
          "persona_model_loading",
          "persona_model_failed",
          "persona_model_save",
          "persona_model_saved",
          "persona_test_configured_model",
          "model_speech_design",
          "model_speech_clone",
          "model_transcription",
          "transcription_server_hint",
          "transcription_personal_hint",
          "transcription_disabled",
          "openrouter_transcription_hint",
          "openrouter_transcription_saved",
          "persona_humanizer_title",
          "persona_humanizer_hint",
          "persona_humanizer_source",
          "persona_humanizer_inherit",
          "persona_humanizer_custom",
          "personal_parameters",
          "personal_parameters_hint",
          "personal_parameters_empty",
          "personal_parameters_save",
          "personal_parameters_saved",
          "server_parameters",
          "server_parameters_hint",
          "server_parameters_saved",
          "parameter_temperature",
          "parameter_top_p",
          "parameter_top_k",
          "parameter_frequency_penalty",
          "parameter_presence_penalty",
          "parameter_min_p",
          "parameter_max_output_tokens",
          "parameter_thinking_level",
          "parameter_unset",
          "thinking_auto",
          "thinking_none",
          "thinking_minimal",
          "thinking_low",
          "thinking_medium",
          "thinking_high",
          "endpoint_register_new",
          "endpoint_cancel",
          "personal_fallbacks",
          "personal_fallbacks_hint",
          "server_fallbacks",
          "server_fallbacks_hint",
          "fallback_randomizer_hint",
          "fallback_unavailable",
          "fallback_saved",
          "switch_server",
          "server",
          "account",
          "log_out",
          "sprite_actions",
          "persona_delete_title",
          "persona_delete_description",
          "lorebook_partial_save",
          "fallback_chain_save_failed",
          "fallback_server_save_failed",
          "fallback_chain_saved",
          "fallback_server_saved",
          "connection_registered_models",
          "connection_remove_registration",
          "connection_remove_registration_title",
          "connection_remove_registration_hint",
          "connection_registration_removed",
          "endpoint_features_hint",
          "endpoint_tools",
          "endpoint_tools_hint",
          "endpoint_images",
          "endpoint_images_hint",
          "endpoint_videos",
          "endpoint_videos_hint",
          "endpoint_structured",
          "endpoint_structured_hint",
          "endpoint_roles",
          "endpoint_roles_hint",
          "endpoint_prefix",
          "endpoint_prefix_hint",
          "my_settings",
          "profile",
          "profile_hint",
          "privacy",
          "privacy_hint",
          "conversation",
          "conversation_hint",
          "memory",
          "learning",
          "learning_hint",
          "boundaries",
          "boundaries_hint",
          "channels",
          "channels_hint",
          "channel_settings",
          "channel_conversation",
          "channel_memory_context",
          "channel_autochat",
          "channel_none",
          "channel_keep",
          "channel_set",
          "channel_reset",
          "channel_choose",
          "channel_loading",
          "channel_load_failed",
          "channel_current",
          "channel_default",
          "channel_different",
          "channel_on_list",
          "channel_not_on_list",
          "channel_no_persona_rows",
          "channel_add_allowlist",
          "channel_remove_allowlist",
          "channel_textModel",
          "channel_textModel_hint",
          "channel_prompt",
          "channel_prompt_hint",
          "channel_prompt_mode",
          "channel_append",
          "channel_replace",
          "channel_contextNote",
          "channel_contextNote_hint",
          "channel_depth",
          "channel_allowlisted",
          "channel_allowlisted_hint",
          "channel_required",
          "channel_cooldown",
          "channel_cooldown_hint",
          "channel_cooldown_requires_allowlist",
          "channel_cooldown_type",
          "channel_cooldown_off",
          "channel_cooldown_user",
          "channel_cooldown_channel",
          "channel_cooldown_server",
          "channel_cooldown_strict",
          "channel_seconds",
          "channel_persona",
          "channel_persona_hint",
          "channel_autochatPersona",
          "channel_autochatPersona_hint",
          "channel_restrictions",
          "channel_restrictions_confirm",
          "nav_global",
          "nav_server_settings",
          "nav_server_administration",
          "channel_settings_hint",
          "channel_single_hint",
          "persona_channels",
          "channel_personas",
          "persona_channels_hint",
          "channel_personas_hint",
          "persona_channel_required",
          "all_personas_allowed",
          "persona_permissions_edit",
          "persona_permissions_search",
          "persona_permissions_mixed",
          "persona_permissions_cancel",
          "channel_search",
          "channel_select_all",
          "channel_deselect_all",
          "channel_selected",
          "channel_select_hint",
          "channel_mixed",
          "channel_enabled",
          "channel_disabled",
          "channel_on",
          "channel_off",
          "channel_enable",
          "channel_disable",
          "channel_batch_hint",
          "channel_apply",
          "channel_saved",
          "channel_empty",
          "channel_uncategorized",
          "tools",
          "tools_hint",
          "diagnostics",
          "diagnostics_hint",
          "models_hint",
          "output_hint",
          "settings_hint",
          "fallback",
          "fallback_hint",
          "save",
          "unsaved",
          "discard",
          "discard_title",
          "discard_detail",
          "refresh_detail",
          "leave_detail",
          "saving",
          "retry",
          "partial",
          "dismiss",
        ].map((key) => [key, localizer("en-US", `general.dashboard.interface_${key}`)]),
      ),
      profile: serializeProfile(result.actor),
      personas: result.snapshot.personas,
      personaNaming: {
        values: await core.loadPersonaNaming(result.actor.user.user_id, result.snapshot),
        maxLength: PERSONA_NAMING_VALUE_MAX_LENGTH,
        copy: {
          tab: localizer("en-US", "general.dashboard.naming_tab"),
          title: localizer("en-US", "general.dashboard.naming_title"),
          description: localizer("en-US", "general.dashboard.naming_description"),
          nickname: localizer("en-US", "general.dashboard.naming_nickname"),
          prefix: localizer("en-US", "general.dashboard.naming_prefix"),
          suffix: localizer("en-US", "general.dashboard.naming_suffix"),
          inherit: localizer("en-US", "general.dashboard.naming_inherit"),
          custom: localizer("en-US", "general.dashboard.naming_custom"),
          none: localizer("en-US", "general.dashboard.naming_none"),
          hint: localizer("en-US", "general.dashboard.naming_hint"),
          value: localizer("en-US", "general.dashboard.naming_value"),
          save: localizer("en-US", "general.dashboard.save"),
          reset: localizer("en-US", "general.dashboard.reset_defaults"),
          saved: localizer("en-US", "general.dashboard.naming_saved"),
          resetTitle: localizer("en-US", "general.dashboard.naming_reset"),
          resetDetail: localizer("en-US", "general.dashboard.naming_reset_detail"),
        },
      },
      channels,
      allowedChannelIds: await core.loadAllowedChannelIds(result.snapshot.serverId),
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
              : { type: "endpoint", label: entry.endpoint.label },
          ) ?? [],
      },
      settings: result.actor.canManage
        ? {
            catalog: getSettingsCatalog(),
            stmCategories: {
              values: await core.loadStmCategories(result.snapshot.serverId),
              copy: {
                title: localizer("en-US", "general.dashboard.stm_categories_title"),
                description: localizer("en-US", "general.dashboard.stm_categories_description"),
                label: localizer("en-US", "general.dashboard.stm_category_label"),
                categoryDescription: localizer("en-US", "general.dashboard.stm_category_description"),
                hint: localizer("en-US", "general.dashboard.stm_categories_hint"),
                warning: localizer("en-US", "general.dashboard.stm_categories_warning"),
                confirm: localizer("en-US", "general.dashboard.stm_categories_confirm"),
                save: localizer("en-US", "general.dashboard.save"),
                reset: localizer("en-US", "general.dashboard.reset_defaults"),
                saved: localizer("en-US", "general.dashboard.stm_categories_saved"),
                resetTitle: localizer("en-US", "general.dashboard.stm_categories_reset"),
                resetDetail: localizer("en-US", "general.dashboard.stm_categories_reset_detail"),
              },
            },
            values: serializeSettingsValues({
              ...result.snapshot.config,
              ...(await core.loadStmSettings(result.snapshot.serverId)),
            }),
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
    let range: { from: string; through: string } | undefined;
    if (requested === "custom") {
      const from = context.req.query("from") ?? "";
      const through = context.req.query("through") ?? "";
      const validDay = (day: string) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.startsWith("0000-")) return false;
        const parsed = new Date(`${day}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
      };
      if (!validDay(from) || !validDay(through) || from > through || through > new Date().toISOString().slice(0, 10)) {
        return jsonError(
          context,
          new DashboardServiceError("invalid_stats_range", 400, "Choose a valid statistics range."),
        );
      }
      range = { from, through };
    }
    try {
      return context.json({
        stats: await core.loadServerStats(result.snapshot, requested as DashboardStatsTimeframe, range),
      });
    } catch (error) {
      await log.error("Dashboard failed to load server statistics", error);
      return jsonError(context, "Server statistics could not be loaded.");
    }
  });

  app.get(`${BASE_PATH}/api/profile/character-reference`, async (context) => {
    const result = await requireActor(context, core, sessions, config);
    if (result instanceof Response) return result;
    const image = await core.loadUserCharacterReference(result.actor.user, result.actor.discordId);
    if (!image) return context.notFound();
    context.header("Cache-Control", "private, no-store");
    context.header("Content-Type", "image/png");
    return context.body(new Uint8Array(image));
  });

  app.on(
    ["PUT", "DELETE"],
    `${BASE_PATH}/api/profile/character-reference`,
    bodyLimit({ maxSize: MEDIA_LIMITS.MAX_MEDIA_SIZE_MB * 1024 * 1024 + 65536 }),
    async (context) => {
      const result = await requireActor(context, core, sessions, config);
      if (result instanceof Response) return result;
      const csrfError = requireMutationCsrf(context, result.session);
      if (csrfError) return csrfError;
      try {
        let buffer: Buffer | null = null;
        if (context.req.method === "PUT") {
          const { file } = await context.req.parseBody();
          if (
            !(file instanceof File) ||
            !file.type.startsWith("image/") ||
            file.size === 0 ||
            file.size > MEDIA_LIMITS.MAX_MEDIA_SIZE_MB * 1024 * 1024
          ) {
            throw new DashboardServiceError(
              "invalid_reference",
              422,
              localizer("en-US", "general.dashboard.interface_character_reference_invalid"),
            );
          }
          buffer = await convertToPNG(Buffer.from(await file.arrayBuffer()));
        }
        if (!(await core.replaceUserCharacterReference(result.actor.user, result.actor.discordId, buffer))) {
          throw new Error("Character reference storage failed");
        }
        return context.json({ hasCharacterReference: buffer !== null });
      } catch (error) {
        if (!(error instanceof DashboardServiceError)) log.warn("Dashboard character reference update failed", error);
        return jsonError(
          context,
          error instanceof DashboardServiceError
            ? error
            : localizer("en-US", "general.dashboard.interface_character_reference_failed"),
        );
      }
    },
  );

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
    if (kind === "server") {
      return jsonError(
        context,
        new DashboardServiceError(
          "server_memory_transfer_unavailable",
          409,
          "Server memory transfer is unavailable in the dashboard. Use Discord instead.",
        ),
      );
    }
    try {
      const payload = await memories.listPersonal(result.actor, result.snapshot, lineageId);
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
    try {
      await memories.assertCanAdd(result.actor, result.snapshot, parsed.data.lineageId, parsed.data.kind);
    } catch (error) {
      if (!(error instanceof DashboardServiceError)) {
        await log.error("Dashboard memory import authorization failed", error, undefined, { persist: false });
      }
      return jsonError(context, error instanceof DashboardServiceError ? error : "Memory import failed.");
    }
    if (parsed.data.kind === "server") {
      return jsonError(
        context,
        new DashboardServiceError(
          "server_memory_transfer_unavailable",
          409,
          "Server memory transfer is unavailable in the dashboard. Use Discord instead.",
        ),
      );
    }

    let inserted = 0;
    let skipped = 0;
    let invalid = 0;
    let failed = 0;
    const issues: Array<{ index: number; code: string }> = [];
    for (const [index, entry] of parsed.data.memories.entries()) {
      try {
        const input = memories.parseMutation(
          typeof entry === "object" && entry !== null && !Array.isArray(entry)
            ? { ...entry, lineageId: parsed.data.lineageId }
            : null,
        );
        await memories.addPersonal(result.actor, result.snapshot, input);
        inserted++;
      } catch (error) {
        if (error instanceof DashboardServiceError && error.code === "duplicate_memory") {
          skipped++;
          issues.push({ index, code: "duplicate_memory" });
        } else if (error instanceof DashboardServiceError && error.code === "invalid_memory") {
          invalid++;
          issues.push({ index, code: "invalid_memory" });
        } else {
          failed++;
          const code = error instanceof DashboardServiceError ? error.code : "import_failed";
          issues.push({ index, code });
          if (error instanceof DashboardServiceError && error.status < 500) {
            log.metric("dashboard_memory_import_refused", { code });
            log.warn("Dashboard memory import entry refused", { code, index });
          } else {
            await log.error("Dashboard memory import entry failed", error, undefined, { persist: false });
          }
        }
      }
    }
    return context.json({ inserted, skipped, invalid, failed, issues });
  });

  const lorebookRoot = `${BASE_PATH}/api/guilds/:guildId/lorebooks`;
  app.use(
    `${lorebookRoot}/import`,
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (context) =>
        lorebookError(context, new DashboardServiceError("lorebook_too_large", 413, "Lorebook import is too large.")),
    }),
  );

  app.get(lorebookRoot, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const raw = context.req.query("lineageId");
    const book = context.req.query("bookId");
    if (!raw || !/^\d+$/.test(raw) || (book !== undefined && !/^[1-9]\d*$/.test(book)))
      return lorebookError(context, new DashboardServiceError("invalid_lorebook", 422, "Invalid lorebook scope."));
    try {
      return context.json(
        await lorebooks.list(result.snapshot, Number(raw), book === undefined ? undefined : Number(book)),
      );
    } catch (error) {
      if (!(error instanceof DashboardServiceError))
        await log.error("Dashboard lorebook load failed", error, undefined, { persist: false });
      return lorebookError(context, error);
    }
  });

  app.get(`${lorebookRoot}/export`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const raw = context.req.query("lineageId");
    const book = context.req.query("bookId");
    if (!raw || !/^\d+$/.test(raw) || (book !== undefined && !/^[1-9]\d*$/.test(book)))
      return lorebookError(context, new DashboardServiceError("invalid_lorebook", 422, "Invalid lorebook scope."));
    try {
      return context.json(
        await lorebooks.export(result.snapshot, Number(raw), book === undefined ? undefined : Number(book)),
      );
    } catch (error) {
      if (!(error instanceof DashboardServiceError))
        await log.error("Dashboard lorebook export failed", error, undefined, { persist: false });
      return lorebookError(context, error);
    }
  });

  app.on(
    ["POST", "PATCH", "DELETE"],
    [
      `${lorebookRoot}/books`,
      `${lorebookRoot}/books/:bookId`,
      `${lorebookRoot}/entries`,
      `${lorebookRoot}/entries/:entryId`,
      `${lorebookRoot}/entries/:entryId/activation`,
      `${lorebookRoot}/entries/:entryId/flags`,
      `${lorebookRoot}/entries/:entryId/content`,
      `${lorebookRoot}/entries/:entryId/keys`,
      `${lorebookRoot}/entries/:entryId/channels`,
      `${lorebookRoot}/import`,
    ],
    async (context) => {
      const result = await requireGuildContext(context, client, core, sessions, config, true);
      if (result instanceof Response) return result;
      const csrfError = requireMutationCsrf(context, result.session);
      if (csrfError) return csrfError;
      const path = context.req.path;
      const method = context.req.method;
      const rawBook = context.req.param("bookId");
      const rawEntry = context.req.param("entryId");
      if ((rawBook && !/^[1-9]\d*$/.test(rawBook)) || (rawEntry && !/^[1-9]\d*$/.test(rawEntry)))
        return lorebookError(context, new DashboardServiceError("invalid_lorebook", 422, "Invalid lorebook request."));
      const allowed = new Set(client.guilds.cache.get(result.guild.id)?.channels.cache.keys() ?? []);
      try {
        if (path.endsWith("/import") && method === "POST")
          return context.json(
            await lorebooks.transfer(
              result.actor,
              result.snapshot,
              await context.req.json().catch(() => null),
              allowed,
            ),
          );
        if (path.endsWith("/books") && method === "POST")
          return context.json(
            await lorebooks.book(
              result.actor,
              result.snapshot,
              null,
              "create",
              await context.req.json().catch(() => null),
              allowed,
            ),
          );
        if (rawBook && (method === "PATCH" || method === "DELETE"))
          return context.json(
            await lorebooks.book(
              result.actor,
              result.snapshot,
              Number(rawBook),
              method === "PATCH" ? "edit" : "delete",
              method === "PATCH" ? await context.req.json().catch(() => null) : null,
              allowed,
            ),
          );
        if (path.endsWith("/entries") && method === "POST")
          return context.json(
            await lorebooks.entry(
              result.actor,
              result.snapshot,
              null,
              "add",
              await context.req.json().catch(() => null),
              allowed,
            ),
          );
        if (
          rawEntry &&
          (method === "PATCH" ||
            (method === "DELETE" &&
              !path.endsWith("/activation") &&
              !path.endsWith("/flags") &&
              !path.endsWith("/content") &&
              !path.endsWith("/keys") &&
              !path.endsWith("/channels")))
        ) {
          const raw = context.req.query("lineageId");
          const book = context.req.query("bookId");
          const payload =
            method === "DELETE"
              ? raw && /^\d+$/.test(raw) && (!book || /^[1-9]\d*$/.test(book))
                ? { lineageId: Number(raw), ...(book ? { bookId: Number(book) } : {}) }
                : null
              : await context.req.json().catch(() => null);
          const action =
            method === "DELETE"
              ? "delete"
              : path.endsWith("/activation")
                ? "activation"
                : path.endsWith("/flags")
                  ? "flags"
                  : path.endsWith("/content")
                    ? "content"
                    : path.endsWith("/keys")
                      ? "keys"
                      : path.endsWith("/channels")
                        ? "channels"
                        : "edit";
          return context.json(
            await lorebooks.entry(result.actor, result.snapshot, Number(rawEntry), action, payload, allowed),
          );
        }
        return context.notFound();
      } catch (error) {
        if (!(error instanceof DashboardServiceError))
          await log.error("Dashboard lorebook update failed", error, undefined, { persist: false });
        return lorebookError(context, error);
      }
    },
  );

  app.get(`${BASE_PATH}/api/guilds/:guildId/channel-settings`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const ids = [...new Set(context.req.queries("channelId") ?? [])];
    const available = new Set(
      serializeChannels(client.guilds.cache.get(result.guild.id)?.channels.cache.values() ?? []).map(
        (channel) => channel.id,
      ),
    );
    if (ids.length > 500 || ids.some((id) => !available.has(id)))
      return jsonError(
        context,
        new DashboardServiceError("invalid_channel_settings", 422, "Invalid channel settings."),
      );
    try {
      return context.json(await channelSettings.load(result.snapshot, ids));
    } catch (error) {
      await log.error("Dashboard channel settings load failed", error, undefined, { persist: false });
      return jsonError(context, "Channel settings could not be loaded.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/channel-settings`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const available = new Set(
      serializeChannels(client.guilds.cache.get(result.guild.id)?.channels.cache.values() ?? []).map(
        (channel) => channel.id,
      ),
    );
    try {
      return context.json(
        await channelSettings.patch(result.snapshot, await context.req.json().catch(() => null), available),
      );
    } catch (error) {
      if (!(error instanceof DashboardServiceError))
        await log.error("Dashboard channel settings save failed", error, undefined, { persist: false });
      return jsonError(
        context,
        error instanceof DashboardServiceError ? error : "Channel settings could not be saved.",
      );
    }
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

  app.patch(`${BASE_PATH}/api/guilds/:guildId/providers/server/parameters`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      await providers.setServerParameters(result.snapshot, await context.req.json().catch(() => null));
      return context.json({ saved: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server parameters update failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/providers/personal/parameters`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      await providers.setPersonalParameters(result.actor, await context.req.json().catch(() => null));
      return context.json({ saved: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Personal parameters update failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/providers/personal/model`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      await providers.setPersonalModel(result.actor, await context.req.json().catch(() => null));
      return context.json({ saved: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Personal model update failed.");
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

  app.patch(`${BASE_PATH}/api/guilds/:guildId/providers/personal/fallbacks`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, false);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      const refs = await providers.setPersonalFallbacks(result.actor, await context.req.json().catch(() => null));
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

  app.put(`${BASE_PATH}/api/guilds/:guildId/stm/categories`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    try {
      const categories = await settings.updateStmCategories(
        result.snapshot,
        await context.req.json().catch(() => null),
      );
      return context.json({ categories });
    } catch (error) {
      if (!(error instanceof DashboardServiceError)) log.error("Dashboard STM category update failed", error);
      return jsonError(
        context,
        error instanceof DashboardServiceError ? error : localizer("en-US", "general.dashboard.stm_categories_failed"),
      );
    }
  });

  app.put(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/naming`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = Number(context.req.param("personaId"));
    try {
      const preference = await settings.updatePersonaNaming(
        result.snapshot,
        result.actor.user,
        personaId,
        await context.req.json().catch(() => null),
      );
      return context.json({ preference });
    } catch (error) {
      if (!(error instanceof DashboardServiceError)) log.error("Dashboard persona naming update failed", error);
      return jsonError(
        context,
        error instanceof DashboardServiceError ? error : localizer("en-US", "general.dashboard.naming_failed"),
      );
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

  const spriteRoot = `${BASE_PATH}/api/guilds/:guildId/personas/:personaId/sprites`;
  const spriteGuard: MiddlewareHandler<DashboardEnv> = async (context, next) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    if (context.req.method !== "GET") {
      const csrfError = requireMutationCsrf(context, result.session);
      if (csrfError) return csrfError;
    }
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId) return context.notFound();
    sprites.persona(result.snapshot, personaId);
    context.set("spriteContext", { snapshot: result.snapshot, personaId, actorDiscordId: result.actor.discordId });
    context.header("Cache-Control", "private, no-store");
    await next();
  };
  app.use(spriteRoot, spriteGuard);
  app.use(`${spriteRoot}/*`, spriteGuard);
  const spriteBodyLimit = bodyLimit({
    maxSize: SPRITE_UPLOAD_MAX_BYTES + 64 * 1024,
    onError: (context) =>
      jsonError(
        context,
        new DashboardServiceError("sprite_size", 413, localizer("en-US", "general.dashboard.sprite_errors.size")),
      ),
  });
  app.use(spriteRoot, spriteBodyLimit);
  app.use(`${spriteRoot}/*`, spriteBodyLimit);
  app.get(spriteRoot, async (context) => {
    const { snapshot, personaId } = context.get("spriteContext");
    return context.json(await sprites.list(snapshot, personaId));
  });
  app.on(["POST", "PUT"], spriteRoot, async (context) => {
    const { snapshot, personaId } = context.get("spriteContext");
    const key = context.req.method === "PUT" ? context.req.query("key") : null;
    if (key === undefined || key === "") return context.notFound();
    return context.json(await sprites.save(snapshot, personaId, key, await context.req.parseBody({ all: true })));
  });
  app.delete(spriteRoot, async (context) => {
    const { snapshot, personaId } = context.get("spriteContext");
    const key = context.req.query("key");
    if (!key) return context.notFound();
    return context.json(await sprites.remove(snapshot, personaId, key));
  });
  app.post(`${spriteRoot}/import`, async (context) => {
    const { snapshot, personaId, actorDiscordId } = context.get("spriteContext");
    const body = await context.req.parseBody({ all: true });
    return context.json(await sprites.import(snapshot, personaId, actorDiscordId, body.file));
  });
  app.get(`${spriteRoot}/export`, async (context) => {
    const { snapshot, personaId } = context.get("spriteContext");
    const result = await sprites.export(snapshot, personaId);
    context.header("Content-Type", "application/zip");
    context.header("Content-Disposition", `attachment; filename="${result.filename}"`);
    context.header("X-Sprite-Skipped", String(result.skippedCount));
    return context.body(new Uint8Array(result.buffer));
  });
  app.get(`${spriteRoot}/image`, async (context) => {
    const { snapshot, personaId } = context.get("spriteContext");
    const key = context.req.query("key");
    if (!key) return context.notFound();
    context.header("Content-Type", "image/png");
    return context.body(new Uint8Array(await sprites.image(snapshot, personaId, key)));
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/text-model`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId) return jsonError(context, new DashboardServiceError("invalid_persona", 422, "Invalid persona."));
    try {
      return context.json(await providers.loadPersonaTextModel(result.snapshot, personaId));
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Persona model load failed.");
    }
  });

  app.put(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/text-model`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId) return jsonError(context, new DashboardServiceError("invalid_persona", 422, "Invalid persona."));
    try {
      await providers.setPersonaTextModel(result.snapshot, personaId, await context.req.json().catch(() => null));
      return context.json({ saved: true });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Persona model update failed.");
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
    const parsedSection = personaSettingsSectionSchema.safeParse(context.req.param("section"));
    if (!personaId || !parsedSection.success) {
      return jsonError(context, new DashboardServiceError("invalid_persona", 422, "Invalid persona update."));
    }
    try {
      const body = await context.req.json().catch(() => null);
      const section = parsedSection.data;
      await settings.updatePersona(result.snapshot, personaId, section, body);
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
    if (!(await assertGuildAccess(session, client, guildId, core))) {
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
    if (error instanceof DashboardServiceError) return jsonError(context, error);
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
