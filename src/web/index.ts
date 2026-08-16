import type { Client } from "discord.js";
import { log } from "@/utils/misc/logger";

function isDashboardEnabled(): boolean {
  return new Set(["1", "true", "yes", "on"]).has((process.env.WEB_SETTINGS_ENABLED ?? "").trim().toLowerCase());
}

export async function startSettingsWebsite(client: Client): Promise<void> {
  const dashboard = await import("./dashboard/server");
  dashboard.startSettingsWebsite(client);
}

export async function stopSettingsWebsite(): Promise<void> {
  const dashboard = await import("./dashboard/server");
  dashboard.stopSettingsWebsite();
}

/**
 * Registers the optional settings dashboard as a plugin-like add-on.
 * The bot entry point only needs this hook; the dashboard owns its own
 * startup gating through WEB_SETTINGS_ENABLED.
 */
export function registerSettingsDashboardPlugin(client: Client): void {
  client.once("clientReady", () => {
    if (!isDashboardEnabled()) return;
    void startSettingsWebsite(client).catch((error) => {
      log.error("Failed to load settings dashboard plugin", error);
    });
  });
}
