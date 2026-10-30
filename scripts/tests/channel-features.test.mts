// Run: bun scripts/tests/channel-features.test.mts
// Slowmode, history anchors, polls, voice messages and the permission gates behind them: the pure parts.
import { NEW_DEFAULT_EVERYONE_FLAGS, PERMISSIONS as P, can } from "../../convex/permissions";
import { bitsHas, bitsOr } from "../../convex/lib/permissionBits";
import * as S from "../../convex/lib/slowmodePure";
import * as H from "../../convex/lib/historyPure";
import * as Poll from "../../convex/lib/pollPure";
import * as V from "../../convex/lib/voicePure";

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? passes++ : fails++; if (!c) console.log("FAIL", n, JSON.stringify(d)); };
const throws = (n: string, f: () => unknown, re?: RegExp) => { try { f(); ok(n, false, "no throw"); } catch (e) { ok(n, !re || re.test(String((e as Error).message)), (e as Error).message); } };

// ---- permission gates: high flags only through the helpers
const none = 0;
const withBit = (flag: number) => bitsOr(P.VIEW_CHANNELS | P.SEND_MESSAGES, flag);
for (const k of ["SEND_TTS", "BYPASS_SLOWMODE", "CREATE_PRIVATE_THREADS", "CREATE_POLLS", "SEND_VOICE_MESSAGES", "USE_EXTERNAL_STICKERS"] as const) {
  ok(`${k}: holder passes`, can(withBit(P[k]), P[k]));
  ok(`${k}: non-holder fails`, !can(P.VIEW_CHANNELS | P.SEND_MESSAGES, P[k]));
  ok(`${k}: administrator bypass`, can(P.ADMINISTRATOR, P[k]));
  ok(`${k}: owner (all ones) bypass`, can(~0, P[k]));
  ok(`${k}: a different high flag doesn't grant it`, !can(withBit(P.VIEW_INSIGHTS), P[k]));
}
ok("READ_MESSAGE_HISTORY is a low flag", P.READ_MESSAGE_HISTORY < 2 ** 31);
ok("defaults on for @everyone: history, polls, voice messages, external stickers", ["READ_MESSAGE_HISTORY", "CREATE_POLLS", "SEND_VOICE_MESSAGES", "USE_EXTERNAL_STICKERS"].every((k) => bitsHas(NEW_DEFAULT_EVERYONE_FLAGS, P[k as keyof typeof P])));
ok("defaults off for @everyone: TTS, bypass slowmode, private threads", ["SEND_TTS", "BYPASS_SLOWMODE", "CREATE_PRIVATE_THREADS"].every((k) => !bitsHas(NEW_DEFAULT_EVERYONE_FLAGS, P[k as keyof typeof P])));

