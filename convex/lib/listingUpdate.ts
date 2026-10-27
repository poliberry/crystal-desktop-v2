/**
 * Changing something that is already on sale or published, and sending the change for review.
 *
 * Pure — no Convex, no DOM — so the rules are the same where a creator is told what they can do (Studio), where
 * a submission is accepted (the server) and where staff approve it, and can be tested on their own.
 *
 * What an update is, for each thing a creator can sell or publish:
 *  - **A cosmetic, scene, theme pack or pack** — a new submission that *names the listing it replaces*. The live
 *    listing doesn't change while it waits. When staff approve it, the listing's name, description, artwork and
 *    price are replaced in place (so its address, its sales and everyone who owns it stay), and what owners hold is
 *    refreshed to the new artwork. Turned down, the live listing is untouched and the creator sees why.
 *  - **An extension** — a new *version* of the same extension, reviewed like the first. The directory shows the newest
 *    approved version, so approving it is what updates the page; people who have it installed are offered the update.
 */

/** What stops a listing from being updated, or null if it may be. The same list is shown to the creator and enforced. */
export function updateBlocker(args: {
  /** The listing being updated. */
  sku: { creatorId?: string; status: string; grants: { kind: string }[] } | null;
  /** Who is asking. */
  creatorId: string;
  /** The kinds of the new submission, one per item. */
  kinds: string[];
  /** Whether another update to the same listing is already waiting. */
  otherPending: boolean;
}): string | null {
  const { sku, creatorId, kinds, otherPending } = args;
  if (!sku) return "The listing you're updating doesn't exist any more.";
  if (sku.creatorId !== creatorId) return "That listing isn't yours.";
  if (sku.status !== "active") return sku.status === "archived" ? "That listing has been taken off sale, so it can't be updated. Submit it as a new one." : "That listing isn't on sale yet.";
  if (otherPending) return "An update to this listing is already waiting for review. Wait for it, or withdraw it first.";
  if (!sameKinds(sku.grants.map((g) => g.kind), kinds)) return "An update has to be the same kind of thing as the listing it replaces. Submit it as a new one instead.";
  return null;
}

/** The same kinds of item, in any order, none missing or added. */
export function sameKinds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((k, i) => k === right[i]);
}

export interface Grant {
  kind: string;
  payload?: string;
  label?: string;
}

/** What an owner's entitlement should now hold: the new grant of its own kind, or nothing if the update dropped that kind. */
export function refreshedGrant(entitlementKind: string, grants: readonly Grant[]): Grant | null {
  return grants.find((g) => g.kind === entitlementKind) ?? null;
}

/**
 * The fields of the live listing an approved update replaces. Everything else — its address (slug), category, what the
 * creator keeps, whether it is featured, its position, its Stripe records — stays as it was, so a link to the listing
 * and the people who bought it are unaffected.
 */
export function listingPatch<G extends Grant>(
  live: { priceCents: number },
  update: { name: string; description?: string; grants: G[]; previewUrl?: string; fallbackImage?: string },
  price: number,
  now: number,
) {
  return {
    name: update.name,
    description: update.description,
    grants: update.grants,
    imageUrl: update.previewUrl ?? update.fallbackImage,
    priceCents: price,
    updatedAt: now,
    /** Whether the price changed, so the payment provider's copy has to be brought up to date. */
    priceChanged: price !== live.priceCents,
  };
}

// --- Versions ----------------------------------------------------------------------------------------

/** `1.2.3` → [1,2,3]; null if it isn't one. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative if `a` is older than `b`, positive if newer, 0 if the same. A version that isn't one sorts oldest. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x && !y) return 0;
  if (!x) return -1;
  if (!y) return 1;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** The newest of some versions, or null. */
export function newestVersion(versions: readonly string[]): string | null {
  return versions.reduce<string | null>((best, v) => (parseVersion(v) && (best === null || compareVersions(v, best) > 0) ? v : best), null);
}

/** The next patch version after the newest one given: what a creator is offered when they have changed something. */
export function nextVersion(versions: readonly string[]): string {
  const newest = newestVersion(versions);
  const p = newest ? parseVersion(newest)! : [1, 0, -1];
  return `${p[0]}.${p[1]}.${Math.min(9999, p[2] + 1)}`;
}

