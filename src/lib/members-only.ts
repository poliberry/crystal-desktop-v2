/**
 * Joining a members-only creator community with an invite is refused until the
 * platform has confirmed the person is a member. The four places that join by an
 * invite code each see that refusal; rather than each growing a verification
 * flow, they hand it to one dialog (`VerifyMembershipHost`) through this event.
 */

export const VERIFY_EVENT = "crystal:verify-membership";

export interface VerifyRequest {
  code: string;
  /** Called once they have joined, with the community's id. */
  onJoined?: (communityId: string) => void;
}

/** Whether an error is the "members only" refusal. */
export function isMembersOnlyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("members-only");
}

/** Hand a refused join to the verification dialog. Returns whether it did, so a
 * caller can skip showing the raw error. */
export function requestMembershipVerification(error: unknown, request: VerifyRequest): boolean {
  if (!isMembersOnlyError(error) || typeof window === "undefined") return false;
  window.dispatchEvent(new CustomEvent<VerifyRequest>(VERIFY_EVENT, { detail: request }));
  return true;
}
