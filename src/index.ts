import { config } from "dotenv";
import { initStartupBackup } from "@/init/backup";
import { initBridges } from "@/init/bridges";
import { initDatabase } from "@/init/database";
import { createDiscordClient, resolvePresenceIntentEnabled } from "@/init/discord";
import { startHealthServer } from "@/init/healthServer";
import { initLoaders } from "@/init/loaders";
import { loadSecrets } from "@/init/secrets";
import { initTimers } from "@/init/timers";
import { resolveEnvironment } from "@/types/config";
import { log } from "@/utils/misc/logger";
import { registerSettingsDashboardPlugin } from "@/web";

/**
 * Detects Discord's "privileged intent not approved" rejection.
 *
 * When the GuildPresences intent is requested but not approved, the gateway
 * closes the connection with code 4014 and discord.js rejects login with a
 * `DisallowedIntents` error. We match on the error code and message so the
 * failure can be reported as an actionable misconfiguration rather than a
 * silent, never-connected process.
 *
 * @param error - The rejection thrown by client.login()
 * @returns true if the failure is a disallowed/privileged intent rejection
 */
function isDisallowedIntentsError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (code === "DisallowedIntents") return true;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("disallowed intents") || message.includes("privileged intent");
}

config({ quiet: true });

const environment = resolveEnvironment();

await initStartupBackup(environment);

// Bind to PORT immediately so Cloud Run's startup probe passes before the rest of init runs.
if (environment === "production") {
  const healthPort = Number.parseInt(process.env.PORT ?? "8080", 10);
  startHealthServer(healthPort);
}

await loadSecrets(environment);

// Probe Discord for Presence Intent approval (or honor an explicit override) before
// building the client, so we request the privileged intent only when it is actually
// enabled.
const includePresences = await resolvePresenceIntentEnabled(environment);
const client = createDiscordClient(includePresences);

await initDatabase(environment);

await initLoaders(client);

await initBridges(client);

registerSettingsDashboardPlugin(client);

initTimers(client);

// Login - triggers clientReady which starts all deferred timers.
try {
  await client.login(process.env.DISCORD_TOKEN);
} catch (error) {
  if (isDisallowedIntentsError(error)) {
    log.error(
      "Discord rejected login: a requested privileged intent is not approved for this bot. " +
        "This is unexpected because approval is probed before connecting. Check whether the " +
        "Presence Intent was revoked. Restarting will re-probe and boot without the intent " +
        "(presence context degrades gracefully).",
      error as Error,
    );
    process.exit(1);
  }
  log.error("Discord login failed", error as Error);
  process.exit(1);
}
