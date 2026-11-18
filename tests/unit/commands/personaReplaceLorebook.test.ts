import { afterEach, beforeAll, expect, it, spyOn } from "bun:test";
import type { ChatInputCommandInteraction, Client, ModalSubmitInteraction } from "discord.js";
import { execute } from "@/commands/persona/replace";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import type { LorebookEntryInput } from "@/modules/lorebooks/db/types";
import { PRESET_EXPORT_VERSION, type PresetExportData } from "@/types/preset/presetExport";
import type { TomoriPresetRow } from "@/types/db/schema";
import { EMPTY_PERSONA_NAMING_CONFIG } from "@/types/personaNaming";
import * as personaSpriteCache from "@/utils/cache/personaSpriteCache";
import * as tomoriStateCache from "@/utils/cache/tomoriStateCache";
import { configRepository, personaRepository, personaSpriteRepository } from "@/utils/db/repositories";
import * as confirmation from "@/utils/discord/ui/confirmation";
import * as modals from "@/utils/discord/ui/modals";
import * as avatarHelper from "@/utils/image/avatarHelper";
import * as guildIdentity from "@/utils/discord/guildIdentity";
import * as rateLimiter from "@/utils/security/rateLimiter";
import * as safeDownloadModule from "@/utils/security/safeDownload";
import { initializeLocalizer } from "@/utils/text/localizer";
import { createPersona, createUserRow } from "../../helpers/fixtures";
import { makeFakeInteraction, type FakeCall } from "../../helpers/fakeInteraction";
import { localizedCopy } from "../../helpers/localeCases";

const GUILD_ID = "100000000000000001";
const USER_ID = "100000000000000002";
const spies: Array<{ mockRestore(): void }> = [];

beforeAll(initializeLocalizer);
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

type TestAttachment = { name: string; size: number; url: string };

function trackedSpy<T extends { mockRestore(): void }>(spy: T): T {
  spies.push(spy);
  return spy;
}

function makeInteraction(
  options: {
    attachment?: TestAttachment | null;
    confirmationAdmin?: boolean;
    initialPermissions?: readonly string[];
    lorebookMode?: string | null;
  } = {},
) {
  let memberFetchCount = 0;
  const guild = {
    id: GUILD_ID,
    members: {
      fetch: async () => {
        memberFetchCount++;
        return {
          permissions: {
            has: (permission: unknown) => options.confirmationAdmin !== false && permission === "Administrator",
          },
        };
      },
    },
  };
  const fake = makeFakeInteraction({
    guild,
    guildId: GUILD_ID,
    memberPermissions: {
      has: (permission: unknown) => (options.initialPermissions ?? ["Administrator"]).includes(String(permission)),
    },
    user: {
      id: USER_ID,
      displayName: "TestUser",
      globalName: "TestUser",
      username: "testuser",
      displayAvatarURL: () => "https://cdn.example.com/avatar.png",
    },
  });
  const commandOptions = fake.interaction.options as unknown as {
    getAttachment: (_name: string) => TestAttachment | null;
    getString: (_name: string, _required?: boolean) => string | null;
  };
  commandOptions.getAttachment = () => options.attachment ?? null;
  commandOptions.getString = (name) => (name === "lorebook" ? (options.lorebookMode ?? null) : null);

  return {
    interaction: fake.interaction as unknown as ChatInputCommandInteraction,
    calls: fake.calls,
    memberFetchCount: () => memberFetchCount,
  };
}

function lastEmbedDescription(calls: FakeCall[]): string | undefined {
  for (let index = calls.length - 1; index >= 0; index--) {
    const call = calls[index];
    if (call.method !== "reply" && call.method !== "editReply") continue;
    const payload = call.args[0] as { embeds?: Array<{ toJSON: () => { description?: string } }> } | undefined;
    const description = payload?.embeds?.[0]?.toJSON().description;
    if (description) return description;
  }
  return undefined;
}