/** Why a new version can't be submitted given the versions that exist, or null. It has to be newer than all of them. */
export function versionBlocker(existing: readonly string[], next: string): string | null {
  if (!parseVersion(next)) return "A version looks like 1.0.0.";
  if (existing.includes(next)) return `Version ${next} already exists — a change is a new version.`;
  const newest = newestVersion(existing);
  if (newest && compareVersions(next, newest) < 0) return `Version ${next} is older than ${newest}, which has already been sent. A change needs a newer version, such as ${nextVersion(existing)}.`;
  return null;
}

// --- What Studio shows ---------------------------------------------------------------------------------

export type ListingState =
  | { state: "none" }
  | { state: "reviewing-first" }
  | { state: "turned-down-first"; note?: string }
  | { state: "live"; skuId: string }
  | { state: "reviewing-update"; skuId: string }
  | { state: "turned-down-update"; skuId: string; note?: string };

/**
 * Where a project stands in the store, from its most recent submission. `skuId` is the listing it is (or was meant to
 * be) a version of: for an update that is the listing it names, otherwise the one the first approval created.
 */
export function listingState(latest: { status: "pending" | "approved" | "rejected"; updatesSkuId?: string; skuId?: string; reviewNote?: string } | null | undefined): ListingState {
  if (!latest) return { state: "none" };
  const sku = latest.updatesSkuId ?? latest.skuId;
  if (latest.status === "approved") return sku ? { state: "live", skuId: sku } : { state: "none" };
  if (latest.status === "pending") return sku ? { state: "reviewing-update", skuId: sku } : { state: "reviewing-first" };
  return sku ? { state: "turned-down-update", skuId: sku, note: latest.reviewNote } : { state: "turned-down-first", note: latest.reviewNote };
}

// --- Bots ------------------------------------------------------------------------------------------------

/**
 * A bot's public listing is what people see when they look for a bot to add: its name, description, picture, and the
 * fact that it is in the public list at all. A bot that is `public` has been reviewed, so **`visibility: "public"` always
 * means approved**; the review of a change to it (or of making it public) is held in `pending`, and the bot keeps its
 * approved listing until staff say yes. Everything else about a bot (permissions it asks for, commands, address, token)
 * isn't part of the listing and changes at once: asking for more still needs each community's manager to grant it, and
 * a bot's code runs on its author's own computer where Crystal can't read it.
 */
export interface BotListingFields {
  name: string;
  description: string;
  /** The avatar. */
  imageUrl?: string;
  /** The line on the bot's profile card. An empty string is none. */
  bio?: string;
  /** The picture across the top of the bot's profile card. */
  bannerUrl?: string;
}
export interface PendingBotListing extends BotListingFields {
  /** Whether approving this also puts the bot in the public list. */
  makePublic: boolean;
  submittedAt: number;
}
export interface BotLike extends BotListingFields {
  visibility: "private" | "public";
  pending?: PendingBotListing;
}
export interface BotListingPatch {
  name?: string;
  description?: string;
  /** A string to set it, null to clear it. */
  imageUrl?: string | null;
  bio?: string;
  bannerUrl?: string | null;
  visibility?: "private" | "public";
}
export interface BotUpdatePlan {
  /** What changes on the bot straight away. */
  apply: Partial<BotListingFields> & { visibility?: "private" | "public" };
  /** What is waiting for review afterwards (null for nothing), without its time: the caller stamps that. */
  pending: (BotListingFields & { makePublic: boolean }) | null;
  /** Whether what is waiting is different from what was already waiting (so a resend restarts nothing, but a change does). */
  pendingChanged: boolean;
  /** The listing fields the bot should be validated with: the ones that are being asked for. */
  wanted: BotListingFields & { description: string; bio: string; public: boolean };
}

const sameListing = (a: BotListingFields, b: BotListingFields) =>
  a.name === b.name &&
  a.description === b.description &&
  (a.imageUrl ?? undefined) === (b.imageUrl ?? undefined) &&
  (a.bio ?? "") === (b.bio ?? "") &&
  (a.bannerUrl ?? undefined) === (b.bannerUrl ?? undefined);

/**
 * What a change to a bot does: which parts apply now and which wait for review. Idempotent, because Studio saves every
 * setting each time: sending what is already live changes nothing and what is already waiting stays waiting.
 *
 * The listing is everything people are shown about the bot: name, description, avatar, banner and bio. For a bot nobody
 * but its author can see these are the author's to change; for a public one they are reviewed together, so no part of
 * the listing is a way round the review of another.
 */
