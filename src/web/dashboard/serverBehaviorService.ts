import { z } from "zod";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { getCachedActivePreset } from "@/utils/cache/stPresetCache";
import { configRepository, serverScheduleRepository } from "@/utils/db/repositories";
import { localizer, resolvePresetDisplayName } from "@/utils/text/localizer";
import {
  DELIBERATE_TOOL_TRIGGER_TARGETS,
  getToolNamesForDeliberateTriggerTarget,
  normalizeDeliberateToolRegexTrigger,
  normalizeDeliberateToolTrigger,
  type DeliberateToolTrigger,
} from "@/utils/tools/deliberateToolMode";
import { DashboardServiceError } from "./errors";
import type { DashboardGuildSnapshot } from "./types";

export const MAX_TOOL_TRIGGERS_PER_TARGET = 16;
const MAX_RANDOM_TRIGGERS = Number.parseInt(process.env.RANDOM_TRIGGER_MAX_PER_SERVER ?? "10", 10);
const MAX_SCHEDULE_HOURS = 2_147_483_647;

const toolTriggerPatch = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("add"),
    target: z.string().max(40),
    kind: z.enum(["literal", "regex"]).default("literal"),
    value: z.string().trim().min(1).max(120),
  }),
  z.strictObject({
    action: z.literal("remove"),
    target: z.string().max(40),
    kind: z.enum(["literal", "regex"]),
    value: z.string().min(1).max(120),
  }),
]);

const randomTriggerPatch = z
  .strictObject({
    channelDiscId: z.string().regex(/^\d{17,20}$/),
    personaId: z.number().int().positive().nullable(),
    timerHours: z.number().int().min(1).max(MAX_SCHEDULE_HOURS),
    chancePercent: z.number().int().min(1).max(100),
    randomOffsetRange: z.number().int().min(0).max(MAX_SCHEDULE_HOURS).nullable(),
    silenceThresholdHours: z.number().int().min(1).max(MAX_SCHEDULE_HOURS).nullable(),
    failureThreshold: z.number().int().min(1).max(MAX_SCHEDULE_HOURS).nullable(),
    respondToSelf: z.boolean(),
    customPrompt: z.string().trim().max(1000).nullable(),
  })
  .refine(({ timerHours, randomOffsetRange }) => timerHours + (randomOffsetRange ?? 0) <= MAX_SCHEDULE_HOURS);

function behaviorError(code: string, status: DashboardServiceError["status"], vars?: Record<string, string | number>) {
  return new DashboardServiceError(code, status, localizer("en-US", `general.dashboard.${code}`, vars));
}

export async function loadSystemPromptChoices(snapshot: DashboardGuildSnapshot) {
  const active = await getCachedActivePreset(snapshot.serverId);
  const presets = active ? [] : ((await configRepository.loadSystemPromptPresets()) ?? []);
  return {
    locked: Boolean(active),
    presets: presets.map((preset) => ({
      id: preset.system_prompt_preset_id,
      name: resolvePresetDisplayName(preset, "en-US"),
      text: preset.preset_prompt_text,
    })),
  };
}

export async function assertEditableSystemPrompt(serverId: number) {
  if (await getCachedActivePreset(serverId)) throw behaviorError("system_prompt_preset_locked", 409);
}

function describeToolTrigger(trigger: DeliberateToolTrigger) {
  return typeof trigger === "string"
    ? { kind: "literal" as const, value: trigger }
    : { kind: trigger.type, value: trigger.value };
}

export function loadToolTriggers(snapshot: DashboardGuildSnapshot) {
  const saved = snapshot.config.deliberate_tool_triggers ?? {};
  return DELIBERATE_TOOL_TRIGGER_TARGETS.map(({ value, labelKey }) => ({
    target: value,
    label: localizer("en-US", labelKey),
    entries: (saved[value] ?? []).map(describeToolTrigger),
  }));
}

function parseAddedToolTrigger(kind: "literal" | "regex", value: string): DeliberateToolTrigger {
  if (kind === "literal") {
    if (value.length > 40) throw behaviorError("tool_phrase_invalid", 422);
    return normalizeDeliberateToolTrigger(value);
  }
  const pattern = normalizeDeliberateToolRegexTrigger(value);
  try {
    new RegExp(pattern, "iu");
  } catch {
    throw behaviorError("tool_regex_invalid", 422);
  }
  return { type: "regex", value: pattern };
}

