import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { TomoriDashboardCore } from "@/web/dashboard/core";
import { configModelOperations } from "@/utils/discord/interactions/configModelOperations";
import { personalConfigOperations } from "@/utils/discord/interactions/personalConfigOperations";
import { configPersonaOperations } from "@/utils/discord/interactions/configPersonaOperations";
import * as personalLoaders from "@/utils/discord/interactions/personalConfigLoaders";
import { providerPanelOperations } from "@/utils/provider/providerPanelOperations";
import {
  configRepository,
  personaRepository,
  llmModelRepo,
  llmOverrideRepo,
  llmProviderRepo,
} from "@/utils/db/repositories";
import * as savedProviders from "@/utils/provider/savedProviderConfig";
import * as providerActivation from "@/utils/provider/providerActivation";
import * as crypto from "@/utils/security/crypto";
import { customEndpointSchema, savedProviderConfigSchema, userSavedProviderConfigSchema } from "@/types/db/schema";
import { type DashboardProviderCore, DashboardProviderService } from "@/web/dashboard/providerService";
import type { DashboardActor, DashboardGuildSnapshot } from "@/web/dashboard/types";
import { createLlmRow, createPersona, createServerConfig } from "../../helpers/fixtures";

function createActor(): DashboardActor {
  return {
    discordId: "987654321098765432",
    canManage: false,
    user: {
      user_id: 7,
      user_disc_id: "987654321098765432",
      user_nickname: "Dashboard user",
      privacy_level: 0,
    },
  } as DashboardActor;
}

function createSnapshot(): DashboardGuildSnapshot {
  return {
    serverId: 42,
    serverDiscordId: "123456789012345678",
    config: createServerConfig({
      llm_id: 1,
      fallback_model_refs: [],
      user_byok_mode: true,
    }),
    personas: [],
    rawPersonas: [],
  };
}

