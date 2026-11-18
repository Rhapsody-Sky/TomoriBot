import type {
  CustomEndpointApiStyle,
  CustomEndpointCapability,
  CustomEndpointRow,
  FallbackModelRef,
  PersonalProviderCapability,
} from "@/types/db/schema";
import { z } from "zod";
import { personalConfigOperations } from "@/utils/discord/interactions/personalConfigOperations";
import { QUICK_TOGGLE_CAPABILITIES, ROUTING_CAPABILITY_LOCALE_KEYS } from "@/utils/discord/personalConfigPanelCatalog";
import { offeredChatCompatFlags } from "@/utils/discord/ui/providersPanel";
import { invalidateUserCache } from "@/utils/cache/userCache";
import { llmProviderRepo, toolRepository } from "@/utils/db/repositories";
import {
  getDefaultImageEndpointSupports,
  imageEndpointSupportsFromSubmittedValues,
  readImageEndpointSupports,
} from "@/utils/provider/customImageEndpointSupport";
import { buildCustomProviderName, buildSyntheticCustomModelCodename } from "@/utils/provider/customProviderUtils";
import { registerCustomEndpoint } from "@/utils/provider/customEndpointService";
import {
  readSpeechEndpointSettings,
  SPEECH_SCRIPT_MARKUPS,
  SPEECH_VOICE_MODES,
} from "@/utils/provider/customSpeechEndpointSettings";
import { findProviderOption, findProviderOptionByActiveProvider } from "@/utils/provider/providerOptionRegistry";
import { providerPanelOperations } from "@/utils/provider/providerPanelOperations";
import { IMPORT_LIMITS } from "@/utils/security/rateLimiter";
import { localizer } from "@/utils/text/localizer";
import type {
  DashboardCustomEndpointInput,
  DashboardProviderScope,
  DashboardServerModelKind,
  TomoriDashboardCore,
} from "./core";
import { DashboardServiceError } from "./errors";
import { loadAdvancedServerModels } from "./serverModelService";
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
  "transcription",
]);
const openRouterCapabilitySchema = z.enum(["text", "embedding", "image", "video", "decision"]);
const personalModelSchema = z
  .object({ capability: capabilitySchema, provider: providerNameSchema, modelId: z.number().int().positive() })
  .strict();
const personalCapabilityToggleSchema = z
  .object({ capability: z.enum(QUICK_TOGGLE_CAPABILITIES), enabled: z.boolean() })
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

const editConnectionSchema = z.strictObject({
  label: z.string().trim().min(1).max(40).optional(),
  endpointUrl: z
    .string()
    .trim()
    .max(500)
    .pipe(z.url({ protocol: /^https?$/ }))
    .optional(),
  authToken: z.string().trim().max(500).optional(),
  unloadDuringComfyUi: z.boolean().optional(),
});

const rotationSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("add"), key: providerCredentialSchema.shape.apiKey }),
  z.strictObject({ action: z.literal("clear") }),
]);

export const ENDPOINT_WORKFLOW_MAX_BYTES = IMPORT_LIMITS.MAX_DATA_IMPORT_SIZE_MB * 1024 * 1024;
const endpointModelFlags = z.strictObject({
  hasTools: z.boolean(),
  seesImages: z.boolean(),
  seesVideos: z.boolean(),
  supportsStructOutput: z.boolean(),
  strictRoleAlternation: z.boolean(),
  supportsPrefixCompletion: z.boolean(),
  supportsAssistantPrefill: z.boolean(),
  verbatimToolCalling: z.boolean(),
});
const endpointModelSchema = z.strictObject({
  codeName: z.string().trim().min(1).max(200).optional(),
  numCtx: z.number().int().min(512).max(10_000_000).nullable().optional(),
  flags: endpointModelFlags.partial().optional(),
  imageSupports: z
    .array(z.enum(["txt2img", "img2img", "inpaint", "negative_prompt"]))
    .max(4)
    .optional(),
  voiceMode: z.enum(SPEECH_VOICE_MODES).optional(),
  scriptMarkup: z.enum(SPEECH_SCRIPT_MARKUPS).optional(),
  supportsInstruct: z.boolean().optional(),
  workflow: z
    .record(z.string(), z.unknown())
    .refine((value) => Object.keys(value).length > 0)
    .optional(),
});
const newEndpointModelSchema = endpointModelSchema
  .omit({ voiceMode: true, scriptMarkup: true, supportsInstruct: true })
  .required({ codeName: true });

