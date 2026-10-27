/**
 * Message search over what this device has already decrypted.
 *
 * The server used to search message text with Convex search indexes. It can't any more: it only holds
 * ciphertext. So every message a list decrypts is also fed to this in-memory inverted index, scoped
 * per room, and searching reads only the index. That has one consequence worth being plain about:
 * a message that was never loaded on this device (older history, a room never opened) is not
 * found. The UI says so ("Searches messages loaded on this device").
 *
 * The index holds plaintext, so it is persisted to IndexedDB only after `atRest.seal` (the
 * device-bound key, see src/lib/e2ee/index.ts). If sealing is unavailable nothing is written.
 *
 * The data structure and the tokenizer are pure and have no browser dependencies, so
 * scripts/tests/e2ee-messages.test.mts can run them under Node. Persistence is injected.
 */

export type RoomKey = string; // "dm:<conversationId>" | "channel:<channelId>"

export interface IndexedDoc {
  id: string;
  room: RoomKey;
  authorId: string;
  authorName?: string;
  createdAt: number;
  text: string;
  attachments?: { fileName: string; fileType: string }[];
  /** Where a result should open. Optional: only what navigation needs. */
  communityId?: string;
  channelName?: string;
}

export interface SearchHit extends IndexedDoc {
  /** Which of the document's tokens matched, for highlighting. */
  matched: string[];
}

/** A room never holds more than this many documents; the oldest go first. */
export const MAX_DOCS_PER_ROOM = 5000;
/** Only the start of a very long message is searchable. */
export const MAX_TEXT_LENGTH = 2000;
const MAX_TOKEN_LENGTH = 48;

// Markdown and mention scaffolding that carries no words a person would search for.
const MENTION_TAG_RE = /<@&?[a-z0-9]+>/gi;
const CUSTOM_EMOJI_TAG_RE = /<a?:([\w]+):[a-z0-9]+>/gi;
const URL_RE = /https?:\/\/\S+/gi;

/**
 * Lower-cased words, accents folded ("café" matches "cafe"), split on anything that isn't a letter
 * or a number. Single characters are kept: people do search "a" in a chat, but a prefix of one letter
 * matches too much to be useful, so `search` requires two for a prefix.
 */
export function tokenize(input: string): string[] {
  const cleaned = input.replace(MENTION_TAG_RE, " ").replace(CUSTOM_EMOJI_TAG_RE, " $1 ").replace(URL_RE, (url) => {
    // Keep the host and path words searchable ("github.com/foo") without the query noise.
    try {
      const u = new URL(url);
      return ` ${u.hostname} ${u.pathname} `;
    } catch {
      return " ";
    }
  });
  const folded = cleaned.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const out: string[] = [];
  for (const raw of folded.split(/[^\p{L}\p{N}]+/u)) {
    if (!raw) continue;
    out.push(raw.length > MAX_TOKEN_LENGTH ? raw.slice(0, MAX_TOKEN_LENGTH) : raw);
  }
  return out;
}

class RoomIndex {
  docs = new Map<string, IndexedDoc>();
  /** token → ids of documents containing it. */
  postings = new Map<string, Set<string>>();
  /** doc id → its tokens, so removing or replacing a document is exact. */
  tokensOf = new Map<string, string[]>();
  private sorted: string[] | null = null;

  add(doc: IndexedDoc): void {
    if (this.docs.has(doc.id)) this.remove(doc.id);
    const searchableText = `${doc.text} ${(doc.attachments ?? []).map((item) => item.fileName).join(" ")}`;
    const tokens = [...new Set(tokenize(searchableText))];
    this.docs.set(doc.id, doc);
    this.tokensOf.set(doc.id, tokens);
    for (const token of tokens) {
      let set = this.postings.get(token);
      if (!set) {
        set = new Set();
        this.postings.set(token, set);
        this.sorted = null;
      }
      set.add(doc.id);
    }
    if (this.docs.size > MAX_DOCS_PER_ROOM) this.evictOldest();
  }

  remove(id: string): boolean {
    const tokens = this.tokensOf.get(id);
    if (!tokens) return false;
    for (const token of tokens) {
      const set = this.postings.get(token);
      if (!set) continue;
      set.delete(id);
      if (set.size === 0) {
        this.postings.delete(token);
        this.sorted = null;
      }
    }
    this.tokensOf.delete(id);
    this.docs.delete(id);
    return true;
  }

