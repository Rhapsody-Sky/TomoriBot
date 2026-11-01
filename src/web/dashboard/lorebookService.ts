import { z } from "zod";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import {
  LOREBOOK_CONTENT_MAX,
  LOREBOOK_KEYS_MAX,
  LOREBOOK_KEY_LENGTH_MAX,
  LOREBOOK_SCAN_DEPTH_MAX,
  LOREBOOK_TITLE_MAX,
  lorebookEntryFlagsSchema,
  lorebookEntryInputSchema,
  lorebookEntryToInput,
} from "@/modules/lorebooks/db/types";
import { lorebookOperations } from "@/modules/lorebooks/discord/operations";
import { convertLorebookUpload, exportWorldInfo } from "@/modules/lorebooks/imports";
import type { DashboardActor, DashboardGuildSnapshot } from "./types";
import { DashboardServiceError } from "./errors";

const id = z.number().int().positive();
const scope = { lineageId: z.number().int().nonnegative(), bookId: id.optional() };
const channels = z.array(z.string().regex(/^\d{17,20}$/));
const entryFields = lorebookEntryInputSchema;
const entrySchema = z.strictObject({
  ...scope,
  title: z.string().trim().min(1).max(LOREBOOK_TITLE_MAX),
  content: z.string().min(1).max(LOREBOOK_CONTENT_MAX),
  keys: z.array(z.string().min(1).max(LOREBOOK_KEY_LENGTH_MAX)).max(LOREBOOK_KEYS_MAX),
  channelDiscIds: channels,
});
const contentSchema = z.strictObject({
  ...scope,
  title: z.string().trim().min(1).max(LOREBOOK_TITLE_MAX),
  content: z
    .string()
    .min(1)
    .max(LOREBOOK_CONTENT_MAX)
    .refine((value) => value.trim().length > 0),
});
const keysSchema = z.strictObject({
  ...scope,
  keys: z.array(z.string().min(1).max(LOREBOOK_KEY_LENGTH_MAX)).max(LOREBOOK_KEYS_MAX),
});
const channelsSchema = z.strictObject({ ...scope, channelDiscIds: channels });
const activationSchema = z.strictObject({
  ...scope,
  secondaryKeys: z.array(z.string().min(1).max(LOREBOOK_KEY_LENGTH_MAX)).max(LOREBOOK_KEYS_MAX),
  selectiveLogic: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  scanDepth: z.number().int().min(1).max(LOREBOOK_SCAN_DEPTH_MAX),
  triggerChance: z.number().int().min(0).max(100),
  insertionOrder: z.number().int().min(-2147483648).max(2147483647),
});
const flagsSchema = z.strictObject({ ...scope, flags: lorebookEntryFlagsSchema });
const bookSchema = z.strictObject({ name: z.string().trim().min(1).max(LOREBOOK_TITLE_MAX) });
const bookPatchSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(LOREBOOK_TITLE_MAX).optional(),
    enabled: z.boolean().optional(),
    channelDiscIds: channels.optional(),
  })
  .refine((v) => Object.keys(v).length === 1);
