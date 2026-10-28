import { z } from "zod";
import { NOTICE_VERBOSITY_LEVELS, TOOL_NOTICE_DEFINITIONS, TOOL_NOTICE_KEYS } from "@/constants/toolNotices";
import { RESPONSE_REVIEW_ITEMS } from "@/constants/responseReview";
import { responseReviewerPromptSchema, responseReviewItemsSchema, utcOffsetSchema } from "@/types/db/schema";
import { ASSISTANT_PREFILL_MAX_LENGTH } from "@/utils/chat/assistantPrefill";
import { localizer } from "@/utils/text/localizer";
import { MAX_MESSAGES_PER_CHANNEL } from "@/utils/cache/shortTermMemoryCache";

export const SETTINGS_SECTION_IDS = [
  "modelBehavior",
  "chat",
  "sampling",
  "triggers",
  "capabilities",
  "memberPermissions",
  "notices",
  "memory",
  "stm",
  "channelScope",
  "autochat",
  "speech",
  "novelai",
  "byok",
  "welcome",
  "nsfw",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];
export type SettingsFieldType =
  | "toggle"
  | "number"
  | "text"
  | "textarea"
  | "select"
  | "tags"
  | "channels"
  | "multiselect"
  | "persona";

export interface SettingsFieldDefinition {
  key: string;
  label: string;
  hint?: string;
  type: SettingsFieldType;
  min?: number;
  max?: number;
  step?: number;
  nullable?: boolean;
  options?: Array<{ value: string | number; label: string; description?: string }>;
}

export interface SettingsSectionDefinition {
  id: SettingsSectionId;
  eyebrow: string;
  title: string;
  description: string;
  fields: SettingsFieldDefinition[];
}

const nullableText = (maxLength: number) =>
  z
    .preprocess((value) => {
      if (value === null) return null;
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }, z.string().max(maxLength).nullable())
    .optional();

const snowflakeSchema = z.string().regex(/^\d{16,22}$/);
const snowflakeArraySchema = z.array(snowflakeSchema).max(100);
const tagsSchema = z.array(z.string().trim().min(1).max(120)).max(80);

const modelBehaviorSchema = z
  .object({
    llm_temperature: z.number().min(0).max(2).optional(),
    thinking_level: z.enum(["auto", "none", "minimal", "low", "medium", "high"]).optional(),
    hide_respond_embed: z.boolean().optional(),
  })
  .strict();

const chatSchema = z
  .object({
    humanizer_degree: z.number().int().min(0).max(3).optional(),
    message_fetch_limit: z.number().int().min(20).max(100).optional(),
    send_message_limit: z.number().int().min(0).max(40).optional(),
    match_limit: z.number().int().min(1).max(10).optional(),
    cascade_limit: z.number().int().min(0).max(10).optional(),
    timezone_offset: utcOffsetSchema.optional(),
    self_debug_enabled: z.boolean().optional(),
    model_randomizer_enabled: z.boolean().optional(),
    system_prompt: nullableText(12_000),
    context_note: nullableText(4_000),
    context_note_depth: z.number().int().min(0).max(100).optional(),
    response_prefill: nullableText(ASSISTANT_PREFILL_MAX_LENGTH),
    response_reviewer_prompt: z
      .preprocess(
        (value) => (typeof value === "string" && !value.trim() ? null : value),
        responseReviewerPromptSchema.nullable(),
      )
      .optional(),
    response_review_items: responseReviewItemsSchema.optional(),
  })
  .strict();

const samplingSchema = z
  .object({
    llm_top_p: z.number().min(0).max(1).optional(),
    llm_top_k: z.number().int().min(0).max(256).optional(),
    llm_frequency_penalty: z.number().min(-2).max(2).optional(),
    llm_presence_penalty: z.number().min(-2).max(2).optional(),
    llm_min_p: z.number().min(0).max(1).optional(),
    llm_max_output_tokens: z.number().int().min(1).max(131_072).nullable().optional(),
    llm_stop_strings: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    llm_stop_speaker_pattern_enabled: z.boolean().optional(),
  })
  .strict();

