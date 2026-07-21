---
title: "Settings Website"
---

# Settings Website

TomoriBot can host an optional settings website from the same Bun process as the bot. The first dashboard slice is available at `/settings` and includes:

- Discord OAuth login with `identify` and `guilds` scopes
- shared Discord server access for personal settings
- Manage Server / Administrator controls for server-owned settings
- default dark UI with status toasts after saves, refreshes, and memory mutations
- server settings editing for a validated dashboard-safe config subset
- global model selectors and sampler controls for text, vision, embedding, image, NovelAI image, and video model IDs
- grouped settings sections for models, behavior, access, memory, media, and admin controls
- custom endpoint registration for server and personal BYOK scopes
- fallback model chain editing for global LLMs and server custom text endpoints
- channel and role allowlist management, including per-channel cooldown overrides
- channel selectors for autochat, welcome, thought logs, RP suppression, private STM, and cross-channel blocklists
- NovelAI preset/tag/image parameter controls and voice/media toggles
- JSON memory import/export for server and signed-in personal memories
- persona avatars, nickname, trigger words, persona prompt, context note/depth, conditioning toggles, NovelAI tags, and model override editing
- server memory list, add, edit, and delete flows
- signed-in user taught server memory list, add, edit, and delete flows scoped to `server_memories.user_id`
- signed-in user personal memory list, add, edit, delete, import, and export flows for global lineage `0` and the selected server's persona lineages
- signed-in user personal settings editing, reset, import, and export flows
- signed-in user personal provider key storage, capability ownership, model selection, and fallback chain editing
- signed-in user personal OpenRouter model registration for text, embedding, image, and video models
- signed-in user personal custom endpoint registration for BYOK-style provider access

## Runtime

The website is disabled by default. Enable it with:

```env
WEB_SETTINGS_ENABLED=true
WEB_SETTINGS_HOST=127.0.0.1
WEB_SETTINGS_PORT=3001
WEB_SETTINGS_PUBLIC_URL=http://localhost:3001
WEB_SETTINGS_DISCORD_CLIENT_ID=your_discord_application_id
WEB_SETTINGS_DISCORD_CLIENT_SECRET=your_discord_application_secret
```

Add this redirect URI in the Discord Developer Portal for local development:

```text
http://localhost:3001/settings/oauth/callback
```

For Docker or reverse-proxy deployments, set `WEB_SETTINGS_HOST=0.0.0.0` inside the container and set `WEB_SETTINGS_PUBLIC_URL` to the externally reachable HTTPS origin.

## Plugin Boundary

The dashboard is organized as an optional add-on under `src/web`.

- `src/web/index.ts` exposes `registerSettingsDashboardPlugin(client)` for the bot entry point.
- `src/web/settingsServer.ts` owns the HTTP server, OAuth/session handling, routes, UI, and dashboard-only validation.
- `src/web/tomoriCoreAdapter.ts` is the single import boundary to TomoriBot internals such as DB helpers, provider helpers, cache invalidation, schemas, logging, and encryption.

The main bot does not route through the dashboard. If core modules are renamed or moved later, the intended first repair point is the adapter instead of the dashboard route/UI code.

## Security Model

- The browser stores only a signed opaque session cookie.
- Discord OAuth access tokens stay in the bot process memory.
- Mutating API routes require a per-session CSRF token.
- Every guild-scoped API route re-checks that the signed-in user shares that guild with TomoriBot.
- Server-owned mutations still require Manage Server or Administrator.
- User-owned server memory routes only operate on rows where `server_memories.user_id` matches the signed-in user's registered Tomori account.
- Non-admin user-owned server memory routes respect the server's `server_memteaching_enabled` setting.
- Personal memory and personal provider routes only operate on the signed-in user's registered Tomori account.
- The dashboard writes through existing typed DB helpers where possible and invalidates the Tomori state cache after changes.

## Routes