// ---- slowmode
ok("wait: off", S.slowmodeWaitMs(undefined, 1000, 2000) === 0 && S.slowmodeWaitMs(0, 1000, 2000) === 0);
ok("wait: never sent", S.slowmodeWaitMs(10, undefined, 5000) === 0);
ok("wait: mid-interval", S.slowmodeWaitMs(10, 1000, 4000) === 7000);
ok("wait: exactly elapsed", S.slowmodeWaitMs(10, 1000, 11000) === 0);
ok("wait: long past", S.slowmodeWaitMs(10, 1000, 99999) === 0);
ok("wait: clock moved backwards never exceeds the interval's worth plus skew", S.slowmodeWaitMs(10, 5000, 1000) === 14000);
ok("describe: seconds", S.describeWait(1) === "1 second" && S.describeWait(12_000) === "12 seconds");
ok("describe: rounds up", S.describeWait(1500) === "2 seconds" && S.describeWait(0) === "1 second");
ok("describe: minutes and hours", S.describeWait(65_000) === "1 minute 5 seconds" && S.describeWait(3_600_000) === "1 hour" && S.describeWait(7_325_000) === "2 hours 2 minutes 5 seconds");
ok("message mentions the wait", /12 seconds/.test(S.slowmodeMessage(12_000)));
ok("error carries the wait", new S.SlowmodeError(3000).waitMs === 3000 && /3 seconds/.test(new S.SlowmodeError(3000).message));
ok("clean: valid", S.cleanSlowmodeSeconds(0) === 0 && S.cleanSlowmodeSeconds(21600) === 21600);
for (const bad of [-1, 1.5, 21601, NaN, Infinity]) throws(`clean: ${bad} refused`, () => S.cleanSlowmodeSeconds(bad), /Slowmode/);
ok("every offered choice is valid", S.SLOWMODE_CHOICES.every((n) => { try { return S.cleanSlowmodeSeconds(n) === n; } catch { return false; } }));
ok("exempt: bypass flag", S.isSlowmodeExempt(P.VIEW_CHANNELS | P.SEND_MESSAGES) === false && S.isSlowmodeExempt(withBit(P.BYPASS_SLOWMODE)));
ok("exempt: manage messages / channels / administrator / owner", S.isSlowmodeExempt(P.MANAGE_MESSAGES) && S.isSlowmodeExempt(P.MANAGE_CHANNELS) && S.isSlowmodeExempt(P.ADMINISTRATOR) && S.isSlowmodeExempt(~0));
ok("exempt: pin messages alone is not enough", !S.isSlowmodeExempt(P.PIN_MESSAGES) && !S.isSlowmodeExempt(none));
ok("label", S.slowmodeLabel(0) === "Off" && S.slowmodeLabel(5) === "5s" && S.slowmodeLabel(300) === "5m" && S.slowmodeLabel(7200) === "2h");

// ---- history
const open = H.historyFloor(true, undefined);
const anchored = H.historyFloor(false, 1000);
const never = H.historyFloor(false, undefined);
ok("history: holder sees everything", !open.restricted && H.withinHistory(open, 0));
ok("history: anchored sees after the anchor only", H.withinHistory(anchored, 1001) && !H.withinHistory(anchored, 1000) && !H.withinHistory(anchored, 5));
ok("history: never opened sees nothing", !H.withinHistory(never, Number.MAX_SAFE_INTEGER));
ok("history: holder's anchor is ignored", !H.historyFloor(true, 5000).restricted);
ok("history: filter", JSON.stringify(H.filterByHistory(anchored, [{ t: 500 }, { t: 1500 }, { t: 2500 }], (r) => r.t)) === JSON.stringify([{ t: 1500 }, { t: 2500 }]));
ok("history: filter is a no-op for holders", H.filterByHistory(open, [{ t: 1 }], (r) => r.t).length === 1);
ok("anchor: first open", H.anchorOnOpen(undefined, 5000) === 5000);
ok("anchor: quick revisit keeps the old one", H.anchorOnOpen(5000, 5000 + H.ANCHOR_GRACE_MS - 1) === 5000);
ok("anchor: later visit moves it", H.anchorOnOpen(5000, 5000 + H.ANCHOR_GRACE_MS) === 5000 + H.ANCHOR_GRACE_MS);
ok("anchor: an anchor in the future is replaced", H.anchorOnOpen(9000, 5000) === 5000);

