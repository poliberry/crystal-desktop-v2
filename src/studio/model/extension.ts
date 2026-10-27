import { normalizeManifest, scanSource, type ExtensionManifest, type Finding } from "../../../convex/lib/extensionManifest";
import type { ExtensionData } from "@/studio/model/types";

/** `My Cool Thing!` → `my-cool-thing`, the id a published extension is known by. */
export const slugFor = (name: string): string =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "my-extension";

export function newExtension(name: string): ExtensionData {
  return {
    slug: slugFor(name),
    kind: "plugin",
    description: "",
    version: "1.0.0",
    capabilities: ["ui.panel", "storage"],
    network: [],
    panelTitle: name.slice(0, 40),
  };
}

/** The manifest the server will rebuild from this. */
export function manifestOf(name: string, e: ExtensionData): Record<string, unknown> {
  return { v: 1, name, description: e.description, version: e.version, kind: e.kind, capabilities: e.capabilities, network: e.network, panel: { title: e.panelTitle || name } };
}

export interface ExtensionCheck {
  manifest: ExtensionManifest | null;
  findings: Finding[];
  /** Nothing blocks publishing. */
  ok: boolean;
}

/**
 * The server's own checks, run as the author works — the same functions that decide on submission.
 * The manifest is checked from the settings alone; the code is only scanned once there is a built
 * script to scan, since what is reviewed is the script and not the TypeScript it came from.
 */
export function checkExtension(name: string, e: ExtensionData, compiled: string | null): ExtensionCheck {
  const findings: Finding[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.slug) || e.slug.length > 40) {
    findings.push({ level: "error", message: "The id can use lowercase letters, numbers and hyphens." });
  }
  let manifest: ExtensionManifest | null = null;
  try {
    manifest = normalizeManifest(manifestOf(name, e));
  } catch (err) {
    findings.push({ level: "error", message: err instanceof Error ? err.message : "The manifest isn't valid." });
  }
  if (manifest && compiled !== null) {
    findings.push(...scanSource(compiled, manifest).filter((f) => !(f.level === "info" && f.message.startsWith("No blocking"))));
  } else if (manifest) {
    findings.push({ level: "info", message: "The code is checked when you build it." });
  }
  const ok = !!manifest && compiled !== null && findings.every((f) => f.level !== "error");
  if (ok && findings.length === 0) findings.push({ level: "info", message: "No problems found. The sandbox, not this check, is what enforces limits." });
  return { manifest, findings, ok };
}
