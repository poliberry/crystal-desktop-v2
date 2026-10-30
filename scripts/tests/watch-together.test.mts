// Run: npx tsx scripts/tests/watch-together.test.mts
import { applyWatchAction, clockSkewMs, cleanTitle, expectedPositionMs, formatPosition, needsSeek, parseWatchSource, DRIFT_TOLERANCE_MS } from "../../convex/lib/watchTogether";

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => { JSON.stringify(got) === JSON.stringify(want) ? p++ : (f++, console.log("FAIL", n, { got, want })); };
const src = (raw: string) => { const r = parseWatchSource(raw); return r.ok ? r.value : r.reason; };

// Links.
eq("watch url", src("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), { provider: "youtube", source: "dQw4w9WgXcQ" });
eq("short url", src("https://youtu.be/dQw4w9WgXcQ?t=4"), { provider: "youtube", source: "dQw4w9WgXcQ" });
eq("embed url", src("https://www.youtube.com/embed/dQw4w9WgXcQ"), { provider: "youtube", source: "dQw4w9WgXcQ" });
eq("shorts url", src("https://youtube.com/shorts/dQw4w9WgXcQ"), { provider: "youtube", source: "dQw4w9WgXcQ" });
eq("mobile url", src("https://m.youtube.com/watch?v=dQw4w9WgXcQ&list=x"), { provider: "youtube", source: "dQw4w9WgXcQ" });
eq("a direct mp4", src("https://cdn.example.com/a/b.mp4?x=1"), { provider: "direct", source: "https://cdn.example.com/a/b.mp4?x=1" });
eq("a direct webm", (src("https://example.com/clip.WEBM") as { provider: string }).provider, "direct");
eq("not https", src("http://example.com/a.mp4"), "Only https links can be watched.");
eq("javascript: is refused", typeof src("javascript:alert(1)"), "string");
eq("file: is refused", typeof src("file:///etc/passwd"), "string");
eq("credentials in the url are refused", src("https://user:pw@example.com/a.mp4"), "That link can't be watched.");
eq("an ordinary web page is refused", typeof src("https://example.com/page"), "string");
eq("a lookalike host is refused", typeof src("https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ"), "string");
eq("a bad video id is refused", typeof src("https://www.youtube.com/watch?v=short"), "string");
eq("empty", src("  "), "Paste a link to a video.");
eq("not a url", src("hello"), "That doesn't look like a link.");
eq("too long", src("https://example.com/" + "a".repeat(2100) + ".mp4"), "That link is too long.");

// The clock.
const playing = { playing: true, positionMs: 10_000, updatedAt: 1_000 };
const paused = { playing: false, positionMs: 10_000, updatedAt: 1_000 };
eq("playing moves with time", expectedPositionMs(playing, 4_000), 13_000);
eq("paused does not", expectedPositionMs(paused, 4_000), 10_000);
eq("a clock behind the update never goes backwards", expectedPositionMs(playing, 500), 10_000);
eq("capped at the end", expectedPositionMs(playing, 100_000, 20_000), 20_000);

// Actions.
eq("pause lands where the host's player is", applyWatchAction(playing, { kind: "pause" }, 5_000, 14_321), { playing: false, positionMs: 14_321, updatedAt: 5_000 });
eq("pause without a report extrapolates", applyWatchAction(playing, { kind: "pause" }, 5_000), { playing: false, positionMs: 14_000, updatedAt: 5_000 });
eq("play resumes from the report", applyWatchAction(paused, { kind: "play" }, 9_000, 10_000), { playing: true, positionMs: 10_000, updatedAt: 9_000 });
eq("seek keeps playing", applyWatchAction(playing, { kind: "seek", positionMs: 60_000 }, 5_000), { playing: true, positionMs: 60_000, updatedAt: 5_000 });
eq("seek keeps paused", applyWatchAction(paused, { kind: "seek", positionMs: 60_000 }, 5_000), { playing: false, positionMs: 60_000, updatedAt: 5_000 });
eq("seek before the start clamps", applyWatchAction(paused, { kind: "seek", positionMs: -5 }, 5_000).positionMs, 0);

// Followers.
eq("small drift is left alone", needsSeek(10_000, 10_000 + DRIFT_TOLERANCE_MS - 1), false);
eq("large drift is corrected", needsSeek(10_000, 10_000 + DRIFT_TOLERANCE_MS + 1), true);
eq("behind is corrected too", needsSeek(20_000, 10_000), true);
eq("clock skew is local minus server", clockSkewMs(1_700_000_500_000, 1_700_000_000_000), 500_000);

// Text.
eq("positions", [formatPosition(0), formatPosition(65_000), formatPosition(3_725_000)], ["0:00", "1:05", "1:02:05"]);
eq("a title is one line", cleanTitle("  a\nb  "), "a b");
eq("an empty title is none", cleanTitle(" "), undefined);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
