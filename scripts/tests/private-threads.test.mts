// Run: bun scripts/tests/private-threads.test.mts
import { PERMISSIONS as P } from "../../convex/permissions";
import * as T from "../../convex/lib/threadAccess";
import { historyFloor } from "../../convex/lib/historyPure";
import { bitsOr } from "../../convex/lib/permissionBits";
import { isSlowmodeExempt } from "../../convex/lib/slowmodePure";

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? passes++ : fails++; if (!c) console.log("FAIL", n, JSON.stringify(d)); };

const pub = { authorId: "alice" };
const priv = { authorId: "alice", private: true };

// ---- who can see a post
ok("public: anyone sees it", T.canSeePost(pub, "bob", false, false));
ok("private: author sees it", T.canSeePost(priv, "alice", false, false));
ok("private: invited member sees it", T.canSeePost(priv, "bob", true, false));
ok("private: moderator sees it", T.canSeePost(priv, "mod", false, true));
ok("private: a stranger does not", !T.canSeePost(priv, "bob", false, false));
ok("private: private=false behaves as public", T.canSeePost({ authorId: "alice", private: false }, "bob", false, false));

// ---- moderator permission, including the bits above 30
const modPerms = (perms: number) => T.holds(perms, T.MODERATE_THREADS);
ok("manage threads moderates", modPerms(P.MANAGE_THREADS));
ok("manage messages moderates", modPerms(P.MANAGE_MESSAGES));
ok("administrator moderates", modPerms(P.ADMINISTRATOR));
ok("owner (all ones) moderates", modPerms(-1));
ok("send messages alone does not", !modPerms(P.SEND_MESSAGES));
ok("a high flag elsewhere does not leak into moderating", !modPerms(bitsOr(P.CREATE_PRIVATE_THREADS, P.SEND_MESSAGES_IN_THREADS)));

// ---- managing members
ok("author manages a private thread", T.canManageMembers(priv, "alice", false));
ok("moderator manages a private thread", T.canManageMembers(priv, "mod", true));
ok("invited member does not manage", !T.canManageMembers(priv, "bob", false));
ok("nobody manages a public thread's members", !T.canManageMembers(pub, "alice", true));
ok("author removes anyone", T.canRemoveMember(priv, "alice", "bob", false));
ok("moderator removes anyone", T.canRemoveMember(priv, "mod", "bob", true));
ok("member removes themselves", T.canRemoveMember(priv, "bob", "bob", false));
ok("member cannot remove another", !T.canRemoveMember(priv, "bob", "carol", false));
ok("the author cannot be removed, even by a moderator", !T.canRemoveMember(priv, "mod", "alice", true));
ok("the author cannot leave their own thread", !T.canRemoveMember(priv, "alice", "alice", false));

// ---- starting threads
// Flags above bit 30 cannot go through `|`, so every combination uses bitsOr.
const sendPublic = bitsOr(P.SEND_MESSAGES, P.CREATE_PUBLIC_THREADS);
const sendPrivate = bitsOr(P.SEND_MESSAGES, P.CREATE_PRIVATE_THREADS);
ok("public needs send + public flag", T.createRefusal(sendPublic, false) === null);
ok("public refused with only the private flag", /public/.test(T.createRefusal(sendPrivate, false) ?? ""));
ok("private needs send + private flag", T.createRefusal(sendPrivate, true) === null);
ok("private refused with only the public flag", /private/.test(T.createRefusal(sendPublic, true) ?? ""));
ok("no send messages refuses both", T.createRefusal(bitsOr(P.CREATE_PUBLIC_THREADS, P.CREATE_PRIVATE_THREADS), false) === "You can't post here." && T.createRefusal(P.CREATE_PRIVATE_THREADS, true) === "You can't post here.");
ok("administrator can start either", T.createRefusal(P.ADMINISTRATOR, true) === null && T.createRefusal(P.ADMINISTRATOR, false) === null);
ok("owner can start either", T.createRefusal(-1, true) === null && T.createRefusal(-1, false) === null);
ok("capabilities: public only", JSON.stringify(T.createCapabilities(sendPublic)) === JSON.stringify({ canCreatePublic: true, canCreatePrivate: false }));
ok("capabilities: private only", JSON.stringify(T.createCapabilities(sendPrivate)) === JSON.stringify({ canCreatePublic: false, canCreatePrivate: true }));
ok("capabilities: neither", JSON.stringify(T.createCapabilities(P.SEND_MESSAGES)) === JSON.stringify({ canCreatePublic: false, canCreatePrivate: false }));

// ---- replying
ok("reply needs send + in-threads", T.canReplyIn(bitsOr(P.SEND_MESSAGES, P.SEND_MESSAGES_IN_THREADS)));
ok("reply refused without in-threads", !T.canReplyIn(P.SEND_MESSAGES));
ok("reply refused without send", !T.canReplyIn(P.SEND_MESSAGES_IN_THREADS));
ok("administrator can reply", T.canReplyIn(P.ADMINISTRATOR));

// ---- timeouts
ok("timed out until the future", T.isTimedOut(2000, 1000));
ok("timeout in the past is over", !T.isTimedOut(1000, 2000));
ok("timeout exactly now is over", !T.isTimedOut(1000, 1000));
ok("no timeout", !T.isTimedOut(undefined, 1000));

// ---- history
const open = historyFloor(true, undefined);
const since = historyFloor(false, 1000);
const never = historyFloor(false, undefined);
ok("history: unrestricted sees old posts", T.postWithinHistory(open, { authorId: "x", createdAt: 1 }, "bob"));
ok("history: restricted misses posts before the anchor", !T.postWithinHistory(since, { authorId: "x", createdAt: 999 }, "bob"));
ok("history: restricted sees posts after the anchor", T.postWithinHistory(since, { authorId: "x", createdAt: 1001 }, "bob"));
ok("history: own old posts always show", T.postWithinHistory(since, { authorId: "bob", createdAt: 1 }, "bob"));
ok("history: never opened sees nothing but their own", !T.postWithinHistory(never, { authorId: "x", createdAt: 5000 }, "bob") && T.postWithinHistory(never, { authorId: "bob", createdAt: 5000 }, "bob"));

// ---- slowmode exemption used by the list
ok("slowmode: ordinary member is not exempt", !isSlowmodeExempt(P.SEND_MESSAGES));
ok("slowmode: manage messages is exempt", isSlowmodeExempt(P.MANAGE_MESSAGES));
ok("slowmode: administrator is exempt", isSlowmodeExempt(P.ADMINISTRATOR));

ok("member cap is sensible", T.MAX_THREAD_MEMBERS >= 10 && T.MAX_THREAD_MEMBERS <= 100);

console.log(fails ? `${fails} FAILED (${passes} passed)` : `ALL PASSED (${passes})`); process.exit(fails ? 1 : 0);
