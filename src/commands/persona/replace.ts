/**
 * Persona Replace Command
 * Replaces one existing persona's character definition while preserving identity.
 */

import type {
  ChatInputCommandInteraction,
  Client,
  ModalSubmitInteraction,
  SlashCommandSubcommandBuilder,
} from "discord.js";
import { AttachmentBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from "discord.js";
import { lorebookRepository } from "@/modules/lorebooks/db/repositories";
import type { LorebookEntryRow } from "@/modules/lorebooks/db/types";
import { promptWithConfirmation } from "@/utils/discord/ui/confirmation";
import type { TomoriPresetRow, UserRow } from "@/types/db/schema";
import type { SelectOption } from "@/types/discord/modal";
import { invalidatePersonaSpriteCache } from "@/utils/cache/personaSpriteCache";
import { invalidateTomoriStateCache } from "@/utils/cache/tomoriStateCache";
import { configRepository, personaRepository, personaSpriteRepository } from "@/utils/db/repositories";
import { replyInfoEmbed } from "@/utils/discord/ui/embeds";
import { promptWithPaginatedModal, safeSelectOptionText } from "@/utils/discord/ui/modals";
import { getPresetAvatarBuffer } from "@/utils/image/avatarHelper";
import { convertToPNG } from "@/utils/image/imageProcessor";
import { ColorCode, log } from "@/utils/misc/logger";
import { IMPORT_LIMITS, memoryGuard, reserveImportQuota } from "@/utils/security/rateLimiter";
import { safeDownload } from "@/utils/security/safeDownload";
import {
  deletePersonaAvatarFromStorage,
  deletePersonaSpriteFromStorage,
  uploadPersonaAvatarToStorage,
} from "@/utils/storage/avatarStorage";
import { getBaseTriggerWords, localizer } from "@/utils/text/localizer";
import { dedupeTriggerWords } from "@/utils/text/triggerWords";
import { resolvePersonaCardFile, type PersonaCardResolution } from "@/utils/persona/resolvePersonaCardFile";

const MODAL_CUSTOM_ID = "persona_replace_modal";
const SOURCE_SELECT_ID = "source_persona";
const PRESET_SELECT_ID = "replacement_preset";
const MAX_FILE_SIZE = IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB * 1024 * 1024;
const MAX_DEBUG_BYTES = 1_000_000;

type IdentitySyncResult = {
  nicknameUpdated: boolean;
  avatarUpdated: boolean;
};

export const configureSubcommand = (subcommand: SlashCommandSubcommandBuilder) =>
  subcommand
    .setName("replace")
    .setDescription(localizer("en-US", "commands.persona.replace.description"))
    .addAttachmentOption((option) =>
      option
        .setName("file")
        .setDescription(localizer("en-US", "commands.persona.replace.file_description"))
        .setRequired(false),
    )
    .addStringOption((option) =>
      option
        .setName("lorebook")
        .setDescription(localizer("en-US", "commands.persona.replace.lorebook_description"))
        .addChoices(
          { name: localizer("en-US", "commands.persona.replace.preserve_option"), value: "preserve" },
          { name: localizer("en-US", "commands.persona.replace.import_option"), value: "import" },
          { name: localizer("en-US", "commands.persona.replace.clear_option"), value: "clear" },
        ),
    );

function presetTriggerWords(preset: TomoriPresetRow, locale: string): string[] {
  const configured = preset.preset_trigger_words ?? [];
  return dedupeTriggerWords(configured.length > 0 ? configured : getBaseTriggerWords(locale), { lowercase: false });
}

function localizeImportError(locale: string, error: string): string {
  const [key, ...parts] = error.split("|");
  if (key === "commands.persona.import.error_incompatible_version") {
    return localizer(locale, key, { expected: parts[0], actual: parts[1] });
  }
  if (key === "commands.persona.import.error_invalid_type") {
    return localizer(locale, key, { type: parts[0] });
  }
  if (
    key === "commands.persona.import.error_invalid_attribute" ||
    key === "commands.persona.import.error_invalid_dialogue_in" ||
    key === "commands.persona.import.error_invalid_dialogue_out" ||
    key === "commands.persona.import.error_invalid_trigger_word"
  ) {
    return localizer(locale, key, { details: parts[0] });
  }
  return localizer(locale, key);
}

function truncateDebugText(text: string): Buffer {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= MAX_DEBUG_BYTES) return buffer;

  const notice = Buffer.from("\n\n[Truncated: decoded payload exceeded attachment size budget.]", "utf8");
  return Buffer.concat([buffer.subarray(0, MAX_DEBUG_BYTES - notice.length), notice]);
}

