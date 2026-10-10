import { CrystalAPIError } from "./errors";

export interface RESTOptions {
  token: string;
  /** Crystal's Bot API address, ending in /bot/v1. */
  apiUrl: string;
  /** How many times to retry after "slow down" (429). Default 2. */
  retries?: number;
  /** The longest to wait before a retry, in seconds. Default 60. Anything longer is thrown instead. */
  maxRetryDelay?: number;
}

/**
 * The thin layer over Crystal's HTTP API. Authenticates every request, turns error answers into
 * `CrystalAPIError`, and waits and retries when Crystal says to slow down. Use the classes
 * (`channel.send()`, `message.reply()`…) rather than this, unless you need something they don't cover.
 */
export class REST {
  constructor(private readonly options: RESTOptions) {}

  /** Make a request. Returns Crystal's answer, or throws a `CrystalAPIError`. Retries after "slow down". */
  async request<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const retries = this.options.retries ?? 2;
    const maxWait = (this.options.maxRetryDelay ?? 60) * 1000;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(this.options.apiUrl.replace(/\/$/, "") + path, {
        method,
        headers: { authorization: `Bot ${this.options.token}`, "content-type": "application/json", "user-agent": "crystal-bot-sdk/1.0" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } } & Record<string, unknown>;
      if (res.ok) return json as T;
      if (res.status === 429 && attempt < retries) {
        const wait = Math.max(0, Number(res.headers.get("retry-after") ?? 1)) * 1000;
        if (wait <= maxWait) {
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
      }
      throw new CrystalAPIError(res.status, json.error?.message ?? res.statusText, method, path);
    }
  }
  /** GET a path under the Bot API. */
  get = <T>(path: string, signal?: AbortSignal) => this.request<T>("GET", path, undefined, signal);
  /** POST a JSON body to a path. */
  post = <T>(path: string, body?: unknown) => this.request<T>("POST", path, body ?? {});
  /** PUT a JSON body to a path. */
  put = <T>(path: string, body?: unknown) => this.request<T>("PUT", path, body ?? {});
  /** PATCH a path with a JSON body. */
  patch = <T>(path: string, body?: unknown) => this.request<T>("PATCH", path, body ?? {});
  /** DELETE a path. */
  delete = <T>(path: string) => this.request<T>("DELETE", path);

  /**
   * Upload a file and get the `storageId` the calls that take files want. Crystal gives a one-use
   * address; the bytes go straight to it. Use it within 30 minutes.
   */
  async upload(data: Uint8Array | ArrayBuffer, contentType: string): Promise<string> {
    const { uploadUrl } = await this.post<{ uploadUrl: string }>("/uploads");
    const res = await fetch(uploadUrl, { method: "POST", headers: { "content-type": contentType }, body: data instanceof Uint8Array ? data : new Uint8Array(data) });
    const json = (await res.json().catch(() => ({}))) as { storageId?: string };
    if (!res.ok || !json.storageId) throw new CrystalAPIError(res.status, "The upload didn't go through.", "POST", "/uploads");
    return json.storageId;
  }
}
