/**
 * The device's end-to-end encryption state: the identity key, the room keys unwrapped from it, and
 * the operations the rest of the app calls (`getE2ee()`). One instance per page, usable outside React
 * (the outbox flusher encrypts from there). The React side lives in `provider.tsx`.
 *
 * What is trusted, and what is not, is in docs/E2EE.md. In short: the server hands us wraps and
 * recipient keys and we believe them, because it decides who is in a room anyway; it cannot read what
 * we encrypt except while a room is escrowed.
 */
import type { ConvexReactClient } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { openAtRest, sealAtRest } from "./atrest";
import { createBatcher, Lru } from "./batch";
import {
  decryptMessage,
  encryptMessage,
  fingerprintOf,
  formatRecoverySecret,
  generateIdentity,
  generateRecoverySecret,
  generateRoomKey,
  makeBackup,
  openBackup,
  parseRecoverySecret,
  unwrapRoomKey,
  wrapRoomKey,
  type Envelope,
  type Identity,
  type MessageContext,
  type MessagePayload,
} from "./crypto";
import { isElectron } from "@/lib/desktop";

import { getKeystore } from "./keystore";
import { deriveStatus, type E2eeStatus, type LocalIdentityFact, type ServerIdentityFact } from "./state";

export type { E2eeStatus } from "./state";
export type { Envelope, MessagePayload } from "./crypto";

export type Room =
  | { scope: "conversation"; conversationId: Id<"conversations"> }
  | { scope: "channel"; channelId: Id<"channels"> };

export interface E2eeClient {
  /** Encrypt for the room's CURRENT epoch; creates or rotates the epoch (api.e2eeKeys.current/recipients/createEpoch) when none exists or needsRotation. Waits for status "ready". */
  encrypt(
    room: Room,
    authorId: Id<"users">,
    payload: { text?: string; embeds?: unknown[]; components?: unknown[] },
  ): Promise<{ enc: Envelope & { keyId: Id<"e2eeKeys"> }; escrowed: boolean }>;
  /** null when we hold no key for enc.keyId (yet) or it fails to authenticate. Caches unwrapped room keys in memory. */
  decrypt(room: Room, authorId: Id<"users">, enc: Envelope): Promise<MessagePayload | null>;
  /** Seals JSON to a bot's public key (for slash-command args). Returns a w1-style string. */
  sealToBot(botPublicKey: string, data: unknown): Promise<string>;
  /** Wraps every epoch we hold to people waiting in api.e2eeKeys.pendingWrapRequests. Returns how many were fulfilled. */
  fulfilPendingWraps(): Promise<number>;
  /** Device-local encryption of cached plaintext (search index etc.), keyed from the identity key. */
  atRest: { seal(bytes: Uint8Array): Promise<Uint8Array>; open(bytes: Uint8Array): Promise<Uint8Array | null> };
}

export class E2eeError extends Error {
  constructor(
    readonly code: "not-ready" | "unavailable" | "no-key" | "recipients" | "server",
    message: string,
  ) {
    super(message);
    this.name = "E2eeError";
  }
}

export type KeyringSnapshot = {
  status: E2eeStatus;
  /** The identity this device holds, in groups of 4 hex digits. */
  fingerprint: string | null;
  /** Whether the key survives a restart. False where the OS has no keystore: the recovery key is asked for each launch. */
  persistent: boolean | null;
  /** Bumped whenever a decryption that failed might now succeed (new identity, retry tick). */
  version: number;
};

/** A freshly generated identity, shown to the person before anything is uploaded. */
export type PendingIdentity = {
  /** `ABCD-EFGH-…`. Shown once. */
  recoveryKey: string;
  fingerprint: string;
  /** Registers it with the server and stores it on this device. */
  commit(): Promise<void>;
};

// ---------------------------------------------------------------------------------------------
// Server shapes (see docs/E2EE.md, "Convex functions"). Read leniently: the server is another
// workstream, and a field it adds must not break us.
// ---------------------------------------------------------------------------------------------

type CurrentEpoch = { keyId: string; epoch: number; escrowed: boolean; needsRotation: boolean; myWrap?: string | null };
type Recipient = { userId?: Id<"users">; botId?: Id<"bots">; publicKey?: string | null };

const MISS_TTL_MS = 15_000;
const READY_TIMEOUT_MS = 60_000;
const NO_WRAP_RETRIES = 3;
const NO_WRAP_DELAY_MS = 1_000;
const WRAP_CHUNK = 50;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function roomArgs(room: Room) {
  return room.scope === "conversation"
    ? ({ scope: "conversation", conversationId: room.conversationId } as const)
    : ({ scope: "channel", channelId: room.channelId } as const);
}

