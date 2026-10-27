"use client";

import { useMutation, useQuery } from "convex/react";
import { BookOpen, History, Loader2, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, Loading, PageHeader, Panel, StatusPill, useRun } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DOC_KINDS, DOC_KIND_LABELS, DOC_LIMITS, DOC_TOPICS, DOC_TOPIC_LABELS, normalizeDoc, slugify, type DocKind, type DocTopic } from "../../../../convex/lib/studioDocs";
import { BUILT_IN_GUIDES } from "@/studio/docs/built-in.generated";
import { FACT_NAMES, expand } from "@/studio/docs/facts";
import { Markdown } from "@/studio/docs/markdown";
import { docLinks, type PageData } from "@/studio/docs/pages";
import { formatRelative } from "@/lib/money";
import { cn } from "@/lib/utils";

interface Draft extends PageData {
  published: boolean;
}

/** A page saved in the console, as the server lists it. */
export interface SavedPage extends Draft {
  id: Id<"studioDocs">;
  updatedAt: number;
}

export interface Revision {
  id: Id<"studioDocRevisions">;
  title: string;
  createdAt: number;
  editedBy: string;
}

/** What the editor needs from the server. The section wires these to Convex; a test wires them to memory. */
export interface GuidesBackend {
  /** `undefined` while loading. */
  saved: SavedPage[] | undefined;
  /** Earlier versions of the page whose history is open, once loaded. */
  revisions: Revision[] | undefined;
  onHistory(slug: string | null): void;
  save(page: Draft & { id?: Id<"studioDocs"> }): Promise<unknown>;
  remove(id: Id<"studioDocs">): Promise<unknown>;
  restore(revisionId: Id<"studioDocRevisions">): Promise<unknown>;
}

interface Row {
  slug: string;
  title: string;
  topic: DocTopic;
  /** Where the text on offer comes from. */
  state: "built-in" | "edited" | "added" | "draft";
  id?: Id<"studioDocs">;
  shipped?: PageData;
  saved?: Draft & { updatedAt: number };
}

const blank = (): Draft => ({ slug: "", title: "", topic: "general", kind: "article", section: "", summary: "", body: "", order: 100, published: true });

const select = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";

function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * The guides in Studio's Explore tab: the pages that ship with the app, and any staff change to them.
 *
 * A page here is Markdown. Saving one with the address of a shipped page replaces it for everybody
 * at once, with no release; removing that saved page brings the shipped text back. A new address adds
 * a page. Drafts are seen only here. Every change is audited and the last twenty versions of a page
 * are kept, so a bad edit is a click to undo.
 */
export function GuidesSection() {
  const saved = useQuery(api.studioDocs.adminList, {});
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const revisions = useQuery(api.studioDocs.adminRevisions, historyOf ? { slug: historyOf } : "skip");
  const save = useMutation(api.studioDocs.adminSave);
  const remove = useMutation(api.studioDocs.adminRemove);
  const restore = useMutation(api.studioDocs.adminRestore);
  return (
    <GuidesView
      saved={saved}
      revisions={revisions}
      onHistory={setHistoryOf}
      save={(page) => save(page)}
      remove={(id) => remove({ id })}
      restore={(revisionId) => restore({ revisionId })}
    />
  );
}

