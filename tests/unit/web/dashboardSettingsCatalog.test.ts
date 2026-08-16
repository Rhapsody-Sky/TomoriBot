import { describe, expect, it } from "bun:test";
import { SETTINGS_CATALOG, parseSettingsPatch, serializeSettingsValues } from "@/web/dashboard/settingsCatalog";

describe("dashboard settings catalog", () => {
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
    expect(SETTINGS_CATALOG.every((section) => Object.hasOwn(serialized, section.id))).toBe(true);
  });

  it("provides concise help text for every public server setting", () => {
    const fields = SETTINGS_CATALOG.flatMap((section) => section.fields);

    expect(fields.length).toBeGreaterThan(70);
    expect(fields.every((field) => typeof field.hint === "string" && field.hint.trim().length >= 20)).toBe(true);
  });
});
