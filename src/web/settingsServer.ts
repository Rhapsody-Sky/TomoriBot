import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Client } from "discord.js";
import type { Context } from "hono";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import {
  THINKING_LEVEL_VALUES,
  NAI_IMAGE_NOISE_SCHEDULES,
  NAI_IMAGE_SAMPLERS,
  PrivacyLevel,
  ProviderFactory,
  type CustomEndpointApiStyle,
  type CustomEndpointCapability,
  type FallbackModelRef,
  type OpenRouterModelCapability,
  type PersonalProviderCapability,
  type UserRow,
  type UserSavedProviderConfigRow,
  addPersonalMemoryByTomori,
  addServerMemoryByTomori,
  buildUserSavedProviderConfigFromExistingOrDefaults,
  checkServerMemoryLimit,
  deleteUserSavedProviderConfig,
  encryptApiKey,
  getAllProviderChoices,
  getMemoryLimits,
  getProviderDisplayName,
  getStaticProviderInfo,
  invalidateTomoriStateCache,
  invalidateUserCache,
  isCustomProvider,
  loadAvailableDiffusionModelsForProvider,
  loadAvailableEmbeddingModelsForProvider,
  loadAvailableModelsForProvider,
  loadAvailableVideoGenerationModelsForProvider,
  loadAllPersonasForServer,
  loadCustomEndpointsForServer,
  loadCustomEndpointsForUser,
  loadNaiPresetsForModel,
  loadSavedProviderConfigs,
  loadRegisteredOpenRouterModelsForScope,
  loadUserSavedProviderConfig,
  loadUserSavedProviderConfigs,
  log,
  personalMemorySchema,
  registerUser,
  registerCustomEndpoint,
  registerOpenRouterModelForScope,
  removeCustomEndpointRegistration,
  removeOpenRouterModelForScope,
  setFallbackModelRefs,
  serverMemorySchema,
  sql,
  updateTomori,
  updateTomoriConfig,
  updateUser,
  upsertUserSavedProviderConfig,
  validateMemoryContent,
} from "./tomoriCoreAdapter";

const BASE_PATH = "/settings";
const SESSION_COOKIE = "tomori_settings_session";
const OAUTH_STATE_COOKIE = "tomori_settings_oauth_state";
const DISCORD_API_BASE = "https://discord.com/api/v10";
const DASHBOARD_ASSETS = {
  "tomoribot_logo.png": {
    fileName: "tomoribot_logo.png",
    contentType: "image/png",
  },
  "tomori_texture5.png": {
    fileName: "tomori_texture5.png",
    contentType: "image/png",
  },
} as const;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const GUILD_CACHE_TTL_MS = 60 * 1000;
const MANAGE_GUILD_PERMISSION = 1n << 5n;
const ADMINISTRATOR_PERMISSION = 1n << 3n;

type ConfigFieldType = "boolean" | "number" | "text" | "textarea" | "select" | "multi-select" | "tags";
type ConfigOptionKey =
  | "llms"
  | "visionLlms"
  | "embeddingModels"
  | "diffusionModels"
  | "naiDiffusionModels"
  | "videoModels"
  | "thinkingLevels"
  | "channels"
  | "roles"
  | "personas"
  | "cooldownTypes"
  | "humanizerDegrees"
  | "naiPresets"
  | "naiSamplers"
  | "naiNoiseSchedules";
type ConfigValueType = "number" | "string";

interface ConfigFieldDefinition {
  key: keyof z.infer<typeof configUpdateSchema>;
  label: string;
  group: string;
  type: ConfigFieldType;
  min?: number;
  max?: number;
  nullable?: boolean;
  optionsKey?: ConfigOptionKey;
  valueType?: ConfigValueType;
}

interface SettingsWebsiteConfig {
  enabled: boolean;
  host: string;
  port: number;
  publicUrl: string;
  redirectUri: string;
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  secureCookie: boolean;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

interface DiscordGuild {
  id: string;
  name: string;
  icon?: string | null;
  owner?: boolean;
  permissions?: string;
}

interface DashboardGuild {
  id: string;
  name: string;
  iconUrl: string | null;
  memberCount: number | null;
  canManage: boolean;
}

interface SessionData {
  id: string;
  user: DiscordUser;
  accessToken: string;
  tokenExpiresAt: number;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  guildCache?: {
    fetchedAt: number;
    guilds: DashboardGuild[];
  };
}

const sessions = new Map<string, SessionData>();

const nullableString = (maxLength: number) =>
  z
    .preprocess((value) => {
      if (typeof value !== "string") {
        return value;
      }

      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    }, z.string().max(maxLength).nullable())
    .optional();

const snowflakeSchema = z.string().trim().regex(/^\d{1,32}$/);
const nullableSnowflake = z
  .preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }, snowflakeSchema.nullable())
  .optional();
const snowflakeArraySchema = z.array(snowflakeSchema).max(200).optional();
const tagArraySchema = z.array(z.string().trim().min(1).max(180)).max(400).optional();

const configUpdateSchema = z
  .object({
    llm_id: z.number().int().positive().nullable().optional(),
    vision_llm_id: z.number().int().positive().nullable().optional(),
    embedding_model_id: z.number().int().positive().nullable().optional(),
    diffusion_model_id: z.number().int().positive().nullable().optional(),
    nai_diffusion_model_id: z.number().int().positive().nullable().optional(),
    video_model_id: z.number().int().positive().nullable().optional(),
    thinking_level: z.enum(THINKING_LEVEL_VALUES).optional(),
    llm_temperature: z.number().min(0).max(2).optional(),
    llm_top_p: z.number().min(0).max(1).optional(),
    llm_top_k: z.number().int().min(0).max(40).optional(),
    llm_frequency_penalty: z.number().min(-2).max(2).optional(),
    llm_presence_penalty: z.number().min(-2).max(2).optional(),
    llm_min_p: z.number().min(0).max(1).optional(),
    fallback_llm_ids: z.array(z.number().int().positive()).max(5).optional(),
    always_reply_enabled: z.boolean().optional(),
    deliberate_trigger_mode: z.boolean().optional(),
    cooldown_type: z.number().int().min(0).max(4).optional(),
    cooldown_length: z.number().int().min(1).max(86400).optional(),
    humanizer_degree: z.number().int().min(0).max(3).optional(),
    emoji_usage_enabled: z.boolean().optional(),
    sticker_usage_enabled: z.boolean().optional(),
    hide_respond_embed: z.boolean().optional(),
    hide_impersonation_embeds: z.boolean().optional(),
    uncensor_injection_enabled: z.boolean().optional(),
    uncensor_unicode_space_enabled: z.boolean().optional(),
    uncensor_sanitize_enabled: z.boolean().optional(),
    user_byok_mode: z.boolean().optional(),
    autoch_threshold: z.number().min(0).max(10000).optional(),
    autoch_threshold_max: z.number().min(0).max(10000).optional(),
    autoch_disc_ids: snowflakeArraySchema,
    rp_channel_ids: snowflakeArraySchema,
    private_channel_ids: snowflakeArraySchema,
    crosschannel_blocklist_ids: snowflakeArraySchema,
    welcome_channel_disc_id: nullableSnowflake,
    thought_log_channel_disc_id: nullableSnowflake,
    welcome_persona_id: z.number().int().positive().nullable().optional(),
    nai_style_tags: tagArraySchema,
    nai_negative_tags: tagArraySchema,
    nai_sampler: z.enum(NAI_IMAGE_SAMPLERS).nullable().optional(),
    nai_steps: z.number().int().min(1).max(50).nullable().optional(),
    nai_scale: z.number().min(0).max(10).nullable().optional(),
    nai_noise_schedule: z.enum(NAI_IMAGE_NOISE_SCHEDULES).nullable().optional(),
    nai_cfg_rescale: z.number().min(0).max(1).nullable().optional(),
    nai_preset_name: nullableString(120),
    nai_exclusive_imggen: z.boolean().optional(),
    server_memteaching_enabled: z.boolean().optional(),
    personal_memories_enabled: z.boolean().optional(),
    self_teaching_enabled: z.boolean().optional(),
    web_search_enabled: z.boolean().optional(),
    imagegen_enabled: z.boolean().optional(),
    videogen_enabled: z.boolean().optional(),
    voice_message_enabled: z.boolean().optional(),
    voice_transcript_chat_mode: z.boolean().optional(),
    tool_use_enabled: z.boolean().optional(),
    manage_message_enabled: z.boolean().optional(),
    prompt_snapshot_enabled: z.boolean().optional(),
    self_debug_enabled: z.boolean().optional(),
    stm_privacy_bypass: z.boolean().optional(),
    message_fetch_limit: z.number().int().min(20).max(100).optional(),
    match_limit: z.number().int().min(1).max(10).optional(),
    cascade_limit: z.number().int().min(0).max(10).optional(),
    send_message_limit: z.number().int().min(0).max(40).optional(),
    timezone_offset: z.number().int().min(-12).max(14).optional(),
    context_note_depth: z.number().int().min(0).max(100).optional(),
    context_note: nullableString(4000),
    system_prompt: nullableString(8000),
    welcome_prompt: nullableString(4000),
  })
  .strict();

const personaUpdateSchema = z
  .object({
    tomori_nickname: z.string().trim().min(1).max(80).optional(),
    context_note: nullableString(4000),
    context_note_depth: z.number().int().min(0).max(100).optional(),
    nai_tags: z.array(z.string().trim().min(1).max(120)).max(80).optional(),
  })
  .strict();

const memoryCreateSchema = z
  .object({
    tomoriId: z.number().int().positive(),
    content: z.string().trim().min(1),
  })
  .strict();

const memoryUpdateSchema = z
  .object({
    content: z.string().trim().min(1),
  })
  .strict();

const myServerMemoryCreateSchema = z
  .object({
    personaLineageId: z.number().int().nonnegative(),
    content: z.string().trim().min(1),
  })
  .strict();

const personalMemoryCreateSchema = z
  .object({
    personaLineageId: z.number().int().nonnegative(),
    content: z.string().trim().min(1),
  })
  .strict();

const personalMemoryUpdateSchema = z
  .object({
    content: z.string().trim().min(1),
  })
  .strict();

const fallbackRefSchema = z
  .object({
    type: z.enum(["llm", "custom_endpoint"]),
    id: z.number().int().positive(),
  })
  .strict();

const fallbackUpdateSchema = z
  .object({
    refs: z.array(fallbackRefSchema).max(5),
  })
  .strict();

const customEndpointSchema = z
  .object({
    scope: z.enum(["server", "personal"]).default("server"),
    label: z.string().trim().min(1).max(48).regex(/^[a-zA-Z0-9_-]+$/),
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
    endpointUrl: z.string().trim().url().max(2048),
    displayName: z.string().trim().min(1).max(120),
    modelName: nullableString(180),
    authToken: nullableString(4000),
    numCtx: z.number().int().min(512).max(2000000).nullable().optional(),
    hasTools: z.boolean().optional(),
    seesImages: z.boolean().optional(),
    seesVideos: z.boolean().optional(),
    supportsStructOutput: z.boolean().optional(),
  })
  .strict();

const customEndpointDeleteSchema = z
  .object({
    scope: z.enum(["server", "personal"]),
    label: z.string().trim().min(1).max(48),
    capability: z.enum(["text", "embedding", "image", "video", "speech", "transcription"]),
  })
  .strict();

const channelWhitelistSchema = z
  .object({
    channelDiscId: snowflakeSchema,
    cooldownType: z.number().int().min(0).max(4).nullable().optional(),
    cooldownLength: z.number().int().min(0).max(86400).nullable().optional(),
  })
  .strict();

const roleWhitelistSchema = z
  .object({
    roleDiscId: snowflakeSchema,
  })
  .strict();

const memoryImportSchema = z
  .object({
    kind: z.enum(["server", "personal"]),
    personaLineageId: z.number().int().nonnegative(),
    memories: z.array(z.string().trim().min(1)).max(500),
  })
  .strict();

const personalSettingsUpdateSchema = z
  .object({
    user_nickname: z.string().trim().min(1).max(80).optional(),
    language_pref: z.string().trim().min(2).max(16).optional(),
    privacy_level: z.nativeEnum(PrivacyLevel).optional(),
    personal_dtm: z.enum(["off", "follow", "on"]).optional(),
    shortterm_cache_crossserver_opt_in: z.boolean().optional(),
    impersonation_prompt: nullableString(4000),
    nai_char_tags: tagArraySchema,
    nai_char_ref_url: nullableString(2048),
  })
  .strict();

const personalProviderCapabilitySchema = z.enum(["text", "embedding", "image", "video", "vision"]);
const providerNameSchema = z.string().trim().toLowerCase().min(1).max(120);

const personalProviderCredentialSchema = z
  .object({
    provider: providerNameSchema,
    apiKey: z.string().trim().min(10).max(4000),
    validateApiKey: z.boolean().optional().default(true),
  })
  .strict();

const personalProviderUpdateSchema = z
  .object({
    provider: providerNameSchema,
    enabledCapabilities: z.array(personalProviderCapabilitySchema).max(5).optional(),
    llmId: z.number().int().positive().nullable().optional(),
    visionLlmId: z.number().int().positive().nullable().optional(),
    embeddingModelId: z.number().int().positive().nullable().optional(),
    imageModelId: z.number().int().positive().nullable().optional(),
    videoModelId: z.number().int().positive().nullable().optional(),
    fallbackRefs: z.array(fallbackRefSchema).max(5).optional(),
  })
  .strict();

const personalProviderDeleteSchema = z
  .object({
    provider: providerNameSchema,
  })
  .strict();

const openRouterRegistrationSchema = z
  .object({
    capability: z.enum(["text", "embedding", "image", "video"]),
    modelName: z.string().trim().min(1).max(240),
  })
  .strict();

const openRouterRegistrationDeleteSchema = z
  .object({
    capability: z.enum(["text", "embedding", "image", "video"]),
    modelName: z.string().trim().min(1).max(240),
  })
  .strict();

const CONFIG_FIELD_DEFINITIONS: ConfigFieldDefinition[] = [
  {
    key: "llm_id",
    label: "Text Model",
    group: "Models",
    type: "select",
    optionsKey: "llms",
    valueType: "number",
    nullable: true,
  },
  {
    key: "vision_llm_id",
    label: "Vision Model",
    group: "Models",
    type: "select",
    optionsKey: "visionLlms",
    valueType: "number",
    nullable: true,
  },
  {
    key: "embedding_model_id",
    label: "Embedding Model",
    group: "Models",
    type: "select",
    optionsKey: "embeddingModels",
    valueType: "number",
    nullable: true,
  },
  {
    key: "diffusion_model_id",
    label: "Image Model",
    group: "Models",
    type: "select",
    optionsKey: "diffusionModels",
    valueType: "number",
    nullable: true,
  },
  {
    key: "nai_diffusion_model_id",
    label: "NovelAI Image Model",
    group: "Models",
    type: "select",
    optionsKey: "naiDiffusionModels",
    valueType: "number",
    nullable: true,
  },
  {
    key: "video_model_id",
    label: "Video Model",
    group: "Models",
    type: "select",
    optionsKey: "videoModels",
    valueType: "number",
    nullable: true,
  },
  {
    key: "thinking_level",
    label: "Thinking Level",
    group: "Models",
    type: "select",
    optionsKey: "thinkingLevels",
    valueType: "string",
  },
  { key: "llm_temperature", label: "Temperature", group: "Sampling", type: "number", min: 0, max: 2 },
  { key: "llm_top_p", label: "Top P", group: "Sampling", type: "number", min: 0, max: 1 },
  { key: "llm_top_k", label: "Top K", group: "Sampling", type: "number", min: 0, max: 40 },
  { key: "llm_frequency_penalty", label: "Frequency Penalty", group: "Sampling", type: "number", min: -2, max: 2 },
  { key: "llm_presence_penalty", label: "Presence Penalty", group: "Sampling", type: "number", min: -2, max: 2 },
  { key: "llm_min_p", label: "Min P", group: "Sampling", type: "number", min: 0, max: 1 },
  { key: "user_byok_mode", label: "Require User BYOK", group: "Provider Access", type: "boolean" },
  { key: "always_reply_enabled", label: "Always Reply", group: "Conversation", type: "boolean" },
  { key: "deliberate_trigger_mode", label: "Deliberate Trigger Mode", group: "Conversation", type: "boolean" },
  {
    key: "cooldown_type",
    label: "Trigger Cooldown Type",
    group: "Cooldowns",
    type: "select",
    optionsKey: "cooldownTypes",
    valueType: "number",
  },
  { key: "cooldown_length", label: "Cooldown Length Seconds", group: "Cooldowns", type: "number", min: 1, max: 86400 },
  {
    key: "humanizer_degree",
    label: "Humanizer Degree",
    group: "Conversation",
    type: "select",
    optionsKey: "humanizerDegrees",
    valueType: "number",
  },
  { key: "message_fetch_limit", label: "Message Fetch Limit", group: "Conversation", type: "number", min: 20, max: 100 },
  { key: "match_limit", label: "Persona Match Limit", group: "Conversation", type: "number", min: 1, max: 10 },
  { key: "cascade_limit", label: "Cascade Limit", group: "Conversation", type: "number", min: 0, max: 10 },
  { key: "send_message_limit", label: "Send Message Limit", group: "Conversation", type: "number", min: 0, max: 40 },
  { key: "emoji_usage_enabled", label: "Emoji Usage", group: "Conversation", type: "boolean" },
  { key: "sticker_usage_enabled", label: "Sticker Usage", group: "Conversation", type: "boolean" },
  { key: "hide_respond_embed", label: "Hide Respond Notices", group: "Conversation", type: "boolean" },
  { key: "hide_impersonation_embeds", label: "Hide Impersonation Notices", group: "Conversation", type: "boolean" },
  { key: "autoch_threshold", label: "Autochat Min Threshold", group: "Autochat", type: "number", min: 0, max: 10000 },
  { key: "autoch_threshold_max", label: "Autochat Max Threshold", group: "Autochat", type: "number", min: 0, max: 10000 },
  {
    key: "autoch_disc_ids",
    label: "Autochat Channels",
    group: "Autochat",
    type: "multi-select",
    optionsKey: "channels",
    valueType: "string",
  },
  { key: "server_memteaching_enabled", label: "Server Memory Teaching", group: "Memory", type: "boolean" },
  { key: "personal_memories_enabled", label: "Personal Memories", group: "Memory", type: "boolean" },
  { key: "self_teaching_enabled", label: "Self Teaching", group: "Memory", type: "boolean" },
  { key: "context_note", label: "Context Note", group: "Memory", type: "textarea", nullable: true },
  { key: "context_note_depth", label: "Context Note Depth", group: "Memory", type: "number", min: 0, max: 100 },
  { key: "web_search_enabled", label: "Web Search", group: "Tools", type: "boolean" },
  { key: "tool_use_enabled", label: "Tool Use", group: "Tools", type: "boolean" },
  { key: "manage_message_enabled", label: "Message Management", group: "Tools", type: "boolean" },
  {
    key: "rp_channel_ids",
    label: "Roleplay Suppression Channels",
    group: "Channel Rules",
    type: "multi-select",
    optionsKey: "channels",
    valueType: "string",
  },
  {
    key: "private_channel_ids",
    label: "Private STM Channels",
    group: "Channel Rules",
    type: "multi-select",
    optionsKey: "channels",
    valueType: "string",
  },
  {
    key: "crosschannel_blocklist_ids",
    label: "Cross-channel Blocklist",
    group: "Channel Rules",
    type: "multi-select",
    optionsKey: "channels",
    valueType: "string",
  },
  { key: "imagegen_enabled", label: "Image Generation", group: "Media", type: "boolean" },
  { key: "videogen_enabled", label: "Video Generation", group: "Media", type: "boolean" },
  { key: "voice_message_enabled", label: "Voice Messages", group: "Media", type: "boolean" },
  { key: "voice_transcript_chat_mode", label: "Voice Transcript Chat Mode", group: "Media", type: "boolean" },
  { key: "nai_exclusive_imggen", label: "NovelAI Exclusive Image Tool", group: "NovelAI", type: "boolean" },
  { key: "nai_style_tags", label: "NovelAI Style Tags", group: "NovelAI", type: "tags" },
  { key: "nai_negative_tags", label: "NovelAI Negative Tags", group: "NovelAI", type: "tags" },
  {
    key: "nai_preset_name",
    label: "NovelAI Text Preset",
    group: "NovelAI",
    type: "select",
    optionsKey: "naiPresets",
    valueType: "string",
    nullable: true,
  },
  {
    key: "nai_sampler",
    label: "NovelAI Image Sampler",
    group: "NovelAI",
    type: "select",
    optionsKey: "naiSamplers",
    valueType: "string",
    nullable: true,
  },
  { key: "nai_steps", label: "NovelAI Steps", group: "NovelAI", type: "number", min: 1, max: 50, nullable: true },
  { key: "nai_scale", label: "NovelAI Scale", group: "NovelAI", type: "number", min: 0, max: 10, nullable: true },
  {
    key: "nai_noise_schedule",
    label: "NovelAI Noise Schedule",
    group: "NovelAI",
    type: "select",
    optionsKey: "naiNoiseSchedules",
    valueType: "string",
    nullable: true,
  },
  {
    key: "nai_cfg_rescale",
    label: "NovelAI CFG Rescale",
    group: "NovelAI",
    type: "number",
    min: 0,
    max: 1,
    nullable: true,
  },
  {
    key: "welcome_channel_disc_id",
    label: "Welcome Channel",
    group: "Welcome and Logs",
    type: "select",
    optionsKey: "channels",
    valueType: "string",
    nullable: true,
  },
  {
    key: "welcome_persona_id",
    label: "Welcome Persona",
    group: "Welcome and Logs",
    type: "select",
    optionsKey: "personas",
    valueType: "number",
    nullable: true,
  },
  {
    key: "thought_log_channel_disc_id",
    label: "Thought Log Channel",
    group: "Welcome and Logs",
    type: "select",
    optionsKey: "channels",
    valueType: "string",
    nullable: true,
  },
  { key: "prompt_snapshot_enabled", label: "Prompt Snapshots", group: "Admin", type: "boolean" },
  { key: "self_debug_enabled", label: "Self Debug", group: "Admin", type: "boolean" },
  { key: "stm_privacy_bypass", label: "Private STM Bypass", group: "Admin", type: "boolean" },
  { key: "uncensor_injection_enabled", label: "Uncensor Injection", group: "Admin", type: "boolean" },
  { key: "uncensor_unicode_space_enabled", label: "Unicode Space Replacement", group: "Admin", type: "boolean" },
  { key: "uncensor_sanitize_enabled", label: "Sensitive Word Sanitization", group: "Admin", type: "boolean" },
  { key: "timezone_offset", label: "Timezone Offset", group: "Admin", type: "number", min: -12, max: 14 },
  { key: "system_prompt", label: "System Prompt", group: "Prompts", type: "textarea", nullable: true },
  { key: "welcome_prompt", label: "Welcome Prompt", group: "Prompts", type: "textarea", nullable: true },
];

