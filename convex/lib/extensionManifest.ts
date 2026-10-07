/**
 * What an extension declares about itself, and the checks run on its code before a
 * person ever sees it.
 *
 * Pure: the server runs it when a version is submitted and is the authority; Crystal
 * Studio runs the same functions while the author edits, so a problem shows up as a
 * line in a list rather than as a rejection later.
 *
 * Two different things are checked and they should not be confused. The *manifest*
 * is a request — which powers the extension wants, and which web addresses it will
 * talk to — and is what a person is asked to agree to. The *scan* is a lint of the
 * code against that request. Neither is what keeps anyone safe: that is the
 * sandbox (an isolated JavaScript engine with nothing in it but the SDK), which
 * enforces every limit whatever the code says or the scan finds.
 */

import { assertPanelUrl } from "./panelClient";

export const CAPABILITIES = ["ui.panel", "storage", "network", "notifications"] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** What a capability lets the extension do, in words for the person agreeing to it. */
export const CAPABILITY_INFO: Record<Capability, { label: string; description: string; risk: "low" | "medium" }> = {
  "ui.panel": { label: "Show a panel", description: "Draw its own panel inside Crystal, built from Crystal's own components.", risk: "low" },
  storage: { label: "Keep some data", description: "Save a small amount of its own data for you (up to 256 KB). Other extensions can't read it.", risk: "low" },
  notifications: { label: "Show notices", description: "Pop up short notices inside Crystal.", risk: "low" },
  network: { label: "Talk to the internet", description: "Send and receive data with the web addresses listed below — and only those.", risk: "medium" },
};

export const EXTENSION_LIMITS = {
  name: 60,
  description: 400,
  source: 256 * 1024,
  origins: 8,
  /** Per value, per key and in all, in the extension's private storage. */
  storageValue: 16 * 1024,
  storageKey: 64,
  storageKeys: 100,
  storageTotal: 256 * 1024,
} as const;

export interface ExtensionManifest {
  v: 1;
  name: string;
  description: string;
  /** `1.2.3` */
  version: string;
  kind: "plugin" | "component";
  capabilities: Capability[];
  /** Origins it may talk to, as `https://host` or `https://host:port`. */
  network: string[];
  panel?: { title: string };
}

const SEMVER = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** A manifest, rebuilt from whatever was sent: nothing is stored as it arrived. */
export function normalizeManifest(input: unknown): ExtensionManifest {
  if (!input || typeof input !== "object") throw new Error("That manifest is broken.");
  const raw = input as Record<string, unknown>;

  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, EXTENSION_LIMITS.name) : "";
  if (name.length < 2) throw new Error("An extension needs a name.");
  const description = typeof raw.description === "string" ? raw.description.trim().slice(0, EXTENSION_LIMITS.description) : "";
  if (description.length < 10) throw new Error("Say what it does, in at least a sentence.");
  const version = String(raw.version ?? "");
  if (!SEMVER.test(version)) throw new Error("A version looks like 1.0.0.");
  const kind = raw.kind === "component" ? "component" : "plugin";

  const caps = Array.isArray(raw.capabilities) ? raw.capabilities : [];
  const capabilities: Capability[] = [];
  for (const c of caps) {
    if (!(CAPABILITIES as readonly string[]).includes(String(c))) throw new Error(`“${String(c)}” isn't something an extension can ask for.`);
    if (!capabilities.includes(c as Capability)) capabilities.push(c as Capability);
  }

  const network: string[] = [];
  for (const o of Array.isArray(raw.network) ? raw.network : []) {
    const origin = assertPanelUrl(String(o));
    // An origin and nothing more: a path in the list would read as narrower than it is.
    if (String(o).replace(/\/+$/, "") !== origin) throw new Error(`Use just the address of the site, like ${origin}.`);
    if (!network.includes(origin)) network.push(origin);
  }
  if (network.length > EXTENSION_LIMITS.origins) throw new Error(`An extension can talk to up to ${EXTENSION_LIMITS.origins} sites.`);
  if (network.length > 0 && !capabilities.includes("network")) throw new Error("It lists sites to talk to but doesn't ask for the network power.");
  if (capabilities.includes("network") && network.length === 0) throw new Error("It asks for the network power but doesn't say which sites.");

  const out: ExtensionManifest = { v: 1, name, description, version, kind, capabilities, network };
  if (capabilities.includes("ui.panel")) {
    const title = typeof (raw.panel as { title?: unknown } | undefined)?.title === "string" ? (raw.panel as { title: string }).title.trim().slice(0, 40) : name.slice(0, 40);
    out.panel = { title: title || name.slice(0, 40) };
  }
  return out;
}

// --- The scan --------------------------------------------------------------------------------

export interface Finding {
  level: "error" | "warning" | "info";
  message: string;
}

