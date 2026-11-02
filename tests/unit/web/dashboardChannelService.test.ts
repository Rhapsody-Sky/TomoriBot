import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import {
  channelContextNoteRepo,
  channelPromptRepo,
  configRepository,
  llmOverrideRepo,
  whitelistRepository,
} from "@/utils/db/repositories";
import { DashboardChannelService } from "@/web/dashboard/channelService";
import { TomoriDashboardCore } from "@/web/dashboard/core";
import type { DashboardGuildSnapshot } from "@/web/dashboard/types";
import { createServerConfig } from "../../helpers/fixtures";

const personaDefaults = {
  lineageId: 1,
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
const snapshot: DashboardGuildSnapshot = {
  serverId: 42,
  serverDiscordId: "123456789012345678",
  config: createServerConfig({
    autoch_disc_ids: ["a", "b"],
    autoch_persona_overrides: [{ channel_disc_id: "b", persona_id: 10 }],
  }),
  personas: [
    { ...personaDefaults, personaId: 9, nickname: "Main", isAlter: false },
    { ...personaDefaults, personaId: 10, nickname: "Alter", isAlter: true },
  ],
  rawPersonas: [],
};
const available = new Set(["a", "b", "c"]);

describe("dashboard channel settings", () => {
  afterEach(() => mock.restore());

  function setup() {
    const core = new TomoriDashboardCore();
    spyOn(core, "loadPersonaTextModelWorkspace").mockResolvedValue({
      options: [{ id: 2, provider: "openrouter", label: "Model" }],
      selected: null,
    } as Awaited<ReturnType<typeof core.loadPersonaTextModelWorkspace>>);
    const read = spyOn(whitelistRepository, "getAllWhitelistChannels").mockResolvedValue([]);
    const prompt = spyOn(channelPromptRepo, "setChannelPromptOverride").mockResolvedValue(true);
    const note = spyOn(channelContextNoteRepo, "setChannelContextNote").mockResolvedValue(true);
    const model = spyOn(llmOverrideRepo, "setChannelLlmOverride").mockResolvedValue(true);
    const channels = spyOn(whitelistRepository, "upsertChannelWhitelists").mockResolvedValue();
    const personaRead = spyOn(whitelistRepository, "getPersonaWhitelistChannels").mockResolvedValue([]);
    const personaWrite = spyOn(whitelistRepository, "replacePersonaWhitelistChannels").mockResolvedValue();
    const autochat = spyOn(configRepository, "updateAutoTriggerConfig").mockResolvedValue(true);
    return {
      service: new DashboardChannelService(core),
      read,
      prompt,
      note,
      model,
      channels,
      personaRead,
      personaWrite,
      autochat,
    };
  }

  it("loads the complete allowlist without requiring a channel selection", async () => {
    const s = setup();
    spyOn(llmOverrideRepo, "getAllChannelLlmOverridesForServer").mockResolvedValue([]);
    spyOn(whitelistRepository, "getAllWhitelistPersonas").mockResolvedValue([]);
    for (const ids of [[], ["a", "b"]]) {
      s.read.mockResolvedValue(
        ids.map((channel_disc_id) => ({ channel_disc_id })) as Awaited<
          ReturnType<typeof whitelistRepository.getAllWhitelistChannels>
        >,
      );
      const result = await s.service.load(snapshot, []);
      expect(result.allowlistedChannelIds).toEqual(ids);
      expect(result.channelWhitelistActive).toBe(ids.length > 0);
      expect(result.channels).toEqual({});
    }
  });

  it("rejects foreign channel, persona and model before any write", async () => {
    const s = setup();
    for (const input of [
      { channelIds: [], patch: { prompt: { text: "x", mode: "append" } } },
      { channelIds: ["foreign"], patch: { prompt: { text: "x", mode: "append" } } },
      { channelIds: ["a"], patch: { personaId: 99, personaAllowed: true } },
      { channelIds: ["a"], patch: { textModel: 99 } },
      { channelIds: ["a"], patch: { autochatPersona: 99 } },
    ])
      await expect(s.service.patch(snapshot, input, available)).rejects.toMatchObject({ status: 422 });
    expect(s.prompt).not.toHaveBeenCalled();
    expect(s.model).not.toHaveBeenCalled();
    expect(s.personaWrite).not.toHaveBeenCalled();
    expect(s.autochat).not.toHaveBeenCalled();
  });

  it("validates every persona assignment before writing and normalizes unrestricted selection", async () => {
    const s = setup();
    for (const entry of [
      { personaId: 9, channelIds: [] },
      { personaId: 99, channelIds: ["a"] },
      { personaId: 9, channelIds: ["foreign"] },
    ]) {
      await expect(
        s.service.patch(
          snapshot,
          { channelIds: [], patch: { personaChannels: [{ personaId: 10, channelIds: ["b"] }, entry] } },
          available,
        ),
      ).rejects.toMatchObject({ status: 422 });
    }
    expect(s.personaWrite).not.toHaveBeenCalled();
    await s.service.patch(
      snapshot,
      {
        channelIds: [],
        patch: {
          personaChannels: [
            { personaId: 9, channelIds: ["a", "b", "c"] },
            { personaId: 10, channelIds: ["b"] },
          ],
        },
      },
      available,
    );
    expect(s.personaWrite).toHaveBeenCalledWith(42, 9, []);
    expect(s.personaWrite).toHaveBeenCalledWith(42, 10, ["b"]);
  });

  it("does not remove the last allowed channel through the incremental editor", async () => {
    const s = setup();
    s.personaRead.mockResolvedValue([{ channel_disc_id: "a" }] as Awaited<
      ReturnType<typeof whitelistRepository.getPersonaWhitelistChannels>
    >);
    await expect(
      s.service.patch(snapshot, { channelIds: ["a"], patch: { personaId: 9, personaAllowed: false } }, available),
    ).rejects.toMatchObject({ status: 422, code: "persona_channel_required" });
    expect(s.personaWrite).not.toHaveBeenCalled();
  });

  it("rejects removing the last server channel before any writes", async () => {
    const s = setup();
    s.read.mockResolvedValue([{ channel_disc_id: "a" }] as Awaited<
      ReturnType<typeof whitelistRepository.getAllWhitelistChannels>
    >);
    const remove = spyOn(whitelistRepository, "removeChannelWhitelist").mockResolvedValue(true);
    await expect(
      s.service.patch(
        snapshot,
        { channelIds: ["a"], patch: { allowlisted: false, prompt: { text: "x", mode: "append" } } },
        available,
      ),
    ).rejects.toMatchObject({ code: "channel_required" });
    expect(remove).not.toHaveBeenCalled();
    expect(s.prompt).not.toHaveBeenCalled();
  });

  it("leaves omitted fields unchanged", async () => {
    const s = setup();
    await s.service.patch(snapshot, { channelIds: ["a"], patch: { prompt: { text: "x", mode: "append" } } }, available);
    expect(s.prompt).toHaveBeenCalledTimes(1);
    expect(s.note).not.toHaveBeenCalled();
    expect(s.model).not.toHaveBeenCalled();
    expect(s.channels).not.toHaveBeenCalled();
    expect(s.autochat).not.toHaveBeenCalled();
  });

  it("preserves a cooldown when allowlisting and resets it explicitly", async () => {
    const s = setup();
    s.read.mockResolvedValue([{ channel_disc_id: "a", cooldown_type: 2, cooldown_length: 12 }] as Awaited<
      ReturnType<typeof whitelistRepository.getAllWhitelistChannels>
    >);
    await s.service.patch(snapshot, { channelIds: ["a"], patch: { allowlisted: true } }, available);
    await s.service.patch(snapshot, { channelIds: ["a"], patch: { cooldown: null } }, available);
    expect(s.channels.mock.calls[0]?.[1]).toEqual([{ channelId: "a", cooldownType: 2, cooldownLength: 12 }]);
    expect(s.channels.mock.calls[1]?.[1]).toEqual([{ channelId: "a", cooldownType: null, cooldownLength: null }]);
    await expect(
      s.service.patch(snapshot, { channelIds: ["b"], patch: { cooldown: { type: 1, seconds: 5 } } }, available),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("retains other persona restrictions when removing a channel", async () => {
    const s = setup();
    s.personaRead.mockResolvedValue([{ channel_disc_id: "a" }, { channel_disc_id: "b" }] as Awaited<
      ReturnType<typeof whitelistRepository.getPersonaWhitelistChannels>
    >);
    await s.service.patch(snapshot, { channelIds: ["a"], patch: { personaId: 10, personaAllowed: false } }, available);
    expect(s.personaWrite).toHaveBeenCalledWith(42, 10, ["b"]);
  });

  it("clears autochat overrides without changing enabled channels or other overrides", async () => {
    const s = setup();
    for (const value of [null, 9]) {
      await s.service.patch(snapshot, { channelIds: ["a"], patch: { autochatPersona: value } }, available);
      expect(s.autochat).toHaveBeenLastCalledWith(42, {
        autoch_disc_ids: ["a", "b"],
        autoch_persona_overrides: [{ channel_disc_id: "b", persona_id: 10 }],
      });
    }
    await expect(
      s.service.patch(snapshot, { channelIds: ["c"], patch: { autochatPersona: 10 } }, available),
    ).rejects.toMatchObject({ status: 422 });
  });

  it("reports partial failure after an earlier write", async () => {
    const s = setup();
    s.note.mockResolvedValue(false);
    await expect(
      s.service.patch(
        snapshot,
        { channelIds: ["a"], patch: { prompt: { text: "x", mode: "append" }, contextNote: { text: "y", depth: 0 } } },
        available,
      ),
    ).rejects.toMatchObject({ code: "channel_save_failed", message: expect.stringContaining("Refresh") });
    expect(s.prompt).toHaveBeenCalledTimes(1);
  });
});
