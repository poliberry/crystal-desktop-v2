import assert from "node:assert/strict";
import {
  IGNORE_DURATIONS,
  covers,
  endsAtFor,
  hasOpen,
  ignoredUntil,
  isHiddenAt,
  isMessageHidden,
  isOpen,
  type Window,
} from "../../convex/lib/blocking.ts";

let n = 0;
const test = (name: string, fn: () => void) => {
  try {
    fn();
    n++;
  } catch (e) {
    console.error(`FAIL ${name}\n`, e);
    process.exitCode = 1;
  }
};

const H = 3_600_000;
const T0 = 1_000_000_000_000;
const ignore = (startedAt: number, endsAt?: number): Window => ({ kind: "ignore", startedAt, endsAt });
const block = (startedAt: number, endsAt?: number): Window => ({ kind: "block", startedAt, endsAt });

test("a window with no end is open until lifted", () => {
  assert.equal(isOpen(ignore(T0), T0 + 1000 * H), true);
});

test("a window is open strictly before its end", () => {
  const w = ignore(T0, T0 + H);
  assert.equal(isOpen(w, T0 + H - 1), true);
  assert.equal(isOpen(w, T0 + H), false);
});

test("covers: start inclusive, end exclusive, nothing before the start", () => {
  const w = ignore(T0, T0 + H);
  assert.equal(covers(w, T0 - 1), false);
  assert.equal(covers(w, T0), true);
  assert.equal(covers(w, T0 + H - 1), true);
  assert.equal(covers(w, T0 + H), false);
});

test("messages sent during an ignore stay hidden after it expires", () => {
  const w = [ignore(T0, T0 + H)];
  const sentDuring = T0 + H / 2;
  const longAfter = T0 + 100 * H;
  // "now" is irrelevant to hiding: only when it was sent matters.
  assert.equal(isHiddenAt(w, sentDuring), true);
  assert.equal(isOpen(w[0], longAfter), false);
  assert.equal(isHiddenAt(w, sentDuring), true);
});

test("messages from before or after the window are visible", () => {
  const w = [ignore(T0, T0 + H)];
  assert.equal(isHiddenAt(w, T0 - 5 * H), false);
  assert.equal(isHiddenAt(w, T0 + 2 * H), false);
});

test("lifting early closes the window at that moment, keeping what was hidden", () => {
  const lifted = [ignore(T0, T0 + H / 2)]; // forever ignore lifted after 30 minutes
  assert.equal(isHiddenAt(lifted, T0 + H / 4), true);
  assert.equal(isHiddenAt(lifted, T0 + H), false);
});

test("several windows each hide their own span", () => {
  const w = [ignore(T0, T0 + H), ignore(T0 + 10 * H, T0 + 11 * H)];
  assert.equal(isHiddenAt(w, T0 + 5 * H), false);
  assert.equal(isHiddenAt(w, T0 + 10 * H + 1), true);
});

test("a block hides what arrives while it holds, same as an ignore", () => {
  const w = [block(T0)];
  assert.equal(isHiddenAt(w, T0 + 3 * H), true);
  assert.equal(isHiddenAt(w, T0 - 1), false);
});

test("no windows hide nothing", () => {
  assert.equal(isHiddenAt(undefined, T0), false);
  assert.equal(isHiddenAt([], T0), false);
});

test("hasOpen can be limited to one kind", () => {
  const w = [ignore(T0, T0 + H), block(T0 - 10)];
  assert.equal(hasOpen(w, T0 + 1, "ignore"), true);
  assert.equal(hasOpen(w, T0 + 2 * H, "ignore"), false);
  assert.equal(hasOpen(w, T0 + 2 * H, "block"), true);
  assert.equal(hasOpen(w, T0 + 2 * H), true);
  assert.equal(hasOpen([], T0), false);
});

test("ignoredUntil: nothing, an expiry, or never", () => {
  assert.equal(ignoredUntil([], T0), undefined);
  assert.equal(ignoredUntil([block(T0)], T0 + 1), undefined, "a block is not an ignore");
  assert.equal(ignoredUntil([ignore(T0, T0 + H)], T0 + 1), T0 + H);
  assert.equal(ignoredUntil([ignore(T0)], T0 + 1), null);
  assert.equal(ignoredUntil([ignore(T0, T0 + H)], T0 + 2 * H), undefined, "expired");
});

test("durations: presets, and forever has no end", () => {
  assert.equal(endsAtFor("1h", T0), T0 + H);
  assert.equal(endsAtFor("8h", T0), T0 + 8 * H);
  assert.equal(endsAtFor("24h", T0), T0 + 24 * H);
  assert.equal(endsAtFor("7d", T0), T0 + 7 * 24 * H);
  assert.equal(endsAtFor("forever", T0), undefined);
  assert.deepEqual(Object.keys(IGNORE_DURATIONS), ["1h", "8h", "24h", "7d", "forever"]);
});

test("isMessageHidden looks the author up by id and ignores everyone else", () => {
  const alice = "alice" as never;
  const bob = "bob" as never;
  const map = new Map<never, Window[]>([[alice, [ignore(T0, T0 + H)]]]);
  assert.equal(isMessageHidden(map, alice, T0 + 1), true);
  assert.equal(isMessageHidden(map, bob, T0 + 1), false);
  assert.equal(isMessageHidden(new Map(), alice, T0 + 1), false);
});

console.log(process.exitCode ? "FAILED" : `ALL PASSED (${n})`);
