/**
 * Holds deep links until the page can take them.
 *
 * A link can arrive before there is a page (launch from a link), while one is loading, or while
 * the person is signed out, and the code that shows an invite or an add-a-bot dialog only exists
 * once they are signed in. So links wait here, and the page says when it is ready.
 *
 * "Ready" belongs to a *document*: it ends when the window loads a different page, and only then.
 * Electron's `did-start-loading` is the wrong signal for that: it also fires for iframes (Clerk
 * draws some) and for same-document navigations, which is what every in-app route change is, and
 * the page does not announce itself again after those. Use `startsNewDocument` on
 * `did-start-navigation` instead.
 */

/** Whether a navigation replaces the page (and so loses its link handlers). */
export const startsNewDocument = (details: { isMainFrame: boolean; isSameDocument: boolean }): boolean => details.isMainFrame && !details.isSameDocument;

export class LinkQueue<T> {
  private ready = false;
  private queue: T[] = [];

  /** `limit` bounds a pile-up while nobody is listening; the oldest links are dropped first. */
  constructor(
    private readonly deliver: (link: T) => void,
    private readonly limit = 20,
  ) {}

  get isReady(): boolean {
    return this.ready;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Deliver now if the page is ready, otherwise keep it for when it is. */
  push(link: T): void {
    if (this.ready) {
      this.deliver(link);
      return;
    }
    this.queue.push(link);
    if (this.queue.length > this.limit) this.queue.splice(0, this.queue.length - this.limit);
  }

  /** The page can take links: send everything waiting, oldest first. */
  markReady(): void {
    this.ready = true;
    for (const link of this.queue.splice(0)) this.deliver(link);
  }

  /** The page is gone (a new document is loading): links wait again. */
  reset(): void {
    this.ready = false;
  }
}
