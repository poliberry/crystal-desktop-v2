import { readCache, setCacheNamespace, subscribeCache, writeCache } from "../../src/lib/persistent-cache";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });

// There is no IndexedDB here: the cache degrades to its in-memory map, which is what the notifications are about.
const counter = () => { let n = 0; return { hit: () => { n++; }, get n() { return n; } }; };

// ---- A write wakes only the readers of that key -------------------------------------------------------------------------
{
  const a = counter(), b = counter(), all = counter();
  const offA = subscribeCache("a", a.hit), offB = subscribeCache("b", b.hit), offAll = subscribeCache(null, all.hit);
  writeCache("a", 1);
  eq("a new key wakes its own reader", a.n, 1);
  eq("and not another key's", b.n, 0);
  eq("and not a reader of nothing in particular", all.n, 0);

  writeCache("a", 2);
  eq("replacing a value that was already there wakes nobody", a.n, 1);
  eq("the new value is what is read", readCache("a"), 2);

  writeCache("b", 1);
  eq("another new key wakes its reader", b.n, 1);
  eq("without waking the first again", a.n, 1);
  offA(); offB(); offAll();
}

// ---- Many writers, one reader: the old behaviour woke it every time ---------------------------------------------------------
{
  const reader = counter();
  const off = subscribeCache("watched", reader.hit);
  for (let i = 0; i < 200; i++) writeCache(`noise.${i % 20}`, i);
  eq("two hundred writes elsewhere don't wake a reader", reader.n, 0);
  writeCache("watched", "here");
  eq("its own key does", reader.n, 1);
  off();
}

// ---- Whole-cache changes still reach everyone -----------------------------------------------------------------------------
{
  const a = counter(), all = counter();
  const offA = subscribeCache("x", a.hit), offAll = subscribeCache(null, all.hit);
  setCacheNamespace("someone-else");
  eq("switching accounts wakes a keyed reader", a.n, 1);
  eq("and one watching nothing in particular", all.n, 1);
  eq("and empties what the last account left", readCache("x"), undefined);
  setCacheNamespace("someone-else");
  eq("choosing the same account again changes nothing", a.n, 1);
  offA(); offAll();
}

// ---- Unsubscribing really unsubscribes ------------------------------------------------------------------------------------
{
  const a = counter();
  const off = subscribeCache("gone", a.hit);
  off();
  writeCache("gone", 1);
  eq("a reader that left isn't woken", a.n, 0);
  off();
  ok("leaving twice is harmless", true);
}

// ---- A listener that unsubscribes while being told doesn't skip the others -------------------------------------------------
{
  const second = counter();
  let off1 = () => {};
  off1 = subscribeCache("shared", () => off1());
  const off2 = subscribeCache("shared", second.hit);
  writeCache("shared", 1);
  eq("the next listener still hears it", second.n, 1);
  off2();
}

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
