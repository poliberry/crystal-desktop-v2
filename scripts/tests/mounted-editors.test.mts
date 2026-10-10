import { editorsToMount, holdsLiveState } from "../../src/studio/shell/mounted-editors";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const t = (id: string, kind: string) => ({ id, kind: kind as never });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join();

const tabs = [t("bot1", "bot"), t("deco", "decoration"), t("ext1", "extension"), t("plate", "nameplate"), t("pack", "pack")];

ok("switching away from a code project keeps it mounted (its terminals survive)", ids(editorsToMount(tabs, "deco")).includes("bot1") && ids(editorsToMount(tabs, "deco")).includes("ext1"));
ok("…whether or not it has unsaved files (that was the old rule, which killed a terminal in a clean project)", ids(editorsToMount(tabs, "plate")) === "bot1,ext1,plate");
ok("the active project is always mounted", ["bot1", "deco", "ext1", "plate", "pack"].every((id) => ids(editorsToMount(tabs, id)).includes(id)));
ok("a design that isn't active is unmounted (its state lives in the project and a history that outlives the editor)", !ids(editorsToMount(tabs, "bot1")).includes("deco") && !ids(editorsToMount(tabs, "bot1")).includes("plate") && !ids(editorsToMount(tabs, "bot1")).includes("pack"));
ok("with nothing active only code projects stay", ids(editorsToMount(tabs, null)) === "bot1,ext1");
ok("closing a tab removes its editor (it is no longer in the open list)", ids(editorsToMount(tabs.filter((x) => x.id !== "bot1"), "deco")) === "deco,ext1");
ok("order follows the tab order, so editors aren't remounted when the active tab changes", ids(editorsToMount(tabs, "deco")) === "bot1,deco,ext1" && ids(editorsToMount(tabs, "ext1")) === "bot1,ext1");
ok("an empty tab list is empty", editorsToMount([], "x").length === 0);
ok("only extension and bot projects hold live state", holdsLiveState({ kind: "bot" }) && holdsLiveState({ kind: "extension" }) && !["decoration", "sticker", "scene", "nameplate", "effect", "themePack", "pack"].some((k) => holdsLiveState({ kind: k as never })));

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