const targetOf = (room: Room): string => (room.scope === "conversation" ? room.conversationId : room.channelId);
const roomName = (room: Room): string => `${room.scope}:${targetOf(room)}`;

const encoder = new TextEncoder();

class Keyring implements E2eeClient {
  private convex: ConvexReactClient | null = null;
  private account: string | null = null;
  private authenticated = false;
  private identity: Identity | null = null;
  private local: LocalIdentityFact = undefined;
  private server: ServerIdentityFact = undefined;
  private persistent: boolean | null = null;
  /** Bumped on every account change so work that was in flight for the last account drops its result. */
  private generation = 0;

  private listeners = new Set<() => void>();
  private snap: KeyringSnapshot = { status: "loading", fingerprint: null, persistent: null, version: 0 };

  private keys = new Map<string, Uint8Array<ArrayBuffer>>();
  private inflight = new Map<string, Promise<Uint8Array<ArrayBuffer> | null>>();
  private misses = new Map<string, number>();
  private plain = new Lru<MessagePayload>(2000);
  private lanes = new Map<string, Promise<unknown>>();
  private systemAuthors = new Set<string>();
  private fulfilling: Promise<number> | null = null;

  /** Every epoch id asked for in the same few milliseconds goes out as one `wrapsForMe`. */
  private wraps = createBatcher<string>({
    fetch: async (keyIds) => {
      const found = await this.client().query(api.e2eeKeys.wrapsForMe, { keyIds: keyIds as Id<"e2eeKeys">[] });
      return found as Record<string, string | undefined>;
    },
  });

  // -- store ----------------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): KeyringSnapshot => this.snap;

  /** The account whose keys are loaded, or null when signed out. */
  get accountId(): string | null {
    return this.account;
  }

  private publish(bump: boolean) {
    const status = deriveStatus({
      cryptoAvailable: typeof crypto !== "undefined" && !!crypto.subtle,
      authenticated: this.authenticated,
      server: this.server,
      local: this.local,
    });
    const fingerprint = this.identity?.fingerprint ?? null;
    const prev = this.snap;
    if (!bump && prev.status === status && prev.fingerprint === fingerprint && prev.persistent === this.persistent) return;
    this.snap = {
      status,
      fingerprint,
      persistent: this.persistent,
      version: prev.version + (bump || prev.status !== status ? 1 : 0),
    };
    for (const listener of this.listeners) listener();
  }

  // -- facts pushed in by the provider ------------------------------------------------------------

  configure(convex: ConvexReactClient) {
    this.convex = convex;
  }

  private client(): ConvexReactClient {
    if (!this.convex) throw new E2eeError("not-ready", "Encryption is not running yet.");
    return this.convex;
  }

  /** `null` when signed out. A different account means a different key store entry and empty caches. */
  setAccount(userId: string | null) {
    if (userId === this.account && this.authenticated === (userId !== null)) return;
    const changed = userId !== this.account;
    this.account = userId;
    this.authenticated = userId !== null;
    if (!changed) {
      this.publish(false);
      return;
    }
    this.generation++;
    this.identity = null;
    this.local = undefined;
    this.server = undefined;
    this.clearCaches();
    this.publish(true);
    if (userId) void this.loadLocal(userId, this.generation);
  }

  setServer(identity: { publicKey: string } | null | undefined) {
    this.server = identity === undefined ? undefined : identity === null ? null : { publicKey: identity.publicKey };
    this.publish(false);
    this.maybeAutoUnlock();
  }

  private async loadLocal(userId: string, generation: number) {
    const store = getKeystore();
    const [saved, persistent] = await Promise.all([store.load(userId), store.persistent()]);
    const identity: Identity | null = saved ? { ...saved, fingerprint: await fingerprintOf(saved.publicKey) } : null;
    if (generation !== this.generation) return;
    this.persistent = persistent;
    // Something may have been set up while the store was being read; that one wins.
    if (!this.identity) this.identity = identity;
    this.local = this.identity ? { publicKey: this.identity.publicKey } : null;
    this.publish(true);
    this.maybeAutoUnlock();
  }

  private clearCaches() {
    this.keys.clear();
    this.inflight.clear();
    this.misses.clear();
    this.plain.clear();
  }

