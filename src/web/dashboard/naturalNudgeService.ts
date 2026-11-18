import { z } from "zod";
import { naturalNudgeRepository } from "@/modules/natural-nudges/db/repositories";
import {
  CATEGORY_IMPLIED_PREREQUISITES,
  computePersonaNudgeFingerprint,
  CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX,
  CUSTOM_IDLE_NUDGE_BRIEF_MAX,
  CUSTOM_IDLE_NUDGE_LIMIT,
  CUSTOM_IDLE_NUDGE_LIST_MAX,
  CUSTOM_IDLE_NUDGE_TITLE_MAX,
  NATURAL_NUDGE_CATEGORIES,
  NUDGE_HEAT_OFFSET_MAX,
  NUDGE_PREREQUISITE_IDS,
  NUDGE_TOOL_NAMES,
  customIdleNudgeKey,
} from "@/modules/natural-nudges/db/types";
import { naturalNudgePanelDependencies, patchConfig } from "@/modules/natural-nudges/discord/operations";
import { nudgeFrequencyLabel } from "@/modules/natural-nudges/discord/panel";
import {
  createCustomIdleNudge,
  idleNudgeContentFromDefinition,
  loadNudgeStudioView,
  nudgeStudioOperations,
  personaNudgeLocalId,
} from "@/modules/natural-nudges/discord/studioOperations";
import {
  nudgeBlockerLabel,
  nudgeToolLabel,
  prerequisiteLabel,
  studioEntryTitle,
} from "@/modules/natural-nudges/discord/studioPanel";
import { invalidateNaturalNudgeConfigCache } from "@/modules/natural-nudges/runtime/configCache";
import { idleNudgesPerDay, activeNudgeTripRange } from "@/modules/natural-nudges/runtime/meters";
import {
  ACTIVE_NUDGE_DAILY_CAPS,
  ACTIVE_NUDGE_DAILY_CHECK_CAPS,
  IDLE_NUDGE_DAILY_CAPS,
  MAX_EFFECTIVE_HEAT,
} from "@/modules/natural-nudges/runtime/tuning";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { getProviderOptions, providerOptionDisplayName } from "@/utils/provider/providerOptionRegistry";
import { localizer } from "@/utils/text/localizer";
import { DashboardServiceError } from "./errors";
import type { DashboardGuildSnapshot } from "./types";

