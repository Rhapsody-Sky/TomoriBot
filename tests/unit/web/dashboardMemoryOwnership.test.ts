import { describe, expect, it, mock } from "bun:test";
import { PrivacyLevel } from "@/types/db/schema";
import { type DashboardMemoryCore, DashboardMemoryService } from "@/web/dashboard/memoryService";
import type { DashboardActor, DashboardGuildSnapshot, MemoryMutationInput } from "@/web/dashboard/types";

function createSnapshot(overrides: Record<string, unknown> = {}): DashboardGuildSnapshot {
  return {
    serverId: 42,
    serverDiscordId: "123456789012345678",
    config: {
      server_memteaching_enabled: true,
      personal_memories_enabled: true,
      ...overrides,
    },
    personas: [
      {
        personaId: 9,
        lineageId: 77,
        nickname: "Tomori",
        isAlter: false,
        avatarUrl: null,
        triggerWords: [],
        personaPrompt: null,
        contextNote: null,
        contextNoteDepth: 0,
        physicalAppearanceTags: [],
        humanizerOverride: null,
      },
    ],
    rawPersonas: [],
  } as DashboardGuildSnapshot;
}

function createActor(canManage = false, privacyLevel = PrivacyLevel.MINIMAL): DashboardActor {
  return {
    discordId: "987654321098765432",
    canManage,
    user: {
      user_id: 7,
      user_disc_id: "987654321098765432",
      user_nickname: "Dashboard user",
      privacy_level: privacyLevel,
    },
  } as DashboardActor;
}

function createCore() {
  return {
    listPersonalMemories: mock(async () => []),
    addPersonalMemory: mock(async () => ({
      personal_memory_id: 1,
      user_id: 7,
      persona_lineage_id: 0,
      content: "Personal fact",
      tags: [],
    })),
    updatePersonalMemory: mock(async () => null),
    removePersonalMemory: mock(async () => false),
    listServerMemories: mock(async () => []),
    listServerMemoryContents: mock(async () => []),
    addServerMemory: mock(async () => ({
      server_memory_id: 2,
      server_id: 42,
      persona_id: 9,
      persona_lineage_id: 77,
      user_id: 7,
      content: "Server fact",
      tags: [],
    })),
    updateServerMemory: mock(async () => null),
    removeServerMemory: mock(async () => false),
    isUserBlacklisted: mock(async () => false),
  };
}

const personalInput: MemoryMutationInput = {
  lineageId: 0,
  content: "Personal fact",
  tags: [],
};

const serverInput: MemoryMutationInput = {
  lineageId: 77,
  content: "Server fact",
  tags: [],
};

describe("dashboard memory ownership", () => {
  it("loads only the member's own taught server memories", async () => {
    const core = createCore();
    const service = new DashboardMemoryService(core as unknown as DashboardMemoryCore);

    await service.listServer(createActor(false), createSnapshot(), 77);
    expect(core.listServerMemories).toHaveBeenCalledWith(42, 77, 7);

    await service.listServer(createActor(true), createSnapshot(), 77);
    expect(core.listServerMemories).toHaveBeenLastCalledWith(42, 77, undefined);
  });

  it("never treats a server administrator as the owner of personal memories", async () => {
    const core = createCore();
    const service = new DashboardMemoryService(core as unknown as DashboardMemoryCore);

    await service.listPersonal(createActor(true), createSnapshot(), 0);
    expect(core.listPersonalMemories).toHaveBeenCalledWith(7, 0);
  });

  it("blocks personal memory creation for a full privacy opt-out", async () => {
    const core = createCore();
    const service = new DashboardMemoryService(core as unknown as DashboardMemoryCore);

    await expect(
      service.addPersonal(createActor(false, PrivacyLevel.FULL), createSnapshot(), personalInput),
    ).rejects.toMatchObject({ code: "privacy_opt_out", status: 403 });
    expect(core.addPersonalMemory).not.toHaveBeenCalled();
  });

  it("blocks member teaching when disabled but keeps the admin override", async () => {
    const core = createCore();
    const service = new DashboardMemoryService(core as unknown as DashboardMemoryCore);
    const snapshot = createSnapshot({ server_memteaching_enabled: false });

    await expect(service.addServer(createActor(false), snapshot, serverInput)).rejects.toMatchObject({
      code: "server_teaching_disabled",
      status: 403,
    });
    expect(core.addServerMemory).not.toHaveBeenCalled();

    await service.addServer(createActor(true), snapshot, serverInput);
    expect(core.addServerMemory).toHaveBeenCalledTimes(1);
  });

  it("rejects persona lineages that do not belong to the selected server", async () => {
    const core = createCore();
    const service = new DashboardMemoryService(core as unknown as DashboardMemoryCore);

    await expect(service.listPersonal(createActor(), createSnapshot(), 999)).rejects.toMatchObject({
      code: "lineage_forbidden",
      status: 403,
    });
    expect(core.listPersonalMemories).not.toHaveBeenCalled();
  });
});