// ---- polls
const base = { question: "  Best   colour? ", options: ["Red", " Blue ", "Green"] };
const now = 1_000_000;
const p = Poll.cleanPoll(base, now, false);
ok("poll: plaintext cleaned", p.question === "Best colour?" && p.options?.length === 3 && p.options[1].text === "Blue" && p.optionCount === 3 && p.multi === false && p.expiresAt === undefined);
ok("poll: ids are positions", p.options!.every((o, i) => o.id === i));
ok("poll: duration sets expiry", Poll.cleanPoll({ ...base, durationMs: 3_600_000 }, now, false).expiresAt === now + 3_600_000);
ok("poll: multi", Poll.cleanPoll({ ...base, multi: true }, now, false).multi);
throws("poll: no question", () => Poll.cleanPoll({ ...base, question: "  " }, now, false), /question/);
throws("poll: one option", () => Poll.cleanPoll({ question: "q", options: ["a", " "] }, now, false), /at least 2/);
throws("poll: eleven options", () => Poll.cleanPoll({ question: "q", options: Array.from({ length: 11 }, (_, i) => `o${i}`) }, now, false), /up to 10/);
ok("poll: ten options fine", Poll.cleanPoll({ question: "q", options: Array.from({ length: 10 }, (_, i) => `o${i}`) }, now, false).optionCount === 10);
throws("poll: duplicate options", () => Poll.cleanPoll({ question: "q", options: ["a", "A"] }, now, false), /same/);
throws("poll: long option", () => Poll.cleanPoll({ question: "q", options: ["a", "b".repeat(101)] }, now, false), /option/);
throws("poll: long question", () => Poll.cleanPoll({ question: "q".repeat(301), options: ["a", "b"] }, now, false), /question/);
throws("poll: too-short duration", () => Poll.cleanPoll({ ...base, durationMs: 10 }, now, false), /minute/);
throws("poll: too-long duration", () => Poll.cleanPoll({ ...base, durationMs: 15 * 86400000 }, now, false), /two weeks/);
throws("poll: NaN duration", () => Poll.cleanPoll({ ...base, durationMs: NaN }, now, false), /minute/);
const enc = Poll.cleanPoll({ optionCount: 4, multi: true }, now, true);
ok("poll: encrypted keeps only counts", enc.optionCount === 4 && enc.question === undefined && enc.options === undefined && enc.multi);
throws("poll: encrypted must not carry words", () => Poll.cleanPoll({ ...base, optionCount: 3 }, now, true), /inside the encrypted/);
throws("poll: encrypted needs a sane count", () => Poll.cleanPoll({ optionCount: 1 }, now, true), /options/);
throws("poll: encrypted count of 11", () => Poll.cleanPoll({ optionCount: 11 }, now, true), /options/);
ok("poll: text check for the sender's client", Poll.cleanPollText(" q ", ["a", "b"]).question === "q");
ok("poll: control characters stripped", Poll.cleanPollText("q‮", ["a\u0007", "b"]).options[0] === "a");
// open / closed
ok("poll open: no expiry", Poll.pollIsOpen({}, now));
ok("poll open: before expiry", Poll.pollIsOpen({ expiresAt: now + 1 }, now) && !Poll.pollIsOpen({ expiresAt: now }, now) && !Poll.pollIsOpen({ expiresAt: now - 1 }, now));
ok("poll closed: ended early", !Poll.pollIsOpen({ endedAt: now - 5 }, now) && !Poll.pollIsOpen({ endedAt: 1, expiresAt: now + 99999 }, now));
// voting
const single = { optionCount: 3, multi: false } as Poll.StoredPoll;
const multi = { optionCount: 3, multi: true } as Poll.StoredPoll;
ok("vote: single choice", JSON.stringify(Poll.validateVote(single, [1], now)) === "[1]");
throws("vote: single can't take two", () => Poll.validateVote(single, [0, 1], now), /one answer/);
ok("vote: multi takes several, deduped", JSON.stringify(Poll.validateVote(multi, [2, 0, 2], now)) === "[2,0]");
ok("vote: empty takes it back", Poll.validateVote(single, [], now).length === 0);
throws("vote: unknown option", () => Poll.validateVote(multi, [3], now), /options/);
throws("vote: negative option", () => Poll.validateVote(multi, [-1], now), /options/);
throws("vote: fractional option", () => Poll.validateVote(multi, [0.5], now), /options/);
throws("vote: closed by expiry", () => Poll.validateVote({ ...single, expiresAt: now - 1 }, [0], now), /ended/);
throws("vote: closed by author", () => Poll.validateVote({ ...single, endedAt: now - 1 }, [0], now), /ended/);
ok("vote: just before expiry", Poll.validateVote({ ...single, expiresAt: now + 1 }, [0], now).length === 1);
// tally
const votes = [
  { userId: "a", optionId: 0 }, { userId: "b", optionId: 0 }, { userId: "b", optionId: 2 },
  { userId: "c", optionId: 1 }, { userId: "d", optionId: 9 },
];
const t = Poll.tallyVotes(multi, votes, "b");
ok("tally: counts", t.counts[0] === 2 && t.counts[1] === 1 && t.counts[2] === 1 && !(9 in t.counts));
ok("tally: voters counted once, junk ignored", t.voters === 3);
ok("tally: mine", JSON.stringify(t.mine) === "[0,2]");
ok("tally: leading", JSON.stringify(t.leading) === "[0]");
ok("tally: tie", JSON.stringify(Poll.tallyVotes(single, [{ userId: "a", optionId: 0 }, { userId: "b", optionId: 1 }], "z").leading) === "[0,1]");
const empty = Poll.tallyVotes(single, [], "a");
ok("tally: nobody voted", empty.voters === 0 && empty.leading.length === 0 && empty.counts[0] === 0 && empty.mine.length === 0);

