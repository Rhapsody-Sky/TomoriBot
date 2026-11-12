import { CooldownType, responseRuleCheckerRefSchema, utcOffsetSchema, type UserRow } from "@/types/db/schema";
import { findHumanizerDependencyViolation, HUMANIZER_TOGGLES } from "@/constants/humanizer";
import { resolvePrefillBlocker } from "@/utils/chat/assistantPrefill";
import { addressingStyleSchema, USER_IDENTITY_FIELD_MAX_LENGTH, USER_NICKNAME_MAX_LENGTH } from "@/types/personaNaming";
import { z } from "zod";
import { getMemoryLimits } from "@/utils/misc/memoryLimits";
import { normalizeTriggerWord } from "@/utils/text/triggerWords";
import { slugifyLabel } from "@/utils/text/slugifyLabel";
import { PERSONA_NAMING_VALUE_MAX_LENGTH } from "@/types/personaNaming";
import { presetExportDataSchema } from "@/types/preset/presetExport";
import { getRegisterableLocales, localizer } from "@/utils/text/localizer";
import type {
  PersonaAppearancePatch,
  PersonaContextPatch,
  PersonaIdentityPatch,
  PersonaPromptPatch,
  TomoriDashboardCore,
} from "./core";
import { DashboardServiceError } from "./errors";
import { assertEditableSystemPrompt } from "./serverBehaviorService";
import { type SettingsSectionId, parseSettingsPatch } from "./settingsCatalog";
import type { DashboardGuildSnapshot, RegisteredDashboardUser } from "./types";

const optionalProfileText = (limit: number) =>
  z
    .preprocess((value) => (typeof value === "string" ? value.trim() || null : value), z.string().max(limit).nullable())
    .optional();

