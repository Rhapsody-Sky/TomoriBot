import { describe, expect, it, mock } from "bun:test";
import type { Client } from "discord.js";
import type { TomoriDashboardCore } from "@/web/dashboard/core";
import { DashboardPersonaService } from "@/web/dashboard/personaService";
import { type DashboardSettingsCore, DashboardSettingsService } from "@/web/dashboard/settingsService";
import type { DashboardGuildSnapshot } from "@/web/dashboard/types";

function createSnapshot(isAlter = true): DashboardGuildSnapshot {
  return {
    serverId: 42,
    serverDiscordId: "123456789012345678",
    config: {},
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
      {
        persona_id: 9,
        persona_lineage_id: 77,
        persona_nickname: "Tomori",
        is_alter: isAlter,
        sample_dialogues_in: [],
        sample_dialogues_out: [],
      },
    ],
  } as DashboardGuildSnapshot;
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
