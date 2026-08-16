import { describe, expect, it, mock } from "bun:test";
import { type DashboardProviderCore, DashboardProviderService } from "@/web/dashboard/providerService";
import type { DashboardActor, DashboardGuildSnapshot } from "@/web/dashboard/types";

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
    config: {
      llm_id: 1,
      fallback_model_refs: [],
      user_byok_mode: true,
    },
    personas: [],
    rawPersonas: [],
  } as DashboardGuildSnapshot;
}

describe("dashboard provider policy", () => {
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
        displayName: "Local ComfyUI",
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
