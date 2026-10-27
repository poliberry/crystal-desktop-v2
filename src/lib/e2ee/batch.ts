/**
 * Small pure helpers for the key cache: a batcher that turns many "I need the wrap for key X" into one
 * request, and a bounded cache for decrypted messages. No dependencies, so they run under the tests.
 */

export type Batcher<V> = {
  /** Resolves with the value for `key`, or `undefined` if the fetch had none. Rejects if the fetch failed. */
  load(key: string): Promise<V | undefined>;
  /** Keys waiting for the next flush. */
  pendingCount(): number;
};

/**
 * A list of 50 messages from one epoch must cost one server call, and 50 messages across three epochs
 * must cost one call with three ids, not 50. Every `load` inside the same `delayMs` window joins one
 * `fetch`; asking for a key that is already being fetched joins that request instead of making another.
 */
export function createBatcher<V>(options: {
  fetch: (keys: string[]) => Promise<Record<string, V | undefined>>;
  /** Most ids in one request. Larger sets are split. */
  maxBatch?: number;
  delayMs?: number;
}): Batcher<V> {
  const maxBatch = options.maxBatch ?? 50;
  const delayMs = options.delayMs ?? 8;
  const waiting = new Map<string, Promise<V | undefined>>();
  const queue: { key: string; resolve: (v: V | undefined) => void; reject: (e: unknown) => void }[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const batch = queue.splice(0, queue.length);
    for (let i = 0; i < batch.length; i += maxBatch) {
      const chunk = batch.slice(i, i + maxBatch);
      options
        .fetch(chunk.map((c) => c.key))
        .then(
          (found) => {
            for (const c of chunk) c.resolve(found[c.key]);
          },
          (error) => {
            for (const c of chunk) c.reject(error);
          },
        )
        .finally(() => {
          for (const c of chunk) waiting.delete(c.key);
        });
    }
  };

  return {
    load(key) {
      const existing = waiting.get(key);
      if (existing) return existing;
      const promise = new Promise<V | undefined>((resolve, reject) => queue.push({ key, resolve, reject }));
      waiting.set(key, promise);
      if (!timer) timer = setTimeout(flush, delayMs);
      return promise;
    },
    pendingCount: () => queue.length,
  };
}

/** Insertion-ordered, bounded. Reading a key makes it the newest. */
export class Lru<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
