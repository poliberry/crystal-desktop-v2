import { needsSwitchConfirmation } from "../../src/lib/call-switch";

let f = 0, p = 0;
const eq = (n: string, got: unknown, want: unknown) => { got === want ? p++ : (f++, console.log("FAIL", n, { got, want })); };

eq("in no call: just join", needsSwitchConfirmation(null, "c1"), false);
eq("undefined is no call either", needsSwitchConfirmation(undefined, "c1"), false);
eq("in a voice channel, joining another: ask", needsSwitchConfirmation({ kind: "channel", channelId: "c1" }, "c2"), true);
eq("in a DM call, joining a channel: ask", needsSwitchConfirmation({ kind: "dm" }, "c1"), true);
eq("joining the channel you're already in: no question", needsSwitchConfirmation({ kind: "channel", channelId: "c1" }, "c1"), false);
eq("a similar id is a different channel", needsSwitchConfirmation({ kind: "channel", channelId: "c1" }, "c10"), true);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
