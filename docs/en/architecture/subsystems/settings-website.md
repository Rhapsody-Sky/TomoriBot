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

The workspace selector also includes an initialized DM workspace owned by the
signed-in user. Its scope is the authenticated Discord user ID, never a supplied
recipient ID. The owner can manage its stored settings and memories. Channel
administration, persona creation/import, avatar changes, and test chat require a
Discord guild and are not offered in the DM workspace.

Instance administrators are designated through `WEB_SETTINGS_GLOBAL_ADMIN_IDS`, a
comma-separated list of Discord user IDs in the deployment environment. The default
is empty; changes take effect after restarting the bot. Only complete numeric IDs
of 17-20 digits are accepted. The authenticated session reports `user.isGlobalAdmin`
from this list, never from Discord guild permissions. This designation does not grant
access to guild data or other users' private memories.

Global Administration includes Pages & links, available even without a shared guild.
Global administrators edit Imprint, Data protection, and Cookie notice with a rich-text
editor, and add external links such as support pages. Each item has a title, display
order, and visibility settings. Imprint and Data protection start empty and hidden.
The built-in Cookie notice is public until a global administrator replaces or hides it.
Published pages appear below the login and in the dashboard sidebar.
Hiding a page makes its public URL return 404 without deleting its draft. External
links have separate switches for the public navigation and the signed-in sidebar.
The public navigation appears below the login and on the public pages.

`DashboardSiteRepository` stores these installation-wide entries in
`dashboard_site_entries`, created by migration `900_dashboard_site_entries` during
normal bot startup. The deployment-specific migration band runs on both fresh and
existing databases without adding dashboard tables to the upstream schema snapshot.
Migration `901_dashboard_link_visibility` copies each existing link's visibility to
both placements. It cannot be rolled back while any link has different settings for
the two placements. Include this table in database backups. The table's down migration
refuses to remove it while it contains pages or links, including hidden drafts.
`siteService.ts` validates writes and sanitizes rich text on both write and read.
The login navigation and `/settings/pages/:pageId` require no sign-in. Sidebar-only
links are returned only to signed-in users. The `/settings/api/site-admin/*` routes require
a configured global administrator; mutations also require the session CSRF token.
The editor assets are served locally and loaded only when opening administration.
Design changes apply to the open page. The design menu stores them in the browser
only when the user turns on **Remember design on this device**. Turning it off clears
the saved design and leaves sign-in cookies untouched.

Every shared server member can:

- edit personal profile, name prefix and suffix, Discord language preference,
  privacy, trigger/tool mode, appearance, and quarter-hour timezone offsets;
- control cross-server short-term-memory sharing, natural-nudge targeting, and
  whether personal-provider failures may fall back to server providers;
- manage global personal memories (lineage `0`) from the personal workspace;
- check the number of active personal short-term memory entries and request
  their deletion across servers and DMs. The account-scoped endpoint uses the
  Discord count and clear operations. It returns no conversation content or
  shared server memory;
- manage their own channel spotlights on the selected server. The picker only
  offers Discord text channels the member can see. Spotlights cannot override
  server or persona permissions;
- open a persona workspace that groups their private persona memories with the
  server memories they taught for that same lineage;
- read serverwide lorebook collections and the selected persona's lorebook entries;
- import and export personal memory scopes;
- store encrypted personal provider credentials, switch assigned capabilities
  on or off across servers without losing their model selections, and manage
  personal custom endpoints and scoped OpenRouter models. The
  personal model randomizer requires at least one personal fallback.

Members with Manage Server or Administrator can additionally:

- manage the role allowlist and server blacklist, lift active persona mutes and
  blocks, and set text, image, and video quotas under **Moderation**. The page uses
  the same operations as Discord's `/moderation` and requires a current guild
  membership with Manage Server permission;
- view and manage all server memories;
- manage lorebook collections, entries, activation settings, and channel scopes,
  and import or export SillyTavern JSON;
- create and import alter personas, change or remove their avatars, and delete
  alter personas;
- export the selected persona as an importable JSON card or as a PNG with its
  avatar. Cards include persona lorebook entries but do not include memories or
  the sprite archive. DM owners can export their own persona;
