/** Changing something already on sale or published, and sending it for review. Run: bun scripts/tests/listing-update.test.mts */
import {
  approvedBotFields, compareVersions, listingPatch, listingState, newestVersion, nextVersion, parseVersion, planBotUpdate, planWrites, refreshedGrant, sameKinds, updateBlocker, versionBlocker,
  type BotLike,
} from "../../convex/lib/listingUpdate";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

// --- cosmetics ---------------------------------------------------------------------------------------
const sku = (o: object = {}) => ({ creatorId: "me", status: "active", grants: [{ kind: "avatarDecoration" }], ...o });
const base = { sku: sku(), creatorId: "me", kinds: ["avatarDecoration"], otherPending: false };
ok("a creator can update their own live listing of the same kind", updateBlocker(base) === null);
ok("a listing that doesn't exist can't be", /doesn't exist/.test(updateBlocker({ ...base, sku: null })!));
ok("someone else's listing can't be updated", /isn't yours/.test(updateBlocker({ ...base, creatorId: "you" })!));
ok("a listing taken off sale can't be updated (and the creator is told what to do)", /taken off sale.*new one/.test(updateBlocker({ ...base, sku: sku({ status: "archived" }) })!));
ok("a listing that was never on sale can't be", /isn't on sale yet/.test(updateBlocker({ ...base, sku: sku({ status: "draft" }) })!));
ok("only one update waits at a time", /already waiting/.test(updateBlocker({ ...base, otherPending: true })!));
ok("an update can't turn a decoration into a sticker", /same kind of thing/.test(updateBlocker({ ...base, kinds: ["profileSticker"] })!));
ok("…or add or drop an item of a pack", /same kind/.test(updateBlocker({ ...base, kinds: ["avatarDecoration", "nameplate"] })!) && /same kind/.test(updateBlocker({ ...base, sku: sku({ grants: [{ kind: "avatarDecoration" }, { kind: "nameplate" }] }) })!));
ok("a pack's items may come in any order", updateBlocker({ ...base, sku: sku({ grants: [{ kind: "nameplate" }, { kind: "avatarDecoration" }] }), kinds: ["avatarDecoration", "nameplate"] }) === null);
ok("sameKinds", sameKinds(["a", "b"], ["b", "a"]) && !sameKinds(["a"], ["a", "a"]) && !sameKinds(["a", "a"], ["a", "b"]) && sameKinds([], []));
ok("sameKinds doesn't change its inputs", (() => { const x = ["b", "a"]; sameKinds(x, x); return x.join() === "b,a"; })());

const grants = [{ kind: "avatarDecoration", payload: "NEW", label: "Halo v2" }, { kind: "nameplate", payload: "n2" }];
ok("an owner gets the new grant of their own kind", refreshedGrant("avatarDecoration", grants)?.payload === "NEW" && refreshedGrant("nameplate", grants)?.payload === "n2");
ok("a kind the update dropped gives nothing (owners keep what they bought)", refreshedGrant("profileEffect", grants) === null);

const patch = listingPatch({ priceCents: 199 }, { name: "Halo v2", description: "Better", grants, previewUrl: "https://cdn/x.png", fallbackImage: "fb" }, 199, 5);
ok("an update replaces name, description, artwork, picture and time", patch.name === "Halo v2" && patch.description === "Better" && patch.grants === grants && patch.imageUrl === "https://cdn/x.png" && patch.updatedAt === 5);
ok("…and leaves the address, category, share and Stripe records out of the patch", !["slug", "categoryId", "creatorShareBps", "stripeProductId", "stripePriceId", "featured", "position", "creatorId", "status"].some((k) => k in patch));
ok("an unchanged price is not a price change; a changed one is", patch.priceChanged === false && listingPatch({ priceCents: 199 }, { name: "x", grants: [] }, 299, 1).priceChanged === true);
ok("with no store picture of its own, the artwork's is used", listingPatch({ priceCents: 0 }, { name: "x", grants: [], fallbackImage: "fb" }, 0, 1).imageUrl === "fb");

// --- versions ---------------------------------------------------------------------------------------------
ok("parseVersion", JSON.stringify(parseVersion("1.2.3")) === "[1,2,3]" && parseVersion("1.2") === null && parseVersion("v1.2.3") === null && parseVersion("1.2.3-beta") === null && parseVersion("10000.0.0") === null);
ok("versions compare as numbers, not text (1.10.0 is newer than 1.9.0)", compareVersions("1.10.0", "1.9.0") > 0 && compareVersions("1.9.0", "1.10.0") < 0 && compareVersions("2.0.0", "1.99.99") > 0 && compareVersions("1.0.0", "1.0.0") === 0 && compareVersions("1.0.1", "1.0.0") > 0);
ok("something that isn't a version is oldest", compareVersions("zzz", "0.0.1") < 0 && compareVersions("0.0.1", "zzz") > 0 && compareVersions("a", "b") === 0);
ok("newestVersion ignores junk and handles none", newestVersion(["1.0.0", "1.10.0", "1.9.0", "nope"]) === "1.10.0" && newestVersion([]) === null && newestVersion(["x"]) === null);
ok("nextVersion bumps the patch of the newest", nextVersion(["1.0.0", "1.2.9", "1.2.10"]) === "1.2.11" && nextVersion([]) === "1.0.0" && nextVersion(["0.0.0"]) === "0.0.1");
ok("nextVersion never leaves the range a version may have", parseVersion(nextVersion(["1.0.9999"])) !== null || nextVersion(["1.0.9999"]) === "1.0.9999");
ok("a newer version can be sent", versionBlocker(["1.0.0"], "1.0.1") === null && versionBlocker([], "1.0.0") === null && versionBlocker(["1.0.0", "1.1.0"], "2.0.0") === null);
ok("the same version can't be sent twice", /already exists/.test(versionBlocker(["1.0.0"], "1.0.0")!));
ok("an older version can't be sent after a newer one (and the creator is told which to use)", /older than 1\.2\.0.*1\.2\.1/.test(versionBlocker(["1.0.0", "1.2.0"], "1.1.0")!));
ok("a malformed version is refused", /looks like 1\.0\.0/.test(versionBlocker([], "one")!));

// --- what Studio shows --------------------------------------------------------------------------------------
ok("never submitted", listingState(null).state === "none" && listingState(undefined).state === "none");
ok("first submission waiting", listingState({ status: "pending" }).state === "reviewing-first");
ok("first submission turned down carries the note", (() => { const s = listingState({ status: "rejected", reviewNote: "blurry" }); return s.state === "turned-down-first" && s.note === "blurry"; })());
ok("approved first submission is live as the listing it made", (() => { const s = listingState({ status: "approved", skuId: "S1" }); return s.state === "live" && s.skuId === "S1"; })());
ok("an update waiting still points at the live listing", (() => { const s = listingState({ status: "pending", updatesSkuId: "S1" }); return s.state === "reviewing-update" && s.skuId === "S1"; })());
ok("an update turned down leaves the listing live, with the reason", (() => { const s = listingState({ status: "rejected", updatesSkuId: "S1", reviewNote: "too big" }); return s.state === "turned-down-update" && s.skuId === "S1" && s.note === "too big"; })());
ok("an approved update is live as the same listing", (() => { const s = listingState({ status: "approved", updatesSkuId: "S1", skuId: "S1" }); return s.state === "live" && s.skuId === "S1"; })());
ok("approved with no listing (shouldn't happen) is treated as nothing, not a crash", listingState({ status: "approved" }).state === "none");

// --- bots ----------------------------------------------------------------------------------------------------------
const bot = (o: Partial<BotLike> = {}): BotLike => ({ name: "Dicey", description: "Rolls dice for you", imageUrl: undefined, visibility: "private", ...o });
const pub = (o: Partial<BotLike> = {}) => bot({ visibility: "public", ...o });

const ON = { name: "Dicey", description: "Rolls dice for you" };
// private bot: all the author's
let r = planBotUpdate(bot(), { name: "Dicey 2", description: "Rolls many dice" });
ok("a private bot's name and description apply at once and nothing waits", r.apply.name === "Dicey 2" && r.apply.description === "Rolls many dice" && r.pending === null && !r.pendingChanged);
// making public
r = planBotUpdate(bot(), { visibility: "public" });
ok("asking to be public holds it for review and keeps it private meanwhile", r.apply.visibility === undefined && r.pending?.makePublic === true && r.pendingChanged, r);
ok("…what is waiting is the listing as asked", r.pending?.name === "Dicey" && r.pending?.description === "Rolls dice for you");
ok("…and the description is checked as a public bot's", r.wanted.public === true);
// idempotent resend
const waiting = bot({ pending: { name: "Dicey", description: "Rolls dice for you", makePublic: true, submittedAt: 1 } });
r = planBotUpdate(waiting, { visibility: "public", name: "Dicey", description: "Rolls dice for you" });
ok("sending the same request again changes nothing (Studio saves every setting each time)", r.pending !== null && !r.pendingChanged && Object.keys(r.apply).length === 0);
r = planBotUpdate(waiting, { description: "Rolls dice, and coins" });
ok("a change while a request waits replaces what is waiting (and stays a request to be public)", r.pending?.description === "Rolls dice, and coins" && r.pending?.makePublic === true && r.pendingChanged);
r = planBotUpdate(waiting, { visibility: "private" });
ok("withdrawing the request (back to private) clears what waits, and there is nothing to write to a bot that is private already", r.pending === null && r.apply.visibility === undefined && Object.keys(r.apply).length === 0 && r.pendingChanged);
// live public bot
r = planBotUpdate(pub(), { name: "Dicey", description: "Rolls dice for you" });
ok("sending a public bot's listing unchanged is a no-op", r.pending === null && !r.pendingChanged && Object.keys(r.apply).length === 0);
r = planBotUpdate(pub(), { description: "Now with coins" });
ok("changing a public bot's description doesn't change what people see — it waits", Object.keys(r.apply).length === 0 && r.pending?.description === "Now with coins" && r.pending?.makePublic === false && r.pendingChanged);
r = planBotUpdate(pub(), { name: "Dicey Deluxe" });
ok("…the name too", r.apply.name === undefined && r.pending?.name === "Dicey Deluxe");
r = planBotUpdate(pub(), { imageUrl: "https://cdn/a.png" });
ok("…and the picture", r.apply.imageUrl === undefined && r.pending?.imageUrl === "https://cdn/a.png");
r = planBotUpdate(pub({ imageUrl: "https://cdn/a.png" }), { imageUrl: null });
ok("clearing the picture is a change to review", r.pending !== null && r.pending.imageUrl === undefined && r.pendingChanged);
r = planBotUpdate(pub({ pending: { name: "Dicey", description: "Now with coins", makePublic: false, submittedAt: 1 } }), { description: "Rolls dice for you" });
ok("changing it back to what is live drops the request", r.pending === null && r.pendingChanged);
r = planBotUpdate(pub(), { visibility: "private" });
ok("a public bot can be made private at once (taking something down needs no review)", r.apply.visibility === "private" && r.pending === null);
r = planBotUpdate(pub({ pending: { name: "X", description: "Something else here", makePublic: false, submittedAt: 1 } }), { visibility: "private" });
ok("…and that clears what was waiting", r.pending === null && r.apply.visibility === "private" && r.pendingChanged);
r = planBotUpdate(pub({ pending: { name: "Dicey", description: "Now with coins", makePublic: false, submittedAt: 1 } }), {});
ok("a save with no listing changes leaves what is waiting alone", r.pending?.description === "Now with coins" && !r.pendingChanged && Object.keys(r.apply).length === 0);
ok("a public bot with a change waiting still counts as public", planBotUpdate(pub({ pending: { name: "Dicey", description: "Now with coins", makePublic: false, submittedAt: 1 } }), {}).wanted.public === true);
// --- profile: avatar, banner, bio --------------------------------------------------------------------------------
r = planBotUpdate(bot(), { bio: "Rolls dice. Fairly.", imageUrl: "https://cdn/a.png", bannerUrl: "https://cdn/b.png" });
ok("a private bot's bio, avatar and banner apply at once", r.apply.bio === "Rolls dice. Fairly." && r.apply.imageUrl === "https://cdn/a.png" && r.apply.bannerUrl === "https://cdn/b.png" && r.pending === null);
r = planBotUpdate(bot({ bio: "Hi", imageUrl: "https://cdn/a.png", bannerUrl: "https://cdn/b.png" }), { ...ON, bio: "Hi", imageUrl: "https://cdn/a.png", bannerUrl: "https://cdn/b.png" });
ok("saving the same settings again writes nothing at all", Object.keys(r.apply).length === 0 && r.pending === null && !r.pendingChanged, r.apply);
r = planBotUpdate(bot({ bio: "Hi" }), { bio: "Hi there" });
ok("only what changed is written", Object.keys(r.apply).join() === "bio");
r = planBotUpdate(bot({ imageUrl: "https://cdn/a.png" }), { imageUrl: null });
ok("removing a picture is a change, written as the picture being gone", "imageUrl" in r.apply && r.apply.imageUrl === undefined);
r = planBotUpdate(pub(), { bio: "Now with a bio" });
ok("a public bot's bio waits for review, and the live profile keeps what it has", Object.keys(r.apply).length === 0 && r.pending?.bio === "Now with a bio" && r.pending?.makePublic === false);
r = planBotUpdate(pub({ bio: "Old" }), { imageUrl: "https://cdn/new.png" });
ok("…so does its avatar, and the bio it already has rides along unchanged", Object.keys(r.apply).length === 0 && r.pending?.imageUrl === "https://cdn/new.png" && r.pending?.bio === "Old");
r = planBotUpdate(pub({ bannerUrl: "https://cdn/b.png" }), { bannerUrl: "https://cdn/c.png" });
ok("…and its banner", r.pending?.bannerUrl === "https://cdn/c.png" && Object.keys(r.apply).length === 0);
r = planBotUpdate(pub({ bio: "Same", imageUrl: "https://cdn/a.png", bannerUrl: "https://cdn/b.png" }), { ...ON, bio: "Same", imageUrl: "https://cdn/a.png", bannerUrl: "https://cdn/b.png" });
ok("resending a public bot's profile unchanged is a no-op", r.pending === null && !r.pendingChanged && Object.keys(r.apply).length === 0);
r = planBotUpdate(pub({ pending: { name: "Dicey", description: "Rolls dice for you", bio: "A", makePublic: false, submittedAt: 1 } }), { bannerUrl: "https://cdn/b.png" });
ok("editing one field while a change waits keeps the others that were asked for", r.pending?.bio === "A" && r.pending?.bannerUrl === "https://cdn/b.png" && r.pendingChanged);
r = planBotUpdate(pub({ bio: "Live", pending: { name: "Dicey", description: "Rolls dice for you", makePublic: false, submittedAt: 1 } }), {});
ok("a request made before profiles existed (no bio in it) falls back to the live bio", r.pending === null || r.pending.bio === "Live");
r = planBotUpdate(pub({ bio: "Live" }), { bio: "Live" });
ok("the bio is compared as text, not as 'set or not'", r.pending === null);
r = planBotUpdate(bot(), { bio: "" });
ok("an empty bio on a bot with none is nothing", Object.keys(r.apply).length === 0);
const w = planWrites(planBotUpdate(bot({ bio: "x" }), { name: "Dicey 2", bio: "", imageUrl: "https://cdn/a.png" }), 5);
ok("writes go to the right place: the name and picture to both bot and account, the bio only to the account (empty means removed)", w.bot.name === "Dicey 2" && w.user.name === "Dicey 2" && w.bot.imageUrl === "https://cdn/a.png" && w.user.imageUrl === "https://cdn/a.png" && !("bio" in w.bot) && "bio" in w.user && w.user.bio === undefined, w);
const w2 = planWrites(planBotUpdate(pub(), { description: "Waiting for review please" }), 7);
ok("a waiting change writes only the pending record, with its time, and no account change", Object.keys(w2.user).length === 0 && (w2.bot.pending as { submittedAt: number }).submittedAt === 7 && w2.bot.lastReview === undefined && !("description" in w2.bot));
const w3 = planWrites(planBotUpdate(waiting, { visibility: "private" }), 9);
ok("withdrawing a request clears it", "pending" in w3.bot && w3.bot.pending === undefined && w3.bot.visibility === undefined);
const approved = approvedBotFields({ name: "N", description: "D long enough", bio: "B", bannerUrl: "https://cdn/b.png", makePublic: true, submittedAt: 1 });
ok("approving carries the bio and banner too", approved.bio === "B" && approved.bannerUrl === "https://cdn/b.png");

const done = approvedBotFields({ name: "N", description: "D long enough", imageUrl: "u", makePublic: true, submittedAt: 1 });
ok("approving makes the bot public with the new listing", done.visibility === "public" && done.name === "N" && done.description === "D long enough" && done.imageUrl === "u");
ok("a bot's permissions, commands and address aren't part of the listing", !("permissions" in r.apply) && !("commands" in r.apply));

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