  /** Called on a timer and on window focus: a key that was missing a moment ago may have been wrapped to us since. */
  retryMissing() {
    if (this.misses.size === 0) return;
    this.misses.clear();
    this.publish(true);
  }

  /** Authors whose plaintext rows are expected (the Crystal system account). Fed by whoever can tell which user that is. */
  registerSystemAuthors(ids: Iterable<string>) {
    for (const id of ids) this.systemAuthors.add(id);
  }

  isSystemAuthor(id: string): boolean {
    return this.systemAuthors.has(id);
  }

  // -- readiness ----------------------------------------------------------------------------------

  private whenReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
    const check = (): "yes" | "no" | "never" => {
      const { status } = this.snap;
      return status === "ready" ? "yes" : status === "unavailable" ? "never" : "no";
    };
    const now = check();
    if (now === "yes") return Promise.resolve();
    if (now === "never") return Promise.reject(new E2eeError("unavailable", "Encryption is not available here."));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        const { status } = this.snap;
        reject(
          new E2eeError(
            "not-ready",
            status === "needs-setup"
              ? "Set up encryption before sending messages."
              : status === "needs-unlock"
                ? "Enter your recovery key to unlock encryption on this device."
                : "Encryption is still starting.",
          ),
        );
      }, timeoutMs);
      const off = this.subscribe(() => {
        const state = check();
        if (state === "no") return;
        clearTimeout(timer);
        off();
        if (state === "yes") resolve();
        else reject(new E2eeError("unavailable", "Encryption is not available here."));
      });
    });
  }

  private requireIdentity(): Identity {
    if (!this.identity || this.snap.status !== "ready") throw new E2eeError("not-ready", "Encryption is locked.");
    return this.identity;
  }

  // -- room keys ----------------------------------------------------------------------------------

  /** `known` is a wrap the server already handed us (e.g. `current().myWrap`), which saves the round trip. */
  private roomKey(keyId: string, known?: string | null): Promise<Uint8Array<ArrayBuffer> | null> {
    const hit = this.keys.get(keyId);
    if (hit) return Promise.resolve(hit);
    const pending = this.inflight.get(keyId);
    if (pending) return pending;
    const missedAt = this.misses.get(keyId);
    if (!known && missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return Promise.resolve(null);

    const generation = this.generation;
    const identity = this.identity;
    const run = (async () => {
      if (!identity) return null;
      let wrapped: string | null | undefined = known;
      if (!wrapped) {
        try {
          wrapped = await this.wraps.load(keyId);
        } catch {
          // Offline or the server errored: say nothing about the key, so the next look tries again at once.
          return null;
        }
      }
      if (generation !== this.generation) return null;
      if (!wrapped) {
        this.misses.set(keyId, Date.now());
        return null;
      }
      try {
        const key = await unwrapRoomKey(wrapped, identity.privateKey, identity.publicKey);
        if (generation === this.generation) this.keys.set(keyId, key);
        return key;
      } catch {
        // A wrap that does not open with our key: a stale one from before a reset, or tampering. Not retried at once.
        this.misses.set(keyId, Date.now());
        return null;
      }
    })().finally(() => {
      if (this.inflight.get(keyId) === run) this.inflight.delete(keyId);
    });
    this.inflight.set(keyId, run);
    return run;
  }

  // -- E2eeClient ---------------------------------------------------------------------------------

  /** Messages already decrypted this session, found without waiting. `undefined`: not yet known. */
  peek(room: Room, authorId: string, enc: Envelope): MessagePayload | undefined {
    return this.plain.get(this.plainKey(room, authorId, enc));
  }

  private plainKey(room: Room, authorId: string, enc: Envelope): string {
    return `${roomName(room)}|${authorId}|${enc.keyId}|${enc.iv}`;
  }

  async decrypt(room: Room, authorId: Id<"users">, enc: Envelope): Promise<MessagePayload | null> {
    if (this.snap.status !== "ready") return null;
    const cacheKey = this.plainKey(room, authorId, enc);
    const cached = this.plain.get(cacheKey);
    if (cached) return cached;
    const generation = this.generation;
    const key = await this.roomKey(enc.keyId);
    if (!key || generation !== this.generation) return null;
    try {
      const context: MessageContext = { scope: room.scope, targetId: targetOf(room), keyId: enc.keyId, authorId };
      const payload = await decryptMessage(key, enc, context);
      // The account changed while this was in flight: its plaintext belongs to the last one, and must
      // neither be returned nor land in the new account's (just cleared) cache.
      if (generation !== this.generation) return null;
      this.plain.set(cacheKey, payload);
      return payload;
    } catch {
      return null;
    }
  }

  encrypt(room: Room, authorId: Id<"users">, payload: { text?: string; embeds?: unknown[]; components?: unknown[] }) {
    // One sender at a time per room: two messages typed together must not each start an epoch.
    return this.inLane(roomName(room), async () => {
      await this.whenReady();
      return this.encryptNow(room, authorId, payload);
    });
  }

  private inLane<T>(name: string, run: () => Promise<T>): Promise<T> {
    const previous = this.lanes.get(name) ?? Promise.resolve();
    const next = previous.then(run, run);
    this.lanes.set(name, next);
    const clear = () => {
      if (this.lanes.get(name) === next) this.lanes.delete(name);
    };
    next.then(clear, clear);
    return next;
  }

  private async encryptNow(room: Room, authorId: Id<"users">, payload: { text?: string; embeds?: unknown[]; components?: unknown[] }) {
    const convex = this.client();
    const args = roomArgs(room);
    const context = (keyId: string): MessageContext => ({ scope: room.scope, targetId: targetOf(room), keyId, authorId });

    for (let attempt = 0; attempt < NO_WRAP_RETRIES; attempt++) {
      const current = (await convex.query(api.e2eeKeys.current, args)) as CurrentEpoch | null;

      if (!current || current.needsRotation) {
        const created = await this.startEpoch(room, authorId);
        return { enc: await encryptMessage(created.roomKey, payload, context(created.keyId)) as Envelope & { keyId: Id<"e2eeKeys"> }, escrowed: created.escrowed };
      }

      const key = await this.roomKey(current.keyId, current.myWrap);
      if (key) return { enc: await encryptMessage(key, payload, context(current.keyId)) as Envelope & { keyId: Id<"e2eeKeys"> }, escrowed: current.escrowed };

      // Members of a room get their wrap from whoever is online (or from the escrow onboarding job, a few
      // seconds after setup). Starting a second epoch to get around that would only be refused while the
      // first is current, so wait a little and look again.
      await sleep(NO_WRAP_DELAY_MS);
    }
    throw new E2eeError("no-key", "You don't have this conversation's encryption key yet. Ask someone in it to open Crystal.");
  }

  /** Makes a room key, wraps it to everyone who can be, and registers it as the newest epoch. */
  private async startEpoch(room: Room, authorId: Id<"users">) {
    const identity = this.requireIdentity();
    const convex = this.client();
    const recipients = (await convex.query(api.e2eeKeys.recipients, roomArgs(room))) as Recipient[];
    if (!recipients.some((r) => r.userId === authorId)) {
      throw new E2eeError("recipients", "You are not a member of this conversation.");
    }

    const roomKey = generateRoomKey();
    const wraps: { userId?: Id<"users">; botId?: Id<"bots">; wrapped: string }[] = [];
    let withoutKey = 0;
    for (let i = 0; i < recipients.length; i += WRAP_CHUNK) {
      const done = await Promise.all(
        recipients.slice(i, i + WRAP_CHUNK).map(async (r) => {
          // Our own key is the one we hold, not whatever the server says it is: a wrong answer here would
          // lock us out of our own message.
          const publicKey = r.userId === authorId ? identity.publicKey : r.publicKey;
          if (!publicKey) {
            withoutKey++;
            return null;
          }
          const wrapped = await wrapRoomKey(roomKey, publicKey);
          return r.userId ? { userId: r.userId, wrapped } : r.botId ? { botId: r.botId, wrapped } : null;
        }),
      );
      for (const w of done) if (w) wraps.push(w);
    }

    const escrowWrap = withoutKey > 0 ? await this.escrowWrapFor(roomKey, recipients) : undefined;
    const result = await convex.mutation(api.e2eeKeys.createEpoch, {
      ...roomArgs(room),
      wraps,
      ...(escrowWrap ? { escrowWrap } : {}),
    });
    const created = result as unknown as { keyId?: string; escrowed?: boolean } | string | null;
    const keyId = typeof created === "string" ? created : created?.keyId;
    if (!keyId) throw new E2eeError("server", "The server did not say which key it made.");
    this.keys.set(keyId, roomKey);
    return { keyId, roomKey, escrowed: typeof created === "object" && created ? !!created.escrowed : !!escrowWrap };
  }

  /** A room with members who have not set up encryption yet is escrowed, so those members can be caught up later. */
  private async escrowWrapFor(roomKey: Uint8Array<ArrayBuffer>, _recipients: Recipient[]): Promise<string | undefined> {
    const publicKey = await this.escrowPublicKey();
    return publicKey ? wrapRoomKey(roomKey, publicKey) : undefined;
  }

  private async escrowPublicKey(): Promise<string | undefined> {
    try {
      return (await this.client().query(api.e2eeKeys.escrowPublic, {})) as string;
    } catch {
      return undefined;
    }
  }

  async sealToBot(botPublicKey: string, data: unknown): Promise<string> {
    // The same box as a room-key wrap (ephemeral ECDH, HKDF, AES-GCM), around the JSON instead of a key.
    return wrapRoomKey(encoder.encode(JSON.stringify(data)) as Uint8Array<ArrayBuffer>, botPublicKey);
  }

  fulfilPendingWraps(): Promise<number> {
    if (this.snap.status !== "ready") return Promise.resolve(0);
    // Window focus, the timer and the subscription can all fire together; one pass serves them all.
    if (this.fulfilling) return this.fulfilling;
    const run = this.fulfilNow().finally(() => {
      this.fulfilling = null;
    });
    this.fulfilling = run;
    return run;
  }

  private async fulfilNow(): Promise<number> {
    const convex = this.client();
    const generation = this.generation;
    const pending = (await convex.query(api.e2eeKeys.pendingWrapRequests, { limit: 50 })) as unknown as {
      requestId?: string;
      _id?: string;
      keyId: string;
      userId?: string;
      publicKey?: string | null;
    }[];
    if (!pending?.length) return 0;

    const items: { requestId: Id<"e2eeWrapRequests">; wrapped: string }[] = [];
    for (const p of pending) {
      const requestId = (p.requestId ?? p._id) as Id<"e2eeWrapRequests"> | undefined;
      if (!requestId || !p.publicKey || p.userId === this.account) continue;
      const roomKey = await this.roomKey(p.keyId);
      // Not ours to give: we never held this epoch. Someone who did will pick it up.
      if (!roomKey) continue;
      items.push({ requestId, wrapped: await wrapRoomKey(roomKey, p.publicKey) });
    }
    if (items.length === 0 || generation !== this.generation) return 0;
    await convex.mutation(api.e2eeKeys.fulfilWrapRequests, { items });
    return items.length;
  }

  readonly atRest = {
    seal: async (bytes: Uint8Array): Promise<Uint8Array> => sealAtRest(this.requireIdentity().privateKey, bytes),
    open: async (bytes: Uint8Array): Promise<Uint8Array | null> => {
      const identity = this.identity;
      return identity ? openAtRest(identity.privateKey, bytes) : null;
    },
  };

  // -- lifecycle: setup, unlock, reset ------------------------------------------------------------------

  /** First identity for this account. Nothing leaves the device until `commit`. */
  prepareSetup(): Promise<PendingIdentity> {
    return this.prepare("register");
  }

  /** A replacement identity. Whatever was wrapped to the old one stays unreadable. */
  prepareReset(): Promise<PendingIdentity> {
    return this.prepare("rotate");
  }

  private async prepare(kind: "register" | "rotate"): Promise<PendingIdentity> {
    const generation = this.generation;
    const identity = await generateIdentity();
    const secret = generateRecoverySecret();
    const backup = await makeBackup(identity.privateKey, secret);
    return {
      recoveryKey: formatRecoverySecret(secret),
      fingerprint: identity.fingerprint,
      commit: async () => {
        if (generation !== this.generation) throw new Error("You signed in to a different account. Start again.");
        const args = { publicKey: identity.publicKey, fingerprint: identity.fingerprint, backup };
        const convex = this.client();
        if (kind === "register") await convex.mutation(api.e2eeKeys.registerIdentity, args);
        else await convex.mutation(api.e2eeKeys.rotateIdentity, args);
        // Old room keys were opened with the old identity; keep nothing from it.
        if (kind === "rotate") this.clearCaches();
        await this.adopt(identity, true);
        rememberRecoveryKey(this.account, formatRecoverySecret(secret));
      },
    };
  }

  /** Opens the server-held backup with the recovery key and keeps the identity on this device. */
  async unlock(recoveryKey: string): Promise<void> {
    const server = this.server;
    if (!server) throw new Error("Encryption is not ready yet. Try again in a moment.");
    const secret = parseRecoverySecret(recoveryKey);
    const stored = (await this.client().query(api.e2eeKeys.getBackup, {})) as unknown as
      | { salt: string; iv: string; ct: string }
      | { backup?: { salt: string; iv: string; ct: string } | null }
      | null;
    const backup = stored && "ct" in stored ? stored : stored?.backup;
    if (!backup) throw new Error("This account has no recovery backup. Reset encryption instead.");
    let privateKey: string;
    try {
      privateKey = await openBackup(backup, secret);
    } catch {
      throw new Error("That recovery key doesn't match this account.");
    }
    // The backup authenticates under the key, but make sure it belongs to the identity the server lists.
    try {
      const probe = generateRoomKey();
      const opened = await unwrapRoomKey(await wrapRoomKey(probe, server.publicKey), privateKey, server.publicKey);
      if (opened.length !== probe.length || opened.some((b, i) => b !== probe[i])) throw new Error("mismatch");
    } catch {
      throw new Error("That recovery key opens a different encryption identity than this account uses now. Reset encryption instead.");
    }
    await this.adopt({ publicKey: server.publicKey, privateKey, fingerprint: await fingerprintOf(server.publicKey) }, false);
    rememberRecoveryKey(this.account, recoveryKey);
  }

  /**
   * On the web, a key that can't be read back from IndexedDB (private browsing, storage cleared or evicted)
   * would mean typing the recovery key after every refresh. If this browser saved the recovery key, use it:
   * only when the server has an identity and this device has none, and only once per sign-in. A saved key
   * that no longer opens the account (reset on another device) is forgotten.
   */
  private autoTried = -1;
  private maybeAutoUnlock() {
    if (!this.account || !this.server || this.local !== null || this.autoTried === this.generation) return;
    const saved = savedRecoveryKey(this.account);
    if (!saved) return;
    this.autoTried = this.generation;
    const account = this.account;
    void this.unlock(saved).catch(() => forgetRecoveryKey(account));
  }

  /** Keeps `identity` in memory and, where the platform allows, on disk. */
  private async adopt(identity: Identity, announce: boolean) {
    const account = this.account;
    if (!account) throw new Error("Sign in first.");
    const generation = this.generation;
    this.identity = identity;
    this.local = { publicKey: identity.publicKey };
    // The server already has this key (we just registered it, or it is the one we unlocked), so don't flash
    // "needs setup" in the moment before its live query catches up.
    if (announce) this.server = { publicKey: identity.publicKey };
    const saved = await getKeystore().save(account, { publicKey: identity.publicKey, privateKey: identity.privateKey });
    if (generation !== this.generation) return;
    this.persistent = saved;
    this.publish(true);
  }

  /** Removes the key from this device (the account and its backup are untouched). */
  async forgetDevice(): Promise<void> {
    const account = this.account;
    if (!account) return;
    await getKeystore().clear(account);
    forgetRecoveryKey(account);
    this.identity = null;
    this.local = null;
    this.clearCaches();
    this.publish(true);
  }
}

