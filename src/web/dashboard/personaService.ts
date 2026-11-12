import { createHash } from "node:crypto";
import type { Client, Guild } from "discord.js";
import { z } from "zod";
import { MAX_VOICE_DESIGN_PROMPT_LENGTH } from "@/constants/speech";
import type { TomoriPresetRow } from "@/types/db/schema";
import {
  resolveAvailablePersonaName,
  resolvePresetLineageId,
  resolvePresetTriggerWords,
} from "@/commands/persona/default";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { naturalNudgePanelDependencies } from "@/modules/natural-nudges/discord/operations";
import {
  IMPORT_LIMITS,
  MEDIA_LIMITS,
  PERSONA_LIMITS,
  memoryGuard,
  reserveAvatarQuota,
  reserveImportQuota,
  reservePersonaQuota,
} from "@/utils/security/rateLimiter";
import { convertToPNG } from "@/utils/image/imageProcessor";
import {
  embedMetadataInPNG,
  extractMetadataFromPNG,
  extractSillyTavernMetadataFromPNG,
} from "@/utils/image/pngMetadata";
import {
  getCachedPresetAvatar,
  getPresetAvatarBuffer,
  getServerAvatar,
  validatePNGBuffer,
} from "@/utils/image/avatarHelper";
import { getMemoryLimits, validateAttribute, validateSampleDialogue } from "@/utils/misc/memoryLimits";
import { importAlterPreset } from "@/utils/persona/importAlterPreset";
import {
  cleanupMainPersonaSpritesAfterImport,
  snapshotMainPersonaSprites,
} from "@/utils/persona/mainImportSpriteCleanup";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import {
  deletePersonaAvatarFromStorage,
  isSharedPresetAssetReference,
  loadStoredPersonaAvatarBuffer,
  uploadPersonaAvatarToStorage,
} from "@/utils/storage/avatarStorage";
import { sanitizeAttachmentFilenamePart } from "@/utils/discord/attachmentFilename";
import { dedupeTriggerWords } from "@/utils/text/triggerWords";
import { addressingStyleSchema, PERSONA_NAMING_VALUE_MAX_LENGTH } from "@/types/personaNaming";
import { conditioningMemoryRepository } from "@/utils/db/repositories/ConditioningMemoryRepository";
import { computeConditioningRemoveFingerprint } from "@/utils/discord/configPanelCatalog";
import { configPersonaOperations } from "@/utils/discord/interactions/configPersonaOperations";
import { loadConfigPersonaVoiceView } from "@/utils/discord/interactions/configPersonaVoiceLoader";
import { resolveSpeechTargets } from "@/utils/provider/speechEndpointResolver";
import { fetchElevenLabsVoiceCatalog } from "@/utils/audio/elevenLabsVoiceCatalog";
import { loadVoiceSamples } from "@/utils/db/repositories/SpeechRepository";
import { personaRepository } from "@/utils/db/repositories/PersonaRepository";
import { configRepository } from "@/utils/db/repositories/ConfigRepository";
import { personaSpriteRepository } from "@/utils/db/repositories/PersonaSpriteRepository";
import { setGuildBotAvatar, setGuildBotNickname } from "@/utils/discord/guildIdentity";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { replaceStoredCharReference } from "@/utils/storage/charRefOperations";
import { deleteCharRef, loadCharRefAsBase64 } from "@/utils/storage/charrefStorage";
import { log } from "@/utils/misc/logger";
import { getDefaultBotName, localizer } from "@/utils/text/localizer";
import { PRESET_MAX_ATTRIBUTES, presetExportDataSchema, type PresetExportData } from "@/types/preset/presetExport";
import type { TomoriDashboardCore } from "./core";
import { DashboardServiceError } from "./errors";
import type { DashboardGuildSnapshot } from "./types";

const limits = getMemoryLimits();
const MAX_IMPORT_BYTES = IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB * 1024 * 1024;
const MAX_AVATAR_BYTES = PERSONA_LIMITS.MAX_AVATAR_SIZE_MB * 1024 * 1024;
export const PERSONA_REFERENCE_MAX_BYTES = MEDIA_LIMITS.MAX_MEDIA_SIZE_MB * 1024 * 1024;
export const PERSONA_IMPORT_MAX_BYTES = MAX_IMPORT_BYTES;
export const PERSONA_ATTG_MAX_LENGTH = 256;

const attgText = z
  .string()
  .max(PERSONA_ATTG_MAX_LENGTH)
  .trim()
  .transform((value) => value || null);
const attgSchema = z.strictObject({
  nai_attg_author: attgText,
  nai_attg_title: attgText,
  nai_attg_tags: attgText,
  nai_attg_genre: attgText,
  nai_attg_stars: z.number().int().min(1).max(5).nullable(),
});

const voiceSchema = z
  .strictObject({
    priority: z.enum(["design", "clone"]).optional(),
    designPrompt: z.string().max(MAX_VOICE_DESIGN_PROMPT_LENGTH).trim().optional(),
    assignment: z
      .discriminatedUnion("mode", [
        z.strictObject({ mode: z.literal("sample"), id: z.number().int().positive().nullable() }),
        z.strictObject({ mode: z.literal("elevenlabs"), id: z.string().min(1).max(128).nullable() }),
      ])
      .optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0);

const presetResyncSchema = z.strictObject({ revision: z.string().regex(/^[a-f0-9]{64}$/) });

const mainReplacementSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("preset"), presetId: z.string().regex(/^[1-9]\d{0,14}$/) }),
  z.strictObject({ source: z.literal("card"), file: z.instanceof(File), identityMode: z.enum(["preserve", "fork"]) }),
]);

