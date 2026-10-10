/**
 * @crystal/bot — build bots for Crystal.
 *
 * ```ts
 * import { Client, Events, EmbedBuilder } from "@crystal/bot";
 *
 * const client = new Client();            // reads CRYSTAL_BOT_TOKEN and CRYSTAL_SIGNING_SECRET
 * client.on(Events.Ready, (c) => console.log(`Online as ${c.user?.name}`));
 * client.on(Events.MessageCreate, async (message) => {
 *   if (message.fromBot) return;
 *   if (message.content === "!ping") await message.reply({ embeds: [new EmbedBuilder().setTitle("Pong")] });
 * });
 * await client.login();
 * await client.listen();
 * ```
 */
export { Client, DEFAULT_API_URL, Events, type ClientEvents, type ClientOptions } from "./client";
export { ActionRowBuilder, ButtonBuilder, EmbedBuilder } from "./builders";
export { defineButton, defineCommand, defineEvent, type ButtonHandler, type CommandHandler, type EventHandler, type LoadedHandlers } from "./handlers";
export {
  ButtonInteraction,
  Channel,
  Collection,
  CommandInteraction,
  Community,
  Emoji,
  Member,
  Message,
  Reaction,
  Role,
  Sound,
  User,
  everyone,
  roleMention,
  userMention,
  type EmbedLike,
  type Interaction,
  type MessageOptions,
  type RowLike,
} from "./structures";
export { PermissionFlags, Permissions, type PermissionName } from "./permissions";
export { ActivityType, type ActivityOptions, type PresenceOptions, type StatusName } from "./presence";
export { BuiltinSounds, VoiceConnection, readWav, toMono48k, type BuiltinSoundName, type PcmAudio } from "./voice";
export { CrystalAPIError, CrystalError } from "./errors";
export { CRYSTAL_ORIGIN, inviteUrl, type InviteOptions } from "./invite";
export { REST } from "./rest";
export { verifySignature } from "./signature";
export type { FileInput } from "./files";
export type * from "./types";