export const keyring = new Keyring();

// --- The recovery key, remembered by this browser ---------------------------------------------------
//
// Web only, by request: so a refresh never asks for it again even where the device key can't be kept.
// It sits in localStorage under the account id, which means anything that can run script on this origin
// could read it, so it is cleared on sign-out (see auth-state.tsx) and when the device is forgotten. The
// desktop app keeps its key in the operating system's secure storage instead and never saves this.
const RECOVERY_PREFIX = "crystal-e2ee-recovery:";

function canRemember(): boolean {
  return typeof window !== "undefined" && !isElectron() && "localStorage" in window;
}

export function rememberRecoveryKey(account: string | null, recoveryKey: string) {
  if (!account || !canRemember()) return;
  try {
    localStorage.setItem(RECOVERY_PREFIX + account, recoveryKey.trim().toUpperCase());
  } catch {}
}

function savedRecoveryKey(account: string): string | null {
  if (!canRemember()) return null;
  try {
    return localStorage.getItem(RECOVERY_PREFIX + account);
  } catch {
    return null;
  }
}

function forgetRecoveryKey(account: string) {
  try {
    localStorage.removeItem(RECOVERY_PREFIX + account);
  } catch {}
}

/** Every saved recovery key in this browser. Called on sign-out. */
export function forgetAllRecoveryKeys() {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(RECOVERY_PREFIX)) localStorage.removeItem(key);
  } catch {}
}

export function getE2ee(): E2eeClient {
  return keyring;
}
