"use client";

import { useSyncExternalStore } from "react";

import {
  deleteEntry,
  getBlob,
  loadUserEntries,
  putBlob,
  putEntry,
  type StoredBlob,
} from "@/lib/outbox-db";
import type {
  OutboxArgs,
  OutboxEntry,
  OutboxStatus,
  OutboxVariant,
  TargetKey,
} from "@/lib/outbox-types";

/**
 * The durable send outbox — messaging mutations are written here first, shown
 * optimistically (see src/lib/outbox-overlay.ts), then flushed to Convex by
 * src/components/outbox-flusher.tsx.
 *
 * Same architecture as src/lib/persistent-cache.ts: an in-memory `Map` mirror
 * is the synchronous source everything reads, kept in step by hand with the
 * (unawaited) IndexedDB writes, and a `useSyncExternalStore` tick re-renders
 * consumers whenever it changes. IndexedDB is what makes the queue survive a
 * reload; the mirror is what lets a render read it.
 *
 * Convex stays server-authoritative. Nothing here is a source of truth — an
 * entry exists only until its mutation lands, at which point the live
 * subscription's copy takes over and the entry (and any stashed bytes) is
 * deleted.
 */

/** Whose queue is in play. Set from `CacheScope` alongside `setCacheNamespace`
 * so an account switch can't flush one user's messages as another. */
let userId: string | null = null;

/** The current user's ops, keyed by id. Rebuilt on every account switch. */
const mirror = new Map<string, OutboxEntry>();

/** Highest `seq` handed out this session — seeded from the hydrated queue so
 * ordering survives a reload without persisting a counter of its own. */
let seqCounter = 0;

const hydrated = new Set<string>();

let onChange: (() => void) | null = null;

/** Registered by the flusher — poked whenever there's new work. */
export function setFlushRequester(fn: (() => void) | null): void {
  onChange = fn;
}

function requestFlush(): void {
  onChange?.();
}

// --- reactivity ------------------------------------------------------------

const listeners = new Set<() => void>();
let tick = 0;

