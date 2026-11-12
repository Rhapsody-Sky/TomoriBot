import { z } from "zod";
import { logitBiasEntrySchema, type LogitBiasEntry } from "@/types/provider/logitBias";
import { personaRepository } from "@/utils/db/repositories";
import {
  configModelOperations,
  loadConfigModelChoices,
  loadConfigModelProviders,
} from "@/utils/discord/interactions/configModelOperations";
import { isCustomProvider } from "@/utils/provider/customProviderUtils";
import { getProviderDisplayName } from "@/utils/provider/providerInfoRegistry";
import { findProviderOption, findProviderOptionByActiveProvider } from "@/utils/provider/providerOptionRegistry";
import { localizer } from "@/utils/text/localizer";
import { DashboardServiceError } from "./errors";
import type { DashboardGuildSnapshot } from "./types";

const slots = [
  ["decision", "decision", "decision"],
  ["speech_design", "tts-design", "speech-design"],
  ["speech_clone", "tts-clone", "speech-clone"],
] as const;

const selectionSchema = z
  .object({ provider: z.string().trim().toLowerCase().min(1).max(120), modelId: z.number().int().positive() })
  .strict()
  .nullable()
  .optional();
const slotSchema = z
  .object({
    decision: selectionSchema,
    speech_design: selectionSchema,
    speech_clone: selectionSchema,
  })
  .strict();

const logitChangeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), terms: z.string().max(4_000), bias: z.string().max(32) }).strict(),
  z.object({ action: z.literal("import"), payload: z.unknown() }).strict(),
]);

async function loadCurrentState(snapshot: DashboardGuildSnapshot) {
  const state = await personaRepository.loadState(snapshot.serverDiscordId);
  if (!state || state.server_id !== snapshot.serverId) {
    throw new DashboardServiceError(
      "server_model_workspace_unavailable",
      404,
      localizer("en-US", "general.dashboard.server_model_workspace_unavailable"),
    );
  }
  return state;
}

export async function loadAdvancedServerModels(snapshot: DashboardGuildSnapshot) {
  const { config, serverId, rawPersonas } = snapshot;
  const state = rawPersonas.find((persona) => !persona.is_alter) ?? rawPersonas[0];
  const scope = { kind: "server" as const, ownerId: serverId, state };
  return Promise.all(
    slots.map(async ([kind, capability, optionCapability]) => {
      const providers = await loadConfigModelProviders(serverId, capability);
      const options = (
        await Promise.all(
          providers.map(async (provider) =>
            (
              await loadConfigModelChoices(serverId, capability, provider)
            ).map(({ id, name }) => ({
              id,
              provider,
              label: `${getProviderDisplayName(provider)} / ${name}`,
            })),
          ),
        )
      )
        .flat()
        .sort((left, right) => left.label.localeCompare(right.label));

      const endpointId =
        kind === "decision"
          ? null
          : kind === "speech_design"
            ? config.speech_design_endpoint_id
            : config.speech_clone_endpoint_id;
      const modelId =
        endpointId ??
        (kind === "decision"
          ? config.decision_model_id
          : kind === "speech_design"
            ? config.speech_design_model_id
            : config.speech_clone_model_id);
      const active = options.find((option) => {
        if (
          option.id !== modelId ||
          (kind !== "decision" && isCustomProvider(option.provider) !== (endpointId != null))
        )
          return false;
        const catalog = findProviderOption(option.provider)?.catalogProvider ?? option.provider;
        const owner = findProviderOptionByActiveProvider(catalog, scope, optionCapability)?.value ?? catalog;
        return option.provider === owner;
      });
      return { kind, options, selected: modelId == null ? null : { provider: active?.provider ?? null, modelId } };
    }),
  );
}

