import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Client } from "discord.js";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { DashboardRuntimeConfig } from "./runtimeConfig";
import type { DashboardGuild, DashboardSession, DiscordOAuthGuild, DiscordOAuthUser } from "./types";

export const SESSION_COOKIE = "tomori_dashboard_session";
export const OAUTH_STATE_COOKIE = "tomori_dashboard_oauth_state";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const DISCORD_API_BASE = "https://discord.com/api/v10";
const GUILD_CACHE_TTL_MS = 60 * 1000;
const GUILD_CACHE_RATE_LIMIT_GRACE_MS = 30 * 60 * 1000;
const MANAGE_GUILD_PERMISSION = 1n << 5n;
const ADMINISTRATOR_PERMISSION = 1n << 3n;
const pendingGuildLoads = new WeakMap<DashboardSession, Promise<DashboardGuild[]>>();

class DiscordApiError extends Error {
  constructor(readonly status: number) {
    super(`Discord API returned ${status}`);
    this.name = "DiscordApiError";
  }
}

export class DashboardSessionStore {
  private readonly sessions = new Map<string, DashboardSession>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  create(user: DiscordOAuthUser, accessToken: string, tokenExpiresInSeconds: number): DashboardSession {
    const now = Date.now();
    const session: DashboardSession = {
      id: randomToken(),
      user,
      accessToken,
      tokenExpiresAt: now + tokenExpiresInSeconds * 1000,
      csrfToken: randomToken(),
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): DashboardSession | null {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (session.expiresAt <= Date.now() || session.tokenExpiresAt <= Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt <= now || session.tokenExpiresAt <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function signValue(value: string, secret: string): string {
  return `${value}.${createHmac("sha256", secret).update(value).digest("base64url")}`;
}

function verifySignedValue(value: string | undefined, secret: string): string | null {
  if (!value) return null;
  const separatorIndex = value.lastIndexOf(".");
  if (separatorIndex < 1) return null;

  const payload = value.slice(0, separatorIndex);
  const supplied = value.slice(separatorIndex + 1);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length) return null;
  return timingSafeEqual(suppliedBuffer, expectedBuffer) ? payload : null;
}

export function setSignedCookie(
  context: Context,
  config: DashboardRuntimeConfig,
  name: string,
  value: string,
  maxAgeSeconds: number,
): void {
  setCookie(context, name, signValue(value, config.sessionSecret), {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.secureCookie,
    path: "/settings",
    maxAge: maxAgeSeconds,
  });
}

export function clearDashboardCookie(context: Context, config: DashboardRuntimeConfig, name: string): void {
  deleteCookie(context, name, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.secureCookie,
    path: "/settings",
  });
}

export function readSignedCookie(context: Context, config: DashboardRuntimeConfig, name: string): string | null {
  return verifySignedValue(getCookie(context, name), config.sessionSecret);
}

export function getSession(
  context: Context,
  config: DashboardRuntimeConfig,
  store: DashboardSessionStore,
): DashboardSession | null {
  const sessionId = readSignedCookie(context, config, SESSION_COOKIE);
  return sessionId ? store.get(sessionId) : null;
}

export function requireCsrf(context: Context, session: DashboardSession): boolean {
  const supplied = context.req.header("X-CSRF-Token");
  if (!supplied) return false;
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(session.csrfToken);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function hasManagePermission(guild: DiscordOAuthGuild): boolean {
  if (guild.owner) return true;
  const permissions = BigInt(guild.permissions || "0");
  return (permissions & MANAGE_GUILD_PERMISSION) !== 0n || (permissions & ADMINISTRATOR_PERMISSION) !== 0n;
}

export function discordAvatarUrl(user: DiscordOAuthUser): string | null {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

function discordGuildIconUrl(guild: Pick<DiscordOAuthGuild, "id" | "icon">): string | null {
  if (!guild.icon) return null;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`;
}

async function discordApi<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new DiscordApiError(response.status);
  return (await response.json()) as T;
}

export async function exchangeOAuthCode(config: DashboardRuntimeConfig, code: string) {
  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
    }),
  });
  if (!response.ok) throw new Error(`Discord OAuth returned ${response.status}`);
  return (await response.json()) as { access_token: string; expires_in: number };
}

export async function loadOAuthUser(accessToken: string): Promise<DiscordOAuthUser> {
  return discordApi<DiscordOAuthUser>("/users/@me", accessToken);
}

export async function getSharedGuilds(session: DashboardSession, client: Client): Promise<DashboardGuild[]> {
  const cacheAge = session.guildCache ? Date.now() - session.guildCache.fetchedAt : null;
  if (session.guildCache && cacheAge !== null && cacheAge < GUILD_CACHE_TTL_MS) {
    return session.guildCache.guilds;
  }

  const pending = pendingGuildLoads.get(session);
  if (pending) return pending;

  const load = (async () => {
    try {
      const userGuilds = await discordApi<DiscordOAuthGuild[]>("/users/@me/guilds", session.accessToken);
      const guilds = userGuilds
        .filter((guild) => client.guilds.cache.has(guild.id))
        .map((guild) => {
          const cachedGuild = client.guilds.cache.get(guild.id);
          return {
            id: guild.id,
            name: guild.name,
            iconUrl: discordGuildIconUrl(guild),
            memberCount: cachedGuild?.memberCount ?? null,
            canManage: hasManagePermission(guild),
          };
        })
        .sort((left, right) => Number(right.canManage) - Number(left.canManage) || left.name.localeCompare(right.name));

      session.guildCache = { fetchedAt: Date.now(), guilds };
      return guilds;
    } catch (error) {
      if (
        error instanceof DiscordApiError &&
        error.status === 429 &&
        session.guildCache &&
        cacheAge !== null &&
        cacheAge < GUILD_CACHE_RATE_LIMIT_GRACE_MS
      ) {
        return session.guildCache.guilds;
      }
      throw error;
    } finally {
      pendingGuildLoads.delete(session);
    }
  })();
  pendingGuildLoads.set(session, load);
  return load;
}

export async function assertGuildAccess(
  session: DashboardSession,
  client: Client,
  guildId: string,
  requireManage = false,
): Promise<DashboardGuild | null> {
  const guild = (await getSharedGuilds(session, client)).find((entry) => entry.id === guildId) ?? null;
  if (!guild || (requireManage && !guild.canManage)) return null;
  return guild;
}
