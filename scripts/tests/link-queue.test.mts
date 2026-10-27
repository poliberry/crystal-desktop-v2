import { LinkQueue, startsNewDocument } from "../../electron/linkQueue";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

// Which navigations discard the page. This was the bug: `did-start-loading` also fires for the
// things below that don't, so the queue was marked "not ready" and nothing re-marked it.
ok("a real page load starts a new document", startsNewDocument({ isMainFrame: true, isSameDocument: false }));
ok("an iframe loading does not (Clerk draws some)", !startsNewDocument({ isMainFrame: false, isSameDocument: false }));
ok("a same-document navigation does not (every in-app route change)", !startsNewDocument({ isMainFrame: true, isSameDocument: true }));
ok("an iframe's same-document navigation does not", !startsNewDocument({ isMainFrame: false, isSameDocument: true }));

const sent: string[] = [];
const q = new LinkQueue<string>((l) => void sent.push(l));
q.push("a"); q.push("b");
ok("links wait until the page says it is ready", sent.length === 0 && q.pending === 2 && !q.isReady);
q.markReady();
ok("…then go, oldest first", sent.join() === "a,b" && q.pending === 0 && q.isReady);
q.push("c");
ok("once ready, links go straight through", sent.join() === "a,b,c");
q.reset();
q.push("d");
ok("a new page: links wait again", sent.join() === "a,b,c" && q.pending === 1);
q.markReady();
q.markReady();
ok("ready twice doesn't repeat anything", sent.join() === "a,b,c,d");

// The sequence that stranded links: ready, then something that must NOT reset it.
const s2: string[] = [];
const q2 = new LinkQueue<string>((l) => void s2.push(l));
q2.markReady();
for (const nav of [{ isMainFrame: false, isSameDocument: false }, { isMainFrame: true, isSameDocument: true }]) if (startsNewDocument(nav)) q2.reset();
q2.push("invite");
ok("after an iframe and a route change the page is still ready, so a link is delivered", s2.join() === "invite", s2);

// A pile-up while nobody listens is bounded, newest kept.
const s3: string[] = [];
const q3 = new LinkQueue<number>((l) => void s3.push(String(l)), 3);
for (let i = 1; i <= 6; i++) q3.push(i);
q3.markReady();
ok("a long pile-up keeps only the newest few", s3.join() === "4,5,6", s3);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
