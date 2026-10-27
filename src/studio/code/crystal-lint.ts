import { CAPABILITY_INFO, DYNAMIC, type Capability } from "../../../convex/lib/extensionManifest";

/**
 * Crystal's own checks on an extension's TypeScript, run as it is written.
 *
 * TypeScript already says when code is wrong. This says when it is wrong *for Crystal*: it uses a
 * power the extension hasn't asked for, builds code at run time (which reviewers can't read, so it
 * is refused), imports a package the sandbox can't load, or names a web address it isn't allowed to
 * reach. The rules are the server's own — the capability names and wording come from
 * `extensionManifest`, and the forbidden-code list is that file's `DYNAMIC` — so the editor and the
 * review agree, but they are applied to the source, with exact positions, rather than to the bundle.
 *
 * Pure (no editor needed), so it is tested on its own. It is a lint: the sandbox, not this, is what
 * enforces anything.
 */

export interface LintFinding {
  /** Offsets into the source. */
  start: number;
  end: number;
  severity: "error" | "warning";
  message: string;
  /** Which rule, so a marker can be told apart and a fix offered. */
  code: "capability" | "dynamic-code" | "import" | "origin";
  /** For `capability`: the power to turn on. */
  capability?: Capability;
}

export interface LintOptions {
  capabilities: readonly string[];
  network: readonly string[];
}

/** What each part of the SDK needs, by the name it is exported under. */
export const SDK_POWER: Record<string, Capability> = { storage: "storage", http: "network", notify: "notifications", ui: "ui.panel", Panel: "ui.panel" };

/**
 * The source with its comments (and optionally its strings' contents) blanked to spaces, so a rule
 * never fires on a word in a comment or a message, and offsets still line up with the original.
 * String quotes are kept, which is what lets a rule see "a string starts here".
 */
export function blank(src: string, strings: boolean): string {
  const out = src.split("");
  const clear = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  // Template literals nest (`${ `${x}` }`), so what each open `${` returns to is kept on a stack.
  const stack: ("brace" | "template")[] = [];
  let i = 0;
  const template = () => {
    // Inside the text of a template literal, from just after the opening backtick or a closing `}`.
    const from = i;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") i += 2;
      else if (c === "`") {
        if (strings) clear(from, i);
        i++;
        return;
      } else if (c === "$" && src[i + 1] === "{") {
        if (strings) clear(from, i);
        i += 2;
        stack.push("template");
        return;
      } else i++;
    }
    if (strings) clear(from, src.length);
  };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const s = i;
      while (i < src.length && src[i] !== "\n") i++;
      clear(s, i);
    } else if (c === "/" && n === "*") {
      const s = i;
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      clear(s, i);
    } else if (c === '"' || c === "'") {
      const s = ++i;
      while (i < src.length && src[i] !== c && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
      if (strings) clear(s, Math.min(i, src.length));
      i++;
    } else if (c === "`") {
      i++;
      template();
    } else if (c === "{") {
      stack.push("brace");
      i++;
    } else if (c === "}") {
      i++;
      if (stack.pop() === "template") template();
    } else i++;
  }
  return out.join("");
}

const IDENT = /[A-Za-z_$][\w$]*/;

/** Names the code has for the SDK: `{ storage as store }` → store ↦ storage; `* as sdk` → sdk is a namespace. */
function sdkNames(code: string) {
  const named = new Map<string, string>();
  const namespaces = new Set<string>();
  const ranges: [number, number][] = [];
  for (const m of code.matchAll(/\bimport\s+(?:type\s+)?([^;]*?)\s+from\s*(['"])@crystal\/extension\2/g)) {
    ranges.push([m.index!, m.index! + m[0].length]);
    const clause = m[1];
    const ns = new RegExp(`\\*\\s*as\\s+(${IDENT.source})`).exec(clause);
    if (ns) namespaces.add(ns[1]);
    const braces = /\{([^}]*)\}/.exec(clause);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const mm = new RegExp(`^\\s*(?:type\\s+)?(${IDENT.source})(?:\\s+as\\s+(${IDENT.source}))?\\s*$`).exec(part);
        if (mm) named.set(mm[2] ?? mm[1], mm[1]);
      }
    }
  }
  return { named, namespaces, ranges };
}