function makePreset(): TomoriPresetRow {
  return {
    persona_preset_id: 7,
    persona_preset_name: "New Character",
    persona_preset_desc: "A replacement character.",
    preset_lineage_id: 77,
    preset_attribute_list: [],
    preset_attribute_public_flags: [],
    preset_sample_dialogues_in: [],
    preset_sample_dialogues_out: [],
    preset_language: "en-US",
    preset_trigger_words: [],
    preset_naming_config: structuredClone(EMPTY_PERSONA_NAMING_CONFIG),
    is_nsfw: false,
    natural_nudge_interests: [],
    natural_nudge_talkativeness: 2,
    natural_nudge_idle_nudges: [],
  };
}

const importedEntry: LorebookEntryInput = {
  title: "Archive",
  content: "The archive is beneath the old library.",
  keys: ["archive"],
  secondary_keys: [],
  selective_logic: 0,
  scan_depth: 5,
  trigger_chance: 100,
  insertion_order: 100,
  placement: 0,
  constant: false,
  enabled: true,
  channel_disc_ids: [],
};

function makeCardBuffer(lorebookEntries?: LorebookEntryInput[]): Buffer {
  const data: PresetExportData = {
    tomori_nickname: "New Character",
    attribute_list: [],
    sample_dialogues_in: [],
    sample_dialogues_out: [],
    trigger_words: [],
    ...(lorebookEntries === undefined ? {} : { lorebook_entries: lorebookEntries }),
  };
  return Buffer.from(
    JSON.stringify({
      version: PRESET_EXPORT_VERSION,
      type: "preset",
      exported_at: new Date(0).toISOString(),
      data,
    }),
    "utf8",
  );
}

function prepareFlow(
  options: {
    attachment?: TestAttachment | null;
    cardBuffer?: Buffer;
    confirmationAdmin?: boolean;
    confirmationOutcome?: "continue" | "cancel" | "timeout";
    lorebookMode?: string | null;
  } = {},
) {
  const sourcePersona = createPersona({ is_alter: true });
  const preset = makePreset();
  const interaction = makeInteraction(options);
  const modal = makeFakeInteraction();
  const sourceWrites = trackedSpy(spyOn(personaRepository, "replaceCharacterFromCard")).mockResolvedValue({} as never);
  const presetWrites = trackedSpy(spyOn(personaRepository, "applyPresetPointerToPersona")).mockResolvedValue(
    sourcePersona,
  );
  const loadPersonas = trackedSpy(spyOn(personaRepository, "loadAllForServer")).mockResolvedValue([sourcePersona]);
  const loadPresets = trackedSpy(spyOn(configRepository, "loadPresetRowsByLocale")).mockResolvedValue([preset]);
  const listSprites = trackedSpy(spyOn(personaSpriteRepository, "listForPersona")).mockResolvedValue([]);
  const listLorebook = trackedSpy(spyOn(lorebookRepository, "listScope")).mockResolvedValue({
    status: "fresh",
    entries: [],
  });
  const modalPrompt = trackedSpy(spyOn(modals, "promptWithPaginatedModal")).mockResolvedValue({
    outcome: "submit",
    interaction: modal.interaction as unknown as ModalSubmitInteraction,
    values: { source_persona: String(sourcePersona.persona_id), replacement_preset: String(preset.persona_preset_id) },
  });
  const confirmationPrompt = trackedSpy(spyOn(confirmation, "promptWithConfirmation")).mockResolvedValue({
    outcome: options.confirmationOutcome ?? "continue",
  });

  trackedSpy(spyOn(avatarHelper, "getPresetAvatarBuffer")).mockResolvedValue(null);
  trackedSpy(spyOn(rateLimiter, "reserveImportQuota")).mockReturnValue({ allowed: true });
  trackedSpy(spyOn(safeDownloadModule, "safeDownload")).mockResolvedValue({
    success: true,
    buffer: options.cardBuffer ?? Buffer.alloc(0),
  });
  trackedSpy(spyOn(tomoriStateCache, "invalidateTomoriStateCache")).mockImplementation(() => undefined);
  trackedSpy(spyOn(personaSpriteCache, "invalidatePersonaSpriteCache")).mockImplementation(() => undefined);

  return {
    ...interaction,
    modalCalls: modal.calls,
    sourcePersona,
    sourceWrites,
    presetWrites,
    loadPersonas,
    loadPresets,
    listSprites,
    listLorebook,
    modalPrompt,
    confirmationPrompt,
  };
}

