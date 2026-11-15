import {
  ChannelType,
  DiscordAPIError,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  type Client,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
} from "discord.js";
import { resolve } from "node:path";
import type { Context, MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { z } from "zod";
import { log } from "@/utils/misc/logger";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { getStmCount } from "@/utils/discord/interactions/personalConfigLoaders";
import { personalMemoriesOperations } from "@/utils/discord/interactions/personalMemoriesRoutes";
import { MEDIA_LIMITS } from "@/utils/security/rateLimiter";
import { getLocaleEndonym, getSupportedLocales, localizer, resolveSupportedLocale } from "@/utils/text/localizer";
import {
  addressingStyleSchema,
  PERSONA_NAMING_VALUE_MAX_LENGTH,
  USER_IDENTITY_FIELD_MAX_LENGTH,
  USER_NICKNAME_MAX_LENGTH,
} from "@/types/personaNaming";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
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
import { listModerationSettings, updateModerationSettings } from "./moderationService";
import { DashboardLorebookService } from "./lorebookService";
import { DashboardProviderService, ENDPOINT_WORKFLOW_MAX_BYTES } from "./providerService";
import { DashboardPersonaChatService } from "./personaChatService";
import {
  DashboardPersonaService,
  PERSONA_ATTG_MAX_LENGTH,
  PERSONA_IMPORT_MAX_BYTES,
  PERSONA_REFERENCE_MAX_BYTES,
} from "./personaService";
import { DashboardSpriteService, SPRITE_UPLOAD_MAX_BYTES } from "./spriteService";
import { getDashboardRuntimeConfig } from "./runtimeConfig";
import { getSettingsCatalog, isSettingsSectionId, serializeSettingsValues } from "./settingsCatalog";
import { DashboardSettingsService, personaSettingsSectionSchema } from "./settingsService";
import {
  loadRandomTriggers,
  loadSystemPromptChoices,
  loadToolTriggers,
  removeRandomTrigger,
  saveRandomTrigger,
  updateToolTriggers,
} from "./serverBehaviorService";
import { listPersonalSpotlights, removePersonalSpotlight, savePersonalSpotlight } from "./spotlightService";
import {
  removeServerLogitBias,
  saveServerLogitBias,
  serializeLogitBias,
  setAdvancedServerModel,
} from "./serverModelService";
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
const LOGIT_BIAS_IMPORT_BYTES = 2 * 1024 * 1024;
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
  "quarter",
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
  "collection.css": { path: "src/web/dashboard/assets/collection.css", contentType: "text/css; charset=utf-8" },
  "design.js": { path: "src/web/dashboard/assets/design.js", contentType: "application/javascript; charset=utf-8" },
  "fx.js": { path: "src/web/dashboard/assets/fx.js", contentType: "application/javascript; charset=utf-8" },
  "app.css": { path: "src/web/dashboard/assets/app.css", contentType: "text/css; charset=utf-8" },
  "companion.css": { path: "src/web/dashboard/assets/companion.css", contentType: "text/css; charset=utf-8" },
  "app.js": { path: "src/web/dashboard/assets/app.js", contentType: "application/javascript; charset=utf-8" },
  "persona-art-tomori.png": { path: "src/web/dashboard/assets/persona-art-tomori.png", contentType: "image/png" },
  "persona-art-nerine.png": { path: "src/web/dashboard/assets/persona-art-nerine.png", contentType: "image/png" },
  "persona-art-aphel.png": { path: "src/web/dashboard/assets/persona-art-aphel.png", contentType: "image/png" },
  "persona-art-lilya.png": { path: "src/web/dashboard/assets/persona-art-lilya.png", contentType: "image/png" },
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
      prefix: localizer("en-US", "commands.personal.config.modal_prefix_label"),
      prefixHint: localizer("en-US", "commands.personal.config.modal_prefix_description"),
      suffix: localizer("en-US", "commands.personal.config.modal_suffix_label"),
      suffixHint: localizer("en-US", "commands.personal.config.modal_suffix_description"),
      addressingStyle: localizer("en-US", "commands.personal.config.modal_style_label"),
      addressingStyleHint: localizer("en-US", "commands.personal.config.modal_style_description"),
      styleDefault: localizer("en-US", "general.dashboard.style_default"),
      styleMasculine: localizer("en-US", "commands.personal.config.style_masculine"),
      styleFeminine: localizer("en-US", "commands.personal.config.style_feminine"),
      styleNeutral: localizer("en-US", "commands.personal.config.style_neutral"),
    },
    limits: {
      nickname: USER_NICKNAME_MAX_LENGTH,
      identity: USER_IDENTITY_FIELD_MAX_LENGTH,
      affix: PERSONA_NAMING_VALUE_MAX_LENGTH,
    },
    genderIdentity: actor.user.gender_identity ?? null,
    pronouns: actor.user.pronouns ?? null,
    addressingStyle: actor.user.addressing_style ?? null,
    nickname: actor.user.user_nickname,
    prefix: actor.user.prefix_override ?? null,
    suffix: actor.user.suffix_override ?? null,
    language: resolveSupportedLocale(actor.user.language_pref),
    languages: getSupportedLocales().map((value) => ({ value, label: getLocaleEndonym(value) })),
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

async function fetchDashboardGuildMember(guild: Guild, userId: string) {
  try {
    return await guild.members.fetch({ user: userId, force: true });
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownMember) return null;
    throw error;
  }
}

function canViewDashboardChannel(channel: GuildBasedChannel, member: GuildMember) {
  return channel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) === true;
}

function isDashboardTextChannel(channel: GuildBasedChannel) {
  return channel.isTextBased() && !channel.isThread();
}

function dashboardChannelIds(channels: Iterable<GuildBasedChannel>) {
  return new Set(
    Array.from(channels)
      .filter(isDashboardTextChannel)
      .map((channel) => channel.id),
  );
}

