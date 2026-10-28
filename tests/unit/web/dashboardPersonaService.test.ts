import { describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import type { TomoriDashboardCore } from "@/web/dashboard/core";
import { DashboardPersonaService } from "@/web/dashboard/personaService";
import { type DashboardSettingsCore, DashboardSettingsService } from "@/web/dashboard/settingsService";
import type { DashboardGuildSnapshot } from "@/web/dashboard/types";
import { createLlmRow, createPersona, createServerConfig, createUserRow } from "../../helpers/fixtures";

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