  private evictOldest(): void {
    let oldest: IndexedDoc | undefined;
    for (const doc of this.docs.values()) if (!oldest || doc.createdAt < oldest.createdAt) oldest = doc;
    if (oldest) this.remove(oldest.id);
  }

  /** Tokens starting with `prefix`, by binary search over the sorted vocabulary. */
  tokensWithPrefix(prefix: string): string[] {
    if (!this.sorted) this.sorted = [...this.postings.keys()].sort();
    const list = this.sorted;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < prefix) lo = mid + 1;
      else hi = mid;
    }
    const out: string[] = [];
    for (let i = lo; i < list.length && list[i].startsWith(prefix); i++) out.push(list[i]);
    return out;
  }

  /** Documents containing, for every term, at least one token that starts with it. */
  match(terms: string[]): Map<string, Set<string>> {
    let result: Map<string, Set<string>> | null = null;
    for (const term of terms) {
      const next = new Map<string, Set<string>>();
      const candidates = term.length >= 2 ? this.tokensWithPrefix(term) : this.postings.has(term) ? [term] : [];
      for (const token of candidates) {
        for (const id of this.postings.get(token) ?? []) {
          if (result && !result.has(id)) continue;
          const matched = next.get(id) ?? new Set<string>();
          matched.add(token);
          next.set(id, matched);
        }
      }
      result = next;
      if (result.size === 0) break;
    }
    return result ?? new Map();
  }
}

export interface IndexStorage {
  /** Every room that has a stored copy. */
  rooms(): Promise<RoomKey[]>;
  load(room: RoomKey): Promise<IndexedDoc[] | null>;
  save(room: RoomKey, docs: IndexedDoc[]): Promise<void>;
  clear(): Promise<void>;
}

