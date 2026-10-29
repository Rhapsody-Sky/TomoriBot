---
title: "Settings Website"
---

# Settings Website

TomoriBot can host an optional Discord OAuth dashboard at `/settings` from the
same Bun process as the bot. The dashboard is an add-on: bot startup and command
handling do not depend on it.

## Current Coverage

Every shared server member can:

- edit personal profile, pronouns, gender identity, addressing style, privacy,
  trigger/tool mode, appearance, and quarter-hour timezone offsets;
- control cross-server short-term-memory sharing, natural-nudge targeting, and
  whether personal-provider failures may fall back to server providers;
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
  request-local preview chat, with sprite portraits and identity names for each
  part of the response;
- manage persona sprites, including image uploads, names, usage instructions,
  identity mode, deletion, and ZIP import/export;
- edit server settings in task-based panels, including chat behavior,
  model sampling, cooldowns, capabilities, memory policy, channels, autochat,
  speech, NovelAI defaults, BYOK policy, welcome messages, notices, and text
  workarounds;
- edit short-term-memory refresh cadence, rendering mode, retained message count,
  injection depths, and tool/reminder prompt overrides;
- configure response prefill, draft-review context and instructions, new tool
  capabilities, and compact or detailed notices;
- manage server provider credentials, custom endpoints, scoped OpenRouter
  models, and the ordered fallback chain.

The `/dashboard` command returns the configured public dashboard link. The URL
comes only from `WEB_SETTINGS_PUBLIC_URL`; there is no second database override.

## Settings Navigation

Overview lists every installed persona with a link to its workspace. Statistics
stay scoped to the selected server and period. Model usage separates input and
output tokens, shows each model's share of the server total, and groups models
outside the top five as Other models. Costs use the repository's catalog-price
estimate, with missing prices counted as zero. They are not provider invoices.
The usage chart reads daily token totals through `StatRepository`, filling days
without counters with zero. Periods longer than 62 days are displayed as monthly
totals; the highest-usage day remains visible separately. The model filter uses
the token counters' model keys and applies only to the chart. UTC day buckets cannot
provide an hourly breakdown. Hovering, focusing or selecting a bar shows its
values, which are also available in an expandable table. Changing the period
refreshes only the statistics section.

My settings groups profile and appearance, privacy and memory, and personal
conversation preferences into separately saved panels. Personal provider
fallback belongs to My providers; server BYOK policy belongs to Server providers.
Persona-specific naming stays under Personas > My preferences and affects only
the signed-in member. Administrative persona settings remain permission-gated.
Persona settings and Sprites share the same test-chat history. Sending or
resetting the chat leaves the editor inputs intact. Save sprite descriptions
before testing them; the model uses the saved configuration.

Attribute and sample-dialogue editing uses the existing preset import limits in
`src/types/preset/presetExport.ts`. This keeps imported personas editable even
when their content exceeds the smaller manual-entry limits used by Discord.
These limits are defined in code and are not server settings. Writes still use
the persona repository and invalidate the server's persona cache after success.

Server settings groups conversation, models and sampling, channels and automation,
memory, tools and media, and notices and diagnostics. Memory contains learning
permissions, channel boundaries, STM behavior and category definitions. Response
review belongs to Conversation > Output; thought logs and prompt snapshots belong
to Notices & diagnostics.

At widths up to 980 pixels, a bottom navigation bar provides Overview, Personas,
My settings and More. More opens the remaining permitted destinations in a modal
bottom sheet. Server settings and persona sections use the same sheet pattern,
with the current section shown above the content. Escape, the close button or a
tap outside dismisses the sheet. Desktop keeps the sidebar and inline tabs.
Navigation icons are bundled Lucide assets with their license alongside them;
the dashboard does not fetch icons from an external service.

Profile panels, server settings, STM categories and persona naming retain unsaved
edits in page-local memory when switching views or servers. They are not persisted
to browser storage. Discard and explicit refresh ask for confirmation; closing or
reloading the page uses the browser's unsaved-changes warning. Saving disables the
form and temporarily blocks workspace navigation. Failed saves retain the edits
and show an inline recovery message. A panel spanning multiple repository domains
saves them in sequence; successful writes are retained if a later write fails,
and the error identifies the partial save. These writes are not transactional.

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

Short-term-memory settings are server configuration, not access to members'
private memory rows. Disabling automatic STM updates stops the update tool and
cadence reminders; existing memory content can still appear in context.

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
- `memoryService.ts`, `settingsService.ts`, `personaService.ts`, `spriteService.ts`,
  `personaChatService.ts`, and `providerService.ts` contain dashboard policy
  and request validation without direct SQL.
- `settingsCatalog.ts` defines validated fields for each split config domain.
  The frontend groups those fields into task-based panels and sends partial
  patches to the existing domain endpoints.
- STM settings use `ShortTermMemoryRepository`, including its upsert path for
  servers without a stored STM configuration. Other settings retain their own
  repository domains; the dashboard introduces no schema or migrations.
- Model selection uses the same config model operations as Discord, including
  provider ownership and embedding-family changes. Custom connection removal
  uses provider-panel operations and removes all models on that connection;
  an active text connection must first be replaced.
- Sprite routes require server management permission, including image previews
  and exports. Mutations use the shared Discord sprite operations for validation,
  quotas, preset-pointer materialization, cache invalidation and image cleanup.
  Browser uploads pass bounded `File` objects; Discord attachments retain their
  safe-download path. ZIP import reports created, replaced and failed entries;
  export reports unreadable images that were skipped.
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
  It collects the stream's held response without calling its delivery function.
  Sprite presentation comes from the shared stream parser, including changes
  across lines and plain-label resets. Images use the permission-gated sprite
  proxy; only text and roles are submitted as history on the next turn.
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
3. Run `bun --no-env-file test tests/unit/web` for dashboard unit and HTTP tests.
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
bun run test tests/regression/db/memory.regression.test.ts
```

The unit tests do not verify production database upgrades or live provider
requests. Before upgrading an existing deployment, back up its database and
stored avatar files and test the upstream migration sequence on a restored copy.
Server settings > Memory includes an admin-only STM category editor with up to
five categories. Names use the shared slug rules, and each name plus description
must fit Discord's 1,000-character input limit. Empty slots are omitted; clearing
all slots or restoring defaults saves the standard summary category. Category
changes do not delete or migrate stored STM contents, so changing category keys
can hide older values until a later model update.

Personas > My preferences lets each member set their own nickname, prefix and
suffix for the selected persona lineage. These preferences follow the lineage
across servers. The API derives both the user and lineage from the authenticated
session and the selected server's persona list. Inherit saves null; None saves
an explicit empty prefix or suffix. Reset removes all three overrides through
the existing personal configuration operation, including user cache invalidation.
Administrators do not receive access to other members' naming preferences.

Draft-review model/checker selection, stored STM content, and advanced
natural-nudge schedules still use the Discord panels.
