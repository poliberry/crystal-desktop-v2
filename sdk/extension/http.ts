/** What came back from a request. */
export class HttpResponse {
  constructor(
    /** The HTTP status code. */
    readonly status: number,
    /** Whether the status is 200–299. */
    readonly ok: boolean,
    /** The response's `Content-Type`. */
    readonly contentType: string,
    /** The body as text, cut off at 512 KB. */
    readonly text: string,
  ) {}
  /** Parse the body as JSON. Throws if it isn't. */
  json<T = unknown>(): T {
    return JSON.parse(this.text) as T;
  }
}

/**
 * Requests to the web, made by Crystal on your behalf. Needs the "Talk to the internet" power, and
 * reaches only the sites listed under "Sites it may talk to" in the project's settings, over https.
 * No cookies are sent, redirects off the list are refused, and responses over 512 KB are cut off.
 */
export const http = {
  /** Make a request. `body` may be a string or an object (sent as JSON). Throws if the site isn't on the list or the power wasn't granted. */
  async fetch(url: string, options: { method?: string; headers?: Record<string, string>; body?: string | object } = {}): Promise<HttpResponse> {
    const r = await crystal.http.fetch(url, options);
    return new HttpResponse(r.status, r.ok, r.contentType, r.text);
  },
};