describe("dashboard provider policy", () => {
  afterEach(() => mock.restore());

  it("loads and edits parameters for a specified saved server provider", async () => {
    const core = new TomoriDashboardCore();
    const row = savedProviderConfigSchema.parse({
      server_id: 42,
      provider: "openrouter",
      api_key: Buffer.from("encrypted"),
      llm_id: 11,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
      llm_top_p: 0.7,
    });
    spyOn(savedProviders, "loadSavedProvidersForCapability").mockResolvedValue([row]);
    expect(await core.loadServerProviderParameters(42)).toMatchObject([{ provider: "openrouter", top_p: 0.7 }]);
    const persona = createPersona({ server_id: 42 });
    spyOn(personaRepository, "loadState").mockResolvedValue(persona);
    const operation = spyOn(configModelOperations, "setProviderParameters").mockResolvedValue({ status: "success" });
    const service = new DashboardProviderService(core);
    await service.setServerParameters(createSnapshot(), { provider: "openrouter", patch: { top_p: null } });
    expect(operation).toHaveBeenCalledWith({
      tomoriState: persona,
      serverDiscId: createSnapshot().serverDiscordId,
      provider: "openrouter",
      patch: { top_p: null },
    });
    await expect(
      service.setServerParameters(createSnapshot(), { provider: "openrouter", patch: { top_p: 2 } }),
    ).rejects.toMatchObject({ code: "invalid_server_parameters" });
    operation.mockResolvedValue({ status: "not-found" });
    await expect(
      service.setServerParameters(createSnapshot(), { provider: "foreign", patch: { top_p: 0.5 } }),
    ).rejects.toMatchObject({ code: "server_parameters_unavailable" });
  });

  it("limits persona text overrides to server personas and eligible models and supports clearing", async () => {
    const core = new TomoriDashboardCore();
    const snapshot = createSnapshot();
    snapshot.personas = [{ personaId: 9 } as DashboardGuildSnapshot["personas"][number]];
    const provider = savedProviderConfigSchema.parse({
      server_id: 42,
      provider: "openrouter",
      api_key: Buffer.from("encrypted"),
      llm_id: 11,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    });
    spyOn(savedProviders, "loadSavedProvidersForCapability").mockResolvedValue([provider]);
    spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([
      createLlmRow({ llm_id: 11, llm_codename: "example", llm_provider: "openrouter" }),
      createLlmRow({ llm_id: 12, llm_codename: "other-model", llm_provider: "openrouter" }),
    ]);
    spyOn(llmOverrideRepo, "loadPersonaLlmOverridesForServer").mockResolvedValue([{ persona_id: 9, llm_id: 11 }]);
    const write = spyOn(configPersonaOperations, "setTextModelOverride").mockResolvedValue({ status: "success" });
    expect(await core.loadPersonaTextModelWorkspace(snapshot, 9)).toMatchObject({
      selected: 11,
      options: [{ id: 11, provider: "openrouter" }],
    });
    expect(await core.setPersonaTextModelOverride(snapshot, 9, 12)).toBe(false);
    expect(await core.setPersonaTextModelOverride(snapshot, 10, null)).toBe(false);
    expect(await core.setPersonaTextModelOverride(snapshot, 9, null)).toBe(true);
    expect(write).toHaveBeenCalledWith({
      scope: "persona",
      personaId: 9,
      llmId: null,
      serverDiscId: snapshot.serverDiscordId,
    });
    expect(await core.setPersonaTextModelOverride(snapshot, 9, 11)).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("lists personal speech choices and selects them through the shared operation", async () => {
    const row = userSavedProviderConfigSchema.parse({
      user_id: 7,
      provider: "openrouter",
      api_key: Buffer.from("encrypted"),
      llm_id: null,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
      speech_design_model_id: 91,
      assigned_capabilities: ["speech_design"],
      enabled_capabilities: ["speech_design"],
    });
    spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockResolvedValue([row]);
    spyOn(savedProviders, "loadUserSavedProvidersForCapability").mockImplementation(async (_id, cap) =>
      cap === "speech_design" ? [row] : [],
    );
    spyOn(personalLoaders, "loadAvailableModelsForCapability").mockResolvedValue([{ id: 91, name: "Voice" }]);
    const core = new TomoriDashboardCore();
    const workspace = await core.loadPersonalModelWorkspace(7);
    expect(workspace.speech_design).toMatchObject({
      enabled: true,
      selected: { provider: "openrouter", id: 91 },
      options: [{ provider: "openrouter", id: 91 }],
    });
    const operation = spyOn(personalConfigOperations, "setCapabilityModel").mockResolvedValue({ status: "success" });
    await new DashboardProviderService(core).setPersonalModel(createActor(), {
      capability: "speech_clone",
      provider: "openrouter",
      modelId: 92,
    });
    expect(operation).toHaveBeenCalledWith({
      userId: 7,
      userDiscId: createActor().discordId,
      capability: "speech_clone",
      provider: "openrouter",
      modelId: 92,
    });
  });

  it("routes bounded personal parameter edits to the owning provider", async () => {
    const core = new TomoriDashboardCore();
    const operation = spyOn(personalConfigOperations, "setParameters").mockResolvedValue({ status: "success" });
    const service = new DashboardProviderService(core);
    const patch = { temperature: null, top_k: 256, thinking_level: "high" };
    await service.setPersonalParameters(createActor(), { provider: "openrouter", patch });
    expect(operation).toHaveBeenCalledWith({
      userId: 7,
      userDiscId: createActor().discordId,
      provider: "openrouter",
      patch,
    });
    for (const invalid of [{ top_k: 257 }, { max_output_tokens: 0 }, { thinking_level: null }, {}]) {
      await expect(
        service.setPersonalParameters(createActor(), { provider: "openrouter", patch: invalid }),
      ).rejects.toMatchObject({ code: "invalid_personal_parameters" });
    }
    operation.mockResolvedValue({ status: "not-found" });
    await expect(
      service.setPersonalParameters(createActor(), { provider: "other", patch: { top_p: 0.5 } }),
    ).rejects.toMatchObject({ code: "personal_parameters_unavailable" });
  });

  it("loads personal choices and preserves a disabled stored selection", async () => {
    const row = userSavedProviderConfigSchema.parse({
      user_id: 7,
      provider: "openrouter",
      api_key: Buffer.from("encrypted"),
      llm_id: 11,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
      assigned_capabilities: ["text"],
      enabled_capabilities: [],
    });
    spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockResolvedValue([row]);
    spyOn(savedProviders, "loadUserSavedProvidersForCapability").mockImplementation(async (_userId, capability) =>
      capability === "text" ? [row] : [],
    );
    spyOn(personalLoaders, "loadAvailableModelsForCapability").mockResolvedValue([
      { id: 11, name: "Example" },
      { id: 12, name: "Second" },
    ]);
    const models = await new TomoriDashboardCore().loadPersonalModelWorkspace(7);
    expect(models.text).toMatchObject({
      selected: { id: 11, provider: "openrouter" },
      enabled: false,
      options: [
        { id: 11, provider: "openrouter" },
        { id: 12, provider: "openrouter" },
      ],
    });
    expect(models.image_nai).toMatchObject({ selected: null, enabled: false, options: [] });
  });

  it("delegates personal model selection and rejects invalid or unavailable choices", async () => {
    const core = new TomoriDashboardCore();
    const operation = spyOn(personalConfigOperations, "setCapabilityModel").mockResolvedValue({ status: "success" });
    const service = new DashboardProviderService(core);
    await service.setPersonalModel(createActor(), { capability: "text", provider: "openrouter", modelId: 11 });
    expect(operation).toHaveBeenCalledWith({
      userId: 7,
      userDiscId: createActor().discordId,
      capability: "text",
      provider: "openrouter",
      modelId: 11,
    });
    await expect(
      service.setPersonalModel(createActor(), { capability: "text", provider: "openrouter", modelId: 0 }),
    ).rejects.toMatchObject({ code: "invalid_personal_model" });
    operation.mockResolvedValue({ status: "write-failed" });
    await expect(
      service.setPersonalModel(createActor(), { capability: "image_nai", provider: "novelai", modelId: 12 }),
    ).rejects.toMatchObject({ code: "personal_model_unavailable" });
  });

  it("refreshes an active provider's credential without switching an inactive provider", async () => {
    const core = new TomoriDashboardCore();
    const persona = createPersona({ server_id: 42 });
    const activeProvider = persona.llm.llm_provider;
    const encrypted = Buffer.from("encrypted");
    const config = savedProviderConfigSchema.parse({
      server_id: 42,
      provider: activeProvider,
      api_key: encrypted,
      llm_id: persona.llm.llm_id,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    });
    spyOn(crypto, "encryptApiKey").mockResolvedValue({ encrypted, version: 1 });
    spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(config);
    spyOn(savedProviders, "buildSavedProviderConfigFromExistingOrDefaults").mockImplementation(
      async ({ provider }) => ({ ...config, provider }),
    );
    spyOn(llmProviderRepo, "upsertSavedProviderConfig").mockResolvedValue(true);
    spyOn(personaRepository, "loadState").mockResolvedValue(persona);
    const activate = spyOn(providerActivation, "activateServerTextModelFromSavedConfig").mockResolvedValue({
      status: "activated",
    });
    expect(await core.saveServerProviderCredential(createSnapshot(), activeProvider, "new credential", false)).toBe(
      true,
    );
    expect(activate).toHaveBeenCalledWith({
      serverDiscId: createSnapshot().serverDiscordId,
      tomoriState: persona,
      savedConfig: config,
    });
    expect(
      await core.saveServerProviderCredential(createSnapshot(), "inactive-provider", "new credential", false),
    ).toBe(true);
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it("keeps NovelAI image capability separate in the workspace and activation API", async () => {
    const setCapability = mock(async () => true);
    const core = {
      getProviderChoices: () => [],
      getProviderDisplayName: () => "NovelAI",
      loadPersonalProviderConfigs: async () => [
        {
          provider: "novelai",
          api_key: null,
          enabled_capabilities: ["image_nai"],
          llm_id: null,
          vision_llm_id: null,
          embedding_model_id: null,
          diffusion_model_id: null,
          nai_diffusion_model_id: 12,
          video_model_id: null,
        },
      ],
      loadPersonalCustomEndpoints: async () => [
        customEndpointSchema.parse({
          connection_id: 6,
          custom_endpoint_id: 9,
          user_id: 7,
          label: "local",
          capability: "text",
          api_style: "openai-compatible",
          endpoint_url: "https://example.com/v1",
          model_ref_id: 11,
        }),
      ],
      loadPersonalOpenRouterModels: async () => [],
      loadPersonalFallbackWorkspace: async () => ({ fallbackOptions: [], fallbackRefs: [], randomizerEnabled: false }),
      loadPersonalModelWorkspace: async () => ({}),
      loadPersonalProviderParameters: async () => [],
      setPersonalProviderCapability: setCapability,
    };
    const service = new DashboardProviderService(core as unknown as DashboardProviderCore);
    const workspace = await service.loadPersonalWorkspace(createActor(), createSnapshot());
    expect(workspace.providers[0]?.configuredCapabilities).toMatchObject({ image: false, image_nai: true });
    expect(workspace.endpoints[0]?.provider).toBe("custom:6");
    expect(workspace.providers[0]?.enabledCapabilities).toContain("image_nai");
    await service.setPersonalCapability(createActor(), "novelai", { capability: "image_nai", enabled: true });
    expect(setCapability).toHaveBeenCalledWith(7, createActor().discordId, "novelai", "image_nai", true);
  });

  it("routes sampling changes through the active provider operation", async () => {
    const core = new TomoriDashboardCore();
    const persona = createPersona({ server_id: 42 });
    spyOn(personaRepository, "loadState").mockResolvedValue(persona);
    spyOn(core, "loadStmSettings").mockResolvedValue({} as Awaited<ReturnType<typeof core.loadStmSettings>>);
    const write = spyOn(configModelOperations, "setProviderParameters").mockResolvedValue({ status: "success" });
    const chat = spyOn(configRepository, "updateChatConfig").mockResolvedValue(true);
    expect(
      await core.updateSettings(createSnapshot(), "sampling", { llm_top_p: 0.7, llm_stop_strings: ["stop"] }),
    ).not.toBeNull();
    expect(write).toHaveBeenCalledWith({
      tomoriState: persona,
      serverDiscId: createSnapshot().serverDiscordId,
      provider: persona.llm.llm_provider,
      patch: { top_p: 0.7 },
    });
    expect(chat).toHaveBeenCalledWith(42, { llm_top_p: 0.7, llm_stop_strings: ["stop"] });
  });

  it("applies only a preset belonging to the active NovelAI model", async () => {
    const core = new TomoriDashboardCore();
    const persona = createPersona({ server_id: 42 });
    persona.llm = { ...persona.llm, llm_provider: "novelai", llm_codename: "kayra-v1" };
    spyOn(personaRepository, "loadState").mockResolvedValue(persona);
    spyOn(core, "loadStmSettings").mockResolvedValue({} as Awaited<ReturnType<typeof core.loadStmSettings>>);
    const preset = {
      nai_preset_id: 1,
      preset_name: "Example",
      model_target: "kayra",
      is_default: false,
      preset_desc: "",
      parameters: {},
    };
    spyOn(configRepository, "loadNaiPresets").mockResolvedValue([preset]);
    const apply = spyOn(configModelOperations, "applyNaiPreset").mockResolvedValue({ status: "success" });
    expect(await core.updateSettings(createSnapshot(), "novelai", { nai_preset_name: "Example" })).not.toBeNull();
    expect(apply).toHaveBeenCalledWith({
      tomoriState: persona,
      serverDiscId: createSnapshot().serverDiscordId,
      preset,
    });
    expect(await core.updateSettings(createSnapshot(), "novelai", { nai_preset_name: "Missing" })).toBeNull();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("saves NovelAI image settings without reapplying an unchanged text preset", async () => {
    const core = new TomoriDashboardCore();
    const persona = createPersona({ server_id: 42 });
    persona.config.nai_preset_name = "Example";
    spyOn(personaRepository, "loadState").mockResolvedValue(persona);
    spyOn(core, "loadStmSettings").mockResolvedValue({} as Awaited<ReturnType<typeof core.loadStmSettings>>);
    const apply = spyOn(configModelOperations, "applyNaiPreset");
    const write = spyOn(configRepository, "updateNovelaiImagegenConfig").mockResolvedValue(true);
    for (const provider of ["gemini", "novelai"]) {
      persona.llm = { ...persona.llm, llm_provider: provider, llm_codename: "kayra-v1" };
      expect(
        await core.updateSettings(createSnapshot(), "novelai", { nai_preset_name: "Example", nai_steps: 25 }),
      ).not.toBeNull();
    }
    expect(apply).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledWith(42, { nai_steps: 25 });
  });

  it("prunes the selected personal text model from fallbacks", async () => {
    const core = new TomoriDashboardCore();
    const row = userSavedProviderConfigSchema.parse({
      user_id: 7,
      provider: "openrouter",
      llm_id: 11,
      api_key: Buffer.from("encrypted"),
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    });
    spyOn(llmProviderRepo, "loadUserSavedProviderConfig").mockResolvedValue(row);
    spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockResolvedValue([row]);
    spyOn(llmProviderRepo, "upsertUserSavedProviderConfig").mockResolvedValue(true);
    spyOn(llmProviderRepo, "loadCustomEndpointsForUser").mockResolvedValue([]);
    spyOn(llmProviderRepo, "loadPersonalFallbackSettings").mockResolvedValue({
      fallback_model_refs: [
        { type: "llm", id: 11 },
        { type: "llm", id: 12 },
      ],
      model_randomizer_enabled: false,
    });
    const write = spyOn(llmProviderRepo, "updatePersonalFallbackModelRefs").mockResolvedValue(true);
    expect(await core.setPersonalProviderCapability(7, createActor().discordId, "openrouter", "text", true)).toBe(true);
    expect(write).toHaveBeenCalledWith(7, [{ type: "llm", id: 12 }]);
  });

  it("uses the Discord model operation with a fresh state when switching a server model", async () => {
    const core = new TomoriDashboardCore();
    const persona = createPersona({ server_id: 42 });
    spyOn(personaRepository, "loadState").mockResolvedValue(persona);
    spyOn(core, "loadServerModelWorkspace").mockResolvedValue({
      options: {
        text: [],
        vision: [],
        embedding: [{ id: 21, label: "Embedding", provider: "openrouter" }],
        image: [],
        imageNai: [],
        video: [],
      },
      selected: { text: 1, vision: null, embedding: 20, image: null, imageNai: null, video: null },
    });
    const write = spyOn(configModelOperations, "setCapabilityModel").mockResolvedValue({
      status: "success",
      modelName: "embedding",
      reembedded: true,
    });
    expect(await core.setServerPrimaryModel(createSnapshot(), "embedding", 21)).toBe(true);
    expect(write).toHaveBeenCalledWith({
      tomoriState: persona,
      serverDiscId: createSnapshot().serverDiscordId,
      capability: "embedding",
      provider: "openrouter",
      modelId: 21,
    });
    expect(await core.setServerPrimaryModel(createSnapshot(), "embedding", 999)).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not report an active endpoint connection as removed", async () => {
    const core = new TomoriDashboardCore();
    const persona = createPersona({ server_id: 42 });
    const entry = { kind: "endpoint" as const, id: "endpoint:6", connectionIds: [6], displayName: "Local" };
    const panel = { state: persona, data: { entries: [entry] } } as unknown as NonNullable<
      Awaited<ReturnType<typeof providerPanelOperations.loadServerProviderPanelScope>>
    >;
    spyOn(providerPanelOperations, "loadServerProviderPanelScope").mockResolvedValue(panel);
    const remove = spyOn(providerPanelOperations, "removeServerProviderEntry").mockResolvedValue({ status: "active" });
    await expect(
      core.removeDashboardCustomEndpoint(
        { kind: "server", snapshot: createSnapshot() },
        { custom_endpoint_id: 9, connection_id: 6 },
      ),
    ).rejects.toMatchObject({ code: "provider_active", status: 409 });
    expect(remove).toHaveBeenCalledWith({ ...panel, serverDiscId: createSnapshot().serverDiscordId, entry });
  });
  it("never serializes encrypted provider credentials", async () => {
    const core = {
      getProviderChoices: () => [{ name: "OpenRouter", value: "openrouter" }],
      getProviderDisplayName: () => "OpenRouter",
      loadPersonalProviderConfigs: mock(async () => [
        {
          provider: "openrouter",
          api_key: Buffer.from("encrypted-secret"),
          enabled_capabilities: ["text"],
          llm_id: 11,
          vision_llm_id: null,
          embedding_model_id: null,
          diffusion_model_id: null,
          nai_diffusion_model_id: null,
          video_model_id: null,
        },
      ]),
      loadPersonalCustomEndpoints: mock(async () => []),
      loadPersonalOpenRouterModels: mock(async () => []),
      loadPersonalFallbackWorkspace: mock(async () => ({
        fallbackOptions: [],
        fallbackRefs: [],
        randomizerEnabled: false,
      })),
      loadPersonalModelWorkspace: mock(async () => ({})),
      loadPersonalProviderParameters: mock(async () => []),
    };
    const service = new DashboardProviderService(core as unknown as DashboardProviderCore);

    const workspace = await service.loadPersonalWorkspace(createActor(), createSnapshot());

    expect(workspace.providers[0]?.hasApiKey).toBe(true);
    expect(JSON.stringify(workspace)).not.toContain("encrypted-secret");
    expect(core.loadPersonalProviderConfigs).toHaveBeenCalledWith(7);
  });

  it("does not register a custom endpoint that fails the shared reachability check", async () => {
    const core = {
      validateCustomEndpoint: mock(async () => ({ ok: false as const, reason: "REMOTE_HTTP_FORBIDDEN" })),
      registerDashboardCustomEndpoint: mock(async () => null),
    };
    const service = new DashboardProviderService(core as unknown as DashboardProviderCore);

    await expect(
      service.registerEndpoint("personal", createActor(), createSnapshot(), {
        label: "comfy",
        capability: "image",
        apiStyle: "comfyui",
        endpointUrl: "http://127.0.0.1:8188",
        modelName: null,
        authToken: null,
        numCtx: null,
        hasTools: false,
        seesImages: false,
        seesVideos: false,
        supportsStructOutput: false,
        strictRoleAlternation: false,
        supportsPrefixCompletion: false,
      }),
    ).rejects.toMatchObject({
      code: "endpoint_unreachable",
      status: 422,
    });
    expect(core.registerDashboardCustomEndpoint).not.toHaveBeenCalled();
  });

  it("accepts only unique scoped fallback models and rejects the primary model", async () => {
    const core = {
      loadServerFallbackOptions: mock(async () => [
        { ref: { type: "llm" as const, id: 1 }, label: "Primary" },
        { ref: { type: "llm" as const, id: 2 }, label: "Fallback" },
        { ref: { type: "custom_endpoint" as const, id: 3 }, label: "Endpoint" },
      ]),
      setServerFallbacks: mock(async () => true),
    };
    const service = new DashboardProviderService(core as unknown as DashboardProviderCore);
    const snapshot = createSnapshot();

    await expect(service.setFallbacks(snapshot, { refs: [{ type: "llm", id: 1 }] })).rejects.toMatchObject({
      code: "invalid_fallbacks",
    });
    await expect(
      service.setFallbacks(snapshot, {
        refs: [
          { type: "llm", id: 2 },
          { type: "llm", id: 2 },
        ],
      }),
    ).rejects.toMatchObject({ code: "invalid_fallbacks" });

    await expect(
      service.setFallbacks(snapshot, {
        refs: [
          { type: "llm", id: 2 },
          { type: "custom_endpoint", id: 3 },
        ],
      }),
    ).resolves.toEqual([
      { type: "llm", id: 2 },
      { type: "custom_endpoint", id: 3 },
    ]);
    expect(core.setServerFallbacks).toHaveBeenCalledTimes(1);
  });

  it("loads personal fallback choices from eligible owned providers and excludes primary aliases", async () => {
    const core = new TomoriDashboardCore();
    const provider = userSavedProviderConfigSchema.parse({
      user_id: 7,
      provider: "openrouter",
      api_key: Buffer.from("encrypted"),
      llm_id: 11,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
      assigned_capabilities: [],
      enabled_capabilities: [],
    });
    const custom = {
      ...provider,
      provider: "custom:6",
      llm_id: 31,
      assigned_capabilities: ["text" as const],
      enabled_capabilities: ["text" as const],
    };
    spyOn(savedProviders, "loadUserSavedProvidersForCapability").mockResolvedValue([provider, custom]);
    spyOn(llmProviderRepo, "loadUserSavedProviderConfigs").mockResolvedValue([provider, custom]);
    const endpoint = customEndpointSchema.parse({
      connection_id: 6,
      custom_endpoint_id: 21,
      user_id: 7,
      label: "local",
      capability: "text",
      api_style: "openai-compatible",
      endpoint_url: "https://example.com/v1",
      model_ref_id: 31,
    });
    spyOn(llmProviderRepo, "loadCustomEndpointsForUser").mockResolvedValue([
      endpoint,
      { ...endpoint, custom_endpoint_id: 22, model_ref_id: 32 },
      { ...endpoint, custom_endpoint_id: 23, model_ref_id: 33, capability: "image" },
      { ...endpoint, connection_id: 8, custom_endpoint_id: 24, model_ref_id: 34 },
    ]);
    const refs = [
      { type: "llm" as const, id: 12 },
      { type: "custom_endpoint" as const, id: 22 },
    ];
    spyOn(llmProviderRepo, "loadPersonalFallbackSettings").mockResolvedValue({
      fallback_model_refs: refs,
      model_randomizer_enabled: true,
    });
    const models = spyOn(llmModelRepo, "loadAvailableModelsForProvider").mockResolvedValue([
      createLlmRow({ llm_id: 12, llm_codename: "sample/backup", llm_provider: "openrouter" }),
      createLlmRow({ llm_id: 13, llm_codename: "other-model", llm_provider: "openrouter" }),
    ]);
    const workspace = await core.loadPersonalFallbackWorkspace(7);
    expect(workspace.fallbackOptions.map((option) => option.ref)).toEqual(refs);
    expect(workspace.fallbackRefs).toEqual(refs);
    expect(workspace.randomizerEnabled).toBe(true);
    expect(models).toHaveBeenCalledWith("openrouter", false, { kind: "personal", ownerId: 7 });
    expect(models).toHaveBeenCalledTimes(1);
  });

  it("saves an ordered personal chain without writing server settings and allows clearing it", async () => {
    const refs = [
      { type: "custom_endpoint" as const, id: 3 },
      { type: "llm" as const, id: 2 },
    ];
    const core = {
      loadPersonalFallbackWorkspace: mock(async () => ({
        fallbackOptions: refs.map((ref) => ({ ref, label: String(ref.id) })),
        fallbackRefs: [],
        randomizerEnabled: false,
      })),
      setPersonalFallbacks: mock(async () => true),
      setServerFallbacks: mock(async () => true),
    };
    const service = new DashboardProviderService(core as unknown as DashboardProviderCore);
    const actor = createActor();
    expect(await service.setPersonalFallbacks(actor, { refs })).toEqual(refs);
    expect(core.loadPersonalFallbackWorkspace).toHaveBeenCalledWith(actor.user.user_id);
    expect(core.setPersonalFallbacks).toHaveBeenCalledWith(actor.user.user_id, actor.discordId, refs);
    expect(await service.setPersonalFallbacks(actor, { refs: [] })).toEqual([]);
    expect(core.setServerFallbacks).not.toHaveBeenCalled();

    core.setPersonalFallbacks.mockResolvedValue(false);
    await expect(service.setPersonalFallbacks(actor, { refs })).rejects.toMatchObject({ code: "fallback_save_failed" });
  });

  it("rejects foreign, primary, duplicate and malformed personal fallback refs before writing", async () => {
    const ref = { type: "llm" as const, id: 2 };
    const core = {
      loadPersonalFallbackWorkspace: mock(async () => ({
        fallbackOptions: [{ ref, label: "Backup" }],
        fallbackRefs: [],
        randomizerEnabled: false,
      })),
      setPersonalFallbacks: mock(async () => true),
    };
    const service = new DashboardProviderService(core as unknown as DashboardProviderCore);
    for (const value of [
      { refs: [{ type: "llm", id: 1 }] },
      { refs: [{ type: "custom_endpoint", id: 99 }] },
      { refs: [ref, ref] },
      { refs: Array.from({ length: 6 }, (_, i) => ({ type: "llm", id: i + 2 })) },
      { refs: [{ type: "llm", id: -1 }] },
      { refs: [ref], userId: 99 },
    ]) {
      await expect(service.setPersonalFallbacks(createActor(), value)).rejects.toMatchObject({
        code: "invalid_fallbacks",
      });
    }
    expect(core.setPersonalFallbacks).not.toHaveBeenCalled();
  });

  it("saves only available server models and preserves non-clearable capabilities", async () => {
    const core = {
      loadServerModelWorkspace: mock(async () => ({
        options: {
          text: [{ id: 11, label: "OpenRouter / text", provider: "openrouter" }],
          vision: [{ id: 12, label: "OpenRouter / vision", provider: "openrouter" }],
          embedding: [{ id: 21, label: "OpenRouter / embedding", provider: "openrouter" }],
          image: [],
          imageNai: [],
          video: [],
        },
        selected: {
          text: 1,
          vision: null,
          embedding: 21,
          image: null,
          imageNai: null,
          video: null,
        },
      })),
      setServerPrimaryModel: mock(async () => true),
    };
    const service = new DashboardProviderService(core as unknown as DashboardProviderCore);
    const value = {
      text: 11,
      vision: 12,
      embedding: 21,
      image: null,
      imageNai: null,
      video: null,
    };

    await expect(service.setServerModels(createSnapshot(), value)).resolves.toEqual(value);
    expect(core.setServerPrimaryModel).toHaveBeenCalledTimes(2);
    expect(core.setServerPrimaryModel).toHaveBeenCalledWith(createSnapshot(), "text", 11);
    expect(core.setServerPrimaryModel).toHaveBeenCalledWith(createSnapshot(), "vision", 12);

    await expect(service.setServerModels(createSnapshot(), { ...value, text: 999 })).rejects.toMatchObject({
      code: "invalid_server_models",
    });
    await expect(service.setServerModels(createSnapshot(), { ...value, embedding: null })).rejects.toMatchObject({
      code: "invalid_server_models",
    });
  });
});