const profileSchema = z
  .object({
    user_nickname: optionalProfileText(USER_NICKNAME_MAX_LENGTH),
    prefix_override: optionalProfileText(PERSONA_NAMING_VALUE_MAX_LENGTH),
    suffix_override: optionalProfileText(PERSONA_NAMING_VALUE_MAX_LENGTH),
    language_pref: z
      .string()
      .refine((value) => getRegisterableLocales().some((code) => code === value))
      .optional(),
    gender_identity: optionalProfileText(USER_IDENTITY_FIELD_MAX_LENGTH),
    pronouns: optionalProfileText(USER_IDENTITY_FIELD_MAX_LENGTH),
    addressing_style: addressingStyleSchema.nullable().optional(),
    privacy_level: z.number().int().min(0).max(2).optional(),
    personal_dtm: z.enum(["off", "follow", "on"]).optional(),
    personal_deliberate_tool_mode: z.enum(["off", "follow", "on"]).optional(),
    timezone_offset: utcOffsetSchema.nullable().optional(),
    personal_server_fallback_enabled: z.boolean().optional(),
    natural_nudge_opt_out: z.boolean().optional(),
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
const namingValue = z.string().trim().max(PERSONA_NAMING_VALUE_MAX_LENGTH).nullable();
const personaNamingSchema = z.object({ nickname: namingValue, prefix: namingValue, suffix: namingValue }).strict();
const randomizerSchema = z.object({ enabled: z.boolean() }).strict();
const draftingSelectionSchema = z.union([
  z
    .object({
      reviewer: z
        .object({ id: z.number().int().positive(), provider: z.string().min(1) })
        .strict()
        .nullable(),
    })
    .strict(),
  z.object({ checker: responseRuleCheckerRefSchema.nullable() }).strict(),
]);
const stmCategoriesSchema = z
  .object({
    categories: z
      .array(
        z
          .object({
            label: z.string().trim().min(1),
            description: z.string().trim().min(1),
          })
          .strict()
          .refine(
            ({ label, description }) =>
              !label.includes(":") && `${label}: ${description}`.length <= 1000 && Boolean(slugifyLabel(label)),
          ),
      )
      .max(5),
  })
  .strict()
  .refine(({ categories }) => new Set(categories.map(({ label }) => slugifyLabel(label))).size === categories.length);
const personaIdentitySchema = z.object({ nickname: presetExportDataSchema.shape.tomori_nickname.trim() }).strict();
const personaPromptSchema = z
  .object({
    triggerWords: presetExportDataSchema.shape.trigger_words,
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

export const personaSettingsSectionSchema = z.enum(["identity", "prompt", "context", "appearance", "humanizer"]);
const personaHumanizerSchema = z
  .object({
    override: z.record(z.enum(HUMANIZER_TOGGLES), z.boolean()).nullable(),
  })
  .strict();

export type DashboardSettingsCore = Pick<
  TomoriDashboardCore,
  | "updateUser"
  | "loadUser"
  | "setProfileNaming"
  | "setProfileLanguage"
  | "setPersonalRandomizer"
  | "setDraftingSelection"
  | "updateSettings"
  | "updatePersonaIdentity"
  | "hasPersonaNicknameConflict"
  | "updatePersonaPrompt"
  | "updatePersonaContext"
  | "updatePersonaAppearance"
  | "updatePersonaHumanizer"
  | "updatePersonaNaming"
  | "updateStmCategories"
>;

export class DashboardSettingsService {
  constructor(private readonly core: DashboardSettingsCore) {}

  async updateStmCategories(snapshot: DashboardGuildSnapshot, value: unknown) {
    const parsed = stmCategoriesSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError(
        "invalid_stm_categories",
        422,
        localizer("en-US", "general.dashboard.stm_categories_invalid"),
      );
    }
    const categories = parsed.data.categories.length
      ? parsed.data.categories
      : [
          {
            label: "summary",
            description: "A running summary of recent events, topics, and context from this conversation.",
          },
        ];
    if (!(await this.core.updateStmCategories(snapshot.serverId, categories))) {
      throw new DashboardServiceError(
        "stm_categories_update_failed",
        500,
        localizer("en-US", "general.dashboard.stm_categories_failed"),
      );
    }
    return categories;
  }

  async updatePersonaNaming(
    snapshot: DashboardGuildSnapshot,
    user: RegisteredDashboardUser,
    personaId: number,
    value: unknown,
  ) {
    const persona = snapshot.personas.find((entry) => entry.personaId === personaId && entry.lineageId > 0);
    if (!persona)
      throw new DashboardServiceError(
        "persona_not_found",
        404,
        localizer("en-US", "general.dashboard.naming_persona_missing"),
      );
    const parsed = personaNamingSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError(
        "invalid_persona_naming",
        422,
        localizer("en-US", "general.dashboard.naming_invalid"),
      );
    }
    const preference = { ...parsed.data, nickname: parsed.data.nickname || null };
    const updated = await this.core.updatePersonaNaming({
      userId: user.user_id,
      userDiscId: user.user_disc_id,
      personaLineageId: persona.lineageId,
      ...preference,
    });
    if (!updated)
      throw new DashboardServiceError(
        "persona_naming_update_failed",
        500,
        localizer("en-US", "general.dashboard.naming_failed"),
      );
    return preference;
  }

  async updateProfile(userId: number, userDiscordId: string, value: unknown): Promise<RegisteredDashboardUser> {
    const parsed = profileSchema.safeParse(value);
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      throw new DashboardServiceError("invalid_profile", 422, "The profile settings are invalid.");
    }
    const { user_nickname, prefix_override, suffix_override, language_pref, ...patch } = parsed.data;
    const hasNaming = user_nickname !== undefined || prefix_override !== undefined || suffix_override !== undefined;
    const identity = { userId, userDiscId: userDiscordId };
    let updated = Object.keys(patch).length
      ? await this.core.updateUser(userId, userDiscordId, patch as Partial<UserRow>)
      : await this.core.loadUser(userDiscordId);
    if (updated && hasNaming) {
      const result = await this.core.setProfileNaming({
        ...identity,
        nickname: user_nickname === undefined ? (updated.user_nickname ?? null) : user_nickname,
        prefix: prefix_override === undefined ? (updated.prefix_override ?? null) : prefix_override,
        suffix: suffix_override === undefined ? (updated.suffix_override ?? null) : suffix_override,
      });
      if (result.status !== "success") {
        throw new DashboardServiceError(
          "profile_naming_failed",
          500,
          localizer("en-US", "general.dashboard.naming_failed"),
        );
      }
    }
    if (updated && language_pref !== undefined) {
      const result = await this.core.setProfileLanguage({ ...identity, language: language_pref });
      if (result.status !== "success") {
        throw new DashboardServiceError(
          "profile_language_failed",
          result.status === "invalid-value" ? 422 : 500,
          localizer("en-US", "general.dashboard.interface_discord_language_failed"),
        );
      }
    }
    if (updated && (hasNaming || language_pref !== undefined)) updated = await this.core.loadUser(userDiscordId);
    if (!updated?.user_id) {
      throw new DashboardServiceError("profile_update_failed", 500, "Profile settings were not saved.");
    }
    return updated as RegisteredDashboardUser;
  }

  async setPersonalRandomizer(userId: number, userDiscordId: string, value: unknown) {
    const parsed = randomizerSchema.safeParse(value);
    if (!parsed.success) throw new DashboardServiceError("invalid_profile", 422, "The profile settings are invalid.");
    const result = await this.core.setPersonalRandomizer({
      userId,
      userDiscId: userDiscordId,
      enabled: parsed.data.enabled,
    });
    if (result.status === "requires-fallbacks" || result.status === "write-failed") {
      throw new DashboardServiceError(
        "personal_randomizer_failed",
        result.status === "requires-fallbacks" ? 422 : 500,
        localizer(
          "en-US",
          result.status === "requires-fallbacks"
            ? "general.dashboard.interface_personal_randomizer_requires_fallbacks"
            : "general.dashboard.interface_personal_randomizer_failed",
        ),
      );
    }
    return parsed.data.enabled;
  }

  async setDraftingSelection(snapshot: DashboardGuildSnapshot, value: unknown) {
    const parsed = draftingSelectionSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError(
        "invalid_drafting_selection",
        422,
        localizer("en-US", "general.dashboard.interface_drafting_invalid_selection"),
      );
    }
    const result = await this.core.setDraftingSelection(snapshot, parsed.data);
    if (result !== "success") {
      throw new DashboardServiceError(
        "drafting_selection_failed",
        result === "write-failed" ? 500 : 422,
        localizer(
          "en-US",
          result === "write-failed"
            ? "general.dashboard.interface_drafting_save_failed"
            : "general.dashboard.interface_drafting_invalid_selection",
        ),
      );
    }
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
    if (
      sectionId === "triggers" &&
      "cooldown_type" in patch &&
      patch.cooldown_type !== CooldownType.OFF &&
      (patch.cooldown_length ?? snapshot.config.cooldown_length) === 0
    ) {
      throw new DashboardServiceError(
        "cooldown_duration_required",
        422,
        localizer("en-US", "general.dashboard.response_cooldown_duration_required"),
      );
    }
    if (sectionId === "chat" && "system_prompt" in patch) {
      if (patch.system_prompt !== (snapshot.config.system_prompt?.trim() || null)) {
        await assertEditableSystemPrompt(snapshot.serverId);
      } else {
        delete patch.system_prompt;
      }
    }
    if (
      sectionId === "chat" &&
      HUMANIZER_TOGGLES.some((key) => key in patch) &&
      findHumanizerDependencyViolation({ ...snapshot.config, ...patch })
    ) {
      throw new DashboardServiceError(
        "invalid_humanizer",
        422,
        localizer("en-US", "general.dashboard.humanizer_requires_streaming"),
      );
    }
    if (sectionId === "chat" && patch.response_prefill) {
      const mainPersona = snapshot.rawPersonas.find((persona) => !persona.is_alter);
      if (!mainPersona || resolvePrefillBlocker(mainPersona) === "model") {
        throw new DashboardServiceError(
          "prefill_unsupported",
          422,
          "The active model does not support assistant prefill.",
        );
      }
    }
    const config = await this.core.updateSettings(snapshot, sectionId, patch);
    if (!config) throw new DashboardServiceError("settings_update_failed", 500, "The settings were not saved.");
    return config;
  }

  async updatePersona(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    section: z.infer<typeof personaSettingsSectionSchema>,
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
      case "humanizer": {
        const parsed = personaHumanizerSchema.safeParse(value);
        if (!parsed.success) {
          throw new DashboardServiceError(
            "invalid_humanizer",
            422,
            localizer("en-US", "general.dashboard.persona_humanizer_invalid"),
          );
        }
        const result = await this.core.updatePersonaHumanizer(snapshot, personaId, parsed.data.override);
        if (result.status === "not-found") {
          throw new DashboardServiceError(
            "persona_not_found",
            404,
            localizer("en-US", "general.dashboard.persona_humanizer_not_found"),
          );
        }
        if (result.status === "invalid-value") {
          throw new DashboardServiceError(
            "invalid_humanizer",
            422,
            localizer("en-US", "general.dashboard.humanizer_requires_streaming"),
          );
        }
        updated = result.status === "success" || result.status === "unchanged";
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
