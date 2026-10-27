/**
 * The shapes the generated SDK reference is stored in, and the pure functions that read it. The data
 * itself is `reference.generated.ts`, built from the SDKs by `scripts/build-reference.mjs`.
 */

export interface RefDoc {
  summary: string;
  tags: { name: string; text: string }[];
}

export interface RefParam {
  name: string;
  type: string;
  optional: boolean;
  rest: boolean;
  doc: string;
}

export interface RefSignature {
  params: RefParam[];
  returns: string;
  /** `(a: string, b?: number) => Promise<void>` */
  text: string;
  returnsDoc: string;
  doc: string;
}

export type RefMember =
  | { kind: "method"; name: string; doc: RefDoc; optional: boolean; readonly: boolean; static: boolean; signatures: RefSignature[] }
  | { kind: "property" | "accessor"; name: string; doc: RefDoc; optional: boolean; readonly: boolean; static: boolean; type: string };

interface RefBase {
  name: string;
  doc: RefDoc;
  /** The SDK file it is defined in, for "read the source". */
  file: string;
}

export type RefItem =
  | (RefBase & { kind: "class"; extends: string | null; constructors: RefSignature[]; members: RefMember[] })
  | (RefBase & { kind: "namespace"; members: RefMember[] })
  | (RefBase & { kind: "function"; signatures: RefSignature[] })
  | (RefBase & { kind: "constant"; type: string; value: string | null })
  | (RefBase & { kind: "interface"; members: RefMember[] })
  | (RefBase & { kind: "type"; definition: string });

export interface SdkReference {
  kind: "bot" | "extension";
  package: string;
  version: string;
  items: RefItem[];
}

export const KIND_LABEL: Record<RefItem["kind"], string> = {
  class: "Classes",
  namespace: "Modules",
  function: "Functions",
  constant: "Constants",
  interface: "Interfaces",
  type: "Types",
};

export const KIND_ORDER: RefItem["kind"][] = ["class", "namespace", "function", "constant", "interface", "type"];

/** Items grouped by kind, in reading order, keeping only non-empty groups. */
export function groupItems(items: RefItem[]): { kind: RefItem["kind"]; label: string; items: RefItem[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, label: KIND_LABEL[kind], items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);
}

/** Everything searchable about an item, lower-cased: its name, doc, and members' names and docs. */
export function haystack(item: RefItem): string {
  const parts: string[] = [item.name, item.doc.summary];
  if ("members" in item) for (const m of item.members) parts.push(m.name, m.doc.summary);
  if ("signatures" in item) for (const s of item.signatures) parts.push(s.text);
  if (item.kind === "type") parts.push(item.definition);
  return parts.join(" ").toLowerCase();
}

/** Items matching every word typed; a name match ranks above a match in a doc. */
export function searchItems(items: RefItem[], query: string): RefItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  const scored: { item: RefItem; score: number }[] = [];
  for (const item of items) {
    const hay = haystack(item);
    if (!words.every((w) => hay.includes(w))) continue;
    const name = item.name.toLowerCase();
    const memberNames = "members" in item ? item.members.map((m) => m.name.toLowerCase()) : [];
    const score = words.reduce((n, w) => n + (name === w ? 10 : name.includes(w) ? 5 : 0) + (memberNames.some((m) => m === w) ? 3 : memberNames.some((m) => m.includes(w)) ? 1 : 0), 0);
    scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)).map((s) => s.item);
}

/** Members worth showing: methods and accessors first is not what readers want; keep source order, statics first. */
export function orderedMembers(members: RefMember[]): RefMember[] {
  return [...members.filter((m) => m.static), ...members.filter((m) => !m.static)];
}

/** The address of an item within a reference, for linking and for the URL hash. */
export const anchorOf = (kind: "bot" | "extension", name: string, member?: string) => `${kind}/${name}${member ? `.${member}` : ""}`;

// --- Reading the reference --------------------------------------------------------------------

export type SdkKind = "bot" | "extension";
export const SDK_KINDS: SdkKind[] = ["bot", "extension"];
export const SDK_TITLE: Record<SdkKind, string> = { bot: "Bot SDK", extension: "Extension SDK" };

/** `bot/Client.on` → `{ sdk: "bot", name: "Client", member: "on" }`; null if it isn't an address. */
export function parseAnchor(anchor: string): { sdk: SdkKind; name: string; member?: string } | null {
  const m = /^(bot|extension)\/([A-Za-z_$][\w$]*)(?:\.([A-Za-z_$][\w$]*))?$/.exec(anchor.trim());
  return m ? { sdk: m[1] as SdkKind, name: m[2], ...(m[3] ? { member: m[3] } : {}) } : null;
}

export function findItem(ref: SdkReference, name: string): RefItem | undefined {
  return ref.items.find((i) => i.name === name);
}

export const findMember = (item: RefItem, name: string): RefMember | undefined => ("members" in item ? item.members.find((m) => m.name === name) : undefined);

/** The line that brings an item in: types only exist at compile time, so they are imported as types. */
export function importLine(ref: SdkReference, item: RefItem): string {
  const typeOnly = item.kind === "interface" || item.kind === "type";
  return `import ${typeOnly ? "type " : ""}{ ${item.name} } from "${ref.package}";`;
}

/** Where an item's source is in a project: Studio copies each SDK into `.crystal/sdk/<kind>`. */
export const sourcePath = (ref: SdkReference, item: RefItem) => `.crystal/sdk/${ref.kind}/${item.file}`;

export type Segment = { text: string; link?: string };

/**
 * A piece of type text cut into words and the names between them, with the names that are items in the reference marked
 * as links — so `Promise<Message>` can link `Message`. Only whole identifiers match, and never inside another word.
 */
export function tokenize(text: string, known: ReadonlySet<string>): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const at = m.index ?? 0;
    // A property name inside an object type (`{ id: string }`) isn't a reference to an item of that name.
    const after = text.slice(at + m[0].length).trimStart()[0];
    const before = text[at - 1];
    if (!known.has(m[0]) || after === ":" || before === ".") continue;
    if (at > last) out.push({ text: text.slice(last, at) });
    out.push({ text: m[0], link: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

export const knownNames = (ref: SdkReference): Set<string> => new Set(ref.items.map((i) => i.name));

/** A member's one-line description for a list: the first paragraph of its doc, without Markdown fences. */
export function firstLine(doc: RefDoc): string {
  const para = doc.summary.split(/\n\s*\n/)[0] ?? "";
  return para.replace(/\s+/g, " ").trim();
}

/** The properties and the methods of a class or interface, in the order a reader wants them. */
export function memberGroups(item: RefItem): { label: string; members: RefMember[] }[] {
  if (!("members" in item)) return [];
  const ordered = orderedMembers(item.members);
  const groups = [
    { label: "Static", members: ordered.filter((m) => m.static) },
    { label: item.kind === "interface" ? "Properties" : "Properties", members: ordered.filter((m) => !m.static && m.kind !== "method") },
    { label: "Methods", members: ordered.filter((m) => !m.static && m.kind === "method") },
  ];
  return groups.filter((g) => g.members.length > 0);
}

/** The items to suggest first when an SDK is opened with nothing chosen: where a reader starts. */
export const STARTING_POINTS: Record<SdkKind, string[]> = {
  bot: ["Client", "Events", "Message", "Channel", "Community", "EmbedBuilder", "defineCommand"],
  extension: ["Extension", "Panel", "ui", "storage", "http", "defineAction"],
};
