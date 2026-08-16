import type { UserRow } from "@/types/db/schema";
import { z } from "zod";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { normalizeTriggerWord } from "@/utils/text/triggerWords";
import type {
  PersonaAppearancePatch,
  PersonaContextPatch,
  PersonaIdentityPatch,
  PersonaPromptPatch,
  TomoriDashboardCore,
} from "./core";
import { DashboardServiceError } from "./errors";
import { type SettingsSectionId, parseSettingsPatch } from "./settingsCatalog";
import type { DashboardGuildSnapshot, RegisteredDashboardUser } from "./types";

const profileSchema = z
  .object({
    user_nickname: z.string().trim().min(1).max(80).optional(),
    privacy_level: z.number().int().min(0).max(2).optional(),
    personal_dtm: z.enum(["off", "follow", "on"]).optional(),
    personal_deliberate_tool_mode: z.enum(["off", "follow", "on"]).optional(),
    timezone_offset: z.number().int().min(-12).max(14).nullable().optional(),
    shortterm_cache_crossserver_opt_in: z.boolean().optional(),
    impersonation_prompt: z
      .preprocess(
        (value) => (typeof value === "string" && value.trim().length === 0 ? null : value),
        z.string().trim().max(4_000).nullable(),
      )
      .optional(),
    physical_appearance_tags: z.array(z.string().trim().min(1).max(120)).max(80).optional(),
  })
  .strict();

const personaLimits = getMemoryLimits();
const personaIdentitySchema = z.object({ nickname: z.string().trim().min(2).max(32) }).strict();
const personaPromptSchema = z
  .object({
    triggerWords: z
      .array(z.string().trim().min(2).max(personaLimits.maxMemoryLength))
      .max(personaLimits.maxTriggerWords),
    personaPrompt: z
      .preprocess(
        (value) => (typeof value === "string" && value.trim().length === 0 ? null : value),
        z.string().trim().max(16_000).nullable(),
      )
      .default(null),
  })
  .strict();
const personaContextSchema = z
  .object({
    contextNote: z
      .preprocess(
        (value) => (typeof value === "string" && value.trim().length === 0 ? null : value),
        z.string().trim().max(4_000).nullable(),
      )
      .default(null),
    contextNoteDepth: z.number().int().min(0).max(100),
  })
  .strict();
const personaAppearanceSchema = z
  .object({ physicalAppearanceTags: z.array(z.string().trim().min(1).max(120)).max(80) })
  .strict();

export type DashboardSettingsCore = Pick<
  TomoriDashboardCore,
  | "updateUser"
  | "updateSettings"
  | "updatePersonaIdentity"
  | "hasPersonaNicknameConflict"
  | "updatePersonaPrompt"
  | "updatePersonaContext"
  | "updatePersonaAppearance"
>;

export class DashboardSettingsService {
  constructor(private readonly core: DashboardSettingsCore) {}

