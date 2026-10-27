/**
 * What the host (Crystal's page) and a sandbox (a Worker holding one extension's
 * JavaScript engine) say to each other. Plain data, both ways, and nothing else:
 * no function, no handle, no object that points back into either side.
 */

/** The limits a sandbox runs under. They are enforced inside the sandbox *and*
 * watched from outside, so a sandbox that stopped enforcing them would still be stopped. */
export interface Budget {
  /** Total memory the engine may use. */
  memoryBytes: number;
  /** Longest a single entry into the extension's code may run. */
  bootMs: number;
  eventMs: number;
  /** Share of the time over a window the extension may spend running, 0–1. */
  cpuShare: number;
  windowMs: number;
}

export const DEFAULT_BUDGET: Budget = { memoryBytes: 32 * 1024 * 1024, bootMs: 500, eventMs: 100, cpuShare: 0.25, windowMs: 10_000 };

/** What an extension may ask of the host, and how often. Read by the host, and by the guides that say so. */
export const HOST_LIMITS = {
  activeTimers: 5,
  minTimeoutMs: 250,
  minIntervalMs: 1000,
  maxTimerMs: 60 * 60 * 1000,
  callsPerSecond: 60,
  redrawsPerSecond: 15,
  noticesPerMinute: 5,
  logLines: 200,
} as const;

export interface BootInfo {
  source: string;
  manifest: { name: string; version: string; capabilities: string[]; network: string[] };
  granted: string[];
  budget: Budget;
}

export type ToWorker =
  | { t: "boot"; boot: BootInfo }
  | { t: "event"; name: string; data?: unknown; seq: number }
  | { t: "reply"; id: number; ok: boolean; value?: string }
  | { t: "kill" };

export type FaultReason = "cpu" | "memory" | "timeout" | "crash" | "flood" | "boot" | "oversize" | "integrity";

export type FromWorker =
  | { t: "ready" }
  | { t: "ui"; tree: unknown }
  | { t: "call"; id: number; op: string; args: unknown }
  | { t: "log"; level: "log" | "info" | "warn" | "error"; text: string }
  | { t: "idle"; seq: number; ms: number }
  | { t: "fault"; reason: FaultReason; detail: string };

/** The operations the sandbox may ask the host to do. Anything else is a fault. */
export const OPS = ["storage.get", "storage.set", "storage.delete", "storage.list", "http.fetch", "notify", "timer.set", "timer.clear"] as const;
export type Op = (typeof OPS)[number];

/** Which power each operation needs. A timer needs none: it reads nothing and reaches nothing. */
export const OP_POWER: Record<Op, string | null> = {
  "storage.get": "storage",
  "storage.set": "storage",
  "storage.delete": "storage",
  "storage.list": "storage",
  "http.fetch": "network",
  notify: "notifications",
  "timer.set": null,
  "timer.clear": null,
};

export const FAULT_TEXT: Record<FaultReason, string> = {
  cpu: "it was using too much of the processor",
  memory: "it ran out of its memory allowance",
  timeout: "it stopped responding",
  crash: "it crashed",
  flood: "it was sending too many requests",
  boot: "it couldn't start",
  oversize: "it sent something too large",
  integrity: "its code doesn't match what was approved",
};