const triggersSchema = z
  .object({
    always_reply_enabled: z.boolean().optional(),
    deliberate_trigger_mode: z.boolean().optional(),
    deliberate_tool_mode: z.boolean().optional(),
    deliberate_tool_context_turns: z.number().int().min(0).max(10).nullable().optional(),
    cooldown_type: z.number().int().min(0).max(5).optional(),
    cooldown_length: z.number().int().min(0).max(86_400).optional(),
  })
  .strict();

const noticesSchema = z
  .object({
    tool_notice_hidden_keys: z.array(z.enum(TOOL_NOTICE_KEYS)).max(TOOL_NOTICE_KEYS.length).optional(),
    tool_notice_verbosity: z.enum(NOTICE_VERBOSITY_LEVELS).optional(),
  })
  .strict();

const capabilitiesSchema = z
  .object({
    emoji_usage_enabled: z.boolean().optional(),
    sticker_usage_enabled: z.boolean().optional(),
    web_search_enabled: z.boolean().optional(),
    manage_message_enabled: z.boolean().optional(),
    thread_creation_enabled: z.boolean().optional(),
    imagegen_enabled: z.boolean().optional(),
    videogen_enabled: z.boolean().optional(),
    voice_message_enabled: z.boolean().optional(),
    user_blocking_enabled: z.boolean().optional(),
    time_awareness_enabled: z.boolean().optional(),
    tool_use_enabled: z.boolean().optional(),
    response_drafting_enabled: z.boolean().optional(),
    conditioning_interactions_enabled: z.boolean().optional(),
    dice_rolling_enabled: z.boolean().optional(),
    danbooru_enabled: z.boolean().optional(),
    short_term_memory_enabled: z.boolean().optional(),
    user_info_updates_enabled: z.boolean().optional(),
  })
  .strict();

const memberPermissionsSchema = z
  .object({
    server_memteaching_enabled: z.boolean().optional(),
    attribute_memteaching_enabled: z.boolean().optional(),
    sampledialogue_memteaching_enabled: z.boolean().optional(),
    self_teaching_enabled: z.boolean().optional(),
    personal_memories_enabled: z.boolean().optional(),
    hide_impersonation_embeds: z.boolean().optional(),
    prompt_snapshot_enabled: z.boolean().optional(),
  })
  .strict();

const memorySchema = z
  .object({
    memory_tagging_enabled: z.boolean().optional(),
    channel_memory_enabled: z.boolean().optional(),
  })
  .strict();

const stmSchema = z
  .object({
    refresh_cadence: z.number().int().min(1).max(100).optional(),
    render_mode: z.enum(["supersede", "crude_summary"]).optional(),
    crude_message_count: z.number().int().min(1).max(MAX_MESSAGES_PER_CHANNEL).optional(),
    nudge_injection_depth: z.number().int().min(0).max(20).optional(),
    content_injection_depth: z.number().int().min(-1).max(20).optional(),
    tool_description_override: nullableText(4000),
    update_nudge_override: nullableText(4000),
  })
  .strict();

const channelScopeSchema = z
  .object({
    rp_channel_ids: snowflakeArraySchema.optional(),
    private_channel_ids: snowflakeArraySchema.optional(),
    crosschannel_blocklist_ids: snowflakeArraySchema.optional(),
    stm_privacy_bypass: z.boolean().optional(),
    thought_log_channel_disc_id: snowflakeSchema.nullable().optional(),
  })
  .strict();

