import { bitsHas, bitsOr } from "./permissionBits";
import { PERMISSIONS } from "./permissionFlags";
import { withinHistory, type HistoryFloor } from "./historyPure";

/**
 * Who may see and use a forum post, as plain functions so the rules can be tested without a
 * database. The lookups that feed them (the invited members, the caller's permissions) are in
 * `forums.ts`.
 */

/** Moderating a thread or forum post: Manage Threads, or Manage Messages as it always was. */
export const MODERATE_THREADS = bitsOr(PERMISSIONS.MANAGE_THREADS, PERMISSIONS.MANAGE_MESSAGES);

/** Most people who can be invited into one private thread, on top of its author. */
export const MAX_THREAD_MEMBERS = 50;

/** The parts of a post these rules look at. */
export interface PostAccessFields {
  private?: boolean;
  authorId: string;
}

/** Same as `canDo` in surfaces.ts, kept here so this file has nothing to import from the database layer. */
export function holds(perms: number, flag: number): boolean {
  return bitsHas(perms, PERMISSIONS.ADMINISTRATOR) || bitsHas(perms, flag);
}

/**
 * Whether `viewerId` may know a post exists. A public post is for everyone who can see the channel;
 * a private one only for its author, the people invited into it and whoever moderates threads.
 */
export function canSeePost(post: PostAccessFields, viewerId: string, invited: boolean, canModerate: boolean): boolean {
  if (!post.private) return true;
  return post.authorId === viewerId || invited || canModerate;
}

/** Whether the viewer may manage who is in a private thread: its author, or a moderator. */
export function canManageMembers(post: PostAccessFields, viewerId: string, canModerate: boolean): boolean {
  return !!post.private && (post.authorId === viewerId || canModerate);
}

/** Whether `viewerId` may take `targetId` out of the thread: managers anyone, a member only themselves. */
export function canRemoveMember(post: PostAccessFields, viewerId: string, targetId: string, canModerate: boolean): boolean {
  if (targetId === post.authorId) return false;
  return canManageMembers(post, viewerId, canModerate) || viewerId === targetId;
}

/**
 * Whether a restricted reader (no Read Message History) may see a post. Their own posts always show;
 * anything else has to have been started after they last opened the channel.
 */
export function postWithinHistory(floor: HistoryFloor, post: { authorId: string; createdAt: number }, viewerId: string): boolean {
  return post.authorId === viewerId || withinHistory(floor, post.createdAt);
}

/** What a viewer can start in a forum: public and private threads each need Send Messages and their own flag. */
export function createCapabilities(perms: number): { canCreatePublic: boolean; canCreatePrivate: boolean } {
  const send = holds(perms, PERMISSIONS.SEND_MESSAGES);
  return {
    canCreatePublic: send && holds(perms, PERMISSIONS.CREATE_PUBLIC_THREADS),
    canCreatePrivate: send && holds(perms, PERMISSIONS.CREATE_PRIVATE_THREADS),
  };
}

/** Why a viewer can't start a thread of this kind, or null if they can. */
export function createRefusal(perms: number, wantPrivate: boolean): string | null {
  if (!holds(perms, PERMISSIONS.SEND_MESSAGES)) return "You can't post here.";
  if (wantPrivate) {
    return holds(perms, PERMISSIONS.CREATE_PRIVATE_THREADS) ? null : "You don't have permission to start private threads here.";
  }
  return holds(perms, PERMISSIONS.CREATE_PUBLIC_THREADS) ? null : "You don't have permission to start public threads here.";
}

/** Whether a viewer can reply in threads. */
export function canReplyIn(perms: number): boolean {
  return holds(perms, PERMISSIONS.SEND_MESSAGES) && holds(perms, PERMISSIONS.SEND_MESSAGES_IN_THREADS);
}

/** Whether a member timed out until `timeoutUntil` is still timed out at `now`. */
export function isTimedOut(timeoutUntil: number | undefined, now: number): boolean {
  return !!timeoutUntil && timeoutUntil > now;
}