async function replyCardError(
  interaction: ModalSubmitInteraction,
  locale: string,
  resolution: Extract<PersonaCardResolution, { ok: false }>,
): Promise<void> {
  if (resolution.reason === "conversion_failed" && resolution.debugText) {
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(localizer(locale, "commands.persona.replace.conversion_failed_title"))
          .setDescription(localizer(locale, "commands.persona.replace.conversion_failed_description"))
          .setColor(ColorCode.WARN),
      ],
      files: [
        new AttachmentBuilder(truncateDebugText(resolution.debugText), {
          name: `persona-replace-${resolution.source ?? "card"}-debug-${Date.now()}.txt`,
        }),
      ],
    });
    return;
  }

  const description =
    resolution.reason === "invalid_png"
      ? localizer(locale, "commands.persona.import.invalid_png_description")
      : resolution.reason === "missing_metadata"
        ? localizer(locale, "commands.persona.import.no_metadata_description")
        : resolution.reason === "invalid_json"
          ? localizer(locale, "commands.persona.import.error_not_json")
          : resolution.validationError
            ? localizeImportError(locale, resolution.validationError)
            : localizer(locale, "commands.persona.import.invalid_file_description");

  await replyInfoEmbed(interaction, locale, {
    titleKey: "commands.persona.replace.invalid_file_title",
    description,
    color: ColorCode.ERROR,
  });
}

async function syncMainIdentity(
  interaction: ChatInputCommandInteraction,
  nickname: string,
  avatarBuffer: Buffer | null | undefined,
): Promise<IdentitySyncResult> {
  const result: IdentitySyncResult = {
    nicknameUpdated: false,
    avatarUpdated: avatarBuffer === undefined,
  };

  try {
    await interaction.guild?.members.me?.setNickname(nickname);
    result.nicknameUpdated = true;
  } catch (error) {
    log.warn(`Failed to update the guild nickname during persona replacement: ${String(error)}`);
  }

  if (avatarBuffer === undefined) return result;

  try {
    const avatar = avatarBuffer
      ? `data:image/png;base64,${(await convertToPNG(avatarBuffer)).toString("base64")}`
      : null;
    const response = await fetch(`https://discord.com/api/v10/guilds/${interaction.guildId}/members/@me`, {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ avatar }),
    });
    result.avatarUpdated = response.ok;
    if (!response.ok) {
      log.warn(
        `Failed to update the guild avatar during persona replacement: ${response.status} ${response.statusText}`,
      );
    }
  } catch (error) {
    log.warn(`Failed to update the guild avatar during persona replacement: ${String(error)}`);
  }

  return result;
}

