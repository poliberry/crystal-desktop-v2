/**
 * Talking to a Pterodactyl panel on a community's behalf.
 *
 * Everything that reaches out to a panel goes through here, because a panel's
 * address is typed in by a user and the request is made from our servers: it is a
 * way to make us fetch a URL of someone else's choosing. So the address is
 * checked before it is stored and again before it is used, redirects are refused
 * (a panel that redirects somewhere is not one we follow), responses are capped,
 * and requests time out.
 *
 * DNS can't be looked up from here, so a public name that resolves to a private
 * address is not caught by the address check. What limits that is where this
 * runs — Convex's own network, which has nothing of ours on a private range — and
 * the fact that only a panel's JSON shape is ever returned, never a raw body.
 */

const MAX_BODY_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;

/** The origin of a panel URL, or an error saying what is wrong with it. */
export function assertPanelUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That isn't a web address.");
  }
  if (url.protocol !== "https:") throw new Error("A panel has to be reached over https.");
  if (url.username || url.password) throw new Error("Leave the username and password out of the address.");
  const host = url.hostname.toLowerCase();
  if (host.includes(":") || host.startsWith("[")) throw new Error("Use the panel's domain name, not an IP address.");
  if (
    host === "localhost" ||
    !host.includes(".") ||
    /\.(local|localhost|internal|lan|home|localdomain|intranet)$/.test(host)
  ) {
    throw new Error("That address is only reachable from inside a network.");
  }
  // A dotted quad (WHATWG parsing has already normalised hex/octal/short forms).
  const quad = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (quad) {
    const [a, b] = [Number(quad[1]), Number(quad[2])];
    const privateRange =
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    if (privateRange) throw new Error("That address is only reachable from inside a network.");
  }
  return url.origin;
}

export interface PanelResponse<T = unknown> {
  status: number;
  data: T | null;
}

export class PanelError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Why a panel said no, in words for a person. */
function explain(status: number): string {
  if (status === 401 || status === 403) return "The panel rejected the API key. It may have been revoked, or it can't reach that server.";
  if (status === 404) return "The panel doesn't know that server any more.";
  if (status === 409) return "The server is busy or in the wrong state for that.";
  if (status === 429) return "The panel is rate limiting Crystal. Try again in a moment.";
  if (status >= 500) return "The panel had a problem. Try again in a moment.";
  return `The panel answered with an error (${status}).`;
}

export async function panelRequest<T = unknown>(
  baseUrl: string,
  apiKey: string,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Promise<PanelResponse<T>> {
  const origin = assertPanelUrl(baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}${path}`, {
      method: init.method ?? "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "Application/vnd.pterodactyl.v1+json",
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status >= 300 && res.status < 400) throw new PanelError("The panel redirected Crystal somewhere else, which it won't follow.", res.status);
    if (res.status === 204) return { status: 204, data: null };
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_BYTES) throw new PanelError("The panel's answer was too large.", res.status);
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) throw new PanelError("The panel's answer was too large.", res.status);
    if (!res.ok) throw new PanelError(explain(res.status), res.status);
    try {
      return { status: res.status, data: JSON.parse(text) as T };
    } catch {
      throw new PanelError("That doesn't look like a Pterodactyl panel.", res.status);
    }
  } catch (e) {
    if (e instanceof PanelError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new PanelError("The panel took too long to answer.", 0);
    throw new PanelError("Couldn't reach the panel.", 0);
  } finally {
    clearTimeout(timer);
  }
}

// --- Shapes we read -----------------------------------------------------------------------

export interface PanelServer {
  identifier: string;
  name: string;
  description: string;
  isSuspended: boolean;
}

export interface PanelResources {
  state: "running" | "starting" | "stopping" | "offline" | string;
  suspended: boolean;
  cpuPercent: number;
  memoryBytes: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
}

type RawServerList = {
  data?: { attributes?: { identifier?: string; name?: string; description?: string; is_suspended?: boolean } }[];
  meta?: { pagination?: { current_page?: number; total_pages?: number } };
};

/** Every server the key can see, across pages (capped so one panel can't make this run forever). */
export async function listPanelServers(baseUrl: string, apiKey: string): Promise<PanelServer[]> {
  const out: PanelServer[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await panelRequest<RawServerList>(baseUrl, apiKey, `/api/client?page=${page}`);
    for (const row of data?.data ?? []) {
      const a = row.attributes;
      if (!a?.identifier || !/^[a-z0-9-]{1,36}$/i.test(a.identifier)) continue;
      out.push({
        identifier: a.identifier,
        name: String(a.name ?? a.identifier).slice(0, 80),
        description: String(a.description ?? "").slice(0, 200),
        isSuspended: a.is_suspended === true,
      });
    }
    const pg = data?.meta?.pagination;
    if (!pg || (pg.current_page ?? page) >= (pg.total_pages ?? 1)) break;
  }
  return out;
}

type RawResources = {
  attributes?: {
    current_state?: string;
    is_suspended?: boolean;
    resources?: {
      memory_bytes?: number;
      cpu_absolute?: number;
      disk_bytes?: number;
      network_rx_bytes?: number;
      network_tx_bytes?: number;
      uptime?: number;
    };
  };
};

export async function getResources(baseUrl: string, apiKey: string, identifier: string): Promise<PanelResources> {
  const { data } = await panelRequest<RawResources>(baseUrl, apiKey, `/api/client/servers/${identifier}/resources`);
  const a = data?.attributes;
  const r = a?.resources ?? {};
  const n = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    state: String(a?.current_state ?? "offline"),
    suspended: a?.is_suspended === true,
    cpuPercent: n(r.cpu_absolute),
    memoryBytes: n(r.memory_bytes),
    diskBytes: n(r.disk_bytes),
    networkRxBytes: n(r.network_rx_bytes),
    networkTxBytes: n(r.network_tx_bytes),
    uptimeMs: n(r.uptime),
  };
}