export function GuidesView({ saved, revisions, onHistory, save, remove, restore }: GuidesBackend) {
  const { run, busy } = useRun();

  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>(blank());
  const [original, setOriginal] = useState<string>("");
  const [view, setView] = useState<"edit" | "split" | "preview">("split");
  const [history, setHistory] = useState(false);
  // The server is only asked for a page's versions while they are showing.
  useEffect(() => {
    onHistory(history && selected && selected !== "new" ? selected : null);
  }, [history, selected, onHistory]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Bumped to load the page's text again: after going back to the shipped page, or restoring a version. */
  const [reload, setReload] = useState(0);

  const rows = useMemo<Row[]>(() => {
    const by = new Map<string, Row>();
    for (const s of BUILT_IN_GUIDES) by.set(s.slug, { slug: s.slug, title: s.title, topic: s.topic, state: "built-in", shipped: s });
    for (const d of saved ?? []) {
      const prior = by.get(d.slug);
      const full: Draft & { updatedAt: number } = { slug: d.slug, title: d.title, topic: d.topic, kind: d.kind, section: d.section, summary: d.summary, body: d.body, order: d.order, published: d.published, updatedAt: d.updatedAt };
      by.set(d.slug, { slug: d.slug, title: d.title, topic: d.topic, state: !d.published ? "draft" : prior?.shipped ? "edited" : "added", id: d.id, shipped: prior?.shipped, saved: full });
    }
    const orderOf = (r: Row) => (r.saved ?? r.shipped)?.order ?? 0;
    return [...by.values()].sort((a, b) => DOC_TOPICS.indexOf(a.topic) - DOC_TOPICS.indexOf(b.topic) || orderOf(a) - orderOf(b) || a.title.localeCompare(b.title));
  }, [saved]);

  const current = selected && selected !== "new" ? rows.find((r) => r.slug === selected) : undefined;
  const allSlugs = useMemo(() => new Set(rows.map((r) => r.slug)), [rows]);

  // Choosing a page loads its text: the saved version if there is one, else the shipped one.
  useEffect(() => {
    if (selected === "new") {
      const fresh = blank();
      setDraft(fresh);
      setOriginal(JSON.stringify(fresh));
    } else if (current) {
      const source = current.saved ?? { ...current.shipped!, published: true };
      const next: Draft = { slug: source.slug, title: source.title, topic: source.topic, kind: source.kind, section: source.section, summary: source.summary, body: source.body, order: source.order, published: source.published };
      setDraft(next);
      setOriginal(JSON.stringify(next));
    }
    // Only when a different page is chosen, not when the list refreshes under an edit in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, current?.slug, reload]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const dirty = JSON.stringify(draft) !== original;

  const problem = useMemo(() => {
    try {
      normalizeDoc(draft);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, [draft]);
  const taken = rows.some((r) => r.slug === draft.slug && r.slug !== current?.slug);
  const deadLinks = useMemo(() => docLinks(draft.body).filter((s) => !allSlugs.has(s)), [draft.body, allSlugs]);
  const unknownFacts = useMemo(() => [...draft.body.matchAll(/\{\{([a-z-]+)\}\}/g)].map((m) => m[1]).filter((n) => !FACT_NAMES.includes(n)), [draft.body]);

  const doSave = () =>
    run(
      "save",
      async () => {
        const id = await save({ id: current?.id, ...draft });
        // The list reloads on its own; keep the editor on the page, under its new address if that changed.
        setOriginal(JSON.stringify(draft));
        setSelected(draft.slug);
        return id;
      },
      draft.published ? "Saved and published." : "Saved as a draft.",
    );

  const doRemove = async () => {
    if (!current?.id) return;
    await run("remove", () => remove(current.id!), current.shipped ? "Back to the version that ships with the app." : "Page deleted.");
    setConfirmDelete(false);
    if (!current.shipped) setSelected(null);
    else setReload((n) => n + 1); // show the shipped text again
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Studio guides"
        icon={BookOpen}
        description="The guides in Studio's Explore tab. Edit the ones that ship with the app, or add new ones. Changes reach everyone straight away."
        actions={
          <Button size="sm" onClick={() => setSelected("new")}>
            <Plus className="size-4" /> New page
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Panel flush className="self-start">
          <div className="border-b border-foreground/10 p-2">
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a page" aria-label="Find a page" />
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {saved === undefined ? (
              <Loading />
            ) : (
              DOC_TOPICS.map((t) => {
                const list = rows.filter((r) => r.topic === t && (r.title + " " + r.slug).toLowerCase().includes(filter.toLowerCase()));
                if (!list.length) return null;
                return (
                  <div key={t} className="py-1">
                    <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{DOC_TOPIC_LABELS[t]}</p>
                    {list.map((r) => (
                      <button
                        key={r.slug}
                        type="button"
                        onClick={() => setSelected(r.slug)}
                        className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-foreground/5", selected === r.slug && "bg-foreground/10")}
                      >
                        <span className="min-w-0 flex-1 truncate">{r.title}</span>
                        {r.state !== "built-in" && <StatusPill tone={r.state === "draft" ? "warn" : r.state === "edited" ? "info" : "good"}>{r.state}</StatusPill>}
                      </button>
                    ))}
                  </div>
                );
              })
            )}
          </div>
        </Panel>

        {!selected ? (
          <Panel>
            <EmptyState icon={BookOpen} title="Choose a page to edit">
              Pages marked <em>edited</em> or <em>added</em> have been changed in this console; the rest are as shipped with the app. Editing a shipped page saves a replacement, and removing it brings the original back.
            </EmptyState>
          </Panel>
        ) : (
          <Panel
            title={selected === "new" ? "New page" : draft.title || "Untitled"}
            description={selected === "new" ? "Pick an address that isn't used yet." : current?.state === "built-in" ? "As shipped with the app. Saving replaces it for everyone." : current?.saved ? `Last changed ${formatRelative(current.saved.updatedAt)}.` : undefined}
            actions={
              <>
                {current?.saved && (
                  <Button size="sm" variant="ghost" onClick={() => setHistory((h) => !h)}>
                    <History className="size-4" /> Versions
                  </Button>
                )}
                {current?.saved && (
                  <Button size="sm" variant="ghost" className={current.shipped ? undefined : "text-destructive hover:text-destructive"} onClick={() => setConfirmDelete(true)}>
                    {current.shipped ? <RotateCcw className="size-4" /> : <Trash2 className="size-4" />} {current.shipped ? "Back to shipped" : "Delete"}
                  </Button>
                )}
              </>
            }
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Title">
                  <Input value={draft.title} maxLength={DOC_LIMITS.title} onChange={(e) => set({ title: e.target.value })} />
                </Field>
                <Field
                  label="Address"
                  hint={taken ? "Another page has this address." : current?.shipped ? "This is the shipped page's address: keep it to replace the page." : "Lower-case words and hyphens, / between folders. A link to this page is [text](doc:address)."}
                >
                  <div className="flex gap-1.5">
                    <Input value={draft.slug} className="font-mono text-xs" disabled={!!current?.shipped} onChange={(e) => set({ slug: e.target.value })} />
                    {selected === "new" && (
                      <Button type="button" variant="secondary" size="sm" onClick={() => set({ slug: slugify(`${draft.topic === "general" ? "" : draft.topic + "/"}${draft.title}`) })}>
                        From title
                      </Button>
                    )}
                  </div>
                </Field>
                <Field label="About">
                  <select className={select} value={draft.topic} onChange={(e) => set({ topic: e.target.value as DocTopic })}>
                    {DOC_TOPICS.map((t) => (
                      <option key={t} value={t}>
                        {DOC_TOPIC_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Kind">
                  <select className={select} value={draft.kind} onChange={(e) => set({ kind: e.target.value as DocKind })}>
                    {DOC_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {DOC_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Section" hint="The heading it is listed under.">
                  <Input value={draft.section} maxLength={DOC_LIMITS.section} onChange={(e) => set({ section: e.target.value })} />
                </Field>
                <Field label="Order" hint="Lowest first, within the topic.">
                  <Input type="number" value={draft.order} onChange={(e) => set({ order: Number(e.target.value) })} />
                </Field>
                <Field label="Summary" className="sm:col-span-2" hint={`One sentence, shown under the title and in search. ${draft.summary.length}/${DOC_LIMITS.summary}`}>
                  <Input value={draft.summary} maxLength={DOC_LIMITS.summary} onChange={(e) => set({ summary: e.target.value })} />
                </Field>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium">Page</p>
                  <div className="ml-auto flex overflow-hidden rounded-md border border-border text-xs">
                    {(["edit", "split", "preview"] as const).map((v) => (
                      <button key={v} type="button" onClick={() => setView(v)} className={cn("px-2.5 py-1 capitalize", view === v ? "bg-foreground/10" : "hover:bg-foreground/5")}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={cn("grid gap-3", view === "split" && "lg:grid-cols-2")}>
                  {view !== "preview" && (
                    <Textarea
                      value={draft.body}
                      onChange={(e) => set({ body: e.target.value })}
                      spellCheck
                      aria-label="Page text (Markdown)"
                      className="h-[32rem] resize-y font-mono text-xs leading-relaxed [field-sizing:fixed]"
                    />
                  )}
                  {view !== "edit" && (
                    <div className="h-[32rem] overflow-y-auto rounded-md border border-border bg-background/40 p-4">
                      {draft.body.trim() ? <Markdown text={expand(draft.body)} onDoc={(s) => allSlugs.has(s) && !dirty && setSelected(s)} /> : <p className="text-sm text-muted-foreground">Nothing to show yet.</p>}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  <span>
                    {draft.body.length.toLocaleString()} / {DOC_LIMITS.body.toLocaleString()} characters
                  </span>
                  <span>Markdown: headings, lists, tables, **bold**, `code`, ```` ~~~ts fences ````. Links to other pages: [text](doc:bots/events). No HTML.</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-muted-foreground">Tables read from the code (inserts a placeholder):</span>
                  {FACT_NAMES.map((n) => (
                    <button key={n} type="button" className="rounded border border-border px-1.5 py-0.5 font-mono hover:bg-foreground/5" onClick={() => set({ body: draft.body + (draft.body.endsWith("\n") ? "" : "\n") + `\n{{${n}}}\n` })}>
                      {n}
                    </button>
                  ))}
                </div>
                {(deadLinks.length > 0 || unknownFacts.length > 0) && (
                  <p className="text-xs text-amber-500">
                    {deadLinks.length > 0 && <>Links to pages that don't exist: {deadLinks.join(", ")}. </>}
                    {unknownFacts.length > 0 && <>Placeholders that don't exist: {unknownFacts.join(", ")}.</>}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 border-t border-foreground/10 pt-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={draft.published} onChange={(e) => set({ published: e.target.checked })} />
                  Published
                </label>
                <span className="text-xs text-muted-foreground">{draft.published ? "Everyone sees it in Explore." : "A draft: only seen here. For a shipped page, the shipped text still shows."}</span>
                <div className="ml-auto flex items-center gap-3">
                  {(problem || taken) && dirty && <span className="max-w-sm text-xs text-destructive">{taken ? "Another page has this address." : problem}</span>}
                  <Button disabled={!!busy || !dirty || !!problem || taken} onClick={() => void doSave()}>
                    {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
                  </Button>
                </div>
              </div>

              {history && (
                <div className="space-y-1 border-t border-foreground/10 pt-4">
                  <p className="text-xs font-medium">Earlier versions</p>
                  {revisions === undefined ? (
                    <Loading />
                  ) : revisions.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No earlier versions yet. One is kept each time the text changes.</p>
                  ) : (
                    revisions.map((r) => (
                      <div key={r.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                          {formatRelative(r.createdAt)} · {r.editedBy} · {r.title}
                        </span>
                        <Button size="sm" variant="secondary" disabled={!!busy || dirty} title={dirty ? "Save or discard your changes first" : undefined} onClick={() => void run("restore", () => restore(r.id), "Restored.").then(() => setReload((n) => n + 1))}>
                          Restore
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </Panel>
        )}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{current?.shipped ? "Go back to the shipped page?" : "Delete this page?"}</DialogTitle>
            <DialogDescription>{current?.shipped ? "Your version and its earlier versions are removed, and everyone sees the page as it ships with the app." : "It disappears from Explore, and its earlier versions are removed. This can't be undone."}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={!!busy} onClick={() => void doRemove()}>
              {busy === "remove" && <Loader2 className="size-4 animate-spin" />} {current?.shipped ? "Go back" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