const locale = "en-US";
const text = (key: string, vars?: Record<string, string | number>) => localizer(locale, key, vars);
const levels = [0, 1, 2, 3] as const;
export function loadNaturalNudgeCopy() {
  const keys = [
    "general.dashboard.interface_nudge_title",
    "general.dashboard.interface_nudge_hint",
    "general.dashboard.interface_nudge_settings",
    "general.dashboard.interface_nudge_models",
    "general.dashboard.interface_nudge_advanced",
    "general.dashboard.interface_nudge_studio",
    "general.dashboard.interface_nudge_channels",
    "general.dashboard.interface_nudge_automatic",
    "general.dashboard.interface_nudge_manual",
    "general.dashboard.interface_nudge_hidden_channels",
    "general.dashboard.interface_nudge_channel_limit",
    "general.dashboard.interface_nudge_idle",
    "general.dashboard.interface_nudge_idle_hint",
    "general.dashboard.interface_nudge_enable_idle",
    "general.dashboard.interface_nudge_active",
    "general.dashboard.interface_nudge_active_hint",
    "general.dashboard.interface_nudge_enable_active",
    "general.dashboard.interface_nudge_frequency",
    "general.dashboard.interface_nudge_planner",
    "general.dashboard.interface_nudge_planner_hint",
    "general.dashboard.interface_nudge_checker",
    "general.dashboard.interface_nudge_checker_hint",
    "general.dashboard.interface_nudge_model",
    "general.dashboard.interface_nudge_text_models",
    "general.dashboard.interface_nudge_decision_models",
    "general.dashboard.interface_nudge_planner_auto",
    "general.dashboard.interface_nudge_checker_auto",
    "general.dashboard.interface_nudge_resolved",
    "general.dashboard.interface_nudge_model_unavailable",
    "general.dashboard.interface_nudge_no_model",
    "general.dashboard.interface_nudge_heat",
    "general.dashboard.interface_nudge_heat_hint",
    "general.dashboard.interface_nudge_measured",
    "general.dashboard.interface_nudge_effective",
    "general.dashboard.interface_nudge_adjust",
    "general.dashboard.interface_nudge_heat_down",
    "general.dashboard.interface_nudge_heat_up",
    "general.dashboard.interface_nudge_weights",
    "general.dashboard.interface_nudge_weights_hint",
    "general.dashboard.interface_nudge_total",
    "general.dashboard.interface_nudge_invalid_weights",
    "general.dashboard.interface_nudge_ping_user",
    "general.dashboard.interface_nudge_revive_topic",
    "general.dashboard.interface_nudge_start_topic",
    "general.dashboard.interface_nudge_play_scene",
    "general.dashboard.interface_nudge_ping_user_weight",
    "general.dashboard.interface_nudge_revive_topic_weight",
    "general.dashboard.interface_nudge_start_topic_weight",
    "general.dashboard.interface_nudge_play_scene_weight",
    "general.dashboard.interface_nudge_search",
    "general.dashboard.interface_nudge_empty",
    "general.dashboard.interface_nudge_clear",
    "general.dashboard.interface_nudge_add",
    "general.dashboard.interface_nudge_limit",
    "general.dashboard.interface_nudge_back",
    "general.dashboard.interface_nudge_availability",
    "general.dashboard.interface_nudge_edit_availability",
    "general.dashboard.interface_nudge_edit_availability_name",
    "general.dashboard.interface_nudge_edit_name",
    "general.dashboard.interface_nudge_enabled",
    "general.dashboard.interface_nudge_off",
    "general.dashboard.interface_nudge_blocked",
    "general.dashboard.interface_nudge_builtin",
    "general.dashboard.interface_nudge_server_custom",
    "general.dashboard.interface_nudge_for_persona",
    "general.dashboard.interface_nudge_all_personas",
    "general.dashboard.interface_nudge_no_personas",
    "general.dashboard.interface_nudge_new",
    "general.dashboard.interface_nudge_name",
    "general.dashboard.interface_nudge_brief",
    "general.dashboard.interface_nudge_agenda",
    "general.dashboard.interface_nudge_agenda_hint",
    "general.dashboard.interface_nudge_ping_user_brief",
    "general.dashboard.interface_nudge_revive_topic_brief",
    "general.dashboard.interface_nudge_start_topic_brief",
    "general.dashboard.interface_nudge_play_scene_brief",
    "general.dashboard.interface_nudge_required_category",
    "general.dashboard.interface_nudge_prerequisites",
    "general.dashboard.interface_nudge_prerequisites_hint",
    "general.dashboard.interface_nudge_recommended",
    "general.dashboard.interface_nudge_recommended_hint",
    "general.dashboard.interface_nudge_add_prerequisite",
    "general.dashboard.interface_nudge_add_tool",
    "general.dashboard.interface_nudge_remove_item",
    "general.dashboard.interface_nudge_enable",
    "general.dashboard.interface_nudge_allowed_personas",
    "general.dashboard.interface_nudge_choose_personas",
    "general.dashboard.interface_nudge_selection_all",
    "general.dashboard.interface_nudge_selection_count",
    "general.dashboard.interface_nudge_future_personas",
    "general.dashboard.interface_nudge_off_personas",
    "general.dashboard.interface_nudge_required_personas",
    "general.dashboard.interface_nudge_select_all",
    "general.dashboard.interface_nudge_clear_selection",
    "general.dashboard.interface_nudge_no_matching_personas",
    "general.dashboard.interface_nudge_saved",
    "general.dashboard.interface_nudge_availability_saved",
    "general.dashboard.interface_nudge_deleted",
    "general.dashboard.interface_nudge_delete_name",
    "general.dashboard.interface_nudge_delete_hint",
    "general.dashboard.interface_nudge_error_invalid",
    "general.dashboard.interface_nudge_error_stale",
    "general.dashboard.interface_nudge_error_limit",
    "general.dashboard.interface_nudge_error_write_failed",
  ];
  return Object.fromEntries(
    keys.map((key) => [key.slice(key.lastIndexOf("interface_nudge_") + "interface_nudge_".length), text(key)]),
  );
}
const categorySchema = z.enum(NATURAL_NUDGE_CATEGORIES);
const frequency = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const model = z.object({ provider: z.string().min(1).max(120), id: z.number().int().positive() }).strict();
const heatOffset = z.number().int().min(-NUDGE_HEAT_OFFSET_MAX).max(NUDGE_HEAT_OFFSET_MAX);
const weights = z
  .object(
    Object.fromEntries(NATURAL_NUDGE_CATEGORIES.map((key) => [key, z.number().int().min(1).max(100)])) as Record<
      (typeof NATURAL_NUDGE_CATEGORIES)[number],
      z.ZodNumber
    >,
  )
  .strict()
  .refine((values) => Object.values(values).reduce((sum, value) => sum + value, 0) === 100);
