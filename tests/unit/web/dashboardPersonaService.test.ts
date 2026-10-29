import { beforeAll, describe, expect, it, mock } from "bun:test";
import { initializeLocalizer } from "@/utils/text/localizer";
import type { Client } from "discord.js";
import type { TomoriDashboardCore } from "@/web/dashboard/core";
import { DashboardPersonaService } from "@/web/dashboard/personaService";
import { type DashboardSettingsCore, DashboardSettingsService } from "@/web/dashboard/settingsService";
import type { DashboardGuildSnapshot } from "@/web/dashboard/types";
import { createLlmRow, createPersona, createServerConfig, createUserRow } from "../../helpers/fixtures";
import { PRESET_MAX_ATTRIBUTES, PRESET_MAX_STRING_LENGTH, presetExportDataSchema } from "@/types/preset/presetExport";

function createSnapshot(isAlter = true): DashboardGuildSnapshot {
  return {
    serverId: 42,
    serverDiscordId: "123456789012345678",
    config: createServerConfig(),
    personas: [
      {
        personaId: 9,
        lineageId: 77,
        nickname: "Tomori",
        isAlter,
        isPointer: false,
        avatarUrl: null,
        triggerWords: ["Tomori"],
        personaPrompt: null,
        attributes: [{ text: "Quietly curious", isPublic: false }],
        sampleDialogues: [],
        contextNote: null,
        contextNoteDepth: 0,
        physicalAppearanceTags: [],
        humanizerOverride: null,
      },
    ],
    rawPersonas: [
      createPersona({
        persona_id: 9,
        persona_lineage_id: 77,
        persona_nickname: "Tomori",
        is_alter: isAlter,
        sample_dialogues_in: [],
        sample_dialogues_out: [],
      }),
    ],
  };
}

function createService() {
  const core = {
    updatePersonaAttributes: mock(async () => true),
    addPersonaSampleDialogue: mock(async () => true),
    updatePersonaSampleDialogue: mock(async () => true),
    removePersonaSampleDialogue: mock(async () => true),
    removePersona: mock(async () => true),
  };
  return {
    core,
    service: new DashboardPersonaService(core as unknown as TomoriDashboardCore, {} as Client),
  };
}