- `GET /settings` serves the dashboard.
- `GET /settings/login` starts Discord OAuth.
- `GET /settings/logout` clears the local session.
- `GET /settings/api/me` returns the signed-in user, CSRF token, shared guilds, and per-guild `canManage`.
- `PATCH /settings/api/personal-settings` updates the signed-in user's personal settings.
- `GET /settings/api/personal-settings/export` exports the signed-in user's personal settings as JSON.
- `POST /settings/api/personal-settings/import` imports the signed-in user's personal settings from JSON.
- `DELETE /settings/api/personal-settings` resets the signed-in user's personal settings.
- `GET /settings/api/guilds/:guildId/overview` returns personal dashboard data for shared guild users and server config data for admins.
- `PATCH /settings/api/guilds/:guildId/config` updates dashboard-safe config fields.
- `GET /settings/api/guilds/:guildId/personas/:tomoriId/avatar` serves a local stored persona avatar to admins.
- `PATCH /settings/api/guilds/:guildId/personas/:tomoriId` updates persona basics plus persona-scoped trigger words, prompt, conditioning toggles, and text model override.
- `GET /settings/api/guilds/:guildId/memories` lists server memories for a persona lineage.
- `POST /settings/api/guilds/:guildId/memories` adds a server memory.
- `PATCH /settings/api/guilds/:guildId/memories/:memoryId` edits a server memory.
- `DELETE /settings/api/guilds/:guildId/memories/:memoryId` deletes a server memory.
- `GET /settings/api/guilds/:guildId/my-server-memories` lists server memories taught by the signed-in user.
- `POST /settings/api/guilds/:guildId/my-server-memories` adds a server memory attributed to the signed-in user.
- `PATCH /settings/api/guilds/:guildId/my-server-memories/:memoryId` edits one server memory taught by the signed-in user.
- `DELETE /settings/api/guilds/:guildId/my-server-memories/:memoryId` deletes one server memory taught by the signed-in user.
- `GET /settings/api/guilds/:guildId/personal-memories` lists personal memories for the signed-in user and selected lineage.
- `POST /settings/api/guilds/:guildId/personal-memories` adds a personal memory for the signed-in user.
- `PATCH /settings/api/guilds/:guildId/personal-memories/:memoryId` edits one of the signed-in user's personal memories.
- `DELETE /settings/api/guilds/:guildId/personal-memories/:memoryId` deletes one of the signed-in user's personal memories.
- `POST /settings/api/guilds/:guildId/personal-providers` stores or replaces a signed-in user's encrypted provider API key.
- `PATCH /settings/api/guilds/:guildId/personal-providers` updates a signed-in user's enabled provider capabilities, selected models, and fallback chain.
- `DELETE /settings/api/guilds/:guildId/personal-providers` removes a signed-in user's saved standard provider.
- `POST /settings/api/guilds/:guildId/personal-openrouter-models` registers a signed-in user's scoped OpenRouter model.
- `DELETE /settings/api/guilds/:guildId/personal-openrouter-models` removes a signed-in user's scoped OpenRouter model registration.
- `POST /settings/api/guilds/:guildId/custom-endpoints` registers or updates a server/personal custom endpoint.
- `DELETE /settings/api/guilds/:guildId/custom-endpoints` removes a server/personal custom endpoint registration.
- `PATCH /settings/api/guilds/:guildId/fallbacks` updates the ordered fallback model chain.
- `POST /settings/api/guilds/:guildId/access/channel-whitelist` upserts a channel allowlist entry.
- `DELETE /settings/api/guilds/:guildId/access/channel-whitelist` removes a channel allowlist entry.
- `POST /settings/api/guilds/:guildId/access/role-whitelist` adds a role allowlist entry.
- `DELETE /settings/api/guilds/:guildId/access/role-whitelist` removes a role allowlist entry.
- `GET /settings/api/guilds/:guildId/memory-export` exports memory content as JSON.
- `POST /settings/api/guilds/:guildId/memory-import` appends memory content from JSON.