/** The SDK calls that need a power, so use can be compared with what was asked for. */
const USES: [Capability, RegExp][] = [
  ["ui.panel", /\bcrystal\s*\.\s*ui\b/],
  ["storage", /\bcrystal\s*\.\s*storage\b/],
  ["network", /\bcrystal\s*\.\s*http\b/],
  ["notifications", /\bcrystal\s*\.\s*notify\b/],
];

/** Code that builds more code at run time. Inside the sandbox it can't reach anything,
 * but a reviewer can't read what doesn't exist until it runs — so it isn't allowed. */
const DYNAMIC: [RegExp, string][] = [
  [/\beval\s*\(/, "eval()"],
  [/\bnew\s+Function\s*\(/, "new Function()"],
  [/(^|[^.\w])Function\s*\(/, "Function()"],
  [/\bimport\s*\(/, "import()"],
  [/\bimportScripts\b/, "importScripts"],
  [/\bsetTimeout\s*\(\s*['"`]/, "a string passed to setTimeout"],
  [/\.\s*constructor\s*\.\s*constructor\b/, "constructor.constructor"],
];

/** Mentions of things that don't exist in the sandbox: a sign the code was written for a browser. */
const NOT_THERE = /\b(window|document|localStorage|sessionStorage|XMLHttpRequest|WebSocket|navigator|indexedDB|postMessage|require)\b\s*[.(\[]/;

export function scanSource(source: string, manifest: ExtensionManifest): Finding[] {
  const out: Finding[] = [];
  if (!source.trim()) return [{ level: "error", message: "There is no code." }];
  const bytes = new TextEncoder().encode(source).length;
  if (bytes > EXTENSION_LIMITS.source) out.push({ level: "error", message: `The code is ${(bytes / 1024).toFixed(0)} KB; the limit is ${EXTENSION_LIMITS.source / 1024} KB.` });

  // Top-level module syntax: the engine runs a script, so `import`/`export` is a syntax error.
  if (/^\s*(import\s[^(]|export\s)/m.test(source)) {
    out.push({ level: "error", message: "It uses `import` or `export`. Bundle it into one plain script first (an IIFE) — the sandbox runs a script, not modules." });
  }
  for (const [re, label] of DYNAMIC) {
    if (re.test(source)) out.push({ level: "error", message: `It uses ${label}, which builds code at run time. Extensions have to be readable as submitted.` });
  }
  if (NOT_THERE.test(source)) {
    out.push({ level: "warning", message: "It refers to browser things (window, document, fetch…). None of those exist in the sandbox — use the `crystal` SDK instead." });
  }
  if (/\bfetch\s*\(/.test(source) && !/crystal\s*\.\s*http/.test(source)) {
    out.push({ level: "warning", message: "It calls `fetch()`, which doesn't exist here. Use `crystal.http.fetch()`." });
  }
  // Minified code is allowed (bundlers produce it) but can't be read, so it is flagged for the reviewer.
  const lines = source.split("\n");
  if (lines.length < 5 && source.length > 8000) out.push({ level: "info", message: "The code looks minified. Reviewers can read it, but a readable build is easier to approve." });
  if (/[A-Za-z0-9+/=]{2000,}/.test(source)) out.push({ level: "warning", message: "It contains a very long encoded string. If it's data, say what it is in the description; if it's code, it's not allowed." });

  const declared = new Set(manifest.capabilities);
  for (const [cap, re] of USES) {
    const used = re.test(source);
    if (used && !declared.has(cap)) out.push({ level: "error", message: `It uses ${CAPABILITY_INFO[cap].label.toLowerCase()} (\`${cap}\`) but doesn't ask for it in the manifest.` });
    if (!used && declared.has(cap)) out.push({ level: "warning", message: `It asks for “${CAPABILITY_INFO[cap].label}” (\`${cap}\`) but never uses it. Ask only for what it needs.` });
  }

  // Addresses written into the code that aren't in the manifest's list: it can't reach them anyway, but it is a mistake or an attempt.
  const allowed = new Set(manifest.network);
  for (const m of source.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g)) {
    let origin: string;
    try {
      origin = new URL(m[0]).origin;
    } catch {
      continue;
    }
    if (!allowed.has(origin) && !/^https?:\/\/(www\.)?(w3\.org|json-schema\.org|example\.com|crystal\.app)$/.test(origin) && declared.has("network")) {
      out.push({ level: "warning", message: `The code mentions ${origin}, which isn't in the list of sites it may talk to.` });
      break;
    }
  }
  if (out.every((f) => f.level !== "error")) out.unshift({ level: "info", message: "No blocking problems found. This is a lint, not a guarantee — the sandbox is what enforces limits." });
  return out;
}

export const hasBlocking = (findings: Finding[]) => findings.some((f) => f.level === "error");

/** SHA-256 of the code, lower-case hex: what the client checks before running it. */
export async function sourceHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
