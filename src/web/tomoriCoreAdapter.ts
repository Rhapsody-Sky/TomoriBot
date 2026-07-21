/**
 * Boundary between the optional settings dashboard and TomoriBot internals.
 *
 * Keep imports from core DB/provider/cache modules collected here so the
 * dashboard can stay plugin-like when core modules move or are refactored.
 */
import type {
  AssembledServerConfig,
  ServerAutoTriggerConfigRow,
  ServerByokConfigRow,
  ServerCapabilitiesConfigRow,
  ServerChannelScopeConfigRow,
  ServerChatConfigRow,
  ServerMemberPermissionsConfigRow,
  ServerModelConfigRow,
  ServerNovelaiImagegenConfigRow,
  ServerNsfwConfigRow,
  ServerSpeechConfigRow,
  ServerTriggerBehaviorConfigRow,
  TomoriRow,
} from "@/types/db/schema";
import {
  configRepository,
  llmModelRepo,
  llmOverrideRepo,
  llmProviderRepo,
  personalMemoryRepository,
  personaRepository,
  serverMemoryRepository,
  userRepository,
} from "@/utils/db/repositories";
import { sql } from "@/utils/db/client";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";

export { THINKING_LEVEL_VALUES } from "@/constants/thinkingLevels";
export { invalidateUserCache } from "@/utils/cache/userCache";
export { invalidateTomoriStateCache };
export { sql };
export { NAI_IMAGE_NOISE_SCHEDULES, NAI_IMAGE_SAMPLERS } from "@/utils/image/naiImageParams";
export { getMemoryLimits, validateMemoryContent } from "@/utils/misc/memoryLimits";
export { log } from "@/utils/misc/logger";
export {
  type CustomEndpointApiStyle,
  type CustomEndpointCapability,
  type FallbackModelRef,
  type PersonalProviderCapability,
  type TomoriRow,
  PrivacyLevel,
  type UserRow,
  type UserSavedProviderConfigRow,
  personalMemorySchema,
  serverMemorySchema,
} from "@/types/db/schema";
export { registerCustomEndpoint, removeCustomEndpointRegistration } from "@/utils/provider/customEndpointService";
export { isCustomProvider } from "@/utils/provider/customProviderUtils";
export {
  type OpenRouterModelCapability,
  loadRegisteredOpenRouterModelsForScope,
  registerOpenRouterModelForScope,
  removeOpenRouterModelForScope,
} from "@/utils/provider/openrouterModelRegistry";
export { ProviderFactory } from "@/utils/provider/providerFactory";
export {
  getAllProviderChoices,
  getProviderDisplayName,
  getStaticProviderInfo,
} from "@/utils/provider/providerInfoRegistry";
export { buildUserSavedProviderConfigFromExistingOrDefaults } from "@/utils/provider/savedProviderConfig";
export { encryptApiKey } from "@/utils/security/crypto";
export {
  isLocalPersonaAvatarPath,
  loadStoredPersonaAvatarBuffer,
  resolvePersonaAvatarPublicUrl,
} from "@/utils/storage/avatarStorage";

export const loadAvailableModelsForProvider = llmModelRepo.loadAvailableModelsForProvider.bind(llmModelRepo);
export const loadAvailableEmbeddingModelsForProvider = llmModelRepo.loadAvailableEmbeddingModels.bind(llmModelRepo);
export const loadAvailableDiffusionModelsForProvider = llmModelRepo.loadAvailableDiffusionModels.bind(llmModelRepo);
export const loadAvailableVideoGenerationModelsForProvider =
  llmModelRepo.loadAvailableVideoGenerationModels.bind(llmModelRepo);
export const loadAllPersonasForServer = personaRepository.loadAllForServer.bind(personaRepository);
export const loadNaiPresetsForModel = configRepository.loadNaiPresets.bind(configRepository);
export const loadSavedProviderConfigs = llmProviderRepo.loadSavedProviderConfigs.bind(llmProviderRepo);
export const loadUserSavedProviderConfig = llmProviderRepo.loadUserSavedProviderConfig.bind(llmProviderRepo);
export const loadUserSavedProviderConfigs = llmProviderRepo.loadUserSavedProviderConfigs.bind(llmProviderRepo);
export const loadCustomEndpointsForServer = llmProviderRepo.loadCustomEndpointsForServer.bind(llmProviderRepo);
export const loadCustomEndpointsForUser = llmProviderRepo.loadCustomEndpointsForUser.bind(llmProviderRepo);