function serializeChannels(channels: Iterable<GuildBasedChannel>, member: GuildMember) {
  return Array.from(channels)
    .filter((channel) => isDashboardTextChannel(channel) && canViewDashboardChannel(channel, member))
    .map((channel) => {
      const parent = channel.parent;
      const visibleParent = parent && canViewDashboardChannel(parent, member) ? parent : null;
      return {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: visibleParent?.id ?? null,
        parentName: visibleParent?.name ?? null,
        parentPosition: visibleParent?.position ?? -1,
        position: "position" in channel ? channel.position : 0,
      };
    })
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

  const requireSpotlightContext = async (context: Context) => {
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    if (context.req.method !== "GET") {
      const csrfError = requireMutationCsrf(context, result.session);
      if (csrfError) return csrfError;
    }
    const guild = result.guild.isDirectMessage ? undefined : client.guilds.cache.get(result.guild.id);
    const unavailable = () =>
      jsonError(
        context,
        new DashboardServiceError(
          "spotlight_guild_unavailable",
          403,
          localizer("en-US", "general.dashboard.spotlight_guild_unavailable"),
        ),
      );
    if (!guild) return unavailable();
    const member = await fetchDashboardGuildMember(guild, result.actor.discordId);
    return member ? { ...result, guild, member } : unavailable();
  };

  const spotlightChannels = ({
    guild,
    member,
  }: Exclude<Awaited<ReturnType<typeof requireSpotlightContext>>, Response>) =>
    guild.channels.cache.filter(
      (channel) => channel.type === ChannelType.GuildText && canViewDashboardChannel(channel, member),
    );

  const requireModerationContext = async (context: Context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    if (context.req.method !== "GET") {
      const csrfError = requireMutationCsrf(context, result.session);
      if (csrfError) return csrfError;
    }
    const guild = result.guild.isDirectMessage ? undefined : client.guilds.cache.get(result.guild.id);
    const member = guild && (await fetchDashboardGuildMember(guild, result.actor.discordId));
    if (!guild || !member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return jsonError(
        context,
        new DashboardServiceError(
          "moderation_admin_required",
          403,
          localizer("en-US", "general.dashboard.moderation_admin_required"),
        ),
      );
    }
    return { guild, serverId: result.snapshot.serverId };
  };

  const requirePersonaManager = async (context: Context, allowDirectMessages: boolean) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    if (context.req.method !== "GET") {
      const csrfError = requireMutationCsrf(context, result.session);
      if (csrfError) return csrfError;
    }
    if (result.guild.isDirectMessage && allowDirectMessages) return result;
    const guild = result.guild.isDirectMessage ? undefined : client.guilds.cache.get(result.guild.id);
    const member = guild && (await fetchDashboardGuildMember(guild, result.actor.discordId));
    if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      throw new DashboardServiceError(
        "persona_manager_required",
        403,
        localizer("en-US", "general.dashboard.persona_manager_required"),
      );
    }
    return result;
  };

  const requireProviderConnectionContext = async (context: Context, scope: "server" | "personal") => {
    const result = await requireGuildContext(context, client, core, sessions, config, scope === "server");
    if (result instanceof Response) return result;
    if (context.req.method !== "GET") {
      const csrfError = requireMutationCsrf(context, result.session);
      if (csrfError) return csrfError;
    }
    if (scope === "server" && !result.guild.isDirectMessage) {
      const guild = client.guilds.cache.get(result.guild.id);
      const member = guild && (await fetchDashboardGuildMember(guild, result.actor.discordId));
      if (!member?.permissions.has(PermissionFlagsBits.ManageGuild))
        throw new DashboardServiceError(
          "admin_required",
          403,
          localizer("en-US", "general.dashboard.provider_connection_admin_required"),
        );
    }
    return result;
  };

  const requireServerBehaviorContext = async (context: Context, channelBound = false) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    if (context.req.method !== "GET") {
      const csrfError = requireMutationCsrf(context, result.session);
      if (csrfError) return csrfError;
    }
    if (result.guild.isDirectMessage && !channelBound) return { ...result, channels: [] };
    const guild = client.guilds.cache.get(result.guild.id);
    const member = guild && (await fetchDashboardGuildMember(guild, result.actor.discordId));
    if (!guild || !member?.permissions.has(PermissionFlagsBits.ManageGuild))
      throw new DashboardServiceError(
        "admin_required",
        403,
        localizer("en-US", "general.dashboard.behavior_admin_required"),
      );
    const channels = channelBound
      ? serializeChannels(
          [...guild.channels.cache.values()].filter((channel) => channel.type === ChannelType.GuildText),
          member,
        )
      : [];
    return { ...result, channels };
  };

  const requireServerMemoryContext = async (context: Context) => {
    context.header("Cache-Control", "private, no-store");
    const result = await requireGuildContext(context, client, core, sessions, config);
    if (result instanceof Response) return result;
    if (context.req.method !== "GET") {
      const csrfError = requireMutationCsrf(context, result.session);
      if (csrfError) return csrfError;
    }
    if (result.guild.isDirectMessage) return { ...result, channels: [], selectableChannels: new Set<string>() };
    const guild = client.guilds.cache.get(result.guild.id);
    const member = guild && (await fetchDashboardGuildMember(guild, result.actor.discordId));
    if (!guild || !member)
      throw new DashboardServiceError(
        "guild_forbidden",
        403,
        localizer("en-US", "general.dashboard.server_memory_server_unavailable"),
      );
    const allowed = new Set(
      context.req.method === "DELETE" ? [] : await core.loadAllowedChannelIds(result.snapshot.serverId),
    );
    const channels =
      context.req.method === "DELETE"
        ? []
        : serializeChannels(guild.channels.cache.values(), member).filter(
            ({ id, type }) =>
              (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement) &&
              (!allowed.size || allowed.has(id)),
          );
    return {
      ...result,
      actor: { ...result.actor, canManage: member.permissions.has(PermissionFlagsBits.ManageGuild) },
      channels,
      selectableChannels: new Set(channels.map(({ id }) => id)),
    };
  };

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
    const signedIn = getSession(context, config, sessions) !== null;
    return context.json({
      entries: entries
        .filter((entry) => entry.kind === "page" || entry.showOnLogin || signedIn)
        .map(({ id, kind, title, url, showOnLogin, showInSidebar }) => ({
          id,
          kind,
          title,
          url,
          showOnLogin,
          showInSidebar,
        })),
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
      .filter((entry) => entry.kind === "page" || entry.showOnLogin)
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
        assetName === "collection.css" ||
        assetName === "design.js" ||
        assetName === "fx.js" ||
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
    setSignedCookie(context, config, OAUTH_STATE_COOKIE, state, OAUTH_STATE_TTL_SECONDS);
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
    const cachedGuild = result.guild.isDirectMessage ? undefined : client.guilds.cache.get(result.guild.id);
    const member = cachedGuild ? await fetchDashboardGuildMember(cachedGuild, result.actor.discordId) : null;
    if (cachedGuild && !member) {
      return jsonError(context, new DashboardServiceError("guild_forbidden", 403, "This server is not available."));
    }
    const channels = cachedGuild && member ? serializeChannels(cachedGuild.channels.cache.values(), member) : [];
    const visibleChannelIds = new Set(channels.map((channel) => channel.id));
    const allowedChannelIds = await core.loadAllowedChannelIds(result.snapshot.serverId);
    const mainPersona = result.snapshot.rawPersonas[0];
    const canManageGuildPersonas = result.actor.canManage && member?.permissions.has(PermissionFlagsBits.ManageGuild);

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
          "lorebook_book_count_one",
          "lorebook_book_count",
          "lorebook_collection_entry_count_one",
          "lorebook_collection_entry_count",
          "lorebook_book_channel_scope",
          "lorebook_entry_enabled",
          "lorebook_edit_entry",
          "lorebook_view_entry",
          "lorebook_edit_named",
          "lorebook_view_named",
          "lorebook_keyword_match",
          "lorebook_never",
          "lorebook_channel_count",
          "lorebook_channel_one",
          "lorebook_triggers",
          "lorebook_triggers_keys_hint",
          "lorebook_advanced",
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
          "overview_persona_count",
          "overview_persona_count_one",
          "overview_member_count",
          "overview_member_count_one",
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
          "stats_quarter",
          "stats_year",
          "stats_all_time",
          "stats_custom",
          "stats_actions",
          "stats_from",
          "stats_through",
          "stats_apply_range",
          "stats_edit_range",
          "stats_range_hint",
          "stats_range_invalid",
          "stats_most_active_persona",
          "primary_models",
          "connection_actions",
          "connection_active_text",
          "connection_remove_server_provider",
          "connection_remove_server_provider_title",
          "connection_remove_server_provider_hint",
          "connection_server_provider_removed",
          "system_prompt_label",
          "system_prompt_presets",
          "system_prompt_preset",
          "system_prompt_default",
          "system_prompt_preview",
          "system_prompt_use_preset",
          "system_prompt_locked",
          "tool_phrases",
          "tool_phrases_hint",
          "tool_phrase_target",
          "tool_phrase_literal",
          "tool_phrase_add",
          "tool_phrase_regex",
          "tool_phrase_remove",
          "tool_phrase_empty",
          "tool_phrase_saved",
          "random_schedules",
          "random_schedules_hint",
          "random_schedule_channel",
          "random_schedule_persona",
          "random_schedule_next",
          "random_schedule_add",
          "random_schedule_edit",
          "random_schedule_edit_hint",
          "random_schedule_remove",
          "random_schedule_remove_hint",
          "random_schedule_removed",
          "random_schedule_saved",
          "random_schedule_empty",
          "random_schedule_choose_channel",
          "random_schedule_any_persona",
          "random_schedule_interval",
          "random_schedule_chance",
          "random_schedule_jitter",
          "random_schedule_silence",
          "random_schedule_failures",
          "random_schedule_respond_self",
          "random_schedule_prompt",
          "random_schedule_prompt_hint",
          "brave_search_key_hint",
          "brave_search_remove_hint",
          "rotation_title",
          "rotation_count",
          "rotation_key",
          "rotation_key_hint",
          "rotation_added",
          "rotation_clear",
          "rotation_clear_hint",
          "rotation_cleared",
          "endpoint_model_edit",
          "endpoint_model_name",
          "endpoint_model_context",
          "endpoint_model_input_limit",
          "endpoint_model_personal_routing_hint",
          "endpoint_model_prefix_completion",
          "endpoint_model_prefix_completion_hint",
          "endpoint_model_prefill",
          "endpoint_model_prefill_hint",
          "endpoint_model_verbatim",
          "endpoint_model_verbatim_hint",
          "endpoint_model_image_supports",
          "endpoint_model_txt2img",
          "endpoint_model_img2img",
          "endpoint_model_inpaint",
          "endpoint_model_negative_prompt",
          "endpoint_model_voice_mode",
          "endpoint_model_script_markup",
          "endpoint_model_voice_clone",
          "endpoint_model_voice_design",
          "endpoint_model_voice_auto",
          "endpoint_model_markup_plain",
          "endpoint_model_markup_brackets",
          "endpoint_model_markup_emoji",
          "endpoint_model_voice_instruct",
          "endpoint_model_workflow",
          "endpoint_model_workflow_hint",
          "endpoint_model_workflow_invalid",
          "endpoint_model_saved",
          "lorebook_collection_actions",
          "lorebook_book_actions",
          "stats_loading",
          "stats_error",
          "stats_retry",
          "stats_refresh",
          "stats_showing",
          "navigation_more",
          "navigation_menu",
          "refresh_all",
          "refresh_memories",
          "global_memory_hint",
          "personal_stm",
          "personal_stm_hint",
          "personal_stm_count",
          "personal_stm_load_failed",
          "personal_stm_clear",
          "personal_stm_confirm_title",
          "personal_stm_confirm_detail",
          "personal_stm_clear_requested",
          "refresh_providers",
          "appearance_forget_failed",
          "design_title",
          "design_hint",
          "design_remember",
          "design_remember_hint",
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
          "design_persona_colors",
          "design_lighting",
          "design_layout",
          "design_layout_boxed",
          "design_layout_full",
          "control_more_sections",
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
          "sprite_upload_image",
          "sprite_file_hint",
          "sprite_add",
          "sprite_edit",
          "sprite_editor_title",
          "sprite_delete_action",
          "persona_avatar_title",
          "persona_avatar_change",
          "persona_avatar_remove",
          "persona_avatar_remove_title",
          "persona_avatar_remove_detail",
          "persona_avatar_removed",
          "confirm_action",
          "sprite_remove",
          "sprite_remove_title",
          "sprite_remove_detail",
          "sprite_add_detail",
          "sprite_import",
          "sprite_import_detail",
          "sprite_export",
          "sprite_exported",
          "persona_actions",
          "persona_export_png",
          "persona_export_json",
          "persona_main_change",
          "persona_main_label",
          "persona_main_source",
          "persona_main_preset",
          "persona_main_card",
          "persona_main_choose_preset",
          "persona_main_no_presets",
          "persona_main_file",
          "persona_main_identity",
          "persona_main_identity_fork",
          "persona_main_identity_preserve",
          "persona_main_review",
          "persona_main_back",
          "persona_main_confirm",
          "persona_main_review_summary",
          "persona_main_lineage",
          "persona_main_lineage_new",
          "persona_main_memories",
          "persona_main_memories_same",
          "persona_main_memories_new",
          "persona_main_memories_switch",
          "persona_main_memories_global",
          "persona_main_lore",
          "persona_main_lore_keep",
          "persona_main_lore_replace",
          "persona_main_lore_clear",
          "persona_main_lore_previous",
          "persona_main_lore_server",
          "persona_main_shared",
          "persona_main_preset_media",
          "persona_main_card_media",
          "persona_main_changed",
          "persona_main_sync_warning",
          "sprite_empty",
          "sprite_retry",
          "sprite_loading",
          "sprite_load_failed",
          "sprite_image_missing",
          "navigation_switch",
          "navigation_close",
          "endpoint_features",
          "memory_server_transfer_unavailable",
          "memory_channels",
          "memory_channels_all",
          "memory_channels_limit",
          "memory_channels_hint",
          "memory_channels_inactive",
          "memory_channels_unavailable",
          "memory_channels_unavailable_count",
          "memory_channels_pending",
          "memory_channels_required",
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
          "provider_other",
          "provider_store_key",
          "endpoint_test_register",
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
          "personas_title",
          "persona_settings_tab",
          "persona_appearance_tab",
          "persona_identity_title",
          "persona_identity_hint",
          "persona_nickname",
          "persona_nickname_hint",
          "persona_triggers_title",
          "persona_triggers_hint",
          "persona_triggers_add",
          "persona_chip_remove",
          "persona_attributes_title",
          "persona_attributes_empty",
          "persona_dialogues_title",
          "persona_dialogues_empty",
          "persona_context_title",
          "persona_context_hint",
          "persona_context_field",
          "persona_context_depth",
          "persona_context_depth_hint",
          "persona_delete_alter",
          "persona_delete_alter_hint",
          "persona_appearance_tags",
          "persona_appearance_tags_hint",
          "persona_appearance_add",
          "persona_visual_prompt",
          "persona_visual_prompt_hint",
          "persona_visual_description",
          "persona_trigger_chip",
          "persona_memories_search",
          "persona_memories_no_matches",
          "persona_memory_actions",
          "persona_memory_import",
          "persona_memory_export",
          "persona_memory_summary",
          "persona_memory_capacity",
          "persona_memory_empty",
          "persona_none",
          "persona_create",
          "persona_import_action",
          "persona_all",
          "persona_alter_label",
          "persona_test_open",
          "persona_test_close",
          "persona_test_private",
          "persona_test_reset",
          "persona_test_empty",
          "persona_test_message",
          "persona_test_send",
          "persona_model_loading",
          "persona_model_failed",
          "persona_model_save",
          "persona_model_saved",
          "persona_test_configured_model",
          "model_speech_design",
          "model_speech_clone",
          "model_decision",
          "advanced_models",
          "advanced_models_hint",
          "advanced_models_saved",
          "advanced_model_unset",
          "advanced_model_unavailable",
          "decision_model_hint",
          "speech_design_model_hint",
          "speech_clone_model_hint",
          "logit_bias",
          "logit_bias_hint",
          "logit_add",
          "logit_import",
          "logit_import_file",
          "logit_import_hint",
          "logit_import_invalid",
          "logit_empty",
          "logit_term",
          "logit_terms",
          "logit_terms_hint",
          "logit_value",
          "logit_value_hint",
          "logit_token_id",
          "logit_remove",
          "logit_remove_title",
          "logit_remove_hint",
          "logit_saved",
          "logit_removed",
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
          "persona_habits_title",
          "persona_habits_hint",
          "persona_habits_style",
          "persona_habits_prefix",
          "persona_habits_suffix",
          "persona_habits_term",
          "persona_habits_term_hint",
          "persona_habits_neutral_hint",
          "persona_habits_saved",
          "persona_knowledge",
          "persona_personal_memory",
          "persona_server_memory",
          "persona_conditioning_tab",
          "persona_conditioning_title",
          "persona_conditioning_hint",
          "persona_conditioning_empty",
          "persona_conditioning_reward",
          "persona_conditioning_punishment",
          "persona_conditioning_count",
          "persona_conditioning_remove",
          "persona_conditioning_remove_title",
          "persona_conditioning_remove_hint",
          "persona_conditioning_removed",
          "persona_reference_title",
          "persona_reference_hint",
          "persona_reference_saved",
          "persona_reference_remove_title",
          "persona_reference_remove_hint",
          "persona_reference_removed",
          "persona_voice_title",
          "persona_voice_status",
          "persona_voice_refresh",
          "persona_naming_defaults",
          "persona_channel_behavior",
          "persona_channel_count",
          "persona_picker_no_results",
          "persona_picker_sort",
          "persona_picker_sort_name",
          "persona_picker_sort_default",
          "persona_conditioning_refresh",
          "persona_avatar_and_reference",
          "persona_voice_hint",
          "persona_voice_priority",
          "persona_voice_priority_hint",
          "persona_voice_design",
          "persona_voice_clone",
          "persona_voice_design_prompt",
          "persona_voice_design_hint",
          "persona_voice_sample",
          "persona_voice_provider",
          "persona_voice_unassigned",
          "persona_voice_unavailable",
          "persona_voice_catalog_unavailable",
          "persona_voice_effective",
          "persona_voice_fallback",
          "persona_voice_no_source",
          "persona_voice_saved",
          "persona_attg_title",
          "persona_attg_hint",
          "persona_attg_author",
          "persona_attg_work_title",
          "persona_attg_tags",
          "persona_attg_genre",
          "persona_attg_stars",
          "persona_attg_unrated",
          "persona_attg_stars_hint",
          "persona_attg_saved",
          "persona_preset_title",
          "persona_preset_hint",
          "persona_preset_linked",
          "persona_preset_local",
          "persona_preset_missing",
          "persona_preset_original",
          "persona_preset_resync",
          "persona_preset_confirm_title",
          "persona_preset_confirm_local",
          "persona_preset_confirm_linked",
          "persona_preset_saved",
          "persona_preset_partial",
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
          "endpoint_edit",
          "endpoint_edit_hint",
          "endpoint_edit_preset_hint",
          "endpoint_edit_label",
          "endpoint_edit_url",
          "endpoint_edit_url_hint",
          "endpoint_edit_token",
          "endpoint_edit_token_hint",
          "endpoint_edit_handoff",
          "endpoint_edit_handoff_hint",
          "endpoint_edit_saved",
          "endpoint_edit_unchanged",
          "personal_fallbacks",
          "personal_fallbacks_hint",
          "server_fallbacks",
          "server_fallbacks_hint",
          "personal_randomizer",
          "personal_randomizer_hint",
          "personal_randomizer_requires_fallbacks",
          "personal_randomizer_saved",
          "quick_capabilities",
          "quick_capabilities_hint",
          "quick_capabilities_empty",
          "quick_capability_saved",
          "spotlights",
          "spotlights_hint",
          "spotlights_empty",
          "spotlight_active",
          "spotlight_active_short",
          "spotlight_inactive",
          "spotlight_refresh",
          "spotlight_add",
          "spotlight_edit",
          "spotlight_remove",
          "spotlight_remove_title",
          "spotlight_remove_hint",
          "spotlight_channel",
          "spotlight_channel_unavailable",
          "spotlight_unavailable_hint",
          "spotlight_no_channels",
          "spotlight_personas",
          "spotlight_choose_personas",
          "spotlight_search_personas",
          "spotlight_auto",
          "spotlight_auto_hint",
          "spotlight_auto_none",
          "spotlight_hours",
          "spotlight_hours_hint",
          "spotlight_keep_expiry",
          "spotlight_permanent",
          "spotlight_saved",
          "spotlight_removed",
          "moderation",
          "moderation_hint",
          "moderation_roles",
          "moderation_roles_hint",
          "moderation_roles_empty",
          "moderation_roles_search",
          "moderation_role_column",
          "moderation_role_unavailable",
          "moderation_add_role",
          "moderation_add_role_hint",
          "moderation_role",
          "moderation_remove_role",
          "moderation_remove_role_hint",
          "moderation_server_blocks",
          "moderation_server_blocks_hint",
          "moderation_server_blocks_empty",
          "moderation_persona_blocks",
          "moderation_persona_blocks_hint",
          "moderation_persona_blocks_empty",
          "moderation_persona_mute",
          "moderation_persona_block",
          "moderation_expires",
          "moderation_expires_column",
          "moderation_member_column",
          "moderation_persona_column",
          "moderation_restriction_search",
          "moderation_blacklist_search",
          "moderation_restriction_type",
          "moderation_restriction_all_types",
          "moderation_filter_count",
          "moderation_filter_no_matches",
          "moderation_add_user",
          "moderation_member_query",
          "moderation_member_query_hint",
          "moderation_members_empty",
          "moderation_member",
          "moderation_remove_action",
          "moderation_unblock_action",
          "moderation_lift_action",
          "moderation_lift_compact",
          "moderation_remove_user",
          "moderation_remove_user_hint",
          "moderation_remove_persona_block",
          "moderation_remove_persona_block_hint",
          "moderation_quotas",
          "moderation_text",
          "moderation_image",
          "moderation_video",
          "moderation_daily_quota",
          "moderation_daily_quota_hint",
          "moderation_server_quota",
          "moderation_server_quota_hint",
          "moderation_reset_days",
          "moderation_reset_days_hint",
          "moderation_saved",
          "moderation_refresh",
          "personal_randomizer_failed",
          "discord_language",
          "discord_language_hint",
          "drafting_title",
          "drafting_hint",
          "drafting_reviewer",
          "drafting_default",
          "drafting_default_unavailable",
          "drafting_checker",
          "drafting_checker_hint",
          "drafting_checker_none",
          "drafting_unavailable",
          "drafting_load_failed",
          "drafting_save_failed",
          "drafting_saved",
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
          "lorebook_triggers_partial_save",
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
          "cooldown_legacy_category",
          "cooldown_legacy_zero",
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
          "nav_server_providers",
          "server_providers_hint",
          "server_primary_models_hint",
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
          "settings_banner_hint",
          "settings_managers_only",
          "settings_manage_required",
          "settings_models_group",
          "settings_refreshed",
          "settings_card_saved",
          "settings_context",
          "settings_context_hint",
          "settings_triggers",
          "settings_triggers_hint",
          "settings_tool_intent",
          "settings_tool_intent_hint",
          "settings_output",
          "settings_draft_review",
          "settings_draft_review_hint",
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
      personaGuildSettings: canManageGuildPersonas
        ? {
            attgMaxLength: PERSONA_ATTG_MAX_LENGTH,
            values: Object.fromEntries(
              result.snapshot.rawPersonas.map((persona) => [
                persona.persona_id,
                {
                  hasCharacterReference: Boolean(persona.char_ref_url),
                  attg: {
                    nai_attg_author: persona.nai_attg_author ?? "",
                    nai_attg_title: persona.nai_attg_title ?? "",
                    nai_attg_tags: persona.nai_attg_tags ?? "",
                    nai_attg_genre: persona.nai_attg_genre ?? "",
                    nai_attg_stars: persona.nai_attg_stars ?? null,
                  },
                },
              ]),
            ),
          }
        : null,
      personaNamingHabits:
        result.actor.canManage &&
        (result.guild.isDirectMessage || member?.permissions.has(PermissionFlagsBits.ManageGuild))
          ? {
              values: Object.fromEntries(
                result.snapshot.rawPersonas.map((persona) => [persona.persona_id, persona.naming_config]),
              ),
              styles: ["neutral", ...addressingStyleSchema.options.filter((style) => style !== "neutral")].map(
                (value) => ({ value, label: localizer("en-US", `commands.config.panel.style_${value}`) }),
              ),
              maxLength: PERSONA_NAMING_VALUE_MAX_LENGTH,
            }
          : null,
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
      allowedChannelIds: allowedChannelIds.filter((id) => visibleChannelIds.has(id)),
      channelWhitelistActive: allowedChannelIds.length > 0,
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
            logitBias: {
              entries: serializeLogitBias(result.snapshot.config.llm_logit_biases ?? []),
              maxImportBytes: LOGIT_BIAS_IMPORT_BYTES,
            },
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

  app.on(["GET", "DELETE"], `${BASE_PATH}/api/profile/short-term-memory`, async (context) => {
    context.header("Cache-Control", "private, no-store");
    const result = await requireActor(context, core, sessions, config);
    if (result instanceof Response) return result;
    if (context.req.method === "GET") return context.json({ count: await getStmCount(result.actor.discordId) });
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    await personalMemoriesOperations.clearStm(result.actor.discordId);
    return context.body(null, 202);
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

  app.patch(`${BASE_PATH}/api/profile/model-randomizer`, async (context) => {
    const result = await requireActor(context, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const enabled = await settings.setPersonalRandomizer(
      result.actor.user.user_id,
      result.actor.discordId,
      await context.req.json().catch(() => null),
    );
    return context.json({ enabled });
  });

  app.patch(`${BASE_PATH}/api/profile/capability`, async (context) => {
    const result = await requireActor(context, core, sessions, config);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    return context.json(
      await providers.togglePersonalCapability(result.actor, await context.req.json().catch(() => null)),
    );
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/personal-spotlights`, async (context) => {
    const result = await requireSpotlightContext(context);
    if (result instanceof Response) return result;
    const channels = serializeChannels(spotlightChannels(result).values(), result.member);
    const spotlights = await listPersonalSpotlights(result.actor, result.snapshot);
    return context.json({ channels, spotlights });
  });

  app.put(`${BASE_PATH}/api/guilds/:guildId/personal-spotlights`, async (context) => {
    const result = await requireSpotlightContext(context);
    if (result instanceof Response) return result;
    const spotlight = await savePersonalSpotlight(
      result.actor,
      result.snapshot,
      new Set(spotlightChannels(result).keys()),
      await context.req.json().catch(() => null),
    );
    return context.json({ spotlight });
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/personal-spotlights/:channelId`, async (context) => {
    const result = await requireSpotlightContext(context);
    if (result instanceof Response) return result;
    await removePersonalSpotlight(result.actor, result.snapshot, context.req.param("channelId"));
    return context.json({ deleted: true });
  });

  const moderationPath = `${BASE_PATH}/api/guilds/:guildId/moderation`;
  app.get(moderationPath, async (context) => {
    const access = await requireModerationContext(context);
    if (access instanceof Response) return access;
    return context.json(await listModerationSettings(access.guild, access.serverId));
  });

  app.get(`${moderationPath}/members`, async (context) => {
    const access = await requireModerationContext(context);
    if (access instanceof Response) return access;
    const query = context.req.query("q")?.trim() ?? "";
    if (query.length < 2 || query.length > 100) {
      throw new DashboardServiceError(
        "moderation_invalid",
        422,
        localizer("en-US", "general.dashboard.moderation_invalid"),
      );
    }
    const exact = /^\d{17,20}$/.test(query);
    const members = exact
      ? [await fetchDashboardGuildMember(access.guild, query)]
      : [...(await access.guild.members.search({ query, limit: 15 })).values()];
    return context.json({
      members: members.flatMap((member) =>
        member && !member.user.bot ? [{ id: member.id, name: member.displayName, username: member.user.username }] : [],
      ),
    });
  });

  app.patch(moderationPath, async (context) => {
    const access = await requireModerationContext(context);
    if (access instanceof Response) return access;
    const { guild, serverId } = access;
    return context.json(
      await updateModerationSettings(guild.id, serverId, await context.req.json().catch(() => null), {
        hasRole: async (id) => {
          try {
            return (await guild.roles.fetch(id, { force: true }))?.guild.id === guild.id;
          } catch (error) {
            if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownRole) return false;
            throw error;
          }
        },
        findMember: async (id) => (await fetchDashboardGuildMember(guild, id))?.user ?? null,
      }),
    );
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
    const result = await requireServerMemoryContext(context);
    if (result instanceof Response) return result;
    const lineageId = parseLineageId(context.req.query("lineageId"));
    if (lineageId === null) {
      return jsonError(context, new DashboardServiceError("invalid_lineage", 422, "Invalid memory scope."));
    }
    try {
      return context.json({
        ...(await memories.listServer(result.actor, result.snapshot, lineageId, result.selectableChannels)),
        channels: result.channels,
      });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server memories failed.");
    }
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/memories/server`, async (context) => {
    const result = await requireServerMemoryContext(context);
    if (result instanceof Response) return result;
    try {
      const input = memories.parseMutation(await context.req.json().catch(() => null), "server");
      return context.json(
        { memory: await memories.addServer(result.actor, result.snapshot, input, result.selectableChannels) },
        201,
      );
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server memory save failed.");
    }
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/memories/server/:memoryId`, async (context) => {
    const result = await requireServerMemoryContext(context);
    if (result instanceof Response) return result;
    const memoryId = parsePositiveInt(context.req.param("memoryId"));
    if (!memoryId) return jsonError(context, new DashboardServiceError("invalid_memory_id", 422, "Invalid memory."));
    try {
      const input = memories.parseMutation(await context.req.json().catch(() => null), "server");
      return context.json({
        memory: await memories.updateServer(result.actor, result.snapshot, memoryId, input, result.selectableChannels),
      });
    } catch (error) {
      return jsonError(context, error instanceof DashboardServiceError ? error : "Server memory update failed.");
    }
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/memories/server/:memoryId`, async (context) => {
    const result = await requireServerMemoryContext(context);
    if (result instanceof Response) return result;
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
    const available = dashboardChannelIds(client.guilds.cache.get(result.guild.id)?.channels.cache.values() ?? []);
    if (ids.length > 500 || ids.some((id) => !available.has(id)))
      return jsonError(
        context,
        new DashboardServiceError("invalid_channel_settings", 422, "Invalid channel settings."),
      );
    try {
      return context.json({
        ...(await channelSettings.load(result.snapshot, ids)),
        availableChannelIds: [...available],
      });
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
    const available = dashboardChannelIds(client.guilds.cache.get(result.guild.id)?.channels.cache.values() ?? []);
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
    const result = await requireProviderConnectionContext(context, scope);
    if (result instanceof Response) return result;
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

  app.delete(`${BASE_PATH}/api/guilds/:guildId/providers/server/credentials/:provider`, async (context) => {
    const result = await requireProviderConnectionContext(context, "server");
    if (result instanceof Response) return result;
    return context.json(await providers.removeServerProvider(result.snapshot, context.req.param("provider") ?? ""));
  });

  app.on(
    ["GET", "PATCH"],
    `${BASE_PATH}/api/guilds/:guildId/providers/server/credentials/:provider/rotation`,
    async (context) => {
      const result = await requireProviderConnectionContext(context, "server");
      if (result instanceof Response) return result;
      const provider = context.req.param("provider") ?? "";
      context.header("Cache-Control", "no-store");
      return context.json(
        context.req.method === "GET"
          ? await providers.loadRotationKeys(result.snapshot, provider)
          : await providers.updateRotationKeys(result.snapshot, provider, await context.req.json().catch(() => null)),
      );
    },
  );

  app.on(
    ["GET", "PATCH"],
    `${BASE_PATH}/api/guilds/:guildId/providers/:scope/connections/:connectionId`,
    async (context) => {
      const scope = context.req.param("scope");
      if (scope !== "personal" && scope !== "server") return context.notFound();
      const result = await requireProviderConnectionContext(context, scope);
      if (result instanceof Response) return result;
      const rawId = context.req.param("connectionId") ?? "";
      const connectionId = Number(rawId);
      if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(connectionId))
        throw new DashboardServiceError(
          "endpoint_edit_not_found",
          404,
          localizer("en-US", "general.dashboard.endpoint_edit_not_found"),
        );
      context.header("Cache-Control", "no-store");
      return context.json(
        context.req.method === "GET"
          ? await providers.loadConnectionEditor(scope, result.actor, result.snapshot, connectionId)
          : await providers.editConnection(
              scope,
              result.actor,
              result.snapshot,
              connectionId,
              await context.req.json().catch(() => null),
            ),
      );
    },
  );

  app.on(
    ["GET", "PATCH"],
    `${BASE_PATH}/api/guilds/:guildId/providers/:scope/connections/:connectionId/models/:endpointId`,
    bodyLimit({ maxSize: ENDPOINT_WORKFLOW_MAX_BYTES + 4096 }),
    async (context) => {
      const scope = context.req.param("scope");
      if (scope !== "personal" && scope !== "server") return context.notFound();
      const result = await requireProviderConnectionContext(context, scope);
      if (result instanceof Response) return result;
      const ids = [context.req.param("connectionId"), context.req.param("endpointId")];
      const [connectionId, endpointId] = ids.map(Number);
      if (ids.some((id) => !/^[1-9]\d*$/.test(id ?? "")) || ![connectionId, endpointId].every(Number.isSafeInteger))
        throw new DashboardServiceError(
          "endpoint_model_not_found",
          404,
          localizer("en-US", "general.dashboard.endpoint_model_not_found"),
        );
      context.header("Cache-Control", "no-store");
      return context.json(
        context.req.method === "GET"
          ? await providers.loadEndpointModelEditor(scope, result.actor, result.snapshot, connectionId, endpointId)
          : await providers.editEndpointModel(
              scope,
              result.actor,
              result.snapshot,
              connectionId,
              endpointId,
              await context.req.json().catch(() => null),
            ),
      );
    },
  );

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

  app.patch(`${BASE_PATH}/api/guilds/:guildId/providers/server/model-targets`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    await setAdvancedServerModel(result.snapshot, await context.req.json().catch(() => null));
    return context.json({ saved: true });
  });

  const logitBiasPath = `${BASE_PATH}/api/guilds/:guildId/settings/logit-bias`;
  app.post(logitBiasPath, bodyLimit({ maxSize: LOGIT_BIAS_IMPORT_BYTES + 1024 }), async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const entries = await saveServerLogitBias(result.snapshot, await context.req.json().catch(() => null));
    return context.json({ entries });
  });

  app.delete(`${logitBiasPath}/:id`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    const entries = await removeServerLogitBias(result.snapshot, context.req.param("id"));
    return context.json({ entries });
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

  app.put(`${BASE_PATH}/api/guilds/:guildId/personas/:personaId/naming-habits`, async (context) => {
    const result = await requirePersonaManager(context, true);
    if (result instanceof Response) return result;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId)
      throw new DashboardServiceError(
        "persona_not_found",
        404,
        localizer("en-US", "general.dashboard.naming_persona_missing"),
      );
    const values = await personas.updateNamingHabits(
      result.snapshot,
      personaId,
      await context.req.json().catch(() => null),
    );
    return context.json({ values });
  });

  const personaPath = `${BASE_PATH}/api/guilds/:guildId/personas/:personaId`;
  const requireManagedPersona = async (context: Context, allowDirectMessages = false) => {
    const result = await requirePersonaManager(context, allowDirectMessages);
    if (result instanceof Response) return result;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId)
      throw new DashboardServiceError(
        "persona_not_found",
        404,
        localizer("en-US", "general.dashboard.naming_persona_missing"),
      );
    context.header("Cache-Control", "no-store");
    return { snapshot: result.snapshot, personaId };
  };

  app.get(`${personaPath}/export`, async (context) => {
    const result = await requireManagedPersona(context, true);
    if (result instanceof Response) return result;
    const format = context.req.query("format");
    if (format !== "png" && format !== "json") {
      throw new DashboardServiceError(
        "persona_export_invalid_format",
        422,
        localizer("en-US", "general.dashboard.persona_export_invalid_format"),
      );
    }
    const file = await personas.exportCard(result.snapshot, result.personaId, format);
    context.header("Cache-Control", "private, no-store");
    context.header("Content-Type", file.contentType);
    context.header("Content-Disposition", `attachment; filename="${file.filename}"`);
    return context.body(new Uint8Array(file.buffer));
  });

  app.get(`${personaPath}/character-reference`, async (context) => {
    const result = await requireManagedPersona(context);
    if (result instanceof Response) return result;
    const image = await personas.loadCharacterReference(result.snapshot, result.personaId);
    if (!image) return context.notFound();
    context.header("Content-Type", "image/png");
    return context.body(new Uint8Array(image));
  });

  app.on(
    ["PUT", "DELETE"],
    `${personaPath}/character-reference`,
    bodyLimit({ maxSize: PERSONA_REFERENCE_MAX_BYTES + 65536 }),
    async (context) => {
      const result = await requireManagedPersona(context);
      if (result instanceof Response) return result;
      const file = context.req.method === "PUT" ? (await context.req.parseBody().catch(() => null))?.file : null;
      if (file !== null && !(file instanceof File))
        throw new DashboardServiceError(
          "persona_reference_invalid",
          422,
          localizer("en-US", "general.dashboard.persona_reference_invalid"),
        );
      return context.json(await personas.updateCharacterReference(result.snapshot, result.personaId, file));
    },
  );

  app.put(`${personaPath}/attg`, async (context) => {
    const result = await requireManagedPersona(context);
    if (result instanceof Response) return result;
    return context.json(
      await personas.updateAttg(result.snapshot, result.personaId, await context.req.json().catch(() => null)),
    );
  });

  app.get(`${personaPath}/voice`, async (context) => {
    const result = await requireManagedPersona(context, true);
    if (result instanceof Response) return result;
    return context.json(await personas.loadVoiceSettings(result.snapshot, result.personaId));
  });

  app.patch(`${personaPath}/voice`, async (context) => {
    const result = await requireManagedPersona(context, true);
    if (result instanceof Response) return result;
    await personas.updateVoiceSettings(result.snapshot, result.personaId, await context.req.json().catch(() => null));
    return context.json({ saved: true });
  });

  app.get(`${personaPath}/preset`, async (context) => {
    const result = await requireManagedPersona(context);
    if (result instanceof Response) return result;
    return context.json(await personas.loadPresetIdentity(result.snapshot, result.personaId));
  });

  app.post(`${personaPath}/preset/resync`, async (context) => {
    const result = await requireManagedPersona(context);
    if (result instanceof Response) return result;
    return context.json(
      await personas.resyncPresetIdentity(
        result.snapshot,
        result.personaId,
        await context.req.json().catch(() => null),
      ),
    );
  });

  const personaConditioningPath = `${BASE_PATH}/api/guilds/:guildId/personas/:personaId/conditioning`;
  app.get(personaConditioningPath, async (context) => {
    const result = await requirePersonaManager(context, false);
    if (result instanceof Response) return result;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId)
      throw new DashboardServiceError(
        "persona_not_found",
        404,
        localizer("en-US", "general.dashboard.naming_persona_missing"),
      );
    context.header("Cache-Control", "no-store");
    return context.json({ entries: await personas.listConditioning(result.snapshot, personaId) });
  });

  app.delete(`${personaConditioningPath}/:id`, async (context) => {
    const result = await requirePersonaManager(context, false);
    if (result instanceof Response) return result;
    const personaId = parsePositiveInt(context.req.param("personaId"));
    if (!personaId)
      throw new DashboardServiceError(
        "persona_not_found",
        404,
        localizer("en-US", "general.dashboard.naming_persona_missing"),
      );
    const id = context.req.param("id");
    if (!/^[A-Za-z0-9_-]{8}$/.test(id)) {
      throw new DashboardServiceError(
        "persona_conditioning_changed",
        409,
        localizer("en-US", "general.dashboard.persona_conditioning_changed"),
      );
    }
    await personas.removeConditioning(result.snapshot, personaId, id);
    return context.json({ deleted: true });
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/settings/response-drafting`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    return context.json(await core.loadDraftingSelections(result.snapshot));
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/settings/response-drafting`, async (context) => {
    const result = await requireGuildContext(context, client, core, sessions, config, true);
    if (result instanceof Response) return result;
    const csrfError = requireMutationCsrf(context, result.session);
    if (csrfError) return csrfError;
    await settings.setDraftingSelection(result.snapshot, await context.req.json().catch(() => null));
    return context.json({ saved: true });
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/settings/system-prompt-presets`, async (context) => {
    const result = await requireServerBehaviorContext(context);
    if (result instanceof Response) return result;
    return context.json(await loadSystemPromptChoices(result.snapshot));
  });

  app.on(["GET", "PATCH"], `${BASE_PATH}/api/guilds/:guildId/settings/tool-triggers`, async (context) => {
    const result = await requireServerBehaviorContext(context);
    if (result instanceof Response) return result;
    const targets =
      context.req.method === "GET"
        ? loadToolTriggers(result.snapshot)
        : await updateToolTriggers(result.snapshot, await context.req.json().catch(() => null));
    return context.json({ targets });
  });

  const randomTriggerPath = `${BASE_PATH}/api/guilds/:guildId/settings/random-triggers`;
  app.on(["GET", "POST"], randomTriggerPath, async (context) => {
    const result = await requireServerBehaviorContext(context, true);
    if (result instanceof Response) return result;
    const ids = new Set(result.channels.map(({ id }) => id));
    if (context.req.method === "GET")
      return context.json({ channels: result.channels, triggers: await loadRandomTriggers(result.snapshot, ids) });
    const allowed = await core.loadAllowedChannelIds(result.snapshot.serverId);
    const candidates = allowed.length ? new Set(allowed.filter((id) => ids.has(id))) : ids;
    await saveRandomTrigger(result.snapshot, candidates, await context.req.json().catch(() => null));
    return context.json({ saved: true }, 201);
  });

  app.on(["PATCH", "DELETE"], `${randomTriggerPath}/:triggerId`, async (context) => {
    const result = await requireServerBehaviorContext(context, true);
    if (result instanceof Response) return result;
    const triggerId = parsePositiveInt(context.req.param("triggerId"));
    if (triggerId === null)
      throw new DashboardServiceError(
        "random_schedule_missing",
        404,
        localizer("en-US", "general.dashboard.random_schedule_missing"),
      );
    const ids = new Set(result.channels.map(({ id }) => id));
    if (context.req.method === "DELETE") await removeRandomTrigger(result.snapshot, ids, triggerId);
    else await saveRandomTrigger(result.snapshot, ids, await context.req.json().catch(() => null), triggerId);
    return context.json({ saved: true });
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

  const mainReplacementPath = `${BASE_PATH}/api/guilds/:guildId/personas/main/replacement`;
  app.get(mainReplacementPath, async (context) => {
    const result = await requirePersonaManager(context, true);
    if (result instanceof Response) return result;
    context.header("Cache-Control", "private, no-store");
    return context.json({ presets: await personas.listMainPersonaPresets(result.actor.user.language_pref) });
  });
  app.on(
    ["POST", "PUT"],
    mainReplacementPath,
    bodyLimit({ maxSize: PERSONA_IMPORT_MAX_BYTES + 65536 }),
    async (context) => {
      const result = await requirePersonaManager(context, true);
      if (result instanceof Response) return result;
      const { revision, ...selection } = await context.req.parseBody();
      const locale = result.actor.user.language_pref;
      context.header("Cache-Control", "private, no-store");
      if (context.req.method === "POST") {
        return context.json(await personas.previewMainReplacement(result.snapshot, locale, selection));
      }
      return context.json(
        await personas.replaceMainPersona(
          result.guild.id,
          Boolean(result.guild.isDirectMessage),
          result.actor.discordId,
          locale,
          selection,
          revision,
        ),
      );
    },
  );

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
