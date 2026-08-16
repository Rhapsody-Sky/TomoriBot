import type { BaseGuildTextChannel, Client, Guild, Message, MessageCreateOptions } from "discord.js";
import { z } from "zod";
import { buildContext } from "@/utils/text/context/builder";
import type { SimplifiedMessageForContext } from "@/utils/text/context/types";
import { applyPersonalProviderSelectionsToTomoriState } from "@/utils/provider/personalProviderRuntime";
import { getProviderForTomori } from "@/utils/provider/providerFactory";
import { selectApiKey } from "@/utils/security/keyRotation";
import { decryptApiKey } from "@/utils/security/crypto";
import type { TomoriState } from "@/types/db/schema";
import type { StreamingContext } from "@/types/tool/interfaces";
import { DashboardServiceError } from "./errors";
import type { DashboardActor, DashboardGuildSnapshot } from "./types";

const testChatSchema = z
  .object({
    personaId: z.number().int().positive(),
    messages: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().trim().min(1).max(4_000),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict()
  .refine((value) => value.messages.at(-1)?.role === "user", {
    message: "The last test-chat message must come from the user.",
  });

const activeChats = new Set<string>();

function safeTestState(state: TomoriState): TomoriState {
  return {
    ...state,
    llm: {
      ...state.llm,
      has_tools: false,
    },
    config: {
      ...state.config,
      humanizer_degree: 0,
      send_message_limit: 0,
      tool_use_enabled: false,
      web_search_enabled: false,
      manage_message_enabled: false,
      thread_creation_enabled: false,
      imagegen_enabled: false,
      videogen_enabled: false,
      voice_message_enabled: false,
      user_blocking_enabled: false,
      self_teaching_enabled: false,
      verbatim_tool_calling_enabled: false,
    },
  };
}

function buildHistory(
  messages: Array<{ role: "user" | "assistant"; content: string }>,
  actor: DashboardActor,
  persona: TomoriState,
): SimplifiedMessageForContext[] {
  const now = Date.now();
  return messages.map((message, index) => ({
    id: `dashboard-test-${index + 1}`,
    authorId: message.role === "user" ? actor.discordId : `persona-${persona.persona_id ?? 0}`,
    authorName: message.role === "user" ? actor.user.user_nickname : persona.persona_nickname,
    authorType: message.role === "user" ? "user" : "persona",
    personaName: message.role === "assistant" ? persona.persona_nickname : null,
    content: message.content,
    createdAt: now - (messages.length - index) * 1_000,
    imageAttachments: [],
    videoAttachments: [],
  }));
}

function createCollectorChannel(guild: Guild, channelId: string, chunks: string[]): BaseGuildTextChannel {
  const channel = {
    id: channelId,
    guild,
    isThread: () => false,
    send: async (payload: string | MessageCreateOptions) => {
      const content = typeof payload === "string" ? payload : (payload.content ?? "");
      if (content) chunks.push(content);
      return {
        id: `${Date.now()}-${chunks.length}`,
        url: "",
        channelId,
        webhookId: null,
      } as Message;
    },
  };
  return channel as unknown as BaseGuildTextChannel;
}

async function resolveApiKey(state: TomoriState): Promise<string> {
  const provider = await getProviderForTomori(state);
  const selected = await selectApiKey(state);
  if (selected) return selected.apiKey;
  if (state.config.api_key) {
    return decryptApiKey(state.config.api_key, state.config.key_version || 1);
  }
  if (!provider.getInfo().requiresApiKey) return "";
  throw new DashboardServiceError("provider_key_missing", 422, "No usable text-provider credential is configured.");
}

export class DashboardPersonaChatService {
  constructor(private readonly client: Client) {}

  async reply(actor: DashboardActor, snapshot: DashboardGuildSnapshot, guild: Guild, value: unknown) {
    const parsed = testChatSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_test_chat", 422, parsed.error.issues[0]?.message || "Invalid chat.");
    }
    const basePersona = snapshot.rawPersonas.find((persona) => persona.persona_id === parsed.data.personaId);
    if (!basePersona) throw new DashboardServiceError("persona_not_found", 404, "Persona not found.");

    const activeKey = `${snapshot.serverDiscordId}:${actor.discordId}`;
    if (activeChats.has(activeKey)) {
      throw new DashboardServiceError("test_chat_busy", 409, "A test response is already being generated.");
    }
    activeChats.add(activeKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    try {
      const personalOverlay = await applyPersonalProviderSelectionsToTomoriState(basePersona, actor.user.user_id);
      const persona = safeTestState(personalOverlay.tomoriState);
      const history = buildHistory(parsed.data.messages, actor, persona);
      const channelId = `dashboard-test-${snapshot.serverDiscordId}-${actor.discordId}`;
      const context = await buildContext({
        guildId: snapshot.serverDiscordId,
        serverName: guild.name,
        serverDescription: guild.description,
        simplifiedMessageHistory: history,
        userList: [actor.user.user_nickname],
        channelDesc: "Private dashboard persona test chat. No Discord messages are sent.",
        channelName: "Dashboard test chat",
        channelId,
        client: this.client,
        triggererName: actor.user.user_nickname,
        triggererUserId: actor.user.user_id,
        tomoriNickname: persona.persona_nickname,
        tomoriAttributes: persona.attribute_list ?? [],
        publicPersonaAttributes: snapshot.rawPersonas
          .filter((entry) => entry.persona_id !== persona.persona_id)
          .map((entry) => ({
            personaId: entry.persona_id ?? 0,
            personaName: entry.persona_nickname,
            attributes: (entry.persona_attributes ?? [])
              .filter((attribute) => attribute.is_public)
              .map((attribute) => attribute.attribute_text),
          }))
          .filter((entry) => entry.personaId > 0 && entry.attributes.length > 0),
        tomoriConfig: persona.config,
        personaPrompt: persona.persona_prompt,
        personaLineageId: persona.persona_lineage_id,
        snapshot: {
          tomoriState: persona,
          triggererUserRow: actor.user,
          isTriggererBlacklisted: false,
          isTriggererOptedOut: actor.user.privacy_level === 2,
          triggererPrivacyLevel: actor.user.privacy_level,
          preloadedMember: guild.members.cache.get(actor.discordId) ?? null,
        },
        includeTimestamps: false,
      });

      const provider = await getProviderForTomori(persona);
      const apiKey = await resolveApiKey(persona);
      const providerConfig = await provider.createConfig(persona, apiKey);
      providerConfig.tools = undefined;
      const chunks: string[] = [];
      const channel = createCollectorChannel(guild, channelId, chunks);
      const streamingContext: StreamingContext = {
        disableYouTubeProcessing: true,
        disableAllTools: true,
        suppressUserErrors: true,
        abortSignal: controller.signal,
      };
      const result = await provider.streamToDiscord(
        channel,
        this.client,
        persona,
        providerConfig,
        context.contextItems,
        [],
        [],
        [],
        undefined,
        undefined,
        streamingContext,
        actor.user.language_pref,
        undefined,
        undefined,
        undefined,
        persona.persona_nickname,
      );
      if (result.status !== "completed") {
        throw new DashboardServiceError(
          "test_chat_failed",
          result.status === "timeout" ? 504 : 502,
          result.status === "timeout" ? "The test response timed out." : "The selected model could not answer.",
        );
      }
      const content = result.accumulatedText?.trim() || chunks.join("\n").trim();
      if (!content) throw new DashboardServiceError("test_chat_empty", 502, "The selected model returned no text.");
      return {
        content,
        model: persona.llm.llm_codename,
        provider: persona.llm.llm_provider,
      };
    } catch (error) {
      if (error instanceof DashboardServiceError) throw error;
      if (controller.signal.aborted) {
        throw new DashboardServiceError("test_chat_timeout", 504, "The test response timed out.");
      }
      throw new DashboardServiceError("test_chat_failed", 502, "The selected model could not answer.");
    } finally {
      clearTimeout(timeout);
      activeChats.delete(activeKey);
    }
  }
}

export const dashboardTestChatInternals = {
  buildHistory,
  safeTestState,
};