// ---- voice messages
const audio = [{ fileName: "voice.webm", fileType: "audio/webm" }];
const wave = Array.from({ length: 64 }, (_, i) => i * 4);
ok("voice: valid", V.cleanVoiceMessage({ durationMs: 12_345.6, waveform: wave }, audio, { hasText: false }).durationMs === 12346);
ok("voice: waveform clamped", JSON.stringify(V.cleanVoiceMessage({ durationMs: 1000, waveform: [-5, 300, NaN, 7.4] }, audio, { hasText: false }).waveform) === "[0,255,0,7]");
ok("voice: five minutes exactly", V.cleanVoiceMessage({ durationMs: V.MAX_VOICE_MS, waveform: wave }, audio, { hasText: false }).durationMs === V.MAX_VOICE_MS);
throws("voice: over five minutes", () => V.cleanVoiceMessage({ durationMs: V.MAX_VOICE_MS + V.VOICE_SLACK_MS + 1, waveform: wave }, audio, { hasText: false }), /5 minutes/);
throws("voice: empty recording", () => V.cleanVoiceMessage({ durationMs: 0, waveform: wave }, audio, { hasText: false }), /empty/);
throws("voice: no attachment", () => V.cleanVoiceMessage({ durationMs: 1000, waveform: wave }, [], { hasText: false }), /single recording/);
throws("voice: two attachments", () => V.cleanVoiceMessage({ durationMs: 1000, waveform: wave }, [...audio, ...audio], { hasText: false }), /single recording/);
throws("voice: an image is not a recording", () => V.cleanVoiceMessage({ durationMs: 1000, waveform: wave }, [{ fileName: "a.png", fileType: "image/png" }], { hasText: false }), /audio/);
ok("voice: type repaired from the extension", V.cleanVoiceMessage({ durationMs: 1000, waveform: wave }, [{ fileName: "v.ogg", fileType: "application/octet-stream" }], { hasText: false }).durationMs === 1000);
ok("voice: browsers label audio-only webm video/webm", V.cleanVoiceMessage({ durationMs: 1000, waveform: wave }, [{ fileName: "v.webm", fileType: "video/webm" }], { hasText: false }).durationMs === 1000);
throws("voice: no text", () => V.cleanVoiceMessage({ durationMs: 1000, waveform: wave }, audio, { hasText: true }), /text/);
throws("voice: oversized waveform", () => V.cleanVoiceMessage({ durationMs: 1000, waveform: new Array(500).fill(1) }, audio, { hasText: false }), /waveform/);
const bars = V.waveformFromSamples([0, 0.5, -1, 0.25], 2);
ok("voice: waveform from samples is peak per bar", JSON.stringify(bars) === "[128,255]");
ok("voice: silent input gives flat bars", V.waveformFromSamples([], 4).every((b) => b === 0) && V.waveformFromSamples([], 4).length === 4);

console.log(fails ? `${fails} FAILED, ${passes} passed` : `ALL PASSED (${passes})`);
process.exit(fails ? 1 : 0);
