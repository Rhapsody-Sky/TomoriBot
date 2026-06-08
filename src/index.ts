import { config } from "dotenv";
import { initBridges } from "@/init/bridges";
import { initDatabase } from "@/init/database";
import { createDiscordClient } from "@/init/discord";
import { startHealthServer } from "@/init/healthServer";
import { initLoaders } from "@/init/loaders";
import { loadSecrets } from "@/init/secrets";
import { initTimers } from "@/init/timers";
import { resolveEnvironment } from "@/types/config";
import { registerSettingsDashboardPlugin } from "@/web";

config({ quiet: true });

const environment = resolveEnvironment();

// Bind to PORT immediately so Cloud Run's startup probe passes before the rest of init runs.
if (environment === "production") {
  const healthPort = Number.parseInt(process.env.PORT ?? "8080", 10);
  startHealthServer(healthPort);
}

await loadSecrets(environment);

const client = createDiscordClient(environment);

await initDatabase(environment);

await initLoaders(client);

await initBridges(client);

registerSettingsDashboardPlugin(client);

initTimers(client);

// Login - triggers clientReady which starts all deferred timers.
client.login(process.env.DISCORD_TOKEN);
