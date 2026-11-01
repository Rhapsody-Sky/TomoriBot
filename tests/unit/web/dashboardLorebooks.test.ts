import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import { lorebookOperations } from "@/modules/lorebooks/discord/operations";
import { lorebookEntryRowSchema } from "@/modules/lorebooks/db/types";
import { DashboardLorebookService } from "@/web/dashboard/lorebookService";
import type { DashboardActor, DashboardGuildSnapshot } from "@/web/dashboard/types";
import { createServerConfig } from "../../helpers/fixtures";

const snapshot = {
  serverId: 42,
  serverDiscordId: "123456789012345678",
  config: createServerConfig(),
  personas: [
    {
      personaId: 9,
      lineageId: 77,
      nickname: "Tomori",
      isAlter: false,
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
    },
  ],
  rawPersonas: [],
} satisfies DashboardGuildSnapshot;
const admin = { canManage: true } as DashboardActor;
const member = { canManage: false } as DashboardActor;
const book = { lorebook_id: 2, name: "World", enabled: true, channel_disc_ids: [] };
const entry = lorebookEntryRowSchema.parse({
  entry_id: 5,
  server_id: 42,
  persona_lineage_id: null,
  lorebook_name: "World",
  title: "Place",
  content: "Details",
  keys: ["place"],
  secondary_keys: [],
  selective_logic: 0,
  scan_depth: 5,
  trigger_chance: 100,
  insertion_order: 100,
  placement: 0,
  constant: false,
  enabled: true,
  channel_disc_ids: [],
  legacy_channel_tags: ["old"],
});