const settingsPatch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("channels"), ids: z.array(z.string().regex(/^\d{17,20}$/)).max(25) }).strict(),
  z.object({ action: z.literal("idle"), enabled: z.boolean(), frequency }).strict(),
  z.object({ action: z.literal("active"), enabled: z.boolean(), frequency }).strict(),
  z.object({ action: z.literal("planner"), model: model.nullable() }).strict(),
  z
    .object({ action: z.literal("checker"), model: model.extend({ kind: z.enum(["llm", "decision"]) }).nullable() })
    .strict(),
  z.object({ action: z.literal("heat"), offset: heatOffset }).strict(),
  z.object({ action: z.literal("weights"), weights }).strict(),
]);
const studioTarget = { category: categorySchema, key: z.string().min(1).max(100) };
const form = z
  .object({
    title: z.string().max(CUSTOM_IDLE_NUDGE_TITLE_MAX),
    brief: z.string().max(CUSTOM_IDLE_NUDGE_BRIEF_MAX),
    agendaHint: z.string().max(CUSTOM_IDLE_NUDGE_AGENDA_HINT_MAX),
    prerequisites: z.array(z.string().max(64)).max(CUSTOM_IDLE_NUDGE_LIST_MAX),
    recommendedTools: z.array(z.string().max(64)).max(CUSTOM_IDLE_NUDGE_LIST_MAX),
  })
  .strict();
const studioPatch = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), category: categorySchema, form }).strict(),
  z.object({ action: z.literal("edit"), ...studioTarget, form, revision: z.string().max(8).optional() }).strict(),
  z
    .object({
      action: z.literal("availability"),
      ...studioTarget,
      enabled: z.boolean(),
      scope: z.array(z.number().int().positive()).nullable(),
    })
    .strict(),
  z.object({ action: z.literal("remove"), ...studioTarget }).strict(),
]);
type Category = z.infer<typeof categorySchema>;
const chatState = (snapshot: DashboardGuildSnapshot) =>
  snapshot.rawPersonas.find((persona) => !persona.is_alter) ?? snapshot.rawPersonas[0] ?? null;

function fail(result: string): never {
  const status = result === "invalid" ? 422 : result === "limit" || result === "stale" ? 409 : 500;
  const keys: Record<string, string> = {
    invalid: "general.dashboard.interface_nudge_error_invalid",
    stale: "general.dashboard.interface_nudge_error_stale",
    limit: "general.dashboard.interface_nudge_error_limit",
  };
  throw new DashboardServiceError(
    `natural_nudge_${result}`,
    status,
    text(keys[result] ?? "general.dashboard.interface_nudge_error_write_failed"),
  );
}

function checkWrite(result: string) {
  if (result !== "success" && result !== "unchanged") fail(result);
}

export function parseNudgeCategory(value: unknown): Category {
  const parsed = categorySchema.safeParse(value);
  if (!parsed.success) fail("invalid");
  return parsed.data;
}

const formatNumber = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

function paceText(
  view: Awaited<ReturnType<typeof naturalNudgePanelDependencies.loadSettings>>,
  mode: "idle" | "active",
  enabled: boolean,
  level: 0 | 1 | 2 | 3,
) {
  const t = (key: string) => text(`commands.config.natural_nudges.${key}`);
  if (!enabled) return t(`${mode}_nudges_off`);
  if (!view.status?.effectiveChannelIds.length) return t(`${mode}_nudges_on_no_channels`);
  if (mode === "idle") {
    if (view.status.plannerModel.kind !== "ready") return t("idle_nudges_on_no_model");
    if (view.baseHeat < 1 || view.heat < 1) return t("frequency_effect_none");
    if (Object.values(view.config.category_weights).every((value) => value === 0))
      return text("commands.nudge-studio.idle_pace_no_types");
    return text("general.dashboard.interface_nudge_pace_idle", {
      per_week: formatNumber.format(Math.round(idleNudgesPerDay(view.heat, level) * 70) / 10),
      daily_cap: IDLE_NUDGE_DAILY_CAPS[level],
    });
  }
  if (!view.status.checker.model) return t("active_nudges_on_no_matcher");
  const range = activeNudgeTripRange(view.heat, level);
  if (view.baseHeat < 1 || !range) return t("active_nudges_on_cold");
  return text("general.dashboard.interface_nudge_pace_active", {
    ...range,
    check_cap: ACTIVE_NUDGE_DAILY_CHECK_CAPS[level],
    daily_cap: ACTIVE_NUDGE_DAILY_CAPS[level],
  });
}