export async function setAdvancedServerModel(snapshot: DashboardGuildSnapshot, value: unknown) {
  const parsed = slotSchema.safeParse(value);
  const slot = parsed.success ? slots.find(([kind]) => parsed.data[kind] !== undefined) : undefined;
  if (!parsed.success || !slot || Object.keys(parsed.data).length !== 1) {
    throw new DashboardServiceError(
      "invalid_server_model",
      422,
      localizer("en-US", "general.dashboard.advanced_model_unavailable"),
    );
  }
  const [kind, capability] = slot;
  const selection = parsed.data[kind];
  const input = { tomoriState: await loadCurrentState(snapshot), serverDiscId: snapshot.serverDiscordId, capability };
  const result = selection
    ? await configModelOperations.setCapabilityModel({ ...input, ...selection })
    : await configModelOperations.clearCapabilityModel(input);
  if (result.status === "success" || result.status === "already-selected" || result.status === "already-clear") return;
  throw new DashboardServiceError(
    "advanced_model_save_failed",
    result.status === "write-failed" ? 500 : 422,
    result.status === "write-failed"
      ? localizer("en-US", "general.dashboard.advanced_model_save_failed")
      : localizer("en-US", "general.dashboard.advanced_model_unavailable"),
  );
}

export function serializeLogitBias(entries: readonly LogitBiasEntry[]) {
  return entries.map(({ id, text, value, kind }) => ({ id, text, value, kind }));
}

export async function saveServerLogitBias(snapshot: DashboardGuildSnapshot, value: unknown) {
  const parsed = logitChangeSchema.safeParse(value);
  if (!parsed.success)
    throw new DashboardServiceError("invalid_logit_bias", 422, localizer("en-US", "general.dashboard.logit_invalid"));
  const input = { tomoriState: await loadCurrentState(snapshot), serverDiscId: snapshot.serverDiscordId };
  const change = parsed.data;
  const result =
    change.action === "add"
      ? await configModelOperations.addLogitBias({ ...input, rawTerms: change.terms, rawBias: change.bias })
      : await configModelOperations.uploadLogitBias({ ...input, payload: change.payload });
  switch (result.status) {
    case "success":
      return serializeLogitBias((await loadCurrentState(snapshot)).config.llm_logit_biases ?? []);
    case "no-changes":
      return serializeLogitBias(input.tomoriState.config.llm_logit_biases ?? []);
    case "empty-terms":
      throw new DashboardServiceError(
        "invalid_logit_bias",
        422,
        localizer("en-US", "commands.config.panel.logit_empty_detail"),
      );
    case "term-too-long":
      throw new DashboardServiceError(
        "invalid_logit_bias",
        422,
        localizer("en-US", "commands.config.panel.logit_term_long_detail"),
      );
    case "invalid-bias":
      throw new DashboardServiceError(
        "invalid_logit_bias",
        422,
        localizer("en-US", "commands.config.panel.logit_invalid_bias_detail"),
      );
    case "invalid-file":
      throw new DashboardServiceError(
        "invalid_logit_bias",
        422,
        localizer("en-US", "commands.config.panel.logit_upload_invalid_detail"),
      );
    default:
      throw new DashboardServiceError(
        "logit_bias_write_failed",
        500,
        localizer("en-US", "general.dashboard.logit_write_failed"),
      );
  }
}

export async function removeServerLogitBias(snapshot: DashboardGuildSnapshot, id: string) {
  if (!logitBiasEntrySchema.shape.id.safeParse(id).success)
    throw new DashboardServiceError("invalid_logit_bias", 422, localizer("en-US", "general.dashboard.logit_invalid"));
  const tomoriState = await loadCurrentState(snapshot);
  const result = await configModelOperations.removeLogitBias({
    tomoriState,
    serverDiscId: snapshot.serverDiscordId,
    presentedIds: [id],
    keptIds: [],
  });
  if (result.status === "stale")
    throw new DashboardServiceError("logit_bias_stale", 409, localizer("en-US", "general.dashboard.logit_stale"));
  if (result.status === "write-failed")
    throw new DashboardServiceError(
      "logit_bias_write_failed",
      500,
      localizer("en-US", "general.dashboard.logit_write_failed"),
    );
  return serializeLogitBias((tomoriState.config.llm_logit_biases ?? []).filter((entry) => entry.id !== id));
}