export class SearchIndex {
  private rooms = new Map<RoomKey, RoomIndex>();
  private dirty = new Set<RoomKey>();
  private loaded = new Set<RoomKey>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private storage: IndexStorage | null = null,
    private saveDelayMs = 1500,
  ) {}

  /** Bumped whenever the contents change, for `useSyncExternalStore`. */
  getVersion = (): number => this.version;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private touch(room: RoomKey, persist: boolean): void {
    this.version += 1;
    for (const l of this.listeners) l();
    if (!persist || !this.storage) return;
    this.dirty.add(room);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.saveDelayMs);
  }

  private roomIndex(room: RoomKey): RoomIndex {
    let index = this.rooms.get(room);
    if (!index) {
      index = new RoomIndex();
      this.rooms.set(room, index);
    }
    return index;
  }

  add(doc: IndexedDoc): void {
    const text = doc.text.trim().slice(0, MAX_TEXT_LENGTH);
    const attachments = doc.attachments?.map((item) => ({
      fileName: item.fileName.slice(0, 240),
      fileType: item.fileType.slice(0, 120),
    }));
    if (!text && !attachments?.length) {
      this.remove(doc.room, doc.id);
      return;
    }
    const index = this.roomIndex(doc.room);
    const prior = index.docs.get(doc.id);
    // The lists call this on every render pass that decrypts a row; skip the no-op.
    if (
      prior &&
      prior.text === text &&
      prior.authorName === doc.authorName &&
      prior.channelName === doc.channelName &&
      JSON.stringify(prior.attachments ?? []) === JSON.stringify(attachments ?? [])
    ) return;
    index.add({ ...doc, text, attachments });
    this.touch(doc.room, true);
  }

  remove(room: RoomKey, id: string): void {
    const index = this.rooms.get(room);
    if (index?.remove(id)) this.touch(room, true);
  }

  size(room?: RoomKey): number {
    if (room) return this.rooms.get(room)?.docs.size ?? 0;
    let n = 0;
    for (const r of this.rooms.values()) n += r.docs.size;
    return n;
  }

  /** Reads a room's stored copy into memory (once). Safe to call repeatedly. */
  async ensureLoaded(room: RoomKey): Promise<void> {
    if (this.loaded.has(room) || !this.storage) return;
    this.loaded.add(room);
    let docs: IndexedDoc[] | null = null;
    try {
      docs = await this.storage.load(room);
    } catch {
      docs = null;
    }
    if (!docs?.length) return;
    const index = this.roomIndex(room);
    // Documents added while the load was in flight are newer than what was stored.
    for (const doc of docs) if (!index.docs.has(doc.id)) index.add(doc);
    this.version += 1;
    for (const l of this.listeners) l();
  }

  async ensureAllLoaded(): Promise<void> {
    if (!this.storage) return;
    let keys: RoomKey[] = [];
    try {
      keys = await this.storage.rooms();
    } catch {
      return;
    }
    await Promise.all(keys.map((k) => this.ensureLoaded(k)));
  }

  /**
   * Newest first. Every word in the query has to match the start of some word in the message.
   * `room` limits the search to one room; omitted, it covers everything loaded.
   */
  search(
    query: string,
    opts: {
      room?: RoomKey;
      limit?: number;
      authorId?: string;
      attachment?: "images" | "attachments";
    } = {},
  ): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 && !opts.attachment && !opts.authorId) return [];
    const limit = opts.limit ?? 40;
    const hits: SearchHit[] = [];
    const scopes = opts.room ? [this.rooms.get(opts.room)].filter((r): r is RoomIndex => !!r) : [...this.rooms.values()];
    for (const index of scopes) {
      const candidates = terms.length
        ? index.match(terms)
        : new Map([...index.docs.keys()].map((id) => [id, new Set<string>()] as const));
      for (const [id, matched] of candidates) {
        const doc = index.docs.get(id);
        if (!doc || (opts.authorId && doc.authorId !== opts.authorId)) continue;
        if (opts.attachment === "images" && !doc.attachments?.some((item) => item.fileType.startsWith("image/"))) continue;
        if (opts.attachment === "attachments" && !doc.attachments?.length) continue;
        hits.push({ ...doc, matched: [...matched] });
      }
    }
    hits.sort((a, b) => b.createdAt - a.createdAt);
    return hits.slice(0, limit);
  }

  async flush(): Promise<void> {
    if (!this.storage) return;
    const rooms = [...this.dirty];
    this.dirty.clear();
    for (const room of rooms) {
      const index = this.rooms.get(room);
      try {
        await this.storage.save(room, index ? [...index.docs.values()] : []);
      } catch {
        // A failed write only costs a rebuild from the next messages loaded.
        this.dirty.add(room);
      }
    }
  }

  /** Forget everything, in memory and on disk. Called on sign-out. */
  async clear(): Promise<void> {
    this.rooms.clear();
    this.loaded.clear();
    this.dirty.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.version += 1;
    for (const l of this.listeners) l();
    try {
      await this.storage?.clear();
    } catch {
      // nothing more to do
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Browser wiring
// ---------------------------------------------------------------------------------------------

const DB_NAME = "crystal-search-index";
const STORE = "rooms";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const req = run(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Sealed with the device key before it touches disk; never written if sealing is unavailable. */
function sealedStorage(): IndexStorage {
  const atRest = async () => (await import("./index")).getE2ee().atRest;
  return {
    async rooms() {
      return ((await idb("readonly", (s) => s.getAllKeys())) ?? []) as string[];
    },
    async load(room) {
      const stored = (await idb("readonly", (s) => s.get(room))) as Uint8Array | undefined;
      if (!stored) return null;
      const opened = await (await atRest()).open(stored);
      if (!opened) return null;
      try {
        const parsed = JSON.parse(textDecoder.decode(opened));
        return Array.isArray(parsed) ? (parsed as IndexedDoc[]) : null;
      } catch {
        return null;
      }
    },
    async save(room, docs) {
      if (docs.length === 0) {
        await idb("readwrite", (s) => s.delete(room));
        return;
      }
      const sealed = await (await atRest()).seal(textEncoder.encode(JSON.stringify(docs)));
      await idb("readwrite", (s) => s.put(sealed, room));
    },
    async clear() {
      await idb("readwrite", (s) => s.clear());
    },
  };
}

let shared: SearchIndex | null = null;

/** The one index for this window. */
export function getSearchIndex(): SearchIndex {
  if (!shared) shared = new SearchIndex(typeof window === "undefined" ? null : sealedStorage());
  return shared;
}

export function roomKeyOf(room: { scope: "conversation"; conversationId: string } | { scope: "channel"; channelId: string }): RoomKey {
  return room.scope === "conversation" ? `dm:${room.conversationId}` : `channel:${room.channelId}`;
}