it("requires Administrator instead of accepting ManageGuild for persona replacement", async () => {
  const interaction = makeInteraction({ initialPermissions: ["ManageGuild"] });
  const loadPersonas = trackedSpy(spyOn(personaRepository, "loadAllForServer")).mockResolvedValue([]);
  const sourceWrites = trackedSpy(spyOn(personaRepository, "replaceCharacterFromCard")).mockResolvedValue(null);
  const presetWrites = trackedSpy(spyOn(personaRepository, "applyPresetPointerToPersona")).mockResolvedValue(null);

  await execute({} as Client, interaction.interaction, createUserRow(), "en-US");

  expect(lastEmbedDescription(interaction.calls)).toBe(
    localizedCopy("en-US", "commands.persona.replace.no_permission_description"),
  );
  expect(loadPersonas).not.toHaveBeenCalled();
  expect(sourceWrites).not.toHaveBeenCalled();
  expect(presetWrites).not.toHaveBeenCalled();
});

it("rejects lorebook import mode when no card attachment is supplied", async () => {
  const interaction = makeInteraction({ lorebookMode: "import" });
  const loadPersonas = trackedSpy(spyOn(personaRepository, "loadAllForServer")).mockResolvedValue([]);
  const sourceWrites = trackedSpy(spyOn(personaRepository, "replaceCharacterFromCard")).mockResolvedValue(null);
  const presetWrites = trackedSpy(spyOn(personaRepository, "applyPresetPointerToPersona")).mockResolvedValue(null);

  await execute({} as Client, interaction.interaction, createUserRow(), "en-US");

  expect(lastEmbedDescription(interaction.calls)).toBe(
    localizedCopy("en-US", "commands.persona.replace.lorebook_missing_description"),
  );
  expect(loadPersonas).not.toHaveBeenCalled();
  expect(sourceWrites).not.toHaveBeenCalled();
  expect(presetWrites).not.toHaveBeenCalled();
});

it("rejects a card in import mode when the card omits lorebook_entries", async () => {
  const cardBuffer = makeCardBuffer();
  const attachment = { name: "character.json", size: cardBuffer.length, url: "https://cdn.example.com/character.json" };
  const flow = prepareFlow({ lorebookMode: "import", attachment, cardBuffer });

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(lastEmbedDescription(flow.modalCalls)).toBe(
    localizedCopy("en-US", "commands.persona.replace.lorebook_missing_description"),
  );
  expect(flow.confirmationPrompt).not.toHaveBeenCalled();
  expect(flow.sourceWrites).not.toHaveBeenCalled();
  expect(flow.presetWrites).not.toHaveBeenCalled();
});

it("passes imported lorebook entries from the card to character replacement", async () => {
  const cardBuffer = makeCardBuffer([importedEntry]);
  const attachment = { name: "character.json", size: cardBuffer.length, url: "https://cdn.example.com/character.json" };
  const flow = prepareFlow({ lorebookMode: "import", attachment, cardBuffer });

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(flow.listLorebook).toHaveBeenCalledWith(flow.sourcePersona.server_id, flow.sourcePersona.persona_lineage_id);
  expect(flow.confirmationPrompt).toHaveBeenCalledTimes(1);
  expect(flow.sourceWrites).toHaveBeenCalledWith(expect.objectContaining({ lorebookEntries: [importedEntry] }));
  expect(flow.presetWrites).not.toHaveBeenCalled();
});

it("passes an explicit empty card lorebook as a clear request", async () => {
  const cardBuffer = makeCardBuffer([]);
  const attachment = { name: "character.json", size: cardBuffer.length, url: "https://cdn.example.com/character.json" };
  const flow = prepareFlow({ lorebookMode: "import", attachment, cardBuffer });

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(flow.sourceWrites).toHaveBeenCalledWith(expect.objectContaining({ lorebookEntries: [] }));
  expect(flow.presetWrites).not.toHaveBeenCalled();
});

