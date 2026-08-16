/**
 * Regression harness — Memory repositories domain.
 *
 * Covers: ServerMemoryRepository (addServerMemoryByTomori),
 * PersonalMemoryRepository (addPersonalMemoryByTomori, loadPersonalMemoriesForUserLineage),
 * ConditioningMemoryRepository.
 *
 * Requires: a local Postgres connection (see docs/guides/testing-db-changes.md)
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  personalMemoryRepository,
  personaRepository,
  serverMemoryRepository,
  userRepository,
} from "@/utils/db/repositories";
import { FIXTURE_IDS, cleanupFixtures, insertFixtures, type FixtureRefs } from "./setup/fixtures";
import { DB_TESTS_AVAILABLE, setupTestDb, testSql } from "./setup/testDb";

describe.skipIf(!DB_TESTS_AVAILABLE)("Memory — regression", () => {
  let refs: FixtureRefs;
  let altUserId: number;

  beforeAll(async () => {
    await setupTestDb();
    refs = await insertFixtures(testSql);
    // Register an extra user for personal memory tests
    const altUser = await userRepository.register(FIXTURE_IDS.altUserDiscId, "_rt_alt_user", "en");
    if (!altUser) throw new Error("Failed to register alt test user");
    altUserId = altUser.user_id;
  });

  afterAll(async () => {
    await cleanupFixtures(testSql);
  });

  // ── server memories ───────────────────────────────────────────────────────

  it("addServerMemoryByTomori inserts a server memory", async () => {
    const memory = await serverMemoryRepository.add(
      refs.serverId,
      refs.personaId,
      refs.personaLineageId,
      refs.userId,
      "regression test server memory content",
    );
    expect(memory).not.toBeNull();
    expect(memory?.content).toBe("regression test server memory content");
    expect(memory?.server_id).toBe(refs.serverId);
  });

  it("loadTomoriState reflects the new server memory", async () => {
    // loadTomoriState embeds server_memories[] in the returned TomoriState
    const state = await personaRepository.loadState(FIXTURE_IDS.serverDiscId);
    const hasMemory = state?.server_memories.some((m) => m.includes("regression test server memory content"));
    expect(hasMemory).toBe(true);
  });

  it("addServerMemoryByTomori rejects empty content", async () => {
    const memory = await serverMemoryRepository.add(
      refs.serverId,
      refs.personaId,
      refs.personaLineageId,
      refs.userId,
      "",
    );
    expect(memory).toBeNull();
  });

  it("scoped server memory writes enforce server, lineage, and teacher ownership", async () => {
    const memory = await serverMemoryRepository.add(
      refs.serverId,
      refs.personaId,
      refs.personaLineageId,
      altUserId,
      "scoped server memory",
    );
    const memoryId = memory?.server_memory_id;
    expect(memoryId).toBeNumber();
    if (!memoryId) throw new Error("Failed to create scoped server memory fixture");

    const wrongTeacher = await serverMemoryRepository.updateScoped(
      memoryId,
      refs.serverId,
      refs.personaLineageId,
      "must not be written",
      [],
      refs.userId,
    );
    expect(wrongTeacher).toBeNull();

    const adminUpdate = await serverMemoryRepository.updateScoped(
      memoryId,
      refs.serverId,
      refs.personaLineageId,
      "admin-scoped update",
      ["verified"],
    );
    expect(adminUpdate?.content).toBe("admin-scoped update");

    expect(await serverMemoryRepository.removeScoped(memoryId, refs.serverId, refs.personaLineageId + 1)).toBe(false);
    expect(await serverMemoryRepository.removeScoped(memoryId, refs.serverId, refs.personaLineageId, altUserId)).toBe(
      true,
    );
  });

  // ── personal memories ────────────────────────────────────────────────────

  it("addPersonalMemoryByTomori inserts a personal memory", async () => {
    const memory = await personalMemoryRepository.add(
      altUserId,
      refs.personaLineageId,
      "regression test personal memory content",
    );
    expect(memory).not.toBeNull();
    expect(memory?.content).toBe("regression test personal memory content");
    expect(memory?.user_id).toBe(altUserId);
  });

  it("loadPersonalMemoriesForUserLineage returns the inserted personal memory", async () => {
    const memories = await personalMemoryRepository.loadForUserLineage(altUserId, refs.personaLineageId);
    const found = memories.some((m) => m.content === "regression test personal memory content");
    expect(found).toBe(true);
  });

  it("loadPersonalMemoriesForUserLineage returns empty array for unknown user", async () => {
    const memories = await personalMemoryRepository.loadForUserLineage(999_999_999, refs.personaLineageId);
    expect(memories).toHaveLength(0);
  });

  it("owned personal memory writes enforce both user and persona lineage", async () => {
    const memory = await personalMemoryRepository.add(altUserId, refs.personaLineageId, "owned personal memory");
    const memoryId = memory?.personal_memory_id;
    expect(memoryId).toBeNumber();
    if (!memoryId) throw new Error("Failed to create owned personal memory fixture");

    expect(
      await personalMemoryRepository.updateOwned(memoryId, refs.userId, refs.personaLineageId, "must not be written"),
    ).toBeNull();

    const updated = await personalMemoryRepository.updateOwned(
      memoryId,
      altUserId,
      refs.personaLineageId,
      "owner-scoped update",
      ["verified"],
    );
    expect(updated?.content).toBe("owner-scoped update");
    expect(updated?.tags).toEqual(["verified"]);

    expect(await personalMemoryRepository.removeOwned(memoryId, altUserId, refs.personaLineageId + 1)).toBe(false);
    expect(await personalMemoryRepository.removeOwned(memoryId, altUserId, refs.personaLineageId)).toBe(true);
  });
});
