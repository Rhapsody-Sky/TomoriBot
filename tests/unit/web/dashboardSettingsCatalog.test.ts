import { afterEach, beforeAll, describe, expect, it, mock, spyOn } from "bun:test";
import { TomoriDashboardCore } from "@/web/dashboard/core";
import { configRepository, personaRepository } from "@/utils/db/repositories";
import { shortTermMemoryRepository } from "@/utils/db/repositories/ShortTermMemoryRepository";
import { userNamingRepository } from "@/utils/db/repositories/UserNamingRepository";
import { personalConfigOperations } from "@/utils/discord/interactions/personalConfigOperations";
import { createPersona, createServerConfig } from "../../helpers/fixtures";
import { getSettingsCatalog, parseSettingsPatch, serializeSettingsValues } from "@/web/dashboard/settingsCatalog";
import { initializeLocalizer } from "@/utils/text/localizer";
import { localizedCopy } from "../../helpers/localeCases";
import { TOOL_NOTICE_KEYS } from "@/constants/toolNotices";
import { MAX_MESSAGES_PER_CHANNEL } from "@/utils/cache/shortTermMemoryCache";
import ts from "typescript";
import { runInNewContext } from "node:vm";

describe("dashboard settings catalog", () => {
  beforeAll(() => initializeLocalizer());
  afterEach(() => mock.restore());

  it("places every catalog field in exactly one task-based panel without crossing write domains", async () => {
    const source = await Bun.file("src/web/dashboard/assets/app.js").text();
    const ast = ts.createSourceFile("app.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    type Source = { section: string; fields?: string[] };
    type Panel = Source & { sources?: Source[] };
    const panels: Panel[] = [];
    const walk = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "settingsGroups" && node.initializer) {
        const groups = runInNewContext(`(${node.initializer.getText(ast)})`) as { panels: Panel[] }[];
        panels.push(...groups.flatMap((group) => group.panels));
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(ast) === "renderSettingsPanel" &&
        node.arguments[0] &&
        ts.isObjectLiteralExpression(node.arguments[0])
      ) {
        panels.push(runInNewContext(`(${node.arguments[0].getText(ast)})`) as Panel);
      }
      ts.forEachChild(node, walk);
    };
    walk(ast);
    const catalog = getSettingsCatalog();
    const placements = panels.flatMap((panel) =>
      (panel.sources || [panel]).flatMap((source) => {
        const section = catalog.find((entry) => entry.id === source.section);
        if (!section) throw new Error(`Unknown settings section: ${source.section}`);
        const fields = source.fields || section.fields.map((field) => field.key);
        for (const key of fields) expect(section.fields.some((field) => field.key === key)).toBe(true);
        return fields.map((key) => `${source.section}.${key}`);
      }),
    );
    expect(placements.sort()).toEqual(
      catalog.flatMap((section) => section.fields.map((field) => `${section.id}.${field.key}`)).sort(),
    );
  });

  it("replaces ordered STM definitions without writing stored STM contents", async () => {
    const write = spyOn(shortTermMemoryRepository, "upsertStmCategories").mockResolvedValue(true);
    const categories = [
      { label: "summary", description: "Recent context" },
      { label: "Goals", description: "Current goals" },
    ];
    expect(await new TomoriDashboardCore().updateStmCategories(42, categories)).toBe(true);
    expect(write).toHaveBeenCalledWith(
      42,
      categories.map((category, position) => ({ ...category, position })),
    );
  });

  it("uses the existing personal operation for naming writes and propagates failure", async () => {
    const write = spyOn(personalConfigOperations, "setPersonaNaming").mockResolvedValue({ status: "success" });
    const input = {
      userId: 7,
      userDiscId: "123456789012345678",
      personaLineageId: 77,
      nickname: null,
      prefix: "",
      suffix: null,
    };
    const core = new TomoriDashboardCore();
    expect(await core.updatePersonaNaming(input)).toBe(true);
    expect(write).toHaveBeenCalledWith(input);
    write.mockResolvedValue({ status: "write-failed" });
    expect(await core.updatePersonaNaming(input)).toBe(false);
  });

  it("loads only the current user's lineage preferences, preserving explicit empty values", async () => {
    const preference = {
      user_id: 7,
      persona_lineage_id: 77,
      nickname_override: "Mirri",
      prefix_override: "",
      suffix_override: null,
    };
    const read = spyOn(userNamingRepository, "loadPreferences").mockResolvedValue(
      new Map([
        ["7:77", preference],
        ["8:77", { ...preference, user_id: 8 }],
      ]),
    );
    const persona = {
      personaId: 9,
      lineageId: 77,
      nickname: "Tomori",
      isAlter: true,
      isPointer: false,
      avatarUrl: null,
      triggerWords: [],
      personaPrompt: null,
      attributes: [],
      sampleDialogues: [],
      contextNote: null,
      contextNoteDepth: 0,
      physicalAppearanceTags: [],
      humanizerOverride: null,
    };
    const snapshot = {
      serverId: 42,
      serverDiscordId: "123456789012345678",
      config: createServerConfig(),
      personas: [persona, { ...persona, personaId: 10 }],
      rawPersonas: [],
    };
    const result = await new TomoriDashboardCore().loadPersonaNaming(7, snapshot);
    expect(read).toHaveBeenCalledWith([
      { userId: 7, personaLineageId: 77 },
      { userId: 7, personaLineageId: 77 },
    ]);
    expect(result).toEqual({
      9: { nickname: "Mirri", prefix: "", suffix: null },
      10: { nickname: "Mirri", prefix: "", suffix: null },
    });
  });

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

  it("explains every hideable notice without changing its saved key", () => {
    const field = getSettingsCatalog()
      .find((section) => section.id === "notices")
      ?.fields.find((entry) => entry.key === "tool_notice_hidden_keys");
    expect(field?.options?.map((option) => option.value)).toEqual([...TOOL_NOTICE_KEYS]);
    for (const key of TOOL_NOTICE_KEYS) {
      expect(field?.options?.find((option) => option.value === key)?.description).toBe(
        localizedCopy("en-US", `general.dashboard.hidden_notice_help.${key}`),
      );
    }
  });
});