it("passes an explicit empty list when clear is selected for a preset replacement", async () => {
  const flow = prepareFlow({ lorebookMode: "clear" });

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(flow.listLorebook).toHaveBeenCalledWith(flow.sourcePersona.server_id, flow.sourcePersona.persona_lineage_id);
  expect(flow.presetWrites).toHaveBeenCalledWith(expect.objectContaining({ lorebookEntries: [] }));
  expect(flow.sourceWrites).not.toHaveBeenCalled();
});

it("leaves lorebookEntries undefined when the option defaults to preserve", async () => {
  const flow = prepareFlow();

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(flow.listLorebook).not.toHaveBeenCalled();
  expect(flow.presetWrites).toHaveBeenCalledWith(expect.objectContaining({ lorebookEntries: undefined }));
  expect(flow.sourceWrites).not.toHaveBeenCalled();
});

it("does not continue after the confirmation is cancelled", async () => {
  const flow = prepareFlow({ confirmationOutcome: "cancel" });

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(flow.memberFetchCount()).toBe(0);
  expect(flow.presetWrites).not.toHaveBeenCalled();
  expect(flow.sourceWrites).not.toHaveBeenCalled();
});

it("rechecks Administrator after confirmation before writing the replacement", async () => {
  const flow = prepareFlow({ confirmationAdmin: false });

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(flow.memberFetchCount()).toBe(1);
  expect(lastEmbedDescription(flow.modalCalls)).toBe(
    localizedCopy("en-US", "commands.persona.replace.no_permission_description"),
  );
  expect(flow.presetWrites).not.toHaveBeenCalled();
  expect(flow.sourceWrites).not.toHaveBeenCalled();
});

it("clears the guild avatar when the replacement preset has no avatar", async () => {
  const flow = prepareFlow();
  flow.sourcePersona.is_alter = false;
  const nickname = trackedSpy(spyOn(guildIdentity, "setGuildBotNickname")).mockResolvedValue({ success: true });
  const avatar = trackedSpy(spyOn(guildIdentity, "setGuildBotAvatar")).mockResolvedValue({ success: true });
  trackedSpy(spyOn(personaRepository, "markServerMainAvatarSynced")).mockResolvedValue(undefined);

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(nickname).toHaveBeenCalledWith(GUILD_ID, "New Character");
  expect(avatar).toHaveBeenCalledWith(GUILD_ID, null);
});

it("preserves the guild avatar for a JSON replacement without an image", async () => {
  const cardBuffer = makeCardBuffer();
  const attachment = { name: "character.json", size: cardBuffer.length, url: "https://cdn.example.com/character.json" };
  const flow = prepareFlow({ attachment, cardBuffer });
  flow.sourcePersona.is_alter = false;
  trackedSpy(spyOn(guildIdentity, "setGuildBotNickname")).mockResolvedValue({ success: true });
  const avatar = trackedSpy(spyOn(guildIdentity, "setGuildBotAvatar")).mockResolvedValue({ success: true });

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(flow.sourceWrites).toHaveBeenCalledTimes(1);
  expect(avatar).not.toHaveBeenCalled();
});

it("preserves the preset avatar reference when JSON materializes a main pointer", async () => {
  const flow = prepareFlow({
    attachment: { name: "replacement.json", size: 100, url: "https://cdn.example.com/card.json" },
    cardBuffer: makeCardBuffer(),
  });
  Object.assign(flow.sourcePersona, {
    is_alter: false,
    is_pointer: true,
    preset_lineage_id: 77,
    preset_language: "ja",
    webhook_avatar_url: null,
  });
  const sourcePreset = { ...makePreset(), preset_avatar_shared_url: "presets/current-avatar.png" };
  const loadPreset = trackedSpy(spyOn(configRepository, "loadPresetByReference")).mockResolvedValue(sourcePreset);
  trackedSpy(spyOn(guildIdentity, "setGuildBotNickname")).mockResolvedValue({ success: true });

  await execute({} as Client, flow.interaction, createUserRow(), "en-US");

  expect(loadPreset).toHaveBeenCalledWith(77, "ja");
  expect(flow.sourceWrites.mock.calls[0]?.[0].avatarUrl).toBe(sourcePreset.preset_avatar_shared_url);
});