const importSchema = z.strictObject({
  ...scope,
  mode: z.enum(["append", "replace", "new"]),
  name: z.string().trim().min(1).max(LOREBOOK_TITLE_MAX).optional(),
  data: z.unknown(),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new DashboardServiceError("invalid_lorebook", 422, "Invalid lorebook request.");
  return result.data;
}

function ensureSuccess(result: { status: string }) {
  if (["success", "appended", "replaced"].includes(result.status)) return result;
  throw new DashboardServiceError(
    `lorebook_${result.status.replaceAll("-", "_")}`,
    result.status === "missing" ? 404 : result.status === "failed" ? 500 : 422,
    "Lorebook operation failed.",
  );
}

export class DashboardLorebookService {
  private canWrite(actor: DashboardActor) {
    if (!actor.canManage) throw new DashboardServiceError("forbidden", 403, "Manage Server permission is required.");
  }

  private validateChannels(ids: string[], allowed: ReadonlySet<string>) {
    if (ids.some((id) => !allowed.has(id)))
      throw new DashboardServiceError("invalid_lorebook_channel", 422, "A channel is not available in this server.");
  }

  private async context(snapshot: DashboardGuildSnapshot, lineageId: number, bookId?: number) {
    if (lineageId !== 0 && !snapshot.personas.some((persona) => persona.lineageId === lineageId))
      throw new DashboardServiceError("lineage_forbidden", 403, "That persona is not available in this server.");
    const lineage = lineageId === 0 ? null : lineageId;
    const books = await lorebookRepository.listBooks(snapshot.serverId);
    if (!books) throw new DashboardServiceError("lorebook_unavailable", 503, "Lorebooks are unavailable.");
    if (lineage !== null && bookId !== undefined)
      throw new DashboardServiceError("invalid_lorebook", 422, "Invalid lorebook scope.");
    const book = bookId === undefined ? undefined : books.find((item) => item.lorebook_id === bookId);
    if (bookId !== undefined && !book) throw new DashboardServiceError("lorebook_missing", 404, "Lorebook not found.");
    const result = await lorebookRepository.listScope(snapshot.serverId, lineage);
    if (result.status !== "fresh")
      throw new DashboardServiceError("lorebook_unavailable", 503, "Lorebooks are unavailable.");
    return {
      lineage,
      books,
      book,
      allEntries: result.entries,
      entries:
        lineage === null && book ? result.entries.filter((entry) => entry.lorebook_name === book.name) : result.entries,
    };
  }

  async list(snapshot: DashboardGuildSnapshot, lineageId: number, bookId?: number) {
    const context = await this.context(snapshot, lineageId, bookId);
    const counts = new Map<string, number>();
    if (context.lineage === null) {
      for (const entry of context.allEntries) {
        if (entry.lorebook_name) counts.set(entry.lorebook_name, (counts.get(entry.lorebook_name) ?? 0) + 1);
      }
    }
    return {
      books: context.books.map((book) => ({
        ...book,
        entryCount: context.lineage === null ? (counts.get(book.name) ?? 0) : null,
      })),
      entries: context.lineage === null && !context.book ? [] : context.entries,
    };
  }

  async book(
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    bookId: number | null,
    method: "create" | "edit" | "delete",
    value: unknown,
    allowed: ReadonlySet<string>,
  ) {
    this.canWrite(actor);
    if (method === "create") {
      const data = parse(bookSchema, value);
      const bookId = await lorebookRepository.createBook(snapshot.serverId, data.name);
      if (!bookId) throw new DashboardServiceError("lorebook_failed", 500, "Lorebook operation failed.");
      return { status: "success", bookId };
    }
    if (!bookId) throw new DashboardServiceError("invalid_lorebook", 422, "Invalid lorebook request.");
    const context = await this.context(snapshot, 0, bookId);
    if (!context.book) throw new DashboardServiceError("lorebook_missing", 404, "Lorebook not found.");
    if (method === "delete") {
      if (!(await lorebookRepository.deleteBook(snapshot.serverId, bookId)))
        throw new DashboardServiceError("lorebook_failed", 500, "Lorebook operation failed.");
    } else {
      const data = parse(bookPatchSchema, value);
      if (
        data.channelDiscIds &&
        JSON.stringify([...data.channelDiscIds].sort()) !== JSON.stringify([...context.book.channel_disc_ids].sort())
      )
        this.validateChannels(data.channelDiscIds, allowed);
      const ok =
        data.name !== undefined
          ? await lorebookRepository.renameBook(snapshot.serverId, bookId, data.name)
          : data.enabled !== undefined
            ? await lorebookRepository.setBookEnabled(snapshot.serverId, bookId, data.enabled)
            : await lorebookRepository.setBookChannels(snapshot.serverId, bookId, data.channelDiscIds ?? []);
      if (!ok) throw new DashboardServiceError("lorebook_failed", 500, "Lorebook operation failed.");
    }
    return { status: "success" };
  }

  async entry(
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    entryId: number | null,
    method: "add" | "edit" | "content" | "keys" | "channels" | "activation" | "flags" | "delete",
    value: unknown,
    allowed: ReadonlySet<string>,
  ) {
    this.canWrite(actor);
    const schema =
      method === "add" || method === "edit"
        ? entrySchema
        : method === "content"
          ? contentSchema
          : method === "keys"
            ? keysSchema
            : method === "channels"
              ? channelsSchema
              : method === "activation"
                ? activationSchema
                : method === "flags"
                  ? flagsSchema
                  : z.strictObject(scope);
    const data = parse(schema, value) as z.infer<typeof entrySchema> &
      z.infer<typeof activationSchema> &
      z.infer<typeof flagsSchema>;
    const ctx = await this.context(snapshot, data.lineageId, data.bookId);
    if (ctx.lineage === null && !ctx.book)
      throw new DashboardServiceError("invalid_lorebook", 422, "Select a lorebook.");
    const existing = entryId ? ctx.entries.find((entry) => entry.entry_id === entryId) : undefined;
    if (method !== "add" && !existing)
      throw new DashboardServiceError("lorebook_missing", 404, "Lorebook entry not found.");
    const common = { serverId: snapshot.serverId, lineageId: ctx.lineage, canManage: true };
    if (method === "channels" && existing) {
      if (ctx.lineage === null)
        throw new DashboardServiceError("invalid_lorebook", 422, "Serverwide channels belong to the lorebook.");
      const unchanged =
        JSON.stringify([...data.channelDiscIds].sort()) === JSON.stringify([...existing.channel_disc_ids].sort());
      if (!unchanged) this.validateChannels(data.channelDiscIds, allowed);
      const result = await lorebookRepository.update(snapshot.serverId, ctx.lineage, existing.entry_id, {
        ...lorebookEntryToInput(existing),
        channel_disc_ids: data.channelDiscIds,
        legacy_channel_tags: unchanged ? (existing.legacy_channel_tags ?? []) : [],
      });
      return ensureSuccess({ status: result === "updated" ? "success" : result });
    }
    if (method === "keys" && existing) {
      return ensureSuccess(
        await lorebookOperations.editEntry({
          ...common,
          entryId: existing.entry_id,
          title: existing.title,
          content: existing.content,
          keys: data.keys,
          channelDiscIds: existing.channel_disc_ids,
        }),
      );
    }
    if (method === "content" && existing) {
      const result = await lorebookRepository.update(snapshot.serverId, ctx.lineage, existing.entry_id, {
        ...lorebookEntryToInput(existing),
        title: data.title,
        content: data.content,
      });
      return ensureSuccess({ status: result === "updated" ? "success" : result });
    }
    if (method === "add" || method === "edit") {
      if (ctx.lineage === null && data.channelDiscIds.length)
        throw new DashboardServiceError("invalid_lorebook", 422, "Serverwide channels belong to the lorebook.");
      if (
        !existing ||
        JSON.stringify([...data.channelDiscIds].sort()) !== JSON.stringify([...existing.channel_disc_ids].sort())
      )
        this.validateChannels(data.channelDiscIds, allowed);
      const input = {
        ...common,
        title: data.title,
        content: data.content,
        keys: data.keys,
        channelDiscIds: data.channelDiscIds,
      };
      return ensureSuccess(
        method === "add"
          ? await lorebookOperations.add({ ...input, lorebookName: ctx.book?.name, bookId: ctx.book?.lorebook_id })
          : await lorebookOperations.editEntry({ ...input, entryId: entryId as number }),
      );
    }
    if (method === "activation")
      return ensureSuccess(
        await lorebookOperations.editActivation({
          ...common,
          entryId: entryId as number,
          secondaryKeys: data.secondaryKeys,
          selectiveLogic: data.selectiveLogic,
          scanDepth: data.scanDepth,
          triggerChance: data.triggerChance,
          insertionOrder: data.insertionOrder,
        }),
      );
    if (method === "flags")
      return ensureSuccess(
        await lorebookOperations.setFlags({ ...common, entryId: entryId as number, flags: data.flags }),
      );
    return ensureSuccess(await lorebookOperations.remove({ ...common, entryId: entryId as number }));
  }

  async transfer(
    actor: DashboardActor,
    snapshot: DashboardGuildSnapshot,
    value: unknown,
    allowed: ReadonlySet<string>,
  ) {
    this.canWrite(actor);
    const data = parse(importSchema, value);
    const ctx = await this.context(snapshot, data.lineageId, data.bookId);
    const converted = convertLorebookUpload(data.data);
    if (!converted?.entries.length || !entryFields.array().safeParse(converted.entries).success)
      throw new DashboardServiceError("invalid_lorebook", 422, "Invalid lorebook import.");
    for (const entry of converted.entries) {
      this.validateChannels(entry.channel_disc_ids, allowed);
      this.validateChannels(entry.lorebook_channel_disc_ids ?? [], allowed);
    }
    if (data.mode === "new") {
      if (ctx.lineage !== null || data.bookId !== undefined || !data.name)
        throw new DashboardServiceError("invalid_lorebook", 422, "Invalid lorebook scope.");
      return {
        ...ensureSuccess(await lorebookRepository.importNewBook(snapshot.serverId, data.name, converted.entries)),
        report: converted.report,
      };
    }
    if (ctx.lineage === null && !ctx.book)
      throw new DashboardServiceError("invalid_lorebook", 422, "Select a lorebook.");
    const entries = converted.entries.map((entry) => ({ ...entry, lorebook_name: ctx.book?.name }));
    const result =
      data.mode === "append"
        ? await lorebookRepository.appendScopeEntries(
            snapshot.serverId,
            ctx.lineage,
            entries,
            undefined,
            ctx.book?.lorebook_id,
          )
        : {
            status: await lorebookRepository.replaceScopeEntries(
              snapshot.serverId,
              ctx.lineage,
              entries,
              undefined,
              ctx.book?.name,
              ctx.book?.lorebook_id,
            ),
          };
    return { ...ensureSuccess(result), report: converted.report };
  }

  async export(snapshot: DashboardGuildSnapshot, lineageId: number, bookId?: number) {
    const ctx = await this.context(snapshot, lineageId, bookId);
    if (ctx.lineage === null && !ctx.book)
      throw new DashboardServiceError("invalid_lorebook", 422, "Select a lorebook.");
    return exportWorldInfo(ctx.entries.map(lorebookEntryToInput), ctx.book?.name ?? "Persona Lorebook");
  }
}
