import type { Client } from "discord.js";

export interface DashboardRuntimeConfig {
  enabled: boolean;
  host: string;
  port: number;
  publicUrl: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  secureCookie: boolean;
}

function parseBoolean(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function derivePublicUrl(host: string, port: number): string {
  const publicHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  return `http://${publicHost}:${port}`;
}

export function getDashboardRuntimeConfig(client: Client): DashboardRuntimeConfig {
  const enabled = parseBoolean(process.env.WEB_SETTINGS_ENABLED) ?? false;
  const host = process.env.WEB_SETTINGS_HOST?.trim() || "127.0.0.1";
  const parsedPort = Number.parseInt(process.env.WEB_SETTINGS_PORT || "3001", 10);
  const port = Number.isFinite(parsedPort) ? parsedPort : 3001;
  const publicUrl = trimTrailingSlash(process.env.WEB_SETTINGS_PUBLIC_URL?.trim() || derivePublicUrl(host, port));

  return {
    enabled,
    host,
    port,
    publicUrl,
    redirectUri: process.env.WEB_SETTINGS_DISCORD_REDIRECT_URI?.trim() || `${publicUrl}/settings/oauth/callback`,
    clientId:
      process.env.WEB_SETTINGS_DISCORD_CLIENT_ID?.trim() ||
      process.env.DISCORD_CLIENT_ID?.trim() ||
      client.application?.id ||
      client.user?.id ||
      "",
    clientSecret:
      process.env.WEB_SETTINGS_DISCORD_CLIENT_SECRET?.trim() || process.env.DISCORD_CLIENT_SECRET?.trim() || "",
    sessionSecret: process.env.WEB_SETTINGS_SESSION_SECRET?.trim() || process.env.CRYPTO_SECRET || "",
    secureCookie: parseBoolean(process.env.WEB_SETTINGS_COOKIE_SECURE) ?? publicUrl.startsWith("https://"),
  };
}
