/**
 * What a bot can be given in a community. The numbers are Crystal's own permission bits.
 *
 * A community manager chooses which of the ones your bot asks for to grant — and can only grant
 * what they hold themselves. Your bot then can only ever do what the person who authorised it can
 * still do: `client.communities.get(id).permissions` is what it can do *right now*.
 *
 * Not here, because no bot can have them: Administrator, managing the community's own settings,
 * managing integrations (adding bots) and managing game servers.
 */
export const PermissionFlags = {
  ViewChannels: 1 << 0,
  SendMessages: 1 << 1,
  ManageMessages: 1 << 2,
  Connect: 1 << 3,
  ManageChannels: 1 << 4,
  ManageRoles: 1 << 5,
  KickMembers: 1 << 7,
  CreateInvite: 1 << 9,
  ManageEmojis: 1 << 10,
  MuteMembers: 1 << 11,
  DeafenMembers: 1 << 12,
  MoveMembers: 1 << 13,
  BanMembers: 1 << 14,
  ModerateMembers: 1 << 15,
  ManageNicknames: 1 << 16,
  MentionEveryone: 1 << 17,
} as const;
/** The name of a permission, such as `"SendMessages"`. */
export type PermissionName = keyof typeof PermissionFlags;

/** A set of permissions: `perms.has("SendMessages")`. */
export class Permissions {
  /** Wrap permission bits, such as a role's `permissions`. */
  constructor(
    /** The permission bits, as a number. */
    readonly bits: number,
  ) {}
  /** Whether every one of these is included. */
  has(...names: PermissionName[]): boolean {
    return names.every((n) => (this.bits & PermissionFlags[n]) === PermissionFlags[n]);
  }
  /** Which of these are not included. */
  missing(...names: PermissionName[]): PermissionName[] {
    return names.filter((n) => !this.has(n));
  }
  /** The names of everything included. */
  toArray(): PermissionName[] {
    return (Object.keys(PermissionFlags) as PermissionName[]).filter((n) => this.has(n));
  }
  /** The bits for a list of names: what to ask for in your project settings, or put on a role. */
  static resolve(...names: PermissionName[]): number {
    return names.reduce((m, n) => m | PermissionFlags[n], 0);
  }
}
