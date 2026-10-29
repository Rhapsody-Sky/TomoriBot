import type {
  CustomEndpointApiStyle,
  CustomEndpointCapability,
  FallbackModelRef,
  PersonalProviderCapability,
} from "@/types/db/schema";
import { z } from "zod";
import { buildCustomProviderName } from "@/utils/provider/customProviderUtils";
import type {
  DashboardCustomEndpointInput,
  DashboardProviderScope,
  DashboardServerModelKind,
  TomoriDashboardCore,
} from "./core";
import { DashboardServiceError } from "./errors";
import type { DashboardActor, DashboardGuildSnapshot } from "./types";

const providerNameSchema = z.string().trim().toLowerCase().min(1).max(120);
const capabilitySchema = z.enum([
  "text",
  "embedding",
  "image",
  "image_nai",
  "video",
  "vision",
  "speech_design",
  "speech_clone",
]);
const openRouterCapabilitySchema = z.enum(["text", "embedding", "image", "video", "decision"]);
const personalModelSchema = z
  .object({ capability: capabilitySchema, provider: providerNameSchema, modelId: z.number().int().positive() })
  .strict();
const personalParametersSchema = z
  .object({
    provider: providerNameSchema,
    patch: z
      .object({
        temperature: z.number().min(0).max(2).nullable().optional(),
        top_p: z.number().min(0).max(1).nullable().optional(),
        top_k: z.number().int().min(0).max(256).nullable().optional(),
        frequency_penalty: z.number().min(-2).max(2).nullable().optional(),
        presence_penalty: z.number().min(-2).max(2).nullable().optional(),
        min_p: z.number().min(0).max(1).nullable().optional(),
        max_output_tokens: z.number().int().min(1).max(131072).nullable().optional(),
        thinking_level: z.enum(["auto", "none", "minimal", "low", "medium", "high"]).optional(),
      })
      .strict()
      .refine((patch) => Object.keys(patch).length > 0),
  })
  .strict();

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
    speech_design_model_id?: number | null;
    speech_clone_model_id?: number | null;
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
      image: row.diffusion_model_id !== null,
      image_nai: row.nai_diffusion_model_id !== null,
      video: row.video_model_id !== null && row.video_model_id !== undefined,
      speech_design: row.speech_design_model_id != null,
      speech_clone: row.speech_clone_model_id != null,
    },
  };
}