type MainReplacement =
  | {
      source: "preset";
      preset: TomoriPresetRow;
      targetLineageId: number;
      nickname: string;
      defaultName: string;
      triggers: string[];
    }
  | {
      source: "card";
      presetData: PresetExportData;
      avatar: Buffer | null;
      identityMode: "preserve" | "fork";
      nickname: string;
      targetLineageId: number | null;
      cardHash: string;
      official: TomoriPresetRow | null;
    };

const createPersonaSchema = z
  .object({
    nickname: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(limits.maxAttributeLength),
    triggerWords: presetExportDataSchema.shape.trigger_words,
    personaPrompt: z.string().trim().max(8_000).nullable().default(null),
    sampleInput: z.string().trim().max(limits.maxSampleDialogueLength).nullable().default(null),
    sampleOutput: z.string().trim().max(limits.maxSampleDialogueLength).nullable().default(null),
  })
  .strict()
  .refine((value) => Boolean(value.sampleInput) === Boolean(value.sampleOutput), {
    message: "Both sides of the sample dialogue are required.",
  });

const attributesSchema = z
  .object({
    attributes: z
      .array(
        z
          .object({
            text: presetExportDataSchema.shape.attribute_list.element.trim().min(1),
            isPublic: z.boolean().default(false),
          })
          .strict(),
      )
      .max(PRESET_MAX_ATTRIBUTES),
  })
  .strict();

const dialogueSchema = z
  .object({
    input: presetExportDataSchema.shape.sample_dialogues_in.element.trim().min(1),
    output: presetExportDataSchema.shape.sample_dialogues_out.element.trim().min(1),
  })
  .strict();

const namingHabitValue = z.string().trim().max(PERSONA_NAMING_VALUE_MAX_LENGTH);
const namingHabitsSchema = z.strictObject({
  style: addressingStyleSchema,
  prefix: namingHabitValue,
  suffix: namingHabitValue,
  addressTerm: namingHabitValue,
});

function personaSettingsError(code: string, status: DashboardServiceError["status"]) {
  return new DashboardServiceError(code, status, localizer("en-US", `general.dashboard.${code}`));
}

function parseJsonFile(buffer: Buffer): unknown {
  return JSON.parse(
    buffer
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trim(),
  );
}

function validatePresetUpload(file: File) {
  if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) {
    throw new DashboardServiceError("invalid_persona_file", 422, "The persona file is empty or too large.");
  }
  if (!/\.(png|json)$/i.test(file.name)) {
    throw new DashboardServiceError("invalid_persona_file", 422, "Use a Tomori or SillyTavern PNG/JSON file.");
  }
}

function parsePresetImport(file: File, buffer: Buffer): { presetData: PresetExportData; avatar: Buffer | null } {
  const filename = file.name.toLowerCase();
  const isPng = file.type === "image/png" || filename.endsWith(".png");
  const isJson = file.type === "application/json" || filename.endsWith(".json");
  if (!isPng && !isJson) {
    throw new DashboardServiceError("invalid_persona_file", 422, "Use a Tomori or SillyTavern PNG/JSON file.");
  }

  if (isPng) {
    const validation = validatePNGBuffer(buffer, MAX_IMPORT_BYTES);
    if (!validation.isValid) {
      throw new DashboardServiceError("invalid_persona_file", 422, "The uploaded PNG is invalid or too large.");
    }

    const metadata = extractMetadataFromPNG(buffer);
    if (metadata) {
      const result = presetRepository.validatePresetFile(metadata);
      if (result.valid && result.data) return { presetData: result.data, avatar: buffer };
      throw new DashboardServiceError("invalid_persona_file", 422, result.error || "Invalid Tomori persona data.");
    }

    const sillyTavern = extractSillyTavernMetadataFromPNG(buffer);
    if (!sillyTavern) {
      throw new DashboardServiceError("invalid_persona_file", 422, "No persona metadata was found in this PNG.");
    }
    const converted = presetRepository.convertSillyTavernMetadataToPresetData(sillyTavern);
    if (!converted.success) {
      throw new DashboardServiceError("invalid_persona_file", 422, converted.error);
    }
    return { presetData: converted.data, avatar: buffer };
  }

  let parsed: unknown;
  try {
    parsed = parseJsonFile(buffer);
  } catch {
    throw new DashboardServiceError("invalid_persona_file", 422, "The uploaded JSON could not be parsed.");
  }

  const tomori = presetRepository.validatePresetFile(parsed);
  if (tomori.valid && tomori.data) return { presetData: tomori.data, avatar: null };
  if (presetRepository.looksLikeSillyTavernCardJson(parsed)) {
    const converted = presetRepository.convertSillyTavernJsonToPresetData(parsed);
    if (converted.success) return { presetData: converted.data, avatar: null };
    throw new DashboardServiceError("invalid_persona_file", 422, converted.error);
  }
  throw new DashboardServiceError("invalid_persona_file", 422, tomori.error || "Invalid persona data.");
}

function getPersona(snapshot: DashboardGuildSnapshot, personaId: number) {
  const persona = snapshot.rawPersonas.find((entry) => entry.persona_id === personaId);
  if (!persona) throw new DashboardServiceError("persona_not_found", 404, "Persona not found.");
  return persona;
}

export class DashboardPersonaService {
  private readonly mainReplacements = new Set<string>();

  constructor(
    private readonly core: TomoriDashboardCore,
    private readonly client: Client,
  ) {}