export function lintExtension(source: string, opts: LintOptions): LintFinding[] {
  const out: LintFinding[] = [];
  const code = blank(source, true);
  const withStrings = blank(source, false);
  const declared = new Set(opts.capabilities);

  // --- Code that builds code at run time ------------------------------------------------------
  for (const [re, label] of DYNAMIC) {
    const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    // `setTimeout("…")` needs the string's opening quote, which `code` keeps.
    for (const m of code.matchAll(global)) {
      // Some patterns begin with a group for "the character before" so `.Function(` isn't caught.
      const lead = typeof m[1] === "string" ? m[1].length : 0;
      out.push({ start: m.index! + lead, end: m.index! + m[0].length, severity: "error", code: "dynamic-code", message: `This uses ${label}, which builds code at run time. Extensions have to be readable as submitted.` });
    }
  }

  // --- Imports the sandbox can't load -----------------------------------------------------------
  for (const m of withStrings.matchAll(/(?:\bimport\s+(?:type\s+)?(?:[^;'"]*?\s+from\s*)?|\bexport\s+[^;'"]*?\s+from\s*)(['"])([^'"\n]+)\1/g)) {
    const spec = m[2];
    if (spec.startsWith("./") || spec.startsWith("../") || spec === "@crystal/extension") continue;
    const at = m.index! + m[0].lastIndexOf(spec);
    out.push({ start: at, end: at + spec.length, severity: "error", code: "import", message: `“${spec}” can't be imported. An extension is one script that runs in a sandbox, so it can only import its own files (like “./helpers”) and “@crystal/extension”.` });
  }

  // --- Powers used, against powers asked for ----------------------------------------------------
  const { named, namespaces, ranges } = sdkNames(withStrings);
  const outsideImports = (index: number) => !ranges.some(([a, b]) => index >= a && index < b);
  const need = (cap: Capability, start: number, end: number) => {
    if (declared.has(cap)) return;
    const info = CAPABILITY_INFO[cap];
    out.push({
      start,
      end,
      severity: "error",
      code: "capability",
      capability: cap,
      message: `This uses “${info.label}” (${cap}), but the extension hasn't asked for it. Tick it under “What it asks for” in the project settings.`,
    });
  };
  for (const [local, original] of named) {
    const power = SDK_POWER[original];
    if (!power) continue;
    // A use of the name that isn't a property of something else (`foo.storage`) or an object key.
    for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${local.replace(/\$/g, "\\$")}(?![\\w$])(?!\\s*:)`, "g"))) {
      if (outsideImports(m.index!)) need(power, m.index!, m.index! + local.length);
    }
  }
  for (const ns of namespaces) {
    for (const m of code.matchAll(new RegExp(`(?<![\\w$.])${ns.replace(/\$/g, "\\$")}\\s*\\.\\s*(${IDENT.source})`, "g"))) {
      const power = SDK_POWER[m[1]];
      if (power && outsideImports(m.index!)) need(power, m.index!, m.index! + m[0].length);
    }
  }
  // The raw host object, for code that goes round the SDK.
  for (const [cap, member] of [["ui.panel", "ui"], ["storage", "storage"], ["network", "http"], ["notifications", "notify"]] as const) {
    for (const m of code.matchAll(new RegExp(`\\bcrystal\\s*\\.\\s*${member}\\b`, "g"))) need(cap, m.index!, m.index! + m[0].length);
  }

  // --- Addresses outside the list of sites ------------------------------------------------------
  if (declared.has("network")) {
    const allowed = new Set(opts.network);
    for (const m of withStrings.matchAll(/https?:\/\/[A-Za-z0-9.-]+(?::\d+)?/g)) {
      let origin: string;
      try {
        origin = new URL(m[0]).origin;
      } catch {
        continue;
      }
      if (allowed.has(origin) || /^https?:\/\/(www\.)?(w3\.org|json-schema\.org|example\.com|crystal\.app)$/.test(origin)) continue;
      out.push({
        start: m.index!,
        end: m.index! + m[0].length,
        severity: "warning",
        code: "origin",
        message: origin.startsWith("http://") ? `${origin} isn't https. Extensions can only reach https sites, and only the ones listed under “Sites it may talk to”.` : `${origin} isn't in the list of sites this extension may talk to. Add it under “Sites it may talk to” or the request is refused.`,
      });
    }
  }

  return out.sort((a, b) => a.start - b.start);
}

/**
 * Which powers the source uses, for showing "uses: storage, network" next to what was asked for.
 * Just the capability findings with every power treated as declared turned inside out.
 */
export function powersUsed(source: string): Capability[] {
  const none = lintExtension(source, { capabilities: [], network: [] });
  return [...new Set(none.filter((f) => f.code === "capability").map((f) => f.capability!))];
}
