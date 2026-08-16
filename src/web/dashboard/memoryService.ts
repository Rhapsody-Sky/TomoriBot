import { PrivacyLevel } from "@/types/db/schema";
import { getMemoryLimits, validateMemoryContent } from "@/utils/misc/memoryLimits";
import { z } from "zod";
import type { TomoriDashboardCore } from "./core";
import { DashboardServiceError } from "./errors";
import type { DashboardActor, DashboardGuildSnapshot, MemoryMutationInput } from "./types";
import { serializePersonalMemory, serializeServerMemory } from "./types";

const memoryMutationSchema = z
  .object({
    lineageId: z.number().int().nonnegative(),
    content: z.string().trim().min(1),
    tags: z.array(z.string().trim().min(1).max(32)).max(5).default([]),
  })
  .strict();

function normalizeContent(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

function hasDuplicate(contents: string[], content: string): boolean {
  const normalized = content.trim().toLocaleLowerCase();
  return contents.some((entry) => entry.trim().toLocaleLowerCase() === normalized);
}

export type DashboardMemoryCore = Pick<
  TomoriDashboardCore,
  | "listPersonalMemories"
  | "addPersonalMemory"
  | "updatePersonalMemory"
  | "removePersonalMemory"
  | "listServerMemories"
  | "listServerMemoryContents"
  | "addServerMemory"
  | "updateServerMemory"
  | "removeServerMemory"
  | "isUserBlacklisted"
>;

export class DashboardMemoryService {
  constructor(private readonly core: DashboardMemoryCore) {}

  parseMutation(value: unknown): MemoryMutationInput {
    const parsed = memoryMutationSchema.safeParse(value);
    if (!parsed.success) {
      throw new DashboardServiceError("invalid_memory", 422, "The memory or its tags are invalid.");
    }

    const content = normalizeContent(parsed.data.content);
    const validation = validateMemoryContent(content);
    if (!validation.isValid) {
      throw new DashboardServiceError("invalid_memory", 422, validation.error || "The memory is invalid.");
    }

    return { ...parsed.data, content };
  }

  assertLineage(snapshot: DashboardGuildSnapshot, lineageId: number, allowGlobal: boolean): void {
    if (allowGlobal && lineageId === 0) return;
    if (!snapshot.personas.some((persona) => persona.lineageId === lineageId && lineageId !== 0)) {
      throw new DashboardServiceError("lineage_forbidden", 403, "That persona is not available in this server.");
    }
  }

  async listPersonal(actor: DashboardActor, snapshot: DashboardGuildSnapshot, lineageId: number) {
    this.assertLineage(snapshot, lineageId, true);
    const rows = await this.core.listPersonalMemories(actor.user.user_id, lineageId);
    return {
      scope: lineageId === 0 ? "global" : "persona",
      lineageId,
      limits: getMemoryLimits(),
      memories: rows.map(serializePersonalMemory),
    };
  }

  async addPersonal(actor: DashboardActor, snapshot: DashboardGuildSnapshot, input: MemoryMutationInput) {
    this.assertLineage(snapshot, input.lineageId, true);
    if (actor.user.privacy_level === PrivacyLevel.FULL) {
      throw new DashboardServiceError(
        "privacy_opt_out",
        403,
        "Personal memory creation is disabled by your privacy setting.",
      );
    }

    const existing = await this.core.listPersonalMemories(actor.user.user_id, input.lineageId);
    if (
      hasDuplicate(
        existing.map((row) => row.content),
        input.content,
      )
    ) {
      throw new DashboardServiceError("duplicate_memory", 409, "That personal memory already exists in this scope.");
    }

    const created = await this.core.addPersonalMemory(
      actor.user.user_id,
      input.lineageId,
      input.content,
      input.tags,
      actor.discordId,
    );
    if (!created) {
      throw new DashboardServiceError("memory_limit_or_write_failed", 409, "The memory could not be saved.");
    }
    return serializePersonalMemory(created);
  }

  async updatePersonal(
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    memoryId: number,
    input: MemoryMutationInput,
  ) {
    this.assertLineage(snapshot, input.lineageId, true);
    const existing = await this.core.listPersonalMemories(actor.user.user_id, input.lineageId);
    const target = existing.find((row) => row.personal_memory_id === memoryId);
    if (!target) throw new DashboardServiceError("memory_not_found", 404, "Personal memory not found.");

    if (
      existing.some(
        (row) =>
          row.personal_memory_id !== memoryId &&
          row.content.trim().toLocaleLowerCase() === input.content.trim().toLocaleLowerCase(),
      )
    ) {
      throw new DashboardServiceError("duplicate_memory", 409, "That personal memory already exists in this scope.");
    }

    const updated = await this.core.updatePersonalMemory(
      memoryId,
      actor.user.user_id,
      input.lineageId,
      input.content,
      input.tags,
      actor.discordId,
    );
    if (!updated) throw new DashboardServiceError("memory_not_found", 404, "Personal memory not found.");
    return serializePersonalMemory(updated);
  }

  async removePersonal(
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    memoryId: number,
    lineageId: number,
  ): Promise<void> {
    this.assertLineage(snapshot, lineageId, true);
    const removed = await this.core.removePersonalMemory(memoryId, actor.user.user_id, lineageId, actor.discordId);
    if (!removed) throw new DashboardServiceError("memory_not_found", 404, "Personal memory not found.");
  }

  async listServer(actor: DashboardActor, snapshot: DashboardGuildSnapshot, lineageId: number) {
    this.assertLineage(snapshot, lineageId, false);
    const rows = await this.core.listServerMemories(
      snapshot.serverId,
      lineageId,
      actor.canManage ? undefined : actor.user.user_id,
    );
    return {
      lineageId,
      mode: actor.canManage ? "all" : "owned",
      teachingEnabled: snapshot.config.server_memteaching_enabled !== false,
      limits: getMemoryLimits(),
      memories: rows.map((row) => serializeServerMemory(row, actor.user.user_id, actor.canManage)),
    };
  }

  async addServer(actor: DashboardActor, snapshot: DashboardGuildSnapshot, input: MemoryMutationInput) {
    this.assertLineage(snapshot, input.lineageId, false);
    await this.assertCanTeachServerMemory(actor, snapshot);

    const existingContents = await this.core.listServerMemoryContents(snapshot.serverId, input.lineageId);
    if (hasDuplicate(existingContents, input.content)) {
      throw new DashboardServiceError("duplicate_memory", 409, "That server memory already exists for this persona.");
    }

    const persona = snapshot.personas.find((entry) => entry.lineageId === input.lineageId);
    if (!persona) throw new DashboardServiceError("persona_not_found", 404, "Persona not found.");

    const created = await this.core.addServerMemory(
      snapshot,
      persona.personaId,
      input.lineageId,
      actor.user.user_id,
      input.content,
      input.tags,
    );
    if (!created) {
      throw new DashboardServiceError("memory_limit_or_write_failed", 409, "The memory could not be saved.");
    }
    return serializeServerMemory(created, actor.user.user_id, actor.canManage);
  }

  async updateServer(
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    memoryId: number,
    input: MemoryMutationInput,
  ) {
    this.assertLineage(snapshot, input.lineageId, false);
    await this.assertCanTeachServerMemory(actor, snapshot);

    const visibleRows = await this.core.listServerMemories(
      snapshot.serverId,
      input.lineageId,
      actor.canManage ? undefined : actor.user.user_id,
    );
    if (!visibleRows.some((row) => row.server_memory_id === memoryId)) {
      throw new DashboardServiceError("memory_not_found", 404, "Server memory not found.");
    }

    const allContents = await this.core.listServerMemories(snapshot.serverId, input.lineageId);
    if (
      allContents.some(
        (row) =>
          row.server_memory_id !== memoryId &&
          row.content.trim().toLocaleLowerCase() === input.content.trim().toLocaleLowerCase(),
      )
    ) {
      throw new DashboardServiceError("duplicate_memory", 409, "That server memory already exists for this persona.");
    }

    const updated = await this.core.updateServerMemory(
      snapshot,
      memoryId,
      input.lineageId,
      input.content,
      input.tags,
      actor.canManage ? undefined : actor.user.user_id,
    );
    if (!updated) throw new DashboardServiceError("memory_not_found", 404, "Server memory not found.");
    return serializeServerMemory(updated, actor.user.user_id, actor.canManage);
  }

  async removeServer(
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    memoryId: number,
    lineageId: number,
  ): Promise<void> {
    this.assertLineage(snapshot, lineageId, false);
    await this.assertCanTeachServerMemory(actor, snapshot);
    const removed = await this.core.removeServerMemory(
      snapshot,
      memoryId,
      lineageId,
      actor.canManage ? undefined : actor.user.user_id,
    );
    if (!removed) throw new DashboardServiceError("memory_not_found", 404, "Server memory not found.");
  }

  private async assertCanTeachServerMemory(actor: DashboardActor, snapshot: DashboardGuildSnapshot): Promise<void> {
    if (actor.canManage) return;
    if (snapshot.config.server_memteaching_enabled === false) {
      throw new DashboardServiceError(
        "server_teaching_disabled",
        403,
        "Server memory teaching is disabled for members.",
      );
    }
    if (await this.core.isUserBlacklisted(snapshot.serverDiscordId, actor.discordId)) {
      throw new DashboardServiceError("user_blacklisted", 403, "You cannot teach server memories in this server.");
    }
  }
}