function serializeEndpoint(row: {
  connection_id: number;
  custom_endpoint_id?: number;
  label: string;
  capability: CustomEndpointCapability;
  api_style: CustomEndpointApiStyle;
  endpoint_url: string;
  model_name?: string | null;
  model_ref_id?: number | null;
  num_ctx?: number | null;
  requires_auth: boolean;
  has_tools: boolean;
  sees_images: boolean;
  sees_videos: boolean;
  supports_structoutput: boolean;
}) {
  return {
    id: row.custom_endpoint_id ?? 0,
    provider: buildCustomProviderName(row.connection_id),
    label: row.label,
    capability: row.capability,
    apiStyle: row.api_style,
    endpointUrl: row.endpoint_url,
    modelName: row.model_name ?? null,
    modelRefId: row.model_ref_id ?? null,
    displayName: row.label,
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
  | "loadPersonalFallbackWorkspace"
  | "loadPersonalModelWorkspace"
  | "setPersonalPrimaryModel"
  | "loadPersonalProviderParameters"
  | "setPersonalProviderParameters"
  | "loadServerProviderParameters"
  | "setServerProviderParameters"
  | "setPersonalFallbacks"
  | "loadServerModelWorkspace"
  | "setServerPrimaryModel"
  | "loadPersonaTextModelWorkspace"
  | "setPersonaTextModelOverride"
>;

export class DashboardProviderService {
  constructor(private readonly core: DashboardProviderCore) {}

  async loadPersonalWorkspace(actor: DashboardActor, snapshot: DashboardGuildSnapshot) {
    const [providers, endpoints, openRouterModels, fallbacks, models, parameters] = await Promise.all([
      this.core.loadPersonalProviderConfigs(actor.user.user_id),
      this.core.loadPersonalCustomEndpoints(actor.user.user_id),
      this.core.loadPersonalOpenRouterModels(actor.user.user_id),
      this.core.loadPersonalFallbackWorkspace(actor.user.user_id),
      this.core.loadPersonalModelWorkspace(actor.user.user_id),
      this.core.loadPersonalProviderParameters(actor.user.user_id),
    ]);
    return {
      choices: this.core.getProviderChoices(),
      providers: providers.map((row) => serializeProvider(row, this.core.getProviderDisplayName(row.provider))),
      endpoints: endpoints.map(serializeEndpoint),
      openRouterModels,
      byokRequired: snapshot.config.user_byok_mode === true,
      models,
      parameters,
      ...fallbacks,
    };
  }

  async loadServerWorkspace(snapshot: DashboardGuildSnapshot) {
    const [providers, endpoints, openRouterModels, fallbackOptions, models, parameters] = await Promise.all([
      this.core.loadServerProviderConfigs(snapshot.serverId),
      this.core.loadServerCustomEndpoints(snapshot.serverId),
      this.core.loadServerOpenRouterModels(snapshot.serverId),
      this.core.loadServerFallbackOptions(snapshot),
      this.core.loadServerModelWorkspace(snapshot),
      this.core.loadServerProviderParameters(snapshot.serverId),
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
      parameters,
    };
  }

  async loadPersonaTextModel(snapshot: DashboardGuildSnapshot, personaId: number) {
    const workspace = await this.core.loadPersonaTextModelWorkspace(snapshot, personaId);
    if (!workspace) throw new DashboardServiceError("persona_not_found", 404, "The persona was not found.");
    return workspace;
  }

  async setPersonaTextModel(snapshot: DashboardGuildSnapshot, personaId: number, value: unknown): Promise<void> {
    const parsed = z.object({ modelId: z.number().int().positive().nullable() }).strict().safeParse(value);
    if (!parsed.success)
      throw new DashboardServiceError("invalid_persona_model", 422, "The persona model selection is invalid.");
    if (!(await this.core.setPersonaTextModelOverride(snapshot, personaId, parsed.data.modelId))) {
      throw new DashboardServiceError(
        "persona_model_unavailable",
        422,
        "The persona or selected model is unavailable.",
      );
    }
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

  async setPersonalModel(actor: DashboardActor, value: unknown): Promise<void> {
    const parsed = personalModelSchema.safeParse(value);
    if (!parsed.success)
      throw new DashboardServiceError("invalid_personal_model", 422, "The personal model selection is invalid.");
    const { capability, provider, modelId } = parsed.data;
    if (
      !(await this.core.setPersonalPrimaryModel(actor.user.user_id, actor.discordId, capability, provider, modelId))
    ) {
      throw new DashboardServiceError("personal_model_unavailable", 422, "The selected personal model is unavailable.");
    }
  }

  async setPersonalParameters(actor: DashboardActor, value: unknown): Promise<void> {
    const parsed = personalParametersSchema.safeParse(value);
    if (!parsed.success)
      throw new DashboardServiceError("invalid_personal_parameters", 422, "The personal model parameters are invalid.");
    const result = await this.core.setPersonalProviderParameters(
      actor.user.user_id,
      actor.discordId,
      parsed.data.provider,
      parsed.data.patch,
    );
    if (result.status !== "success" && result.status !== "no-changes") {
      throw new DashboardServiceError(
        "personal_parameters_unavailable",
        422,
        "The personal model parameters could not be saved.",
      );
    }
  }

  async setServerParameters(snapshot: DashboardGuildSnapshot, value: unknown): Promise<void> {
    const parsed = personalParametersSchema.safeParse(value);
    if (!parsed.success)
      throw new DashboardServiceError("invalid_server_parameters", 422, "The server model parameters are invalid.");
    const result = await this.core.setServerProviderParameters(snapshot, parsed.data.provider, parsed.data.patch);
    if (result.status !== "success" && result.status !== "no-changes")
      throw new DashboardServiceError(
        "server_parameters_unavailable",
        422,
        "The server model parameters could not be saved.",
      );
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
    if (result.status === "write_failed") {
      throw new DashboardServiceError("openrouter_save_failed", 500, "The model registration was not saved.");
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
    if (result.status === "write_failed") {
      throw new DashboardServiceError("openrouter_delete_failed", 500, "The model registration was not removed.");
    }
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

  async setPersonalFallbacks(actor: DashboardActor, value: unknown): Promise<FallbackModelRef[]> {
    const parsed = fallbackSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_fallbacks", 422, "The fallback chain is invalid.");
    }
    const { fallbackOptions } = await this.core.loadPersonalFallbackWorkspace(actor.user.user_id);
    const allowed = new Set(fallbackOptions.map((option) => `${option.ref.type}:${option.ref.id}`));
    const seen = new Set<string>();
    for (const ref of parsed.data.refs) {
      const key = `${ref.type}:${ref.id}`;
      if (!allowed.has(key) || seen.has(key)) {
        throw new DashboardServiceError("invalid_fallbacks", 422, "The fallback chain contains an invalid model.");
      }
      seen.add(key);
    }
    if (!(await this.core.setPersonalFallbacks(actor.user.user_id, actor.discordId, parsed.data.refs))) {
      throw new DashboardServiceError("fallback_save_failed", 500, "The fallback chain was not saved.");
    }
    return parsed.data.refs;
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
