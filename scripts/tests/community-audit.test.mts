import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_KEYS,
  AUDIT_CATEGORIES,
  actionLabel,
  actionsIn,
  auditIndexFor,
  categoryOf,
  clip,
  describeDuration,
  describePermissionChange,
  isAuditAction,
  isAuditCategory,
  joinDetails,
  matchesAuditFilter,
  permissionNames,
} from "../../convex/lib/communityAuditActions";
import { PERMISSIONS } from "../../convex/lib/permissionFlags";
import { bitsOr } from "../../convex/lib/permissionBits";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

// --- the vocabulary ------------------------------------------------------------------------------
{
  ok("every action sits in a known category", AUDIT_ACTION_KEYS.every((a) => (AUDIT_CATEGORIES as readonly string[]).includes(categoryOf(a))));
  ok("every category has at least one action", AUDIT_CATEGORIES.every((c) => actionsIn(c).length > 0));
  ok("action keys are category-prefixed words", AUDIT_ACTION_KEYS.every((a) => /^[a-z]+\.[a-z_]+$/.test(a)));
  ok("every action has a label", AUDIT_ACTION_KEYS.every((a) => AUDIT_ACTIONS[a].label.length > 0));
  ok("a known action is recognised", isAuditAction("member.ban"));
  ok("an unknown action is not", !isAuditAction("member.explode") && !isAuditAction("toString") && !isAuditAction(""));
  ok("a known category is recognised", isAuditCategory("voice") && !isAuditCategory("nope"));
  ok("labels fall back to the raw key for an action from a newer server", actionLabel("future.thing") === "future.thing" && actionLabel("member.kick") === "Kicked a member");
  ok("moderator message deletion is in its own category", categoryOf("message.delete") === "messages");
}

// --- wording a change ----------------------------------------------------------------------------
{
  ok("no change says nothing", describePermissionChange(PERMISSIONS.KICK_MEMBERS, PERMISSIONS.KICK_MEMBERS) === undefined);
  ok("a flag added", describePermissionChange(0, PERMISSIONS.KICK_MEMBERS) === "+Kick members", describePermissionChange(0, PERMISSIONS.KICK_MEMBERS));
  ok("a flag taken away", describePermissionChange(PERMISSIONS.KICK_MEMBERS, 0) === "-Kick members");
  // A wide flag (above bit 31) must be seen too — this is the case plain `&` gets wrong.
  ok("a wide flag added", describePermissionChange(0, PERMISSIONS.VIEW_AUDIT_LOG) === "+View audit log");
  ok("a wide flag taken away while a narrow one stays", describePermissionChange(bitsOr(PERMISSIONS.KICK_MEMBERS, PERMISSIONS.VIEW_INSIGHTS), PERMISSIONS.KICK_MEMBERS) === "-View insights");
  ok("a swap lists both", describePermissionChange(PERMISSIONS.BAN_MEMBERS, PERMISSIONS.KICK_MEMBERS) === "+Kick members, -Ban members");
  const many = describePermissionChange(0, [PERMISSIONS.KICK_MEMBERS, PERMISSIONS.BAN_MEMBERS, PERMISSIONS.MANAGE_ROLES, PERMISSIONS.MANAGE_CHANNELS, PERMISSIONS.SPEAK].reduce(bitsOr, 0), 3)!;
  ok("a long change is counted past the limit", many.endsWith("and 2 more") && many.split(",").length === 3, many);
  ok("names list a wide set", permissionNames(bitsOr(PERMISSIONS.SPEAK, PERMISSIONS.PRIORITY_SPEAKER)).join() === "Speak,Priority speaker", permissionNames(bitsOr(PERMISSIONS.SPEAK, PERMISSIONS.PRIORITY_SPEAKER)).join());
  ok("the owner's all-ones set names everything", permissionNames(-1).length === Object.keys(PERMISSIONS).length);
  ok("durations", describeDuration(30_000) === "1 min" && describeDuration(10 * 60_000) === "10 min" && describeDuration(3_600_000) === "1 h" && describeDuration(7 * 86_400_000) === "7 d");
}

// --- stored text ---------------------------------------------------------------------------------
{
  ok("clip keeps short text", clip("Mods", 10) === "Mods");
  ok("clip flattens lines and control characters", clip("a\nb\t c\u0000d", 20) === "a b c d");
  ok("clip bounds length with an ellipsis", clip("x".repeat(100), 10) === "xxxxxxxxx…");
  ok("clip drops empty text", clip("   ", 10) === undefined && clip(undefined, 10) === undefined && clip("", 10) === undefined);
  ok("joinDetails skips what is absent", joinDetails("A", undefined, false, "B", "") === "A · B");
  ok("joinDetails of nothing is nothing", joinDetails(undefined, false) === undefined);
}

// --- filters -------------------------------------------------------------------------------------
{
  const row = { action: "member.ban", category: "members", actorId: "u1" };
  ok("no filter matches all", matchesAuditFilter(row, {}));
  ok("category", matchesAuditFilter(row, { category: "members" }) && !matchesAuditFilter(row, { category: "roles" }));
  ok("action", matchesAuditFilter(row, { action: "member.ban" }) && !matchesAuditFilter(row, { action: "member.kick" }));
  ok("actor", matchesAuditFilter(row, { actorId: "u1" }) && !matchesAuditFilter(row, { actorId: "u2" }));
  ok("all together", matchesAuditFilter(row, { category: "members", action: "member.ban", actorId: "u1" }) && !matchesAuditFilter(row, { category: "members", action: "member.ban", actorId: "u2" }));
  ok("index: actor wins", auditIndexFor({ actorId: "u1", category: "voice" }) === "by_community_actor");
  ok("index: category next", auditIndexFor({ category: "voice", action: "voice.mute" }) === "by_community_category");
  ok("index: time otherwise", auditIndexFor({ action: "voice.mute" }) === "by_community_time" && auditIndexFor({}) === "by_community_time");
}

console.log(f ? `${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
