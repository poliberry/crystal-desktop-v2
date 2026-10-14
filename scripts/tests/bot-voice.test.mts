import { OPERATIONS } from "../../convex/botOps";
import * as botVoice from "../../convex/botVoice";
import { ROUTES, matchRoute } from "../../convex/lib/botRoutes";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d))); };
const opOf = (method: string, path: string) => {
  const r = matchRoute(method, path);
  return r && "matched" in r ? r.matched.route.op : null;
};

// The gap that 404'd `POST /channels/<id>/voice/join` with "There's no such
// endpoint": the route was declared, but `voice.join` has no handler in
// `botOps.execute` — it is dispatched to the `botVoice` actions in botHttp.ts
// instead (only Node can mint a LiveKit token). Every declared op must be
// reachable one way or another: through `execute`, through a `botVoice`
// action, or through botHttp's own inline branch (`events.poll`, which waits).
// The action targets must exist.
const ACTION_DISPATCHED = new Set(["voice.join", "voice.leave", "events.poll"]);
const unreachable = ROUTES.map((r) => r.op).filter((op) => !OPERATIONS.includes(op) && !ACTION_DISPATCHED.has(op));
ok("every declared op is dispatched (execute or a botVoice action)", unreachable.length === 0, unreachable);
ok("voice.join is dispatched via action, not execute", !OPERATIONS.includes("voice.join") && ACTION_DISPATCHED.has("voice.join"));
ok("botVoice.join exists", typeof (botVoice as Record<string, unknown>).join === "function");
ok("botVoice.leave exists", typeof (botVoice as Record<string, unknown>).leave === "function");

// The exact calls, routed to the exact ops.
ok("POST .../voice/join → voice.join", opOf("POST", "/channels/kd7byr8txp4fn5c515jmsxfj2n8fvbr5/voice/join") === "voice.join");
ok("POST .../voice/leave → voice.leave", opOf("POST", "/channels/kd7byr8txp4fn5c515jmsxfj2n8fvbr5/voice/leave") === "voice.leave");
ok("GET .../voice → voice.list", opOf("GET", "/channels/kd7byr8txp4fn5c515jmsxfj2n8fvbr5/voice") === "voice.list");
ok("PUT .../voice/state → voice.state", opOf("PUT", "/channels/kd7byr8txp4fn5c515jmsxfj2n8fvbr5/voice/state") === "voice.state");

console.log(f ? `\n${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