export async function execute(
  _client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  locale: string,
): Promise<void> {
  let responseInteraction: ChatInputCommandInteraction | ModalSubmitInteraction = interaction;

  try {
    if (!interaction.guild) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.guild_only_title",
        descriptionKey: "general.errors.guild_only_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!(interaction.memberPermissions?.has("Administrator") ?? false)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.replace.no_permission_title",
        descriptionKey: "commands.persona.replace.no_permission_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const attachment = interaction.options.getAttachment("file");
    const lorebookMode = interaction.options.getString("lorebook") ?? "preserve";
    if (!["preserve", "import", "clear"].includes(lorebookMode) || (lorebookMode === "import" && !attachment)) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.replace.invalid_file_title",
        descriptionKey: "commands.persona.replace.lorebook_missing_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (attachment) {
      const normalizedName = attachment.name.toLowerCase();
      if (!normalizedName.endsWith(".png") && !normalizedName.endsWith(".json")) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.persona.replace.invalid_file_title",
          descriptionKey: "commands.persona.import.invalid_file_type_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (attachment.size > MAX_FILE_SIZE) {
        await replyInfoEmbed(interaction, locale, {
          titleKey: "commands.persona.import.file_too_large_title",
          descriptionKey: "commands.persona.import.file_too_large_description",
          color: ColorCode.ERROR,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    const allPersonas = await personaRepository.loadAllForServer(interaction.guild.id);
    if (allPersonas.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "general.errors.tomori_not_setup_title",
        descriptionKey: "general.errors.tomori_not_setup_description",
        color: ColorCode.ERROR,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const presets = attachment ? [] : ((await configRepository.loadPresetRowsByLocale(locale, { nsfw: false })) ?? []);
    if (!attachment && presets.length === 0) {
      await replyInfoEmbed(interaction, locale, {
        titleKey: "commands.persona.default.no_presets_title",
        descriptionKey: "commands.persona.default.no_presets_description",
        color: ColorCode.WARN,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sourceOptions: SelectOption[] = allPersonas.flatMap((persona) =>
      persona.persona_id
        ? [
            {
              label: safeSelectOptionText(persona.persona_nickname),
              value: String(persona.persona_id),
              description: localizer(
                locale,
                persona.is_alter
                  ? "commands.persona.replace.alter_persona_description"
                  : "commands.persona.replace.main_persona_description",
              ),
            },
          ]
        : [],
    );
    const presetOptions: SelectOption[] = presets.map((preset) => ({
      label: safeSelectOptionText(preset.persona_preset_name),
      value: String(preset.persona_preset_id),
      description: safeSelectOptionText(preset.persona_preset_desc),
    }));

    const modalResult = await promptWithPaginatedModal(interaction, locale, {
      modalCustomId: MODAL_CUSTOM_ID,
      modalTitleKey: "commands.persona.replace.modal_title",
      components: [
        {
          customId: SOURCE_SELECT_ID,
          labelKey: "commands.persona.replace.source_label",
          descriptionKey: "commands.persona.replace.source_description",
          placeholder: "commands.persona.replace.source_placeholder",
          required: true,
          options: sourceOptions,
        },
        ...(!attachment
          ? [
              {
                customId: PRESET_SELECT_ID,
                labelKey: "commands.persona.replace.preset_label",
                descriptionKey: "commands.persona.replace.preset_description",
                placeholder: "commands.persona.replace.preset_placeholder",
                required: true,
                options: presetOptions,
              },
            ]
          : []),
      ],
    });
    if (modalResult.outcome !== "submit" || !modalResult.interaction) return;

    const modalInteraction = modalResult.interaction;
    responseInteraction = modalInteraction;
    await modalInteraction.deferReply({ flags: MessageFlags.Ephemeral });

    const sourcePersonaId = Number(modalResult.values?.[SOURCE_SELECT_ID]);
    const sourcePersona = allPersonas.find((persona) => persona.persona_id === sourcePersonaId);
    if (!sourcePersona?.persona_id) {
      await replyInfoEmbed(modalInteraction, locale, {
        titleKey: "commands.persona.replace.invalid_selection_title",
        descriptionKey: "commands.persona.replace.invalid_selection_description",
        color: ColorCode.ERROR,
      });
      return;
    }

    let replacementName: string;
    let replacementAvatar: Buffer | null | undefined;
    let replacementKind: "preset" | "file";
    let uploadedAvatarUrl: string | null | undefined;
    let previousSprites = await personaSpriteRepository.listForPersona(sourcePersonaId);
    const replacementSource = sourcePersona;
    const guild = interaction.guild;
    let confirmedLorebook: LorebookEntryRow[] | undefined;

    async function confirmReplacement(replacement: string, entryCount: number): Promise<boolean> {
      const lineageId = Number(replacementSource.persona_lineage_id);
      let existingCount = 0;
      if (lorebookMode !== "preserve") {
        const book = await lorebookRepository.listScope(replacementSource.server_id, lineageId);
        if (book.status !== "fresh") {
          await replyInfoEmbed(modalInteraction, locale, {
            titleKey: "general.errors.update_failed_title",
            descriptionKey: "general.errors.update_failed_description",
            color: ColorCode.ERROR,
          });
          return false;
        }
        existingCount = book.entries.length;
        confirmedLorebook = book.entries;
      }
      const shared = allPersonas.filter((persona) => Number(persona.persona_lineage_id) === lineageId);
      const confirmation = await promptWithConfirmation(modalInteraction, locale, {
        embedTitleKey: "commands.persona.replace.confirm_title",
        embedDescriptionKey: "commands.persona.replace.confirm_description",
        embedDescriptionVars: {
          source: replacementSource.persona_nickname,
          replacement,
          lorebook: localizer(locale, `commands.persona.replace.lorebook_${lorebookMode}_receipt`, {
            existing: existingCount,
            count: entryCount,
          }),
          shared:
            lorebookMode === "preserve"
              ? ""
              : localizer(locale, "commands.persona.replace.shared_lorebook_warning", {
                  count: shared.length,
                  lineage: lineageId,
                }),
        },
        continueLabelKey: "commands.persona.replace.confirm_button",
        cancelLabelKey: "general.pagination.cancel",
        continueCustomId: `persona_replace_confirm_${interaction.id}`,
        cancelCustomId: `persona_replace_cancel_${interaction.id}`,
        continueStyle: ButtonStyle.Danger,
        timeout: 60_000,
      });
      if (confirmation.outcome !== "continue") return false;
      await modalInteraction.editReply({ components: [] });
      const member = await guild.members.fetch(interaction.user.id);
      if (!member.permissions.has("Administrator")) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "commands.persona.replace.no_permission_title",
          descriptionKey: "commands.persona.replace.no_permission_description",
          color: ColorCode.ERROR,
        });
        return false;
      }
      const current = (await personaRepository.loadAllForServer(guild.id)).find(
        (persona) => persona.persona_id === sourcePersonaId,
      );
      if (
        !current ||
        current.server_id !== replacementSource.server_id ||
        Number(current.persona_lineage_id) !== lineageId
      ) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "commands.persona.replace.invalid_selection_title",
          descriptionKey: "commands.persona.replace.invalid_selection_description",
          color: ColorCode.ERROR,
        });
        return false;
      }
      previousSprites = await personaSpriteRepository.listForPersona(sourcePersonaId);
      return true;
    }

    if (attachment) {
      const quota = reserveImportQuota(interaction.user.id);
      if (!quota.allowed) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "rate_limit.error_quota_exceeded_title",
          descriptionKey: "rate_limit.error_quota_exceeded_description",
          descriptionVars: {
            reset_time: quota.resetAt ? new Date(quota.resetAt).toLocaleString(locale) : "unknown",
          },
          color: ColorCode.ERROR,
        });
        return;
      }
      if (memoryGuard.checkMemory().status === "critical") {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "rate_limit.error_memory_critical_title",
          descriptionKey: "rate_limit.error_memory_critical_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      const download = await safeDownload(attachment.url, {
        maxSizeMB: IMPORT_LIMITS.MAX_PERSONA_IMPORT_SIZE_MB,
        timeoutMs: 15_000,
        knownSize: attachment.size,
      });
      if (!download.success || !download.buffer) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "commands.persona.import.download_failed_title",
          descriptionKey: "commands.persona.import.download_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      const resolved = resolvePersonaCardFile(attachment.name, download.buffer, MAX_FILE_SIZE);
      if (!resolved.ok) {
        await replyCardError(modalInteraction, locale, resolved);
        return;
      }
      replacementName = resolved.presetData.tomori_nickname;
      replacementAvatar = resolved.avatarImageBuffer;
      replacementKind = "file";
      if (resolved.presetData.is_nsfw) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "commands.persona.replace.invalid_file_title",
          descriptionKey: "commands.persona.replace.nsfw_card_description",
          color: ColorCode.ERROR,
        });
        return;
      }
      if (lorebookMode === "import" && resolved.presetData.lorebook_entries === undefined) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "commands.persona.replace.invalid_file_title",
          descriptionKey: "commands.persona.replace.lorebook_missing_description",
          color: ColorCode.ERROR,
        });
        return;
      }

      if (
        allPersonas.some(
          (persona) =>
            persona.persona_id !== sourcePersonaId &&
            persona.persona_nickname.trim().toLowerCase() === replacementName.trim().toLowerCase(),
        )
      ) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "commands.persona.name_conflict_title",
          descriptionKey: "commands.persona.name_conflict_description",
          descriptionVars: { name: replacementName },
          color: ColorCode.ERROR,
        });
        return;
      }

      if (!(await confirmReplacement(replacementName, resolved.presetData.lorebook_entries?.length ?? 0))) return;

      if (replacementAvatar) {
        uploadedAvatarUrl = await uploadPersonaAvatarToStorage({
          personaId: sourcePersonaId,
          serverDiscId: interaction.guild.id,
          label: "persona replacement",
          buffer: await convertToPNG(replacementAvatar),
        });
        if (!uploadedAvatarUrl) {
          await replyInfoEmbed(modalInteraction, locale, {
            titleKey: "general.errors.update_failed_title",
            descriptionKey: "general.errors.update_failed_description",
            color: ColorCode.ERROR,
          });
          return;
        }
      }

      const replaced = await personaRepository.replaceCharacterFromCard({
        personaId: sourcePersonaId,
        serverId: sourcePersona.server_id,
        card: resolved.presetData,
        expectedLineageId: Number(sourcePersona.persona_lineage_id),
        expectedLorebookEntries: confirmedLorebook,
        lorebookEntries:
          lorebookMode === "clear" ? [] : lorebookMode === "import" ? resolved.presetData.lorebook_entries : undefined,
        // JSON cards have no image bytes. Persist the currently resolved avatar
        // explicitly so materializing an official pointer does not lose its art.
        avatarUrl: replacementAvatar === null ? sourcePersona.webhook_avatar_url : uploadedAvatarUrl,
      });
      if (!replaced) {
        if (uploadedAvatarUrl) await deletePersonaAvatarFromStorage(uploadedAvatarUrl);
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }
    } else {
      const presetId = Number(modalResult.values?.[PRESET_SELECT_ID]);
      const selectedPreset = presets.find((preset) => preset.persona_preset_id === presetId);
      if (!selectedPreset) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "commands.persona.replace.invalid_selection_title",
          descriptionKey: "commands.persona.replace.invalid_selection_description",
          color: ColorCode.ERROR,
        });
        return;
      }
      replacementName = selectedPreset.persona_preset_name;
      replacementAvatar = await getPresetAvatarBuffer(selectedPreset);
      replacementKind = "preset";

      if (
        allPersonas.some(
          (persona) =>
            persona.persona_id !== sourcePersonaId &&
            persona.persona_nickname.trim().toLowerCase() === replacementName.trim().toLowerCase(),
        )
      ) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "commands.persona.name_conflict_title",
          descriptionKey: "commands.persona.name_conflict_description",
          descriptionVars: { name: replacementName },
          color: ColorCode.ERROR,
        });
        return;
      }

      if (!(await confirmReplacement(replacementName, 0))) return;

      const lineageId = Number(sourcePersona.persona_lineage_id);
      if (!Number.isSafeInteger(lineageId) || lineageId <= 0) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }
      const replaced = await personaRepository.applyPresetPointerToPersona({
        personaId: sourcePersonaId,
        nickname: replacementName,
        preset: selectedPreset,
        personaLineageId: lineageId,
        expectedServerId: sourcePersona.server_id,
        expectedLineageId: lineageId,
        expectedLorebookEntries: confirmedLorebook,
        lorebookEntries: lorebookMode === "clear" ? [] : undefined,
        triggerWords: presetTriggerWords(selectedPreset, locale),
        personaPrompt: selectedPreset.persona_preset_desc,
      });
      if (!replaced) {
        await replyInfoEmbed(modalInteraction, locale, {
          titleKey: "general.errors.update_failed_title",
          descriptionKey: "general.errors.update_failed_description",
          color: ColorCode.ERROR,
        });
        return;
      }
    }

    await Promise.all(previousSprites.map((sprite) => deletePersonaSpriteFromStorage(sprite.avatar_url)));
    if (
      sourcePersona.webhook_avatar_url &&
      (replacementKind === "preset" ||
        (uploadedAvatarUrl !== undefined && uploadedAvatarUrl !== sourcePersona.webhook_avatar_url))
    ) {
      await deletePersonaAvatarFromStorage(sourcePersona.webhook_avatar_url);
    }

    invalidateTomoriStateCache(interaction.guild.id);
    invalidatePersonaSpriteCache(sourcePersonaId);

    let identitySync: IdentitySyncResult | null = null;
    if (!sourcePersona.is_alter) {
      identitySync = await syncMainIdentity(interaction, replacementName, replacementAvatar ?? undefined);
      if (replacementKind === "preset" && identitySync.avatarUpdated) {
        await personaRepository.markServerMainAvatarSynced(interaction.guild.id);
      }
    }

    const descriptionLines = [
      localizer(locale, "commands.persona.replace.success_description", {
        source: sourcePersona.persona_nickname,
        replacement: replacementName,
      }),
      localizer(locale, "commands.persona.replace.identity_preserved_description"),
      localizer(locale, `commands.persona.replace.lorebook_${lorebookMode}_success`),
    ];
    if (replacementKind === "file") {
      descriptionLines.push(localizer(locale, "commands.persona.replace.file_sprites_removed_description"));
      if (replacementAvatar === null) {
        descriptionLines.push(localizer(locale, "commands.persona.replace.avatar_preserved_description"));
      }
    }
    if (identitySync && (!identitySync.nicknameUpdated || !identitySync.avatarUpdated)) {
      descriptionLines.push(localizer(locale, "commands.persona.replace.identity_sync_warning"));
    }

    await replyInfoEmbed(modalInteraction, locale, {
      titleKey: "commands.persona.replace.success_title",
      description: descriptionLines.join("\n\n"),
      color:
        identitySync && (!identitySync.nicknameUpdated || !identitySync.avatarUpdated)
          ? ColorCode.WARN
          : ColorCode.SUCCESS,
    });

    log.success(
      `Replaced character definition for persona ${sourcePersonaId} in guild ${interaction.guild.id} with ${replacementKind} "${replacementName}" while preserving lineage ${sourcePersona.persona_lineage_id}`,
    );
  } catch (error) {
    log.error("Error executing persona replace command:", error, {
      errorType: "CommandExecutionError",
      metadata: { commandName: "persona replace" },
    });
    await replyInfoEmbed(responseInteraction, locale, {
      titleKey: "general.errors.unknown_error_title",
      descriptionKey: "general.errors.unknown_error_description",
      color: ColorCode.ERROR,
      flags: MessageFlags.Ephemeral,
    });
  }
}