function parseBoolean(value: string | undefined): boolean | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function derivePublicUrl(host: string, port: number): string {
  const publicHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
  return `http://${publicHost}:${port}`;
}

function getSettingsWebsiteConfig(client: Client): SettingsWebsiteConfig {
  const enabled = parseBoolean(process.env.WEB_SETTINGS_ENABLED) ?? false;
  const host = process.env.WEB_SETTINGS_HOST?.trim() || "127.0.0.1";
  const port = Number.parseInt(process.env.WEB_SETTINGS_PORT || "3001", 10);
  const publicUrl = trimTrailingSlash(process.env.WEB_SETTINGS_PUBLIC_URL?.trim() || derivePublicUrl(host, port));
  const redirectUri = process.env.WEB_SETTINGS_DISCORD_REDIRECT_URI?.trim() || `${publicUrl}${BASE_PATH}/oauth/callback`;
  const clientId =
    process.env.WEB_SETTINGS_DISCORD_CLIENT_ID?.trim() ||
    process.env.DISCORD_CLIENT_ID?.trim() ||
    client.application?.id ||
    client.user?.id ||
    "";
  const clientSecret =
    process.env.WEB_SETTINGS_DISCORD_CLIENT_SECRET?.trim() || process.env.DISCORD_CLIENT_SECRET?.trim() || "";
  const sessionSecret = process.env.WEB_SETTINGS_SESSION_SECRET?.trim() || process.env.CRYPTO_SECRET || "";
  const secureCookie = parseBoolean(process.env.WEB_SETTINGS_COOKIE_SECURE) ?? publicUrl.startsWith("https://");

  return {
    enabled,
    host,
    port: Number.isFinite(port) ? port : 3001,
    publicUrl,
    redirectUri,
    clientId,
    clientSecret,
    sessionSecret,
    secureCookie,
  };
}

function signValue(value: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(value).digest("base64url");
  return `${value}.${signature}`;
}

function verifySignedValue(signedValue: string | undefined, secret: string): string | null {
  if (!signedValue) return null;
  const separatorIndex = signedValue.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const value = signedValue.slice(0, separatorIndex);
  const signature = signedValue.slice(separatorIndex + 1);
  const expectedSignature = createHmac("sha256", secret).update(value).digest("base64url");
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  return value;
}

function setSignedCookieValue(
  context: Context,
  config: SettingsWebsiteConfig,
  name: string,
  value: string,
  maxAge: number,
): void {
  setCookie(context, name, signValue(value, config.sessionSecret), {
    httpOnly: true,
    maxAge,
    path: BASE_PATH,
    sameSite: "Lax",
    secure: config.secureCookie,
  });
}

function clearCookie(context: Context, config: SettingsWebsiteConfig, name: string): void {
  deleteCookie(context, name, {
    path: BASE_PATH,
    secure: config.secureCookie,
  });
}

function getSession(context: Context, config: SettingsWebsiteConfig): SessionData | null {
  const sessionId = verifySignedValue(getCookie(context, SESSION_COOKIE), config.sessionSecret);
  if (!sessionId) return null;

  const session = sessions.get(sessionId);
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt <= now || session.tokenExpiresAt <= now) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

function requireCsrf(context: Context, session: SessionData): boolean {
  return context.req.header("X-Tomori-CSRF") === session.csrfToken;
}

function jsonError(context: Context, status: 400 | 401 | 403 | 404 | 409 | 500 | 502, message: string) {
  return context.json({ error: message }, status);
}

function discordAvatarUrl(user: DiscordUser): string | null {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`;
}

function discordGuildIconUrl(guild: Pick<DiscordGuild, "id" | "icon">): string | null {
  if (!guild.icon) return null;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128`;
}

function hasAdminPermission(guild: DiscordGuild): boolean {
  if (guild.owner) return true;
  if (!guild.permissions) return false;

  try {
    const permissions = BigInt(guild.permissions);
    return (permissions & ADMINISTRATOR_PERMISSION) !== 0n || (permissions & MANAGE_GUILD_PERMISSION) !== 0n;
  } catch {
    return false;
  }
}

async function discordApi<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${DISCORD_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "TomoriBot Settings Website",
    },
  });

  if (!response.ok) {
    throw new Error(`Discord API request failed (${response.status}) for ${path}`);
  }

  return (await response.json()) as T;
}

async function exchangeOAuthCode(config: SettingsWebsiteConfig, code: string) {
  const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "TomoriBot Settings Website",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri,
    }),
  });

  if (!response.ok) {
    throw new Error(`Discord OAuth token exchange failed (${response.status})`);
  }

  return (await response.json()) as {
    access_token: string;
    expires_in: number;
    token_type: string;
    scope: string;
  };
}

