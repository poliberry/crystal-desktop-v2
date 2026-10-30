// Run: bun scripts/tests/tts.test.mts
import { MAX_SPOKEN_CHARS, shouldSpeak, speechText } from "../../src/lib/tts";

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? passes++ : fails++; if (!c) console.log("FAIL", n, JSON.stringify(d)); };

const base = { tts: true, createdAt: 2000, liveAfter: 1000, alreadySpoken: false, enabled: true, windowActive: true };
ok("speaks a live TTS message", shouldSpeak(base));
ok("never a message without the flag", !shouldSpeak({ ...base, tts: false }));
ok("never history", !shouldSpeak({ ...base, createdAt: 1000 }) && !shouldSpeak({ ...base, createdAt: 5 }));
ok("never before the first page has loaded", !shouldSpeak({ ...base, liveAfter: null }));
ok("never twice", !shouldSpeak({ ...base, alreadySpoken: true }));
ok("never when the reader turned it off", !shouldSpeak({ ...base, enabled: false }));
ok("never when the window is not in front", !shouldSpeak({ ...base, windowActive: false }));
ok("a channel that was empty when opened speaks the first message", shouldSpeak({ ...base, liveAfter: 0, createdAt: 1 }));

ok("mentions", speechText("hi <@abc123> and <@&role9>") === "hi mention and role mention");
ok("custom emoji read by name", speechText("nice <:party_blob:k17x> one") === "nice party blob one");
ok("links", speechText("see https://example.com/a?b=1 now") === "see link now");
ok("markdown dropped", speechText("**bold** _it_ `code`") === "bold it code");
ok("code blocks", speechText("x ```js\nlet a = 1\n``` y") === "x code block y");
ok("whitespace collapsed", speechText("a \n\n  b") === "a b");
ok("clipped", speechText("a".repeat(1000)).length === MAX_SPOKEN_CHARS);
ok("empty stays empty", speechText("   ") === "");

console.log(fails ? `${fails} FAILED, ${passes} passed` : `ALL PASSED (${passes})`);
process.exit(fails ? 1 : 0);