  async updateProfile(userId: number, userDiscordId: string, value: unknown): Promise<RegisteredDashboardUser> {
    const parsed = profileSchema.safeParse(value);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      throw new DashboardServiceError("invalid_profile", 422, "The profile settings are invalid.");
    }
    const updated = await this.core.updateUser(userId, userDiscordId, parsed.data as Partial<UserRow>);
    if (!updated?.user_id) {
      throw new DashboardServiceError("profile_update_failed", 500, "Profile settings were not saved.");
    }
    return updated as RegisteredDashboardUser;
  }

  async updateSettings(
    snapshot: DashboardGuildSnapshot,
    sectionId: SettingsSectionId,
    value: unknown,
    validChannelIds: Set<string>,
  ) {
    const patch = parseSettingsPatch(sectionId, value);
    if (!patch) throw new DashboardServiceError("invalid_settings", 422, "The settings are invalid.");

    this.assertDiscordReferences(snapshot, sectionId, patch, validChannelIds);
    const config = await this.core.updateSettings(snapshot, sectionId, patch);
    if (!config) throw new DashboardServiceError("settings_update_failed", 500, "The settings were not saved.");
    return config;
  }

  async updatePersona(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    section: "identity" | "prompt" | "context" | "appearance",
    value: unknown,
  ): Promise<void> {
    let updated = false;
    switch (section) {
      case "identity": {
        const parsed = personaIdentitySchema.safeParse(value);
        if (!parsed.success) throw new DashboardServiceError("invalid_persona", 422, "Invalid persona identity.");
        if (await this.core.hasPersonaNicknameConflict(snapshot, personaId, parsed.data.nickname)) {
          throw new DashboardServiceError(
            "persona_name_conflict",
            409,
            "Another persona on this server already uses that name.",
          );
        }
        updated = await this.core.updatePersonaIdentity(snapshot, personaId, parsed.data as PersonaIdentityPatch);
        if (updated) {
          const persona = snapshot.personas.find((entry) => entry.personaId === personaId);
          const nicknameKey = normalizeTriggerWord(parsed.data.nickname);
          const hasNicknameTrigger = persona?.triggerWords.some(
            (triggerWord) => normalizeTriggerWord(triggerWord) === nicknameKey,
          );
          if (persona && !hasNicknameTrigger && persona.triggerWords.length < personaLimits.maxTriggerWords) {
            await this.core.updatePersonaPrompt(snapshot, personaId, {
              triggerWords: [...persona.triggerWords, parsed.data.nickname],
              personaPrompt: persona.personaPrompt,
            });
          }
        }
        break;
      }
      case "prompt": {
        const parsed = personaPromptSchema.safeParse(value);
        if (!parsed.success) throw new DashboardServiceError("invalid_persona", 422, "Invalid persona prompt.");
        updated = await this.core.updatePersonaPrompt(snapshot, personaId, parsed.data as PersonaPromptPatch);
        break;
      }
      case "context": {
        const parsed = personaContextSchema.safeParse(value);
        if (!parsed.success) throw new DashboardServiceError("invalid_persona", 422, "Invalid persona context.");
        updated = await this.core.updatePersonaContext(snapshot, personaId, parsed.data as PersonaContextPatch);
        break;
      }
      case "appearance": {
        const parsed = personaAppearanceSchema.safeParse(value);
        if (!parsed.success) throw new DashboardServiceError("invalid_persona", 422, "Invalid appearance tags.");
        updated = await this.core.updatePersonaAppearance(snapshot, personaId, parsed.data as PersonaAppearancePatch);
        break;
      }
    }

    if (!updated) throw new DashboardServiceError("persona_update_failed", 500, "The persona was not saved.");
  }

  private assertDiscordReferences(
    snapshot: DashboardGuildSnapshot,
    sectionId: SettingsSectionId,
    patch: Record<string, unknown>,
    validChannelIds: Set<string>,
  ): void {
    for (const key of ["rp_channel_ids", "private_channel_ids", "crosschannel_blocklist_ids", "autoch_disc_ids"]) {
      const channelIds = patch[key];
      if (Array.isArray(channelIds) && channelIds.some((channelId) => !validChannelIds.has(String(channelId)))) {
        throw new DashboardServiceError("channel_not_found", 422, "One or more selected channels no longer exist.");
      }
    }

    for (const key of ["thought_log_channel_disc_id", "welcome_channel_disc_id"]) {
      const channelId = patch[key];
      if (channelId !== undefined && channelId !== null && !validChannelIds.has(String(channelId))) {
        throw new DashboardServiceError("channel_not_found", 422, "The selected channel no longer exists.");
      }
    }

    if (
      sectionId === "welcome" &&
      patch.welcome_persona_id !== undefined &&
      patch.welcome_persona_id !== null &&
      !snapshot.personas.some((persona) => persona.personaId === patch.welcome_persona_id)
    ) {
      throw new DashboardServiceError("persona_not_found", 422, "The selected persona no longer exists.");
    }
  }
}
