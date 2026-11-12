import type { Guild } from "discord.js";
import { z } from "zod";
import { log } from "@/utils/misc/logger";
import { loadModerationScopeData, moderationOperations } from "@/utils/moderation/moderationOperations";
import { localizer } from "@/utils/text/localizer";
import { DashboardServiceError } from "./errors";

const snowflake = z.string().regex(/^\d{17,20}$/);
const actionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("addRole"), roleId: snowflake }),
  z.strictObject({ action: z.literal("removeRole"), roleId: snowflake }),
  z.strictObject({ action: z.literal("blockUser"), userId: snowflake }),
  z.strictObject({ action: z.literal("unblockUser"), userId: snowflake }),
  z.strictObject({
    action: z.literal("removePersonaBlock"),
    personaId: z.number().int().positive(),
    userId: z.string().min(1).max(512),
  }),
  z.strictObject({
    action: z.literal("quota"),
    quotaType: z.enum(["text", "image", "video"]),
    dailyUserQuota: z.number().int().min(0).max(100).optional(),
    serverwideQuota: z.number().int().min(0).max(99999).optional(),
    serverwideQuotaResetsIn: z.number().int().min(1).max(365).optional(),
  }),
]);

function moderationError(code: string, status: DashboardServiceError["status"], key = code) {
  return new DashboardServiceError(code, status, localizer("en-US", `general.dashboard.${key}`));
}

async function loadScope(guildId: string, serverId: number) {
  const scope = await loadModerationScopeData(guildId);
  if (!scope || scope.serverId !== serverId || scope.readStatus !== "fresh") {
    throw moderationError("moderation_unavailable", 503);
  }
  return scope;
}

export async function listModerationSettings(guild: Guild, serverId: number) {
  const scope = await loadScope(guild.id, serverId);
  const roles = await guild.roles.fetch();
  const memberName = (id: string) => guild.members.cache.get(id)?.displayName ?? null;
  return {
    roles: [...roles.values()]
      .filter((role) => role.id !== guild.id)
      .map(({ id, name }) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    allowedRoleIds: scope.whitelist.roles.map((role) => role.role_disc_id),
    serverBlocks: scope.userBlacklist.personalizationUserIds.map((userId) => ({ userId, name: memberName(userId) })),
    personaBlocks: scope.userBlacklist.personaBlocks.map((block) => ({
      userId: block.user_disc_id,
      name: memberName(block.user_disc_id),
      personaId: block.persona_id,
      personaName: block.persona_name,
      type: block.block_type,
      expiresAt: block.expires_at.toISOString(),
    })),
    quotas: scope.quotas,
  };
}

export async function updateModerationSettings(
  guildId: string,
  serverId: number,
  input: unknown,
  targets: { hasRole: (id: string) => Promise<boolean>; findMember: (id: string) => Promise<{ bot: boolean } | null> },
) {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw moderationError("moderation_invalid", 422);
  const data = parsed.data;
  const scope = await loadScope(guildId, serverId);
  const location = { guildId, serverId };
  switch (data.action) {
    case "addRole": {
      if (data.roleId === guildId || !(await targets.hasRole(data.roleId))) {
        throw moderationError("moderation_role_unavailable", 404);
      }
      const { status } = await moderationOperations.addWhitelistRole({ ...location, roleId: data.roleId });
      if (status === "failure") throw moderationError("moderation_save_failed", 500);
      break;
    }
    case "removeRole": {
      const { status } = await moderationOperations.removeWhitelistRole({ ...location, roleId: data.roleId });
      if (status === "failure") throw moderationError("moderation_save_failed", 500);
      break;
    }
    case "blockUser": {
      const member = await targets.findMember(data.userId);
      if (!member || member.bot) throw moderationError("moderation_member_unavailable", 404);
      const { status } = await moderationOperations.addUserToBlacklist({
        ...location,
        targetUserId: data.userId,
        isBot: member.bot,
      });
      if (status !== "success" && status !== "already_blacklisted") {
        throw moderationError("moderation_save_failed", 500);
      }
      break;
    }
    case "unblockUser": {
      const { status } = await moderationOperations.removeUserFromBlacklist({ ...location, targetUserId: data.userId });
      if (status === "failure") throw moderationError("moderation_save_failed", 500);
      break;
    }
    case "removePersonaBlock": {
      if (
        !scope.userBlacklist.personaBlocks.some(
          (block) => block.persona_id === data.personaId && block.user_disc_id === data.userId,
        )
      )
        break;
      const { status } = await moderationOperations.removePersonaUserBlock({
        ...location,
        personaId: data.personaId,
        targetUserId: data.userId,
      });
      if (status === "failure") throw moderationError("moderation_save_failed", 500);
      break;
    }
    case "quota": {
      const current = scope.quotas[data.quotaType];
      const dailyUserQuota = data.dailyUserQuota === current.daily_user_quota ? undefined : data.dailyUserQuota;
      const serverwideQuota = data.serverwideQuota === current.serverwide_quota ? undefined : data.serverwideQuota;
      const serverwideQuotaResetsIn =
        data.serverwideQuotaResetsIn === current.serverwide_quota_resets_in ? undefined : data.serverwideQuotaResetsIn;
      if (dailyUserQuota !== undefined || serverwideQuota !== undefined || serverwideQuotaResetsIn !== undefined) {
        const result = await moderationOperations.updateQuotaSettings({
          serverId,
          quotaType: data.quotaType,
          dailyUserQuota,
          serverwideQuota,
          serverwideQuotaResetsIn,
        });
        if (result.status === "invalid") throw moderationError("moderation_invalid", 422);
        if (result.status === "failed") {
          log.error("Dashboard moderation quota update failed", result.error, {
            metadata: { serverId, quotaType: data.quotaType },
          });
          throw moderationError("moderation_quota_failed", 500);
        }
      }
      return {
        quota: {
          daily_user_quota: dailyUserQuota ?? current.daily_user_quota,
          serverwide_quota: serverwideQuota ?? current.serverwide_quota,
          serverwide_quota_resets_in: serverwideQuotaResetsIn ?? current.serverwide_quota_resets_in,
        },
      };
    }
  }
  return { saved: true };
}
