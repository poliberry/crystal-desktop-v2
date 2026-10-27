/**
 * Undo and redo, as a stack of whole documents.
 *
 * A document is a small immutable value and every change produces a new one that
 * shares what it didn't touch, so keeping a hundred of them costs little and needs
 * no inverse operations to get wrong. A burst of changes that are really one
 * gesture — dragging, typing a number — passes the same `coalesce` key and
 * replaces the entry before it instead of piling up a step per frame.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey: string | null = null;
  private lastAt = 0;

  constructor(
    private present: T,
    private readonly limit = 100,
  ) {}

  get value(): T {
    return this.present;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Make a change. Same key within `windowMs` of the last one joins it. */
  push(next: T, coalesce?: string, windowMs = 600): void {
    if (next === this.present) return;
    const now = Date.now();
    const joins = coalesce !== undefined && coalesce === this.lastKey && now - this.lastAt < windowMs;
    if (!joins) {
      this.past.push(this.present);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.present = next;
    this.future = [];
    this.lastKey = coalesce ?? null;
    this.lastAt = now;
  }

  /** Replace the present without recording a step (loading, or a derived fix-up). */
  reset(next: T): void {
    this.present = next;
    this.past = [];
    this.future = [];
    this.lastKey = null;
  }

  undo(): T | null {
    const previous = this.past.pop();
    if (previous === undefined) return null;
    this.future.push(this.present);
    this.present = previous;
    this.lastKey = null;
    return this.present;
  }

  redo(): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(this.present);
    this.present = next;
    this.lastKey = null;
    return this.present;
  }
}
