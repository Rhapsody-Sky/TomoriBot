import type {
  CustomEndpointApiStyle,
  CustomEndpointCapability,
  FallbackModelRef,
  PersonalProviderCapability,
} from "@/types/db/schema";
import { z } from "zod";
import type {
  DashboardCustomEndpointInput,
  DashboardProviderScope,
  DashboardServerModelKind,
  TomoriDashboardCore,
} from "./core";
import { DashboardServiceError } from "./errors";
import type { DashboardActor, DashboardGuildSnapshot } from "./types";

const providerNameSchema = z.string().trim().toLowerCase().min(1).max(120);
const capabilitySchema = z.enum(["text", "embedding", "image", "video", "vision"]);
const openRouterCapabilitySchema = z.enum(["text", "embedding", "image", "video"]);

const providerCredentialSchema = z
  .object({
    provider: providerNameSchema,
    apiKey: z.string().trim().min(10).max(4_000),
    validateApiKey: z.boolean().default(true),
  })
  .strict();

const providerCapabilitySchema = z
  .object({
    capability: capabilitySchema,
    enabled: z.boolean(),
  })
  .strict();

const customEndpointSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1)
      .max(48)
      .regex(/^[a-zA-Z0-9_-]+$/),
    capability: z.enum(["text", "embedding", "image", "video", "speech", "transcription"]),
    apiStyle: z.enum([
      "openai-compatible",
      "comfyui",
      "ollama-native",
      "elevenlabs",
      "elevenlabs-transcription",
      "tts-clone",
      "openai-compatible-transcription",
    ]),
    endpointUrl: z.string().trim().url().max(2_048),
    displayName: z.string().trim().min(1).max(120),
    modelName: z.string().trim().max(180).nullable().default(null),
    authToken: z.string().trim().max(4_000).nullable().default(null),
    numCtx: z.number().int().min(512).max(2_000_000).nullable().default(null),
    hasTools: z.boolean().default(false),
    seesImages: z.boolean().default(false),
    seesVideos: z.boolean().default(false),
    supportsStructOutput: z.boolean().default(false),
    strictRoleAlternation: z.boolean().default(false),
    supportsPrefixCompletion: z.boolean().default(false),
  })
  .strict();

const openRouterSchema = z
  .object({
    capability: openRouterCapabilitySchema,
    modelName: z.string().trim().min(1).max(240),
  })
  .strict();

