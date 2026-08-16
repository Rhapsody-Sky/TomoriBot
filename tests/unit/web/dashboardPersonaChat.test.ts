import { describe, expect, it } from "bun:test";
import type { TomoriState } from "@/types/db/schema";
import { dashboardTestChatInternals } from "@/web/dashboard/personaChatService";
import type { DashboardActor } from "@/web/dashboard/types";

function createState(): TomoriState {
  return {
    persona_id: 9,
    persona_nickname: "Tomori",
    llm: {
      has_tools: true,
    },
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
      verbatim_tool_calling_enabled: true,
    },
  } as TomoriState;
}

describe("dashboard persona test chat isolation", () => {
  it("disables tools, media, humanization, and message side effects without mutating the source", () => {
    const source = createState();
    const safe = dashboardTestChatInternals.safeTestState(source);

    expect(source.config.tool_use_enabled).toBe(true);
    expect(safe.llm.has_tools).toBe(false);
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
      verbatim_tool_calling_enabled: false,
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
