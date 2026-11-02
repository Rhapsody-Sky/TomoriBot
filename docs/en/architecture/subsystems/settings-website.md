---
title: "Settings Website"
---

# Settings Website

TomoriBot can host an optional Discord OAuth dashboard at `/settings` from the
same Bun process as the bot. The dashboard is an add-on: bot startup and command
handling do not depend on it.

## Current Coverage

The sidebar separates cross-server preferences under Global, the selected server's
workspace under Server Settings, and guild management under Server Administration.

Instance administrators are designated through `WEB_SETTINGS_GLOBAL_ADMIN_IDS`, a
comma-separated list of Discord user IDs in the deployment environment. The default
is empty; changes take effect after restarting the bot. Only complete numeric IDs
of 17-20 digits are accepted. The authenticated session reports `user.isGlobalAdmin`
from this list, never from Discord guild permissions. This designation does not grant
access to guild data or other users' private memories. Global Administration has no
pages yet, so the navigation does not display an empty group. Legal-page editing is
not implemented.

Every shared server member can:

- edit personal profile, pronouns, gender identity, addressing style, privacy,
  trigger/tool mode, appearance, and quarter-hour timezone offsets;
- control cross-server short-term-memory sharing, natural-nudge targeting, and
  whether personal-provider failures may fall back to server providers;
- manage global personal memories (lineage `0`) from the personal workspace;
- open a persona workspace that groups their private persona memories with the
  server memories they taught for that same lineage;
- read serverwide lorebook collections and the selected persona's lorebook entries;
- import and export personal memory scopes;
- store encrypted personal provider credentials, choose active capabilities,
  and manage personal custom endpoints and scoped OpenRouter models.

Members with Manage Server or Administrator can additionally:

- view and manage all server memories;
- manage lorebook collections, entries, activation settings, and channel scopes,
  and import or export SillyTavern JSON;
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

The dashboard uses the shared UI kit in `assets/ui-kit.css`. Application layout
adapters live in `assets/dashboard.css`; `assets/controls.js` and
`assets/controls.css` connect kit controls to native form fields. The legacy
`app.css` and `companion.css` are not loaded. The control enhancer runs after rendering a workspace or
replacing an asynchronous section. It preserves native field names and values
for the existing form handlers; it does not observe the whole document.
Appearance preferences stay in browser storage, including separate light and
dark lighting values. They never change server settings.

Persona attributes, sample dialogues and sprites have separate read and edit
states. Cancel discards the entry draft; Save uses the existing persona API.
Lorebooks use a book list, entry list and selected-entry editor. Content,
matching rules and activation settings retain their individual save operations.

Overview summarizes the persona count and the most active persona for the selected
period. A searchable picker opens individual persona workspaces. Statistics
stay scoped to the selected server and period. Model usage separates input and
output tokens and groups models outside the top five as Other models when all
models are selected. The model filter applies to token totals, chart, shares and
exact-value tables. Server activity counts remain serverwide and are labelled
separately. Costs use the repository's catalog-price estimate, with missing
prices counted as zero. A selected model outside the top five has no available
cost estimate. Costs are not provider invoices.
The usage chart reads daily token totals through `StatRepository`, filling days
without counters with zero. Periods longer than 62 days are displayed as monthly
totals; the highest-usage day remains visible separately. The model filter uses
the token counters' model keys. UTC day buckets cannot
provide an hourly breakdown. Hovering, focusing or selecting a bar shows its
values, which are also available in an expandable table. Changing the period
refreshes only the statistics section. Custom ranges include both selected UTC
dates and apply the same bounds to totals, rankings, costs and token history.
Editing or cancelling a range leaves the active period unchanged until Apply.

