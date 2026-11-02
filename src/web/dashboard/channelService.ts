import { z } from "zod";
import type { CooldownType } from "@/types/db/schema";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { invalidateWhitelistCache } from "@/utils/cache/channelWhitelistCache";
import {
  channelContextNoteRepo,
  channelPromptRepo,
  configRepository,
  llmOverrideRepo,
  whitelistRepository,
} from "@/utils/db/repositories";
import { setTextModelOverride } from "@/utils/discord/interactions/textModelOverrideOperations";
import { CONTEXT_NOTE_DEPTH_MAX, CONTEXT_NOTE_MAX_LENGTH } from "@/utils/discord/contextNoteOptions";
import { log } from "@/utils/misc/logger";
import { DashboardServiceError } from "./errors";
import type { TomoriDashboardCore } from "./core";
import type { DashboardGuildSnapshot } from "./types";

const patchSchema = z
  .object({
    channelIds: z.array(z.string()).max(500),
    patch: z
      .object({
        textModel: z.number().int().positive().nullable().optional(),
        prompt: z
          .object({ text: z.string().trim().min(1).max(4000), mode: z.enum(["append", "replace"]) })
          .strict()
          .nullable()
          .optional(),
        contextNote: z
          .object({
            text: z.string().trim().min(1).max(CONTEXT_NOTE_MAX_LENGTH),
            depth: z.number().int().min(0).max(CONTEXT_NOTE_DEPTH_MAX),
          })
          .strict()
          .nullable()
          .optional(),
        allowlisted: z.boolean().optional(),
        cooldown: z
          .object({ type: z.number().int().min(0).max(4), seconds: z.number().int().min(0).max(86400) })
          .strict()
          .nullable()
          .optional(),
        personaId: z.number().int().positive().optional(),
        personaAllowed: z.boolean().optional(),
        personaChannels: z
          .array(
            z.object({ personaId: z.number().int().positive(), channelIds: z.array(z.string()).max(500) }).strict(),
          )
          .min(1)
          .max(500)
          .optional(),
        autochatPersona: z.number().int().positive().nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0),
  })
  .strict();

export class DashboardChannelService {
  constructor(private core: TomoriDashboardCore) {}

  async load(snapshot: DashboardGuildSnapshot, ids: string[]) {
    const [workspace, overrides, allowlist, personaRows] = await Promise.all([
      this.core.loadPersonaTextModelWorkspace(snapshot, snapshot.personas[0]?.personaId ?? 0),
      llmOverrideRepo.getAllChannelLlmOverridesForServer(snapshot.serverId),
      whitelistRepository.getAllWhitelistChannels(snapshot.serverId),
      whitelistRepository.getAllWhitelistPersonas(snapshot.serverId),
    ]);
    const channels = Object.fromEntries(
      await Promise.all(
        ids.map(async (id) => {
          const [prompt, contextNote] = await Promise.all([
            channelPromptRepo.getChannelPromptOverride(snapshot.serverId, id),
            channelContextNoteRepo.getChannelContextNote(snapshot.serverId, id),
          ]);
          const row = allowlist.find((entry) => entry.channel_disc_id === id);
          return [
            id,
            {
              textModel: overrides.find((entry) => entry.channelDiscId === id)?.llm.llm_id ?? null,
              prompt: prompt ? { text: prompt.prompt, mode: prompt.mode } : null,
              contextNote: contextNote ? { text: contextNote.note, depth: contextNote.depth } : null,
              allowlisted: Boolean(row),
              cooldown:
                row?.cooldown_type != null && row.cooldown_length != null
                  ? { type: row.cooldown_type, seconds: row.cooldown_length }
                  : null,
              personaIds: personaRows.filter((entry) => entry.channel_disc_id === id).map((entry) => entry.persona_id),
              autochatPersona: snapshot.config.autoch_disc_ids?.includes(id)
                ? (snapshot.config.autoch_persona_overrides?.find((entry) => entry.channel_disc_id === id)
                    ?.persona_id ??
                  snapshot.personas.find((entry) => !entry.isAlter)?.personaId ??
                  null)
                : null,
            },
          ];
        }),
      ),
    );
    return {
      channels,
      models: workspace?.options ?? [],
      personas: snapshot.personas.map((entry) => ({ id: entry.personaId, label: entry.nickname })),
      restrictedPersonaIds: [...new Set(personaRows.map((row) => row.persona_id))],
      personaChannels: snapshot.personas.map((persona) => ({
        personaId: persona.personaId,
        channelIds: personaRows.filter((row) => row.persona_id === persona.personaId).map((row) => row.channel_disc_id),
      })),
      channelWhitelistActive: allowlist.length > 0,
      allowlistedChannelIds: allowlist.map((row) => row.channel_disc_id),
    };
  }

  async patch(snapshot: DashboardGuildSnapshot, input: unknown, available: Set<string>) {
    const parsed = patchSchema.safeParse(input);
    if (!parsed.success) throw new DashboardServiceError("invalid_channel_settings", 422, "Invalid channel settings.");
    const { patch } = parsed.data;
    if (patch.personaChannels?.some((entry) => entry.channelIds.length === 0))
      throw new DashboardServiceError(
        "persona_channel_required",
        422,
        "You need to enable at least one channel for this persona.",
      );
    const ids = [...new Set(parsed.data.channelIds)];
    const invalid =
      (ids.length === 0 && !patch.personaChannels) ||
      (patch.personaChannels !== undefined &&
        new Set(patch.personaChannels.map((entry) => entry.personaId)).size !== patch.personaChannels.length) ||
      (patch.personaChannels?.some(
        (entry) =>
          !snapshot.personas.some((persona) => persona.personaId === entry.personaId) ||
          entry.channelIds.some((id) => !available.has(id)),
      ) ??
        false) ||
      (patch.personaChannels !== undefined && Object.keys(patch).length !== 1) ||
      ids.some((id) => !available.has(id)) ||
      (patch.personaAllowed !== undefined) !== (patch.personaId !== undefined) ||
      (patch.personaId !== undefined && !snapshot.personas.some((p) => p.personaId === patch.personaId)) ||
      (patch.autochatPersona != null && !snapshot.personas.some((p) => p.personaId === patch.autochatPersona)) ||
      (patch.autochatPersona != null && ids.some((id) => !snapshot.config.autoch_disc_ids?.includes(id)));
    const workspace =
      patch.textModel != null
        ? await this.core.loadPersonaTextModelWorkspace(snapshot, snapshot.personas[0]?.personaId ?? 0)
        : null;
    if (invalid || (patch.textModel != null && !workspace?.options.some((model) => model.id === patch.textModel)))
      throw new DashboardServiceError("invalid_channel_settings", 422, "Invalid channel settings.");
    const rows = await whitelistRepository.getAllWhitelistChannels(snapshot.serverId);
    if (
      patch.allowlisted === false &&
      !rows.some((row) => available.has(row.channel_disc_id) && !ids.includes(row.channel_disc_id))
    )
      throw new DashboardServiceError("channel_required", 422, "You need to allow at least one channel");
    if (
      patch.cooldown !== undefined &&
      patch.allowlisted !== true &&
      ids.some((id) => !rows.some((row) => row.channel_disc_id === id))
    )
      throw new DashboardServiceError("invalid_channel_settings", 422, "Cooldown requires an allowlisted channel.");
    if (patch.allowlisted === false && patch.cooldown != null)
      throw new DashboardServiceError("invalid_channel_settings", 422, "Cooldown requires an allowlisted channel.");
    let personaSelection: string[] | undefined;
    if (patch.personaId !== undefined && patch.personaAllowed !== undefined) {
      const current = await whitelistRepository.getPersonaWhitelistChannels(snapshot.serverId, patch.personaId);
      const next = new Set(current.length ? current.map((row) => row.channel_disc_id) : available);
      for (const id of ids) {
        if (patch.personaAllowed) next.add(id);
        else next.delete(id);
      }
      if (!next.size)
        throw new DashboardServiceError(
          "persona_channel_required",
          422,
          "You need to enable at least one channel for this persona.",
        );
      personaSelection = [...next];
    }
    let completed = 0;
    try {
      if (patch.personaChannels) {
        for (const entry of patch.personaChannels) {
          const selected = [...new Set(entry.channelIds)];
          await whitelistRepository.replacePersonaWhitelistChannels(
            snapshot.serverId,
            entry.personaId,
            selected.length === available.size ? [] : selected,
          );
          invalidateWhitelistCache(snapshot.serverDiscordId);
          completed++;
        }
      }
      for (const id of ids) {
        const write = async (ok: Promise<boolean>) => {
          if (!(await ok)) throw new Error("write failed");
          completed++;
        };
        if (patch.textModel !== undefined)
          await write(
            setTextModelOverride({
              scope: "channel",
              serverId: snapshot.serverId,
              channelId: id,
              llmId: patch.textModel,
              serverDiscId: snapshot.serverDiscordId,
            }),
          );
        if (patch.prompt !== undefined)
          await write(
            patch.prompt
              ? channelPromptRepo.setChannelPromptOverride(snapshot.serverId, id, patch.prompt.text, patch.prompt.mode)
              : channelPromptRepo.deleteChannelPromptOverride(snapshot.serverId, id),
          );
        if (patch.contextNote !== undefined)
          await write(
            patch.contextNote
              ? channelContextNoteRepo.setChannelContextNote(
                  snapshot.serverId,
                  id,
                  patch.contextNote.text,
                  patch.contextNote.depth,
                )
              : channelContextNoteRepo.deleteChannelContextNote(snapshot.serverId, id),
          );
        if (patch.allowlisted === false) {
          await whitelistRepository.removeChannelWhitelist(snapshot.serverId, id);
          invalidateWhitelistCache(snapshot.serverDiscordId);
          completed++;
        } else if (patch.allowlisted === true || patch.cooldown !== undefined) {
          const row = rows.find((entry) => entry.channel_disc_id === id);
          const cooldown =
            patch.cooldown === undefined
              ? row?.cooldown_type != null && row.cooldown_length != null
                ? { type: row.cooldown_type, seconds: row.cooldown_length }
                : null
              : patch.cooldown;
          await whitelistRepository.upsertChannelWhitelists(snapshot.serverId, [
            {
              channelId: id,
              cooldownType: (cooldown?.type as CooldownType) ?? null,
              cooldownLength: cooldown?.seconds ?? null,
            },
          ]);
          invalidateWhitelistCache(snapshot.serverDiscordId);
          completed++;
        }
      }
      if (patch.personaId !== undefined && personaSelection) {
        await whitelistRepository.replacePersonaWhitelistChannels(snapshot.serverId, patch.personaId, personaSelection);
        invalidateWhitelistCache(snapshot.serverDiscordId);
        completed++;
      }
      if (patch.autochatPersona !== undefined) {
        const selected = new Set(snapshot.config.autoch_disc_ids ?? []);
        const overrides = new Map(
          (snapshot.config.autoch_persona_overrides ?? []).map((entry) => [entry.channel_disc_id, entry.persona_id]),
        );
        const main = snapshot.personas.find((entry) => !entry.isAlter)?.personaId;
        for (const id of ids) {
          if (patch.autochatPersona === null || patch.autochatPersona === main) overrides.delete(id);
          else overrides.set(id, patch.autochatPersona);
        }
        await writeAutochat(
          snapshot,
          [...selected],
          [...overrides].map(([channel_disc_id, persona_id]) => ({ channel_disc_id, persona_id })),
        );
        completed++;
      }
    } catch (error) {
      await log.error("Dashboard channel settings save failed", error, undefined, { persist: false });
      throw new DashboardServiceError(
        "channel_save_failed",
        500,
        completed
          ? "Some channel settings were saved before the failure. Refresh before retrying."
          : "Channel settings could not be saved.",
      );
    }
    return { saved: true };
  }
}

async function writeAutochat(
  snapshot: DashboardGuildSnapshot,
  ids: string[],
  overrides: Array<{ channel_disc_id: string; persona_id: number }>,
) {
  if (
    !(await configRepository.updateAutoTriggerConfig(snapshot.serverId, {
      autoch_disc_ids: ids,
      autoch_persona_overrides: overrides,
    }))
  )
    throw new Error("write failed");
  invalidateTomoriStateCache(snapshot.serverDiscordId);
}