const autochatSchema = z
  .object({
    autoch_disc_ids: snowflakeArraySchema.optional(),
    autoch_threshold: z.number().int().min(0).max(10_000).optional(),
    autoch_threshold_max: z.number().int().min(0).max(10_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.autoch_threshold === undefined ||
      value.autoch_threshold_max === undefined ||
      value.autoch_threshold_max === 0 ||
      value.autoch_threshold <= value.autoch_threshold_max,
    { message: "The minimum autochat threshold cannot exceed the maximum." },
  );

const speechSchema = z
  .object({
    voice_transcript_chat_mode: z.boolean().optional(),
    chatterbox_turbo_enabled: z.boolean().optional(),
    chatterbox_cfg_weight: z.number().min(0).max(1).optional(),
    chatterbox_exaggeration: z.number().min(0).max(1).optional(),
  })
  .strict();

const novelaiSchema = z
  .object({
    nai_preset_name: nullableText(120),
    image_default_positive_tags: tagsSchema.optional(),
    image_default_negative_tags: tagsSchema.optional(),
    nai_sampler: nullableText(80),
    nai_steps: z.number().int().min(1).max(50).nullable().optional(),
    nai_scale: z.number().min(0).max(20).nullable().optional(),
    nai_noise_schedule: nullableText(80),
    nai_cfg_rescale: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

const byokSchema = z.object({ user_byok_mode: z.boolean().optional() }).strict();

const welcomeSchema = z
  .object({
    welcome_channel_disc_id: snowflakeSchema.nullable().optional(),
    welcome_prompt: nullableText(4_000),
    welcome_persona_id: z.number().int().positive().nullable().optional(),
  })
  .strict();

const nsfwSchema = z
  .object({
    uncensor_injection_enabled: z.boolean().optional(),
    uncensor_unicode_space_enabled: z.boolean().optional(),
    uncensor_sanitize_enabled: z.boolean().optional(),
  })
  .strict();

export const SETTINGS_SECTION_SCHEMAS = {
  modelBehavior: modelBehaviorSchema,
  chat: chatSchema,
  sampling: samplingSchema,
  triggers: triggersSchema,
  capabilities: capabilitiesSchema,
  memberPermissions: memberPermissionsSchema,
  notices: noticesSchema,
  memory: memorySchema,
  stm: stmSchema,
  channelScope: channelScopeSchema,
  autochat: autochatSchema,
  speech: speechSchema,
  novelai: novelaiSchema,
  byok: byokSchema,
  welcome: welcomeSchema,
  nsfw: nsfwSchema,
} satisfies Record<SettingsSectionId, z.ZodType>;

const getSettingsFieldHints = (): Record<string, string> => ({
  refresh_cadence: localizer("en-US", "general.dashboard.stm_cadence_hint"),
  render_mode: localizer("en-US", "general.dashboard.stm_render_hint"),
  crude_message_count: localizer("en-US", "general.dashboard.stm_messages_hint"),
  nudge_injection_depth: localizer("en-US", "general.dashboard.stm_nudge_hint"),
  content_injection_depth: localizer("en-US", "general.dashboard.stm_depth_hint"),
  tool_description_override: localizer("en-US", "general.dashboard.stm_tool_hint"),
  update_nudge_override: localizer("en-US", "general.dashboard.stm_update_hint"),
  llm_temperature: "Controls response variety. Lower values are steadier; higher values are more creative.",
  thinking_level: "Sets the reasoning effort used by models that support adjustable thinking.",
  hide_respond_embed: "Hides the technical response-details panel shown below Tomori's messages.",
  humanizer_degree: "Adds natural variation to phrasing and message rhythm. Higher levels are more noticeable.",
  message_fetch_limit: "Number of recent Discord messages loaded as conversation context for each response.",
  send_message_limit: "Maximum number of separate Discord messages Tomori may send for one response.",
  match_limit: "Maximum number of personas whose trigger words may match a single incoming message.",
  cascade_limit: "Maximum additional persona responses that may be triggered after the first match.",
  timezone_offset: "Server-wide UTC offset used when Tomori reasons about local dates and times.",
  self_debug_enabled: "Lets Tomori include diagnostic details when her own response generation fails.",
  model_randomizer_enabled: "Allows eligible configured models to be selected with additional variation.",
  system_prompt: "Server-wide instructions added to every persona. Leave empty to use the normal default.",
  context_note: "Persistent server context inserted into the prompt at the configured depth.",
  context_note_depth: "How far back in the assembled conversation the server context note is inserted.",
  llm_top_p: "Limits token choices to a cumulative probability range. Lower values are more focused.",
  llm_top_k: "Limits each generated token to the most likely candidates. Zero may disable the limit.",
  llm_frequency_penalty: "Discourages words in proportion to how often they have already appeared.",
  llm_presence_penalty: "Discourages any token that has appeared, encouraging new topics or wording.",
  llm_min_p: "Removes token candidates that are too unlikely relative to the most likely token.",
  llm_max_output_tokens: "Hard limit for generated output length. Empty uses the active model's default.",
  llm_stop_strings: "Comma-separated text sequences that immediately stop further generation.",
  llm_stop_speaker_pattern_enabled: "Stops output when the model appears to begin writing for another speaker.",
  always_reply_enabled: "Makes Tomori answer every eligible message instead of waiting for a trigger.",
  deliberate_trigger_mode: "Requires explicit trigger intent and reduces accidental persona activations.",
  deliberate_tool_mode: "Makes tool use more deliberate instead of allowing tools whenever they seem useful.",
  deliberate_tool_context_turns: "Number of recent turns considered when deciding whether to use a tool.",
  cooldown_type: "Chooses whether response cooldowns apply per user, channel, server, or command category.",
  cooldown_length: "Minimum seconds required between responses in the selected cooldown scope.",
  tool_use_enabled: "Allows Tomori to call supported tools while preparing a response.",
  web_search_enabled: "Allows Tomori to search the web when current or external information is needed.",
  manage_message_enabled: "Allows supported tools to edit or remove Discord messages.",
  thread_creation_enabled: "Allows Tomori to create Discord threads when a workflow needs one.",
  imagegen_enabled: "Allows image-generation models and endpoints to be used on this server.",
  videogen_enabled: "Allows video-generation models and endpoints to be used on this server.",
  voice_message_enabled: "Allows Tomori to create and send generated voice messages.",
  emoji_usage_enabled: "Allows Tomori to use server and standard emoji in responses.",
  sticker_usage_enabled: "Allows Tomori to send available Discord stickers.",
  user_blocking_enabled: "Allows configured blocking tools to restrict users from interacting with Tomori.",
  time_awareness_enabled: "Adds current date and time information to Tomori's context.",
  response_drafting_enabled: localizer("en-US", "general.dashboard.response_drafting_hint"),
  conditioning_interactions_enabled: localizer("en-US", "commands.capabilities.manage.conditioninginteractions_desc"),
  dice_rolling_enabled: localizer("en-US", "commands.capabilities.manage.dicerolling_desc"),
  danbooru_enabled: localizer("en-US", "commands.capabilities.manage.danbooru_desc"),
  short_term_memory_enabled: localizer("en-US", "general.dashboard.short_term_memory_hint"),
  user_info_updates_enabled: localizer("en-US", "commands.capabilities.manage.userinfo_desc"),
  response_prefill: localizer("en-US", "general.dashboard.response_prefill_hint"),
  response_reviewer_prompt: localizer("en-US", "general.dashboard.response_reviewer_hint"),
  response_review_items: localizer("en-US", "general.dashboard.response_review_items_hint"),
  tool_notice_verbosity: localizer("en-US", "general.dashboard.notice_verbosity_hint"),
  server_memteaching_enabled: "Lets members teach shared memories scoped to themselves and a persona lineage.",
  attribute_memteaching_enabled: "Lets regular members add or change persona memory attributes.",
  sampledialogue_memteaching_enabled: "Lets regular members teach example dialogue for persona behavior.",
  self_teaching_enabled: "Allows Tomori to extract and store eligible memories from conversation by herself.",
  personal_memories_enabled: "Allows members to create and use private memories tied to their own account.",
  hide_impersonation_embeds: "Hides the notice normally shown when Tomori writes in a member's voice.",
  prompt_snapshot_enabled: "Lets members inspect a sanitized snapshot of the prompt used for a response.",
  tool_notice_hidden_keys: "Checked notices stay hidden while their underlying tools continue to work.",
  memory_tagging_enabled: "Classifies memories with tags to improve filtering and relevant-memory retrieval.",
  channel_memory_enabled: "Associates eligible long-term memories with the channel where they were taught.",
  rp_channel_ids: "Selected channels suppress normal roleplay behavior and persona-trigger handling.",
  private_channel_ids: "Selected channels keep short-term conversation context isolated from other channels.",
  crosschannel_blocklist_ids: "Context from selected channels is never shared into another channel.",
  stm_privacy_bypass: "Allows server context rules to bypass members' normal short-term-memory privacy boundary.",
  thought_log_channel_disc_id: "Optional channel where Tomori posts configured thought and reasoning logs.",
  autoch_disc_ids: "Channels where Tomori may join conversations automatically without a direct trigger.",
  autoch_threshold: "Minimum activity threshold used before an automatic response becomes eligible.",
  autoch_threshold_max: "Upper autochat threshold. Set to zero when no maximum is desired.",
  voice_transcript_chat_mode: "Adds voice-message transcripts to normal chat context.",
  chatterbox_turbo_enabled: "Uses faster Chatterbox generation, trading some quality for speed.",
  chatterbox_cfg_weight: "Controls how strongly Chatterbox follows voice and text conditioning.",
  chatterbox_exaggeration: "Increases vocal expression and emphasis in generated Chatterbox speech.",
  nai_preset_name: "Default NovelAI text preset used when no command-specific preset is selected.",
  image_default_positive_tags: "Tags added by default to describe desired generated-image content.",
  image_default_negative_tags: "Tags added by default to discourage unwanted content or visual traits.",
  nai_sampler: "NovelAI sampling algorithm used when an image request does not override it.",
  nai_steps: "Number of diffusion steps. More steps can improve detail but take longer.",
  nai_scale: "How strongly the image follows the prompt. Extreme values may reduce quality.",
  nai_noise_schedule: "Controls how denoising strength changes over the NovelAI generation process.",
  nai_cfg_rescale: "Reduces overexposure and artifacts caused by strong prompt guidance.",
  user_byok_mode: "Requires members to configure personal credentials instead of using server keys.",
  welcome_channel_disc_id: "Channel where Tomori sends automated messages when a member joins.",
  welcome_persona_id: "Persona used to write and send the server's welcome message.",
  welcome_prompt: "Instructions for welcome messages. Leave empty to use the normal behavior.",
  uncensor_injection_enabled: "Adds an optional prompt workaround for overly strict provider filters.",
  uncensor_unicode_space_enabled: "Uses Unicode spacing to reduce false-positive text filtering.",
  uncensor_sanitize_enabled: "Cleans provider filter artifacts from output before it is sent.",
});

const toggle = (key: string, label: string, hint?: string): SettingsFieldDefinition => ({
  key,
  label,
  hint,
  type: "toggle",
});

const number = (
  key: string,
  label: string,
  min: number,
  max: number,
  options: Pick<SettingsFieldDefinition, "step" | "nullable" | "hint"> = {},
): SettingsFieldDefinition => ({ key, label, type: "number", min, max, ...options });

const getSettingsCatalogSource = (): SettingsSectionDefinition[] => [
  {
    id: "stm",
    eyebrow: localizer("en-US", "general.dashboard.memory"),
    title: localizer("en-US", "general.dashboard.stm_title"),
    description: localizer("en-US", "general.dashboard.stm_description"),
    fields: [
      number("refresh_cadence", localizer("en-US", "general.dashboard.stm_cadence"), 1, 100),
      {
        key: "render_mode",
        label: localizer("en-US", "general.dashboard.stm_render"),
        type: "select",
        options: [
          { value: "crude_summary", label: localizer("en-US", "general.dashboard.stm_combined") },
          { value: "supersede", label: localizer("en-US", "general.dashboard.stm_supersede") },
        ],
      },
      number("crude_message_count", localizer("en-US", "general.dashboard.stm_messages"), 1, MAX_MESSAGES_PER_CHANNEL),
      number("nudge_injection_depth", localizer("en-US", "general.dashboard.stm_nudge"), 0, 20),
      number("content_injection_depth", localizer("en-US", "general.dashboard.stm_depth"), -1, 20),
      {
        key: "tool_description_override",
        label: localizer("en-US", "general.dashboard.stm_tool"),
        type: "textarea",
        nullable: true,
      },
      {
        key: "update_nudge_override",
        label: localizer("en-US", "general.dashboard.stm_update"),
        type: "textarea",
        nullable: true,
      },
    ],
  },
  {
    id: "modelBehavior",
    eyebrow: "Models",
    title: "Model behavior",
    description: "Generation temperature, reasoning effort, and response presentation.",
    fields: [
      number("llm_temperature", "Temperature", 0, 2, { step: 0.05 }),
      {
        key: "thinking_level",
        label: "Thinking level",
        type: "select",
        options: [
          { value: "auto", label: "Automatic" },
          { value: "none", label: "None" },
          { value: "minimal", label: "Minimal" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
        ],
      },
      toggle("hide_respond_embed", "Hide response details"),
    ],
  },
  {
    id: "chat",
    eyebrow: "Conversation",
    title: "Conversation defaults",
    description: "Server-wide response shape and context defaults.",
    fields: [
      {
        key: "humanizer_degree",
        label: "Humanizer",
        type: "select",
        options: [
          { value: 0, label: "Off" },
          { value: 1, label: "Light" },
          { value: 2, label: "Natural" },
          { value: 3, label: "Heavy" },
        ],
      },
      number("message_fetch_limit", "Messages fetched", 20, 100),
      number("send_message_limit", "Reply message limit", 0, 40),
      number("match_limit", "Persona match limit", 1, 10),
      number("cascade_limit", "Cascade limit", 0, 10),
      number("timezone_offset", "Timezone offset", -12, 14, { step: 0.25 }),
      toggle("self_debug_enabled", "Self-debug"),
      toggle("model_randomizer_enabled", "Model randomizer"),
      { key: "system_prompt", label: "System prompt", type: "textarea", nullable: true },
      { key: "context_note", label: "Context note", type: "textarea", nullable: true },
      number("context_note_depth", "Context note depth", 0, 100),
      {
        key: "response_prefill",
        label: localizer("en-US", "general.dashboard.response_prefill"),
        type: "textarea",
        nullable: true,
      },
      {
        key: "response_reviewer_prompt",
        label: localizer("en-US", "general.dashboard.response_reviewer"),
        type: "textarea",
        nullable: true,
      },
      {
        key: "response_review_items",
        label: localizer("en-US", "general.dashboard.response_review_items"),
        type: "multiselect",
        options: RESPONSE_REVIEW_ITEMS.map((item) => ({ value: item.value, label: localizer("en-US", item.labelKey) })),
      },
    ],
  },
  {
    id: "sampling",
    eyebrow: "Models",
    title: "Sampling",
    description: "Advanced output sampling and stop conditions for the active text model.",
    fields: [
      number("llm_top_p", "Top P", 0, 1, { step: 0.01 }),
      number("llm_top_k", "Top K", 0, 256),
      number("llm_frequency_penalty", "Frequency penalty", -2, 2, { step: 0.05 }),
      number("llm_presence_penalty", "Presence penalty", -2, 2, { step: 0.05 }),
      number("llm_min_p", "Min P", 0, 1, { step: 0.01 }),
      number("llm_max_output_tokens", "Maximum output tokens", 1, 131_072, { nullable: true }),
      { key: "llm_stop_strings", label: "Stop strings", type: "tags" },
      toggle("llm_stop_speaker_pattern_enabled", "Stop at speaker pattern"),
    ],
  },
  {
    id: "triggers",
    eyebrow: "Conversation",
    title: "Triggers and cooldowns",
    description: "When Tomori joins a conversation and how frequently she can respond.",
    fields: [
      toggle("always_reply_enabled", "Always reply"),
      toggle("deliberate_trigger_mode", "Deliberate trigger mode"),
      toggle("deliberate_tool_mode", "Deliberate tool mode"),
      number("deliberate_tool_context_turns", "Tool context turns", 0, 10, { nullable: true }),
      {
        key: "cooldown_type",
        label: "Cooldown type",
        type: "select",
        options: [
          { value: 0, label: "None" },
          { value: 1, label: "Per user" },
          { value: 2, label: "Per channel" },
          { value: 3, label: "Server-wide (admins exempt)" },
          { value: 4, label: "Strict server-wide" },
          { value: 5, label: "Per command category" },
        ],
      },
      number("cooldown_length", "Cooldown seconds", 0, 86_400),
    ],
  },
  {
    id: "capabilities",
    eyebrow: "Capabilities",
    title: "Tools and media",
    description: "Features Tomori may use while responding.",
    fields: [
      toggle("tool_use_enabled", "Tool use"),
      toggle("web_search_enabled", "Web search"),
      toggle("manage_message_enabled", "Message management"),
      toggle("thread_creation_enabled", "Thread creation"),
      toggle("imagegen_enabled", "Image generation"),
      toggle("videogen_enabled", "Video generation"),
      toggle("voice_message_enabled", "Voice messages"),
      toggle("emoji_usage_enabled", "Emoji use"),
      toggle("sticker_usage_enabled", "Sticker use"),
      toggle("user_blocking_enabled", "User blocking"),
      toggle("time_awareness_enabled", "Time awareness"),
      toggle("response_drafting_enabled", localizer("en-US", "general.dashboard.response_drafting")),
      toggle(
        "conditioning_interactions_enabled",
        localizer("en-US", "commands.capabilities.manage.conditioninginteractions_option"),
      ),
      toggle("dice_rolling_enabled", localizer("en-US", "commands.capabilities.manage.dicerolling_option")),
      toggle("danbooru_enabled", localizer("en-US", "commands.capabilities.manage.danbooru_option")),
      toggle("short_term_memory_enabled", localizer("en-US", "general.dashboard.short_term_memory")),
      toggle("user_info_updates_enabled", localizer("en-US", "commands.capabilities.manage.userinfo_option")),
    ],
  },
  {
    id: "memberPermissions",
    eyebrow: "Permissions",
    title: "Member permissions",
    description: "Actions regular server members are allowed to perform.",
    fields: [
      toggle("server_memteaching_enabled", "Teach server memories"),
      toggle("attribute_memteaching_enabled", "Teach attributes"),
      toggle("sampledialogue_memteaching_enabled", "Teach sample dialogue"),
      toggle("self_teaching_enabled", "Autonomous self-teaching"),
      toggle("personal_memories_enabled", "Use personal memories"),
      toggle("hide_impersonation_embeds", "Hide impersonation notices"),
      toggle("prompt_snapshot_enabled", "Prompt snapshots"),
    ],
  },
  {
    id: "notices",
    eyebrow: "Presentation",
    title: "Hidden notices",
    description: "Select progress and attribution notices that should not be shown.",
    fields: [
      {
        key: "tool_notice_hidden_keys",
        label: "Hidden notice types",
        type: "multiselect",
        options: TOOL_NOTICE_DEFINITIONS.map((notice) => ({
          value: notice.key,
          label: localizer("en-US", notice.labelKey),
          description: localizer("en-US", `general.dashboard.hidden_notice_help.${notice.key}`),
        })),
      },
      {
        key: "tool_notice_verbosity",
        label: localizer("en-US", "general.dashboard.notice_verbosity"),
        type: "select",
        options: NOTICE_VERBOSITY_LEVELS.map((value) => ({
          value,
          label: localizer("en-US", `general.dashboard.notice_${value}`),
        })),
      },
    ],
  },
  {
    id: "memory",
    eyebrow: "Memory",
    title: "Memory behavior",
    description: "How long-term memory is classified and scoped.",
    fields: [
      toggle("memory_tagging_enabled", "Memory tagging"),
      toggle("channel_memory_enabled", "Channel-scoped memory"),
    ],
  },
  {
    id: "channelScope",
    eyebrow: "Channels",
    title: "Channel boundaries",
    description: "Where context may be read, shared, or logged.",
    fields: [
      { key: "rp_channel_ids", label: "Roleplay suppression", type: "channels" },
      { key: "private_channel_ids", label: "Private short-term memory", type: "channels" },
      { key: "crosschannel_blocklist_ids", label: "Cross-channel blocklist", type: "channels" },
      toggle("stm_privacy_bypass", "Short-term memory privacy bypass"),
      { key: "thought_log_channel_disc_id", label: "Thought log channel", type: "select", nullable: true },
    ],
  },
  {
    id: "autochat",
    eyebrow: "Channels",
    title: "Autochat",
    description: "Channels and thresholds for automatic conversation joins.",
    fields: [
      { key: "autoch_disc_ids", label: "Autochat channels", type: "channels" },
      number("autoch_threshold", "Minimum threshold", 0, 10_000),
      number("autoch_threshold_max", "Maximum threshold", 0, 10_000),
    ],
  },
  {
    id: "speech",
    eyebrow: "Voice",
    title: "Voice processing",
    description: "Voice transcription and local Chatterbox generation behavior.",
    fields: [
      toggle("voice_transcript_chat_mode", "Transcriptions enter chat context"),
      toggle("chatterbox_turbo_enabled", "Chatterbox turbo"),
      number("chatterbox_cfg_weight", "CFG weight", 0, 1, { step: 0.05 }),
      number("chatterbox_exaggeration", "Exaggeration", 0, 1, { step: 0.05 }),
    ],
  },
  {
    id: "novelai",
    eyebrow: "Image generation",
    title: "NovelAI defaults",
    description: "Default image tags and sampler parameters.",
    fields: [
      { key: "nai_preset_name", label: "Preset name", type: "text", nullable: true },
      { key: "image_default_positive_tags", label: "Positive tags", type: "tags" },
      { key: "image_default_negative_tags", label: "Negative tags", type: "tags" },
      { key: "nai_sampler", label: "Sampler", type: "text", nullable: true },
      number("nai_steps", "Steps", 1, 50, { nullable: true }),
      number("nai_scale", "Prompt guidance", 0, 20, { step: 0.1, nullable: true }),
      { key: "nai_noise_schedule", label: "Noise schedule", type: "text", nullable: true },
      number("nai_cfg_rescale", "CFG rescale", 0, 1, { step: 0.05, nullable: true }),
    ],
  },
  {
    id: "byok",
    eyebrow: "Providers",
    title: "User provider policy",
    description: "Whether members must supply their own provider credentials.",
    fields: [toggle("user_byok_mode", "Require user BYOK")],
  },
  {
    id: "welcome",
    eyebrow: "Onboarding",
    title: "Welcome messages",
    description: "Where and how Tomori welcomes new server members.",
    fields: [
      { key: "welcome_channel_disc_id", label: "Welcome channel", type: "select", nullable: true },
      { key: "welcome_persona_id", label: "Welcome persona", type: "persona", nullable: true },
      { key: "welcome_prompt", label: "Welcome prompt", type: "textarea", nullable: true },
    ],
  },
  {
    id: "nsfw",
    eyebrow: "Advanced",
    title: "Text workarounds",
    description: "Optional response cleanup for strict provider filters.",
    fields: [
      toggle("uncensor_injection_enabled", "Prompt injection workaround"),
      toggle("uncensor_unicode_space_enabled", "Unicode spacing workaround"),
      toggle("uncensor_sanitize_enabled", "Sanitize filtered output"),
    ],
  },
];

export function getSettingsCatalog(): SettingsSectionDefinition[] {
  const hints = getSettingsFieldHints();
  return getSettingsCatalogSource().map((section) => ({
    ...section,
    fields: section.fields.map((field) => ({ ...field, hint: field.hint ?? hints[field.key] })),
  }));
}

export function isSettingsSectionId(value: string): value is SettingsSectionId {
  return (SETTINGS_SECTION_IDS as readonly string[]).includes(value);
}

export function parseSettingsPatch(sectionId: SettingsSectionId, value: unknown): Record<string, unknown> | null {
  const parsed = SETTINGS_SECTION_SCHEMAS[sectionId].safeParse(value);
  if (!parsed.success || Object.keys(parsed.data as object).length === 0) return null;
  return parsed.data as Record<string, unknown>;
}

export function serializeSettingsValues(
  config: Record<string, unknown>,
): Record<SettingsSectionId, Record<string, unknown>> {
  return Object.fromEntries(
    getSettingsCatalog().map((section) => [
      section.id,
      Object.fromEntries(section.fields.map((field) => [field.key, config[field.key] ?? null])),
    ]),
  ) as Record<SettingsSectionId, Record<string, unknown>>;
}
