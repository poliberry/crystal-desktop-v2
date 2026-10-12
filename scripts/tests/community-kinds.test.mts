import { CHANNEL_SURFACES, surfaceAllowed } from "../../convex/lib/communityKinds";

let f = 0, p = 0;
const ok = (n: string, c: boolean) => { c ? p++ : (f++, console.log("FAIL", n)); };

// Game servers belong to whoever runs them, in any community.
ok("a standard community can have game servers", surfaceAllowed(undefined, "servers"));
ok("a clan can", surfaceAllowed("clan", "servers"));
ok("a creator community can", surfaceAllowed("creator", "servers"));

// Nothing else changed.
ok("a standard community still can't have a calendar", !surfaceAllowed(undefined, "calendar"));
ok("or threads", !surfaceAllowed(undefined, "threads"));
ok("or a feed", !surfaceAllowed(undefined, "feed"));
ok("a clan still can't have a feed", !surfaceAllowed("clan", "feed"));
ok("a creator community still can't have a roster", !surfaceAllowed("creator", "roster"));
ok("a clan can have a roster and LFG", surfaceAllowed("clan", "roster") && surfaceAllowed("clan", "lfg"));
ok("a creator community can have a feed and AMA", surfaceAllowed("creator", "feed") && surfaceAllowed("creator", "ama"));
ok("only game servers are open to a standard community", CHANNEL_SURFACES.filter((s) => surfaceAllowed(undefined, s)).join() === "servers");

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