  async exportCard(snapshot: DashboardGuildSnapshot, personaId: number, format: "json" | "png") {
    const persona = getPersona(snapshot, personaId);
    const preset = await presetRepository.exportPresetData(snapshot.serverDiscordId, personaId);
    if (!preset.success) {
      throw new DashboardServiceError("persona_export_failed", 500, localizer("en-US", preset.error));
    }

    const name = sanitizeAttachmentFilenamePart(preset.data.data.tomori_nickname, {
      fallback: "persona",
      maxLength: 50,
    });
    const filename = `tomori-preset-${name}-${Date.now()}.${format}`;
    if (format === "json") {
      return {
        filename,
        contentType: "application/json",
        buffer: Buffer.from(`${JSON.stringify(preset.data, null, 2)}\n`, "utf8"),
      };
    }

    let avatar: Buffer | null = null;
    if (persona.is_alter && persona.webhook_avatar_url) {
      const stored = await loadStoredPersonaAvatarBuffer(persona.webhook_avatar_url);
      if (stored) {
        try {
          avatar = await convertToPNG(stored);
        } catch (error) {
          log.warn("Dashboard persona export could not convert the alter avatar.", error);
        }
      }
    }
    try {
      avatar ??= await getServerAvatar(this.client.guilds.cache.get(snapshot.serverDiscordId) ?? null, this.client);
    } catch {
      throw new DashboardServiceError(
        "persona_export_avatar_failed",
        502,
        localizer("en-US", "commands.persona.export.avatar_failed_description"),
      );
    }
    return { filename, contentType: "image/png", buffer: embedMetadataInPNG(avatar, preset.data) };
  }

  async listMainPersonaPresets(locale: string) {
    const presets = await configRepository.loadPresetRowsByLocale(locale, { nsfw: false });
    return (presets ?? []).flatMap((preset) =>
      resolvePresetLineageId(preset)
        ? [{ id: String(preset.persona_preset_id), name: preset.persona_preset_name }]
        : [],
    );
  }

  private async prepareMainReplacement(snapshot: DashboardGuildSnapshot, locale: string, value: unknown) {
    const parsed = mainReplacementSchema.safeParse(value);
    if (!parsed.success) throw personaSettingsError("persona_main_selection_invalid", 422);
    const [persona, secondMain] = snapshot.rawPersonas.filter((entry) => !entry.is_alter);
    const personaId = persona?.persona_id;
    const currentLineageId = persona?.persona_lineage_id;
    if (!persona || !personaId || !currentLineageId || secondMain) {
      throw personaSettingsError("persona_main_missing", 409);
    }
    const otherPersonas = snapshot.rawPersonas.filter((entry) => entry.persona_id !== personaId);
    const selection = parsed.data;
    let change: MainReplacement;
    if (selection.source === "preset") {
      const presets = await configRepository.loadPresetRowsByLocale(locale, { nsfw: false });
      const preset = presets?.find((entry) => String(entry.persona_preset_id) === selection.presetId);
      const targetLineageId = preset && resolvePresetLineageId(preset);
      if (!preset || !targetLineageId) throw personaSettingsError("persona_main_preset_unavailable", 422);
      const triggers = resolvePresetTriggerWords(preset, locale);
      const defaultName = getDefaultBotName(locale);
      const nickname = resolveAvailablePersonaName(
        defaultName,
        triggers,
        otherPersonas.map((entry) => entry.persona_nickname),
      );
      if (!nickname) throw personaSettingsError("persona_main_name_taken", 409);
      change = { source: "preset", preset, targetLineageId, nickname, defaultName, triggers };
    } else {
      validatePresetUpload(selection.file);
      this.assertMemoryAvailable();
      const file = Buffer.from(await selection.file.arrayBuffer());
      const { presetData, avatar } = parsePresetImport(selection.file, file);
      const official = await presetRepository.findMatchingOfficialPresetForImport(presetData);
      if (presetData.is_nsfw || official?.is_nsfw) throw personaSettingsError("persona_main_nsfw", 422);
      const officialLineageId = official && resolvePresetLineageId(official);
      if (official && !officialLineageId) throw personaSettingsError("persona_main_preset_unavailable", 422);
      const nickname = presetData.tomori_nickname;
      if (
        otherPersonas.some((entry) => entry.persona_nickname.trim().toLowerCase() === nickname.trim().toLowerCase())
      ) {
        throw personaSettingsError("persona_main_name_taken", 409);
      }
      const targetLineageId =
        selection.identityMode === "fork"
          ? null
          : (presetData.persona_lineage_id ?? officialLineageId ?? currentLineageId);
      if (targetLineageId === 0) throw personaSettingsError("persona_main_lineage_invalid", 422);
      change = {
        source: "card",
        presetData,
        avatar,
        identityMode: selection.identityMode,
        nickname,
        targetLineageId,
        cardHash: createHash("sha256").update(file).digest("hex"),
        official,
      };
    }
    const targetLore =
      change.targetLineageId === null
        ? null
        : await lorebookRepository.listScope(snapshot.serverId, change.targetLineageId);
    if (targetLore?.status === "unavailable") throw personaSettingsError("persona_main_lore_unavailable", 503);
    const shared = otherPersonas.filter((entry) => entry.persona_lineage_id === change.targetLineageId);
    const impact = {
      currentName: persona.persona_nickname,
      nextName: change.nickname,
      sourceName: change.source === "preset" ? change.preset.persona_preset_name : change.nickname,
      currentLineageId,
      targetLineageId: change.targetLineageId,
      existingLoreCount: targetLore?.entries.length ?? 0,
      incomingLoreCount: change.source === "card" ? (change.presetData.lorebook_entries?.length ?? null) : null,
      sharedPersonas: shared.map((entry) => entry.persona_nickname),
    };
    const revision = createHash("sha256")
      .update(
        JSON.stringify(
          [
            snapshot.serverDiscordId,
            locale,
            personaId,
            impact,
            persona.is_pointer,
            persona.preset_lineage_id,
            persona.preset_language,
            persona.persona_prompt,
            persona.trigger_words,
            persona.persona_attributes,
            persona.attribute_list,
            persona.sample_dialogues_in,
            persona.sample_dialogues_out,
            persona.webhook_avatar_url,
            persona.char_ref_url,
            change.source === "preset" ? change.preset : [change.cardHash, change.identityMode, change.official],
            targetLore?.entries,
            shared.map((entry) => entry.persona_id),
          ],
          (_key, value) => (typeof value === "bigint" ? String(value) : value),
        ),
      )
      .digest("hex");
    return { change, persona, personaId, review: { ...impact, revision } };
  }