export const registerUser = userRepository.register.bind(userRepository);
export const updateUser = userRepository.update.bind(userRepository);
export const addPersonalMemoryByTomori = personalMemoryRepository.add.bind(personalMemoryRepository);
export const addServerMemoryByTomori = serverMemoryRepository.add.bind(serverMemoryRepository);
export const checkServerMemoryLimit = serverMemoryRepository.checkServerMemoryLimit.bind(serverMemoryRepository);
export const setFallbackModelRefs = llmOverrideRepo.setFallbackModelRefs.bind(llmOverrideRepo);
export const upsertUserSavedProviderConfig = llmProviderRepo.upsertUserSavedProviderConfig.bind(llmProviderRepo);
export const deleteUserSavedProviderConfig = llmProviderRepo.deleteUserSavedProviderConfig.bind(llmProviderRepo);

type DashboardPersonaPatch = Partial<TomoriRow> & {
  context_note?: string | null;
  context_note_depth?: number;
  physical_appearance_tags?: string[];
};

export async function updateTomori(
  personaId: number,
  patch: DashboardPersonaPatch,
  serverDiscId?: string,
): Promise<TomoriRow | null> {
  const { context_note, context_note_depth, physical_appearance_tags, ...corePatch } = patch;
  const updated =
    Object.keys(corePatch).length > 0 ? await personaRepository.update(personaId, corePatch, serverDiscId) : null;
  if (Object.keys(corePatch).length > 0 && !updated) return null;

  const current = updated ?? ({ persona_id: personaId } as TomoriRow);

  const splitWrites: Promise<boolean>[] = [];
  if (context_note !== undefined || context_note_depth !== undefined) {
    splitWrites.push(
      personaRepository.setContextNote(
        personaId,
        context_note !== undefined ? context_note : null,
        context_note_depth !== undefined ? context_note_depth : 0,
      ),
    );
  }
  if (physical_appearance_tags !== undefined) {
    splitWrites.push(personaRepository.setPhysicalAppearanceTags(personaId, physical_appearance_tags));
  }

  if (splitWrites.length > 0 && !(await Promise.all(splitWrites)).every(Boolean)) {
    return null;
  }
  return current;
}

function pickDefined<T extends object, K extends keyof T>(source: object, keys: readonly K[]): Partial<Pick<T, K>> {
  const sourceRecord = source as Partial<Record<keyof T, unknown>>;
  const result: Partial<Pick<T, K>> = {};
  for (const key of keys) {
    if (sourceRecord[key] !== undefined) {
      result[key] = sourceRecord[key] as T[K];
    }
  }
  return result;
}

function hasValues(value: object): boolean {
  return Object.keys(value).length > 0;
}

/**
 * Adapts the dashboard's flat config patch to the split config repositories
 * introduced by the core database refactor.
 */