describe("dashboard personal and memory settings", () => {
  beforeAll(() => initializeLocalizer());

  it("validates category keys and Discord limits before replacing any definitions", async () => {
    const updateStmCategories = mock(async () => true);
    const service = new DashboardSettingsService({ updateStmCategories } as unknown as DashboardSettingsCore);
    const category = { label: "Recent events", description: "Events in this conversation" };
    for (const value of [
      null,
      { categories: [category], server_id: 99 },
      { categories: [{ ...category, position: 4 }] },
      { categories: Array(6).fill(category) },
      { categories: [category, { ...category, label: "recent-events" }] },
      { categories: [{ ...category, label: "!!!" }] },
      { categories: [{ ...category, label: "Recent: events" }] },
      { categories: [{ ...category, description: " " }] },
      { categories: [{ label: "a", description: "x".repeat(998) }] },
    ]) {
      await expect(service.updateStmCategories(createSnapshot(), value)).rejects.toMatchObject({
        code: "invalid_stm_categories",
        status: 422,
      });
    }
    expect(updateStmCategories).not.toHaveBeenCalled();
    const categories = [category, { label: "a", description: "x".repeat(997) }];
    expect(await service.updateStmCategories(createSnapshot(), { categories })).toEqual(categories);
    expect(updateStmCategories).toHaveBeenCalledWith(42, categories);
  });

  it("restores summary mode on empty categories and reports write failures", async () => {
    const updateStmCategories = mock(async () => true);
    const service = new DashboardSettingsService({ updateStmCategories } as unknown as DashboardSettingsCore);
    const restored = await service.updateStmCategories(createSnapshot(), { categories: [] });
    expect(restored).toHaveLength(1);
    expect(restored[0]?.label).toBe("summary");
    expect(updateStmCategories).toHaveBeenCalledWith(42, restored);
    updateStmCategories.mockResolvedValue(false);
    await expect(service.updateStmCategories(createSnapshot(), { categories: [] })).rejects.toMatchObject({
      status: 500,
    });
  });

  it("derives naming ownership and lineage from trusted inputs and preserves affix suppression", async () => {
    const updatePersonaNaming = mock(async () => true);
    const service = new DashboardSettingsService({ updatePersonaNaming } as unknown as DashboardSettingsCore);
    const user = { ...createUserRow(), user_id: 7 };
    const preference = { nickname: " Mirri ", prefix: null, suffix: "" };
    expect(await service.updatePersonaNaming(createSnapshot(), user, 9, preference)).toEqual({
      ...preference,
      nickname: "Mirri",
    });
    expect(updatePersonaNaming).toHaveBeenCalledWith({
      userId: 7,
      userDiscId: user.user_disc_id,
      personaLineageId: 77,
      nickname: "Mirri",
      prefix: null,
      suffix: "",
    });
    const reset = { nickname: null, prefix: null, suffix: null };
    expect(await service.updatePersonaNaming(createSnapshot(), user, 9, reset)).toEqual(reset);
    expect(updatePersonaNaming).toHaveBeenLastCalledWith({
      userId: 7,
      userDiscId: user.user_disc_id,
      personaLineageId: 77,
      ...reset,
    });
    updatePersonaNaming.mockClear();
    for (const value of [
      { ...preference, userId: 8 },
      { ...preference, personaLineageId: 88 },
      { nickname: null },
      { ...preference, prefix: "x".repeat(101) },
    ]) {
      await expect(service.updatePersonaNaming(createSnapshot(), user, 9, value)).rejects.toMatchObject({
        status: 422,
      });
    }
    await expect(service.updatePersonaNaming(createSnapshot(), user, 10, reset)).rejects.toMatchObject({ status: 404 });
    const unavailable = createSnapshot();
    const unavailablePersona = unavailable.personas[0];
    if (!unavailablePersona) throw new Error("Missing test persona");
    unavailablePersona.lineageId = 0;
    await expect(service.updatePersonaNaming(unavailable, user, 9, reset)).rejects.toMatchObject({ status: 404 });
    expect(updatePersonaNaming).not.toHaveBeenCalled();
    updatePersonaNaming.mockResolvedValue(false);
    await expect(service.updatePersonaNaming(createSnapshot(), user, 9, reset)).rejects.toMatchObject({ status: 500 });
  });
  it("saves new profile preferences only for the authenticated user and preserves explicit neutral addressing", async () => {
    const updateUser = mock(async () => createUserRow({ user_id: 7 }));
    const service = new DashboardSettingsService({ updateUser } as unknown as DashboardSettingsCore);
    const patch = {
      user_nickname: " ",
      gender_identity: "nonbinary",
      pronouns: "they/them",
      addressing_style: "neutral",
      personal_server_fallback_enabled: false,
      natural_nudge_opt_out: true,
      timezone_offset: 5.75,
    };
    await service.updateProfile(7, "987654321098765432", patch);
    expect(updateUser).toHaveBeenCalledWith(7, "987654321098765432", { ...patch, user_nickname: null });
    await expect(service.updateProfile(7, "987654321098765432", { ...patch, user_id: 8 })).rejects.toMatchObject({
      code: "invalid_profile",
    });
    await expect(service.updateProfile(7, "987654321098765432", { timezone_offset: 5.1 })).rejects.toMatchObject({
      code: "invalid_profile",
    });
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it("validates STM settings before forwarding the selected server and section", async () => {
    const snapshot = createSnapshot();
    const updateSettings = mock(async () => snapshot.config);
    const service = new DashboardSettingsService({ updateSettings } as unknown as DashboardSettingsCore);
    const patch = { refresh_cadence: 8, render_mode: "supersede", content_injection_depth: -1 };
    await service.updateSettings(snapshot, "stm", patch, new Set());
    expect(updateSettings).toHaveBeenCalledWith(snapshot, "stm", patch);
    for (const invalid of [
      { server_id: 43 },
      { refresh_cadence: 0 },
      { crude_message_count: 11 },
      { content_injection_depth: -2 },
    ]) {
      await expect(service.updateSettings(snapshot, "stm", invalid, new Set())).rejects.toMatchObject({
        code: "invalid_settings",
      });
    }
    expect(updateSettings).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported prefill without writing, but allows clearing it", async () => {
    const snapshot = createSnapshot(false);
    const persona = snapshot.rawPersonas[0];
    if (!persona) throw new Error("Missing test persona");
    persona.llm = createLlmRow({
      supports_assistant_prefill: false,
      supports_prefix_completion: false,
      llm_provider: "openrouter",
    });
    const updateSettings = mock(async () => snapshot.config);
    const service = new DashboardSettingsService({ updateSettings } as unknown as DashboardSettingsCore);
    await expect(
      service.updateSettings(snapshot, "chat", { response_prefill: "Hello" }, new Set()),
    ).rejects.toMatchObject({ code: "prefill_unsupported" });
    expect(updateSettings).not.toHaveBeenCalled();
    await service.updateSettings(snapshot, "chat", { response_prefill: "" }, new Set());
    expect(updateSettings).toHaveBeenCalledWith(snapshot, "chat", { response_prefill: null });
  });
});

describe("dashboard persona mutations", () => {
  it("saves all attributes and edits every dialogue of a larger imported persona", async () => {
    const { core, service } = createService();
    const snapshot = createSnapshot();
    const persona = snapshot.rawPersonas[0];
    if (!persona) throw new Error("Missing test persona");
    const attributes = Array.from({ length: 24 }, (_, index) => ({
      text: index === 0 ? "a".repeat(PRESET_MAX_STRING_LENGTH) : `Character fact ${index}`,
      isPublic: index % 2 === 0,
    }));
    persona.attribute_list = attributes.map(({ text }) => text);
    persona.sample_dialogues_in = Array.from({ length: 16 }, (_, index) => `Question ${index}`);
    persona.sample_dialogues_out = Array.from({ length: 16 }, (_, index) => `Answer ${index}`);

    await service.replaceAttributes(snapshot, 9, { attributes });
    expect(core.updatePersonaAttributes).toHaveBeenCalledWith(
      snapshot,
      9,
      attributes.map(({ text }) => text),
      attributes.map(({ isPublic }) => isPublic),
    );
    for (let index = 0; index < persona.sample_dialogues_in.length; index++) {
      const input = persona.sample_dialogues_in[index];
      const output = "r".repeat(PRESET_MAX_STRING_LENGTH);
      await service.updateDialogue(snapshot, 9, index, { input, output });
      expect(core.updatePersonaSampleDialogue).toHaveBeenLastCalledWith(snapshot, 9, index, input, output);
    }
    await service.addDialogue(snapshot, 9, { input: "Another question", output: "Another answer" });
    expect(core.addPersonaSampleDialogue).toHaveBeenCalledWith(snapshot, 9, "Another question", "Another answer");
  });

  it("retains preset import bounds and rejects invalid or foreign persona edits before writes", async () => {
    const { core, service } = createService();
    const snapshot = createSnapshot();
    for (const attributes of [
      Array.from({ length: PRESET_MAX_ATTRIBUTES + 1 }, () => ({ text: "Fact", isPublic: false })),
      [{ text: "x".repeat(PRESET_MAX_STRING_LENGTH + 1), isPublic: false }],
      [{ text: " ", isPublic: false }],
      [{ text: "Fact", isPublic: false, personaId: 10 }],
    ]) {
      await expect(service.replaceAttributes(snapshot, 9, { attributes })).rejects.toMatchObject({ status: 422 });
    }
    await expect(
      service.updateDialogue(snapshot, 10, 0, { input: "Question", output: "Answer" }),
    ).rejects.toMatchObject({ status: 404 });
    for (const patch of [
      { input: "x".repeat(PRESET_MAX_STRING_LENGTH + 1), output: "Answer" },
      { input: "Question", output: "x".repeat(PRESET_MAX_STRING_LENGTH + 1) },
      { input: "Question", output: " " },
    ]) {
      await expect(service.addDialogue(snapshot, 9, patch)).rejects.toMatchObject({ status: 422 });
    }
    expect(core.updatePersonaAttributes).not.toHaveBeenCalled();
    expect(core.addPersonaSampleDialogue).not.toHaveBeenCalled();
    expect(core.updatePersonaSampleDialogue).not.toHaveBeenCalled();
  });

  it("accepts the preset attribute boundary and enforces the shared dialogue count boundary", async () => {
    const { core, service } = createService();
    const snapshot = createSnapshot();
    await service.replaceAttributes(snapshot, 9, {
      attributes: Array.from({ length: PRESET_MAX_ATTRIBUTES }, () => ({ text: "Fact", isPublic: false })),
    });
    expect(core.updatePersonaAttributes).toHaveBeenCalledTimes(1);
    const persona = snapshot.rawPersonas[0];
    if (!persona) throw new Error("Missing test persona");
    const inputs: string[] = [];
    while (presetExportDataSchema.shape.sample_dialogues_in.safeParse([...inputs, "Question"]).success) {
      if (inputs.length >= 1000) throw new Error("Missing bounded preset dialogue schema");
      inputs.push("Question");
    }
    persona.sample_dialogues_in = inputs.slice(1);
    persona.sample_dialogues_out = inputs.slice(1).map(() => "Answer");
    await service.addDialogue(snapshot, 9, { input: "Question", output: "Answer" });
    expect(core.addPersonaSampleDialogue).toHaveBeenCalledTimes(1);
    persona.sample_dialogues_in = inputs;
    persona.sample_dialogues_out = inputs.map(() => "Answer");
    await expect(service.addDialogue(snapshot, 9, { input: "Question", output: "Answer" })).rejects.toMatchObject({
      code: "dialogue_limit",
      status: 422,
    });
    expect(core.addPersonaSampleDialogue).toHaveBeenCalledTimes(1);
    await service.updateDialogue(snapshot, 9, inputs.length - 1, {
      input: "Updated question",
      output: "Updated answer",
    });
    expect(core.updatePersonaSampleDialogue).toHaveBeenCalledTimes(1);
  });

  it("stores attribute visibility through the repository adapter", async () => {
    const { core, service } = createService();
    const snapshot = createSnapshot();

    await service.replaceAttributes(snapshot, 9, {
      attributes: [
        { text: "Quietly curious", isPublic: false },
        { text: "Carries a silver camera", isPublic: true },
      ],
    });

    expect(core.updatePersonaAttributes).toHaveBeenCalledWith(
      snapshot,
      9,
      ["Quietly curious", "Carries a silver camera"],
      [false, true],
    );
  });

  it("rejects invalid sample dialogue before touching the repository", async () => {
    const { core, service } = createService();

    await expect(service.addDialogue(createSnapshot(), 9, { input: "Hello", output: "" })).rejects.toMatchObject({
      code: "invalid_dialogue",
      status: 422,
    });
    expect(core.addPersonaSampleDialogue).not.toHaveBeenCalled();
  });

  it("never deletes the main persona", async () => {
    const { core, service } = createService();

    await expect(service.remove(createSnapshot(false), 9)).rejects.toMatchObject({
      code: "main_persona_required",
      status: 422,
    });
    expect(core.removePersona).not.toHaveBeenCalled();
  });
});

describe("dashboard persona identity rules", () => {
  it("accepts names and trigger data supported by persona imports", async () => {
    const core = {
      hasPersonaNicknameConflict: mock(async () => false),
      updatePersonaIdentity: mock(async () => true),
      updatePersonaPrompt: mock(async () => true),
    };
    const service = new DashboardSettingsService(core as unknown as DashboardSettingsCore);
    const snapshot = createSnapshot();
    await service.updatePersona(snapshot, 9, "identity", { nickname: "A" });
    await service.updatePersona(snapshot, 9, "identity", { nickname: "a".repeat(100) });
    const triggerWords = Array.from({ length: 100 }, (_, index) => `${index}${"x".repeat(4998)}`);
    await service.updatePersona(snapshot, 9, "prompt", { triggerWords, personaPrompt: null });
    expect(core.updatePersonaPrompt).toHaveBeenLastCalledWith(snapshot, 9, { triggerWords, personaPrompt: null });
    await expect(service.updatePersona(snapshot, 9, "identity", { nickname: "a".repeat(101) })).rejects.toMatchObject({
      code: "invalid_persona",
    });
    await expect(
      service.updatePersona(snapshot, 9, "prompt", { triggerWords: ["x".repeat(5001)] }),
    ).rejects.toMatchObject({ code: "invalid_persona" });
  });
  it("blocks a nickname already used on the server", async () => {
    const core = {
      hasPersonaNicknameConflict: mock(async () => true),
      updatePersonaIdentity: mock(async () => true),
      updatePersonaPrompt: mock(async () => true),
    };
    const service = new DashboardSettingsService(core as unknown as DashboardSettingsCore);

    await expect(service.updatePersona(createSnapshot(), 9, "identity", { nickname: "Other" })).rejects.toMatchObject({
      code: "persona_name_conflict",
      status: 409,
    });
    expect(core.updatePersonaIdentity).not.toHaveBeenCalled();
  });

  it("adds a renamed persona's nickname as a trigger", async () => {
    const core = {
      hasPersonaNicknameConflict: mock(async () => false),
      updatePersonaIdentity: mock(async () => true),
      updatePersonaPrompt: mock(async () => true),
    };
    const service = new DashboardSettingsService(core as unknown as DashboardSettingsCore);
    const snapshot = createSnapshot();

    await service.updatePersona(snapshot, 9, "identity", { nickname: "Mizuki" });

    expect(core.updatePersonaIdentity).toHaveBeenCalledWith(snapshot, 9, { nickname: "Mizuki" });
    expect(core.updatePersonaPrompt).toHaveBeenCalledWith(snapshot, 9, {
      triggerWords: ["Tomori", "Mizuki"],
      personaPrompt: null,
    });
  });
});
