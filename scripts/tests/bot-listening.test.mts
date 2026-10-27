import { POLL_ALIVE_MS, canReceive } from "../../convex/lib/botEvents";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const bot = (o: Record<string, unknown>) => o as never;
const now = 1_000_000_000;

// Who is told about events at all. This was the bug: a bot with no endpoint was never told anything.
ok("an endpoint means it is pushed to", canReceive(bot({ endpointUrl: "https://b.example/x" }), now));
ok("…unless events were switched off after failures", !canReceive(bot({ endpointUrl: "https://b.example/x", eventsDisabledAt: 1 }), now));
ok("…or it is suspended", !canReceive(bot({ endpointUrl: "https://b.example/x", suspendedAt: 1 }), now));
ok("no endpoint and never asked: not listening (nothing is queued for a bot that is off)", !canReceive(bot({}), now));
ok("no endpoint, asked a moment ago: listening", canReceive(bot({ lastPolledAt: now - 5_000 }), now));
ok("still listening just inside the window (a poll waits up to 25 s)", canReceive(bot({ lastPolledAt: now - (POLL_ALIVE_MS - 1) }), now));
ok("stopped asking: not listening any more", !canReceive(bot({ lastPolledAt: now - POLL_ALIVE_MS }), now));
ok("a polling bot that is suspended is not listening", !canReceive(bot({ lastPolledAt: now - 1_000, suspendedAt: 1 }), now));
ok("the window comfortably outlasts one 25-second wait", POLL_ALIVE_MS >= 2 * 25_000);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