export async function updateTomoriConfig(
  serverId: number,
  patch: Partial<AssembledServerConfig>,
): Promise<AssembledServerConfig | null> {
  const modelPatch = pickDefined<ServerModelConfigRow, keyof ServerModelConfigRow>(patch, [
    "llm_id",
    "embedding_model_id",
    "diffusion_model_id",
    "video_model_id",
    "vision_llm_id",
    "llm_temperature",
    "thinking_level",
    "fallback_llm_ids",
    "hide_respond_embed",
  ]);
  const chatPatch = pickDefined<ServerChatConfigRow, keyof ServerChatConfigRow>(patch, [
    "humanizer_degree",
    "message_fetch_limit",
    "send_message_limit",
    "match_limit",
    "cascade_limit",
    "timezone_offset",
    "self_debug_enabled",
    "system_prompt",
    "context_note",
    "context_note_depth",
    "llm_top_p",
    "llm_top_k",
    "llm_frequency_penalty",
    "llm_presence_penalty",
    "llm_min_p",
  ]);
  const memberPatch = pickDefined<ServerMemberPermissionsConfigRow, keyof ServerMemberPermissionsConfigRow>(patch, [
    "server_memteaching_enabled",
    "self_teaching_enabled",
    "personal_memories_enabled",
    "hide_impersonation_embeds",
    "prompt_snapshot_enabled",
  ]);
  const capabilitiesPatch = pickDefined<ServerCapabilitiesConfigRow, keyof ServerCapabilitiesConfigRow>(patch, [
    "emoji_usage_enabled",
    "sticker_usage_enabled",
    "web_search_enabled",
    "manage_message_enabled",
    "imagegen_enabled",
    "videogen_enabled",
    "voice_message_enabled",
    "tool_use_enabled",
  ]);
  const nsfwPatch = pickDefined<ServerNsfwConfigRow, keyof ServerNsfwConfigRow>(patch, [
    "uncensor_injection_enabled",
    "uncensor_unicode_space_enabled",
    "uncensor_sanitize_enabled",
  ]);
  const speechPatch = pickDefined<ServerSpeechConfigRow, keyof ServerSpeechConfigRow>(patch, [
    "voice_transcript_chat_mode",
  ]);
  const autoTriggerPatch = pickDefined<ServerAutoTriggerConfigRow, keyof ServerAutoTriggerConfigRow>(patch, [
    "autoch_disc_ids",
    "autoch_threshold",
    "autoch_threshold_max",
  ]);
  const channelScopePatch = pickDefined<ServerChannelScopeConfigRow, keyof ServerChannelScopeConfigRow>(patch, [
    "rp_channel_ids",
    "private_channel_ids",
    "crosschannel_blocklist_ids",
    "stm_privacy_bypass",
    "thought_log_channel_disc_id",
  ]);
  const triggerPatch = pickDefined<ServerTriggerBehaviorConfigRow, keyof ServerTriggerBehaviorConfigRow>(patch, [
    "always_reply_enabled",
    "deliberate_trigger_mode",
    "cooldown_type",
    "cooldown_length",
  ]);
  const novelAiPatch = pickDefined<ServerNovelaiImagegenConfigRow, keyof ServerNovelaiImagegenConfigRow>(patch, [
    "nai_preset_name",
    "image_default_positive_tags",
    "image_default_negative_tags",
    "nai_sampler",
    "nai_steps",
    "nai_scale",
    "nai_noise_schedule",
    "nai_cfg_rescale",
    "nai_diffusion_model_id",
  ]);
  const byokPatch = pickDefined<ServerByokConfigRow, keyof ServerByokConfigRow>(patch, ["user_byok_mode"]);
  const welcomePatch = pickDefined<
    AssembledServerConfig,
    "welcome_channel_disc_id" | "welcome_prompt" | "welcome_persona_id"
  >(patch, ["welcome_channel_disc_id", "welcome_prompt", "welcome_persona_id"]);

  const writes: Promise<boolean>[] = [];
  if (hasValues(modelPatch)) writes.push(configRepository.updateModelConfig(serverId, modelPatch));
  if (hasValues(chatPatch)) writes.push(configRepository.updateChatConfig(serverId, chatPatch));
  if (hasValues(memberPatch)) writes.push(configRepository.updateMemberPermissionsConfig(serverId, memberPatch));
  if (hasValues(capabilitiesPatch)) writes.push(configRepository.updateCapabilitiesConfig(serverId, capabilitiesPatch));
  if (hasValues(nsfwPatch)) writes.push(configRepository.updateNsfwConfig(serverId, nsfwPatch));
  if (hasValues(speechPatch)) writes.push(configRepository.updateSpeechConfig(serverId, speechPatch));
  if (hasValues(autoTriggerPatch)) writes.push(configRepository.updateAutoTriggerConfig(serverId, autoTriggerPatch));
  if (hasValues(channelScopePatch)) writes.push(configRepository.updateChannelScopeConfig(serverId, channelScopePatch));
  if (hasValues(triggerPatch)) writes.push(configRepository.updateTriggerBehaviorConfig(serverId, triggerPatch));
  if (hasValues(novelAiPatch)) writes.push(configRepository.updateNovelaiImagegenConfig(serverId, novelAiPatch));
  if (hasValues(byokPatch)) writes.push(configRepository.updateByokConfig(serverId, byokPatch));
  if (hasValues(welcomePatch)) writes.push(configRepository.updateWelcomeConfig(serverId, welcomePatch));

  if (writes.length === 0 || !(await Promise.all(writes)).every(Boolean)) {
    return null;
  }

  const [server] = await sql`
    SELECT server_disc_id
    FROM servers
    WHERE server_id = ${serverId}
    LIMIT 1
  `;
  const serverDiscId = server?.server_disc_id as string | undefined;
  if (!serverDiscId) return null;

  invalidateTomoriStateCache(serverDiscId);
  const [state] = await personaRepository.loadAllForServer(serverDiscId);
  return state?.config ?? null;
}