function endpointModelOptions(
  entryId: string,
  capability: CustomEndpointCapability,
  apiStyle: CustomEndpointApiStyle,
  row?: CustomEndpointRow,
) {
  const compat = offeredChatCompatFlags("endpoint", entryId);
  const flags =
    capability === "text"
      ? {
          hasTools: row?.has_tools ?? false,
          seesImages: row?.sees_images ?? false,
          seesVideos: row?.sees_videos ?? false,
          supportsStructOutput: row?.supports_structoutput ?? false,
          ...(compat.includes("strict-roles") ? { strictRoleAlternation: row?.strict_role_alternation ?? false } : {}),
          ...(compat.includes("prefix") ? { supportsPrefixCompletion: row?.supports_prefix_completion ?? false } : {}),
          ...(compat.includes("prefill") ? { supportsAssistantPrefill: row?.supports_assistant_prefill ?? false } : {}),
          ...(compat.includes("verbatim-tools") ? { verbatimToolCalling: row?.verbatim_tool_calling ?? false } : {}),
        }
      : null;
  return {
    flags,
    imageSupports:
      capability === "image"
        ? row
          ? readImageEndpointSupports(row)
          : getDefaultImageEndpointSupports(apiStyle)
        : null,
    allowInpaint: apiStyle === "comfyui",
    workflowMaxBytes:
      apiStyle === "comfyui" && (capability === "image" || capability === "video") ? ENDPOINT_WORKFLOW_MAX_BYTES : null,
  };
}

function hasInvalidEndpointModelFields(
  patch: z.infer<typeof endpointModelSchema>,
  capability: CustomEndpointCapability,
  editor: ReturnType<typeof endpointModelOptions>,
) {
  return (
    (patch.numCtx !== undefined && capability !== "text" && capability !== "decision") ||
    (capability === "decision" && patch.numCtx === null) ||
    (patch.flags && Object.keys(patch.flags).some((key) => !editor.flags || !Object.hasOwn(editor.flags, key))) ||
    (patch.imageSupports &&
      (!editor.imageSupports || (!editor.allowInpaint && patch.imageSupports.includes("inpaint")))) ||
    (patch.workflow &&
      (!editor.workflowMaxBytes || Buffer.byteLength(JSON.stringify(patch.workflow)) > editor.workflowMaxBytes))
  );
}

function connectionError(code: string, status: DashboardServiceError["status"], key = `general.dashboard.${code}`) {
  return new DashboardServiceError(code, status, localizer("en-US", key));
}

const openRouterSchema = z
  .object({
    capability: openRouterCapabilitySchema,
    modelName: z.string().trim().min(1).max(240),
  })
  .strict();
