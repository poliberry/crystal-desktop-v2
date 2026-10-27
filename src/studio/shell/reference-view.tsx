"use client";

import { Check, Copy, FileCode2, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Markdown } from "@/studio/docs/markdown";
import {
  SDK_KINDS, SDK_TITLE, STARTING_POINTS, anchorOf, findItem, firstLine, groupItems, importLine, knownNames, memberGroups, parseAnchor, searchItems, sourcePath, tokenize,
  type RefItem, type RefMember, type RefParam, type RefSignature, type SdkKind, type SdkReference,
} from "@/studio/docs/reference";
import { SDK_REFERENCE } from "@/studio/docs/reference.generated";
import { cn } from "@/lib/utils";

/**
 * The SDK reference: every class, function, constant, interface and type of the Bot SDK and the Extension SDK, with its
 * signature and what its doc comment says. It is generated from the SDKs (`scripts/build-reference.mjs`), so it can't name
 * something that isn't there or give it another signature, and it is the SDK the next project will be given.
 */

/** Type text with the names that are in the reference made into links. */
function TypeText({ text, known, onGo, className }: { text: string; known: ReadonlySet<string>; onGo: (name: string) => void; className?: string }) {
  return (
    <code className={cn("font-mono text-[12px] break-words", className)}>
      {tokenize(text, known).map((s, i) =>
        s.link ? (
          <button key={i} type="button" onClick={() => onGo(s.link!)} className="text-sky-500 hover:underline dark:text-sky-400">
            {s.text}
          </button>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </code>
  );
}

function Copy1({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="rounded p-1 text-[var(--ai-dim)] hover:bg-foreground/10 hover:text-foreground"
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
    </button>
  );
}

function Params({ sig, known, onGo }: { sig: RefSignature; known: ReadonlySet<string>; onGo: (n: string) => void }) {
  if (sig.params.length === 0 && !sig.returnsDoc) return null;
  return (
    <div className="mt-2 space-y-1 text-[12px]">
      {sig.params.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {sig.params.map((p: RefParam) => (
            <div key={p.name} className="contents">
              <dt className="font-mono text-[12px]">
                {p.rest ? "…" : ""}
                {p.name}
                {p.optional ? <span className="text-[var(--ai-dim)]">?</span> : null}
              </dt>
              <dd className="min-w-0 text-[var(--ai-dim)]">
                <TypeText text={p.type} known={known} onGo={onGo} />
                {p.doc ? <span> — {p.doc}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {sig.returnsDoc && (
        <p className="text-[var(--ai-dim)]">
          <span className="font-medium text-foreground">Returns</span> {sig.returnsDoc}
        </p>
      )}
    </div>
  );
}

function Signature({ name, sig, known, onGo, prefix = "" }: { name: string; sig: RefSignature; known: ReadonlySet<string>; onGo: (n: string) => void; prefix?: string }) {
  const params = sig.params.map((p) => `${p.rest ? "..." : ""}${p.name}${p.optional ? "?" : ""}: ${p.type}`).join(", ");
  return (
    <div className="overflow-x-auto rounded-[3px] bg-muted/60 px-2.5 py-1.5">
      <code className="font-mono text-[12px] whitespace-pre-wrap">
        <span className="font-semibold text-foreground">{prefix}{name}</span>
        <span className="text-[var(--ai-dim)]">(</span>
        <TypeText text={params} known={known} onGo={onGo} />
        <span className="text-[var(--ai-dim)]">)</span>
        <span className="text-[var(--ai-dim)]">{": "}</span>
        <TypeText text={sig.returns} known={known} onGo={onGo} />
      </code>
    </div>
  );
}

function Member({ owner, m, known, onGo, selected }: { owner: RefItem; m: RefMember; known: ReadonlySet<string>; onGo: (n: string) => void; selected: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "center" });
  }, [selected]);
  const staticPrefix = m.static && owner.kind === "class" ? `${owner.name}.` : "";
  return (
    <div ref={ref} id={`m-${m.name}`} className={cn("scroll-mt-4 rounded-[3px] border border-border/60 p-2.5", selected && "border-[var(--ai-accent,#8b5cf6)] bg-[var(--ai-accent,#8b5cf6)]/5")}>
      {m.kind === "method" ? (
        <div className="space-y-2">
          {m.signatures.map((s, i) => (
            <div key={i}>
              <Signature name={m.name} sig={s} known={known} onGo={onGo} prefix={staticPrefix} />
              <Params sig={s} known={known} onGo={onGo} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <code className="font-mono text-[12px] font-semibold">
            {staticPrefix}
            {m.name}
            {m.optional ? "?" : ""}
          </code>
          <TypeText text={m.type} known={known} onGo={onGo} className="text-[var(--ai-dim)]" />
          {m.readonly && <span className="rounded bg-muted px-1 text-[10px] text-[var(--ai-dim)]">read-only</span>}
        </div>
      )}
      {m.doc.summary && (
        <div className="mt-1.5 text-[13px]">
          <Markdown text={m.doc.summary} />
        </div>
      )}
    </div>
  );
}

function Detail({ ref: sdk, item, member, onGo }: { ref: SdkReference; item: RefItem; member?: string; onGo: (name: string, member?: string) => void }) {
  const known = useMemo(() => knownNames(sdk), [sdk]);
  const go = (n: string) => onGo(n);
  const groups = useMemo(() => memberGroups(item), [item]);
  return (
    <article className="mx-auto max-w-3xl px-8 py-6">
      <p className="text-[11px] tracking-wide text-[var(--ai-dim)] uppercase">
        {SDK_TITLE[sdk.kind]} · {item.kind}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <h1 className="font-mono text-xl font-semibold tracking-tight text-foreground">{item.name}</h1>
        {item.kind === "class" && item.extends && (
          <span className="text-[12px] text-[var(--ai-dim)]">
            extends <TypeText text={item.extends} known={known} onGo={go} />
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1 rounded-[3px] bg-muted/60 px-2.5 py-1">
        <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--ai-dim)]">{importLine(sdk, item)}</code>
        <Copy1 text={importLine(sdk, item)} label="Copy the import" />
      </div>

      {item.doc.summary && (
        <div className="mt-4 text-[13px]">
          <Markdown text={item.doc.summary} />
        </div>
      )}

      {item.kind === "class" && item.constructors.length > 0 && (
        <section className="mt-5">
          <h2 className="mb-2 text-[13px] font-semibold">Constructor</h2>
          <div className="space-y-2">
            {item.constructors.map((c, i) => (
              <div key={i}>
                <Signature name={`new ${item.name}`} sig={c} known={known} onGo={go} />
                <Params sig={c} known={known} onGo={go} />
              </div>
            ))}
          </div>
        </section>
      )}

      {item.kind === "function" && (
        <section className="mt-5 space-y-2">
          {item.signatures.map((s, i) => (
            <div key={i}>
              <Signature name={item.name} sig={s} known={known} onGo={go} />
              <Params sig={s} known={known} onGo={go} />
            </div>
          ))}
        </section>
      )}

      {item.kind === "constant" && (
        <section className="mt-5">
          <div className="overflow-x-auto rounded-[3px] bg-muted/60 px-2.5 py-1.5">
            <code className="font-mono text-[12px] whitespace-pre-wrap">
              <span className="font-semibold">{item.name}</span>
              <span className="text-[var(--ai-dim)]">: </span>
              <TypeText text={item.type} known={known} onGo={go} />
            </code>
          </div>
          {item.value && <p className="mt-1.5 text-[12px] text-[var(--ai-dim)]">= <code className="font-mono">{item.value}</code></p>}
        </section>
      )}

      {item.kind === "type" && (
        <section className="mt-5">
          <div className="overflow-x-auto rounded-[3px] bg-muted/60 px-2.5 py-1.5">
            <TypeText text={item.definition} known={known} onGo={go} className="whitespace-pre-wrap" />
          </div>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.label} className="mt-6">
          <h2 className="mb-2 text-[13px] font-semibold">{g.label}</h2>
          <div className="space-y-2">
            {g.members.map((m) => (
              <Member key={`${m.static}-${m.name}`} owner={item} m={m} known={known} onGo={go} selected={member === m.name} />
            ))}
          </div>
        </section>
      ))}

      <p className="mt-8 flex items-center gap-1.5 text-[12px] text-[var(--ai-dim)]">
        <FileCode2 className="size-3.5" strokeWidth={1.5} />
        Read the source in a project: <code className="font-mono">{sourcePath(sdk, item)}</code>
      </p>
    </article>
  );
}

/**
 * Pick an SDK, search it, and read an item. `anchor` is where to open (`bot/Client`, `bot/Client.on`); `onAnchor` is told
 * when the reader moves, so the place can be kept (and linked to).
 */
export function ReferenceView({ anchor, onAnchor }: { anchor: string; onAnchor: (a: string) => void }) {
  const parsed = parseAnchor(anchor);
  const [sdkKind, setSdkKind] = useState<SdkKind>(parsed?.sdk ?? "bot");
  const [query, setQuery] = useState("");
  const sdk = SDK_REFERENCE[sdkKind];
  const mainRef = useRef<HTMLElement>(null);

  // An address from outside (a link, the Help menu) takes the reader there.
  useEffect(() => {
    const p = parseAnchor(anchor);
    if (p) setSdkKind(p.sdk);
  }, [anchor]);

  const item = parsed && parsed.sdk === sdkKind ? findItem(sdk, parsed.name) : undefined;
  const found = useMemo(() => searchItems(sdk.items, query), [sdk, query]);
  const groups = useMemo(() => groupItems(found), [found]);
  const itemName = item?.name;
  useEffect(() => {
    if (!parsed?.member) mainRef.current?.scrollTo({ top: 0 });
  }, [itemName, sdkKind, parsed?.member]);

  const go = (name: string, member?: string) => {
    setQuery("");
    onAnchor(anchorOf(sdkKind, name, member));
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-64 shrink-0 flex-col ai-edge-r bg-[var(--ai-body)]">
        <div className="flex gap-1 p-2 pb-0">
          {SDK_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={k === sdkKind}
              onClick={() => {
                setSdkKind(k);
                setQuery("");
                onAnchor(anchorOf(k, STARTING_POINTS[k][0]));
              }}
              className={cn("h-6 flex-1 rounded-[3px] text-[12px]", k === sdkKind ? "bg-[var(--ai-row-active)] font-medium text-foreground" : "text-[var(--ai-dim)] hover:bg-[var(--ai-hover)] hover:text-foreground")}
            >
              {SDK_TITLE[k]}
            </button>
          ))}
        </div>
        <p className="px-3 pt-1.5 text-[10px] text-[var(--ai-dim)]">
          <code className="font-mono">{sdk.package}</code> · version {sdk.version}
        </p>
        <div className="p-2">
          <label className="ai-field gap-1.5">
            <Search className="size-3 shrink-0 text-[var(--ai-dim)]" strokeWidth={1.5} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search the ${SDK_TITLE[sdkKind]}`} spellCheck={false} aria-label="Search the reference" />
            {query && (
              <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="text-[var(--ai-dim)] hover:text-foreground">
                <X className="size-3" />
              </button>
            )}
          </label>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto pb-2">
          {found.length === 0 && <p className="px-3 py-2 text-[12px] text-[var(--ai-dim)]">Nothing in the {SDK_TITLE[sdkKind]} mentions “{query}”.</p>}
          {groups.map((g) => (
            <div key={g.kind} className="pt-2">
              <p className="px-3 pb-1 text-[10px] font-semibold tracking-wide text-[var(--ai-dim)] uppercase">{g.label}</p>
              {g.items.map((i) => (
                <button
                  key={i.name}
                  type="button"
                  onClick={() => go(i.name)}
                  aria-current={i.name === itemName}
                  className={cn("block w-full truncate px-3 py-1 text-left font-mono text-[12px] hover:bg-[var(--ai-hover)]", i.name === itemName && "bg-[var(--ai-row-active)] text-foreground")}
                >
                  {i.name}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">
        {item ? (
          <Detail ref={sdk} item={item} member={parsed?.member} onGo={go} />
        ) : (
          <div className="mx-auto max-w-2xl px-8 py-8">
            <h1 className="text-xl font-semibold tracking-tight">{SDK_TITLE[sdkKind]} reference</h1>
            <p className="mt-1 text-[13px] text-[var(--ai-dim)]">
              Every class, function and type in <code className="font-mono">{sdk.package}</code>, with its signature and documentation, read from the SDK itself. {sdk.items.length} items.
            </p>
            <h2 className="mt-6 mb-2 text-[13px] font-semibold">Start with</h2>
            <div className="flex flex-wrap gap-1.5">
              {STARTING_POINTS[sdkKind].filter((n) => findItem(sdk, n)).map((n) => (
                <button key={n} type="button" onClick={() => go(n)} className="rounded-[3px] border border-border/60 px-2 py-1 font-mono text-[12px] hover:bg-[var(--ai-hover)]">
                  {n}
                </button>
              ))}
            </div>
            {groupItems(sdk.items).map((g) => (
              <section key={g.kind} className="mt-6">
                <h2 className="mb-2 text-[13px] font-semibold">{g.label}</h2>
                <div className="space-y-1">
                  {g.items.map((i) => (
                    <button key={i.name} type="button" onClick={() => go(i.name)} className="grid w-full grid-cols-[minmax(0,14rem)_1fr] gap-3 rounded-[3px] px-2 py-1 text-left hover:bg-[var(--ai-hover)]">
                      <code className="truncate font-mono text-[12px]">{i.name}</code>
                      <span className="truncate text-[12px] text-[var(--ai-dim)]">{firstLine(i.doc)}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