async function getSharedGuilds(session: SessionData, client: Client): Promise<DashboardGuild[]> {
  const now = Date.now();
  if (session.guildCache && now - session.guildCache.fetchedAt < GUILD_CACHE_TTL_MS) {
    return session.guildCache.guilds;
  }

  const oauthGuilds = await discordApi<DiscordGuild[]>("/users/@me/guilds", session.accessToken);
  const sharedGuilds = oauthGuilds
    .filter((guild) => client.guilds.cache.has(guild.id))
    .map((guild) => {
      const cachedGuild = client.guilds.cache.get(guild.id);
      return {
        id: guild.id,
        name: cachedGuild?.name ?? guild.name,
        iconUrl: discordGuildIconUrl(cachedGuild ? { id: cachedGuild.id, icon: cachedGuild.icon } : guild),
        memberCount: cachedGuild?.memberCount ?? null,
        canManage: hasAdminPermission(guild),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  session.guildCache = {
    fetchedAt: now,
    guilds: sharedGuilds,
  };

  return sharedGuilds;
}

async function assertSharedGuild(session: SessionData, client: Client, guildId: string): Promise<DashboardGuild | null> {
  const sharedGuilds = await getSharedGuilds(session, client);
  return sharedGuilds.find((guild) => guild.id === guildId) ?? null;
}

async function assertGuildAdmin(session: SessionData, client: Client, guildId: string): Promise<DashboardGuild | null> {
  const guild = await assertSharedGuild(session, client, guildId);
  return guild?.canManage ? guild : null;
}

async function loadGuildState(guildId: string) {
  const personas = await loadAllPersonasForServer(guildId);
  if (!personas.length) {
    return null;
  }

  const mainPersona = personas.find((persona) => !persona.is_alter) ?? personas[0];
  return {
    mainPersona,
    personas,
    serverId: mainPersona.server_id,
    config: mainPersona.config,
  };
}

type GuildState = NonNullable<Awaited<ReturnType<typeof loadGuildState>>>;

function serializeConfig(config: GuildState["config"]) {
  const serialized: Record<string, unknown> = {};
  for (const definition of CONFIG_FIELD_DEFINITIONS) {
    serialized[definition.key] = config[definition.key];
  }
  return serialized;
}

function serializePersona(persona: GuildState["personas"][number]) {
  return {
    tomoriId: persona.tomori_id,
    personaLineageId: persona.persona_lineage_id ?? 0,
    nickname: persona.tomori_nickname,
    isAlter: persona.is_alter,
    contextNote: persona.context_note ?? "",
    contextNoteDepth: persona.context_note_depth ?? 0,
    naiTags: persona.nai_tags ?? [],
    memoryCount: persona.server_memories.length,
  };
}

function serializePersonaOption(persona: GuildState["personas"][number]) {
  return {
    personaLineageId: persona.persona_lineage_id ?? 0,
    nickname: persona.tomori_nickname,
    isAlter: persona.is_alter,
  };
}

async function listServerMemories(serverId: number, personaLineageId: number) {
  return await sql`
    SELECT
      sm.server_memory_id,
      sm.server_id,
      sm.tomori_id,
      sm.persona_lineage_id,
      sm.user_id,
      sm.content,
      sm.created_at,
      sm.updated_at,
      u.user_disc_id,
      u.user_nickname
    FROM server_memories sm
    LEFT JOIN users u ON u.user_id = sm.user_id
    WHERE sm.server_id = ${serverId}
      AND sm.persona_lineage_id = ${personaLineageId}
    ORDER BY sm.created_at DESC, sm.server_memory_id DESC
  `;
}

async function listUserServerMemories(serverId: number, personaLineageId: number, userId: number) {
  return await sql`
    SELECT
      sm.server_memory_id,
      sm.server_id,
      sm.tomori_id,
      sm.persona_lineage_id,
      sm.user_id,
      sm.content,
      sm.created_at,
      sm.updated_at,
      u.user_disc_id,
      u.user_nickname
    FROM server_memories sm
    LEFT JOIN users u ON u.user_id = sm.user_id
    WHERE sm.server_id = ${serverId}
      AND sm.persona_lineage_id = ${personaLineageId}
      AND sm.user_id = ${userId}
    ORDER BY sm.created_at DESC, sm.server_memory_id DESC
  `;
}

function serializeServerMemory(row: Record<string, unknown>) {
  return {
    serverMemoryId: row.server_memory_id,
    tomoriId: row.tomori_id,
    personaLineageId: Number(row.persona_lineage_id ?? 0),
    content: row.content,
    taughtBy: row.user_nickname ?? row.user_disc_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findDuplicateMemory(serverId: number, personaLineageId: number, content: string, excludeMemoryId?: number) {
  const normalizedContent = content.trim().toLowerCase();
  const rows =
    excludeMemoryId === undefined
      ? await sql`
          SELECT server_memory_id
          FROM server_memories
          WHERE server_id = ${serverId}
            AND persona_lineage_id = ${personaLineageId}
            AND lower(trim(content)) = ${normalizedContent}
          LIMIT 1
        `
      : await sql`
          SELECT server_memory_id
          FROM server_memories
          WHERE server_id = ${serverId}
            AND persona_lineage_id = ${personaLineageId}
            AND server_memory_id <> ${excludeMemoryId}
            AND lower(trim(content)) = ${normalizedContent}
          LIMIT 1
        `;

  return rows.length > 0;
}

async function ensureSessionUser(session: SessionData) {
  return await registerUser(session.user.id, session.user.global_name || session.user.username, "en-US");
}

function toOption(value: string | number, label: string) {
  return { value, label };
}

function loadGuildOptionData(client: Client, guildId: string, personas: GuildState["personas"] = []) {
  const guild = client.guilds.cache.get(guildId);
  const channels =
    guild?.channels.cache
      .map((channel) => ({
        value: channel.id,
        label: `${"name" in channel && channel.name ? `#${channel.name}` : channel.id}`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)) ?? [];
  const roles =
    guild?.roles.cache
      .filter((role) => role.id !== guildId)
      .map((role) => ({
        value: role.id,
        label: `@${role.name}`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)) ?? [];

  return {
    channels,
    roles,
    personas: personas
      .map((persona) => ({
        value: persona.tomori_id,
        label: `${persona.tomori_nickname}${persona.is_alter ? " (alter)" : " (main)"}`,
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
  };
}

async function listPersonalMemories(userId: number, personaLineageId: number) {
  return await sql`
    SELECT
      personal_memory_id,
      user_id,
      persona_lineage_id,
      content,
      created_at,
      updated_at
    FROM personal_memories
    WHERE user_id = ${userId}
      AND persona_lineage_id = ${personaLineageId}
    ORDER BY created_at DESC, personal_memory_id DESC
  `;
}

async function listChannelWhitelist(serverId: number) {
  return await sql`
    SELECT channel_disc_id, cooldown_type, cooldown_length, created_at, updated_at
    FROM channel_whitelist
    WHERE server_id = ${serverId}
    ORDER BY channel_disc_id ASC
  `;
}

async function listRoleWhitelist(serverId: number) {
  return await sql`
    SELECT role_disc_id, created_at, updated_at
    FROM role_whitelist
    WHERE server_id = ${serverId}
    ORDER BY role_disc_id ASC
  `;
}

async function findDuplicatePersonalMemory(
  userId: number,
  personaLineageId: number,
  content: string,
  excludeMemoryId?: number,
) {
  const normalizedContent = content.trim().toLowerCase();
  const rows =
    excludeMemoryId === undefined
      ? await sql`
          SELECT personal_memory_id
          FROM personal_memories
          WHERE user_id = ${userId}
            AND persona_lineage_id = ${personaLineageId}
            AND lower(trim(content)) = ${normalizedContent}
          LIMIT 1
        `
      : await sql`
          SELECT personal_memory_id
          FROM personal_memories
          WHERE user_id = ${userId}
            AND persona_lineage_id = ${personaLineageId}
            AND personal_memory_id <> ${excludeMemoryId}
            AND lower(trim(content)) = ${normalizedContent}
          LIMIT 1
        `;

  return rows.length > 0;
}

function serializePersonalMemory(memory: {
  personal_memory_id?: unknown;
  user_id?: unknown;
  persona_lineage_id?: unknown;
  content?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
}) {
  return {
    personalMemoryId: memory.personal_memory_id,
    userId: memory.user_id,
    personaLineageId: Number(memory.persona_lineage_id ?? 0),
    content: memory.content,
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
  };
}

async function loadDashboardModelOptions() {
  const [llms, embeddingModels, diffusionModels, videoModels, kayraPresets, eratoPresets] = await Promise.all([
    sql`
      SELECT llm_id, llm_provider, llm_codename, is_default, is_free, has_tools, sees_images
      FROM llms
      WHERE COALESCE(is_deprecated, false) = false
        AND COALESCE(is_scoped_registration, false) = false
      ORDER BY llm_provider ASC, is_default DESC, llm_codename ASC
    `,
    sql`
      SELECT embedding_model_id, provider, codename, model_family, is_default
      FROM embedding_models
      WHERE COALESCE(is_deprecated, false) = false
        AND COALESCE(is_scoped_registration, false) = false
      ORDER BY provider ASC, is_default DESC, codename ASC
    `,
    sql`
      SELECT diffusion_model_id, provider, codename, is_default, is_free
      FROM image_diffusion_models
      WHERE COALESCE(is_deprecated, false) = false
        AND COALESCE(is_scoped_registration, false) = false
      ORDER BY provider ASC, is_default DESC, codename ASC
    `,
    sql`
      SELECT video_model_id, provider, codename, is_default, is_free
      FROM video_generation_models
      WHERE COALESCE(is_deprecated, false) = false
        AND COALESCE(is_scoped_registration, false) = false
      ORDER BY provider ASC, is_default DESC, codename ASC
    `,
    loadNaiPresetsForModel("kayra"),
    loadNaiPresetsForModel("erato"),
  ]);

  const formatBadges = (badges: Array<string | false | null | undefined>) =>
    badges.filter(Boolean).length ? ` (${badges.filter(Boolean).join(", ")})` : "";
  const toLlmOption = (row: Record<string, unknown>) => ({
    value: Number(row.llm_id),
    label: `${row.llm_provider}/${row.llm_codename}${formatBadges([
      row.is_default ? "default" : false,
      row.is_free ? "free" : false,
      row.has_tools ? "tools" : false,
      row.sees_images ? "vision" : false,
    ])}`,
  });

  return {
    llms: llms.map(toLlmOption),
    visionLlms: llms.filter((row) => row.sees_images).map(toLlmOption),
    embeddingModels: embeddingModels.map((row) => ({
      value: Number(row.embedding_model_id),
      label: `${row.provider}/${row.codename}${formatBadges([row.model_family as string, row.is_default ? "default" : false])}`,
    })),
    diffusionModels: diffusionModels.map((row) => ({
      value: Number(row.diffusion_model_id),
      label: `${row.provider}/${row.codename}${formatBadges([
        row.is_default ? "default" : false,
        row.is_free ? "free" : false,
      ])}`,
    })),
    naiDiffusionModels: diffusionModels
      .filter((row) => String(row.provider).toLowerCase() === "novelai")
      .map((row) => ({
        value: Number(row.diffusion_model_id),
        label: `${row.provider}/${row.codename}${formatBadges([
          row.is_default ? "default" : false,
          row.is_free ? "free" : false,
        ])}`,
      })),
    videoModels: videoModels.map((row) => ({
      value: Number(row.video_model_id),
      label: `${row.provider}/${row.codename}${formatBadges([
        row.is_default ? "default" : false,
        row.is_free ? "free" : false,
      ])}`,
    })),
    thinkingLevels: THINKING_LEVEL_VALUES.map((value) => ({
      value,
      label: value.charAt(0).toUpperCase() + value.slice(1),
    })),
    cooldownTypes: [
      toOption(0, "Off"),
      toOption(1, "Per user"),
      toOption(2, "Per channel"),
      toOption(3, "Server-wide"),
      toOption(4, "Strict server-wide"),
    ],
    humanizerDegrees: [toOption(0, "None"), toOption(1, "Light"), toOption(2, "Medium"), toOption(3, "Heavy")],
    naiSamplers: NAI_IMAGE_SAMPLERS.map((value) => toOption(value, value)),
    naiNoiseSchedules: NAI_IMAGE_NOISE_SCHEDULES.map((value) => toOption(value, value)),
    naiPresets: Array.from(new Set([...kayraPresets, ...eratoPresets].map((preset) => preset.preset_name))).map(
      (value) => toOption(value, value),
    ),
  };
}

function serializeSavedProvider(provider: Record<string, unknown>) {
  return {
    provider: provider.provider,
    displayName: getProviderDisplayName(String(provider.provider ?? "")),
    hasApiKey: Boolean(provider.api_key),
    llmId: provider.llm_id ?? null,
    embeddingModelId: provider.embedding_model_id ?? null,
    diffusionModelId: provider.diffusion_model_id ?? null,
    naiDiffusionModelId: provider.nai_diffusion_model_id ?? null,
    videoModelId: provider.video_model_id ?? null,
    visionLlmId: provider.vision_llm_id ?? null,
    enabledCapabilities: provider.enabled_capabilities ?? [],
    fallbackRefs: provider.fallback_model_refs ?? [],
  };
}

function serializeCustomEndpoint(endpoint: Record<string, unknown>) {
  return {
    customEndpointId: endpoint.custom_endpoint_id,
    scope: endpoint.server_id ? "server" : "personal",
    label: endpoint.label,
    capability: endpoint.capability,
    apiStyle: endpoint.api_style,
    endpointUrl: endpoint.endpoint_url,
    modelName: endpoint.model_name,
    displayName: endpoint.display_name,
    numCtx: endpoint.num_ctx,
    requiresAuth: endpoint.requires_auth,
    hasTools: endpoint.has_tools,
    seesImages: endpoint.sees_images,
    seesVideos: endpoint.sees_videos,
    supportsStructOutput: endpoint.supports_structoutput,
    isDefault: endpoint.is_default,
  };
}

function serializePersonalSettings(user: UserRow) {
  return {
    userNickname: user.user_nickname,
    languagePref: user.language_pref,
    privacyLevel: user.privacy_level ?? PrivacyLevel.MINIMAL,
    personalDtm: user.personal_dtm ?? "follow",
    shorttermCacheCrossserverOptIn: user.shortterm_cache_crossserver_opt_in ?? false,
    impersonationPrompt: user.impersonation_prompt ?? "",
    naiCharTags: user.nai_char_tags ?? [],
    naiCharRefUrl: user.nai_char_ref_url ?? "",
  };
}

function serializeOpenRouterRegistration(entry: {
  capability: OpenRouterModelCapability;
  codename: string;
  description: string | null;
  modelId: number;
}) {
  return {
    capability: entry.capability,
    codename: entry.codename,
    description: entry.description,
    modelId: entry.modelId,
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function providerModelOption(value: number, label: string, provider?: string) {
  return {
    value,
    label: provider ? `${provider}/${label}` : label,
  };
}

async function loadPersonalProviderModelOptions(
  userId: number,
  providers: UserSavedProviderConfigRow[],
  personalCustomEndpoints: Array<Record<string, unknown>>,
) {
  const options: Record<string, Record<string, Array<{ value: string | number; label: string }>>> = {};

  for (const providerRow of providers) {
    const provider = providerRow.provider.toLowerCase();
    const isCustom = isCustomProvider(provider);

    if (isCustom) {
      const customTextEndpoints = personalCustomEndpoints
        .filter((endpoint) => endpoint.capability === "text")
        .map((endpoint) => ({
          value: `custom_endpoint:${endpoint.custom_endpoint_id}`,
          label: `Custom/${endpoint.label} (${endpoint.display_name})`,
        }));
      options[provider] = {
        text: [],
        vision: [],
        embedding: [],
        image: [],
        video: [],
        fallbackModels: customTextEndpoints,
      };
      continue;
    }

    const [textModels, embeddingModels, imageModels, videoModels, visionModels] = await Promise.all([
      loadAvailableModelsForProvider(provider, false, { kind: "personal", ownerId: userId }),
      loadAvailableEmbeddingModelsForProvider(provider, false, { kind: "personal", ownerId: userId }),
      loadAvailableDiffusionModelsForProvider(provider, false, { kind: "personal", ownerId: userId }),
      loadAvailableVideoGenerationModelsForProvider(provider, false, { kind: "personal", ownerId: userId }),
      loadAvailableModelsForProvider(provider, false, { kind: "personal", ownerId: userId }),
    ]);
    const textOptions =
      textModels
        ?.filter((model) => model.llm_id !== undefined)
        .map((model) => providerModelOption(model.llm_id as number, model.llm_codename, model.llm_provider)) ?? [];
    const visionOptions =
      visionModels
        ?.filter((model) => model.llm_id !== undefined && model.sees_images)
        .map((model) => providerModelOption(model.llm_id as number, model.llm_codename, model.llm_provider)) ?? [];

    options[provider] = {
      text: textOptions,
      vision: visionOptions,
      embedding:
        embeddingModels
          ?.filter((model) => model.embedding_model_id !== undefined)
          .map((model) => providerModelOption(model.embedding_model_id as number, model.codename, model.provider)) ?? [],
      image:
        imageModels
          ?.filter((model) => model.diffusion_model_id !== undefined)
          .map((model) => providerModelOption(model.diffusion_model_id as number, model.codename, model.provider)) ?? [],
      video:
        videoModels
          ?.filter((model) => model.video_model_id !== undefined)
          .map((model) => providerModelOption(model.video_model_id as number, model.codename, model.provider)) ?? [],
      fallbackModels: textOptions.map((option) => ({
        value: `llm:${option.value}`,
        label: option.label,
      })),
    };
  }

  return options;
}

function personalProviderChoices() {
  return getAllProviderChoices()
    .filter((choice) => !isCustomProvider(choice.value))
    .map((choice) => ({
      value: choice.value,
      label: choice.name,
    }));
}

function renderIndexHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TomoriBot Settings</title>
    <link rel="stylesheet" href="${BASE_PATH}/assets/app.css" />
  </head>
  <body>
    <div id="app" class="app-shell">
      <main class="loading-view">
        <div class="loading-mark"></div>
        <p>Loading TomoriBot Settings</p>
      </main>
    </div>
    <script src="${BASE_PATH}/assets/app.js"></script>
  </body>
</html>`;
}

function renderCss(): string {
  return `:root {
  color-scheme: dark;
  --bg: #0e1116;
  --surface: #161b22;
  --surface-strong: #222936;
  --line: #303947;
  --text: #e8edf4;
  --muted: #9aa7b7;
  --blue: #6ea8fe;
  --blue-soft: #1c3352;
  --green: #55d27f;
  --amber: #f4b860;
  --red: #ff6b6b;
  --shadow: 0 18px 50px rgba(0, 0, 0, 0.34);
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  background-color: var(--bg);
  background-image:
    linear-gradient(rgba(8, 5, 13, 0.34), rgba(8, 5, 13, 0.48)),
    url("${BASE_PATH}/assets/tomori_texture5.png");
  background-position:
    center,
    top center;
  background-repeat:
    repeat,
    repeat;
  background-size:
    auto,
    380px 380px;
  background-attachment: fixed;
  color: var(--text);
}

button,
input,
select,
textarea {
  font: inherit;
}

button,
.button-link {
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 8px 12px;
  text-decoration: none;
}

button.primary,
.button-link.primary {
  border-color: var(--blue);
  background: var(--blue);
  color: #07111f;
}

button.danger {
  border-color: #64323b;
  color: var(--red);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.app-shell {
  min-height: 100vh;
}

.loading-view,
.login-view {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

.loading-view p {
  color: var(--muted);
  margin: 12px 0 0;
}

.loading-mark {
  width: 38px;
  height: 38px;
  border: 4px solid var(--line);
  border-top-color: var(--blue);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.login-panel {
  width: min(440px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
  padding: 28px;
}

.login-panel h1,
.login-panel p {
  margin: 0 0 16px;
}

.login-panel p {
  color: var(--muted);
  line-height: 1.5;
}

.dashboard {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px 1fr;
}

.sidebar {
  border-right: 1px solid var(--line);
  background: rgba(18, 23, 31, 0.76);
  backdrop-filter: blur(8px);
  padding: 18px;
  position: sticky;
  top: 0;
  height: 100vh;
  overflow: auto;
}

.brand {
  display: grid;
  gap: 12px;
  margin-bottom: 18px;
}

.brand-title {
  font-weight: 760;
}

.sidebar-logo {
  width: 100%;
  max-height: 76px;
  object-fit: contain;
  object-position: left center;
  filter: drop-shadow(0 10px 24px rgba(0, 0, 0, 0.44));
}

.guild-list {
  display: grid;
  gap: 8px;
}

.guild-button {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  min-height: 46px;
}

.guild-button.active {
  border-color: var(--blue);
  background: var(--blue-soft);
}

.guild-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--surface-strong);
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  color: var(--muted);
  overflow: hidden;
}

.guild-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.content {
  min-width: 0;
  padding: 24px;
}

.topbar {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) minmax(220px, 2fr) minmax(120px, 1fr);
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.topbar-side {
  display: grid;
  justify-items: end;
  gap: 8px;
}

.title {
  grid-column: 2;
  text-align: center;
}

.title h1 {
  margin: 0;
  font-size: 26px;
  line-height: 1.2;
}

.title p {
  margin: 6px 0 0;
  color: var(--muted);
}

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid var(--line);
  margin-bottom: 18px;
}

.subtabs {
  margin-bottom: 16px;
}

.tab {
  border: 0;
  border-bottom: 3px solid transparent;
  border-radius: 0;
  background: transparent;
  min-height: 42px;
}

.tab.active {
  color: var(--blue);
  border-bottom-color: var(--blue);
}

.panel {
  background: rgba(22, 27, 34, 0.76);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 18px;
  backdrop-filter: blur(8px);
}

.panel + .panel {
  margin-top: 16px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-header h2 {
  margin: 0;
  font-size: 18px;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 14px;
}

.field {
  display: grid;
  gap: 7px;
}

.field label {
  color: var(--muted);
  font-size: 13px;
  font-weight: 650;
}

.field input,
.field select,
.field textarea {
  width: 100%;
  min-height: 38px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: rgba(34, 41, 54, 0.82);
  color: var(--text);
  padding: 8px 10px;
}

.field textarea {
  min-height: 118px;
  resize: vertical;
  line-height: 1.45;
}

.field select[multiple] {
  min-height: 178px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 8px 10px;
}

.switch-row label {
  color: var(--text);
  font-weight: 650;
}

.switch-row input {
  width: 18px;
  height: 18px;
}

.group-title {
  margin: 22px 0 10px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 760;
  text-transform: uppercase;
}

.group-title:first-child {
  margin-top: 0;
}

.status {
  min-height: 24px;
  color: var(--muted);
}

.status.ok {
  color: var(--green);
}

.status.warn {
  color: var(--amber);
}

.status.error {
  color: var(--red);
}

.memory-toolbar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
  align-items: end;
}

.memory-list,
.persona-list {
  display: grid;
  gap: 12px;
}

.memory-item,
.persona-item {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 14px;
  background: rgba(34, 41, 54, 0.72);
  backdrop-filter: blur(6px);
}

.memory-meta,
.persona-meta {
  color: var(--muted);
  font-size: 13px;
  margin-bottom: 10px;
}

.item-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.empty-state {
  color: var(--muted);
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 18px;
  background: rgba(34, 41, 54, 0.66);
}

.toast-stack {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 20;
  display: grid;
  gap: 10px;
  width: min(360px, calc(100vw - 36px));
}

.toast {
  border: 1px solid var(--line);
  border-left: 4px solid var(--blue);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: var(--shadow);
  padding: 12px 14px;
  color: var(--text);
}

.toast.ok {
  border-left-color: var(--green);
}

.toast.warn {
  border-left-color: var(--amber);
}

.toast.error {
  border-left-color: var(--red);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 820px) {
  .dashboard {
    grid-template-columns: 1fr;
  }

  .sidebar {
    position: static;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }

  .content {
    padding: 16px;
  }

  .topbar,
  .panel-header,
  .memory-toolbar {
    grid-template-columns: 1fr;
    flex-direction: column;
    align-items: stretch;
  }

  .topbar-side {
    min-width: 0;
    justify-items: start;
  }

  .title {
    grid-column: auto;
    text-align: left;
  }

  .sidebar-logo {
    max-width: min(360px, 78vw);
  }
}`;
}

function renderJs(): string {
  return `(() => {
  const BASE = "${BASE_PATH}";
  const app = document.getElementById("app");
  const state = {
    me: null,
    csrfToken: "",
    guilds: [],
    activeGuildId: "",
    overview: null,
    tab: "settings",
    settingsSection: "models",
    memories: [],
    memoryPersonaLineageId: "",
    myServerMemories: [],
    myServerMemoryPersonaLineageId: "",
    personalMemories: [],
    personalMemoryScope: "global",
    personalMemoryPersonaLineageId: "",
    toastTimer: null,
  };

  const escapeText = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
    );

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    if (["POST", "PATCH", "PUT", "DELETE"].includes((options.method || "GET").toUpperCase())) {
      headers["X-Tomori-CSRF"] = state.csrfToken;
    }

    const response = await fetch(\`\${BASE}/api\${path}\`, {
      ...options,
      credentials: "same-origin",
      headers,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        renderLoggedOut();
      }
      throw new Error(data.error || "Request failed");
    }
    return data;
  }

  function setStatus(message, kind = "") {
    const node = document.querySelector("[data-status]");
    if (!node) return;
    node.className = \`status \${kind}\`;
    node.textContent = message;
  }

  function showToast(message, kind = "ok") {
    const stack = document.querySelector("[data-toast-stack]");
    if (!stack) return;
    stack.innerHTML = \`<div class="toast \${kind}">\${escapeText(message)}</div>\`;
    if (state.toastTimer) {
      window.clearTimeout(state.toastTimer);
    }
    state.toastTimer = window.setTimeout(() => {
      stack.innerHTML = "";
      state.toastTimer = null;
    }, 3200);
  }

  function iconForGuild(guild) {
    if (guild.iconUrl) {
      return \`<span class="guild-icon"><img alt="" src="\${escapeText(guild.iconUrl)}" /></span>\`;
    }
    return \`<span class="guild-icon">\${escapeText(guild.name).slice(0, 1).toUpperCase()}</span>\`;
  }

  function renderLoggedOut() {
    app.innerHTML = \`
      <main class="login-view">
        <section class="login-panel">
          <h1>TomoriBot Settings</h1>
          <p>Sign in with Discord to manage your TomoriBot settings on shared servers.</p>
          <a class="button-link primary" href="\${BASE}/login">Sign In With Discord</a>
        </section>
      </main>
    \`;
  }

  function renderNoGuilds() {
    app.innerHTML = \`
      <main class="login-view">
        <section class="login-panel">
          <h1>No Shared Servers</h1>
          <p>TomoriBot did not find a Discord server that both you and the bot can access.</p>
          <a class="button-link" href="\${BASE}/logout">Sign Out</a>
        </section>
      </main>
    \`;
  }

  function renderDashboardFrame() {
    const guildButtons = state.guilds
      .map(
        (guild) => \`
          <button class="guild-button \${guild.id === state.activeGuildId ? "active" : ""}" data-guild-id="\${guild.id}">
            \${iconForGuild(guild)}
            <span>\${escapeText(guild.name)}</span>
          </button>
        \`,
      )
      .join("");

    app.innerHTML = \`
      <div class="dashboard">
        <aside class="sidebar">
          <div class="brand">
            <img class="sidebar-logo" src="\${BASE}/assets/tomoribot_logo.png" alt="TomoriBot" />
            <div class="memory-meta">\${escapeText(state.me?.globalName || state.me?.username)}</div>
            <a class="button-link" href="\${BASE}/logout">Sign Out</a>
          </div>
          <div class="guild-list">\${guildButtons}</div>
        </aside>
        <main class="content">
          <div data-main></div>
        </main>
      </div>
      <div class="toast-stack" data-toast-stack></div>
    \`;

    document.querySelectorAll("[data-guild-id]").forEach((button) => {
      button.addEventListener("click", () => selectGuild(button.getAttribute("data-guild-id")));
    });
  }

  function renderMain() {
    const main = document.querySelector("[data-main]");
    if (!main) return;
    const guild = state.guilds.find((item) => item.id === state.activeGuildId);
    const title = guild ? guild.name : "Settings";
    const canManage = Boolean(state.overview?.canManage);
    const overviewLoaded = Boolean(state.overview);
    if (overviewLoaded && !canManage && ["settings", "memories", "personas"].includes(state.tab)) {
      state.tab = "my-server-memories";
    }
    const tabs = [
      ...(overviewLoaded && canManage
        ? [
            { id: "settings", label: "Settings" },
            { id: "memories", label: "Server Memories" },
          ]
        : []),
      { id: "personal-settings", label: "My Settings" },
      { id: "my-server-memories", label: "My Taught Memories" },
      { id: "personal-memories", label: "My Memories" },
      { id: "my-providers", label: "My Providers" },
      ...(overviewLoaded && canManage ? [{ id: "personas", label: "Personas" }] : []),
    ];
    const tabHtml = tabs
      .map((tab) => \`<button class="tab \${state.tab === tab.id ? "active" : ""}" data-tab="\${tab.id}">\${tab.label}</button>\`)
      .join("");
    const subtitle = state.overview?.setupComplete
      ? canManage
        ? "Server and personal settings"
        : "Personal settings"
      : "Initial setup required";

    main.innerHTML = \`
      <header class="topbar">
        <div class="title">
          <h1>\${escapeText(title)}</h1>
          <p>\${subtitle}</p>
        </div>
        <div class="topbar-side">
          <div class="status" data-status></div>
        </div>
      </header>
      <nav class="tabs">\${tabHtml}</nav>
      <section data-tab-content></section>
    \`;

    document.querySelectorAll("[data-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.tab = button.getAttribute("data-tab") || "settings";
        renderMain();
      });
    });

    if (!state.overview?.setupComplete) {
      document.querySelector("[data-tab-content]").innerHTML =
        '<div class="empty-state">Run /config setup in Discord before using the dashboard for this server.</div>';
      return;
    }

    if (state.tab === "settings") renderSettings();
    if (state.tab === "memories") renderMemories();
    if (state.tab === "personal-settings") renderPersonalSettings();
    if (state.tab === "my-server-memories") renderMyServerMemories();
    if (state.tab === "personal-memories") renderPersonalMemories();
    if (state.tab === "my-providers") renderMyProviders();
    if (state.tab === "personas") renderPersonas();
  }

  const SETTINGS_SECTIONS = [
    { id: "models", label: "Models" },
    { id: "behavior", label: "Behavior" },
    { id: "access", label: "Access" },
    { id: "memory", label: "Memory" },
    { id: "media", label: "Media" },
    { id: "admin", label: "Admin" },
  ];

  function sectionForGroup(group) {
    if (["Models", "Sampling", "Provider Access"].includes(group)) return "models";
    if (["Conversation", "Cooldowns", "Autochat"].includes(group)) return "behavior";
    if (["Tools", "Channel Rules", "Welcome and Logs"].includes(group)) return "access";
    if (["Memory"].includes(group)) return "memory";
    if (["Media", "NovelAI"].includes(group)) return "media";
    return "admin";
  }

  function groupedSettings(sectionId) {
    return (state.overview.settingDefinitions || [])
      .filter((definition) => sectionForGroup(definition.group) === sectionId)
      .reduce((groups, definition) => {
      groups[definition.group] ||= [];
      groups[definition.group].push(definition);
      return groups;
    }, {});
  }

  function optionHtml(options, selectedValue, nullable = false) {
    const rows = [...(options || [])];
    if (
      selectedValue !== null &&
      selectedValue !== undefined &&
      selectedValue !== "" &&
      !rows.some((option) => String(option.value) === String(selectedValue))
    ) {
      rows.unshift({
        value: selectedValue,
        label: \`Current value #\${selectedValue} (custom or scoped)\`,
      });
    }
    const emptyOption = nullable ? '<option value="">None</option>' : "";
    return (
      emptyOption +
      rows
        .map(
          (option) =>
            \`<option value="\${escapeText(option.value)}" \${String(option.value) === String(selectedValue ?? "") ? "selected" : ""}>\${escapeText(option.label)}</option>\`,
        )
        .join("")
    );
  }

  function multiOptionHtml(options, selectedValues) {
    const selected = new Set((selectedValues || []).map(String));
    return (options || [])
      .map(
        (option) =>
          \`<option value="\${escapeText(option.value)}" \${selected.has(String(option.value)) ? "selected" : ""}>\${escapeText(option.label)}</option>\`,
      )
      .join("");
  }

  function renderSettings() {
    if (!state.overview?.canManage) {
      state.tab = "personal-memories";
      renderMain();
      return;
    }
    const content = document.querySelector("[data-tab-content]");
    const sectionTabs = SETTINGS_SECTIONS.map(
      (section) =>
        \`<button class="tab \${state.settingsSection === section.id ? "active" : ""}" data-settings-section="\${section.id}">\${section.label}</button>\`,
    ).join("");
    const groups = groupedSettings(state.settingsSection);
    const html = Object.entries(groups)
      .map(([group, definitions]) => {
        const fields = definitions
          .map((definition) => {
            const value = state.overview.config[definition.key];
            if (definition.type === "boolean") {
              return \`
                <div class="switch-row" data-setting-field="\${definition.key}" data-setting-type="boolean">
                  <label>\${definition.label}</label>
                  <input type="checkbox" \${value ? "checked" : ""} />
                </div>
              \`;
            }
            if (definition.type === "tags") {
              return \`
                <div class="field" data-setting-field="\${definition.key}" data-setting-type="tags">
                  <label>\${definition.label}</label>
                  <textarea>\${escapeText((value || []).join("\\n"))}</textarea>
                </div>
              \`;
            }
            if (definition.type === "textarea") {
              return \`
                <div class="field" data-setting-field="\${definition.key}" data-setting-type="textarea">
                  <label>\${definition.label}</label>
                  <textarea>\${escapeText(value || "")}</textarea>
                </div>
              \`;
            }
            if (definition.type === "select") {
              return \`
                <div class="field" data-setting-field="\${definition.key}" data-setting-type="select" data-value-type="\${definition.valueType || "string"}" data-nullable="\${definition.nullable ? "true" : "false"}">
                  <label>\${definition.label}</label>
                  <select>\${optionHtml(state.overview.modelOptions?.[definition.optionsKey], value, definition.nullable)}</select>
                </div>
              \`;
            }
            if (definition.type === "multi-select") {
              return \`
                <div class="field" data-setting-field="\${definition.key}" data-setting-type="multi-select" data-value-type="\${definition.valueType || "string"}">
                  <label>\${definition.label}</label>
                  <select multiple size="7">\${multiOptionHtml(state.overview.modelOptions?.[definition.optionsKey], value || [])}</select>
                </div>
              \`;
            }
            return \`
              <div class="field" data-setting-field="\${definition.key}" data-setting-type="\${definition.type}" data-nullable="\${definition.nullable ? "true" : "false"}">
                <label>\${definition.label}</label>
                <input type="\${definition.type === "number" ? "number" : "text"}"
                  value="\${escapeText(value ?? "")}"
                  \${definition.type === "number" ? 'step="any"' : ""}
                  \${definition.min !== undefined ? \`min="\${definition.min}"\` : ""}
                  \${definition.max !== undefined ? \`max="\${definition.max}"\` : ""} />
              </div>
            \`;
          })
          .join("");
        return \`<div class="group-title">\${group}</div><div class="settings-grid">\${fields}</div>\`;
      })
      .join("");

    content.innerHTML = \`
      <nav class="tabs subtabs">\${sectionTabs}</nav>
      <section class="panel">
        <div class="panel-header">
          <h2>\${escapeText(SETTINGS_SECTIONS.find((section) => section.id === state.settingsSection)?.label || "Settings")}</h2>
          <button class="primary" data-save-settings>Save Settings</button>
        </div>
        <div class="memory-meta">Changes here write to the same server config used by Discord commands.</div>
        \${html}
      </section>
      <div data-settings-extra></div>
    \`;

    document.querySelectorAll("[data-settings-section]").forEach((button) => {
      button.addEventListener("click", () => {
        state.settingsSection = button.getAttribute("data-settings-section") || "models";
        renderSettings();
      });
    });
    document.querySelector("[data-save-settings]").addEventListener("click", saveSettings);
    if (state.settingsSection === "models") renderModelTools();
    if (state.settingsSection === "access") renderAccessTools();
    if (state.settingsSection === "memory") renderMemoryTools();
  }

  async function saveSettings() {
    const payload = {};
    document.querySelectorAll("[data-setting-field]").forEach((field) => {
      const key = field.getAttribute("data-setting-field");
      const type = field.getAttribute("data-setting-type");
      if (!key) return;
      if (type === "boolean") {
        payload[key] = field.querySelector("input").checked;
        return;
      }
      if (type === "select") {
        const input = field.querySelector("select");
        const valueType = field.getAttribute("data-value-type") || "string";
        const nullable = field.getAttribute("data-nullable") === "true";
        if (nullable && input.value === "") {
          payload[key] = null;
          return;
        }
        payload[key] = valueType === "number" ? Number(input.value) : input.value;
        return;
      }
      if (type === "multi-select") {
        const input = field.querySelector("select");
        const valueType = field.getAttribute("data-value-type") || "string";
        payload[key] = Array.from(input.selectedOptions).map((option) =>
          valueType === "number" ? Number(option.value) : option.value,
        );
        return;
      }
      if (type === "tags") {
        payload[key] = field
          .querySelector("textarea")
          .value.split(/\\n|,/)
          .map((item) => item.trim())
          .filter(Boolean);
        return;
      }
      if (type === "number") {
        const input = field.querySelector("input");
        const nullable = field.getAttribute("data-nullable") === "true";
        payload[key] = nullable && input.value === "" ? null : Number(input.value);
        return;
      }
      const input = field.querySelector("textarea, input");
      payload[key] = input.value;
    });

    try {
      setStatus("Saving...", "warn");
      const result = await api(\`/guilds/\${state.activeGuildId}/config\`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      state.overview.config = result.config;
      renderMain();
      setStatus("Saved", "ok");
      showToast("Settings saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  function labelFor(options, value) {
    return (options || []).find((option) => String(option.value) === String(value))?.label || value;
  }

  function renderModelTools() {
    const extra = document.querySelector("[data-settings-extra]");
    if (!extra) return;
    const integrations = state.overview.integrations || {};
    const allEndpoints = [
      ...(integrations.customEndpoints || []),
      ...(integrations.personalCustomEndpoints || []),
    ];
    const providerRows = [
      ...(integrations.savedProviders || []).map((provider) => ({ ...provider, scope: "Server" })),
      ...(integrations.personalSavedProviders || []).map((provider) => ({ ...provider, scope: "Personal" })),
    ];
    const endpointRows = allEndpoints
      .map(
        (endpoint) => \`
          <article class="memory-item">
            <div class="memory-meta">\${escapeText(endpoint.scope)} / \${escapeText(endpoint.capability)} / \${escapeText(endpoint.apiStyle)}</div>
            <strong>\${escapeText(endpoint.label)}</strong>
            <div class="memory-meta">\${escapeText(endpoint.displayName)} - \${escapeText(endpoint.endpointUrl)}</div>
            <div class="item-actions">
              <button class="danger" data-delete-endpoint data-scope="\${endpoint.scope}" data-label="\${escapeText(endpoint.label)}" data-capability="\${endpoint.capability}">Delete</button>
            </div>
          </article>
        \`,
      )
      .join("");
    const providerHtml = providerRows.length
      ? providerRows
          .map(
            (provider) => \`
              <article class="memory-item">
                <div class="memory-meta">\${escapeText(provider.scope)} provider</div>
                <strong>\${escapeText(provider.provider)}</strong>
                <div class="memory-meta">API key: \${provider.hasApiKey ? "stored" : "not stored"}</div>
              </article>
            \`,
          )
          .join("")
      : '<div class="empty-state">No saved provider snapshots yet.</div>';
    const fallbackOptions = state.overview.modelOptions?.fallbackModels || [];
    const fallbackRefs = state.overview.fallbackRefs || [];
    const fallbackSlots = [0, 1, 2, 3, 4]
      .map((index) => {
        const ref = fallbackRefs[index];
        const value = ref ? \`\${ref.type}:\${ref.id}\` : "";
        return \`
          <div class="field">
            <label>Fallback \${index + 1}</label>
            <select data-fallback-slot>
              <option value="">None</option>
              \${optionHtml(fallbackOptions, value, false)}
            </select>
          </div>
        \`;
      })
      .join("");

    extra.innerHTML = \`
      <section class="panel">
        <div class="panel-header">
          <h2>Custom Provider Registration</h2>
          <button class="primary" data-save-custom-endpoint>Save Endpoint</button>
        </div>
        <div class="settings-grid" data-custom-endpoint-form>
          <div class="field">
            <label>Scope</label>
            <select data-endpoint-scope>
              <option value="server">Server</option>
              <option value="personal">Personal BYOK</option>
            </select>
          </div>
          <div class="field">
            <label>Label</label>
            <input data-endpoint-label placeholder="local_llm" />
          </div>
          <div class="field">
            <label>Capability</label>
            <select data-endpoint-capability>
              <option value="text">Text</option>
              <option value="embedding">Embedding</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="speech">Speech</option>
              <option value="transcription">Transcription</option>
            </select>
          </div>
          <div class="field">
            <label>API Style</label>
            <select data-endpoint-api-style>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="ollama-native">Ollama native</option>
              <option value="comfyui">ComfyUI</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="elevenlabs-transcription">ElevenLabs transcription</option>
              <option value="tts-clone">TTS clone</option>
              <option value="openai-compatible-transcription">OpenAI-compatible transcription</option>
            </select>
          </div>
          <div class="field">
            <label>Display Name</label>
            <input data-endpoint-display-name placeholder="Local LLM" />
          </div>
          <div class="field">
            <label>Endpoint URL</label>
            <input data-endpoint-url placeholder="http://host.docker.internal:11434/v1" />
          </div>
          <div class="field">
            <label>Model Name</label>
            <input data-endpoint-model-name placeholder="optional" />
          </div>
          <div class="field">
            <label>Auth Token</label>
            <input data-endpoint-auth-token type="password" placeholder="leave blank to keep existing" />
          </div>
          <div class="field">
            <label>Context Size</label>
            <input data-endpoint-num-ctx type="number" min="512" step="1" />
          </div>
          <div class="switch-row">
            <label>Tools</label>
            <input data-endpoint-has-tools type="checkbox" />
          </div>
          <div class="switch-row">
            <label>Sees Images</label>
            <input data-endpoint-sees-images type="checkbox" />
          </div>
          <div class="switch-row">
            <label>Sees Videos</label>
            <input data-endpoint-sees-videos type="checkbox" />
          </div>
          <div class="switch-row">
            <label>Structured Output</label>
            <input data-endpoint-struct-output type="checkbox" />
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Fallback Model Chain</h2>
          <button class="primary" data-save-fallbacks>Save Fallbacks</button>
        </div>
        <div class="settings-grid">\${fallbackSlots}</div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Registered Endpoints</h2></div>
        <div class="memory-list">\${endpointRows || '<div class="empty-state">No custom endpoints registered.</div>'}</div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Saved Providers</h2></div>
        <div class="memory-list">\${providerHtml}</div>
      </section>
    \`;

    document.querySelector("[data-save-custom-endpoint]").addEventListener("click", saveCustomEndpoint);
    document.querySelector("[data-save-fallbacks]").addEventListener("click", saveFallbacks);
    document.querySelectorAll("[data-delete-endpoint]").forEach((button) => {
      button.addEventListener("click", () =>
        deleteCustomEndpoint(button.getAttribute("data-scope"), button.getAttribute("data-label"), button.getAttribute("data-capability")),
      );
    });
  }

  function renderPersonalSettings() {
    const content = document.querySelector("[data-tab-content]");
    if (!content) return;
    const settings = state.overview.personalSettings || {};

    content.innerHTML = \`
      <section class="panel">
        <div class="panel-header">
          <h2>My Settings</h2>
          <button class="primary" data-save-personal-settings>Save Settings</button>
        </div>
        <div class="settings-grid">
          <div class="field">
            <label>Nickname</label>
            <input data-personal-nickname value="\${escapeText(settings.userNickname || "")}" />
          </div>
          <div class="field">
            <label>Language</label>
            <input data-personal-language value="\${escapeText(settings.languagePref || "en-US")}" />
          </div>
          <div class="field">
            <label>Privacy</label>
            <select data-personal-privacy>
              <option value="0" \${Number(settings.privacyLevel ?? 0) === 0 ? "selected" : ""}>Minimal</option>
              <option value="1" \${Number(settings.privacyLevel ?? 0) === 1 ? "selected" : ""}>Partial</option>
              <option value="2" \${Number(settings.privacyLevel ?? 0) === 2 ? "selected" : ""}>Full</option>
            </select>
          </div>
          <div class="field">
            <label>Deliberate Trigger Mode</label>
            <select data-personal-dtm>
              <option value="follow" \${settings.personalDtm === "follow" ? "selected" : ""}>Follow server</option>
              <option value="on" \${settings.personalDtm === "on" ? "selected" : ""}>On</option>
              <option value="off" \${settings.personalDtm === "off" ? "selected" : ""}>Off</option>
            </select>
          </div>
          <div class="switch-row">
            <label>Cross-server STM</label>
            <input data-personal-cross-stm type="checkbox" \${settings.shorttermCacheCrossserverOptIn ? "checked" : ""} />
          </div>
          <div class="field">
            <label>NovelAI Character Tags</label>
            <textarea data-personal-nai-tags>\${escapeText((settings.naiCharTags || []).join("\\n"))}</textarea>
          </div>
          <div class="field">
            <label>NovelAI Character Reference URL</label>
            <input data-personal-nai-ref value="\${escapeText(settings.naiCharRefUrl || "")}" />
          </div>
          <div class="field">
            <label>Impersonation Prompt</label>
            <textarea data-personal-impersonation>\${escapeText(settings.impersonationPrompt || "")}</textarea>
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Personal Settings JSON</h2>
          <div class="item-actions" style="margin-top: 0">
            <button data-export-personal-settings>Export</button>
            <button class="primary" data-import-personal-settings>Import</button>
            <button class="danger" data-reset-personal-settings>Reset</button>
          </div>
        </div>
        <div class="field">
          <label>JSON</label>
          <textarea data-personal-settings-json></textarea>
        </div>
      </section>
    \`;

    document.querySelector("[data-save-personal-settings]").addEventListener("click", savePersonalSettings);
    document.querySelector("[data-export-personal-settings]").addEventListener("click", exportPersonalSettings);
    document.querySelector("[data-import-personal-settings]").addEventListener("click", importPersonalSettings);
    document.querySelector("[data-reset-personal-settings]").addEventListener("click", resetPersonalSettings);
  }

  function collectPersonalSettingsPayload() {
    return {
      user_nickname: document.querySelector("[data-personal-nickname]").value,
      language_pref: document.querySelector("[data-personal-language]").value,
      privacy_level: Number(document.querySelector("[data-personal-privacy]").value),
      personal_dtm: document.querySelector("[data-personal-dtm]").value,
      shortterm_cache_crossserver_opt_in: document.querySelector("[data-personal-cross-stm]").checked,
      impersonation_prompt: document.querySelector("[data-personal-impersonation]").value,
      nai_char_tags: document
        .querySelector("[data-personal-nai-tags]")
        .value.split(/\\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
      nai_char_ref_url: document.querySelector("[data-personal-nai-ref]").value,
    };
  }

  async function savePersonalSettings() {
    try {
      setStatus("Saving personal settings...", "warn");
      const result = await api("/personal-settings", {
        method: "PATCH",
        body: JSON.stringify(collectPersonalSettingsPayload()),
      });
      state.overview.personalSettings = result.personalSettings;
      renderPersonalSettings();
      setStatus("Personal settings saved", "ok");
      showToast("Personal settings saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function exportPersonalSettings() {
    try {
      setStatus("Exporting personal settings...", "warn");
      const result = await api("/personal-settings/export");
      document.querySelector("[data-personal-settings-json]").value = JSON.stringify(result, null, 2);
      setStatus("Personal settings exported", "ok");
      showToast("Personal settings exported", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function importPersonalSettings() {
    try {
      const parsed = JSON.parse(document.querySelector("[data-personal-settings-json]").value);
      setStatus("Importing personal settings...", "warn");
      const result = await api("/personal-settings/import", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      state.overview.personalSettings = result.personalSettings;
      renderPersonalSettings();
      setStatus("Personal settings imported", "ok");
      showToast("Personal settings imported", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function resetPersonalSettings() {
    if (!window.confirm("Reset your personal settings?")) return;
    try {
      setStatus("Resetting personal settings...", "warn");
      const result = await api("/personal-settings", { method: "DELETE" });
      state.overview.personalSettings = result.personalSettings;
      renderPersonalSettings();
      setStatus("Personal settings reset", "ok");
      showToast("Personal settings reset", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  const PERSONAL_PROVIDER_CAPABILITIES = [
    { value: "text", label: "Text" },
    { value: "vision", label: "Vision" },
    { value: "embedding", label: "Embedding" },
    { value: "image", label: "Image" },
    { value: "video", label: "Video" },
  ];

  function personalProviderOptionsHtml(selectedValue = "") {
    return (state.overview.personalProviderChoices || [])
      .map(
        (choice) =>
          \`<option value="\${escapeText(choice.value)}" \${String(choice.value) === String(selectedValue) ? "selected" : ""}>\${escapeText(choice.label)}</option>\`,
      )
      .join("");
  }

  function personalProviderModelField(providerName, label, optionKey, selectedValue, dataName) {
    const options = state.overview.personalProviderModels?.[providerName]?.[optionKey] || [];
    const disabled = options.length || selectedValue ? "" : "disabled";
    return \`
      <div class="field">
        <label>\${label}</label>
        <select data-personal-provider-model="\${dataName}" \${disabled}>\${optionHtml(options, selectedValue ?? "", true)}</select>
      </div>
    \`;
  }

  function personalProviderFallbackSlot(providerName, provider, index) {
    const ref = (provider.fallbackRefs || [])[index];
    const selectedValue = ref ? \`\${ref.type}:\${ref.id}\` : "";
    const options = state.overview.personalProviderModels?.[providerName]?.fallbackModels || [];
    return \`
      <div class="field">
        <label>Fallback \${index + 1}</label>
        <select data-personal-provider-fallback-slot>\${optionHtml(options, selectedValue, true)}</select>
      </div>
    \`;
  }

  function renderMyProviders() {
    const content = document.querySelector("[data-tab-content]");
    if (!content) return;
    const integrations = state.overview.integrations || {};
    const savedProviders = integrations.personalSavedProviders || [];
    const endpointRows = (integrations.personalCustomEndpoints || [])
      .map(
        (endpoint) => \`
          <article class="memory-item">
            <div class="memory-meta">\${escapeText(endpoint.capability)} / \${escapeText(endpoint.apiStyle)}</div>
            <strong>\${escapeText(endpoint.label)}</strong>
            <div class="memory-meta">\${escapeText(endpoint.displayName)} - \${escapeText(endpoint.endpointUrl)}</div>
            <div class="item-actions">
              <button class="danger" data-delete-endpoint data-scope="personal" data-label="\${escapeText(endpoint.label)}" data-capability="\${endpoint.capability}">Delete</button>
            </div>
          </article>
        \`,
      )
      .join("");
    const providerHtml = savedProviders.length
      ? savedProviders
          .map((provider) => {
            const providerName = String(provider.provider || "").toLowerCase();
            const enabledCapabilities = new Set(provider.enabledCapabilities || []);
            const capabilityControls = PERSONAL_PROVIDER_CAPABILITIES.map(
              (capability) => \`
                <div class="switch-row">
                  <label>\${capability.label}</label>
                  <input data-personal-provider-capability type="checkbox" value="\${capability.value}" \${enabledCapabilities.has(capability.value) ? "checked" : ""} />
                </div>
              \`,
            ).join("");
            const modelFields = [
              personalProviderModelField(providerName, "Text Model", "text", provider.llmId, "llmId"),
              personalProviderModelField(providerName, "Vision Model", "vision", provider.visionLlmId, "visionLlmId"),
              personalProviderModelField(
                providerName,
                "Embedding Model",
                "embedding",
                provider.embeddingModelId,
                "embeddingModelId",
              ),
              personalProviderModelField(
                providerName,
                "Image Model",
                "image",
                provider.naiDiffusionModelId ?? provider.diffusionModelId,
                "imageModelId",
              ),
              personalProviderModelField(providerName, "Video Model", "video", provider.videoModelId, "videoModelId"),
            ].join("");
            const fallbackSlots = [0, 1, 2, 3, 4]
              .map((index) => personalProviderFallbackSlot(providerName, provider, index))
              .join("");
            const deleteButton = providerName.startsWith("custom:")
              ? ""
              : \`<button class="danger" data-delete-personal-provider="\${escapeText(providerName)}">Delete Provider</button>\`;

            return \`
              <article class="memory-item" data-personal-provider-card="\${escapeText(providerName)}">
                <div class="memory-meta">Personal provider / \${provider.hasApiKey ? "API key stored" : "API key missing"}</div>
                <strong>\${escapeText(provider.displayName || provider.provider)}</strong>
                <div class="group-title">Capabilities</div>
                <div class="settings-grid">\${capabilityControls}</div>
                <div class="group-title">Models</div>
                <div class="settings-grid">\${modelFields}</div>
                <div class="group-title">Fallback Chain</div>
                <div class="settings-grid">\${fallbackSlots}</div>
                <div class="item-actions">
                  <button class="primary" data-save-personal-provider>Save Provider</button>
                  \${deleteButton}
                </div>
              </article>
            \`;
          })
          .join("")
      : '<div class="empty-state">No saved personal providers yet.</div>';
    const openRouterRows = (state.overview.personalOpenRouterRegistrations || [])
      .map(
        (entry) => \`
          <article class="memory-item">
            <div class="memory-meta">\${escapeText(entry.capability)} / model #\${entry.modelId}</div>
            <strong>\${escapeText(entry.codename)}</strong>
            <div class="memory-meta">\${escapeText(entry.description || "")}</div>
            <div class="item-actions">
              <button class="danger" data-delete-personal-openrouter-model data-capability="\${escapeText(entry.capability)}" data-model-name="\${escapeText(entry.codename)}">Delete</button>
            </div>
          </article>
        \`,
      )
      .join("");

    content.innerHTML = \`
      <section class="panel">
        <div class="panel-header">
          <h2>Provider API Key</h2>
          <button class="primary" data-save-personal-provider-key>Save Key</button>
        </div>
        <div class="settings-grid">
          <div class="field">
            <label>Provider</label>
            <select data-personal-provider-name>\${personalProviderOptionsHtml()}</select>
          </div>
          <div class="field">
            <label>API Key</label>
            <input data-personal-provider-api-key type="password" placeholder="Stored encrypted after save" />
          </div>
          <div class="switch-row">
            <label>Validate Key</label>
            <input data-personal-provider-validate type="checkbox" checked />
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>My Saved Providers</h2></div>
        <div class="memory-list">\${providerHtml}</div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>OpenRouter Model Registration</h2>
          <button class="primary" data-register-personal-openrouter-model>Register Model</button>
        </div>
        <div class="settings-grid">
          <div class="field">
            <label>Capability</label>
            <select data-openrouter-capability>
              <option value="text">Text</option>
              <option value="embedding">Embedding</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </div>
          <div class="field">
            <label>Model Name</label>
            <input data-openrouter-model-name placeholder="provider/model-name" />
          </div>
        </div>
        <div class="memory-list" style="margin-top: 14px">\${openRouterRows || '<div class="empty-state">No personal OpenRouter models registered.</div>'}</div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>My Provider Registration</h2>
          <button class="primary" data-save-custom-endpoint>Save Endpoint</button>
        </div>
        <div class="settings-grid" data-custom-endpoint-form>
          <input data-endpoint-scope type="hidden" value="personal" />
          <div class="field">
            <label>Label</label>
            <input data-endpoint-label placeholder="my_llm" />
          </div>
          <div class="field">
            <label>Capability</label>
            <select data-endpoint-capability>
              <option value="text">Text</option>
              <option value="embedding">Embedding</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="speech">Speech</option>
              <option value="transcription">Transcription</option>
            </select>
          </div>
          <div class="field">
            <label>API Style</label>
            <select data-endpoint-api-style>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="ollama-native">Ollama native</option>
              <option value="comfyui">ComfyUI</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="elevenlabs-transcription">ElevenLabs transcription</option>
              <option value="tts-clone">TTS clone</option>
              <option value="openai-compatible-transcription">OpenAI-compatible transcription</option>
            </select>
          </div>
          <div class="field">
            <label>Display Name</label>
            <input data-endpoint-display-name placeholder="My LLM" />
          </div>
          <div class="field">
            <label>Endpoint URL</label>
            <input data-endpoint-url placeholder="http://host.docker.internal:11434/v1" />
          </div>
          <div class="field">
            <label>Model Name</label>
            <input data-endpoint-model-name placeholder="optional" />
          </div>
          <div class="field">
            <label>Auth Token</label>
            <input data-endpoint-auth-token type="password" placeholder="leave blank to keep existing" />
          </div>
          <div class="field">
            <label>Context Size</label>
            <input data-endpoint-num-ctx type="number" min="512" step="1" />
          </div>
          <div class="switch-row">
            <label>Tools</label>
            <input data-endpoint-has-tools type="checkbox" />
          </div>
          <div class="switch-row">
            <label>Sees Images</label>
            <input data-endpoint-sees-images type="checkbox" />
          </div>
          <div class="switch-row">
            <label>Sees Videos</label>
            <input data-endpoint-sees-videos type="checkbox" />
          </div>
          <div class="switch-row">
            <label>Structured Output</label>
            <input data-endpoint-struct-output type="checkbox" />
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>My Registered Endpoints</h2></div>
        <div class="memory-list">\${endpointRows || '<div class="empty-state">No personal endpoints registered.</div>'}</div>
      </section>
    \`;

    document.querySelector("[data-save-personal-provider-key]").addEventListener("click", savePersonalProviderCredential);
    document.querySelectorAll("[data-save-personal-provider]").forEach((button) => {
      button.addEventListener("click", () => {
        const card = button.closest("[data-personal-provider-card]");
        savePersonalProviderConfig(card.getAttribute("data-personal-provider-card"), card);
      });
    });
    document.querySelectorAll("[data-delete-personal-provider]").forEach((button) => {
      button.addEventListener("click", () => deletePersonalProvider(button.getAttribute("data-delete-personal-provider")));
    });
    document
      .querySelector("[data-register-personal-openrouter-model]")
      .addEventListener("click", registerPersonalOpenRouterModel);
    document.querySelectorAll("[data-delete-personal-openrouter-model]").forEach((button) => {
      button.addEventListener("click", () =>
        deletePersonalOpenRouterModel(button.getAttribute("data-capability"), button.getAttribute("data-model-name")),
      );
    });
    document.querySelector("[data-save-custom-endpoint]").addEventListener("click", saveCustomEndpoint);
    document.querySelectorAll("[data-delete-endpoint]").forEach((button) => {
      button.addEventListener("click", () =>
        deleteCustomEndpoint(button.getAttribute("data-scope"), button.getAttribute("data-label"), button.getAttribute("data-capability")),
      );
    });
  }

  async function savePersonalProviderCredential() {
    const payload = {
      provider: document.querySelector("[data-personal-provider-name]").value,
      apiKey: document.querySelector("[data-personal-provider-api-key]").value,
      validateApiKey: document.querySelector("[data-personal-provider-validate]").checked,
    };
    if (!payload.apiKey.trim()) {
      showToast("Enter an API key first", "error");
      return;
    }
    try {
      setStatus("Saving provider key...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/personal-providers\`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadOverview(state.activeGuildId);
      renderMyProviders();
      setStatus("Provider key saved", "ok");
      showToast("Provider key saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  function nullableNumberFromCard(card, dataName) {
    const input = card.querySelector('[data-personal-provider-model="' + dataName + '"]');
    if (!input || input.value === "") return null;
    return Number(input.value);
  }

  function fallbackRefsFromCard(card) {
    return Array.from(card.querySelectorAll("[data-personal-provider-fallback-slot]"))
      .map((select) => select.value)
      .filter(Boolean)
      .map((value) => {
        const separatorIndex = value.indexOf(":");
        return {
          type: value.slice(0, separatorIndex),
          id: Number(value.slice(separatorIndex + 1)),
        };
      });
  }

  async function savePersonalProviderConfig(provider, card) {
    const payload = {
      provider,
      enabledCapabilities: Array.from(card.querySelectorAll("[data-personal-provider-capability]:checked")).map(
        (input) => input.value,
      ),
      llmId: nullableNumberFromCard(card, "llmId"),
      visionLlmId: nullableNumberFromCard(card, "visionLlmId"),
      embeddingModelId: nullableNumberFromCard(card, "embeddingModelId"),
      imageModelId: nullableNumberFromCard(card, "imageModelId"),
      videoModelId: nullableNumberFromCard(card, "videoModelId"),
      fallbackRefs: fallbackRefsFromCard(card),
    };

    try {
      setStatus("Saving personal provider...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/personal-providers\`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      await loadOverview(state.activeGuildId);
      renderMyProviders();
      setStatus("Personal provider saved", "ok");
      showToast("Personal provider saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function deletePersonalProvider(provider) {
    if (!window.confirm("Delete this saved provider key and model choices?")) return;
    try {
      setStatus("Deleting personal provider...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/personal-providers\`, {
        method: "DELETE",
        body: JSON.stringify({ provider }),
      });
      await loadOverview(state.activeGuildId);
      renderMyProviders();
      setStatus("Personal provider deleted", "ok");
      showToast("Personal provider deleted", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function registerPersonalOpenRouterModel() {
    const payload = {
      capability: document.querySelector("[data-openrouter-capability]").value,
      modelName: document.querySelector("[data-openrouter-model-name]").value,
    };
    if (!payload.modelName.trim()) {
      showToast("Enter an OpenRouter model name first", "error");
      return;
    }
    try {
      setStatus("Registering OpenRouter model...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/personal-openrouter-models\`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadOverview(state.activeGuildId);
      renderMyProviders();
      setStatus("OpenRouter model registered", "ok");
      showToast("OpenRouter model registered", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function deletePersonalOpenRouterModel(capability, modelName) {
    if (!window.confirm("Delete this OpenRouter model registration?")) return;
    try {
      setStatus("Deleting OpenRouter model...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/personal-openrouter-models\`, {
        method: "DELETE",
        body: JSON.stringify({ capability, modelName }),
      });
      await loadOverview(state.activeGuildId);
      renderMyProviders();
      setStatus("OpenRouter model deleted", "ok");
      showToast("OpenRouter model deleted", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function saveCustomEndpoint() {
    const numCtxValue = document.querySelector("[data-endpoint-num-ctx]").value;
    const payload = {
      scope: document.querySelector("[data-endpoint-scope]").value,
      label: document.querySelector("[data-endpoint-label]").value,
      capability: document.querySelector("[data-endpoint-capability]").value,
      apiStyle: document.querySelector("[data-endpoint-api-style]").value,
      endpointUrl: document.querySelector("[data-endpoint-url]").value,
      displayName: document.querySelector("[data-endpoint-display-name]").value,
      modelName: document.querySelector("[data-endpoint-model-name]").value,
      authToken: document.querySelector("[data-endpoint-auth-token]").value,
      numCtx: numCtxValue ? Number(numCtxValue) : null,
      hasTools: document.querySelector("[data-endpoint-has-tools]").checked,
      seesImages: document.querySelector("[data-endpoint-sees-images]").checked,
      seesVideos: document.querySelector("[data-endpoint-sees-videos]").checked,
      supportsStructOutput: document.querySelector("[data-endpoint-struct-output]").checked,
    };
    try {
      setStatus("Saving endpoint...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/custom-endpoints\`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await loadOverview(state.activeGuildId);
      if (state.tab === "my-providers") renderMyProviders();
      else renderSettings();
      setStatus("Endpoint saved", "ok");
      showToast("Custom endpoint saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function deleteCustomEndpoint(scope, label, capability) {
    if (!window.confirm("Delete this custom endpoint?")) return;
    try {
      setStatus("Deleting endpoint...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/custom-endpoints\`, {
        method: "DELETE",
        body: JSON.stringify({ scope, label, capability }),
      });
      await loadOverview(state.activeGuildId);
      if (state.tab === "my-providers") renderMyProviders();
      else renderSettings();
      setStatus("Endpoint deleted", "ok");
      showToast("Custom endpoint deleted", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function saveFallbacks() {
    const refs = Array.from(document.querySelectorAll("[data-fallback-slot]"))
      .map((select) => select.value)
      .filter(Boolean)
      .map((value) => {
        const [type, id] = value.split(":");
        return { type, id: Number(id) };
      });
    try {
      setStatus("Saving fallbacks...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/fallbacks\`, {
        method: "PATCH",
        body: JSON.stringify({ refs }),
      });
      await loadOverview(state.activeGuildId);
      renderSettings();
      setStatus("Fallbacks saved", "ok");
      showToast("Fallback chain saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  function renderAccessTools() {
    const extra = document.querySelector("[data-settings-extra]");
    if (!extra) return;
    const channelOptions = state.overview.modelOptions?.channels || [];
    const roleOptions = state.overview.modelOptions?.roles || [];
    const cooldownOptions = state.overview.modelOptions?.cooldownTypes || [];
    const channelRows = (state.overview.access?.channelWhitelist || [])
      .map(
        (entry) => \`
          <article class="memory-item">
            <strong>\${escapeText(labelFor(channelOptions, entry.channelDiscId))}</strong>
            <div class="memory-meta">Cooldown: \${entry.cooldownType === null ? "inherits global" : escapeText(labelFor(cooldownOptions, entry.cooldownType)) + ", " + entry.cooldownLength + "s"}</div>
            <div class="item-actions">
              <button class="danger" data-delete-channel-whitelist="\${entry.channelDiscId}">Remove</button>
            </div>
          </article>
        \`,
      )
      .join("");
    const roleRows = (state.overview.access?.roleWhitelist || [])
      .map(
        (entry) => \`
          <article class="memory-item">
            <strong>\${escapeText(labelFor(roleOptions, entry.roleDiscId))}</strong>
            <div class="item-actions">
              <button class="danger" data-delete-role-whitelist="\${entry.roleDiscId}">Remove</button>
            </div>
          </article>
        \`,
      )
      .join("");

    extra.innerHTML = \`
      <section class="panel">
        <div class="panel-header">
          <h2>Channel Allowlist</h2>
          <button class="primary" data-add-channel-whitelist>Add Channel</button>
        </div>
        <div class="settings-grid">
          <div class="field">
            <label>Channel</label>
            <select data-channel-whitelist-channel>\${optionHtml(channelOptions, "", false)}</select>
          </div>
          <div class="field">
            <label>Cooldown Override</label>
            <select data-channel-whitelist-cooldown>
              <option value="">Inherit global cooldown</option>
              \${optionHtml(cooldownOptions, "", false)}
            </select>
          </div>
          <div class="field">
            <label>Cooldown Length Seconds</label>
            <input data-channel-whitelist-length type="number" min="0" max="86400" step="1" />
          </div>
        </div>
        <div class="memory-list" style="margin-top: 14px">\${channelRows || '<div class="empty-state">No channel allowlist entries.</div>'}</div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>Role Allowlist</h2>
          <button class="primary" data-add-role-whitelist>Add Role</button>
        </div>
        <div class="field">
          <label>Role</label>
          <select data-role-whitelist-role>\${optionHtml(roleOptions, "", false)}</select>
        </div>
        <div class="memory-list" style="margin-top: 14px">\${roleRows || '<div class="empty-state">No role allowlist entries.</div>'}</div>
      </section>
    \`;

    document.querySelector("[data-add-channel-whitelist]").addEventListener("click", addChannelWhitelist);
    document.querySelector("[data-add-role-whitelist]").addEventListener("click", addRoleWhitelist);
    document.querySelectorAll("[data-delete-channel-whitelist]").forEach((button) => {
      button.addEventListener("click", () => deleteChannelWhitelist(button.getAttribute("data-delete-channel-whitelist")));
    });
    document.querySelectorAll("[data-delete-role-whitelist]").forEach((button) => {
      button.addEventListener("click", () => deleteRoleWhitelist(button.getAttribute("data-delete-role-whitelist")));
    });
  }

  async function addChannelWhitelist() {
    const cooldownValue = document.querySelector("[data-channel-whitelist-cooldown]").value;
    const lengthValue = document.querySelector("[data-channel-whitelist-length]").value;
    try {
      setStatus("Saving channel allowlist...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/access/channel-whitelist\`, {
        method: "POST",
        body: JSON.stringify({
          channelDiscId: document.querySelector("[data-channel-whitelist-channel]").value,
          cooldownType: cooldownValue === "" ? null : Number(cooldownValue),
          cooldownLength: cooldownValue === "" ? null : Number(lengthValue || 0),
        }),
      });
      await loadOverview(state.activeGuildId);
      renderSettings();
      setStatus("Channel allowlist saved", "ok");
      showToast("Channel allowlist saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function deleteChannelWhitelist(channelDiscId) {
    try {
      setStatus("Removing channel allowlist...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/access/channel-whitelist\`, {
        method: "DELETE",
        body: JSON.stringify({ channelDiscId, cooldownType: null, cooldownLength: null }),
      });
      await loadOverview(state.activeGuildId);
      renderSettings();
      setStatus("Channel allowlist removed", "ok");
      showToast("Channel allowlist removed", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function addRoleWhitelist() {
    try {
      setStatus("Saving role allowlist...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/access/role-whitelist\`, {
        method: "POST",
        body: JSON.stringify({ roleDiscId: document.querySelector("[data-role-whitelist-role]").value }),
      });
      await loadOverview(state.activeGuildId);
      renderSettings();
      setStatus("Role allowlist saved", "ok");
      showToast("Role allowlist saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function deleteRoleWhitelist(roleDiscId) {
    try {
      setStatus("Removing role allowlist...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/access/role-whitelist\`, {
        method: "DELETE",
        body: JSON.stringify({ roleDiscId }),
      });
      await loadOverview(state.activeGuildId);
      renderSettings();
      setStatus("Role allowlist removed", "ok");
      showToast("Role allowlist removed", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  function renderMemoryTools() {
    const extra = document.querySelector("[data-settings-extra]");
    if (!extra) return;
    const lineageOptions = state.overview.personas
      .map(
        (persona) =>
          \`<option value="\${persona.personaLineageId}">\${escapeText(persona.nickname)} lineage \${persona.personaLineageId}</option>\`,
      )
      .join("");
    extra.innerHTML = \`
      <section class="panel">
        <div class="panel-header">
          <h2>Memory Import / Export</h2>
          <div class="item-actions" style="margin-top: 0">
            <button data-export-memory-json>Export</button>
            <button class="primary" data-import-memory-json>Import Append</button>
          </div>
        </div>
        <div class="settings-grid">
          <div class="field">
            <label>Memory Type</label>
            <select data-memory-transfer-kind>
              <option value="server">Server memories</option>
              <option value="personal">My personal memories</option>
            </select>
          </div>
          <div class="field">
            <label>Persona Lineage</label>
            <select data-memory-transfer-lineage>
              <option value="0">Global personal lineage / main lineage 0</option>
              \${lineageOptions}
            </select>
          </div>
        </div>
        <div class="field" style="margin-top: 12px">
          <label>JSON</label>
          <textarea data-memory-transfer-json></textarea>
        </div>
      </section>
    \`;
    document.querySelector("[data-export-memory-json]").addEventListener("click", exportMemoryJson);
    document.querySelector("[data-import-memory-json]").addEventListener("click", importMemoryJson);
  }

  async function exportMemoryJson() {
    try {
      setStatus("Exporting memories...", "warn");
      const kind = document.querySelector("[data-memory-transfer-kind]")?.value || "personal";
      const lineage = document.querySelector("[data-memory-transfer-lineage]")?.value || selectedPersonalMemoryLineageId();
      const result = await api(
        \`/guilds/\${state.activeGuildId}/memory-export?kind=\${encodeURIComponent(kind)}&personaLineageId=\${encodeURIComponent(lineage)}\`,
      );
      document.querySelector("[data-memory-transfer-json]").value = JSON.stringify(result, null, 2);
      setStatus("Memories exported", "ok");
      showToast("Memories exported", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function importMemoryJson() {
    try {
      const raw = document.querySelector("[data-memory-transfer-json]").value;
      const parsed = JSON.parse(raw);
      const memories = Array.isArray(parsed) ? parsed : parsed.memories;
      const kind = document.querySelector("[data-memory-transfer-kind]")?.value || "personal";
      const lineage = document.querySelector("[data-memory-transfer-lineage]")?.value || selectedPersonalMemoryLineageId();
      setStatus("Importing memories...", "warn");
      const result = await api(\`/guilds/\${state.activeGuildId}/memory-import\`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          personaLineageId: Number(lineage),
          memories,
        }),
      });
      if (state.tab === "personal-memories") {
        await loadPersonalMemories();
      } else {
        await loadOverview(state.activeGuildId);
      }
      setStatus(\`Imported \${result.inserted} memories\`, "ok");
      showToast(\`Imported \${result.inserted} memories\`, "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  function renderMemories() {
    if (!state.overview?.canManage) {
      state.tab = "personal-memories";
      renderMain();
      return;
    }
    const content = document.querySelector("[data-tab-content]");
    const personas = state.overview.personas;
    if (!state.memoryPersonaLineageId) {
      state.memoryPersonaLineageId = String(personas[0]?.personaLineageId ?? 0);
    }

    const personaOptions = personas
      .map(
        (persona) =>
          \`<option value="\${persona.personaLineageId}" \${String(persona.personaLineageId) === state.memoryPersonaLineageId ? "selected" : ""}>\${escapeText(persona.nickname)}</option>\`,
      )
      .join("");

    content.innerHTML = \`
      <section class="panel">
        <div class="panel-header">
          <h2>Server Memories</h2>
          <button data-refresh-memories>Refresh</button>
        </div>
        <div class="memory-toolbar">
          <div class="field">
            <label>Persona</label>
            <select data-memory-persona>\${personaOptions}</select>
          </div>
          <div class="field">
            <label>New Memory</label>
            <textarea data-new-memory></textarea>
          </div>
        </div>
        <div class="item-actions">
          <button class="primary" data-add-memory>Add Memory</button>
        </div>
      </section>
      <section class="panel">
        <div class="memory-list" data-memory-list></div>
      </section>
    \`;

    document.querySelector("[data-memory-persona]").addEventListener("change", (event) => {
      state.memoryPersonaLineageId = event.target.value;
      loadMemories();
    });
    document.querySelector("[data-refresh-memories]").addEventListener("click", () => loadMemories(true));
    document.querySelector("[data-add-memory]").addEventListener("click", addMemory);
    renderMemoryList();
    loadMemories();
  }

  function renderMemoryList() {
    const list = document.querySelector("[data-memory-list]");
    if (!list) return;
    if (!state.memories.length) {
      list.innerHTML = '<div class="empty-state">No memories for this persona.</div>';
      return;
    }

    list.innerHTML = "";
    state.memories.forEach((memory) => {
      const item = document.createElement("article");
      item.className = "memory-item";
      item.innerHTML = \`
        <div class="memory-meta">#\${memory.serverMemoryId} \${memory.taughtBy ? "by " + escapeText(memory.taughtBy) : ""}</div>
        <div class="field">
          <textarea data-memory-content>\${escapeText(memory.content)}</textarea>
        </div>
        <div class="item-actions">
          <button class="primary" data-save-memory>Save</button>
          <button class="danger" data-delete-memory>Delete</button>
        </div>
      \`;
      item.querySelector("[data-save-memory]").addEventListener("click", () => saveMemory(memory.serverMemoryId, item));
      item.querySelector("[data-delete-memory]").addEventListener("click", () => deleteMemory(memory.serverMemoryId));
      list.appendChild(item);
    });
  }

  async function loadMemories(showConfirmation = false) {
    try {
      setStatus("Loading memories...", "warn");
      const result = await api(\`/guilds/\${state.activeGuildId}/memories?personaLineageId=\${encodeURIComponent(state.memoryPersonaLineageId)}\`);
      state.memories = result.memories;
      renderMemoryList();
      setStatus("Memories loaded", "ok");
      if (showConfirmation) showToast("Memories refreshed", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function addMemory() {
    const content = document.querySelector("[data-new-memory]").value;
    const persona = state.overview.personas.find((item) => String(item.personaLineageId) === state.memoryPersonaLineageId);
    if (!persona) return;
    try {
      setStatus("Adding memory...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/memories\`, {
        method: "POST",
        body: JSON.stringify({ tomoriId: persona.tomoriId, content }),
      });
      document.querySelector("[data-new-memory]").value = "";
      await loadOverview(state.activeGuildId);
      await loadMemories();
      setStatus("Memory added", "ok");
      showToast("Memory added", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function saveMemory(memoryId, item) {
    try {
      setStatus("Saving memory...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/memories/\${memoryId}\`, {
        method: "PATCH",
        body: JSON.stringify({ content: item.querySelector("[data-memory-content]").value }),
      });
      await loadOverview(state.activeGuildId);
      await loadMemories();
      setStatus("Memory saved", "ok");
      showToast("Memory saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function deleteMemory(memoryId) {
    if (!window.confirm("Delete this memory?")) return;
    try {
      setStatus("Deleting memory...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/memories/\${memoryId}\`, { method: "DELETE" });
      await loadOverview(state.activeGuildId);
      await loadMemories();
      setStatus("Memory deleted", "ok");
      showToast("Memory deleted", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  function renderMyServerMemories() {
    const content = document.querySelector("[data-tab-content]");
    const canUseServerTeaching =
      Boolean(state.overview?.canManage) || state.overview?.permissions?.serverMemoryTeachingEnabled !== false;

    if (!canUseServerTeaching) {
      content.innerHTML =
        '<div class="empty-state">Server memory teaching is disabled for this server.</div>';
      return;
    }

    const personas = state.overview.personas;
    if (!state.myServerMemoryPersonaLineageId) {
      state.myServerMemoryPersonaLineageId = String(personas[0]?.personaLineageId ?? 0);
    }

    const personaOptions = personas
      .map(
        (persona) =>
          \`<option value="\${persona.personaLineageId}" \${String(persona.personaLineageId) === state.myServerMemoryPersonaLineageId ? "selected" : ""}>\${escapeText(persona.nickname)}</option>\`,
      )
      .join("");

    content.innerHTML = \`
      <section class="panel">
        <div class="panel-header">
          <h2>My Taught Server Memories</h2>
          <button data-refresh-my-server-memories>Refresh</button>
        </div>
        <div class="memory-toolbar">
          <div class="field">
            <label>Persona</label>
            <select data-my-server-memory-persona>\${personaOptions}</select>
          </div>
          <div class="field">
            <label>New Memory</label>
            <textarea data-new-my-server-memory></textarea>
          </div>
        </div>
        <div class="item-actions">
          <button class="primary" data-add-my-server-memory>Add Memory</button>
        </div>
      </section>
      <section class="panel">
        <div class="memory-list" data-my-server-memory-list></div>
      </section>
    \`;

    document.querySelector("[data-my-server-memory-persona]").addEventListener("change", (event) => {
      state.myServerMemoryPersonaLineageId = event.target.value;
      loadMyServerMemories();
    });
    document.querySelector("[data-refresh-my-server-memories]").addEventListener("click", () => loadMyServerMemories(true));
    document.querySelector("[data-add-my-server-memory]").addEventListener("click", addMyServerMemory);
    renderMyServerMemoryList();
    loadMyServerMemories();
  }

  function renderMyServerMemoryList() {
    const list = document.querySelector("[data-my-server-memory-list]");
    if (!list) return;
    if (!state.myServerMemories.length) {
      list.innerHTML = '<div class="empty-state">No server memories taught by you for this persona.</div>';
      return;
    }

    list.innerHTML = "";
    state.myServerMemories.forEach((memory) => {
      const item = document.createElement("article");
      item.className = "memory-item";
      item.innerHTML = \`
        <div class="memory-meta">#\${memory.serverMemoryId} - lineage \${memory.personaLineageId}</div>
        <div class="field">
          <textarea data-my-server-memory-content>\${escapeText(memory.content)}</textarea>
        </div>
        <div class="item-actions">
          <button class="primary" data-save-my-server-memory>Save</button>
          <button class="danger" data-delete-my-server-memory>Delete</button>
        </div>
      \`;
      item
        .querySelector("[data-save-my-server-memory]")
        .addEventListener("click", () => saveMyServerMemory(memory.serverMemoryId, item));
      item
        .querySelector("[data-delete-my-server-memory]")
        .addEventListener("click", () => deleteMyServerMemory(memory.serverMemoryId));
      list.appendChild(item);
    });
  }

  async function loadMyServerMemories(showConfirmation = false) {
    try {
      setStatus("Loading taught memories...", "warn");
      const result = await api(
        \`/guilds/\${state.activeGuildId}/my-server-memories?personaLineageId=\${encodeURIComponent(state.myServerMemoryPersonaLineageId)}\`,
      );
      state.myServerMemories = result.memories;
      renderMyServerMemoryList();
      setStatus("Taught memories loaded", "ok");
      if (showConfirmation) showToast("Taught memories refreshed", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function addMyServerMemory() {
    const content = document.querySelector("[data-new-my-server-memory]").value;
    try {
      setStatus("Adding taught memory...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/my-server-memories\`, {
        method: "POST",
        body: JSON.stringify({
          personaLineageId: Number(state.myServerMemoryPersonaLineageId),
          content,
        }),
      });
      document.querySelector("[data-new-my-server-memory]").value = "";
      await loadMyServerMemories();
      setStatus("Taught memory added", "ok");
      showToast("Taught memory added", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function saveMyServerMemory(memoryId, item) {
    try {
      setStatus("Saving taught memory...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/my-server-memories/\${memoryId}\`, {
        method: "PATCH",
        body: JSON.stringify({ content: item.querySelector("[data-my-server-memory-content]").value }),
      });
      await loadMyServerMemories();
      setStatus("Taught memory saved", "ok");
      showToast("Taught memory saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function deleteMyServerMemory(memoryId) {
    if (!window.confirm("Delete this taught server memory?")) return;
    try {
      setStatus("Deleting taught memory...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/my-server-memories/\${memoryId}\`, { method: "DELETE" });
      await loadMyServerMemories();
      setStatus("Taught memory deleted", "ok");
      showToast("Taught memory deleted", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  function selectedPersonalMemoryLineageId() {
    if (state.personalMemoryScope === "global") return "0";
    if (!state.personalMemoryPersonaLineageId) {
      state.personalMemoryPersonaLineageId = String(state.overview.personas[0]?.personaLineageId ?? 0);
    }
    return state.personalMemoryPersonaLineageId;
  }

  function renderPersonalMemories() {
    const content = document.querySelector("[data-tab-content]");
    const personas = state.overview.personas;
    if (!state.personalMemoryPersonaLineageId) {
      state.personalMemoryPersonaLineageId = String(personas[0]?.personaLineageId ?? 0);
    }

    const personaOptions = personas
      .map(
        (persona) =>
          \`<option value="\${persona.personaLineageId}" \${String(persona.personaLineageId) === state.personalMemoryPersonaLineageId ? "selected" : ""}>\${escapeText(persona.nickname)}</option>\`,
      )
      .join("");

    content.innerHTML = \`
      <section class="panel">
        <div class="panel-header">
          <h2>My Personal Memories</h2>
          <button data-refresh-personal-memories>Refresh</button>
        </div>
        <div class="memory-meta">These are personal memories for your Discord account. Global memories use lineage 0 across personas; persona memories use the selected persona lineage.</div>
        <div class="memory-toolbar">
          <div class="field">
            <label>Scope</label>
            <select data-personal-memory-scope>
              <option value="global" \${state.personalMemoryScope === "global" ? "selected" : ""}>Global</option>
              <option value="persona" \${state.personalMemoryScope === "persona" ? "selected" : ""}>Persona</option>
            </select>
          </div>
          <div class="field">
            <label>Persona</label>
            <select data-personal-memory-persona \${state.personalMemoryScope === "global" ? "disabled" : ""}>\${personaOptions}</select>
          </div>
          <div class="field">
            <label>New Memory</label>
            <textarea data-new-personal-memory></textarea>
          </div>
        </div>
        <div class="item-actions">
          <button class="primary" data-add-personal-memory>Add Memory</button>
        </div>
      </section>
      <section class="panel">
        <div class="memory-list" data-personal-memory-list></div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>My Memory Import / Export</h2>
          <div class="item-actions" style="margin-top: 0">
            <button data-export-memory-json>Export</button>
            <button class="primary" data-import-memory-json>Import Append</button>
          </div>
        </div>
        <div class="field">
          <label>JSON</label>
          <textarea data-memory-transfer-json></textarea>
        </div>
      </section>
    \`;

    document.querySelector("[data-personal-memory-scope]").addEventListener("change", (event) => {
      state.personalMemoryScope = event.target.value;
      state.personalMemories = [];
      renderPersonalMemories();
    });
    document.querySelector("[data-personal-memory-persona]").addEventListener("change", (event) => {
      state.personalMemoryPersonaLineageId = event.target.value;
      loadPersonalMemories();
    });
    document.querySelector("[data-refresh-personal-memories]").addEventListener("click", () => loadPersonalMemories(true));
    document.querySelector("[data-add-personal-memory]").addEventListener("click", addPersonalMemory);
    document.querySelector("[data-export-memory-json]").addEventListener("click", exportMemoryJson);
    document.querySelector("[data-import-memory-json]").addEventListener("click", importMemoryJson);
    renderPersonalMemoryList();
    loadPersonalMemories();
  }

  function renderPersonalMemoryList() {
    const list = document.querySelector("[data-personal-memory-list]");
    if (!list) return;
    if (!state.personalMemories.length) {
      list.innerHTML = '<div class="empty-state">No personal memories in this scope.</div>';
      return;
    }

    list.innerHTML = "";
    state.personalMemories.forEach((memory) => {
      const item = document.createElement("article");
      item.className = "memory-item";
      item.innerHTML = \`
        <div class="memory-meta">#\${memory.personalMemoryId} - lineage \${memory.personaLineageId}</div>
        <div class="field">
          <textarea data-personal-memory-content>\${escapeText(memory.content)}</textarea>
        </div>
        <div class="item-actions">
          <button class="primary" data-save-personal-memory>Save</button>
          <button class="danger" data-delete-personal-memory>Delete</button>
        </div>
      \`;
      item
        .querySelector("[data-save-personal-memory]")
        .addEventListener("click", () => savePersonalMemory(memory.personalMemoryId, item));
      item
        .querySelector("[data-delete-personal-memory]")
        .addEventListener("click", () => deletePersonalMemory(memory.personalMemoryId));
      list.appendChild(item);
    });
  }

  async function loadPersonalMemories(showConfirmation = false) {
    try {
      setStatus("Loading personal memories...", "warn");
      const lineageId = selectedPersonalMemoryLineageId();
      const result = await api(
        \`/guilds/\${state.activeGuildId}/personal-memories?personaLineageId=\${encodeURIComponent(lineageId)}\`,
      );
      state.personalMemories = result.memories;
      renderPersonalMemoryList();
      setStatus("Personal memories loaded", "ok");
      if (showConfirmation) showToast("Personal memories refreshed", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function addPersonalMemory() {
    const content = document.querySelector("[data-new-personal-memory]").value;
    try {
      setStatus("Adding personal memory...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/personal-memories\`, {
        method: "POST",
        body: JSON.stringify({ personaLineageId: Number(selectedPersonalMemoryLineageId()), content }),
      });
      document.querySelector("[data-new-personal-memory]").value = "";
      await loadPersonalMemories();
      setStatus("Personal memory added", "ok");
      showToast("Personal memory added", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function savePersonalMemory(memoryId, item) {
    try {
      setStatus("Saving personal memory...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/personal-memories/\${memoryId}\`, {
        method: "PATCH",
        body: JSON.stringify({ content: item.querySelector("[data-personal-memory-content]").value }),
      });
      await loadPersonalMemories();
      setStatus("Personal memory saved", "ok");
      showToast("Personal memory saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function deletePersonalMemory(memoryId) {
    if (!window.confirm("Delete this personal memory?")) return;
    try {
      setStatus("Deleting personal memory...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/personal-memories/\${memoryId}\`, { method: "DELETE" });
      await loadPersonalMemories();
      setStatus("Personal memory deleted", "ok");
      showToast("Personal memory deleted", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  function renderPersonas() {
    if (!state.overview?.canManage) {
      state.tab = "personal-memories";
      renderMain();
      return;
    }
    const content = document.querySelector("[data-tab-content]");
    content.innerHTML = \`
      <section class="panel">
        <div class="panel-header">
          <h2>Personas</h2>
        </div>
        <div class="persona-list"></div>
      </section>
    \`;

    const list = content.querySelector(".persona-list");
    state.overview.personas.forEach((persona) => {
      const item = document.createElement("article");
      item.className = "persona-item";
      item.innerHTML = \`
        <div class="persona-meta">\${persona.isAlter ? "Alter" : "Main"} - \${persona.memoryCount} memories</div>
        <div class="settings-grid">
          <div class="field">
            <label>Nickname</label>
            <input data-persona-nickname value="\${escapeText(persona.nickname)}" />
          </div>
          <div class="field">
            <label>Context Note Depth</label>
            <input data-persona-depth type="number" min="0" max="100" value="\${persona.contextNoteDepth}" />
          </div>
          <div class="field">
            <label>NovelAI Tags</label>
            <input data-persona-tags value="\${escapeText((persona.naiTags || []).join(", "))}" />
          </div>
        </div>
        <div class="field" style="margin-top: 12px">
          <label>Context Note</label>
          <textarea data-persona-note>\${escapeText(persona.contextNote || "")}</textarea>
        </div>
        <div class="item-actions">
          <button class="primary" data-save-persona>Save Persona</button>
        </div>
      \`;
      item.querySelector("[data-save-persona]").addEventListener("click", () => savePersona(persona.tomoriId, item));
      list.appendChild(item);
    });
  }

  async function savePersona(tomoriId, item) {
    const tags = item
      .querySelector("[data-persona-tags]")
      .value.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);

    try {
      setStatus("Saving persona...", "warn");
      await api(\`/guilds/\${state.activeGuildId}/personas/\${tomoriId}\`, {
        method: "PATCH",
        body: JSON.stringify({
          tomori_nickname: item.querySelector("[data-persona-nickname]").value,
          context_note: item.querySelector("[data-persona-note]").value,
          context_note_depth: Number(item.querySelector("[data-persona-depth]").value),
          nai_tags: tags,
        }),
      });
      await loadOverview(state.activeGuildId);
      renderMain();
      setStatus("Persona saved", "ok");
      showToast("Persona saved", "ok");
    } catch (error) {
      setStatus(error.message, "error");
      showToast(error.message, "error");
    }
  }

  async function loadOverview(guildId) {
    const result = await api(\`/guilds/\${guildId}/overview\`);
    state.overview = result;
  }

  async function selectGuild(guildId) {
    if (!guildId) return;
    state.activeGuildId = guildId;
    state.overview = null;
    state.memories = [];
    state.memoryPersonaLineageId = "";
    state.myServerMemories = [];
    state.myServerMemoryPersonaLineageId = "";
    state.personalMemories = [];
    state.personalMemoryScope = "global";
    state.personalMemoryPersonaLineageId = "";
    renderDashboardFrame();
    renderMain();
    try {
      setStatus("Loading server...", "warn");
      await loadOverview(guildId);
      renderDashboardFrame();
      renderMain();
      setStatus("Server loaded", "ok");
    } catch (error) {
      setStatus(error.message, "error");
    }
  }

  async function boot() {
    try {
      const me = await api("/me");
      state.me = me.user;
      state.csrfToken = me.csrfToken;
      state.guilds = me.guilds;
      if (!state.guilds.length) {
        renderNoGuilds();
        return;
      }
      await selectGuild(state.guilds[0].id);
    } catch {
      renderLoggedOut();
    }
  }

  boot();
})();`;
}

export function startSettingsWebsite(client: Client): void {
  const config = getSettingsWebsiteConfig(client);
  if (!config.enabled) {
    log.info("Settings website disabled (set WEB_SETTINGS_ENABLED=true to enable)");
    return;
  }

  if (!config.sessionSecret) {
    log.warn("Settings website disabled: WEB_SETTINGS_SESSION_SECRET or CRYPTO_SECRET is required");
    return;
  }

  const app = new Hono();

  app.use("*", async (context, next) => {
    await next();
    context.header("X-Content-Type-Options", "nosniff");
    context.header("X-Frame-Options", "DENY");
    context.header("Referrer-Policy", "same-origin");
    context.header(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' https://cdn.discordapp.com data:; connect-src 'self'; style-src 'self'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'",
    );
  });

  app.get("/", (context) => context.redirect(BASE_PATH));
  app.get(BASE_PATH, (context) => context.html(renderIndexHtml()));
  app.get(`${BASE_PATH}/assets/app.css`, (context) => {
    context.header("Content-Type", "text/css; charset=utf-8");
    return context.body(renderCss());
  });
  app.get(`${BASE_PATH}/assets/app.js`, (context) => {
    context.header("Content-Type", "application/javascript; charset=utf-8");
    return context.body(renderJs());
  });
  app.get(`${BASE_PATH}/assets/:assetName`, async (context) => {
    const assetName = context.req.param("assetName") as keyof typeof DASHBOARD_ASSETS;
    const asset = DASHBOARD_ASSETS[assetName];
    if (!asset) return context.notFound();

    const file = Bun.file(new URL(`./assets/${asset.fileName}`, import.meta.url));
    if (!(await file.exists())) return context.notFound();

    context.header("Content-Type", asset.contentType);
    context.header("Cache-Control", "public, max-age=86400");
    return context.body(await file.arrayBuffer());
  });

  app.get(`${BASE_PATH}/login`, (context) => {
    if (!config.clientId || !config.clientSecret) {
      return context.html(
        "<!doctype html><title>TomoriBot Settings</title><p>Discord OAuth is not configured for the settings website.</p>",
        503,
      );
    }

    const state = randomToken();
    setSignedCookieValue(context, config, OAUTH_STATE_COOKIE, state, 10 * 60);

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      scope: "identify guilds",
      state,
    });

    return context.redirect(`${DISCORD_API_BASE}/oauth2/authorize?${params.toString()}`);
  });

  app.get(`${BASE_PATH}/oauth/callback`, async (context) => {
    const code = context.req.query("code");
    const state = context.req.query("state");
    const expectedState = verifySignedValue(getCookie(context, OAUTH_STATE_COOKIE), config.sessionSecret);
    clearCookie(context, config, OAUTH_STATE_COOKIE);

    if (!code || !state || !expectedState || state !== expectedState) {
      return context.text("Invalid OAuth state", 400);
    }

    try {
      const token = await exchangeOAuthCode(config, code);
      const user = await discordApi<DiscordUser>("/users/@me", token.access_token);
      const sessionId = randomToken();
      const now = Date.now();

      sessions.set(sessionId, {
        id: sessionId,
        user,
        accessToken: token.access_token,
        tokenExpiresAt: now + token.expires_in * 1000,
        csrfToken: randomToken(),
        createdAt: now,
        expiresAt: now + SESSION_TTL_MS,
      });

      setSignedCookieValue(context, config, SESSION_COOKIE, sessionId, SESSION_TTL_MS / 1000);
      return context.redirect(BASE_PATH);
    } catch (error) {
      await log.error("Settings website OAuth callback failed", error);
      return context.text("Discord login failed", 502);
    }
  });

  app.get(`${BASE_PATH}/logout`, (context) => {
    const session = getSession(context, config);
    if (session) {
      sessions.delete(session.id);
    }
    clearCookie(context, config, SESSION_COOKIE);
    return context.redirect(BASE_PATH);
  });

  app.get(`${BASE_PATH}/api/me`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");

    try {
      const guilds = await getSharedGuilds(session, client);
      return context.json({
        user: {
          id: session.user.id,
          username: session.user.username,
          globalName: session.user.global_name ?? null,
          avatarUrl: discordAvatarUrl(session.user),
        },
        csrfToken: session.csrfToken,
        guilds,
      });
    } catch (error) {
      await log.error("Settings website failed to load shared guilds", error);
      return jsonError(context, 502, "Failed to load Discord guilds");
    }
  });

  app.patch(`${BASE_PATH}/api/personal-settings`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const body = await context.req.json().catch(() => null);
    const parsed = personalSettingsUpdateSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_personal_settings_payload");

    const updated = await updateUser(
      registeredUser.user_id,
      withoutUndefined(parsed.data as Record<string, unknown>) as Partial<UserRow>,
    );
    if (!updated) return jsonError(context, 500, "personal_settings_update_failed");

    invalidateUserCache(session.user.id);
    return context.json({
      personalSettings: serializePersonalSettings(updated),
    });
  });

  app.get(`${BASE_PATH}/api/personal-settings/export`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    return context.json({
      type: "personal_settings",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: serializePersonalSettings(registeredUser),
    });
  });

  app.post(`${BASE_PATH}/api/personal-settings/import`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const body = await context.req.json().catch(() => null);
    const payload = body?.data ?? body;
    const normalized = withoutUndefined({
      user_nickname: payload?.user_nickname ?? payload?.userNickname,
      language_pref: payload?.language_pref ?? payload?.languagePref,
      privacy_level: payload?.privacy_level ?? payload?.privacyLevel,
      personal_dtm: payload?.personal_dtm ?? payload?.personalDtm,
      shortterm_cache_crossserver_opt_in:
        payload?.shortterm_cache_crossserver_opt_in ?? payload?.shorttermCacheCrossserverOptIn,
      impersonation_prompt: payload?.impersonation_prompt ?? payload?.impersonationPrompt,
      nai_char_tags: payload?.nai_char_tags ?? payload?.naiCharTags,
      nai_char_ref_url: payload?.nai_char_ref_url ?? payload?.naiCharRefUrl,
    });
    const parsed = personalSettingsUpdateSchema.safeParse(normalized);
    if (!parsed.success) return jsonError(context, 400, "invalid_personal_settings_import");

    const updated = await updateUser(
      registeredUser.user_id,
      withoutUndefined(parsed.data as Record<string, unknown>) as Partial<UserRow>,
    );
    if (!updated) return jsonError(context, 500, "personal_settings_import_failed");

    invalidateUserCache(session.user.id);
    return context.json({
      personalSettings: serializePersonalSettings(updated),
    });
  });

  app.delete(`${BASE_PATH}/api/personal-settings`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const updated = await updateUser(registeredUser.user_id, {
      user_nickname: session.user.global_name || session.user.username,
      language_pref: "en-US",
      privacy_level: PrivacyLevel.MINIMAL,
      personal_dtm: "follow",
      shortterm_cache_crossserver_opt_in: false,
      impersonation_prompt: null,
      nai_char_tags: [],
      nai_char_ref_url: null,
    });
    if (!updated) return jsonError(context, 500, "personal_settings_reset_failed");

    invalidateUserCache(session.user.id);
    return context.json({
      personalSettings: serializePersonalSettings(updated),
    });
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/overview`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) {
      if (!guild.canManage) {
        return context.json({
          guild,
          setupComplete: false,
          canManage: false,
          personas: [],
          integrations: {
            personalSavedProviders: [],
            personalCustomEndpoints: [],
          },
        });
      }

      const modelOptions = await loadDashboardModelOptions();
      Object.assign(modelOptions, loadGuildOptionData(client, guildId));
      return context.json({
        guild,
        setupComplete: false,
        canManage: true,
        settingDefinitions: CONFIG_FIELD_DEFINITIONS,
        modelOptions,
      });
    }

    const registeredUser = await ensureSessionUser(session);
    const userId = registeredUser?.user_id ?? 0;
    const [personalSavedProviders, personalCustomEndpoints, openRouterRegistrations] = await Promise.all([
      userId ? loadUserSavedProviderConfigs(userId) : Promise.resolve([]),
      userId ? loadCustomEndpointsForUser(userId) : Promise.resolve([]),
      userId
        ? loadRegisteredOpenRouterModelsForScope({ kind: "personal", ownerId: userId })
        : Promise.resolve([]),
    ]);
    const personalProviderModels = userId
      ? await loadPersonalProviderModelOptions(
          userId,
          personalSavedProviders,
          personalCustomEndpoints as unknown as Array<Record<string, unknown>>,
        )
      : {};
    const personalDashboard = registeredUser
      ? {
          personalSettings: serializePersonalSettings(registeredUser),
          personalProviderChoices: personalProviderChoices(),
          personalProviderModels,
          personalOpenRouterRegistrations: openRouterRegistrations.map(serializeOpenRouterRegistration),
        }
      : {
          personalProviderChoices: personalProviderChoices(),
          personalProviderModels,
          personalOpenRouterRegistrations: [],
        };

    if (!guild.canManage) {
      return context.json({
        guild,
        setupComplete: true,
        canManage: false,
        ...personalDashboard,
        personas: state.personas.map(serializePersonaOption),
        integrations: {
          personalSavedProviders: personalSavedProviders.map((provider) =>
            serializeSavedProvider(provider as unknown as Record<string, unknown>),
          ),
          personalCustomEndpoints: personalCustomEndpoints.map((endpoint) =>
            serializeCustomEndpoint(endpoint as unknown as Record<string, unknown>),
          ),
        },
        permissions: {
          serverMemoryTeachingEnabled: state.config.server_memteaching_enabled !== false,
        },
        limits: getMemoryLimits(),
      });
    }

    const modelOptions = await loadDashboardModelOptions();
    Object.assign(modelOptions, loadGuildOptionData(client, guildId, state.personas));

    const [savedProviders, customEndpoints, channelWhitelist, roleWhitelist] = await Promise.all([
      loadSavedProviderConfigs(state.serverId),
      loadCustomEndpointsForServer(state.serverId),
      listChannelWhitelist(state.serverId),
      listRoleWhitelist(state.serverId),
    ]);
    const fallbackModelOptions = [
      ...modelOptions.llms.map((option) => ({
        value: `llm:${option.value}`,
        label: option.label,
      })),
      ...customEndpoints
        .filter((endpoint) => endpoint.capability === "text")
        .map((endpoint) => ({
          value: `custom_endpoint:${endpoint.custom_endpoint_id}`,
          label: `Custom/${endpoint.label} (${endpoint.display_name})`,
        })),
    ];

    return context.json({
      guild,
      setupComplete: true,
      canManage: true,
      ...personalDashboard,
      config: serializeConfig(state.config),
      personas: state.personas.map(serializePersona),
      settingDefinitions: CONFIG_FIELD_DEFINITIONS,
      modelOptions: {
        ...modelOptions,
        fallbackModels: fallbackModelOptions,
      },
      integrations: {
        savedProviders: savedProviders.map((provider) => serializeSavedProvider(provider as unknown as Record<string, unknown>)),
        personalSavedProviders: personalSavedProviders.map((provider) =>
          serializeSavedProvider(provider as unknown as Record<string, unknown>),
        ),
        customEndpoints: customEndpoints.map((endpoint) =>
          serializeCustomEndpoint(endpoint as unknown as Record<string, unknown>),
        ),
        personalCustomEndpoints: personalCustomEndpoints.map((endpoint) =>
          serializeCustomEndpoint(endpoint as unknown as Record<string, unknown>),
        ),
      },
      access: {
        channelWhitelist: channelWhitelist.map((entry) => ({
          channelDiscId: entry.channel_disc_id,
          cooldownType: entry.cooldown_type ?? null,
          cooldownLength: entry.cooldown_length ?? null,
        })),
        roleWhitelist: roleWhitelist.map((entry) => ({
          roleDiscId: entry.role_disc_id,
        })),
      },
      fallbackRefs: state.config.fallback_model_refs ?? [],
      permissions: {
        serverMemoryTeachingEnabled: state.config.server_memteaching_enabled !== false,
      },
      limits: getMemoryLimits(),
    });
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/config`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = configUpdateSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_config_payload");

    const updatedConfig = await updateTomoriConfig(state.serverId, parsed.data);
    if (!updatedConfig) return jsonError(context, 500, "config_update_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({
      config: serializeConfig(updatedConfig),
    });
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/personas/:tomoriId`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const tomoriId = Number.parseInt(context.req.param("tomoriId"), 10);
    const persona = state.personas.find((item) => item.tomori_id === tomoriId);
    if (!persona) return jsonError(context, 404, "persona_not_found");

    const body = await context.req.json().catch(() => null);
    const parsed = personaUpdateSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_persona_payload");

    const updatedPersona = await updateTomori(tomoriId, parsed.data);
    if (!updatedPersona) return jsonError(context, 500, "persona_update_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({
      persona: serializePersona({ ...persona, ...updatedPersona }),
    });
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/memories`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const personaLineageId = Number.parseInt(context.req.query("personaLineageId") || "0", 10);
    const rows = await listServerMemories(state.serverId, Number.isFinite(personaLineageId) ? personaLineageId : 0);

    return context.json({
      memories: rows.map((row) => serializeServerMemory(row as unknown as Record<string, unknown>)),
    });
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/memories`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = memoryCreateSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_memory_payload");

    const persona = state.personas.find((item) => item.tomori_id === parsed.data.tomoriId);
    if (!persona?.tomori_id) return jsonError(context, 404, "persona_not_found");

    const contentValidation = validateMemoryContent(parsed.data.content);
    if (!contentValidation.isValid) return jsonError(context, 400, contentValidation.error ?? "invalid_memory");

    const personaLineageId = persona.persona_lineage_id ?? 0;
    const duplicateExists = await findDuplicateMemory(state.serverId, personaLineageId, parsed.data.content);
    if (duplicateExists) return jsonError(context, 409, "duplicate_memory");

    const limitCheck = await checkServerMemoryLimit(state.serverId, personaLineageId);
    if (!limitCheck.isValid) return jsonError(context, 400, limitCheck.error ?? "memory_limit_exceeded");

    const registeredUser = await registerUser(
      session.user.id,
      session.user.global_name || session.user.username,
      "en-US",
    );
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const memory = await addServerMemoryByTomori(
      state.serverId,
      persona.tomori_id,
      personaLineageId,
      registeredUser.user_id,
      parsed.data.content,
    );
    if (!memory) return jsonError(context, 500, "memory_create_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({
      memory,
    });
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/memories/:memoryId`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const memoryId = Number.parseInt(context.req.param("memoryId"), 10);
    const body = await context.req.json().catch(() => null);
    const parsed = memoryUpdateSchema.safeParse(body);
    if (!Number.isFinite(memoryId) || !parsed.success) return jsonError(context, 400, "invalid_memory_payload");

    const contentValidation = validateMemoryContent(parsed.data.content);
    if (!contentValidation.isValid) return jsonError(context, 400, contentValidation.error ?? "invalid_memory");

    const [existingMemory] = await sql`
      SELECT *
      FROM server_memories
      WHERE server_memory_id = ${memoryId}
        AND server_id = ${state.serverId}
      LIMIT 1
    `;
    if (!existingMemory) return jsonError(context, 404, "memory_not_found");

    const personaLineageId = Number(existingMemory.persona_lineage_id ?? 0);
    const duplicateExists = await findDuplicateMemory(state.serverId, personaLineageId, parsed.data.content, memoryId);
    if (duplicateExists) return jsonError(context, 409, "duplicate_memory");

    const [updatedMemory] = await sql`
      UPDATE server_memories
      SET content = ${parsed.data.content}, updated_at = CURRENT_TIMESTAMP
      WHERE server_memory_id = ${memoryId}
        AND server_id = ${state.serverId}
      RETURNING *
    `;
    const validated = serverMemorySchema.safeParse(updatedMemory);
    if (!validated.success) return jsonError(context, 500, "memory_update_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({
      memory: validated.data,
    });
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/memories/:memoryId`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const memoryId = Number.parseInt(context.req.param("memoryId"), 10);
    if (!Number.isFinite(memoryId)) return jsonError(context, 400, "invalid_memory_id");

    const result = await sql`
      DELETE FROM server_memories
      WHERE server_memory_id = ${memoryId}
        AND server_id = ${state.serverId}
    `;
    if (result.count === 0) return jsonError(context, 404, "memory_not_found");

    invalidateTomoriStateCache(guildId);
    return context.json({
      deleted: true,
    });
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/my-server-memories`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");
    if (!guild.canManage && state.config.server_memteaching_enabled === false) {
      return jsonError(context, 403, "server_memory_teaching_disabled");
    }

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const personaLineageId = Number.parseInt(context.req.query("personaLineageId") || "0", 10);
    const lineageId = Number.isFinite(personaLineageId) ? personaLineageId : 0;
    const allowedLineages = new Set([0, ...state.personas.map((persona) => persona.persona_lineage_id ?? 0)]);
    if (!allowedLineages.has(lineageId)) return jsonError(context, 403, "lineage_forbidden");

    const rows = await listUserServerMemories(state.serverId, lineageId, registeredUser.user_id);
    return context.json({
      memories: rows.map((row) => serializeServerMemory(row as unknown as Record<string, unknown>)),
    });
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/my-server-memories`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");
    if (!guild.canManage && state.config.server_memteaching_enabled === false) {
      return jsonError(context, 403, "server_memory_teaching_disabled");
    }

    const body = await context.req.json().catch(() => null);
    const parsed = myServerMemoryCreateSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_memory_payload");

    const persona = state.personas.find((item) => (item.persona_lineage_id ?? 0) === parsed.data.personaLineageId);
    if (!persona?.tomori_id) return jsonError(context, 404, "persona_not_found");

    const contentValidation = validateMemoryContent(parsed.data.content);
    if (!contentValidation.isValid) return jsonError(context, 400, contentValidation.error ?? "invalid_memory");

    const personaLineageId = persona.persona_lineage_id ?? 0;
    const duplicateExists = await findDuplicateMemory(state.serverId, personaLineageId, parsed.data.content);
    if (duplicateExists) return jsonError(context, 409, "duplicate_memory");

    const limitCheck = await checkServerMemoryLimit(state.serverId, personaLineageId);
    if (!limitCheck.isValid) return jsonError(context, 400, limitCheck.error ?? "memory_limit_exceeded");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const memory = await addServerMemoryByTomori(
      state.serverId,
      persona.tomori_id,
      personaLineageId,
      registeredUser.user_id,
      parsed.data.content,
    );
    if (!memory) return jsonError(context, 500, "memory_create_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({
      memory: serializeServerMemory(memory as unknown as Record<string, unknown>),
    });
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/my-server-memories/:memoryId`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");
    if (!guild.canManage && state.config.server_memteaching_enabled === false) {
      return jsonError(context, 403, "server_memory_teaching_disabled");
    }

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const memoryId = Number.parseInt(context.req.param("memoryId"), 10);
    const body = await context.req.json().catch(() => null);
    const parsed = memoryUpdateSchema.safeParse(body);
    if (!Number.isFinite(memoryId) || !parsed.success) return jsonError(context, 400, "invalid_memory_payload");

    const contentValidation = validateMemoryContent(parsed.data.content);
    if (!contentValidation.isValid) return jsonError(context, 400, contentValidation.error ?? "invalid_memory");

    const [existingMemory] = await sql`
      SELECT *
      FROM server_memories
      WHERE server_memory_id = ${memoryId}
        AND server_id = ${state.serverId}
        AND user_id = ${registeredUser.user_id}
      LIMIT 1
    `;
    if (!existingMemory) return jsonError(context, 404, "memory_not_found");

    const personaLineageId = Number(existingMemory.persona_lineage_id ?? 0);
    const allowedLineages = new Set([0, ...state.personas.map((persona) => persona.persona_lineage_id ?? 0)]);
    if (!allowedLineages.has(personaLineageId)) return jsonError(context, 403, "lineage_forbidden");

    const duplicateExists = await findDuplicateMemory(state.serverId, personaLineageId, parsed.data.content, memoryId);
    if (duplicateExists) return jsonError(context, 409, "duplicate_memory");

    const [updatedMemory] = await sql`
      UPDATE server_memories
      SET content = ${parsed.data.content}, updated_at = CURRENT_TIMESTAMP
      WHERE server_memory_id = ${memoryId}
        AND server_id = ${state.serverId}
        AND user_id = ${registeredUser.user_id}
      RETURNING *
    `;
    const validated = serverMemorySchema.safeParse(updatedMemory);
    if (!validated.success) return jsonError(context, 500, "memory_update_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({
      memory: serializeServerMemory(validated.data as unknown as Record<string, unknown>),
    });
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/my-server-memories/:memoryId`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");
    if (!guild.canManage && state.config.server_memteaching_enabled === false) {
      return jsonError(context, 403, "server_memory_teaching_disabled");
    }

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const memoryId = Number.parseInt(context.req.param("memoryId"), 10);
    if (!Number.isFinite(memoryId)) return jsonError(context, 400, "invalid_memory_id");

    const result = await sql`
      DELETE FROM server_memories
      WHERE server_memory_id = ${memoryId}
        AND server_id = ${state.serverId}
        AND user_id = ${registeredUser.user_id}
    `;
    if (result.count === 0) return jsonError(context, 404, "memory_not_found");

    invalidateTomoriStateCache(guildId);
    return context.json({
      deleted: true,
    });
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/personal-memories`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const personaLineageId = Number.parseInt(context.req.query("personaLineageId") || "0", 10);
    const lineageId = Number.isFinite(personaLineageId) ? personaLineageId : 0;
    const allowedLineages = new Set([0, ...state.personas.map((persona) => persona.persona_lineage_id ?? 0)]);
    if (!allowedLineages.has(lineageId)) return jsonError(context, 403, "lineage_forbidden");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const rows = await listPersonalMemories(registeredUser.user_id, lineageId);
    return context.json({
      memories: rows.map(serializePersonalMemory),
    });
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/personal-memories`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = personalMemoryCreateSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_personal_memory_payload");

    const allowedLineages = new Set([0, ...state.personas.map((persona) => persona.persona_lineage_id ?? 0)]);
    if (!allowedLineages.has(parsed.data.personaLineageId)) return jsonError(context, 403, "lineage_forbidden");

    const contentValidation = validateMemoryContent(parsed.data.content);
    if (!contentValidation.isValid) return jsonError(context, 400, contentValidation.error ?? "invalid_memory");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const duplicateExists = await findDuplicatePersonalMemory(
      registeredUser.user_id,
      parsed.data.personaLineageId,
      parsed.data.content,
    );
    if (duplicateExists) return jsonError(context, 409, "duplicate_memory");

    const memory = await addPersonalMemoryByTomori(
      registeredUser.user_id,
      parsed.data.personaLineageId,
      parsed.data.content,
    );
    if (!memory) return jsonError(context, 500, "personal_memory_create_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({
      memory: serializePersonalMemory(memory),
    });
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/personal-memories/:memoryId`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const memoryId = Number.parseInt(context.req.param("memoryId"), 10);
    const body = await context.req.json().catch(() => null);
    const parsed = personalMemoryUpdateSchema.safeParse(body);
    if (!Number.isFinite(memoryId) || !parsed.success) {
      return jsonError(context, 400, "invalid_personal_memory_payload");
    }

    const contentValidation = validateMemoryContent(parsed.data.content);
    if (!contentValidation.isValid) return jsonError(context, 400, contentValidation.error ?? "invalid_memory");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const [existingMemory] = await sql`
      SELECT *
      FROM personal_memories
      WHERE personal_memory_id = ${memoryId}
        AND user_id = ${registeredUser.user_id}
      LIMIT 1
    `;
    if (!existingMemory) return jsonError(context, 404, "personal_memory_not_found");

    const personaLineageId = Number(existingMemory.persona_lineage_id ?? 0);
    const allowedLineages = new Set([0, ...state.personas.map((persona) => persona.persona_lineage_id ?? 0)]);
    if (!allowedLineages.has(personaLineageId)) return jsonError(context, 403, "lineage_forbidden");

    const duplicateExists = await findDuplicatePersonalMemory(
      registeredUser.user_id,
      personaLineageId,
      parsed.data.content,
      memoryId,
    );
    if (duplicateExists) return jsonError(context, 409, "duplicate_memory");

    const [updatedMemory] = await sql`
      UPDATE personal_memories
      SET content = ${parsed.data.content}, updated_at = CURRENT_TIMESTAMP
      WHERE personal_memory_id = ${memoryId}
        AND user_id = ${registeredUser.user_id}
      RETURNING *
    `;
    const validated = personalMemorySchema.safeParse(updatedMemory);
    if (!validated.success) return jsonError(context, 500, "personal_memory_update_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({
      memory: serializePersonalMemory(validated.data),
    });
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/personal-memories/:memoryId`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const memoryId = Number.parseInt(context.req.param("memoryId"), 10);
    if (!Number.isFinite(memoryId)) return jsonError(context, 400, "invalid_personal_memory_id");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const [existingMemory] = await sql`
      SELECT persona_lineage_id
      FROM personal_memories
      WHERE personal_memory_id = ${memoryId}
        AND user_id = ${registeredUser.user_id}
      LIMIT 1
    `;
    if (!existingMemory) return jsonError(context, 404, "personal_memory_not_found");

    const personaLineageId = Number(existingMemory.persona_lineage_id ?? 0);
    const allowedLineages = new Set([0, ...state.personas.map((persona) => persona.persona_lineage_id ?? 0)]);
    if (!allowedLineages.has(personaLineageId)) return jsonError(context, 403, "lineage_forbidden");

    const result = await sql`
      DELETE FROM personal_memories
      WHERE personal_memory_id = ${memoryId}
        AND user_id = ${registeredUser.user_id}
    `;
    if (result.count === 0) return jsonError(context, 404, "personal_memory_not_found");

    invalidateTomoriStateCache(guildId);
    return context.json({
      deleted: true,
    });
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/personal-providers`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const body = await context.req.json().catch(() => null);
    const parsed = personalProviderCredentialSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_personal_provider_payload");

    const provider = parsed.data.provider;
    if (!personalProviderChoices().some((choice) => choice.value === provider)) {
      return jsonError(context, 400, "unsupported_provider");
    }

    if (parsed.data.validateApiKey) {
      try {
        const providerInstance = await ProviderFactory.getProviderByName(provider);
        const validationResult = await providerInstance.validateApiKey(parsed.data.apiKey);
        if (!validationResult.valid) return jsonError(context, 400, "provider_key_validation_failed");
      } catch (error) {
        await log.error("Settings website provider key validation failed", error);
        return jsonError(context, 502, "provider_key_validation_failed");
      }
    }

    const existingConfig = await loadUserSavedProviderConfig(registeredUser.user_id, provider);
    const encryptionResult = await encryptApiKey(parsed.data.apiKey);
    const savedConfig = await buildUserSavedProviderConfigFromExistingOrDefaults({
      userId: registeredUser.user_id,
      provider,
      apiKey: encryptionResult.encrypted,
      keyVersion: encryptionResult.version,
      baseConfig: state.config,
      existingConfig,
    });

    const saved = await upsertUserSavedProviderConfig(registeredUser.user_id, savedConfig);
    if (!saved) return jsonError(context, 500, "personal_provider_save_failed");

    invalidateUserCache(session.user.id);
    return context.json({ saved: true });
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/personal-providers`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const body = await context.req.json().catch(() => null);
    const parsed = personalProviderUpdateSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_personal_provider_update");

    const provider = parsed.data.provider;
    const existingConfig = await loadUserSavedProviderConfig(registeredUser.user_id, provider);
    if (!existingConfig) return jsonError(context, 404, "personal_provider_not_found");

    const personalCustomEndpoints = await loadCustomEndpointsForUser(registeredUser.user_id);
    const modelOptions = await loadPersonalProviderModelOptions(
      registeredUser.user_id,
      [existingConfig],
      personalCustomEndpoints as unknown as Array<Record<string, unknown>>,
    );
    const providerOptions = modelOptions[provider] ?? {};
    const hasOption = (key: string, value: number) =>
      (providerOptions[key] ?? []).some((option) => String(option.value) === String(value));

    if (parsed.data.llmId !== undefined && parsed.data.llmId !== null && !hasOption("text", parsed.data.llmId)) {
      return jsonError(context, 400, "invalid_text_model");
    }
    if (
      parsed.data.visionLlmId !== undefined &&
      parsed.data.visionLlmId !== null &&
      !hasOption("vision", parsed.data.visionLlmId)
    ) {
      return jsonError(context, 400, "invalid_vision_model");
    }
    if (
      parsed.data.embeddingModelId !== undefined &&
      parsed.data.embeddingModelId !== null &&
      !hasOption("embedding", parsed.data.embeddingModelId)
    ) {
      return jsonError(context, 400, "invalid_embedding_model");
    }
    if (
      parsed.data.imageModelId !== undefined &&
      parsed.data.imageModelId !== null &&
      !hasOption("image", parsed.data.imageModelId)
    ) {
      return jsonError(context, 400, "invalid_image_model");
    }
    if (
      parsed.data.videoModelId !== undefined &&
      parsed.data.videoModelId !== null &&
      !hasOption("video", parsed.data.videoModelId)
    ) {
      return jsonError(context, 400, "invalid_video_model");
    }

    const nextConfig = { ...existingConfig };
    if (parsed.data.llmId !== undefined) nextConfig.llm_id = parsed.data.llmId;
    if (parsed.data.visionLlmId !== undefined) nextConfig.vision_llm_id = parsed.data.visionLlmId;
    if (parsed.data.embeddingModelId !== undefined) nextConfig.embedding_model_id = parsed.data.embeddingModelId;
    if (parsed.data.videoModelId !== undefined) nextConfig.video_model_id = parsed.data.videoModelId;
    if (parsed.data.imageModelId !== undefined) {
      const imageStyle = getStaticProviderInfo(provider)?.featureSupport.imageGeneration ?? "none";
      if (parsed.data.imageModelId === null) {
        nextConfig.diffusion_model_id = null;
        nextConfig.nai_diffusion_model_id = null;
      } else if (imageStyle === "nai-pipeline") {
        nextConfig.nai_diffusion_model_id = parsed.data.imageModelId;
      } else {
        nextConfig.diffusion_model_id = parsed.data.imageModelId;
      }
    }

    if (parsed.data.fallbackRefs !== undefined) {
      const allowedFallbacks = new Set((providerOptions.fallbackModels ?? []).map((option) => String(option.value)));
      for (const ref of parsed.data.fallbackRefs) {
        if (!allowedFallbacks.has(`${ref.type}:${ref.id}`)) {
          return jsonError(context, 400, "invalid_fallback_model");
        }
      }
      if (
        nextConfig.llm_id &&
        parsed.data.fallbackRefs.some((ref) => ref.type === "llm" && ref.id === nextConfig.llm_id)
      ) {
        return jsonError(context, 400, "fallback_matches_primary");
      }
      nextConfig.fallback_model_refs = parsed.data.fallbackRefs as FallbackModelRef[];
      nextConfig.fallback_llm_ids = parsed.data.fallbackRefs
        .filter((ref) => ref.type === "llm")
        .map((ref) => ref.id);
    }

    const allProviderRows = await loadUserSavedProviderConfigs(registeredUser.user_id);
    if (parsed.data.enabledCapabilities !== undefined) {
      nextConfig.enabled_capabilities = parsed.data.enabledCapabilities as PersonalProviderCapability[];
    }

    const saved = await upsertUserSavedProviderConfig(registeredUser.user_id, nextConfig);
    if (!saved) return jsonError(context, 500, "personal_provider_update_failed");

    if (parsed.data.enabledCapabilities !== undefined) {
      const requested = new Set(parsed.data.enabledCapabilities);
      for (const row of allProviderRows) {
        if (row.provider.toLowerCase() === provider) continue;
        const remainingCapabilities = row.enabled_capabilities.filter((capability) => !requested.has(capability));
        if (remainingCapabilities.length !== row.enabled_capabilities.length) {
          await upsertUserSavedProviderConfig(registeredUser.user_id, {
            ...row,
            enabled_capabilities: remainingCapabilities,
          });
        }
      }
    }

    invalidateUserCache(session.user.id);
    return context.json({ saved: true });
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/personal-providers`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const body = await context.req.json().catch(() => null);
    const parsed = personalProviderDeleteSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_personal_provider_delete");
    if (isCustomProvider(parsed.data.provider)) return jsonError(context, 400, "delete_custom_endpoint_instead");

    const deleted = await deleteUserSavedProviderConfig(registeredUser.user_id, parsed.data.provider);
    if (!deleted) return jsonError(context, 404, "personal_provider_not_found");

    invalidateUserCache(session.user.id);
    return context.json({ deleted: true });
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/personal-openrouter-models`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");
    if (!(await loadGuildState(guildId))) return jsonError(context, 404, "server_not_setup");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const body = await context.req.json().catch(() => null);
    const parsed = openRouterRegistrationSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_openrouter_model_payload");

    const result = await registerOpenRouterModelForScope(
      { kind: "personal", ownerId: registeredUser.user_id },
      parsed.data.capability,
      parsed.data.modelName,
    );
    if (result.status === "invalid_model") return jsonError(context, 400, "openrouter_model_not_found");

    invalidateUserCache(session.user.id);
    return context.json({
      status: result.status,
      model: serializeOpenRouterRegistration(result.model),
    });
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/personal-openrouter-models`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");
    if (!(await loadGuildState(guildId))) return jsonError(context, 404, "server_not_setup");

    const registeredUser = await ensureSessionUser(session);
    if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

    const body = await context.req.json().catch(() => null);
    const parsed = openRouterRegistrationDeleteSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_openrouter_model_delete");

    const result = await removeOpenRouterModelForScope(
      { kind: "personal", ownerId: registeredUser.user_id },
      parsed.data.capability,
      parsed.data.modelName,
    );
    if (result.status !== "removed") return jsonError(context, 404, "openrouter_model_not_found");

    invalidateUserCache(session.user.id);
    return context.json({
      deleted: true,
      stillReferenced: result.stillReferenced,
      model: serializeOpenRouterRegistration(result.model),
    });
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/custom-endpoints`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = customEndpointSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_custom_endpoint_payload");
    if (parsed.data.scope === "server" && !guild.canManage) {
      return jsonError(context, 403, "admin_required");
    }

    const registeredUser = parsed.data.scope === "personal" ? await ensureSessionUser(session) : null;
    if (parsed.data.scope === "personal" && !registeredUser?.user_id) {
      return jsonError(context, 500, "user_registration_failed");
    }

    const result = await registerCustomEndpoint({
      scope:
        parsed.data.scope === "server"
          ? { kind: "server", ownerId: state.serverId, baseConfig: state.config }
          : { kind: "personal", ownerId: registeredUser!.user_id, baseConfig: state.config },
      label: parsed.data.label,
      capability: parsed.data.capability as CustomEndpointCapability,
      apiStyle: parsed.data.apiStyle as CustomEndpointApiStyle,
      endpointUrl: parsed.data.endpointUrl,
      displayName: parsed.data.displayName,
      modelName: parsed.data.modelName ?? null,
      authToken: parsed.data.authToken ?? null,
      numCtx: parsed.data.numCtx ?? null,
      hasTools: parsed.data.hasTools ?? false,
      seesImages: parsed.data.seesImages ?? false,
      seesVideos: parsed.data.seesVideos ?? false,
      supportsStructOutput: parsed.data.supportsStructOutput ?? false,
    });
    if (!result) return jsonError(context, 500, "custom_endpoint_save_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({
      endpoint: serializeCustomEndpoint(result.customEndpoint as unknown as Record<string, unknown>),
      provider: result.provider,
      modelId: result.modelId,
    });
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/custom-endpoints`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = customEndpointDeleteSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_custom_endpoint_delete_payload");
    if (parsed.data.scope === "server" && !guild.canManage) {
      return jsonError(context, 403, "admin_required");
    }

    const registeredUser = parsed.data.scope === "personal" ? await ensureSessionUser(session) : null;
    if (parsed.data.scope === "personal" && !registeredUser?.user_id) {
      return jsonError(context, 500, "user_registration_failed");
    }

    const deleted = await removeCustomEndpointRegistration({
      scope:
        parsed.data.scope === "server"
          ? { kind: "server", ownerId: state.serverId, baseConfig: state.config }
          : { kind: "personal", ownerId: registeredUser!.user_id, baseConfig: state.config },
      label: parsed.data.label,
      capability: parsed.data.capability as CustomEndpointCapability,
    });
    if (!deleted) return jsonError(context, 404, "custom_endpoint_not_found");

    invalidateTomoriStateCache(guildId);
    return context.json({ deleted: true });
  });

  app.patch(`${BASE_PATH}/api/guilds/:guildId/fallbacks`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = fallbackUpdateSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_fallback_payload");

    const customEndpointIds = new Set(
      (await loadCustomEndpointsForServer(state.serverId)).map((endpoint) => endpoint.custom_endpoint_id),
    );
    for (const ref of parsed.data.refs) {
      if (ref.type === "custom_endpoint" && !customEndpointIds.has(ref.id)) {
        return jsonError(context, 400, "invalid_custom_endpoint_fallback");
      }
      if (ref.type === "llm") {
        const [llm] = await sql`SELECT llm_id FROM llms WHERE llm_id = ${ref.id} LIMIT 1`;
        if (!llm) return jsonError(context, 400, "invalid_llm_fallback");
      }
    }

    const saved = await setFallbackModelRefs(state.serverId, parsed.data.refs as FallbackModelRef[]);
    if (!saved) return jsonError(context, 500, "fallback_update_failed");

    invalidateTomoriStateCache(guildId);
    return context.json({ fallbackRefs: parsed.data.refs });
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/access/channel-whitelist`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = channelWhitelistSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_channel_whitelist_payload");
    if (!client.guilds.cache.get(guildId)?.channels.cache.has(parsed.data.channelDiscId)) {
      return jsonError(context, 400, "channel_not_found");
    }
    const hasCooldown = parsed.data.cooldownType !== null && parsed.data.cooldownType !== undefined;
    const cooldownType = hasCooldown ? parsed.data.cooldownType : null;
    const cooldownLength = hasCooldown ? (parsed.data.cooldownLength ?? 0) : null;

    await sql`
      INSERT INTO channel_whitelist (server_id, channel_disc_id, cooldown_type, cooldown_length)
      VALUES (${state.serverId}, ${parsed.data.channelDiscId}, ${cooldownType}, ${cooldownLength})
      ON CONFLICT (server_id, channel_disc_id) DO UPDATE SET
        cooldown_type = EXCLUDED.cooldown_type,
        cooldown_length = EXCLUDED.cooldown_length,
        updated_at = CURRENT_TIMESTAMP
    `;

    invalidateTomoriStateCache(guildId);
    return context.json({ saved: true });
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/access/channel-whitelist`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = channelWhitelistSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_channel_whitelist_payload");

    const result = await sql`
      DELETE FROM channel_whitelist
      WHERE server_id = ${state.serverId}
        AND channel_disc_id = ${parsed.data.channelDiscId}
    `;
    if (result.count === 0) return jsonError(context, 404, "channel_whitelist_not_found");

    invalidateTomoriStateCache(guildId);
    return context.json({ deleted: true });
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/access/role-whitelist`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = roleWhitelistSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_role_whitelist_payload");
    if (!client.guilds.cache.get(guildId)?.roles.cache.has(parsed.data.roleDiscId)) {
      return jsonError(context, 400, "role_not_found");
    }

    await sql`
      INSERT INTO role_whitelist (server_id, role_disc_id)
      VALUES (${state.serverId}, ${parsed.data.roleDiscId})
      ON CONFLICT (server_id, role_disc_id) DO NOTHING
    `;

    invalidateTomoriStateCache(guildId);
    return context.json({ saved: true });
  });

  app.delete(`${BASE_PATH}/api/guilds/:guildId/access/role-whitelist`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertGuildAdmin(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = roleWhitelistSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_role_whitelist_payload");

    const result = await sql`
      DELETE FROM role_whitelist
      WHERE server_id = ${state.serverId}
        AND role_disc_id = ${parsed.data.roleDiscId}
    `;
    if (result.count === 0) return jsonError(context, 404, "role_whitelist_not_found");

    invalidateTomoriStateCache(guildId);
    return context.json({ deleted: true });
  });

  app.get(`${BASE_PATH}/api/guilds/:guildId/memory-export`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const kind = context.req.query("kind") === "personal" ? "personal" : "server";
    if (kind === "server" && !guild.canManage) return jsonError(context, 403, "admin_required");

    const personaLineageId = Number.parseInt(context.req.query("personaLineageId") || "0", 10);
    const lineageId = Number.isFinite(personaLineageId) ? personaLineageId : 0;
    const allowedLineages = new Set([0, ...state.personas.map((persona) => persona.persona_lineage_id ?? 0)]);
    if (!allowedLineages.has(lineageId)) return jsonError(context, 403, "lineage_forbidden");

    if (kind === "personal") {
      const registeredUser = await ensureSessionUser(session);
      if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");
      const rows = await listPersonalMemories(registeredUser.user_id, lineageId);
      return context.json({
        kind,
        personaLineageId: lineageId,
        memories: rows.map((row) => row.content),
      });
    }

    const rows = await listServerMemories(state.serverId, lineageId);
    return context.json({
      kind,
      personaLineageId: lineageId,
      memories: rows.map((row) => row.content),
    });
  });

  app.post(`${BASE_PATH}/api/guilds/:guildId/memory-import`, async (context) => {
    const session = getSession(context, config);
    if (!session) return jsonError(context, 401, "auth_required");
    if (!requireCsrf(context, session)) return jsonError(context, 403, "csrf_failed");

    const guildId = context.req.param("guildId");
    const guild = await assertSharedGuild(session, client, guildId);
    if (!guild) return jsonError(context, 403, "guild_forbidden");

    const state = await loadGuildState(guildId);
    if (!state) return jsonError(context, 404, "server_not_setup");

    const body = await context.req.json().catch(() => null);
    const parsed = memoryImportSchema.safeParse(body);
    if (!parsed.success) return jsonError(context, 400, "invalid_memory_import_payload");
    if (parsed.data.kind === "server" && !guild.canManage) return jsonError(context, 403, "admin_required");

    const allowedLineages = new Set([0, ...state.personas.map((persona) => persona.persona_lineage_id ?? 0)]);
    if (!allowedLineages.has(parsed.data.personaLineageId)) return jsonError(context, 403, "lineage_forbidden");

    const uniqueMemories = Array.from(new Set(parsed.data.memories.map((memory) => memory.trim()).filter(Boolean)));
    let inserted = 0;
    let skipped = 0;

    if (parsed.data.kind === "personal") {
      const registeredUser = await ensureSessionUser(session);
      if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

      for (const memory of uniqueMemories) {
        const contentValidation = validateMemoryContent(memory);
        if (!contentValidation.isValid) {
          skipped += 1;
          continue;
        }
        const duplicate = await findDuplicatePersonalMemory(
          registeredUser.user_id,
          parsed.data.personaLineageId,
          memory,
        );
        if (duplicate) {
          skipped += 1;
          continue;
        }
        const created = await addPersonalMemoryByTomori(registeredUser.user_id, parsed.data.personaLineageId, memory);
        if (created) inserted += 1;
        else skipped += 1;
      }
    } else {
      const persona =
        state.personas.find((item) => (item.persona_lineage_id ?? 0) === parsed.data.personaLineageId) ??
        state.personas[0];
      if (!persona?.tomori_id) return jsonError(context, 404, "persona_not_found");
      const registeredUser = await ensureSessionUser(session);
      if (!registeredUser?.user_id) return jsonError(context, 500, "user_registration_failed");

      for (const memory of uniqueMemories) {
        const contentValidation = validateMemoryContent(memory);
        if (!contentValidation.isValid) {
          skipped += 1;
          continue;
        }
        const duplicate = await findDuplicateMemory(state.serverId, parsed.data.personaLineageId, memory);
        if (duplicate) {
          skipped += 1;
          continue;
        }
        const limitCheck = await checkServerMemoryLimit(state.serverId, parsed.data.personaLineageId);
        if (!limitCheck.isValid) {
          skipped += 1;
          continue;
        }
        const created = await addServerMemoryByTomori(
          state.serverId,
          persona.tomori_id,
          parsed.data.personaLineageId,
          registeredUser.user_id,
          memory,
        );
        if (created) inserted += 1;
        else skipped += 1;
      }
    }

    invalidateTomoriStateCache(guildId);
    return context.json({ inserted, skipped });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
      if (session.expiresAt <= now || session.tokenExpiresAt <= now) {
        sessions.delete(sessionId);
      }
    }
  }, 10 * 60 * 1000);

  try {
    Bun.serve({
      hostname: config.host,
      port: config.port,
      fetch: app.fetch,
    });
    log.success(`Settings website listening at ${config.publicUrl}${BASE_PATH}`);
  } catch (error) {
    log.error("Failed to start settings website", error);
  }
}
