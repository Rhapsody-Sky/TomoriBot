import type { ChatInputCommandInteraction, Client, SlashCommandBuilder } from "discord.js";
import { MessageFlags } from "discord.js";
import type { UserRow } from "@/types/db/schema";
import { getDashboardRuntimeConfig } from "@/web/dashboard/runtimeConfig";

export const configureCommand = (command: SlashCommandBuilder) =>
  command.setName("dashboard").setDescription("Open the TomoriBot settings dashboard");

export async function execute(
  client: Client,
  interaction: ChatInputCommandInteraction,
  _userData: UserRow,
  _locale: string,
): Promise<void> {
  const config = getDashboardRuntimeConfig(client);
  const content = config.enabled
    ? `[Open the TomoriBot dashboard](${config.publicUrl}/settings)`
    : "The TomoriBot dashboard is not enabled on this installation.";

  await interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
  });
}
