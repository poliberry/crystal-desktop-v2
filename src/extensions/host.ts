import { sourceHash } from "../../convex/lib/extensionManifest";
import { DEFAULT_BUDGET, FAULT_TEXT, HOST_LIMITS, OPS, OP_POWER, type Budget, type FaultReason, type FromWorker, type Op, type ToWorker } from "@/extensions/protocol";
import { sanitizeTree, type UiNode } from "@/extensions/ui-schema";

/**
 * Crystal's side of one extension: starts its sandbox, answers what the sandbox asks,
 * and stops it the moment it misbehaves.
 *
 * The sandbox is not trusted to police itself. Everything it asks for is checked here,
 * against the powers the person agreed to; every picture it draws is rebuilt by
 * `sanitizeTree` before it is shown; and a watchdog watches from outside, so a sandbox
 * that has hung — or that has stopped enforcing its own limits — is simply terminated.
 * Once stopped for misbehaving, an extension stays stopped until the person starts it
 * again; it is never quietly restarted.
 */

export interface Installed {
  extensionId: string;
  name: string;
  version: string;
  source: string;
  /** What the code must hash to: the hash that was reviewed. */
  hash: string;
  manifest: { name: string; version: string; capabilities: string[]; network: string[] };
  granted: string[];
}

export interface Backend {
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(): Promise<string[]>;
  };
  http(req: { url: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; contentType: string; body: string }>;
  notify(text: string): void;
}

export type Status = "starting" | "running" | "suspended" | "stopped";

export interface LogLine {
  at: number;
  level: "log" | "info" | "warn" | "error" | "host";
  text: string;
}

export interface HostEvents {
  onUi(tree: UiNode | null, problems: string[]): void;
  onStatus(status: Status, detail?: string, reason?: FaultReason): void;
  onLog(line: LogLine): void;
}

/** What the host needs of a Worker, so a test can supply one that isn't. */
export interface WorkerLike {
  postMessage(m: ToWorker): void;
  terminate(): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

export interface HostOptions {
  budget?: Budget;
  makeWorker?: () => WorkerLike;
  /** How long the sandbox has to be ready, and to answer one event. */
  bootWatchdogMs?: number;
  eventWatchdogMs?: number;
}

const MAX_ACTIVE_TIMERS = HOST_LIMITS.activeTimers;
const MIN_TIMEOUT_MS = HOST_LIMITS.minTimeoutMs;
const MIN_INTERVAL_MS = HOST_LIMITS.minIntervalMs;
const MAX_TIMER_MS = HOST_LIMITS.maxTimerMs;
const MAX_CALLS_PER_SEC = HOST_LIMITS.callsPerSecond;
const MAX_UI_PER_SEC = HOST_LIMITS.redrawsPerSecond;
const MAX_NOTIFY_PER_MIN = HOST_LIMITS.noticesPerMinute;
const MAX_LOG_LINES = HOST_LIMITS.logLines;

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);

function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // A server error arrives wrapped in request details; the part after the last "Error:" is the message.
  return raw.replace(/\[CONVEX [^\]]*\]\s*/g, "").replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0].slice(0, 300) || "That didn't work.";
}

export class ExtensionHost {
  status: Status = "stopped";
  logs: LogLine[] = [];
  private worker: WorkerLike | null = null;
  private seq = 0;
  private inflight = new Map<number, ReturnType<typeof setTimeout>>();
  private bootTimer: ReturnType<typeof setTimeout> | null = null;
  private timers = new Map<number, { handle: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>; repeat: boolean }>();
  private callTimes: number[] = [];
  private uiTimes: number[] = [];
  private notifyTimes: number[] = [];

  constructor(
    private readonly ext: Installed,
    private readonly backend: Backend,
    private readonly events: HostEvents,
    private readonly opts: HostOptions = {},
  ) {}

  private setStatus(status: Status, detail?: string, reason?: FaultReason) {
    this.status = status;
    this.events.onStatus(status, detail, reason);
  }

  private log(level: LogLine["level"], text: string) {
    const line: LogLine = { at: Date.now(), level, text: clip(text, 1000) };
    this.logs.push(line);
    if (this.logs.length > MAX_LOG_LINES) this.logs.shift();
    this.events.onLog(line);
  }

