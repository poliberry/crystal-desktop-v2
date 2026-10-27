/**
 * A small private store for your extension — up to 100 keys and 256 KB in all, 16 KB a value —
 * kept for each person who has it installed. No other extension can read it, and removing yours
 * deletes it. Values are anything JSON can hold. Needs the "Keep some data" power.
 */
export const storage = {
  /** The value stored under a key, or `undefined`. */
  async get<T = unknown>(key: string): Promise<T | undefined> {
    return (await crystal.storage.get(key)) as T | undefined;
  },
  /** Store a value under a key (anything JSON can hold, up to 16 KB). */
  async set(key: string, value: unknown): Promise<void> {
    await crystal.storage.set(key, value);
  },
  /** Remove a key. */
  async delete(key: string): Promise<void> {
    await crystal.storage.delete(key);
  },
  /** Every key stored. */
  async list(): Promise<string[]> {
    return crystal.storage.list();
  },
};
