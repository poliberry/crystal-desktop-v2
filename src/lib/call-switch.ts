/**
 * When joining a voice channel has to be confirmed first: you are in a call already (a DM call or another channel), and the
 * join would end it. Joining the channel you are already in, or any channel when you are in no call, needs no question.
 */
export type CallLike = { kind: "dm" } | { kind: "channel"; channelId: string };

export function needsSwitchConfirmation(current: CallLike | null | undefined, channelId: string): boolean {
  if (!current) return false;
  return !(current.kind === "channel" && current.channelId === channelId);
}
