/** A small typed event emitter, so the SDK needs nothing from Node but `http` and `crypto`. */
export class Emitter<Events extends { [K in keyof Events]: unknown[] }> {
  private listeners = new Map<keyof Events, ((...args: never[]) => unknown)[]>();

  /** Listen for an event. Use the names in `Events`, e.g. `client.on(Events.MessageCreate, (m) => …)`. */
  on<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener as (...args: never[]) => unknown);
    this.listeners.set(event, list);
    return this;
  }
  /** Listen for an event once, then stop. */
  once<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    const wrapped = (...args: Events[K]) => {
      this.off(event, wrapped);
      return listener(...args);
    };
    return this.on(event, wrapped);
  }
  /** Stop listening. Pass the same function you gave to `on`. */
  off<K extends keyof Events>(event: K, listener: (...args: Events[K]) => unknown): this {
    const list = this.listeners.get(event);
    if (list) this.listeners.set(event, list.filter((l) => l !== (listener as unknown)));
    return this;
  }
  /** Runs every listener; a listener that throws or rejects doesn't stop the others, and is reported to `onError`. */
  protected emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    const list = this.listeners.get(event);
    if (!list?.length) return false;
    for (const l of [...list]) {
      try {
        const r = (l as (...a: Events[K]) => unknown)(...args);
        if (r && typeof (r as Promise<unknown>).then === "function") (r as Promise<unknown>).then(undefined, (e) => this.onError(e, String(event)));
      } catch (e) {
        this.onError(e, String(event));
      }
    }
    return true;
  }
  protected onError(error: unknown, event: string): void {
    console.error(`[crystal] a listener for “${event}” failed:`, error);
  }
}