export function planBotUpdate(bot: BotLike, patch: BotListingPatch): BotUpdatePlan {
  const live: BotListingFields = { name: bot.name, description: bot.description, imageUrl: bot.imageUrl, bio: bot.bio ?? "", bannerUrl: bot.bannerUrl };
  // A request still waiting is the starting point, so editing one field doesn't throw away the others. Requests made before the
  // profile fields existed don't carry them: those fall back to what is live.
  const working: BotListingFields = bot.pending
    ? { name: bot.pending.name, description: bot.pending.description, imageUrl: bot.pending.imageUrl, bio: bot.pending.bio ?? live.bio, bannerUrl: "bannerUrl" in bot.pending ? bot.pending.bannerUrl : live.bannerUrl }
    : live;
  const desired: BotListingFields = {
    name: patch.name ?? working.name,
    description: patch.description ?? working.description,
    imageUrl: patch.imageUrl === undefined ? working.imageUrl : (patch.imageUrl ?? undefined),
    bio: patch.bio === undefined ? (working.bio ?? "") : patch.bio,
    bannerUrl: patch.bannerUrl === undefined ? working.bannerUrl : (patch.bannerUrl ?? undefined),
  };
  const wantPublic = patch.visibility !== undefined ? patch.visibility === "public" : bot.pending ? bot.pending.makePublic || bot.visibility === "public" : bot.visibility === "public";
  const wanted = { ...desired, description: desired.description, bio: desired.bio ?? "", public: wantPublic };

  // Not (or no longer) public: nobody but the author sees it, so it is the author's to change.
  // Only what differs from what is there, so saving the same settings again rewrites nothing (a rewritten picture would
  // throw away the cached copy of its colour, and so on).
  if (!wantPublic) {
    const apply: BotUpdatePlan["apply"] = {};
    if (desired.name !== live.name) apply.name = desired.name;
    if (desired.description !== live.description) apply.description = desired.description;
    if ((desired.imageUrl ?? undefined) !== (live.imageUrl ?? undefined)) apply.imageUrl = desired.imageUrl;
    if ((desired.bio ?? "") !== (live.bio ?? "")) apply.bio = desired.bio ?? "";
    if ((desired.bannerUrl ?? undefined) !== (live.bannerUrl ?? undefined)) apply.bannerUrl = desired.bannerUrl;
    if (bot.visibility !== "private") apply.visibility = "private";
    return { apply, pending: null, pendingChanged: !!bot.pending, wanted };
  }

  let pending: (BotListingFields & { makePublic: boolean }) | null;
  if (bot.visibility === "public") pending = sameListing(desired, live) ? null : { ...desired, makePublic: false };
  else pending = { ...desired, makePublic: true };

  const pendingChanged = pending === null ? !!bot.pending : !bot.pending || !sameListing(pending, working) || pending.makePublic !== bot.pending.makePublic;
  return { apply: {}, pending, pendingChanged, wanted };
}

/** The writes a plan comes to: on the bot, and on the account people see. `undefined` means "remove it". */
export function planWrites(plan: BotUpdatePlan, now: number) {
  const a = plan.apply;
  const bot: Record<string, unknown> = {};
  const user: Record<string, unknown> = {};
  if (a.visibility !== undefined) bot.visibility = a.visibility;
  if ("name" in a) bot.name = user.name = a.name;
  if ("description" in a) bot.description = a.description;
  if ("imageUrl" in a) bot.imageUrl = user.imageUrl = a.imageUrl;
  if ("bio" in a) user.bio = a.bio ? a.bio : undefined;
  if ("bannerUrl" in a) user.bannerUrl = a.bannerUrl;
  if (plan.pending === null) bot.pending = undefined;
  else if (plan.pendingChanged) {
    bot.pending = { ...plan.pending, submittedAt: now };
    bot.lastReview = undefined;
  }
  return { bot, user };
}

/** What approving a pending listing does to the bot. */
export function approvedBotFields(pending: PendingBotListing): BotListingFields & { visibility: "public" } {
  return { name: pending.name, description: pending.description, imageUrl: pending.imageUrl, bio: pending.bio ?? "", bannerUrl: pending.bannerUrl, visibility: "public" };
}
