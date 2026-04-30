/**
 * Boundary between the optional settings dashboard and TomoriBot internals.
 *
 * Keep imports from core DB/provider/cache modules collected here so the
 * dashboard can stay plugin-like: if TomoriBot internals move, this is the
 * first place to patch instead of hunting through route/UI code.
 */
export { THINKING_LEVEL_VALUES } from "@/constants/thinkingLevels";
export { invalidateUserCache } from "@/utils/cache/userCache";
export { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
export { sql } from "@/utils/db/client";
export {
  loadAvailableDiffusionModelsForProvider,
  loadAvailableEmbeddingModelsForProvider,
  loadAvailableModelsForProvider,
  loadAvailableVideoGenerationModelsForProvider,
  loadAllPersonasForServer,
  loadCustomEndpointsForServer,
  loadCustomEndpointsForUser,
  loadNaiPresetsForModel,
  loadSavedProviderConfigs,
  loadUserSavedProviderConfig,
  loadUserSavedProviderConfigs,
} from "@/utils/db/dbRead";
export {
  addPersonalMemoryByTomori,
  addServerMemoryByTomori,
  deleteUserSavedProviderConfig,
  registerUser,
  setFallbackModelRefs,
  updateTomori,
  updateTomoriConfig,
  updateUser,
  upsertUserSavedProviderConfig,
} from "@/utils/db/dbWrite";
export { checkServerMemoryLimit, getMemoryLimits, validateMemoryContent } from "@/utils/db/memoryLimits";
export { NAI_IMAGE_NOISE_SCHEDULES, NAI_IMAGE_SAMPLERS } from "@/utils/image/naiImageParams";
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
export { getAllProviderChoices, getProviderDisplayName, getStaticProviderInfo } from "@/utils/provider/providerInfoRegistry";
export { buildUserSavedProviderConfigFromExistingOrDefaults } from "@/utils/provider/savedProviderConfig";
export { encryptApiKey } from "@/utils/security/crypto";
export {
  isLocalPersonaAvatarPath,
  loadStoredPersonaAvatarBuffer,
  resolvePersonaAvatarPublicUrl,
} from "@/utils/storage/avatarStorage";