export async function loadNaturalNudgeSettings(snapshot: DashboardGuildSnapshot, channels: ReadonlySet<string>) {
  const state = chatState(snapshot);
  const view = await naturalNudgePanelDependencies.loadSettings(snapshot.serverId, locale, state);
  const { config } = view;
  const selected = config.channel_disc_ids.filter((id) => channels.has(id));
  const providerLabel = (provider: string) =>
    providerOptionDisplayName(provider, locale) ?? getProviderDisplayName(provider);
  const textModels = view.plannerModels.flatMap(({ provider, models }) =>
    models.map(({ id, name }) => ({
      provider,
      providerLabel: providerLabel(provider),
      id,
      name,
      kind: "llm" as const,
    })),
  );
  const checkerModels = [
    ...view.checkerDecisionModels.flatMap(({ provider, models }) =>
      models.map(({ id, name }) => ({
        provider,
        providerLabel: providerLabel(provider),
        id,
        name,
        kind: "decision" as const,
      })),
    ),
    ...textModels,
  ];
  const storedSelection = (slot: "nudge-planner" | "nudge-checker", kind: "llm" | "decision", id: number | null) => {
    if (id === null) return null;
    const scope = state ? { kind: "server" as const, ownerId: snapshot.serverId, state } : null;
    const owner = scope ? getProviderOptions().find((option) => option.selection.owns?.(scope, slot)) : null;
    const options = slot === "nudge-planner" ? textModels : checkerModels;
    const choice = options.find(
      (option) => option.kind === kind && option.id === id && (!owner || option.provider === owner.value),
    );
    return { kind, id, provider: choice?.provider ?? owner?.value ?? "" };
  };
  return {
    channels: {
      selected,
      unavailable: config.channel_disc_ids.length - selected.length,
      automatic: !config.channel_disc_ids.length,
      effectiveCount: view.status?.effectiveChannelIds.filter((id) => channels.has(id)).length ?? 0,
    },
    idle: {
      enabled: config.idle_nudges_enabled,
      frequency: config.idle_nudge_frequency,
      pace: levels.map((level) => paceText(view, "idle", true, level)),
      off: paceText(view, "idle", false, 0),
    },
    active: {
      enabled: config.active_nudges_enabled,
      frequency: config.active_nudge_frequency,
      pace: levels.map((level) => paceText(view, "active", true, level)),
      off: paceText(view, "active", false, 0),
    },
    frequencies: levels.map((level) => nudgeFrequencyLabel(locale, level)),
    planner: {
      selected: storedSelection("nudge-planner", "llm", config.llm_id),
      resolved:
        view.status?.plannerModel.kind === "ready" && view.status.plannerModel.source === "chat"
          ? (view.status.chatModel?.codename ?? null)
          : null,
      options: textModels,
    },
    checker: {
      selected:
        config.checker_decision_model_id === null
          ? storedSelection("nudge-checker", "llm", config.checker_llm_id)
          : storedSelection("nudge-checker", "decision", config.checker_decision_model_id),
      resolved: view.status?.checker.model ?? null,
      options: checkerModels,
    },
    heat: {
      measured: view.baseHeat,
      effective: view.heat,
      offset: config.heat_offset,
      max: MAX_EFFECTIVE_HEAT,
      limit: NUDGE_HEAT_OFFSET_MAX,
    },
    weights: config.category_weights,
  };
}

export async function updateNaturalNudgeSettings(
  snapshot: DashboardGuildSnapshot,
  channels: ReadonlySet<string>,
  input: unknown,
) {
  const parsed = settingsPatch.safeParse(input);
  if (!parsed.success) fail("invalid");
  const patch = parsed.data;
  const serverId = snapshot.serverId;
  const operations = naturalNudgePanelDependencies.operations;
  switch (patch.action) {
    case "channels": {
      if (patch.ids.some((id) => !channels.has(id))) fail("invalid");
      const current = await naturalNudgePanelDependencies.loadServerConfig(serverId);
      const inaccessible = current.channel_disc_ids.filter((id) => !channels.has(id));
      checkWrite(await operations.setChannels(serverId, [...patch.ids, ...inaccessible]));
      break;
    }
    case "idle":
      checkWrite(
        await patchConfig(serverId, { idle_nudges_enabled: patch.enabled, idle_nudge_frequency: patch.frequency }),
      );
      break;
    case "active":
      checkWrite(
        await patchConfig(serverId, { active_nudges_enabled: patch.enabled, active_nudge_frequency: patch.frequency }),
      );
      break;
    case "planner":
    case "checker": {
      const state = chatState(snapshot);
      if (!state) fail("stale");
      checkWrite(
        patch.action === "planner"
          ? await operations.setPlannerModel(state, patch.model?.provider ?? "", patch.model?.id ?? null)
          : await operations.setCheckerModel(state, patch.model),
      );
      break;
    }
    case "heat":
      checkWrite(await patchConfig(serverId, { heat_offset: patch.offset }));
      break;
    case "weights":
      checkWrite(await patchConfig(serverId, { category_weights: patch.weights }));
      break;
  }
}