  /** Start the sandbox, if what it is about to run is what was approved. */
  async start(): Promise<void> {
    if (this.status === "starting" || this.status === "running") return;
    this.setStatus("starting");
    // The code is checked against the hash from review before anything runs it. A mismatch
    // means what is here is not what was approved — however it got that way.
    if ((await sourceHash(this.ext.source)) !== this.ext.hash) {
      this.fault("integrity", "The code doesn't match the version that was reviewed.");
      return;
    }
    const worker = (this.opts.makeWorker ?? defaultWorker)();
    this.worker = worker;
    worker.onmessage = (e) => this.onMessage(e.data);
    worker.onerror = (e) => {
      // What the browser said, so a sandbox that fails to load says why rather than "crashed".
      const ev = e as { message?: string; filename?: string; lineno?: number };
      this.fault("crash", `The sandbox crashed${ev?.message ? `: ${ev.message}` : ""}${ev?.filename ? ` (${ev.filename.split("/").pop()}:${ev.lineno ?? "?"})` : ""}.`);
    };
    worker.onmessageerror = () => this.fault("crash", "The sandbox sent something unreadable.");
    this.bootTimer = setTimeout(() => this.fault("boot", "It didn't start in time."), this.opts.bootWatchdogMs ?? 5000);
    worker.postMessage({
      t: "boot",
      boot: { source: this.ext.source, manifest: this.ext.manifest, granted: this.ext.granted, budget: this.opts.budget ?? DEFAULT_BUDGET },
    });
  }

  /** Tell the extension its panel was opened. */
  open() {
    this.send("open", undefined);
  }

  /** Something in its panel was used. */
  action(action: string, value?: unknown) {
    this.send("action", { action, value });
  }

  private send(name: string, data: unknown) {
    if (!this.worker || this.status !== "running") return;
    const seq = ++this.seq;
    this.inflight.set(
      seq,
      setTimeout(() => this.fault("timeout", `It didn't finish handling “${name}”.`), this.opts.eventWatchdogMs ?? (this.opts.budget ?? DEFAULT_BUDGET).eventMs + 1500),
    );
    this.worker.postMessage({ t: "event", name, data, seq });
  }

  private onMessage(m: FromWorker) {
    if (this.status === "suspended" || this.status === "stopped") return;
    switch (m.t) {
      case "ready":
        if (this.bootTimer) clearTimeout(this.bootTimer);
        this.bootTimer = null;
        this.setStatus("running");
        break;
      case "ui":
        this.onUi(m.tree);
        break;
      case "log":
        this.log(m.level, m.text);
        break;
      case "idle": {
        const t = this.inflight.get(m.seq);
        if (t) clearTimeout(t);
        this.inflight.delete(m.seq);
        break;
      }
      case "fault":
        this.fault(m.reason, m.detail);
        break;
      case "call":
        void this.onCall(m.id, m.op, m.args);
        break;
    }
  }

  private rate(times: number[], windowMs: number, max: number): boolean {
    const now = Date.now();
    while (times.length && now - times[0] > windowMs) times.shift();
    if (times.length >= max) return false;
    times.push(now);
    return true;
  }

  private onUi(tree: unknown) {
    if (!this.rate(this.uiTimes, 1000, MAX_UI_PER_SEC)) return; // a picture the next one replaces
    const { tree: clean, problems } = sanitizeTree(tree, { origins: this.ext.manifest.network });
    for (const p of problems) this.log("host", p);
    this.events.onUi(clean, problems);
  }

  private reply(id: number, ok: boolean, value?: unknown) {
    if (!this.worker || this.status !== "running") return;
    this.worker.postMessage({ t: "reply", id, ok, value: ok ? (value === undefined ? undefined : JSON.stringify(value)) : clip(value, 300) });
  }

