---
title: "Settings Website"
---

# Settings Website

TomoriBot can host an optional Discord OAuth dashboard at `/settings` from the
same Bun process as the bot. The dashboard is an add-on: bot startup and command
handling do not depend on it.

## Current Coverage

Every shared server member can:

- edit personal profile, privacy, trigger/tool mode, timezone, appearance, and
  cross-server short-term-memory preferences;
- manage global personal memories (lineage `0`) from the personal workspace;
- open a persona workspace that groups their private persona memories with the
  server memories they taught for that same lineage;
- import and export the currently selected memory scope;
- store encrypted personal provider credentials, choose active capabilities,
  and manage personal custom endpoints and scoped OpenRouter models.

Members with Manage Server or Administrator can additionally:

- view and manage all server memories;
- create and import alter personas, change or remove their avatars, and delete
  alter personas;
- edit persona identity, trigger words, prompt, attributes and visibility,
  sample dialogues, context note, and appearance data from the same persona
  workspace as its memories;
- test a selected persona against the configured text model in an isolated,
  request-local preview chat;
- edit the split server config domains independently, including chat behavior,
  model sampling, cooldowns, capabilities, memory policy, channels, autochat,
  speech, NovelAI defaults, BYOK policy, welcome messages, notices, and text
  workarounds;
- manage server provider credentials, custom endpoints, scoped OpenRouter
  models, and the ordered fallback chain.

The `/dashboard` command returns the configured public dashboard link. The URL
comes only from `WEB_SETTINGS_PUBLIC_URL`; there is no second database override.

## Memory Ownership

The two memory tables intentionally have different rules:

- `personal_memories` belongs to one Tomori user. Server administrators do not
  gain access to another user's rows. Lineage `0` is global across personas;
  other rows belong to a persona lineage.
- `server_memories` belongs to the server and a persona lineage. `user_id`
  records who taught the memory. Members can edit or delete only their own
  taught rows. Server managers can manage all rows.
- `personal_memories_enabled` controls whether personal memories are used in
  that server. It does not transfer ownership to server administrators.
- `server_memteaching_enabled` gates member writes. Server managers retain the
  administrative override.

Repository writes include exact owner, server, and lineage guards. The
dashboard never relies only on a row ID supplied by the browser.

## Runtime

The website is disabled by default:

```env
WEB_SETTINGS_ENABLED=true
WEB_SETTINGS_HOST=127.0.0.1
WEB_SETTINGS_PORT=3001
WEB_SETTINGS_PUBLIC_URL=http://localhost:3001
WEB_SETTINGS_DISCORD_CLIENT_ID=your_discord_application_id
WEB_SETTINGS_DISCORD_CLIENT_SECRET=your_discord_application_secret
WEB_SETTINGS_SESSION_SECRET=use_a_long_random_value
WEB_SETTINGS_COOKIE_SECURE=false
```

Register this exact local redirect URI in the Discord Developer Portal:

```text
http://localhost:3001/settings/oauth/callback
```

For a reverse proxy, bind to `0.0.0.0`, set `WEB_SETTINGS_PUBLIC_URL` to the
external HTTPS origin, and set `WEB_SETTINGS_COOKIE_SECURE=true`. The redirect
URI becomes `<public origin>/settings/oauth/callback`.

Sessions are intentionally process-local. Restarting TomoriBot signs dashboard
users out.

## Plugin Boundary

The integration is isolated under `src/web`:

- `src/web/index.ts` is the single bot startup hook.
- `src/web/dashboard/server.ts` owns HTTP routes and authorization.
- `src/web/dashboard/auth.ts` owns OAuth, signed cookies, sessions, CSRF, and
  Discord guild permission checks.
- `src/web/dashboard/core.ts` is the gateway to TomoriBot repositories, cache
  invalidation, encryption, and provider domain services.
- `memoryService.ts`, `settingsService.ts`, `personaService.ts`,
  `personaChatService.ts`, and `providerService.ts` contain dashboard policy
  and request validation without direct SQL.
- `settingsCatalog.ts` maps each settings panel to one split config domain.
- `assets/app.js` and `assets/app.css` contain the dependency-free browser UI.

There is no dashboard raw-SQL exemption. `bun run audit-sql` must continue to
report no SQL below `src/web`.

## Security

- The browser receives a signed opaque session cookie. Discord OAuth tokens and
  decrypted provider credentials are never sent to it.
- Mutating routes require the session CSRF token.
- Every guild route checks that the user and TomoriBot still share the server.
- Server mutations re-check Manage Server or Administrator permission.
- API payloads are strict Zod schemas; unknown fields are rejected.
- Persona uploads reuse the bot's production memory guard and persona, import,
  and avatar quotas.
- Persona test chat disables tools, media generation, message management,
  self-teaching, humanization, and post-turn effects. Its history lives in the
  browser and no Discord message or memory write is performed.
- Custom endpoint registration uses the same reachability and remote-URL policy
  as the slash commands before anything is persisted.
- API keys are validated when requested and encrypted through TomoriBot's
  current crypto service.
- Responses expose only whether a key exists, never the stored key bytes.

## Route Groups

- `/settings/login`, `/settings/oauth/callback`, `/settings/logout`
- `/settings/api/session` and `/settings/api/profile`
- `/settings/api/guilds/:guildId/overview`
- `/settings/api/guilds/:guildId/memories/{personal|server}`
- `/settings/api/guilds/:guildId/memories/{import|export}`
- `/settings/api/guilds/:guildId/settings/:sectionId`
- `/settings/api/guilds/:guildId/personas`
- `/settings/api/guilds/:guildId/personas/import`
- `/settings/api/guilds/:guildId/personas/test-chat`
- `/settings/api/guilds/:guildId/personas/:personaId/{avatar|attributes|dialogues}`
- `/settings/api/guilds/:guildId/personas/:personaId/:section`
- `/settings/api/guilds/:guildId/providers/{personal|server}/...`

## Local Verification

1. Configure the environment values above and the Discord redirect URI.
2. Run `bun run check`.
3. Run `bun test tests/unit/web`.
4. Run `bun run audit-sql`.
5. Start TomoriBot with `bun run dev`.
6. Open `http://localhost:3001/settings` or run `/dashboard` in Discord.
7. Test with one regular member and one user with Manage Server permission.

On a disposable local development database, set
`TOMORI_AUTO_BACKUP_ENABLED=false` if PostgreSQL client tools such as
`pg_dump` are not installed. Keep the startup backup enabled for real data.

For repository-level memory regression tests, configure a disposable local
Postgres instance and run:

```sh
bun test tests/regression/db/memory.regression.test.ts
```