- switch the main persona to an official preset or import a TomoriBot or
  SillyTavern PNG or JSON card. The review shows the destination lineage,
  whether existing memories will still be available to the main persona, and
  how many destination lorebook entries the card will replace. A preset uses
  its own lineage and leaves lorebooks unchanged. A card can reuse its lineage
  or start a new one. If it omits the lorebook, the destination keeps its entries;
  an explicitly empty lorebook clears them. Memories are not moved or copied.
- edit persona identity, trigger words, prompt, attributes and visibility,
  sample dialogues, context note, and appearance data from the same persona
  workspace as its memories;
- set a persona's default prefix, suffix, and address term for each addressing
  style under **Persona settings**. Individual members' affix overrides still
  take precedence;
- upload a persona's image-generation reference under `Appearance & image prompt`;
- set NovelAI writing metadata and resync a customized identity with its preset
  under `Persona settings`. Resync keeps the persona's lineage, including its
  memories and lorebooks;
- choose a voice description, server sample or ElevenLabs voice, and source
  priority under `Voice`. The owner of a DM workspace can also edit its voice;
- review and remove history entries under `Knowledge` > `Reward & Punishment`
  for a persona on the selected server;
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
- configure response prefill, draft-review context and instructions, the
  reviewer model, and an optional compatible workspace rule checker;
- manage server Logit Bias under `Server settings` > `Models & sampling`;
- choose a system prompt preset as an editable draft, or restore the built-in
  prompt. An active SillyTavern preset locks the server prompt;
- configure tool capabilities, custom literal phrases for deliberate tool mode,
  and notices. Existing regular expressions can be removed in the dashboard;
  use Discord to add one;
- manage scheduled triggers in visible text channels. Editing keeps the channel
  and persona and restarts the interval. The existing scheduler delivers them;
- set server response cooldowns and channel overrides using the scopes offered
  in Discord. Existing legacy values stay in place until explicitly changed;
  slash-command category cooldowns are set by the deployment;
- manage server provider credentials, custom endpoints, scoped OpenRouter
  models, and the ordered fallback chain. `Primary models` also lets managers
  select a registered Decision model and separate targets for speech design and
  cloning. Each speech target can be a hosted model or a compatible endpoint.

The dashboard validates new and replacement API keys with their provider before
storing them. Server managers can also manage a Brave Search key and a provider's
rotation pool without viewing saved secrets. Endpoint model edits apply to one
registered model; connection edits apply to all models that use it.
Saving a personal endpoint model follows the Discord editor's routing rules and
can enable that provider for the model's capability.

The `/dashboard` command returns the configured public dashboard link. The URL
comes only from `WEB_SETTINGS_PUBLIC_URL`; there is no second database override.

## Settings Navigation

Channel selectors follow the server channel allowlist. The allowlist editor itself
shows every channel. Saved selections outside the allowlist are preserved when
editing other fields; filtering the choices does not delete stored assignments.
Desktop tab bars keep the tabs that fit and offer the remainder through More.
At the mobile breakpoint, the section picker shows all tabs.

The dashboard uses the shared UI kit in `assets/ui-kit.css`. Personas uses the
Collection frame, dock and cards from `assets/collection.css`. Both kit enhancers
run after rendering a workspace or replacing asynchronous content.
`TomoriControls` preserves native form fields for the existing handlers.
`TomoriFX` controls when a Collection card shows Save and Discard, and the
application marks the card saved after its write succeeds.
On Personas, the banner, dock and chat stay mounted during section changes.
The application updates the selected controls and replaces the stage content.
Switching personas keeps the section selected and updates the banner and chat.
Leaving a Persona section with unsaved edits asks whether to discard them.

`Your design` keeps preferences in browser storage when the user chooses to
remember them on that device. Stored settings apply before the dashboard paints.
Persona colors affect the persona banner and test chat.

Persona attributes and sample dialogues open in place. Sprite tiles open an
editor dialog. Click the image preview or drop a file on it to stage a new image
until Save. A hold button deletes the sprite. A failed write keeps the editor
open with its input intact.
Server lorebooks show the book list beside searchable entry previews. Both
server and persona previews show content, activation and channel scope. They
open a full-width editor with separate cards for content, triggers and advanced
rules. Server entries inherit the book's channels, which are edited in Lorebook
settings. Persona entries have their own channel card. Returning to the list
restores the filter and asks about unsaved edits.