  async previewMainReplacement(snapshot: DashboardGuildSnapshot, locale: string, value: unknown) {
    return (await this.prepareMainReplacement(snapshot, locale, value)).review;
  }

  async replaceMainPersona(
    serverDiscId: string,
    isDirectMessage: boolean,
    actorDiscordId: string,
    locale: string,
    value: unknown,
    revision: unknown,
  ) {
    if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision) || this.mainReplacements.has(serverDiscId)) {
      throw personaSettingsError("persona_main_review_changed", 409);
    }
    this.mainReplacements.add(serverDiscId);
    try {
      const snapshot = await this.core.loadGuildSnapshot(serverDiscId);
      if (!snapshot) throw personaSettingsError("persona_main_missing", 409);
      const { change, persona, personaId, review } = await this.prepareMainReplacement(snapshot, locale, value);
      if (revision !== review.revision) throw personaSettingsError("persona_main_review_changed", 409);
      const spritesBeforeImport = await snapshotMainPersonaSprites(personaId);
      let importedAsPointer = true;
      let avatar: Buffer | null = null;
      if (change.source === "preset") {
        const applied = await personaRepository.applyPresetPointerToPersona({
          personaId,
          nickname: change.nickname,
          preset: change.preset,
          personaLineageId: change.targetLineageId,
          triggerWords: change.triggers,
          personaPrompt: change.preset.persona_preset_desc || null,
        });
        if (!applied) throw personaSettingsError("persona_main_apply_failed", 500);
      } else {
        this.assertQuota(reserveImportQuota(actorDiscordId));
        if (change.avatar) {
          avatar = await convertToPNG(change.avatar).catch(() => null);
          if (!avatar) throw personaSettingsError("persona_main_avatar_invalid", 422);
        }
        const imported = await presetRepository.importPresetData(serverDiscId, change.presetData, change.identityMode);
        if (!imported.success) throw personaSettingsError("persona_main_apply_failed", 500);
        importedAsPointer = imported.mainPersonaIsPointer === true;
      }
      invalidateTomoriStateCache(serverDiscId);

      const finish = async (step: string, action: () => Promise<boolean>) => {
        try {
          return await action();
        } catch (error) {
          log.warn(`Dashboard main persona changed, but ${step} failed.`, error);
          return false;
        }
      };
      const spritesCleaned = await finish(
        "sprite cleanup",
        async () =>
          (await cleanupMainPersonaSpritesAfterImport({
            personaId,
            serverDiscId,
            importedAsPointer,
            spritesBeforeImport,
          })) === 0,
      );
      const oldAvatar = persona.webhook_avatar_url;
      let mediaSaved = true;
      if (change.source === "preset") {
        const oldAvatarDeleted = await finish("avatar cleanup", async () =>
          oldAvatar && !isSharedPresetAssetReference(oldAvatar)
            ? await deletePersonaAvatarFromStorage(oldAvatar)
            : true,
        );
        const referenceDeleted = await finish("character reference cleanup", async () =>
          persona.char_ref_url && !isSharedPresetAssetReference(persona.char_ref_url)
            ? await deleteCharRef(persona.char_ref_url, "personas", personaId)
            : true,
        );
        mediaSaved = oldAvatarDeleted && referenceDeleted;
      } else if (avatar) {
        const avatarBuffer = avatar;
        mediaSaved = await finish("avatar storage", async () => {
          const url = await uploadPersonaAvatarToStorage({
            personaId,
            serverDiscId,
            label: "main import",
            buffer: avatarBuffer,
          });
          if (!url) return false;
          if (!(await personaRepository.setAvatar(personaId, url))) {
            await deletePersonaAvatarFromStorage(url);
            return false;
          }
          invalidateTomoriStateCache(serverDiscId);
          return oldAvatar && oldAvatar !== url && !isSharedPresetAssetReference(oldAvatar)
            ? await deletePersonaAvatarFromStorage(oldAvatar)
            : true;
        });
      }
      let discordSynced = true;
      if (!isDirectMessage) {
        const nickname = change.source === "preset" && change.nickname === change.defaultName ? null : change.nickname;
        const nicknameSynced = await finish("Discord nickname sync", async () => {
          if (nickname !== null) return (await setGuildBotNickname(serverDiscId, nickname)).success;
          const guild = this.client.guilds.cache.get(serverDiscId);
          const member = guild?.members.me ?? (await guild?.members.fetchMe());
          if (!member) return false;
          await member.setNickname(null);
          return true;
        });
        const avatarSynced = await finish("Discord avatar sync", async () => {
          if (change.source === "card" && !avatar) return true;
          const uri = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;
          const cached = change.source === "preset" ? getCachedPresetAvatar(change.preset.persona_preset_id) : null;
          const bytes = change.source === "preset" && !cached ? await getPresetAvatarBuffer(change.preset) : avatar;
          const result = await setGuildBotAvatar(serverDiscId, cached ?? (bytes ? uri(bytes) : null));
          if (result.success && change.source === "preset")
            await personaRepository.markServerMainAvatarSynced(serverDiscId);
          return result.success;
        });
        discordSynced = nicknameSynced && avatarSynced;
      }
      return { personaId, synchronized: spritesCleaned && mediaSaved && discordSynced };
    } finally {
      this.mainReplacements.delete(serverDiscId);
    }
  }

  async loadCharacterReference(snapshot: DashboardGuildSnapshot, personaId: number) {
    const persona = getPersona(snapshot, personaId);
    if (!persona.char_ref_url) return null;
    const encoded = await loadCharRefAsBase64(persona.char_ref_url, "personas", personaId);
    return encoded ? Buffer.from(encoded, "base64") : null;
  }

  async updateCharacterReference(snapshot: DashboardGuildSnapshot, personaId: number, file: File | null) {
    const persona = getPersona(snapshot, personaId);
    if (file === null) {
      const result = await configPersonaOperations.replaceCharacterReference({
        persona,
        serverDiscId: snapshot.serverDiscordId,
        attachment: null,
      });
      if (result.status !== "success") throw personaSettingsError("persona_reference_failed", 500);
      return { hasCharacterReference: false };
    }
    if (!file.type.startsWith("image/") || !file.size || file.size > PERSONA_REFERENCE_MAX_BYTES)
      throw personaSettingsError("persona_reference_invalid", 422);
    this.assertMemoryAvailable();
    this.assertQuota(reserveAvatarQuota(snapshot.serverDiscordId));
    let nextBuffer: Buffer;
    try {
      nextBuffer = await convertToPNG(Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      log.warn("Dashboard persona reference conversion failed", error);
      throw personaSettingsError("persona_reference_invalid", 422);
    }
    const saved = await replaceStoredCharReference({
      entityType: "personas",
      entityId: personaId,
      previousRef: persona.char_ref_url ?? null,
      nextBuffer,
      persistNextRef: (nextRef) => personaRepository.setCharRef(personaId, nextRef),
      onPersistSuccess: () => invalidateTomoriStateCache(snapshot.serverDiscordId),
    });
    if (!saved) throw personaSettingsError("persona_reference_failed", 500);
    return { hasCharacterReference: true };
  }

  async updateAttg(snapshot: DashboardGuildSnapshot, personaId: number, value: unknown) {
    getPersona(snapshot, personaId);
    const parsed = attgSchema.safeParse(value);
    if (!parsed.success) throw personaSettingsError("persona_attg_invalid", 422);
    if (!(await personaRepository.setNaiAttg(personaId, parsed.data)))
      throw personaSettingsError("persona_attg_failed", 500);
    invalidateTomoriStateCache(snapshot.serverDiscordId);
    return { values: parsed.data };
  }

  private async loadElevenLabsVoiceKey(serverId: number) {
    const { clone } = await resolveSpeechTargets(serverId);
    return clone?.kind === "custom-endpoint" && clone.endpoint.api_style === "elevenlabs" ? clone.apiKey : null;
  }

  async loadVoiceSettings(snapshot: DashboardGuildSnapshot, personaId: number) {
    const persona = getPersona(snapshot, personaId);
    const view = await loadConfigPersonaVoiceView(persona);
    const mode = view.capability.apiStyle === "elevenlabs" ? "elevenlabs" : "sample";
    let options = view.samples.map((sample) => ({ id: String(sample.sample_id), label: sample.name }));
    let catalogUnavailable = false;
    if (mode === "elevenlabs") {
      const key = await this.loadElevenLabsVoiceKey(snapshot.serverId);
      const catalog = key ? await fetchElevenLabsVoiceCatalog(key) : null;
      catalogUnavailable = !catalog?.success;
      options = (catalog?.voices ?? []).map((voice) => ({ id: voice.voiceId, label: voice.name }));
      options.sort((left, right) => left.label.localeCompare(right.label));
    }
    return {
      priority: persona.voice_source_priority,
      designPrompt: persona.speech_voice_design_prompt ?? "",
      maxLength: MAX_VOICE_DESIGN_PROMPT_LENGTH,
      mode,
      selectedId: (mode === "elevenlabs" ? persona.speech_voice_id : persona.speech_voice_sample_id)?.toString() ?? "",
      options,
      catalogUnavailable,
      effectiveSource: view.effectiveSource,
      effectiveTarget: view.effectiveTarget,
    };
  }

  async updateVoiceSettings(snapshot: DashboardGuildSnapshot, personaId: number, value: unknown) {
    const persona = getPersona(snapshot, personaId);
    const parsed = voiceSchema.safeParse(value);
    if (!parsed.success) throw personaSettingsError("persona_voice_invalid", 422);
    const { priority, designPrompt, assignment } = parsed.data;
    const voice = {
      speech_voice_sample_id: persona.speech_voice_sample_id ?? null,
      speech_voice_id: persona.speech_voice_id ?? null,
      speech_voice_name: persona.speech_voice_name ?? null,
      speech_voice_design_prompt:
        designPrompt === undefined ? (persona.speech_voice_design_prompt ?? null) : designPrompt || null,
      voice_source_priority: priority ?? persona.voice_source_priority,
    };
    if (assignment) {
      const key = await this.loadElevenLabsVoiceKey(snapshot.serverId);
      if ((key ? "elevenlabs" : "sample") !== assignment.mode) throw personaSettingsError("persona_voice_changed", 409);
      if (assignment.mode === "elevenlabs") {
        if (assignment.id !== null && assignment.id !== voice.speech_voice_id) {
          const catalog = await fetchElevenLabsVoiceCatalog(key ?? "");
          if (!catalog.success) throw personaSettingsError("persona_voice_catalog_unavailable", 502);
          const chosen = catalog.voices?.find((entry) => entry.voiceId === assignment.id);
          if (!chosen || (await this.loadElevenLabsVoiceKey(snapshot.serverId)) !== key)
            throw personaSettingsError("persona_voice_changed", 409);
          voice.speech_voice_id = chosen.voiceId;
          voice.speech_voice_name = chosen.name;
        } else if (assignment.id === null) {
          voice.speech_voice_id = null;
          voice.speech_voice_name = null;
        }
      } else if (assignment.id !== null && assignment.id !== voice.speech_voice_sample_id) {
        const chosen = (await loadVoiceSamples(snapshot.serverId)).find((entry) => entry.sample_id === assignment.id);
        if (!chosen || (await this.loadElevenLabsVoiceKey(snapshot.serverId)))
          throw personaSettingsError("persona_voice_changed", 409);
        voice.speech_voice_sample_id = assignment.id;
        voice.speech_voice_name = chosen.name;
      } else if (assignment.id === null) {
        voice.speech_voice_sample_id = null;
        voice.speech_voice_name = null;
      }
    }
    if (!(await personaRepository.setVoiceConfig(personaId, voice)))
      throw personaSettingsError("persona_voice_failed", 500);
    invalidateTomoriStateCache(snapshot.serverDiscordId);
  }

  private async loadPresetIdentityState(snapshot: DashboardGuildSnapshot, personaId: number) {
    const persona = getPersona(snapshot, personaId);
    if (!persona.preset_lineage_id || !persona.preset_language) return { persona, preset: null, revision: null };
    const preset = await configRepository.loadPresetByReference(persona.preset_lineage_id, persona.preset_language);
    if (!preset) return { persona, preset, revision: null };
    const nudges = await naturalNudgePanelDependencies.loadPersonaConfig(personaId);
    const sprites = persona.is_pointer ? [] : await personaSpriteRepository.listForPersona(personaId);
    const revision =
      persona.is_pointer && !nudges?.has_override
        ? null
        : createHash("sha256")
            .update(
              JSON.stringify([
                personaId,
                persona.is_pointer,
                persona.preset_lineage_id,
                persona.preset_language,
                persona.persona_prompt,
                persona.persona_attributes,
                persona.attribute_list,
                persona.sample_dialogues_in,
                persona.sample_dialogues_out,
                persona.webhook_avatar_url,
                persona.char_ref_url,
                sprites,
                nudges,
                preset,
              ]),
            )
            .digest("hex");
    return { persona, preset, revision };
  }

  async loadPresetIdentity(snapshot: DashboardGuildSnapshot, personaId: number) {
    const { persona, preset, revision } = await this.loadPresetIdentityState(snapshot, personaId);
    return {
      name: preset?.persona_preset_name ?? null,
      linked: Boolean(persona.is_pointer),
      hasPreset: !!persona.preset_lineage_id,
      revision,
    };
  }

  async resyncPresetIdentity(snapshot: DashboardGuildSnapshot, personaId: number, value: unknown) {
    const parsed = presetResyncSchema.safeParse(value);
    if (!parsed.success) throw personaSettingsError("persona_preset_changed", 409);
    const { persona, preset, revision } = await this.loadPresetIdentityState(snapshot, personaId);
    if (!preset || !revision || parsed.data.revision !== revision)
      throw personaSettingsError("persona_preset_changed", 409);
    if (persona.is_pointer) {
      const status = await naturalNudgePanelDependencies.operations.clearPersonaOverride(personaId);
      if (status === "stale") throw personaSettingsError("persona_preset_changed", 409);
      if (status !== "success") throw personaSettingsError("persona_preset_failed", 500);
      return { avatarSynced: true };
    }
    const guildId = snapshot.serverDiscordId;
    const result = await configPersonaOperations.resyncToPreset({
      persona,
      preset,
      serverDiscId: guildId,
      guildIdentity: {
        setNickname: async (nickname) => (await setGuildBotNickname(guildId, nickname)).success,
        setAvatar: async (uri) => {
          const result = await setGuildBotAvatar(guildId, uri);
          return { ok: result.success, rateLimited: result.error === "rate_limited" };
        },
        currentAvatarReference: async () =>
          this.client.guilds.cache.get(guildId)?.members.me?.displayAvatarURL() ?? null,
      },
    });
    if (result.status === "stale") throw personaSettingsError("persona_preset_changed", 409);
    if (result.status !== "success") throw personaSettingsError("persona_preset_failed", 500);
    return { avatarSynced: result.avatarSynced };
  }

  async updateNamingHabits(snapshot: DashboardGuildSnapshot, personaId: number, value: unknown) {
    const persona = getPersona(snapshot, personaId);
    const parsed = namingHabitsSchema.safeParse(value);
    if (!parsed.success) throw personaSettingsError("persona_habits_invalid", 422);
    const result = await configPersonaOperations.setNamingHabits({
      persona,
      serverDiscId: snapshot.serverDiscordId,
      ...parsed.data,
    });
    if (result.status === "invalid-config") throw personaSettingsError("persona_habits_invalid", 422);
    if (result.status !== "success") throw personaSettingsError("persona_habits_failed", 500);
    return parsed.data;
  }

  private async loadConditioningGroups(snapshot: DashboardGuildSnapshot, personaId: number) {
    const lineageId = getPersona(snapshot, personaId).persona_lineage_id;
    if (!lineageId) throw personaSettingsError("naming_persona_missing", 404);
    const groups = await conditioningMemoryRepository.loadGroupsForPersona(snapshot.serverId, lineageId);
    return { lineageId, groups: groups.filter(({ reasonText }) => reasonText.trim().length > 0) };
  }

  async listConditioning(snapshot: DashboardGuildSnapshot, personaId: number) {
    const { groups } = await this.loadConditioningGroups(snapshot, personaId);
    return groups.map((group) => ({
      id: computeConditioningRemoveFingerprint(personaId, [group]),
      type: group.conditioningType,
      action: group.actionKey,
      reason: group.reasonText,
      count: group.totalCount,
    }));
  }

  async removeConditioning(snapshot: DashboardGuildSnapshot, personaId: number, id: string) {
    const { lineageId, groups } = await this.loadConditioningGroups(snapshot, personaId);
    const group = groups.find((entry) => computeConditioningRemoveFingerprint(personaId, [entry]) === id);
    if (!group) throw personaSettingsError("persona_conditioning_changed", 409);
    const { conditioningType, actionKey, reasonNormalized } = group;
    const result = await configPersonaOperations.removeConditioning({
      serverId: snapshot.serverId,
      personaLineageId: lineageId,
      groups: [{ conditioningType, actionKey, reasonNormalized }],
    });
    if (result.status !== "success") throw personaSettingsError("persona_conditioning_failed", 409);
  }

  async create(snapshot: DashboardGuildSnapshot, guild: Guild, actorDiscordId: string, value: unknown) {
    this.assertMemoryAvailable();
    this.assertQuota(reservePersonaQuota(actorDiscordId));
    const parsed = createPersonaSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_persona", 422, parsed.error.issues[0]?.message || "Invalid persona.");
    }
    if (!validateAttribute(parsed.data.description).isValid) {
      throw new DashboardServiceError("invalid_persona", 422, "The persona description is invalid.");
    }
    if (parsed.data.sampleInput && !validateSampleDialogue(parsed.data.sampleInput).isValid) {
      throw new DashboardServiceError("invalid_persona", 422, "The sample user message is invalid.");
    }
    if (parsed.data.sampleOutput && !validateSampleDialogue(parsed.data.sampleOutput).isValid) {
      throw new DashboardServiceError("invalid_persona", 422, "The sample persona reply is invalid.");
    }

    const triggerWords = dedupeTriggerWords([parsed.data.nickname, ...parsed.data.triggerWords], { lowercase: false });
    const presetData: PresetExportData = {
      tomori_nickname: parsed.data.nickname,
      attribute_list: [parsed.data.description],
      attribute_public_flags: [false],
      sample_dialogues_in: parsed.data.sampleInput ? [parsed.data.sampleInput] : [],
      sample_dialogues_out: parsed.data.sampleOutput ? [parsed.data.sampleOutput] : [],
      trigger_words: triggerWords,
      persona_prompt: parsed.data.personaPrompt,
    };
    return this.importPreset(snapshot, guild, presetData, null, "fork");
  }

  async import(
    snapshot: DashboardGuildSnapshot,
    guild: Guild,
    actorDiscordId: string,
    file: File,
    identityMode: "preserve" | "fork",
  ) {
    validatePresetUpload(file);
    this.assertMemoryAvailable();
    this.assertQuota(reserveImportQuota(actorDiscordId));
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parsePresetImport(file, buffer);
    return this.importPreset(snapshot, guild, parsed.presetData, parsed.avatar, identityMode);
  }

  async replaceAttributes(snapshot: DashboardGuildSnapshot, personaId: number, value: unknown): Promise<void> {
    const parsed = attributesSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_attributes", 422, "One or more persona attributes are invalid.");
    }
    const texts = parsed.data.attributes.map((attribute) => attribute.text);
    if (
      !(await this.core.updatePersonaAttributes(
        snapshot,
        personaId,
        texts,
        parsed.data.attributes.map((attribute) => attribute.isPublic),
      ))
    ) {
      throw new DashboardServiceError("persona_update_failed", 500, "Persona attributes could not be saved.");
    }
  }

  async addDialogue(snapshot: DashboardGuildSnapshot, personaId: number, value: unknown): Promise<void> {
    const parsed = this.parseDialogue(value);
    const persona = getPersona(snapshot, personaId);
    if (
      !presetExportDataSchema.shape.sample_dialogues_in.safeParse([
        ...(persona.sample_dialogues_in ?? []),
        parsed.input,
      ]).success ||
      !presetExportDataSchema.shape.sample_dialogues_out.safeParse([
        ...(persona.sample_dialogues_out ?? []),
        parsed.output,
      ]).success
    ) {
      throw new DashboardServiceError("dialogue_limit", 422, "This persona has reached the sample-dialogue limit.");
    }
    if (!(await this.core.addPersonaSampleDialogue(snapshot, personaId, parsed.input, parsed.output))) {
      throw new DashboardServiceError("persona_update_failed", 500, "Sample dialogue could not be added.");
    }
  }

  async updateDialogue(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    index: number,
    value: unknown,
  ): Promise<void> {
    const parsed = this.parseDialogue(value);
    const persona = getPersona(snapshot, personaId);
    if (index < 0 || index >= (persona.sample_dialogues_in?.length ?? 0)) {
      throw new DashboardServiceError("dialogue_not_found", 404, "Sample dialogue not found.");
    }
    if (!(await this.core.updatePersonaSampleDialogue(snapshot, personaId, index, parsed.input, parsed.output))) {
      throw new DashboardServiceError("persona_update_failed", 500, "Sample dialogue could not be saved.");
    }
  }

  async removeDialogue(snapshot: DashboardGuildSnapshot, personaId: number, index: number): Promise<void> {
    const persona = getPersona(snapshot, personaId);
    if (index < 0 || index >= (persona.sample_dialogues_in?.length ?? 0)) {
      throw new DashboardServiceError("dialogue_not_found", 404, "Sample dialogue not found.");
    }
    if (!(await this.core.removePersonaSampleDialogue(snapshot, personaId, index))) {
      throw new DashboardServiceError("persona_update_failed", 500, "Sample dialogue could not be removed.");
    }
  }

  async setAvatar(snapshot: DashboardGuildSnapshot, guild: Guild, personaId: number, file: File): Promise<void> {
    const persona = getPersona(snapshot, personaId);
    if (file.size <= 0 || file.size > MAX_AVATAR_BYTES || !file.type.startsWith("image/")) {
      throw new DashboardServiceError("invalid_avatar", 422, "Use a PNG, JPEG, or GIF within the avatar size limit.");
    }
    const extension = file.name.toLowerCase().split(".").pop();
    if (!extension || !["png", "jpg", "jpeg", "gif"].includes(extension)) {
      throw new DashboardServiceError("invalid_avatar", 422, "Use a PNG, JPEG, or GIF image.");
    }
    this.assertMemoryAvailable();
    this.assertQuota(reserveAvatarQuota(guild.id));
    const png = await convertToPNG(Buffer.from(await file.arrayBuffer())).catch(() => null);
    if (!png) throw new DashboardServiceError("invalid_avatar", 422, "The avatar image could not be decoded.");
    if (!(await this.core.materializePersona(snapshot, personaId))) {
      throw new DashboardServiceError("persona_update_failed", 500, "Persona could not be prepared for editing.");
    }

    if (!persona.is_alter) {
      await this.updateMainAvatar(guild.id, png);
      if (persona.webhook_avatar_url) await deletePersonaAvatarFromStorage(persona.webhook_avatar_url);
      await this.core.setPersonaAvatarReference(snapshot, personaId, null);
      return;
    }

    const storedUrl = await uploadPersonaAvatarToStorage({
      personaId,
      serverDiscId: snapshot.serverDiscordId,
      label: "dashboard avatar",
      buffer: png,
    });
    if (!storedUrl) throw new DashboardServiceError("avatar_storage_failed", 500, "Avatar storage failed.");
    if (!(await this.core.setPersonaAvatarReference(snapshot, personaId, storedUrl))) {
      await deletePersonaAvatarFromStorage(storedUrl);
      throw new DashboardServiceError("persona_update_failed", 500, "Avatar reference could not be saved.");
    }
    if (persona.webhook_avatar_url && persona.webhook_avatar_url !== storedUrl) {
      await deletePersonaAvatarFromStorage(persona.webhook_avatar_url);
    }
  }

  async removeAvatar(snapshot: DashboardGuildSnapshot, guild: Guild, personaId: number): Promise<void> {
    const persona = getPersona(snapshot, personaId);
    this.assertMemoryAvailable();
    this.assertQuota(reserveAvatarQuota(guild.id));
    if (!persona.is_alter) await this.updateMainAvatar(guild.id, null);
    if (persona.webhook_avatar_url) await deletePersonaAvatarFromStorage(persona.webhook_avatar_url);
    if (!(await this.core.setPersonaAvatarReference(snapshot, personaId, null))) {
      throw new DashboardServiceError("persona_update_failed", 500, "Avatar could not be removed.");
    }
  }

  async remove(snapshot: DashboardGuildSnapshot, personaId: number): Promise<void> {
    const persona = getPersona(snapshot, personaId);
    if (!persona.is_alter) {
      throw new DashboardServiceError("main_persona_required", 422, "The main persona cannot be deleted.");
    }
    if (!(await this.core.removePersona(snapshot, personaId))) {
      throw new DashboardServiceError("persona_delete_failed", 500, "Persona could not be deleted.");
    }
    if (persona.webhook_avatar_url) await deletePersonaAvatarFromStorage(persona.webhook_avatar_url);
  }

  private parseDialogue(value: unknown): { input: string; output: string } {
    const parsed = dialogueSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_dialogue", 422, "Both sample-dialogue messages are required.");
    }
    return parsed.data;
  }

  private assertMemoryAvailable(): void {
    if (memoryGuard.checkMemory().status === "critical") {
      throw new DashboardServiceError(
        "memory_pressure",
        503,
        "The bot is under heavy memory pressure. Try this operation again later.",
      );
    }
  }

  private assertQuota(result: { allowed: boolean; resetAt?: number }): void {
    if (!result.allowed) {
      const retry = result.resetAt ? ` Try again after ${new Date(result.resetAt).toISOString()}.` : "";
      throw new DashboardServiceError("persona_rate_limited", 429, `The persona operation limit was reached.${retry}`);
    }
  }

  private async importPreset(
    snapshot: DashboardGuildSnapshot,
    guild: Guild,
    presetData: PresetExportData,
    avatarImageBuffer: Buffer | null,
    identityMode: "preserve" | "fork",
  ) {
    const validation = presetRepository.validatePresetData(presetData);
    if (!validation.valid || !validation.data) {
      throw new DashboardServiceError("invalid_persona", 422, validation.error || "Invalid persona data.");
    }
    const result = await importAlterPreset({
      client: this.client,
      guild,
      serverDiscId: snapshot.serverDiscordId,
      presetData: validation.data,
      identityMode,
      avatarImageBuffer,
    });
    if (!result.ok) {
      const messages = {
        limit_reached: "This server has reached its persona limit.",
        no_main_persona: "A main persona is required before creating an alter.",
        name_conflict: "A persona with that name already exists.",
        config_failed: "The persona configuration could not be created.",
        insert_failed: "The persona could not be created.",
      } as const;
      throw new DashboardServiceError("persona_import_failed", 422, messages[result.reason]);
    }
    return { personaId: result.personaId, nickname: result.nickname };
  }

  private async updateMainAvatar(guildId: string, avatar: Buffer | null): Promise<void> {
    const token = this.client.token ?? process.env.DISCORD_TOKEN;
    if (!token) throw new DashboardServiceError("discord_unavailable", 503, "Discord credentials are unavailable.");
    const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/@me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ avatar: avatar ? `data:image/png;base64,${avatar.toString("base64")}` : null }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    if (!response?.ok) {
      throw new DashboardServiceError("discord_avatar_failed", 502, "Discord rejected the main persona avatar.");
    }
  }
}
