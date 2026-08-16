import type { Client, Guild } from "discord.js";
import { z } from "zod";
import {
  IMPORT_LIMITS,
  PERSONA_LIMITS,
  memoryGuard,
  reserveAvatarQuota,
  reserveImportQuota,
  reservePersonaQuota,
} from "@/utils/security/rateLimiter";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { extractMetadataFromPNG, extractSillyTavernMetadataFromPNG } from "@/utils/image/pngMetadata";
import { validatePNGBuffer } from "@/utils/image/avatarHelper";
import { getMemoryLimits, validateAttribute, validateSampleDialogue } from "@/utils/misc/memoryLimits";
import { importAlterPreset } from "@/utils/persona/importAlterPreset";
import { presetRepository } from "@/utils/db/repositories/PresetRepository";
import { deletePersonaAvatarFromStorage, uploadPersonaAvatarToStorage } from "@/utils/storage/avatarStorage";
import { dedupeTriggerWords } from "@/utils/text/triggerWords";
import type { PresetExportData } from "@/types/preset/presetExport";
import type { TomoriDashboardCore } from "./core";
import { DashboardServiceError } from "./errors";
import type { DashboardGuildSnapshot } from "./types";

const limits = getMemoryLimits();
const MAX_IMPORT_BYTES = IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB * 1024 * 1024;
const MAX_AVATAR_BYTES = PERSONA_LIMITS.MAX_AVATAR_SIZE_MB * 1024 * 1024;

const createPersonaSchema = z
  .object({
    nickname: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(limits.maxAttributeLength),
    triggerWords: z.array(z.string().trim().min(1).max(100)).max(limits.maxTriggerWords),
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
            text: z.string().trim().min(1).max(limits.maxAttributeLength),
            isPublic: z.boolean().default(false),
          })
          .strict(),
      )
      .max(limits.maxAttributes),
  })
  .strict();

const dialogueSchema = z
  .object({
    input: z.string().trim().min(1).max(limits.maxSampleDialogueLength),
    output: z.string().trim().min(1).max(limits.maxSampleDialogueLength),
  })
  .strict();

function parseJsonFile(buffer: Buffer): unknown {
  return JSON.parse(
    buffer
      .toString("utf8")
      .replace(/^\uFEFF/, "")
      .trim(),
  );
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
  constructor(
    private readonly core: TomoriDashboardCore,
    private readonly client: Client,
  ) {}

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
    if (file.size <= 0 || file.size > MAX_IMPORT_BYTES) {
      throw new DashboardServiceError("invalid_persona_file", 422, "The persona file is empty or too large.");
    }
    const filename = file.name.toLowerCase();
    if (!filename.endsWith(".png") && !filename.endsWith(".json")) {
      throw new DashboardServiceError("invalid_persona_file", 422, "Use a Tomori or SillyTavern PNG/JSON file.");
    }
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
    if (texts.some((attribute) => !validateAttribute(attribute).isValid)) {
      throw new DashboardServiceError("invalid_attributes", 422, "One or more persona attributes are invalid.");
    }
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
    if ((persona.sample_dialogues_in?.length ?? 0) >= limits.maxSampleDialogues) {
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
    if (
      !parsed.success ||
      !validateSampleDialogue(parsed.data.input).isValid ||
      !validateSampleDialogue(parsed.data.output).isValid
    ) {
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
