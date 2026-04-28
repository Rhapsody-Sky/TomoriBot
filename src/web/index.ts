import type { Client } from "discord.js";
import { startSettingsWebsite } from "./settingsServer";

/**
 * Registers the optional settings dashboard as a plugin-like add-on.
 * The bot entry point only needs this hook; the dashboard owns its own
 * startup gating through WEB_SETTINGS_ENABLED.
 */
export function registerSettingsDashboardPlugin(client: Client): void {
  client.once("clientReady", () => {
    startSettingsWebsite(client);
  });
}

export { startSettingsWebsite };