  private async onCall(id: number, op: string, args: unknown) {
    if (!this.rate(this.callTimes, 1000, MAX_CALLS_PER_SEC)) return this.fault("flood", "Too many requests to Crystal.");
    if (!(OPS as readonly string[]).includes(op)) return this.reply(id, false, "That isn't something an extension can do.");
    const power = OP_POWER[op as Op];
    // Whatever the code or the manifest says, the person's own yes is what counts.
    if (power && !this.ext.granted.includes(power)) return this.reply(id, false, "This extension hasn't been given permission to do that.");
    const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
    try {
      switch (op as Op) {
        case "storage.get":
          return this.reply(id, true, await this.backend.storage.get(this.key(a.key)));
        case "storage.set":
          if (typeof a.value !== "string") throw new Error("A value has to be text.");
          await this.backend.storage.set(this.key(a.key), a.value);
          return this.reply(id, true);
        case "storage.delete":
          await this.backend.storage.delete(this.key(a.key));
          return this.reply(id, true);
        case "storage.list":
          return this.reply(id, true, await this.backend.storage.list());
        case "http.fetch": {
          if (typeof a.url !== "string" || a.url.length > 2000) throw new Error("That isn't a web address.");
          const headers: Record<string, string> = {};
          if (a.headers && typeof a.headers === "object") for (const [k, v] of Object.entries(a.headers)) if (typeof v === "string") headers[k] = v;
          const res = await this.backend.http({
            url: a.url,
            method: typeof a.method === "string" ? a.method : undefined,
            headers,
            body: typeof a.body === "string" ? a.body : undefined,
          });
          return this.reply(id, true, res);
        }
        case "notify": {
          if (!this.rate(this.notifyTimes, 60_000, MAX_NOTIFY_PER_MIN)) throw new Error("Too many notices.");
          const text = clip(a.text, 200).trim();
          if (!text) throw new Error("A notice needs some text.");
          this.backend.notify(text);
          return this.reply(id, true);
        }
        case "timer.set":
          return this.timerSet(id, a);
        case "timer.clear":
          this.timerClear(Number(a.id));
          return this.reply(id, true);
      }
    } catch (e) {
      this.reply(id, false, errorText(e));
    }
  }

  private key(k: unknown): string {
    if (typeof k !== "string" || k.length < 1 || k.length > 64) throw new Error("A key is 1–64 characters.");
    return k;
  }

  private timerSet(id: number, a: Record<string, unknown>) {
    const tid = Number(a.id);
    const repeat = a.repeat === true;
    if (!Number.isInteger(tid) || tid < 1) return this.reply(id, false, "That timer isn't valid.");
    if (this.timers.size >= MAX_ACTIVE_TIMERS && !this.timers.has(tid)) return this.reply(id, false, `An extension can have ${MAX_ACTIVE_TIMERS} timers at once.`);
    const ms = Math.min(MAX_TIMER_MS, Math.max(repeat ? MIN_INTERVAL_MS : MIN_TIMEOUT_MS, Number(a.ms) || 0));
    this.timerClear(tid);
    const fire = () => {
      if (!repeat) this.timers.delete(tid);
      this.send("timer", { id: tid });
    };
    this.timers.set(tid, { handle: repeat ? setInterval(fire, ms) : setTimeout(fire, ms), repeat });
    this.reply(id, true);
  }

  private timerClear(tid: number) {
    const t = this.timers.get(tid);
    if (!t) return;
    (t.repeat ? clearInterval : clearTimeout)(t.handle as never);
    this.timers.delete(tid);
  }

  private teardown() {
    if (this.bootTimer) clearTimeout(this.bootTimer);
    this.bootTimer = null;
    for (const t of this.inflight.values()) clearTimeout(t);
    this.inflight.clear();
    for (const id of [...this.timers.keys()]) this.timerClear(id);
    const w = this.worker;
    this.worker = null;
    if (w) {
      w.onmessage = w.onerror = w.onmessageerror = null;
      try {
        w.postMessage({ t: "kill" });
      } catch {
        /* already gone */
      }
      // Not waiting for it to leave: whatever it was doing is over.
      w.terminate();
    }
  }

  /** Stop it for misbehaving. It stays stopped until someone starts it again. */
  private fault(reason: FaultReason, detail: string) {
    if (this.status === "suspended" || this.status === "stopped") return;
    this.teardown();
    this.log("host", `Stopped: ${FAULT_TEXT[reason]}. ${detail}`);
    this.setStatus("suspended", `${FAULT_TEXT[reason]}`, reason);
  }

  /** Stop it because it was asked to (turned off, removed, or revoked). */
  stop() {
    if (this.status === "stopped") return;
    this.teardown();
    this.setStatus("stopped");
  }
}

function defaultWorker(): WorkerLike {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerLike;
}
