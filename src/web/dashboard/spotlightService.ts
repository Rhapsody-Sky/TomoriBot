import { z } from "zod";
import { userRepository } from "@/utils/db/repositories";
import { personalConfigOperations } from "@/utils/discord/interactions/personalConfigOperations";
import { localizer } from "@/utils/text/localizer";
import { DashboardServiceError } from "./errors";
import type { DashboardActor, DashboardGuildSnapshot } from "./types";

const channelIdSchema = z.string().regex(/^\d{17,20}$/);
const spotlightSchema = z
  .object({
    channelId: channelIdSchema,
    personaIds: z.array(z.number().int().positive()).min(1),
    autoTriggerPersonaId: z.number().int().positive().nullable(),
    durationHours: z.number().int().min(0).max(999_999).nullable(),
  })
  .strict();

export async function listPersonalSpotlights(actor: DashboardActor, snapshot: DashboardGuildSnapshot) {
  const rows = await userRepository.getActivePersonalSpotlightsForUser(snapshot.serverId, actor.user.user_id);
  return rows.map(({ channelDiscId, personaIds, autoTriggerPersonaId, expiresAt }) => ({
    channelId: channelDiscId,
    personaIds,
    autoTriggerPersonaId,
    expiresAt: expiresAt?.toISOString() ?? null,
  }));
}

export async function savePersonalSpotlight(
  actor: DashboardActor,
  snapshot: DashboardGuildSnapshot,
  visibleChannelIds: ReadonlySet<string>,
  value: unknown,
) {
  const parsed = spotlightSchema.safeParse(value);
  if (!parsed.success) {
    throw new DashboardServiceError(
      "invalid_spotlight",
      422,
      localizer("en-US", "general.dashboard.spotlight_invalid"),
    );
  }
  const { channelId, personaIds, autoTriggerPersonaId, durationHours } = parsed.data;
  if (!visibleChannelIds.has(channelId)) {
    throw new DashboardServiceError(
      "spotlight_channel_unavailable",
      403,
      localizer("en-US", "general.dashboard.interface_spotlight_channel_unavailable"),
    );
  }
  const selected = new Set(personaIds);
  const available = new Set(snapshot.personas.map(({ personaId }) => personaId));
  if (
    selected.size !== personaIds.length ||
    personaIds.some((id) => !available.has(id)) ||
    (autoTriggerPersonaId !== null && !selected.has(autoTriggerPersonaId))
  ) {
    throw new DashboardServiceError(
      "invalid_spotlight",
      422,
      localizer("en-US", "general.dashboard.spotlight_invalid"),
    );
  }
  let expiresAt = durationHours ? new Date(Date.now() + durationHours * 3_600_000) : null;
  if (durationHours === null) {
    const current = await userRepository.getPersonalSpotlightStatus(snapshot.serverId, actor.user.user_id, channelId);
    if (!current) {
      throw new DashboardServiceError(
        "spotlight_not_found",
        409,
        localizer("en-US", "general.dashboard.spotlight_expired"),
      );
    }
    expiresAt = current.expiresAt;
  }

  personaIds.sort((a, b) => a - b);
  const result = await personalConfigOperations.setSpotlight({
    serverId: snapshot.serverId,
    userId: actor.user.user_id,
    userDiscId: actor.discordId,
    channelId,
    personaIds,
    autoTriggerPersonaId,
    expiresAt,
  });
  if (result.status !== "success" && result.status !== "no-changes") {
    throw new DashboardServiceError(
      "spotlight_save_failed",
      500,
      localizer("en-US", "general.dashboard.spotlight_save_failed"),
    );
  }
  return { channelId, personaIds, autoTriggerPersonaId, expiresAt: expiresAt?.toISOString() ?? null };
}

export async function removePersonalSpotlight(
  actor: DashboardActor,
  snapshot: DashboardGuildSnapshot,
  channelId: unknown,
) {
  const parsed = channelIdSchema.safeParse(channelId);
  if (!parsed.success) {
    throw new DashboardServiceError(
      "invalid_spotlight",
      422,
      localizer("en-US", "general.dashboard.spotlight_invalid"),
    );
  }
  const result = await personalConfigOperations.removeSpotlights({
    serverId: snapshot.serverId,
    userId: actor.user.user_id,
    userDiscId: actor.discordId,
    channelIds: [parsed.data],
  });
  if (result.status !== "success" && result.status !== "no-changes") {
    throw new DashboardServiceError(
      "spotlight_remove_failed",
      500,
      localizer("en-US", "general.dashboard.spotlight_remove_failed"),
    );
  }
}