export async function loadNaturalNudgeStudio(snapshot: DashboardGuildSnapshot, category: Category) {
  const view = await loadNudgeStudioView(snapshot.serverId, category, snapshot.rawPersonas);
  const live = new Set(snapshot.personas.map(({ personaId }) => personaId));
  return {
    category,
    customCount: view.customCount,
    limit: CUSTOM_IDLE_NUDGE_LIMIT,
    implied: CATEGORY_IMPLIED_PREREQUISITES[category],
    requirements: Object.fromEntries(NUDGE_PREREQUISITE_IDS.map((key) => [key, prerequisiteLabel(locale, key)])),
    tools: Object.fromEntries(NUDGE_TOOL_NAMES.map((key) => [key, nudgeToolLabel(locale, key)])),
    entries: view.entries.map((entry) => {
      const { definition } = entry;
      const owner = definition.ownerPersonaId ?? null;
      const content = idleNudgeContentFromDefinition(definition);
      const required = content.prerequisites.filter((key) => key !== CATEGORY_IMPLIED_PREREQUISITES[category]);
      return {
        key: definition.key,
        source: definition.builtIn ? "builtin" : owner === null ? "server" : "persona",
        owner,
        title: studioEntryTitle(locale, entry),
        brief: content.brief,
        agenda: content.agenda_hint ?? "",
        prerequisites: required,
        recommended: content.recommended_tools,
        enabled: entry.enabled,
        scope: entry.scope?.filter((id) => live.has(id)) ?? null,
        blocker: entry.blocker ? nudgeBlockerLabel(locale, entry.blocker) : null,
        revision: owner === null ? undefined : computePersonaNudgeFingerprint(owner, content),
      };
    }),
  };
}

export async function updateNaturalNudgeStudio(snapshot: DashboardGuildSnapshot, input: unknown) {
  const parsed = studioPatch.safeParse(input);
  if (!parsed.success) fail("invalid");
  const patch = parsed.data;
  const { serverId, rawPersonas } = snapshot;
  if (patch.action === "add") {
    const created = await createCustomIdleNudge(serverId, patch.category, patch.form);
    if (typeof created !== "number") fail(created === "failed" ? "write-failed" : created);
    return { key: customIdleNudgeKey(created) };
  }
  const view = await loadNudgeStudioView(serverId, patch.category, rawPersonas, { judgeBlockers: false });
  const entry = view.entries.find(({ definition }) => definition.key === patch.key);
  if (!entry) fail("stale");
  const owner = entry.definition.ownerPersonaId;
  const localId = personaNudgeLocalId(entry.definition);
  const live = snapshot.personas.map(({ personaId }) => personaId);
  const operations = nudgeStudioOperations;
  if (patch.action === "availability") {
    if (owner !== undefined && localId !== null) {
      if (patch.scope !== null) fail("invalid");
      checkWrite(await operations.setPersonaIdleNudgeAvailability(patch.category, live, owner, localId, patch.enabled));
    } else {
      const ids = patch.scope && [...new Set(patch.scope)];
      if (ids?.some((id) => !live.includes(id)) || ids?.length === 0) fail("invalid");
      const scope = ids?.length && ids.length < live.length ? ids : null;
      const saved = await naturalNudgeRepository.saveIdleNudgeAvailability(
        serverId,
        entry.definition.key,
        entry.custom?.custom_idle_nudge_id ?? null,
        { enabled: patch.enabled, scope },
      );
      if (!saved) fail("write-failed");
      invalidateNaturalNudgeConfigCache(serverId);
    }
  } else if (patch.action === "edit") {
    if (entry.custom) {
      checkWrite(
        await operations.updateCustomIdleNudge(serverId, patch.category, entry.custom.custom_idle_nudge_id, patch.form),
      );
    } else if (owner !== undefined && localId !== null && patch.revision) {
      checkWrite(
        await operations.updatePersonaIdleNudge(patch.category, live, owner, localId, patch.revision, patch.form),
      );
    } else {
      fail("invalid");
    }
  } else {
    if (!entry.custom) fail("invalid");
    checkWrite(
      await operations.removeCustomIdleNudges(serverId, patch.category, [entry.custom.custom_idle_nudge_id], new Set()),
    );
  }
  return { key: patch.key };
}