function notify(): void {
  tick += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Changes whenever the queue does. `useOutboxOverlay` and the flush driver
 * subscribe to it. */
export function useOutboxTick(): number {
  return useSyncExternalStore(
    subscribe,
    () => tick,
    () => tick,
  );
}

// --- namespace ------------------------------------------------------------

export function setOutboxUser(next: string | null | undefined): void {
  const resolved = next ?? null;
  if (resolved === userId) return;
  userId = resolved;
  mirror.clear();
  seqCounter = 0;
  notify();
  if (resolved) void hydrate(resolved);
}

export function currentOutboxUser(): string | null {
  return userId;
}

async function hydrate(ns: string): Promise<void> {
  if (hydrated.has(ns)) {
    // Re-entering an account we've already loaded this session — the mirror
    // was cleared on switch-out, so re-read it, but the id set stays.
  }
  hydrated.add(ns);
  const entries = await loadUserEntries(ns);
  if (ns !== userId) return;
  for (const entry of entries) {
    // A row left mid-flight by a crash or an account switch is treated as
    // pending again: it either committed (the `clientId` dedupe covers a
    // resend) or it didn't.
    if (entry.status === "sending") entry.status = "pending";
    mirror.set(entry.id, entry);
    seqCounter = Math.max(seqCounter, entry.seq);
  }
  notify();
  if (mirror.size > 0) requestFlush();
}

// --- reads --------------------------------------------------------------

/** Every current-user entry, oldest first. */
export function getEntries(): OutboxEntry[] {
  return [...mirror.values()].sort((a, b) => a.seq - b.seq);
}

export function getEntriesForTarget(targetKey: TargetKey): OutboxEntry[] {
  return getEntries().filter((e) => e.targetKey === targetKey);
}

export function getEntry(id: string): OutboxEntry | undefined {
  return mirror.get(id);
}

// --- writes ------------------------------------------------------------

function persist(entry: OutboxEntry): void {
  mirror.set(entry.id, entry);
  void putEntry(entry);
}

function drop(id: string): void {
  mirror.delete(id);
  void deleteEntry(id);
}

export interface EnqueueInput {
  id: string;
  targetKey: TargetKey;
  variant: OutboxVariant;
  args: OutboxArgs;
}

/**
 * Add an op, applying the small set of coalescings that keep a long-offline
 * queue from replaying stale intermediate states. Returns the entry that was
 * actually enqueued, or `null` if the op collapsed into (or cancelled) an
 * existing one.
 */
export function enqueue(input: EnqueueInput): OutboxEntry | null {
  if (!userId) return null;
  const { args, targetKey } = input;
  const siblings = getEntriesForTarget(targetKey);

  // edit → fold into a pending edit of the same message, or into the pending
  // send itself if that's what's being edited.
  if (args.kind === "edit") {
    const pendingSend = siblings.find(
      (e) => e.kind === "send" && e.id === args.messageId && e.status !== "sending",
    );
    if (pendingSend && pendingSend.args.kind === "send") {
      pendingSend.args.text = args.text;
      persist(pendingSend);
      notify();
      requestFlush();
      return null;
    }
    const priorEdit = siblings.find(
      (e) =>
        e.kind === "edit" &&
        e.args.kind === "edit" &&
        e.args.messageId === args.messageId &&
        e.status !== "sending",
    );
    if (priorEdit && priorEdit.args.kind === "edit") {
      priorEdit.args.text = args.text;
      priorEdit.status = "pending";
      priorEdit.attempts = 0;
      priorEdit.nextAttemptAt = 0;
      persist(priorEdit);
      notify();
      requestFlush();
      return null;
    }
  }

  // delete of a still-pending send → the message never existed; drop the send
  // and anything queued against it.
  if (args.kind === "delete") {
    const pendingSend = siblings.find(
      (e) => e.kind === "send" && e.id === args.messageId && e.status !== "sending",
    );
    if (pendingSend) {
      for (const dependent of siblings) {
        if (
          dependent.args.kind !== "send" &&
          "messageId" in dependent.args &&
          dependent.args.messageId === args.messageId
        ) {
          drop(dependent.id);
        }
      }
      drop(pendingSend.id);
      notify();
      requestFlush();
      return null;
    }
  }

  // react add ↔ remove of the same (message, emoji) still pending → they
  // cancel out.
  if (args.kind === "react") {
    const opposite = siblings.find(
      (e) =>
        e.kind === "react" &&
        e.args.kind === "react" &&
        e.args.messageId === args.messageId &&
        e.args.emoji === args.emoji &&
        e.args.desired !== args.desired &&
        e.status !== "sending",
    );
    if (opposite) {
      drop(opposite.id);
      notify();
      requestFlush();
      return null;
    }
    const same = siblings.find(
      (e) =>
        e.kind === "react" &&
        e.args.kind === "react" &&
        e.args.messageId === args.messageId &&
        e.args.emoji === args.emoji &&
        e.status !== "sending",
    );
    if (same) return null; // already queued in the same direction
  }

  // markRead → keep only the newest per target.
  if (args.kind === "markRead") {
    for (const prior of siblings) {
      if (prior.kind === "markRead" && prior.status !== "sending") drop(prior.id);
    }
  }

  const entry: OutboxEntry = {
    id: input.id,
    userId,
    targetKey,
    kind: args.kind,
    variant: input.variant,
    createdAt: Date.now(),
    seq: ++seqCounter,
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    args,
  };
  persist(entry);
  notify();
  requestFlush();
  return entry;
}

export async function stashBlob(key: string, value: StoredBlob): Promise<boolean> {
  return putBlob(key, value);
}

export async function loadBlob(key: string): Promise<StoredBlob | undefined> {
  return getBlob(key);
}

// --- flusher-facing transitions -----------------------------------------

export function markSending(id: string): void {
  const entry = mirror.get(id);
  if (!entry) return;
  entry.status = "sending";
  entry.attempts += 1;
  persist(entry);
  notify();
}

export function markSent(id: string): void {
  drop(id);
  notify();
}

/**
 * A pending send has landed — rewrite every queued edit/delete/react that was
 * aimed at its client id so it now points at the real message id. Called by
 * the flusher right before it drops the send entry.
 */
export function remapMessageId(fromId: string, toId: string): void {
  let changed = false;
  for (const entry of mirror.values()) {
    if (
      entry.args.kind !== "send" &&
      entry.args.kind !== "markRead" &&
      entry.args.messageId === fromId
    ) {
      entry.args.messageId = toId;
      void putEntry(entry);
      changed = true;
    }
  }
  if (changed) notify();
}

export function setResolvedId(id: string, realId: string): void {
  const entry = mirror.get(id);
  if (!entry) return;
  entry.resolvedId = realId;
  persist(entry);
  notify();
}

const MAX_BACKOFF_MS = 60_000;

export function markFailed(id: string, error: string): void {
  const entry = mirror.get(id);
  if (!entry) return;
  entry.status = "failed";
  entry.lastError = error;
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** entry.attempts);
  entry.nextAttemptAt = Date.now() + base * (0.75 + Math.random() * 0.5);
  persist(entry);
  notify();
}

export function markBlocked(id: string, error: string): void {
  const entry = mirror.get(id);
  if (!entry) return;
  entry.status = "blocked";
  entry.lastError = error;
  persist(entry);
  notify();
}

// --- user-facing controls ---------------------------------------------

export function retryNow(id: string): void {
  const entry = mirror.get(id);
  if (!entry) return;
  entry.status = "pending";
  entry.attempts = 0;
  entry.nextAttemptAt = 0;
  entry.lastError = undefined;
  persist(entry);
  notify();
  requestFlush();
}

export function discard(id: string): void {
  drop(id);
  notify();
}

/** Statuses that mean "the flusher should look at this". */
export function isRunnable(entry: OutboxEntry, now: number): boolean {
  if (entry.status === "pending") return true;
  if (entry.status === "failed") return entry.nextAttemptAt <= now;
  return false;
}

export function nextWakeupAt(): number | null {
  let soonest: number | null = null;
  for (const entry of mirror.values()) {
    if (entry.status === "failed") {
      soonest = soonest === null ? entry.nextAttemptAt : Math.min(soonest, entry.nextAttemptAt);
    }
  }
  return soonest;
}