Overview shows the persona count in the server banner and ranks personas by
interactions in the selected period. The Personas shortcut opens the workspace,
where the searchable picker switches between personas. Statistics
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
refreshes the statistics below the period controls. Overview opens on 30 days.
The period bar moves options into More when they cannot all fit. The tiles show
trends for periods spanning at least seven days, using up to 30 buckets across
the selected period. The cost trend uses the same catalog pricing as the total.
Custom ranges include both selected UTC dates and apply the same bounds to
totals, rankings, costs and token history.
Editing or cancelling a range leaves the active period unchanged until Apply.

The overview API filters the channel inventory and allowlist IDs by the signed-in
member's Discord permissions. A visible channel under a hidden category has no
category label. An active allowlist stays active even if none of its channels are
visible.

My settings groups profile and appearance, privacy and memory, and personal
conversation preferences into separately saved panels. Personal provider
fallback belongs to My providers; server BYOK policy belongs to Server providers.
Both provider pages use Connections, Model routing, and Fallbacks tabs, with the
same mobile category menu as Server settings. Each scope keeps its selected tab.
Personal model choices share one save action. Only changed choices are sent to
the existing per-capability operation, which enables those capabilities. If a
request fails, retrying skips choices already saved by that action.
Under `Primary models`, server managers can choose a hosted transcription model,
select a registered transcription endpoint, or turn off server transcription.
Members can select a hosted transcription model for their own audio attachments.
Adding a provider key can fill an empty transcription slot with that provider's
default, as in Discord. Replacing a key leaves the selection unchanged.
Turning off `Post speech transcripts in Discord` hides them from the channel
without disabling transcription or removing transcripts from Tomori's context.
In an OpenRouter connection, registering a transcription model also selects it
for that workspace. A saved OpenRouter key is required.
Under `Persona settings`, the Humanizer can inherit the server settings or use
custom delivery switches for that persona.
Persona-specific naming stays under Personas > My preferences and affects only
the signed-in member. Administrative persona settings remain permission-gated.
`Lorebooks` opens serverwide collections. `Personas` > `Knowledge` > `Lorebooks`
opens the selected persona lineage. Members can read both scopes; only server
managers can write.
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
Server managers open the private test chat from the persona page. The dock stays
available while switching sections. Each persona has its own history for the
current workspace session. Test messages use its saved configuration and the
configured text model.

Attribute and sample-dialogue editing uses the existing preset import limits in
`src/types/preset/presetExport.ts`. This keeps imported personas editable even
when their content exceeds the smaller manual-entry limits used by Discord.
These limits are defined in code and are not server settings. Writes still use
the persona repository and invalidate the server's persona cache after success.

Channel settings uses the Collection channel picker on both dock tabs.
The Allowlist tab manages which channels Tomori can use. A nonempty allowlist limits
the settings picker to those channels; an empty stored allowlist allows all channels
and is displayed with every channel selected. The dashboard rejects an empty selection.
Each settings card saves independently. Saving a card preserves drafts in the other cards.
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

The Server settings dock switches between conversation, models and sampling, channels
and automation, memory, tools and media, and notices and diagnostics. Each card
shows Save and Discard when its fields change. Memory contains learning
permissions, channel-memory enablement, STM behavior and category definitions. Response
review belongs to Conversation > Draft review; thought logs and prompt snapshots belong
to Notices & diagnostics.

The mobile navigation drawer uses the same permitted destinations as the desktop
sidebar. On Personas, the dock keeps the current section visible and puts sections
that do not fit under More. Knowledge views use the segmented control below it.
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
server memories into lorebooks; personal memory tags are unchanged. The server
memory editor offers visible, allowlisted text and announcement channels. Text
edits preserve the saved channel scope, including unavailable channels and
unresolved legacy restrictions. Changing scope uses the Discord memory operation.
Server-memory import and export are disabled in the dashboard because its transfer format does not preserve channel scopes
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
  provider ownership and embedding-family changes. `Edit connection` in both
  provider workspaces uses the Discord provider operation to update the whole
  named connection while preserving its models. A blank token keeps the stored
  credential. Removing a connection removes its models; switch away from an
  active text connection before removing it.
- The Connections submenu in `Server providers` selects the connection to manage.
  Choose `Other provider` in `Add provider` to register a custom endpoint.
  Its model registrations and provider parameters appear below. Primary models
  and the fallback chain have their own sections. Removing a saved provider uses the Discord operation. The
  active text provider is protected. Removing another provider also removes its
  saved credential, rotation keys, and server-specific model registrations.
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