const openRouterRegistrationSchema = openRouterSchema.extend({
  capability: z.enum([...openRouterCapabilitySchema.options, "transcription"]),
});

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
    transcription: z
      .object({ provider: providerNameSchema, modelId: z.number().int().positive() })
      .strict()
      .nullable()
      .optional(),
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
    connectionId: row.connection_id,
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
  | "setServerTranscription"
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
      quickCapabilities: QUICK_TOGGLE_CAPABILITIES,
      parameters,
      ...fallbacks,
    };
  }

  async loadServerWorkspace(snapshot: DashboardGuildSnapshot) {
    const [providers, endpoints, openRouterModels, fallbackOptions, models, parameters, advancedModels, brave] =
      await Promise.all([
        this.core.loadServerProviderConfigs(snapshot.serverId),
        this.core.loadServerCustomEndpoints(snapshot.serverId),
        this.core.loadServerOpenRouterModels(snapshot.serverId),
        this.core.loadServerFallbackOptions(snapshot),
        this.core.loadServerModelWorkspace(snapshot),
        this.core.loadServerProviderParameters(snapshot.serverId),
        loadAdvancedServerModels(snapshot),
        toolRepository.getBraveApiKeyStatusResult(snapshot.serverId),
      ]);
    const state = snapshot.rawPersonas.find((persona) => !persona.is_alter);
    const catalogProvider = state?.llm.llm_provider.toLowerCase();
    const activeTextProvider =
      state && catalogProvider
        ? (findProviderOptionByActiveProvider(
            catalogProvider,
            { kind: "server", ownerId: snapshot.serverId, state },
            "text",
          )?.value ?? catalogProvider)
        : null;
    return {
      choices: [...this.core.getProviderChoices(), { value: "brave", name: "Brave Search" }],
      providers: providers.map((row) => ({
        ...serializeProvider(row, this.core.getProviderDisplayName(row.provider)),
        supportsRotation: !row.provider.startsWith("custom:") && !findProviderOption(row.provider),
      })),
      braveSearchConfigured: brave.configured,
      endpoints: endpoints.map(serializeEndpoint),
      openRouterModels,
      fallbackOptions,
      fallbackRefs: snapshot.config.fallback_model_refs ?? [],
      primaryModelId: snapshot.config.llm_id,
      activeTextProvider,
      models,
      advancedModels,
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
    if (parsed.success && scope === "server" && parsed.data.provider === "brave") {
      const state = snapshot.rawPersonas.find((persona) => !persona.is_alter);
      if (!state) throw connectionError("provider_credentials_unavailable", 503);
      const result = await providerPanelOperations.addServerProvider({
        state,
        serverDiscId: snapshot.serverDiscordId,
        actorDiscId: actor.discordId,
        provider: "brave",
        apiKey: parsed.data.apiKey,
      });
      if (result.status === "success") return;
      if (result.status === "validation-failed" || result.status === "invalid-key")
        throw connectionError("provider_key_rejected", 422);
      throw connectionError("provider_credentials_failed", 500);
    }
    if (!parsed.success || !this.core.getProviderChoices().some((choice) => choice.value === parsed.data.provider)) {
      throw new DashboardServiceError("invalid_provider", 422, "The provider credential is invalid.");
    }
    const saved =
      scope === "server"
        ? await this.core.saveServerProviderCredential(snapshot, parsed.data.provider, parsed.data.apiKey, true)
        : await this.core.savePersonalProviderCredential(
            snapshot,
            actor.user.user_id,
            actor.discordId,
            parsed.data.provider,
            parsed.data.apiKey,
            true,
          );
    if (!saved) {
      throw new DashboardServiceError(
        "provider_save_failed",
        422,
        "The key could not be validated or the provider could not be saved.",
      );
    }
  }

  async togglePersonalCapability(actor: DashboardActor, value: unknown) {
    const parsed = personalCapabilityToggleSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError(
        "invalid_personal_capability",
        422,
        localizer("en-US", "general.dashboard.quick_capability_invalid"),
      );
    }
    const { capability, enabled } = parsed.data;
    const result = await personalConfigOperations.setCapabilityEnabled({
      userId: actor.user.user_id,
      userDiscId: actor.discordId,
      capability,
      enabled,
    });
    if (result.status === "missing-model") {
      throw new DashboardServiceError(
        "personal_capability_missing_model",
        422,
        localizer("en-US", "commands.personal.config.missing_model_detail", {
          capability: localizer("en-US", ROUTING_CAPABILITY_LOCALE_KEYS[capability]),
        }),
      );
    }
    if (result.status === "write-failed") {
      throw new DashboardServiceError(
        "personal_capability_write_failed",
        500,
        localizer("en-US", "general.dashboard.quick_capability_failed"),
      );
    }
    return { enabled };
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

  async removeServerProvider(snapshot: DashboardGuildSnapshot, provider: string) {
    const parsed = providerNameSchema.safeParse(provider);
    if (!parsed.success) throw connectionError("server_provider_remove_not_found", 404);
    const state = snapshot.rawPersonas.find((persona) => !persona.is_alter);
    const panel = await providerPanelOperations.loadServerProviderPanelScope(snapshot.serverDiscordId);
    if (!state || !panel || panel.data.readStatus !== "fresh")
      throw connectionError("server_provider_remove_unavailable", 503);
    if (panel.scopeKind === "personal" || panel.state.server_id !== snapshot.serverId)
      throw connectionError("server_provider_remove_not_found", 404);
    const entry = panel.data.entries.find((entry) =>
      parsed.data === "brave" ? entry.kind === "brave" : entry.kind === "provider" && entry.provider === parsed.data,
    );
    if (!entry) throw connectionError("server_provider_remove_not_found", 404);
    const result = await providerPanelOperations.removeServerProviderEntry({
      ...panel,
      state,
      serverDiscId: snapshot.serverDiscordId,
      entry,
    });
    switch (result.status) {
      case "success":
        return { deleted: true };
      case "active":
        throw connectionError("provider_active", 409, "commands.providers.remove_active");
      case "not-found":
        throw connectionError("server_provider_remove_not_found", 404);
      case "write-failed":
        throw connectionError("server_provider_remove_failed", 500);
    }
  }

  private async loadRotationEntry(snapshot: DashboardGuildSnapshot, provider: string) {
    const parsed = providerNameSchema.safeParse(provider);
    if (!parsed.success || findProviderOption(parsed.data)) throw connectionError("rotation_not_found", 404);
    const panel = await providerPanelOperations.loadServerProviderPanelScope(snapshot.serverDiscordId);
    if (!panel || panel.data.readStatus !== "fresh") throw connectionError("provider_credentials_unavailable", 503);
    if (panel.scopeKind === "personal" || panel.state.server_id !== snapshot.serverId)
      throw connectionError("rotation_not_found", 404);
    const entry = panel.data.entries.find((entry) => entry.kind === "provider" && entry.provider === parsed.data);
    if (entry?.kind !== "provider") throw connectionError("rotation_not_found", 404);
    return { panel, entry };
  }

  async loadRotationKeys(snapshot: DashboardGuildSnapshot, provider: string) {
    const { entry } = await this.loadRotationEntry(snapshot, provider);
    return { name: entry.displayName, count: entry.rotationKeyCount };
  }

  async updateRotationKeys(actor: DashboardActor, snapshot: DashboardGuildSnapshot, provider: string, value: unknown) {
    const parsed = rotationSchema.safeParse(value);
    if (!parsed.success) throw connectionError("rotation_invalid", 422);
    const { panel, entry } = await this.loadRotationEntry(snapshot, provider);
    const result = await providerPanelOperations.editServerProvider({
      ...panel,
      serverDiscId: snapshot.serverDiscordId,
      actorDiscId: actor.discordId,
      provider: entry.provider,
      apiKey: "",
      rotationKey: parsed.data.action === "add" ? parsed.data.key : "",
      deleteRotationKeys: parsed.data.action === "clear",
    });
    switch (result.status) {
      case "success":
      case "unchanged":
        return { updated: result.status === "success" };
      case "not-found":
        throw connectionError("rotation_not_found", 404);
      case "invalid-key":
      case "validation-failed":
        throw connectionError("provider_key_rejected", 422);
      case "novelai-unavailable":
        throw connectionError("provider_key_rejected", 422, result.descriptionKey);
      case "invalid-combination":
        throw connectionError("rotation_invalid", 422);
      case "write-failed":
        throw connectionError("provider_credentials_failed", 500);
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

  private async loadConnectionEntry(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    connectionId: number,
  ) {
    const panel =
      scope === "personal"
        ? await providerPanelOperations.loadPersonalProviderPanelScope(actor.discordId, snapshot.serverDiscordId)
        : await providerPanelOperations.loadServerProviderPanelScope(snapshot.serverDiscordId);
    if (!panel || panel.data.readStatus !== "fresh") throw connectionError("endpoint_edit_unavailable", 503);
    if (
      scope === "personal"
        ? panel.scopeKind !== "personal" || panel.ownerId !== actor.user.user_id
        : panel.scopeKind === "personal" || panel.state.server_id !== snapshot.serverId
    )
      throw connectionError("endpoint_edit_not_found", 404);
    const entry = panel.data.entries.find(
      (candidate) => candidate.kind === "endpoint" && candidate.connectionIds.includes(connectionId),
    );
    if (entry?.kind !== "endpoint") throw connectionError("endpoint_edit_not_found", 404);
    const textConnections = entry.connectionDetails.filter((detail) => detail.capability === "text");
    const unloadDuringComfyUi =
      !entry.isPreset && textConnections.length
        ? textConnections.some((detail) => detail.vramHandoff !== null)
        : undefined;
    return { panel, entry, unloadDuringComfyUi };
  }

  async loadConnectionEditor(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    connectionId: number,
  ) {
    const { entry, unloadDuringComfyUi } = await this.loadConnectionEntry(scope, actor, snapshot, connectionId);
    return {
      label: entry.displayName,
      endpointUrl: entry.connectionDetails[0]?.endpointUrl ?? "",
      isPreset: entry.isPreset,
      unloadDuringComfyUi,
    };
  }

  async editConnection(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    connectionId: number,
    value: unknown,
  ) {
    const parsed = editConnectionSchema.safeParse(value);
    if (!parsed.success) throw connectionError("endpoint_edit_invalid", 422);
    const { panel, entry, unloadDuringComfyUi } = await this.loadConnectionEntry(scope, actor, snapshot, connectionId);
    const patch = parsed.data;
    if (
      (entry.isPreset && (patch.label !== undefined || patch.endpointUrl !== undefined)) ||
      (unloadDuringComfyUi === undefined && patch.unloadDuringComfyUi !== undefined)
    )
      throw connectionError("endpoint_edit_changed", 409);
    const result = await providerPanelOperations.editServerEndpoint({
      ...panel,
      serverDiscId: snapshot.serverDiscordId,
      entryId: entry.id,
      label: patch.label ?? entry.displayName,
      endpointUrl: patch.endpointUrl ?? "",
      authToken: patch.authToken ?? "",
      unloadDuringComfyUi: patch.unloadDuringComfyUi ?? (patch.endpointUrl ? unloadDuringComfyUi : undefined),
    });
    switch (result.status) {
      case "success":
        if (scope === "personal") invalidateUserCache(actor.discordId);
        return { updated: true };
      case "unchanged":
        return { updated: false };
      case "not-found":
        throw connectionError("endpoint_edit_not_found", 404);
      case "invalid-label":
        throw connectionError("endpoint_edit_invalid", 422, "commands.providers.endpoint_invalid_label");
      case "handoff-unsupported":
        throw connectionError(
          "endpoint_edit_handoff_unsupported",
          422,
          "commands.providers.endpoint_behavior_unsupported",
        );
      case "unreachable":
        throw result.credentialsWithheld
          ? connectionError(
              "endpoint_edit_credentials_withheld",
              422,
              "commands.providers.endpoint_redirect_credentials_withheld",
            )
          : connectionError("endpoint_edit_unreachable", 422);
      case "write-failed":
        throw connectionError("endpoint_edit_failed", 500);
    }
  }

  private async loadEndpointModel(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    connectionId: number,
    endpointId: number,
  ) {
    const { panel, entry } = await this.loadConnectionEntry(scope, actor, snapshot, connectionId);
    const [row] = await llmProviderRepo.loadCustomEndpointsByIds([endpointId]);
    if (
      !row ||
      row.connection_id !== connectionId ||
      row.capability === "transcription" ||
      (scope === "personal"
        ? row.user_id !== actor.user.user_id || row.server_id != null
        : row.server_id !== snapshot.serverId || row.user_id != null)
    )
      throw connectionError("endpoint_model_not_found", 404);
    const editor = {
      connectionName: entry.displayName,
      capability: row.capability,
      codeName: row.capability === "speech" ? null : row.model_name || row.label,
      numCtx: row.num_ctx ?? null,
      ...endpointModelOptions(entry.id, row.capability, row.api_style, row),
      speech: row.capability === "speech" ? readSpeechEndpointSettings(row) : null,
      allowVoiceMode: row.api_style === "tts-clone",
    };
    return { panel, entry, row, editor };
  }

  private async loadEndpointModelRegistration(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    connectionId: number,
  ) {
    const { panel, entry } = await this.loadConnectionEntry(scope, actor, snapshot, connectionId);
    const connection = entry.connectionDetails.find((detail) => detail.connectionId === connectionId);
    if (!connection || connection.capability === "speech" || connection.capability === "transcription")
      throw connectionError("endpoint_edit_not_found", 404);
    const editor = {
      connectionName: entry.displayName,
      capability: connection.capability,
      codeName: "",
      numCtx: null,
      ...endpointModelOptions(entry.id, connection.capability, connection.apiStyle),
    };
    return { panel, entry, connection, editor };
  }

  async loadEndpointModelCreateEditor(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    connectionId: number,
  ) {
    return (await this.loadEndpointModelRegistration(scope, actor, snapshot, connectionId)).editor;
  }

  async createEndpointModel(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    connectionId: number,
    value: unknown,
  ) {
    const parsed = newEndpointModelSchema.safeParse(value);
    if (!parsed.success) throw connectionError("endpoint_model_invalid", 422);
    const { panel, entry, connection, editor } = await this.loadEndpointModelRegistration(
      scope,
      actor,
      snapshot,
      connectionId,
    );
    const { capability, apiStyle, endpointUrl } = connection;
    const { codeName, numCtx, flags, imageSupports, workflow } = parsed.data;
    if (
      hasInvalidEndpointModelFields(parsed.data, capability, editor) ||
      (capability === "decision" && numCtx == null) ||
      (editor.workflowMaxBytes !== null && !workflow)
    )
      throw connectionError("endpoint_model_invalid", 422);
    const endpoints = await llmProviderRepo.loadCustomEndpointsByConnectionId(connectionId);
    if (endpoints.some((model) => buildSyntheticCustomModelCodename(model.label, model.model_name) === codeName))
      throw connectionError("endpoint_model_exists", 409);

    const result = await registerCustomEndpoint({
      scope:
        panel.scopeKind === "personal"
          ? { kind: "personal", ownerId: actor.user.user_id, baseConfig: panel.state?.config }
          : {
              kind: "server",
              ownerId: snapshot.serverId,
              baseConfig: panel.state.config,
              serverDiscId: snapshot.serverDiscordId,
            },
      existingConnectionId: connectionId,
      label: entry.displayName,
      capability,
      apiStyle,
      endpointUrl,
      modelName: codeName,
      numCtx,
      ...flags,
      extraConfig: {
        ...(workflow ? { workflow } : {}),
        ...(capability === "image"
          ? { workflow_supports: imageEndpointSupportsFromSubmittedValues(imageSupports, apiStyle) }
          : {}),
      },
    });
    if (!result) throw connectionError("endpoint_model_failed", 422);
    if (scope === "personal") invalidateUserCache(actor.discordId);
    return { created: true };
  }

  async loadEndpointModelEditor(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    connectionId: number,
    endpointId: number,
  ) {
    return (await this.loadEndpointModel(scope, actor, snapshot, connectionId, endpointId)).editor;
  }

  async editEndpointModel(
    scope: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    connectionId: number,
    endpointId: number,
    value: unknown,
  ) {
    const parsed = endpointModelSchema.safeParse(value);
    if (!parsed.success || !Object.keys(parsed.data).length) throw connectionError("endpoint_model_invalid", 422);
    const { panel, entry, row, editor } = await this.loadEndpointModel(
      scope,
      actor,
      snapshot,
      connectionId,
      endpointId,
    );
    const patch = parsed.data;
    if (
      (patch.codeName !== undefined && editor.codeName === null) ||
      hasInvalidEndpointModelFields(patch, row.capability, editor) ||
      (patch.scriptMarkup !== undefined && !editor.speech) ||
      ((patch.voiceMode !== undefined || patch.supportsInstruct !== undefined) &&
        (!editor.speech || !editor.allowVoiceMode))
    )
      throw connectionError("endpoint_model_invalid", 422);
    const numCtx = patch.numCtx === undefined ? editor.numCtx : patch.numCtx;
    if (row.capability === "text") {
      // The Discord panel adapter omits video support when it delegates to the endpoint writer.
      const updated = await registerCustomEndpoint({
        scope:
          panel.scopeKind === "personal"
            ? { kind: "personal", ownerId: actor.user.user_id, baseConfig: panel.state?.config }
            : {
                kind: "server",
                ownerId: snapshot.serverId,
                baseConfig: panel.state.config,
                serverDiscId: snapshot.serverDiscordId,
              },
        label: row.label,
        capability: "text",
        apiStyle: row.api_style,
        endpointUrl: row.endpoint_url,
        modelName: patch.codeName ?? row.model_name,
        numCtx,
        extraConfig: row.extra_config,
        hasTools: row.has_tools,
        seesImages: row.sees_images,
        seesVideos: row.sees_videos,
        supportsStructOutput: row.supports_structoutput,
        strictRoleAlternation: row.strict_role_alternation,
        supportsPrefixCompletion: row.supports_prefix_completion,
        supportsAssistantPrefill: row.supports_assistant_prefill,
        verbatimToolCalling: row.verbatim_tool_calling,
        ...patch.flags,
        editingEndpointId: endpointId,
      });
      if (!updated) throw connectionError("endpoint_model_failed", 422);
    } else {
      const id = row.capability === "speech" ? endpointId : row.model_ref_id;
      if (!id) throw connectionError("endpoint_model_not_found", 404);
      const result = await providerPanelOperations.saveProviderModel({
        ...panel,
        serverDiscId: snapshot.serverDiscordId,
        entryId: entry.id,
        editingModelId: id,
        capability: row.capability,
        codeName: patch.codeName ?? editor.codeName ?? row.label,
        numCtx,
        imageSupportValues:
          patch.imageSupports ??
          (editor.imageSupports
            ? Object.entries(editor.imageSupports)
                .filter(([, enabled]) => enabled)
                .map(([key]) => key)
            : undefined),
        speechVoiceMode: patch.voiceMode ?? editor.speech?.voiceMode,
        speechScriptMarkup: patch.scriptMarkup ?? editor.speech?.scriptMarkup,
        speechInstructValues: (patch.supportsInstruct ?? editor.speech?.supportsInstruct) ? ["supports-instruct"] : [],
        workflow: patch.workflow,
      });
      if (result.status === "not-found") throw connectionError("endpoint_model_not_found", 404);
      if (result.status !== "success") throw connectionError("endpoint_model_failed", 422);
    }
    if (scope === "personal") invalidateUserCache(actor.discordId);
    return { updated: true };
  }

  async registerOpenRouter(
    scopeKind: "personal" | "server",
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    value: unknown,
  ) {
    const parsed = openRouterRegistrationSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_openrouter_model", 422, "The OpenRouter model is invalid.");
    }
    const result = await this.core.registerDashboardOpenRouterModel(
      this.scope(scopeKind, actor, snapshot),
      parsed.data.capability,
      parsed.data.modelName,
    );
    if (result.status === "missing_credential") {
      throw new DashboardServiceError(
        "openrouter_key_required",
        422,
        localizer("en-US", "general.dashboard.openrouter_transcription_key_required"),
      );
    }
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
    const { transcription, ...models } = parsed.data;
    const kinds = Object.keys(models) as DashboardServerModelKind[];
    if (
      transcription &&
      !workspace.transcription.options.some(
        (option) => option.id === transcription.modelId && option.provider === transcription.provider,
      )
    ) {
      throw new DashboardServiceError(
        "invalid_server_models",
        422,
        localizer("en-US", "general.dashboard.transcription_unavailable"),
      );
    }
    for (const kind of kinds) {
      const modelId = models[kind];
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
      const modelId = models[kind];
      if (workspace.selected[kind] === modelId) continue;
      if (!(await this.core.setServerPrimaryModel(snapshot, kind, modelId))) {
        throw new DashboardServiceError("server_model_save_failed", 500, `The ${kind} model was not saved.`);
      }
    }
    if (transcription !== undefined) {
      const current = workspace.transcription.selected;
      if (current?.provider !== transcription?.provider || current?.modelId !== transcription?.modelId) {
        if (!(await this.core.setServerTranscription(snapshot, transcription))) {
          throw new DashboardServiceError(
            "server_model_save_failed",
            500,
            localizer("en-US", "general.dashboard.transcription_save_failed"),
          );
        }
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