My settings groups profile and appearance, privacy and memory, and personal
conversation preferences into separately saved panels. Personal provider
fallback belongs to My providers; server BYOK policy belongs to Server providers.
Both provider pages use Connections, Model routing, and Fallbacks tabs, with the
same mobile category menu as Server settings. Each scope keeps its selected tab.
Personal model choices share one save action. Only changed choices are sent to
the existing per-capability operation, which enables those capabilities. If a
request fails, retrying skips choices already saved by that action.
Persona-specific naming stays under Personas > My preferences and affects only
the signed-in member. Administrative persona settings remain permission-gated.
Lorebooks opens serverwide collections; Personas > Lorebook opens the selected
persona lineage. Members can read both scopes, but only server managers can write.
The collection list shows each book and its entry count beside the selected
book's entries. Collection settings have their own dialog. Entry dialogs separate
content, matching words, and additional rules; no editing forms appear in the
browsing list. Creation and import also use dialogs. Closing an entry dialog
retains its draft, and successful saves return focus to its launch button.
Content-only edits preserve activation settings, including Always on. Keyword
edits use the shared Discord operation, which enables Always on for an empty list.
Narrow screens place the collection list above the entries. Compact tab menus
and the mobile navigation drawer move the existing navigation elements rather
than maintaining a second set of links.
Channel-scope help links open the Memory settings group and focus Channel-scoped
memory on the selected server.
Persona settings and Sprites share the same test-chat history. Sending or
resetting the chat leaves the editor inputs intact. Save sprite descriptions
before testing them; the model uses the saved configuration.

Attribute and sample-dialogue editing uses the existing preset import limits in
`src/types/preset/presetExport.ts`. This keeps imported personas editable even
when their content exceeds the smaller manual-entry limits used by Discord.
These limits are defined in code and are not server settings. Writes still use
the persona repository and invalidate the server's persona cache after success.

Channel settings groups channel-scoped controls around a categorized channel picker.
The Allowlist tab manages which channels Tomori can use. A nonempty allowlist limits
the settings picker to those channels; an empty stored allowlist allows all channels
and is displayed with every channel selected. The dashboard rejects an empty selection.
Channel settings save per panel; saving one panel preserves unsaved edits in the others.
Selecting one channel shows its editable values directly. Multiple selections use
explicit batch changes; omitted settings retain each channel's value. The panels
include autochat enablement and persona,
private memory, outgoing context restrictions, roleplay suppression, text-model and
prompt overrides, context notes, channel allowlists and cooldowns, and persona channel
restrictions. Persona allowlists restrict a persona to its listed channels, not a channel
to its listed personas. An empty persona allowlist removes that persona's restriction.
The persona's Allowed channels tab and the channel's Allowed personas editor update
the same list. Unrestricted personas appear selected in every channel. Deselecting one
limits it to the remaining existing channels; future channels are then excluded.
Selecting all channels restores unrestricted access. Both editors and the dashboard API
reject removing the final allowed channel. Multi-channel edits preserve untouched personas.
Channel cooldown overrides require a channel allowlist entry. Writes reuse the owning
repositories and text-model operations, with their cache invalidation. Batch writes
are sequential, not atomic; failures may leave earlier writes saved.

Other channel fields, including welcome and thought-log destinations and lorebook
scopes, use the same categorized, searchable picker. Multi-selection provides select
and deselect actions for the filtered channels without changing hidden selections.

Server settings groups conversation, models and sampling, channels and automation,
memory, tools and media, and notices and diagnostics. Memory contains learning
permissions, channel-memory enablement, STM behavior and category definitions. Response
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

Server memories no longer accept keyword tags. Upstream migrations move tagged
server memories into lorebooks; personal memory tags are unchanged. Server-memory
import and export are disabled in the dashboard because its transfer format does not preserve channel scopes
and unresolved legacy channel restrictions. Use Discord for those transfers.

Lorebook entry edits use the shared Discord operations. Collection writes use the
owning lorebook repository, with server, persona, book, and channel checks at the
dashboard boundary. Content edits preserve imported placement and unchanged legacy
channel restrictions. Imports use the shared converter and atomic repository
append or replacement, and return conversion warnings. SillyTavern exports carry
entry content and activation settings, not Discord channel restrictions or book
settings; they are not full server backups.

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
- `assets/app.js` renders the dependency-free browser UI using the shared kit.

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
