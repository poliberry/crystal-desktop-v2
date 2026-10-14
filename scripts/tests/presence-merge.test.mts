/** Activities from several devices become one list; join gestures follow the double-click setting. */
import { mergeSessionActivities } from "../../convex/lib/activities.ts";
import { joinsOn } from "../../src/hooks/use-join-gesture.ts";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: unknown) {
  if (cond) passed++;
  else failures.push(name);
}

const game = { type: "playing", name: "Hades" } as const;
const song = { type: "listening", name: "Spotify", details: "Song" } as const;

check("a device reporting nothing doesn't erase another's game", JSON.stringify(mergeSessionActivities([
  { activities: [], created: 2 },
  { activities: [game], created: 1 },
])) === JSON.stringify([game]));
check("two devices' different activities are both kept", mergeSessionActivities([
  { activities: [song], created: 1 },
  { activities: [game], created: 2 },
]).length === 2);
check("kinds are ordered playing before listening", mergeSessionActivities([
  { activities: [song], created: 1 },
  { activities: [game], created: 2 },
])[0].type === "playing");
check("the same activity on two devices shows once", mergeSessionActivities([
  { activities: [game], created: 1 },
  { activities: [game], created: 2 },
]).length === 1);
check("no devices, no activities", mergeSessionActivities([]).length === 0);

check("setting off: a click joins", joinsOn(false, { type: "click", detail: 1 }));
check("setting on: a single click does not", !joinsOn(true, { type: "click", detail: 1 }));
check("setting on: a double click does", joinsOn(true, { type: "dblclick", detail: 2 }));
check("setting on: the second click of a double click alone does not", !joinsOn(true, { type: "click", detail: 2 }));
check("setting on: keyboard activation (click with detail 0) joins", joinsOn(true, { type: "click", detail: 0 }));
check("setting on: no event (programmatic) joins", joinsOn(true));

console.log(failures.length ? failures.map((f) => `FAIL ${f}`).join("\n") : `ALL PASSED (${passed})`);
process.exit(failures.length ? 1 : 0);
