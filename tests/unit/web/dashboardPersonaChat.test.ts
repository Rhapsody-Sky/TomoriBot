import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { TomoriState } from "@/types/db/schema";
import * as keyRotation from "@/utils/security/keyRotation";
import * as crypto from "@/utils/security/crypto";
import * as providerFactory from "@/utils/provider/providerFactory";
import { llmProviderRepo } from "@/utils/db/repositories";
import { savedProviderConfigSchema } from "@/types/db/schema";
import { dashboardTestChatInternals } from "@/web/dashboard/personaChatService";
import type { DashboardActor, DashboardGuildSnapshot } from "@/web/dashboard/types";
import { createLlmRow, createPersona, createServerConfig } from "../../helpers/fixtures";

function createState(): TomoriState {
  return createPersona({
    persona_id: 9,
    persona_nickname: "Tomori",
    llm: createLlmRow({
      has_tools: true,
      verbatim_tool_calling: true,
    }),
    config: {
      humanizer_degree: 3,
      send_message_limit: 4,
      tool_use_enabled: true,
      web_search_enabled: true,
      manage_message_enabled: true,
      thread_creation_enabled: true,
      imagegen_enabled: true,
      videogen_enabled: true,
      voice_message_enabled: true,
      user_blocking_enabled: true,
      self_teaching_enabled: true,
      response_drafting_enabled: true,
      conditioning_interactions_enabled: true,
      user_info_updates_enabled: true,
    },
  });
}

describe("dashboard persona test chat isolation", () => {
  afterEach(() => mock.restore());

  it("uses persona model and its server credential only without an active personal text route", async () => {
    const state = createState();
    state.persona_llm = createLlmRow({ llm_id: 22, llm_provider: "openrouter", llm_codename: "persona-model" });
    const saved = savedProviderConfigSchema.parse({
      server_id: state.server_id,
      provider: "openrouter",
      api_key: Buffer.from("persona-key"),
      llm_id: 22,
      diffusion_model_id: null,
      embedding_model_id: null,
      nai_diffusion_model_id: null,
      nai_preset_name: null,
    });
    const load = spyOn(llmProviderRepo, "loadSavedProviderConfig").mockResolvedValue(saved);
    const personal = await dashboardTestChatInternals.resolveTestChatModel(state, true);
    expect(personal).toBe(state);
    expect(load).not.toHaveBeenCalled();
    const server = await dashboardTestChatInternals.resolveTestChatModel(state, false);
    expect(server.llm.llm_id).toBe(22);
    expect(server.config.api_key).toEqual(saved.api_key);
    expect(load).toHaveBeenCalledWith(state.server_id, "openrouter");
    load.mockResolvedValue(null);
    await expect(dashboardTestChatInternals.resolveTestChatModel(state, false)).rejects.toMatchObject({
      code: "provider_key_missing",
    });
  });

  it("uses the personal credential without consulting server rotation", async () => {
    const state = createState();
    state.config.api_key = Buffer.from("encrypted-personal-key");
    const rotation = spyOn(keyRotation, "selectApiKey").mockResolvedValue({
      apiKey: "server-key",
      rotationKeyId: 1,
      isMainKey: false,
    });
    spyOn(crypto, "decryptApiKey").mockResolvedValue("personal-key");
    spyOn(providerFactory, "getProviderForTomori").mockResolvedValue({
      getInfo: () => ({ requiresApiKey: true }),
    } as Awaited<ReturnType<typeof providerFactory.getProviderForTomori>>);

    expect(await dashboardTestChatInternals.resolveApiKey(state, "personal")).toBe("personal-key");
    expect(rotation).not.toHaveBeenCalled();
    expect(await dashboardTestChatInternals.resolveApiKey(state, "server")).toBe("server-key");
    expect(rotation).toHaveBeenCalledTimes(1);
  });

  it("accepts long assistant history while keeping user and history limits", () => {
    const parse = (messages: Array<{ role: "user" | "assistant"; content: string }>) =>
      dashboardTestChatInternals.testChatSchema.safeParse({ personaId: 9, messages }).success;
    const user = { role: "user" as const, content: "hello" };
    expect(parse([{ role: "assistant", content: "a".repeat(10_000) }, user])).toBe(true);
    expect(parse([{ role: "user", content: "a".repeat(4_001) }])).toBe(false);
    expect(parse([{ role: "assistant", content: "a".repeat(1_048_577) }, user])).toBe(false);
    expect(parse(Array.from({ length: 25 }, () => user))).toBe(false);
  });

  it("groups resolved sprite runs and scopes preview images to server personas", () => {
    const snapshot: DashboardGuildSnapshot = {
      serverId: 1,
      serverDiscordId: "123456789012345678",
      config: createServerConfig(),
      rawPersonas: [createState()],
      personas: [],
    };
    const sprite = { personaId: 9, spriteName: "Happy", isIdentity: false };
    const result = dashboardTestChatInternals.buildPresentation(
      [
        { text: "Hello!", sprite },
        { text: "\nStill smiling.", sprite },
        { text: "Another voice.", sprite: { ...sprite, spriteName: "The Voice", isIdentity: true } },
        { text: "Back to normal." },
        { text: "No foreign sprite.", sprite: { ...sprite, personaId: 100 } },
      ],
      snapshot,
    );
    expect(result).toHaveLength(3);
    expect(result[0]?.content).toBe("Hello!\nStill smiling.");
    expect(result[0]?.sprite?.imageUrl).toBe(
      "/settings/api/guilds/123456789012345678/personas/9/sprites/image?key=happy",
    );
    expect(result[1]?.sprite).toMatchObject({ name: "The Voice", identity: true, displayName: "The Voice (Tomori)" });
    expect(result[2]?.sprite).toBeNull();
    expect(result[2]?.content).toContain("No foreign sprite.");
  });
  it("disables tools, media, humanization, and message side effects without mutating the source", () => {
    const source = createState();
    const safe = dashboardTestChatInternals.safeTestState(source);

    expect(source.config.tool_use_enabled).toBe(true);
    expect(safe.llm.has_tools).toBe(false);
    expect(safe.llm.verbatim_tool_calling).toBe(false);
    expect(source.llm.verbatim_tool_calling).toBe(true);
    expect(safe.config).toMatchObject({
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
      response_drafting_enabled: false,
      conditioning_interactions_enabled: false,
      dice_rolling_enabled: false,
      danbooru_enabled: false,
      user_info_updates_enabled: false,
    });
  });

  it("maps browser history to synthetic context messages", () => {
    const actor = {
      discordId: "987654321098765432",
      user: { user_id: 7, user_nickname: "Dashboard user" },
    } as DashboardActor;
    const history = dashboardTestChatInternals.buildHistory(
      [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Welcome." },
      ],
      actor,
      createState(),
    );

    expect(history.map((message) => message.authorType)).toEqual(["user", "persona"]);
    expect(history[0]?.authorId).toBe(actor.discordId);
    expect(history[1]?.personaName).toBe("Tomori");
  });
});
