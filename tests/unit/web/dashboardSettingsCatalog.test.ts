import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { TomoriDashboardCore } from "@/web/dashboard/core";
import { configRepository, personaRepository } from "@/utils/db/repositories";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { createPersona, createServerConfig } from "../../helpers/fixtures";
import { getSettingsCatalog, parseSettingsPatch, serializeSettingsValues } from "@/web/dashboard/settingsCatalog";
import { initializeLocalizer } from "@/utils/text/localizer";
import { TOOL_NOTICE_KEYS } from "@/constants/toolNotices";
import { MAX_MESSAGES_PER_CHANNEL } from "@/utils/cache/shortTermMemoryCache";

describe("dashboard settings catalog", () => {
  beforeAll(() => initializeLocalizer());
  afterEach(() => mock.restore());

  it("routes STM writes to the owning repository and reads the persisted result", async () => {
    const core = new TomoriDashboardCore();
    const snapshot = {
      serverId: 42,
      serverDiscordId: "123456789012345678",
      config: createServerConfig(),
      personas: [],
      rawPersonas: [],
    };
    const patch = { refresh_cadence: 8, content_injection_depth: 3 };
    const write = spyOn(shortTermMemoryRepository, "upsertStmConfig").mockResolvedValue(true);
    const otherWrite = spyOn(configRepository, "updateMemoryConfig").mockResolvedValue(true);
    spyOn(core, "loadStmSettings").mockResolvedValue({
      ...patch,
      render_mode: "supersede",
      crude_message_count: 6,
      nudge_injection_depth: 2,
      tool_description_override: null,
      update_nudge_override: null,
    });
    spyOn(personaRepository, "loadState").mockResolvedValue(createPersona());
    expect(await core.updateSettings(snapshot, "stm", patch)).toMatchObject(patch);
    expect(write).toHaveBeenCalledWith(42, patch);
    expect(otherWrite).not.toHaveBeenCalled();
  });
  it("accepts current notice keys and rejects removed global model flags", () => {
    const notices = { tool_notice_hidden_keys: [...TOOL_NOTICE_KEYS], tool_notice_verbosity: "minimal" };
    expect(parseSettingsPatch("notices", notices)).toEqual(notices);
    expect(parseSettingsPatch("notices", { tool_notice_verbosity: "unknown" })).toBeNull();
    expect(parseSettingsPatch("capabilities", { verbatim_tool_calling_enabled: true })).toBeNull();
    const capabilities = {
      response_drafting_enabled: true,
      conditioning_interactions_enabled: false,
      dice_rolling_enabled: true,
      danbooru_enabled: false,
      short_term_memory_enabled: false,
      user_info_updates_enabled: false,
    };
    expect(parseSettingsPatch("capabilities", capabilities)).toEqual(capabilities);
  });

  it("validates fractional timezones and draft review inputs", () => {
    expect(parseSettingsPatch("chat", { timezone_offset: 5.75 })).toEqual({ timezone_offset: 5.75 });
    expect(parseSettingsPatch("chat", { timezone_offset: 5.1 })).toBeNull();
    expect(parseSettingsPatch("chat", { response_review_items: ["persona", "tools"] })).toEqual({
      response_review_items: ["persona", "tools"],
    });
    expect(parseSettingsPatch("chat", { response_review_items: ["persona", "persona"] })).toBeNull();
    expect(parseSettingsPatch("chat", { response_reviewer_prompt: " " })).toEqual({ response_reviewer_prompt: null });
    expect(parseSettingsPatch("chat", { response_reviewer_prompt: "x".repeat(4001) })).toBeNull();
    expect(parseSettingsPatch("chat", { response_prefill: "x".repeat(2001) })).toBeNull();
    expect(parseSettingsPatch("stm", { crude_message_count: MAX_MESSAGES_PER_CHANNEL })).toEqual({
      crude_message_count: MAX_MESSAGES_PER_CHANNEL,
    });
    expect(parseSettingsPatch("stm", { crude_message_count: MAX_MESSAGES_PER_CHANNEL + 1 })).toBeNull();
    expect(parseSettingsPatch("stm", { tool_description_override: "" })).toEqual({ tool_description_override: null });
  });
  it("keeps each settings request inside its declared config domain", () => {
    expect(parseSettingsPatch("memory", { memory_tagging_enabled: true })).toEqual({
      memory_tagging_enabled: true,
    });
    expect(parseSettingsPatch("memory", { llm_temperature: 0.7 })).toBeNull();
    expect(parseSettingsPatch("modelBehavior", { memory_tagging_enabled: true })).toBeNull();
  });

  it("uses the current cooldown enum, including command-category cooldowns", () => {
    expect(parseSettingsPatch("triggers", { cooldown_type: 5 })).toEqual({
      cooldown_type: 5,
    });
    expect(parseSettingsPatch("triggers", { cooldown_type: 6 })).toBeNull();
  });

  it("rejects unknown notice keys and out-of-range sampler values", () => {
    expect(parseSettingsPatch("notices", { tool_notice_hidden_keys: ["web_search"] })).toEqual({
      tool_notice_hidden_keys: ["web_search"],
    });
    expect(parseSettingsPatch("notices", { tool_notice_hidden_keys: ["invented_notice"] })).toBeNull();
    expect(parseSettingsPatch("sampling", { llm_top_k: 257 })).toBeNull();
  });

  it("serializes only fields that are represented in the public catalog", () => {
    const serialized = serializeSettingsValues({
      llm_temperature: 0.5,
      memory_tagging_enabled: true,
      api_key: Buffer.from("secret"),
    });

    expect(serialized.modelBehavior.llm_temperature).toBe(0.5);
    expect(serialized.memory.memory_tagging_enabled).toBe(true);
    expect(JSON.stringify(serialized)).not.toContain("secret");
    expect(getSettingsCatalog().every((section) => Object.hasOwn(serialized, section.id))).toBe(true);
  });

  it("provides concise help text for every public server setting", () => {
    const fields = getSettingsCatalog().flatMap((section) => section.fields);

    expect(fields.length).toBeGreaterThan(70);
    expect(fields.every((field) => typeof field.hint === "string" && field.hint.trim().length >= 20)).toBe(true);
    expect(fields.every((field) => !field.label.startsWith("general.") && !field.label.startsWith("commands."))).toBe(
      true,
    );
  });
});