export async function updateToolTriggers(snapshot: DashboardGuildSnapshot, value: unknown) {
  const parsed = toolTriggerPatch.safeParse(value);
  if (!parsed.success || !getToolNamesForDeliberateTriggerTarget(parsed.data.target).length)
    throw behaviorError("tool_phrase_invalid", 422);
  const patch = parsed.data;
  const saved = { ...snapshot.config.deliberate_tool_triggers };
  const current = saved[patch.target] ?? [];
  if (patch.action === "add") {
    const entry = parseAddedToolTrigger(patch.kind, patch.value);
    const normalize = patch.kind === "regex" ? normalizeDeliberateToolRegexTrigger : normalizeDeliberateToolTrigger;
    const { value } = describeToolTrigger(entry);
    if (
      current.map(describeToolTrigger).some((stored) => stored.kind === patch.kind && normalize(stored.value) === value)
    )
      throw behaviorError("tool_phrase_duplicate", 409);
    if (current.length >= MAX_TOOL_TRIGGERS_PER_TARGET)
      throw behaviorError("tool_phrase_limit", 422, { max: MAX_TOOL_TRIGGERS_PER_TARGET });
    saved[patch.target] = [...current, entry];
  } else {
    const remaining = current.filter((entry) => {
      const { kind, value } = describeToolTrigger(entry);
      return kind !== patch.kind || value !== patch.value;
    });
    if (remaining.length === current.length) throw behaviorError("tool_phrase_missing", 404);
    if (remaining.length) saved[patch.target] = remaining;
    else delete saved[patch.target];
  }
  if (!(await configRepository.updateTriggerBehaviorConfig(snapshot.serverId, { deliberate_tool_triggers: saved })))
    throw behaviorError("tool_phrase_failed", 500);
  invalidateTomoriStateCache(snapshot.serverDiscordId);
  return loadToolTriggers({ ...snapshot, config: { ...snapshot.config, deliberate_tool_triggers: saved } });
}

export async function loadRandomTriggers(snapshot: DashboardGuildSnapshot, channels: ReadonlySet<string>) {
  const rows = await serverScheduleRepository.getServerTriggers(snapshot.serverId);
  return rows.filter((row) => row.trigger_id !== undefined && channels.has(row.channel_disc_id));
}

export async function saveRandomTrigger(
  snapshot: DashboardGuildSnapshot,
  channels: ReadonlySet<string>,
  value: unknown,
  triggerId?: number,
) {
  const parsed = randomTriggerPatch.safeParse(value);
  if (!parsed.success) throw behaviorError("random_schedule_invalid", 422);
  const patch = parsed.data;
  if (
    !channels.has(patch.channelDiscId) ||
    (patch.personaId !== null && !snapshot.personas.some(({ personaId }) => personaId === patch.personaId))
  )
    throw behaviorError("random_schedule_target", 422);
  const data = { ...patch, serverId: snapshot.serverId, customPrompt: patch.customPrompt || null };
  if (triggerId !== undefined) {
    const rows = await loadRandomTriggers(snapshot, channels);
    const current = rows.find((row) => row.trigger_id === triggerId);
    if (!current) throw behaviorError("random_schedule_missing", 404);
    if (patch.channelDiscId !== current.channel_disc_id || patch.personaId !== (current.persona_id ?? null))
      throw behaviorError("random_schedule_target", 422);
    if (!(await serverScheduleRepository.upsertTrigger(triggerId, data)))
      throw behaviorError("random_schedule_failed", 500);
  } else {
    if ((await serverScheduleRepository.getServerTriggerCount(snapshot.serverId)) >= MAX_RANDOM_TRIGGERS)
      throw behaviorError("random_schedule_limit", 422, { max: MAX_RANDOM_TRIGGERS });
    if (
      patch.personaId !== null &&
      (await serverScheduleRepository.getTriggerByPersonaAndChannel(
        snapshot.serverId,
        patch.channelDiscId,
        patch.personaId,
      ))
    )
      throw behaviorError("random_schedule_duplicate", 409);
    if (!(await serverScheduleRepository.insertTrigger(data))) throw behaviorError("random_schedule_failed", 500);
  }
}

export async function removeRandomTrigger(
  snapshot: DashboardGuildSnapshot,
  channels: ReadonlySet<string>,
  triggerId: number,
) {
  const rows = await loadRandomTriggers(snapshot, channels);
  if (!rows.some((row) => row.trigger_id === triggerId)) throw behaviorError("random_schedule_missing", 404);
  if (!(await serverScheduleRepository.deleteTrigger(triggerId))) throw behaviorError("random_schedule_failed", 500);
}