const fallbackSchema = z
  .object({
    refs: z
      .array(
        z
          .object({
            type: z.enum(["llm", "custom_endpoint"]),
            id: z.number().int().positive(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

const serverModelsSchema = z
  .object({
    text: z.number().int().positive(),
    vision: z.number().int().positive().nullable(),
    embedding: z.number().int().positive().nullable(),
    image: z.number().int().positive().nullable(),
    imageNai: z.number().int().positive().nullable(),
    video: z.number().int().positive().nullable(),
  })
  .strict();

function serializeProvider(
  row: {
    provider: string;
    api_key: Buffer | null;
    enabled_capabilities?: PersonalProviderCapability[];
    llm_id: number | null;
    vision_llm_id?: number | null;
    embedding_model_id: number | null;
    diffusion_model_id: number | null;
    nai_diffusion_model_id: number | null;
    video_model_id?: number | null;
  },
  displayName: string,
) {
  return {
    provider: row.provider,
    displayName,
    hasApiKey: Boolean(row.api_key),
    enabledCapabilities: row.enabled_capabilities ?? [],
    configuredCapabilities: {
      text: row.llm_id !== null,
      vision: row.vision_llm_id !== null && row.vision_llm_id !== undefined,
      embedding: row.embedding_model_id !== null,
      image: row.diffusion_model_id !== null || row.nai_diffusion_model_id !== null,
      video: row.video_model_id !== null && row.video_model_id !== undefined,
    },
  };
}

function serializeEndpoint(row: {
  custom_endpoint_id?: number;
  label: string;
  capability: CustomEndpointCapability;
  api_style: CustomEndpointApiStyle;
  endpoint_url: string;
  model_name?: string | null;
  model_ref_id?: number | null;
  display_name: string;
  num_ctx?: number | null;
  requires_auth: boolean;
  has_tools: boolean;
  sees_images: boolean;
  sees_videos: boolean;
  supports_structoutput: boolean;
}) {
  return {
    id: row.custom_endpoint_id ?? 0,
    label: row.label,
    capability: row.capability,
    apiStyle: row.api_style,
    endpointUrl: row.endpoint_url,
    modelName: row.model_name ?? null,
    modelRefId: row.model_ref_id ?? null,
    displayName: row.display_name,
    numCtx: row.num_ctx ?? null,
    requiresAuth: row.requires_auth,
    hasTools: row.has_tools,
    seesImages: row.sees_images,
    seesVideos: row.sees_videos,
    supportsStructOutput: row.supports_structoutput,
  };
}

export type DashboardProviderCore = Pick<
  TomoriDashboardCore,
  | "getProviderChoices"
  | "getProviderDisplayName"
  | "loadServerProviderConfigs"
  | "loadPersonalProviderConfigs"
  | "loadServerCustomEndpoints"
  | "loadPersonalCustomEndpoints"
  | "loadServerOpenRouterModels"
  | "loadPersonalOpenRouterModels"
  | "saveServerProviderCredential"
  | "savePersonalProviderCredential"
  | "setPersonalProviderCapability"
  | "removePersonalProvider"
  | "validateCustomEndpoint"
  | "registerDashboardCustomEndpoint"
  | "removeDashboardCustomEndpoint"
  | "registerDashboardOpenRouterModel"
  | "removeDashboardOpenRouterModel"
  | "loadServerFallbackOptions"
  | "setServerFallbacks"
  | "loadServerModelWorkspace"
  | "setServerPrimaryModel"
>;

export class DashboardProviderService {
  constructor(private readonly core: DashboardProviderCore) {}

  async loadPersonalWorkspace(actor: DashboardActor, snapshot: DashboardGuildSnapshot) {
    const [providers, endpoints, openRouterModels] = await Promise.all([
      this.core.loadPersonalProviderConfigs(actor.user.user_id),
      this.core.loadPersonalCustomEndpoints(actor.user.user_id),
      this.core.loadPersonalOpenRouterModels(actor.user.user_id),
    ]);
    return {
      choices: this.core.getProviderChoices(),
      providers: providers.map((row) => serializeProvider(row, this.core.getProviderDisplayName(row.provider))),
      endpoints: endpoints.map(serializeEndpoint),
      openRouterModels,
      byokRequired: snapshot.config.user_byok_mode === true,
    };
  }

  async loadServerWorkspace(snapshot: DashboardGuildSnapshot) {
    const [providers, endpoints, openRouterModels, fallbackOptions, models] = await Promise.all([
      this.core.loadServerProviderConfigs(snapshot.serverId),
      this.core.loadServerCustomEndpoints(snapshot.serverId),
      this.core.loadServerOpenRouterModels(snapshot.serverId),
      this.core.loadServerFallbackOptions(snapshot),
      this.core.loadServerModelWorkspace(snapshot),
    ]);
    return {
      choices: this.core.getProviderChoices(),
      providers: providers.map((row) => serializeProvider(row, this.core.getProviderDisplayName(row.provider))),
      endpoints: endpoints.map(serializeEndpoint),
      openRouterModels,
      fallbackOptions,
      fallbackRefs: snapshot.config.fallback_model_refs ?? [],
      primaryModelId: snapshot.config.llm_id,
      models,
    };
  }

  async saveCredential(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    value: unknown,
  ): Promise<void> {
    const parsed = providerCredentialSchema.safeParse(value);
    if (!parsed.success || !this.core.getProviderChoices().some((choice) => choice.value === parsed.data.provider)) {
      throw new DashboardServiceError("invalid_provider", 422, "The provider credential is invalid.");
    }
    const saved =
      scope === "server"
        ? await this.core.saveServerProviderCredential(
            snapshot,
            parsed.data.provider,
            parsed.data.apiKey,
            parsed.data.validateApiKey,
          )
        : await this.core.savePersonalProviderCredential(
            snapshot,
            actor.user.user_id,
            actor.discordId,
            parsed.data.provider,
            parsed.data.apiKey,
            parsed.data.validateApiKey,
          );
    if (!saved) {
      throw new DashboardServiceError(
        "provider_save_failed",
        422,
        "The key could not be validated or the provider could not be saved.",
      );
    }
  }

  async setPersonalCapability(actor: DashboardActor, provider: string, value: unknown): Promise<void> {
    const parsed = providerCapabilitySchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_provider_capability", 422, "The provider capability is invalid.");
    }
    const saved = await this.core.setPersonalProviderCapability(
      actor.user.user_id,
      actor.discordId,
      provider,
      parsed.data.capability,
      parsed.data.enabled,
    );
    if (!saved) {
      throw new DashboardServiceError(
        "provider_capability_unavailable",
        409,
        "This provider has no configured model for that capability.",
      );
    }
  }

  async removePersonalProvider(actor: DashboardActor, provider: string): Promise<void> {
    if (!(await this.core.removePersonalProvider(actor.user.user_id, actor.discordId, provider))) {
      throw new DashboardServiceError("provider_not_found", 404, "The provider was not found.");
    }
  }

  async registerEndpoint(
    scopeKind: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    value: unknown,
  ) {
    const parsed = customEndpointSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_endpoint", 422, "The custom endpoint settings are invalid.");
    }
    const input = parsed.data as DashboardCustomEndpointInput;
    const reachability = await this.core.validateCustomEndpoint(input);
    if (!reachability.ok) {
      throw new DashboardServiceError(
        "endpoint_unreachable",
        422,
        `TomoriBot could not reach this endpoint: ${reachability.reason}`,
      );
    }
    const result = await this.core.registerDashboardCustomEndpoint(this.scope(scopeKind, actor, snapshot), input);
    if (!result) throw new DashboardServiceError("endpoint_save_failed", 500, "The endpoint was not saved.");
    return serializeEndpoint(result.customEndpoint);
  }

  async removeEndpoint(
    scopeKind: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    endpointId: number,
  ): Promise<void> {
    const endpoints =
      scopeKind === "server"
        ? await this.core.loadServerCustomEndpoints(snapshot.serverId)
        : await this.core.loadPersonalCustomEndpoints(actor.user.user_id);
    const endpoint = endpoints.find((entry) => entry.custom_endpoint_id === endpointId);
    if (!endpoint) throw new DashboardServiceError("endpoint_not_found", 404, "The endpoint was not found.");
    if (!(await this.core.removeDashboardCustomEndpoint(this.scope(scopeKind, actor, snapshot), endpoint))) {
      throw new DashboardServiceError("endpoint_delete_failed", 500, "The endpoint was not removed.");
    }
  }

  async registerOpenRouter(
    scopeKind: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    value: unknown,
  ) {
    const parsed = openRouterSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_openrouter_model", 422, "The OpenRouter model is invalid.");
    }
    const result = await this.core.registerDashboardOpenRouterModel(
      this.scope(scopeKind, actor, snapshot),
      parsed.data.capability,
      parsed.data.modelName,
    );
    if (result.status === "invalid_model") {
      throw new DashboardServiceError("openrouter_model_not_found", 404, "OpenRouter did not return that model.");
    }
    return result;
  }

  async removeOpenRouter(
    scopeKind: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    value: unknown,
  ): Promise<void> {
    const parsed = openRouterSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_openrouter_model", 422, "The OpenRouter model is invalid.");
    }
    const result = await this.core.removeDashboardOpenRouterModel(
      this.scope(scopeKind, actor, snapshot),
      parsed.data.capability,
      parsed.data.modelName,
    );
    if (result.status !== "removed") {
      throw new DashboardServiceError("openrouter_model_not_found", 404, "The registration was not found.");
    }
  }

  async setFallbacks(snapshot: DashboardGuildSnapshot, value: unknown): Promise<FallbackModelRef[]> {
    const parsed = fallbackSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_fallbacks", 422, "The fallback chain is invalid.");
    }
    const options = await this.core.loadServerFallbackOptions(snapshot);
    const allowed = new Set(options.map((option) => `${option.ref.type}:${option.ref.id}`));
    const seen = new Set<string>();
    for (const ref of parsed.data.refs) {
      const key = `${ref.type}:${ref.id}`;
      if (!allowed.has(key) || seen.has(key) || (ref.type === "llm" && ref.id === snapshot.config.llm_id)) {
        throw new DashboardServiceError("invalid_fallbacks", 422, "The fallback chain contains an invalid model.");
      }
      seen.add(key);
    }
    const refs = parsed.data.refs as FallbackModelRef[];
    if (!(await this.core.setServerFallbacks(snapshot, refs))) {
      throw new DashboardServiceError("fallback_save_failed", 500, "The fallback chain was not saved.");
    }
    return refs;
  }

  async setServerModels(snapshot: DashboardGuildSnapshot, value: unknown) {
    const parsed = serverModelsSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_server_models", 422, "The server model selection is invalid.");
    }

    const workspace = await this.core.loadServerModelWorkspace(snapshot);
    const kinds = Object.keys(parsed.data) as DashboardServerModelKind[];
    for (const kind of kinds) {
      const modelId = parsed.data[kind];
      const canClear = kind === "vision" || kind === "image" || kind === "imageNai";
      if (modelId === null) {
        if (!canClear && workspace.selected[kind] !== null) {
          throw new DashboardServiceError("invalid_server_models", 422, `The ${kind} model cannot be cleared.`);
        }
        continue;
      }
      if (!workspace.options[kind].some((option) => option.id === modelId)) {
        throw new DashboardServiceError("invalid_server_models", 422, `The selected ${kind} model is unavailable.`);
      }
    }

    for (const kind of kinds) {
      const modelId = parsed.data[kind];
      if (workspace.selected[kind] === modelId) continue;
      if (!(await this.core.setServerPrimaryModel(snapshot, kind, modelId))) {
        throw new DashboardServiceError("server_model_save_failed", 500, `The ${kind} model was not saved.`);
      }
    }
    return parsed.data;
  }

  private scope(
    kind: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
  ): DashboardProviderScope {
    return kind === "server"
      ? { kind, snapshot }
      : {
          kind,
          snapshot,
          userId: actor.user.user_id,
          userDiscordId: actor.discordId,
        };
  }
}
