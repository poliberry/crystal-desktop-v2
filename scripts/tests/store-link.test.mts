/** A project remembers which submission it was last sent as, so the next send is an update. Run: bun scripts/tests/store-link.test.mts */
import { decodeProjectFile, encodeProject } from "../../src/studio/storage/format";
import { newProject } from "../../src/studio/storage/use-projects";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

const base = newProject("decoration", "Halo");
const withLink = { ...base, store: { submissionId: "k57abc123def456ghi789", skuId: "jd7zzz999yyy888xxx777" } };
const text = encodeProject(withLink, "Halo", []).proj;
ok("the link is written to the project file", /\[store\]/.test(text) && text.includes("k57abc123def456ghi789") && text.includes("jd7zzz999yyy888xxx777"), text.slice(0, 600));
const back = decodeProjectFile(text).project;
ok("…and read back", back.store?.submissionId === "k57abc123def456ghi789" && back.store?.skuId === "jd7zzz999yyy888xxx777", back.store);
ok("a project that was never sent has no store section", !/\[store\]/.test(encodeProject(base, "Halo", []).proj) && decodeProjectFile(encodeProject(base, "Halo", []).proj).project.store === undefined);
const onlySubmission = decodeProjectFile(encodeProject({ ...base, store: { submissionId: "k57abc123def456ghi789" } }, "Halo", []).proj).project;
ok("the listing is optional (a first submission doesn't have one yet)", onlySubmission.store?.submissionId === "k57abc123def456ghi789" && onlySubmission.store.skuId === undefined);

// A project file can be hand-edited or copied: nothing odd gets through.
const evil = (s: string) => decodeProjectFile(text.replace("k57abc123def456ghi789", s)).project.store;
ok("an id that isn't a Convex id is dropped", evil("../../etc/passwd") === undefined && evil("a b") === undefined && evil("") === undefined && evil("x".repeat(80)) === undefined && evil("SHORT") === undefined);
const badSku = decodeProjectFile(text.replace("jd7zzz999yyy888xxx777", "not an id!")).project.store;
ok("a bad listing id is dropped but the submission id is kept", badSku?.submissionId === "k57abc123def456ghi789" && badSku.skuId === undefined);
ok("an invalid link isn't written out at all", !/\[store\]/.test(encodeProject({ ...base, store: { submissionId: "../x" } }, "Halo", []).proj));
const nested = decodeProjectFile(text.replace('submission_id = "k57abc123def456ghi789"', 'submission_id = 5')).project.store;
ok("a number where an id should be is dropped", nested === undefined);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
