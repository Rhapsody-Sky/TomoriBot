import type {
  AssembledServerConfig,
  CustomEndpointApiStyle,
  CustomEndpointCapability,
  CustomEndpointRow,
  FallbackModelRef,
  PersonalProviderCapability,
  PersonalMemoryRow,
  SavedProviderConfigRow,
  ServerAutoTriggerConfigRow,
  ServerByokConfigRow,
  ServerCapabilitiesConfigRow,
  ServerChannelScopeConfigRow,
  ServerChatConfigRow,
  ServerMemberPermissionsConfigRow,
  ServerMemoryConfigRow,
  ServerModelConfigRow,
  ServerNoticeEmbedsConfigRow,
  ServerNovelaiImagegenConfigRow,
  ServerNsfwConfigRow,
  ServerSpeechConfigRow,
  ServerTriggerBehaviorConfigRow,
  ServerMemoryRow,
  UserSavedProviderConfigRow,
  UserRow,
} from "@/types/db/schema";
import {
  configRepository,
  llmModelRepo,
  llmProviderRepo,
  personalMemoryRepository,
  personaRepository,
  serverMemoryRepository,
  statRepository,
  userRepository,
} from "@/utils/db/repositories";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { loadStoredPersonaAvatarBuffer } from "@/utils/storage/avatarStorage";
import {
  registerCustomEndpoint,
  removeCustomEndpointRegistration,
  validateCustomEndpointReachability,
} from "@/utils/provider/customEndpointService";
import { isCustomProvider, prettifyModelCodename } from "@/utils/provider/customProviderUtils";
import {
  type OpenRouterModelCapability,
  type RegisteredOpenRouterModelEntry,
  loadRegisteredOpenRouterModelsForScope,
  registerOpenRouterModelForScope,
  removeOpenRouterModelForScope,
} from "@/utils/provider/openrouterModelRegistry";
import { ProviderFactory } from "@/utils/provider/providerFactory";
import { getAllProviderChoices, getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import {
  assignPersonalCapabilityToProvider,
  hasConfiguredPersonalModel,
  withCapabilityEnabled,
} from "@/utils/provider/personalProviderHelpers";
import {
  buildSavedProviderConfigFromExistingOrDefaults,
  buildUserSavedProviderConfigFromExistingOrDefaults,
} from "@/utils/provider/savedProviderConfig";
import { activateServerTextModelFromSavedConfig } from "@/utils/provider/providerActivation";
import { encryptApiKey } from "@/utils/security/crypto";
import type { SettingsSectionId } from "./settingsCatalog";
import type { DashboardGuildSnapshot, DashboardPersona } from "./types";

export interface PersonaIdentityPatch {
  nickname: string;
}

export interface PersonaPromptPatch {
  triggerWords: string[];
  personaPrompt: string | null;
}

export interface PersonaContextPatch {
  contextNote: string | null;
  contextNoteDepth: number;
}

export interface PersonaAppearancePatch {
  physicalAppearanceTags: string[];
}

export interface DashboardCustomEndpointInput {
  label: string;
  capability: CustomEndpointCapability;
  apiStyle: CustomEndpointApiStyle;
  endpointUrl: string;
  displayName: string;
  modelName: string | null;
  authToken: string | null;
  numCtx: number | null;
  hasTools: boolean;
  seesImages: boolean;
  seesVideos: boolean;
  supportsStructOutput: boolean;
  strictRoleAlternation: boolean;
  supportsPrefixCompletion: boolean;
}

export type DashboardProviderScope =
  | { kind: "server"; snapshot: DashboardGuildSnapshot }
  | { kind: "personal"; snapshot: DashboardGuildSnapshot; userId: number; userDiscordId: string };

export type DashboardServerModelKind = "text" | "vision" | "embedding" | "image" | "imageNai" | "video";

export interface DashboardServerModelOption {
  id: number;
  label: string;
  provider: string;
}

export interface DashboardServerModelWorkspace {
  options: Record<DashboardServerModelKind, DashboardServerModelOption[]>;
  selected: Record<DashboardServerModelKind, number | null>;
}

export type DashboardStatsTimeframe = "today" | "week" | "month" | "year" | "all_time";

export interface DashboardServerStats {
  timeframe: DashboardStatsTimeframe;
  totals: {
    messages: number;
    commands: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
    textGenerations: number;
    imageGenerations: number;
    videoGenerations: number;
  };
  personas: Array<{ lineageId: number; name: string; count: number }>;
  models: Array<{ name: string; inputTokens: number; outputTokens: number; cost: number }>;
  tools: Array<{ name: string; count: number }>;
  topCommands: Array<{ name: string; count: number }>;
}

function resolveStatsWindow(timeframe: DashboardStatsTimeframe): string | undefined {
  if (timeframe === "all_time") return undefined;
  const now = new Date();
  const floor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (timeframe === "week") floor.setUTCDate(floor.getUTCDate() - 6);
  if (timeframe === "month") floor.setUTCDate(floor.getUTCDate() - 29);
  if (timeframe === "year") floor.setUTCFullYear(floor.getUTCFullYear() - 1);
  return floor.toISOString().split("T")[0];
}

export class TomoriDashboardCore {
  async ensureUser(discordId: string, displayName: string): Promise<UserRow | null> {
    return userRepository.register(discordId, displayName);
  }

  async loadUser(discordId: string): Promise<UserRow | null> {
    return userRepository.loadByDiscordId(discordId);
  }

  async updateUser(userId: number, userDiscordId: string, patch: Partial<UserRow>): Promise<UserRow | null> {
    const updated = await userRepository.update(userId, patch);
    if (updated) invalidateUserCache(userDiscordId);
    return updated;
  }

  getProviderChoices(): Array<{ name: string; value: string }> {
    return getAllProviderChoices().filter((choice) => !isCustomProvider(choice.value));
  }

  getProviderDisplayName(provider: string): string {
    return getProviderDisplayName(provider);
  }

  async loadServerProviderConfigs(serverId: number): Promise<SavedProviderConfigRow[]> {
    return llmProviderRepo.loadSavedProviderConfigs(serverId);
  }

  async loadPersonalProviderConfigs(userId: number): Promise<UserSavedProviderConfigRow[]> {
    return llmProviderRepo.loadUserSavedProviderConfigs(userId);
  }

  async loadServerCustomEndpoints(serverId: number): Promise<CustomEndpointRow[]> {
    return llmProviderRepo.loadCustomEndpointsForServer(serverId);
  }

  async loadPersonalCustomEndpoints(userId: number): Promise<CustomEndpointRow[]> {
    return llmProviderRepo.loadCustomEndpointsForUser(userId);
  }

  async loadServerOpenRouterModels(serverId: number): Promise<RegisteredOpenRouterModelEntry[]> {
    return loadRegisteredOpenRouterModelsForScope({ kind: "server", ownerId: serverId });
  }

  async loadPersonalOpenRouterModels(userId: number): Promise<RegisteredOpenRouterModelEntry[]> {
    return loadRegisteredOpenRouterModelsForScope({ kind: "personal", ownerId: userId });
  }

  async saveServerProviderCredential(
    snapshot: DashboardGuildSnapshot,
    provider: string,
    apiKey: string,
    validate: boolean,
  ): Promise<boolean> {
    if (validate && !(await this.validateProviderCredential(provider, apiKey))) return false;
    const encrypted = await encryptApiKey(apiKey);
    const existing = await llmProviderRepo.loadSavedProviderConfig(snapshot.serverId, provider);
    const config = await buildSavedProviderConfigFromExistingOrDefaults({
      serverId: snapshot.serverId,
      provider,
      apiKey: encrypted.encrypted,
      keyVersion: encrypted.version,
      baseConfig: snapshot.config,
      existingConfig: existing,
    });
    return llmProviderRepo.upsertSavedProviderConfig(snapshot.serverId, config, {
      serverDiscId: snapshot.serverDiscordId,
    });
  }

  async savePersonalProviderCredential(
    snapshot: DashboardGuildSnapshot,
    userId: number,
    userDiscordId: string,
    provider: string,
    apiKey: string,
    validate: boolean,
  ): Promise<boolean> {
    if (validate && !(await this.validateProviderCredential(provider, apiKey))) return false;
    const encrypted = await encryptApiKey(apiKey);
    const existing = await llmProviderRepo.loadUserSavedProviderConfig(userId, provider);
    const config = await buildUserSavedProviderConfigFromExistingOrDefaults({
      userId,
      provider,
      apiKey: encrypted.encrypted,
      keyVersion: encrypted.version,
      baseConfig: snapshot.config,
      existingConfig: existing,
    });
    const saved = await llmProviderRepo.upsertUserSavedProviderConfig(userId, config);
    if (saved) invalidateUserCache(userDiscordId);
    return saved;
  }

  async setPersonalProviderCapability(
    userId: number,
    userDiscordId: string,
    provider: string,
    capability: PersonalProviderCapability,
    enabled: boolean,
  ): Promise<boolean> {
    const row = await llmProviderRepo.loadUserSavedProviderConfig(userId, provider);
    if (!row || (enabled && !hasConfiguredPersonalModel(row, capability))) return false;

    const saved = enabled
      ? await assignPersonalCapabilityToProvider(userId, provider, capability, (current) => current)
      : await llmProviderRepo.upsertUserSavedProviderConfig(userId, withCapabilityEnabled(row, capability, false));
    if (saved) invalidateUserCache(userDiscordId);
    return saved;
  }

  async removePersonalProvider(userId: number, userDiscordId: string, provider: string): Promise<boolean> {
    if (isCustomProvider(provider)) return false;
    const removed = await llmProviderRepo.deleteUserSavedProviderConfig(userId, provider);
    if (removed) invalidateUserCache(userDiscordId);
    return removed;
  }

  async validateCustomEndpoint(
    input: DashboardCustomEndpointInput,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    return validateCustomEndpointReachability({
      apiStyle: input.apiStyle,
      endpointUrl: input.endpointUrl,
      apiKey: input.authToken,
    });
  }

  async registerDashboardCustomEndpoint(scope: DashboardProviderScope, input: DashboardCustomEndpointInput) {
    const result = await registerCustomEndpoint({
      scope:
        scope.kind === "server"
          ? {
              kind: "server",
              ownerId: scope.snapshot.serverId,
              baseConfig: scope.snapshot.config,
              serverDiscId: scope.snapshot.serverDiscordId,
            }
          : {
              kind: "personal",
              ownerId: scope.userId,
              baseConfig: scope.snapshot.config,
            },
      ...input,
    });
    if (result && scope.kind === "personal") invalidateUserCache(scope.userDiscordId);
    return result;
  }

  async removeDashboardCustomEndpoint(
    scope: DashboardProviderScope,
    endpoint: Pick<CustomEndpointRow, "custom_endpoint_id" | "label" | "capability" | "model_ref_id">,
  ): Promise<boolean> {
    if (!endpoint.custom_endpoint_id) return false;
    const removed = await removeCustomEndpointRegistration({
      scope:
        scope.kind === "server"
          ? {
              kind: "server",
              ownerId: scope.snapshot.serverId,
              baseConfig: scope.snapshot.config,
              serverDiscId: scope.snapshot.serverDiscordId,
            }
          : {
              kind: "personal",
              ownerId: scope.userId,
              baseConfig: scope.snapshot.config,
            },
      customEndpointId: endpoint.custom_endpoint_id,
      label: endpoint.label,
      capability: endpoint.capability,
      modelRefId: endpoint.model_ref_id ?? null,
    });
    if (removed && scope.kind === "personal") invalidateUserCache(scope.userDiscordId);
    return removed;
  }

  async registerDashboardOpenRouterModel(
    scope: DashboardProviderScope,
    capability: OpenRouterModelCapability,
    modelName: string,
  ) {
    const result = await registerOpenRouterModelForScope(
      scope.kind === "server"
        ? { kind: "server", ownerId: scope.snapshot.serverId }
        : { kind: "personal", ownerId: scope.userId },
      capability,
      modelName,
    );
    if (scope.kind === "personal") invalidateUserCache(scope.userDiscordId);
    else invalidateTomoriStateCache(scope.snapshot.serverDiscordId);
    return result;
  }

  async removeDashboardOpenRouterModel(
    scope: DashboardProviderScope,
    capability: OpenRouterModelCapability,
    modelName: string,
  ) {
    const result = await removeOpenRouterModelForScope(
      scope.kind === "server"
        ? { kind: "server", ownerId: scope.snapshot.serverId }
        : { kind: "personal", ownerId: scope.userId },
      capability,
      modelName,
    );
    if (scope.kind === "personal") invalidateUserCache(scope.userDiscordId);
    else invalidateTomoriStateCache(scope.snapshot.serverDiscordId);
    return result;
  }

  async loadServerFallbackOptions(snapshot: DashboardGuildSnapshot) {
    const configs = await llmProviderRepo.loadSavedProviderConfigs(snapshot.serverId);
    const providerNames = Array.from(new Set(configs.map((config) => config.provider.toLowerCase())));
    const modelGroups = await Promise.all(
      providerNames.map((provider) =>
        llmModelRepo.loadAvailableModelsForProvider(provider, false, {
          kind: "server",
          ownerId: snapshot.serverId,
        }),
      ),
    );
    const models = modelGroups
      .flatMap((group) => group ?? [])
      .filter((model) => typeof model.llm_id === "number")
      .map((model) => ({
        ref: { type: "llm" as const, id: model.llm_id as number },
        label: `${getProviderDisplayName(model.llm_provider)} / ${model.llm_codename}`,
      }));
    const endpoints = (await llmProviderRepo.loadCustomEndpointsForServer(snapshot.serverId))
      .filter((endpoint) => endpoint.capability === "text" && endpoint.custom_endpoint_id)
      .map((endpoint) => ({
        ref: { type: "custom_endpoint" as const, id: endpoint.custom_endpoint_id as number },
        label: `${endpoint.display_name} / ${endpoint.model_name || endpoint.label}`,
      }));
    return [...models, ...endpoints];
  }

  async setServerFallbacks(snapshot: DashboardGuildSnapshot, refs: FallbackModelRef[]): Promise<boolean> {
    return configRepository.setFallbackModelRefs(snapshot.serverId, refs, snapshot.serverDiscordId);
  }

  async loadServerModelWorkspace(snapshot: DashboardGuildSnapshot): Promise<DashboardServerModelWorkspace> {
    const configs = await llmProviderRepo.loadSavedProviderConfigs(snapshot.serverId);
    const providerNames = Array.from(
      new Set([
        ...configs.map((config) => config.provider.toLowerCase()),
        ...snapshot.rawPersonas.flatMap((persona) => (persona.llm ? [persona.llm.llm_provider.toLowerCase()] : [])),
      ]),
    );
    const scope = { kind: "server" as const, ownerId: snapshot.serverId };
    const groups = await Promise.all(
      providerNames.map(async (provider) => {
        const [llms, embeddings, images, videos] = await Promise.all([
          llmModelRepo.loadAvailableModelsForProvider(provider, false, scope),
          llmModelRepo.loadAvailableEmbeddingModels(provider, false, scope),
          llmModelRepo.loadAvailableDiffusionModels(provider, false, scope),
          llmModelRepo.loadAvailableVideoGenerationModels(provider, false, scope),
        ]);
        return {
          llms: llms ?? [],
          embeddings: embeddings ?? [],
          images: images ?? [],
          videos: videos ?? [],
        };
      }),
    );

    const options: DashboardServerModelWorkspace["options"] = {
      text: [],
      vision: [],
      embedding: [],
      image: [],
      imageNai: [],
      video: [],
    };
    const add = (kind: DashboardServerModelKind, id: number | null | undefined, provider: string, codename: string) => {
      if (!id || options[kind].some((option) => option.id === id)) return;
      options[kind].push({
        id,
        provider,
        label: `${getProviderDisplayName(provider)} / ${codename}`,
      });
    };

    for (const group of groups) {
      for (const model of group.llms) {
        add("text", model.llm_id, model.llm_provider, model.llm_codename);
        if (model.sees_images) add("vision", model.llm_id, model.llm_provider, model.llm_codename);
      }
      for (const model of group.embeddings) {
        add("embedding", model.embedding_model_id, model.provider, model.codename);
      }
      for (const model of group.images) {
        add(
          model.provider.toLowerCase() === "novelai" ? "imageNai" : "image",
          model.diffusion_model_id,
          model.provider,
          model.codename,
        );
      }
      for (const model of group.videos) {
        add("video", model.video_model_id, model.provider, model.codename);
      }
    }

    for (const entries of Object.values(options)) {
      entries.sort((left, right) => left.label.localeCompare(right.label));
    }

    return {
      options,
      selected: {
        text: snapshot.config.llm_id ?? null,
        vision: snapshot.config.vision_llm_id ?? null,
        embedding: snapshot.config.embedding_model_id ?? null,
        image: snapshot.config.diffusion_model_id ?? null,
        imageNai: snapshot.config.nai_diffusion_model_id ?? null,
        video: snapshot.config.video_model_id ?? null,
      },
    };
  }

  async setServerPrimaryModel(
    snapshot: DashboardGuildSnapshot,
    kind: DashboardServerModelKind,
    modelId: number | null,
  ): Promise<boolean> {
    if (kind === "text") {
      if (!modelId) return false;
      const model = await llmModelRepo.loadById(modelId);
      const tomoriState = snapshot.rawPersonas.find((persona) => !persona.is_alter) ?? snapshot.rawPersonas[0];
      if (!model?.llm_id || !tomoriState) return false;
      const savedConfig = await llmProviderRepo.loadSavedProviderConfig(snapshot.serverId, model.llm_provider);
      if (!savedConfig) return false;
      const result = await activateServerTextModelFromSavedConfig({
        serverDiscId: snapshot.serverDiscordId,
        tomoriState,
        savedConfig,
        llmId: model.llm_id,
      });
      return result.status === "activated";
    }

    const updated =
      kind === "imageNai"
        ? await configRepository.updateNovelaiImagegenConfig(snapshot.serverId, {
            nai_diffusion_model_id: modelId,
          })
        : await configRepository.updateModelConfig(snapshot.serverId, {
            [kind === "vision"
              ? "vision_llm_id"
              : kind === "embedding"
                ? "embedding_model_id"
                : kind === "image"
                  ? "diffusion_model_id"
                  : "video_model_id"]: modelId,
          });
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  private async validateProviderCredential(provider: string, apiKey: string): Promise<boolean> {
    try {
      const instance = await ProviderFactory.getProviderByName(provider);
      return (await instance.validateApiKey(apiKey)).valid;
    } catch {
      return false;
    }
  }

  async loadServerStats(
    snapshot: DashboardGuildSnapshot,
    timeframe: DashboardStatsTimeframe,
  ): Promise<DashboardServerStats> {
    await statRepository.flush();
    const from = resolveStatsWindow(timeframe);
    const scope = { serverId: snapshot.serverId, from };
    const [messages, commands, tokens, estimatedCost, generations, personas, models, tools, topCommands] =
      await Promise.all([
        statRepository.getMetricTotal({ metric: "message_sent", ...scope }),
        statRepository.getMetricTotal({ metric: "command_used", ...scope }),
        statRepository.getTokenTotals(scope),
        statRepository.getEstimatedCost(scope),
        statRepository.getGenerationTotals(scope),
        statRepository.getServerPersonaMessages({ ...scope, limit: 5 }),
        statRepository.getModelCostBreakdown({ ...scope, limit: 5 }),
        statRepository.getMetricKeyBreakdown({ metric: "tool_used", ...scope, limit: 5 }),
        statRepository.getMetricKeyBreakdown({ metric: "command_used", ...scope, limit: 5 }),
      ]);
    const personaNames = new Map(snapshot.personas.map((persona) => [persona.lineageId, persona.nickname]));

    return {
      timeframe,
      totals: {
        messages,
        commands,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        estimatedCost,
        textGenerations: generations.textGenerations,
        imageGenerations: generations.imageGenerations,
        videoGenerations: generations.videoGenerations,
      },
      personas: personas.map((entry) => ({
        lineageId: entry.lineageId,
        name: personaNames.get(entry.lineageId) ?? `Persona #${entry.lineageId}`,
        count: entry.count,
      })),
      models: models.map((entry) => ({
        name: prettifyModelCodename(entry.model),
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cost: entry.cost,
      })),
      tools: tools.map((entry) => ({ name: entry.key, count: entry.count })),
      topCommands: topCommands.map((entry) => ({ name: entry.key, count: entry.count })),
    };
  }

  async isUserBlacklisted(serverDiscordId: string, userDiscordId: string): Promise<boolean> {
    return userRepository.isBlacklisted(serverDiscordId, userDiscordId);
  }

  async loadGuildSnapshot(serverDiscordId: string): Promise<DashboardGuildSnapshot | null> {
    const rawPersonas = await personaRepository.loadAllForServer(serverDiscordId);
    const first = rawPersonas[0];
    if (!first) return null;

    const personas: DashboardPersona[] = rawPersonas.map((persona) => {
      const personaId = persona.persona_id ?? 0;
      return {
        personaId,
        lineageId: persona.persona_lineage_id ?? 0,
        nickname: persona.persona_nickname,
        isAlter: persona.is_alter,
        isPointer: persona.is_pointer === true,
        avatarUrl: personaId > 0 ? `/settings/api/guilds/${serverDiscordId}/personas/${personaId}/avatar` : null,
        triggerWords: persona.trigger_words ?? [],
        personaPrompt: persona.persona_prompt ?? null,
        attributes:
          persona.persona_attributes?.map((attribute) => ({
            text: attribute.attribute_text,
            isPublic: attribute.is_public,
          })) ?? (persona.attribute_list ?? []).map((text) => ({ text, isPublic: false })),
        sampleDialogues: (persona.sample_dialogues_in ?? []).map((input, index) => ({
          input,
          output: persona.sample_dialogues_out?.[index] ?? "",
        })),
        contextNote: persona.context_note ?? null,
        contextNoteDepth: persona.context_note_depth ?? 0,
        physicalAppearanceTags: persona.physical_appearance_tags ?? [],
        humanizerOverride: persona.humanizer_degree_override ?? null,
      };
    });

    return {
      serverId: first.server_id,
      serverDiscordId,
      config: first.config,
      personas,
      rawPersonas,
    };
  }

  async loadPersonaAvatar(serverDiscordId: string, personaId: number): Promise<Buffer | null> {
    const snapshot = await this.loadGuildSnapshot(serverDiscordId);
    const persona = snapshot?.rawPersonas.find((entry) => entry.persona_id === personaId);
    if (!persona?.webhook_avatar_url) return null;
    return loadStoredPersonaAvatarBuffer(persona.webhook_avatar_url);
  }

  async listPersonalMemories(userId: number, lineageId: number): Promise<PersonalMemoryRow[]> {
    return personalMemoryRepository.loadForUserLineage(userId, lineageId, false);
  }

  async addPersonalMemory(
    userId: number,
    lineageId: number,
    content: string,
    tags: string[],
    userDiscordId: string,
  ): Promise<PersonalMemoryRow | null> {
    const created = await personalMemoryRepository.add(userId, lineageId, content, tags);
    if (created) invalidateUserCache(userDiscordId);
    return created;
  }

  async updatePersonalMemory(
    memoryId: number,
    userId: number,
    lineageId: number,
    content: string,
    tags: string[],
    userDiscordId: string,
  ): Promise<PersonalMemoryRow | null> {
    const updated = await personalMemoryRepository.updateOwned(memoryId, userId, lineageId, content, tags);
    if (updated) invalidateUserCache(userDiscordId);
    return updated;
  }

  async removePersonalMemory(
    memoryId: number,
    userId: number,
    lineageId: number,
    userDiscordId: string,
  ): Promise<boolean> {
    const removed = await personalMemoryRepository.removeOwned(memoryId, userId, lineageId);
    if (removed) invalidateUserCache(userDiscordId);
    return removed;
  }

  async listServerMemories(serverId: number, lineageId: number, taughtByUserId?: number): Promise<ServerMemoryRow[]> {
    return serverMemoryRepository.loadServerMemoriesScoped(serverId, lineageId, taughtByUserId);
  }

  async listServerMemoryContents(serverId: number, lineageId: number): Promise<string[]> {
    return serverMemoryRepository.loadServerMemoryContents(serverId, lineageId);
  }

  async addServerMemory(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    lineageId: number,
    taughtByUserId: number,
    content: string,
    tags: string[],
  ): Promise<ServerMemoryRow | null> {
    return serverMemoryRepository.add(
      snapshot.serverId,
      personaId,
      lineageId,
      taughtByUserId,
      content,
      tags,
      snapshot.serverDiscordId,
    );
  }

  async updateServerMemory(
    snapshot: DashboardGuildSnapshot,
    memoryId: number,
    lineageId: number,
    content: string,
    tags: string[],
    taughtByUserId?: number,
  ): Promise<ServerMemoryRow | null> {
    const updated = await serverMemoryRepository.updateScoped(
      memoryId,
      snapshot.serverId,
      lineageId,
      content,
      tags,
      taughtByUserId,
    );
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async removeServerMemory(
    snapshot: DashboardGuildSnapshot,
    memoryId: number,
    lineageId: number,
    taughtByUserId?: number,
  ): Promise<boolean> {
    const removed = await serverMemoryRepository.removeScoped(memoryId, snapshot.serverId, lineageId, taughtByUserId);
    if (removed) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return removed;
  }

  async updateSettings(
    snapshot: DashboardGuildSnapshot,
    sectionId: SettingsSectionId,
    patch: Record<string, unknown>,
  ): Promise<AssembledServerConfig | null> {
    const updated = await this.writeSettingsSection(snapshot.serverId, sectionId, patch);
    if (!updated) return null;

    invalidateTomoriStateCache(snapshot.serverDiscordId);
    return (await personaRepository.loadState(snapshot.serverDiscordId))?.config ?? null;
  }

  async updatePersonaIdentity(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    patch: PersonaIdentityPatch,
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    const updated = await personaRepository.renamePersona(personaId, patch.nickname);
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async hasPersonaNicknameConflict(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    nickname: string,
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return true;
    return personaRepository.hasNicknameConflict(snapshot.serverId, personaId, nickname);
  }

  async updatePersonaPrompt(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    patch: PersonaPromptPatch,
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    const updated = await personaRepository.setPersonaConfig(personaId, patch.triggerWords, patch.personaPrompt);
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async updatePersonaContext(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    patch: PersonaContextPatch,
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    const updated = await personaRepository.setContextNote(personaId, patch.contextNote, patch.contextNoteDepth);
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async updatePersonaAppearance(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    patch: PersonaAppearancePatch,
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    const updated = await personaRepository.setPhysicalAppearanceTags(personaId, patch.physicalAppearanceTags);
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async updatePersonaAttributes(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    attributes: string[],
    publicFlags: boolean[],
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    const updated = await personaRepository.replaceAttributes(personaId, attributes, publicFlags);
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async addPersonaSampleDialogue(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    input: string,
    output: string,
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    const updated = await personaRepository.addSampleDialoguePair(personaId, [input], [output]);
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async updatePersonaSampleDialogue(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    index: number,
    input: string,
    output: string,
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    const updated = await personaRepository.editSampleDialoguePairAt(personaId, index + 1, input, output);
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async removePersonaSampleDialogue(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    index: number,
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    const updated = await personaRepository.removeSampleDialoguePairAt(personaId, index + 1);
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async materializePersona(snapshot: DashboardGuildSnapshot, personaId: number): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    return personaRepository.materializeIfPointer(personaId);
  }

  async setPersonaAvatarReference(
    snapshot: DashboardGuildSnapshot,
    personaId: number,
    avatarUrl: string | null,
  ): Promise<boolean> {
    if (!this.hasPersona(snapshot, personaId)) return false;
    const updated = await personaRepository.setAvatar(personaId, avatarUrl);
    if (updated) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return updated;
  }

  async removePersona(snapshot: DashboardGuildSnapshot, personaId: number): Promise<boolean> {
    const persona = snapshot.rawPersonas.find((entry) => entry.persona_id === personaId);
    if (!persona?.is_alter) return false;
    const removed = await personaRepository.removePersona(personaId);
    if (removed) invalidateTomoriStateCache(snapshot.serverDiscordId);
    return removed;
  }

  private hasPersona(snapshot: DashboardGuildSnapshot, personaId: number): boolean {
    return snapshot.personas.some((persona) => persona.personaId === personaId);
  }

  private async writeSettingsSection(
    serverId: number,
    sectionId: SettingsSectionId,
    patch: Record<string, unknown>,
  ): Promise<boolean> {
    switch (sectionId) {
      case "modelBehavior":
        return configRepository.updateModelConfig(serverId, patch as Partial<ServerModelConfigRow>);
      case "chat":
        return configRepository.updateChatConfig(serverId, patch as Partial<ServerChatConfigRow>);
      case "sampling":
        return configRepository.updateChatConfig(serverId, patch as Partial<ServerChatConfigRow>);
      case "triggers":
        return configRepository.updateTriggerBehaviorConfig(serverId, patch as Partial<ServerTriggerBehaviorConfigRow>);
      case "capabilities":
        return configRepository.updateCapabilitiesConfig(serverId, patch as Partial<ServerCapabilitiesConfigRow>);
      case "memberPermissions":
        return configRepository.updateMemberPermissionsConfig(
          serverId,
          patch as Partial<ServerMemberPermissionsConfigRow>,
        );
      case "notices":
        return configRepository.updateNoticeEmbedsConfig(serverId, patch as Partial<ServerNoticeEmbedsConfigRow>);
      case "memory":
        return configRepository.updateMemoryConfig(serverId, patch as Partial<ServerMemoryConfigRow>);
      case "channelScope":
        return configRepository.updateChannelScopeConfig(serverId, patch as Partial<ServerChannelScopeConfigRow>);
      case "autochat":
        return configRepository.updateAutoTriggerConfig(serverId, patch as Partial<ServerAutoTriggerConfigRow>);
      case "speech":
        return configRepository.updateSpeechConfig(serverId, patch as Partial<ServerSpeechConfigRow>);
      case "novelai":
        return configRepository.updateNovelaiImagegenConfig(serverId, patch as Partial<ServerNovelaiImagegenConfigRow>);
      case "byok":
        return configRepository.updateByokConfig(serverId, patch as Partial<ServerByokConfigRow>);
      case "welcome":
        return configRepository.updateWelcomeConfig(
          serverId,
          patch as Partial<{
            welcome_channel_disc_id: string | null;
            welcome_prompt: string | null;
            welcome_persona_id: number | null;
          }>,
        );
      case "nsfw":
        return configRepository.updateNsfwConfig(serverId, patch as Partial<ServerNsfwConfigRow>);
    }
  }
}
