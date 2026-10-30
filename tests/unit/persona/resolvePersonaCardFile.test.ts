import { describe, expect, it } from "bun:test";
import { PRESET_EXPORT_VERSION } from "@/types/preset/presetExport";
import { resolvePersonaCardFile } from "@/utils/persona/resolvePersonaCardFile";

const MAX_FILE_SIZE = 1024 * 1024;

describe("resolvePersonaCardFile", () => {
  it("resolves a native TomoriBot JSON export without an avatar", () => {
    const resolution = resolvePersonaCardFile(
      "character.json",
      Buffer.from(
        JSON.stringify({
          version: PRESET_EXPORT_VERSION,
          type: "preset",
          exported_at: new Date(0).toISOString(),
          data: {
            tomori_nickname: "Replacement",
            attribute_list: ["Replacement attribute"],
            attribute_public_flags: [true],
            sample_dialogues_in: ["Hello"],
            sample_dialogues_out: ["Hi"],
            trigger_words: ["Replacement"],
            persona_prompt: "Replacement prompt",
            persona_lineage_id: 123_456,
          },
        }),
      ),
      MAX_FILE_SIZE,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.source).toBe("tomori-json");
    expect(resolution.avatarImageBuffer).toBeNull();
    expect(resolution.presetData.tomori_nickname).toBe("Replacement");
    expect(resolution.presetData.persona_lineage_id).toBe(123_456);
  });

  it("converts a supported SillyTavern JSON card", () => {
    const resolution = resolvePersonaCardFile(
      "character.json",
      Buffer.from(
        JSON.stringify({
          spec: "chara_card_v2",
          data: {
            name: "zaya test",
            description: "A competitive team captain.",
            personality: "Proud but helpful.",
            first_mes: "Ready for the next challenge?",
          },
        }),
      ),
      MAX_FILE_SIZE,
    );

    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.source).toBe("sillytavern-json");
    expect(resolution.avatarImageBuffer).toBeNull();
    expect(resolution.presetData.tomori_nickname).toBe("Zaya test");
    expect(resolution.presetData.trigger_words).toContain("zaya test");
  });

  it("reports malformed JSON without attempting card conversion", () => {
    expect(resolvePersonaCardFile("character.json", Buffer.from("{invalid"), MAX_FILE_SIZE)).toEqual({
      ok: false,
      reason: "invalid_json",
    });
  });
});