describe("dashboard lorebooks", () => {
  afterEach(() => mock.restore());

  it("counts every serverwide book while returning only the selected book's entries", async () => {
    const other = { ...book, lorebook_id: 3, name: "Other" };
    spyOn(lorebookRepository, "listBooks").mockResolvedValue([book, other]);
    spyOn(lorebookRepository, "listScope").mockResolvedValue({
      status: "fresh",
      entries: [
        entry,
        { ...entry, entry_id: 6, lorebook_name: "Other" },
        { ...entry, entry_id: 7, lorebook_name: "Other" },
      ],
    });
    const result = await new DashboardLorebookService().list(snapshot, 0, 2);
    expect(result.books).toEqual([
      { ...book, entryCount: 1 },
      { ...other, entryCount: 2 },
    ]);
    expect(result.entries.map((row) => row.entry_id)).toEqual([5]);
  });

  it("edits only title and content while preserving flags, activation and legacy scope", async () => {
    const source = {
      ...entry,
      constant: true,
      enabled: false,
      secondary_keys: ["second"],
      trigger_chance: 0,
      channel_disc_ids: ["123456789012345678"],
      legacy_channel_tags: ["old"],
    };
    spyOn(lorebookRepository, "listBooks").mockResolvedValue([book]);
    spyOn(lorebookRepository, "listScope").mockResolvedValue({ status: "fresh", entries: [source] });
    const update = spyOn(lorebookRepository, "update").mockResolvedValue("updated");
    const service = new DashboardLorebookService();
    const value = { lineageId: 0, bookId: 2, title: "New", content: "Updated" };
    await expect(service.entry(member, snapshot, 5, "content", value, new Set())).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.entry(admin, snapshot, 5, "content", { ...value, bookId: 3 }, new Set()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.entry(admin, snapshot, 6, "content", value, new Set())).rejects.toMatchObject({ status: 404 });
    await expect(
      service.entry(admin, snapshot, 5, "content", { ...value, content: "   " }, new Set()),
    ).rejects.toMatchObject({ status: 422 });
    expect(await service.entry(admin, snapshot, 5, "content", value, new Set())).toEqual({ status: "success" });
    expect(update).toHaveBeenCalledWith(
      42,
      null,
      5,
      expect.objectContaining({
        title: "New",
        content: "Updated",
        keys: source.keys,
        constant: true,
        enabled: false,
        secondary_keys: ["second"],
        trigger_chance: 0,
        placement: 0,
        channel_disc_ids: source.channel_disc_ids,
        legacy_channel_tags: ["old"],
      }),
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("edits keywords using fresh stored content and channel scope", async () => {
    const source = { ...entry, channel_disc_ids: ["123456789012345678"], legacy_channel_tags: ["old"] };
    spyOn(lorebookRepository, "listBooks").mockResolvedValue([book]);
    spyOn(lorebookRepository, "listScope").mockResolvedValue({ status: "fresh", entries: [source] });
    const edit = spyOn(lorebookOperations, "editEntry").mockResolvedValue({ status: "success", title: source.title });
    const service = new DashboardLorebookService();
    const value = { lineageId: 0, bookId: 2, keys: [] };
    await expect(service.entry(member, snapshot, 5, "keys", value, new Set())).rejects.toMatchObject({ status: 403 });
    await expect(service.entry(admin, snapshot, 5, "keys", { ...value, bookId: 3 }, new Set())).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.entry(admin, snapshot, 6, "keys", value, new Set())).rejects.toMatchObject({ status: 404 });
    await expect(
      service.entry(admin, snapshot, 5, "keys", { ...value, title: "stale" }, new Set()),
    ).rejects.toMatchObject({ status: 422 });
    expect(await service.entry(admin, snapshot, 5, "keys", value, new Set())).toMatchObject({ status: "success" });
    expect(edit).toHaveBeenCalledWith({
      serverId: 42,
      lineageId: null,
      canManage: true,
      entryId: 5,
      title: source.title,
      content: source.content,
      keys: [],
      channelDiscIds: source.channel_disc_ids,
    });
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("changes only persona entry channels and retains pending legacy scope when unchanged", async () => {
    const original = "123456789012345678";
    const replacement = "223456789012345678";
    const source = {
      ...entry,
      persona_lineage_id: 77,
      lorebook_name: undefined,
      constant: true,
      channel_disc_ids: [original],
      legacy_channel_tags: ["old"],
    };
    spyOn(lorebookRepository, "listBooks").mockResolvedValue([book]);
    spyOn(lorebookRepository, "listScope").mockImplementation(async (_serverId, lineage) => ({
      status: "fresh",
      entries: [lineage === null ? entry : source],
    }));
    const update = spyOn(lorebookRepository, "update").mockResolvedValue("updated");
    const service = new DashboardLorebookService();
    const value = { lineageId: 77, channelDiscIds: [original] };
    await expect(service.entry(member, snapshot, 5, "channels", value, new Set())).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      service.entry(admin, snapshot, 5, "channels", { lineageId: 0, bookId: 2, channelDiscIds: [] }, new Set()),
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      service.entry(admin, snapshot, 5, "channels", { ...value, channelDiscIds: [replacement] }, new Set()),
    ).rejects.toMatchObject({ code: "invalid_lorebook_channel" });
    expect(await service.entry(admin, snapshot, 5, "channels", value, new Set())).toEqual({ status: "success" });
    expect(update).toHaveBeenLastCalledWith(
      42,
      77,
      5,
      expect.objectContaining({
        constant: true,
        keys: source.keys,
        content: source.content,
        channel_disc_ids: [original],
        legacy_channel_tags: ["old"],
      }),
    );
    expect(
      await service.entry(
        admin,
        snapshot,
        5,
        "channels",
        { ...value, channelDiscIds: [replacement] },
        new Set([replacement]),
      ),
    ).toEqual({ status: "success" });
    expect(update).toHaveBeenLastCalledWith(
      42,
      77,
      5,
      expect.objectContaining({ constant: true, channel_disc_ids: [replacement], legacy_channel_tags: [] }),
    );
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("checks server book ownership and preserves existing fields through shared operations", async () => {
    spyOn(lorebookRepository, "listBooks").mockResolvedValue([book]);
    spyOn(lorebookRepository, "listScope").mockResolvedValue({ status: "fresh", entries: [entry] });
    const edit = spyOn(lorebookOperations, "editEntry").mockResolvedValue({ status: "success", title: "Place" });
    const service = new DashboardLorebookService();
    const value = { lineageId: 0, bookId: 2, title: "Place", content: "Changed", keys: ["place"], channelDiscIds: [] };
    await expect(service.entry(member, snapshot, 5, "edit", value, new Set())).rejects.toMatchObject({ status: 403 });
    await expect(service.entry(admin, snapshot, 5, "edit", { ...value, bookId: 9 }, new Set())).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.entry(admin, snapshot, 6, "edit", value, new Set())).rejects.toMatchObject({ status: 404 });
    expect((await service.entry(admin, snapshot, 5, "edit", value, new Set())).status).toBe("success");
    expect(edit).toHaveBeenCalledWith({
      serverId: 42,
      lineageId: null,
      canManage: true,
      entryId: 5,
      title: "Place",
      content: "Changed",
      keys: ["place"],
      channelDiscIds: [],
    });
  });

  it("rejects foreign lineages and changed foreign channels and retains valid zero activation values", async () => {
    spyOn(lorebookRepository, "listBooks").mockResolvedValue([book]);
    spyOn(lorebookRepository, "listScope").mockResolvedValue({ status: "fresh", entries: [entry] });
    const activation = spyOn(lorebookOperations, "editActivation").mockResolvedValue({
      status: "success",
      title: "Place",
    });
    const service = new DashboardLorebookService();
    await expect(service.list(snapshot, 99)).rejects.toMatchObject({ status: 403 });
    await expect(
      service.book(admin, snapshot, 2, "edit", { channelDiscIds: ["123456789012345678"] }, new Set()),
    ).rejects.toMatchObject({ code: "invalid_lorebook_channel" });
    await service.entry(
      admin,
      snapshot,
      5,
      "activation",
      {
        lineageId: 0,
        bookId: 2,
        secondaryKeys: [],
        selectiveLogic: 0,
        scanDepth: 1,
        triggerChance: 0,
        insertionOrder: -1,
      },
      new Set(),
    );
    expect(activation).toHaveBeenCalledWith(
      expect.objectContaining({ triggerChance: 0, selectiveLogic: 0, insertionOrder: -1 }),
    );
  });

  it("reports unavailable reads rather than presenting an empty book", async () => {
    spyOn(lorebookRepository, "listBooks").mockResolvedValue([book]);
    spyOn(lorebookRepository, "listScope").mockResolvedValue({ status: "unavailable", entries: [] });
    await expect(new DashboardLorebookService().list(snapshot, 0, 2)).rejects.toMatchObject({ status: 503 });
  });

  it("replaces only the selected collection and rejects malformed imports before writing", async () => {
    spyOn(lorebookRepository, "listBooks").mockResolvedValue([book]);
    spyOn(lorebookRepository, "listScope").mockResolvedValue({ status: "fresh", entries: [entry] });
    const replace = spyOn(lorebookRepository, "replaceScopeEntries").mockResolvedValue("replaced");
    const service = new DashboardLorebookService();
    await expect(
      service.transfer(
        admin,
        snapshot,
        { lineageId: 0, bookId: 2, mode: "replace", data: { unknown: true } },
        new Set(),
      ),
    ).rejects.toMatchObject({ code: "invalid_lorebook" });
    expect(replace).not.toHaveBeenCalled();
    const data = { entries: { "0": { key: ["place"], comment: "Place", content: "Description", constant: false } } };
    expect(
      await service.transfer(admin, snapshot, { lineageId: 0, bookId: 2, mode: "replace", data }, new Set()),
    ).toMatchObject({ status: "replaced", report: expect.anything() });
    expect(replace).toHaveBeenCalledWith(
      42,
      null,
      expect.arrayContaining([expect.objectContaining({ lorebook_name: "World" })]),
      undefined,
      "World",
      2,
    );
  });
});
