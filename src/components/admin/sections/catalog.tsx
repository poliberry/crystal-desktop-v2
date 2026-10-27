"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowDown, ArrowUp, Check, FolderTree, Loader2, Package, Plus, Search, Sparkles, Star, Trash2 } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  EmptyState,
  ListRow,
  Loading,
  PageHeader,
  Panel,
  PillTabs,
  StatusPill,
  useRun,
  useStaff,
  type Tone,
} from "@/components/admin/admin-ui";
import { useOpenEntity } from "@/components/admin/console-state";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { formatMoney } from "@/lib/money";

/** A small picture for a row: the item's own, or its kind's icon. */
function KindTile({ sku }: { sku: { imageUrl?: string; grants: { kind: string }[] } }) {
  const Icon = (GRANT_KIND_META[sku.grants[0]?.kind as GrantKind] ?? GRANT_KIND_META.plan).icon;
  return sku.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={sku.imageUrl} alt="" className="size-10 shrink-0 rounded-lg bg-foreground/5 object-contain" />
  ) : (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-foreground/5 text-muted-foreground">
      <Icon className="size-5" />
    </div>
  );
}

type Filter = "all" | "active" | "draft" | "archived";
const STATUS_TONE: Record<string, Tone> = { active: "good", draft: "warn", archived: "neutral" };

export function CatalogSection() {
  const staff = useStaff();
  const open = useOpenEntity();
  const skus = useQuery(api.catalog.adminListSkus);
  const seed = useMutation(api.catalog.seedStarterCatalog);
  const { run, busy } = useRun();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (skus ?? []).filter(
      (s) =>
        (filter === "all" || s.status === filter) &&
        (!needle || s.name.toLowerCase().includes(needle) || s.slug.includes(needle) || s.category.toLowerCase().includes(needle)),
    );
  }, [skus, filter, search]);

  const count = (status: string) => skus?.filter((s) => s.status === status).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Catalogue"
        description="Everything for sale: what it gives, what it costs and whether it is visible."
        icon={Package}
        actions={
          staff.can("catalog.write") && (
            <Button onClick={() => open({ kind: "sku", id: `new:${Date.now()}`, title: "New item", subtitle: "Draft" }, { ctrlKey: true })}>
              <Plus /> New item
            </Button>
          )
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: "all", label: "All" },
            { id: "active", label: "On sale", count: count("active") },
            { id: "draft", label: "Drafts", count: count("draft") },
            { id: "archived", label: "Archived" },
          ]}
        />
        <div className="relative w-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter items" className="h-8 pl-9" />
        </div>
      </div>

      <Panel flush>
        {skus === undefined ? (
          <Loading />
        ) : shown.length === 0 ? (
          <EmptyState icon={Package} title={skus.length === 0 ? "The catalogue is empty" : "Nothing matches"}>
            {skus.length === 0 && staff.can("catalog.write") && (
              <Button
                className="mt-3"
                variant="outline"
                disabled={busy === "seed"}
                onClick={() => void run("seed", () => seed({}), "Starter catalogue added.")}
              >
                {busy === "seed" ? <Loader2 className="animate-spin" /> : <Sparkles />} Add the starter catalogue
              </Button>
            )}
          </EmptyState>
        ) : (
          <div className="divide-y divide-foreground/10">
            {shown.map((s) => (
              <ListRow key={s.id} onOpen={(e) => open({ kind: "sku", id: s.id, title: s.name, subtitle: s.category }, e)}>
                <KindTile sku={s} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-medium">
                    {s.name}
                    {s.featured && <Star className="size-3.5 fill-amber-400 text-amber-400" />}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {s.category} · {s.type === "bundle" ? "Bundle" : (GRANT_KIND_META[s.grants[0]?.kind as GrantKind]?.label ?? s.type)}
                    {s.creatorUsername ? ` · by @${s.creatorUsername}` : ""}
                  </p>
                </div>
                {s.status === "active" && !s.synced && <StatusPill tone="warn">Not on Stripe</StatusPill>}
                <StatusPill tone={STATUS_TONE[s.status]}>{s.status}</StatusPill>
                <span className="w-24 text-right text-sm tabular-nums">
                  {formatMoney(s.priceCents, s.currency)}
                  {s.interval && <span className="text-xs text-muted-foreground">/{s.interval === "month" ? "mo" : "yr"}</span>}
                </span>
              </ListRow>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// --- Categories --------------------------------------------------------------------------

const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function CategoriesSection() {
  const staff = useStaff();
  const categories = useQuery(api.catalog.adminCategories);
  const upsert = useMutation(api.catalog.adminUpsertCategory);
  const remove = useMutation(api.catalog.adminDeleteCategory);
  const { run, busy } = useRun();
  const [name, setName] = useState("");
  const writable = staff.can("catalog.write");

  type Category = NonNullable<typeof categories>[number];
  const save = (c: Category, patch: Partial<Pick<Category, "name" | "description" | "position" | "active">>) =>
    run(
      c.id,
      () =>
        upsert({
          categoryId: c.id as Id<"skuCategories">,
          slug: c.slug,
          name: patch.name ?? c.name,
          description: patch.description ?? c.description,
          position: patch.position ?? c.position,
          active: patch.active ?? c.active,
        }),
    );

  const move = async (index: number, delta: -1 | 1) => {
    if (!categories) return;
    const a = categories[index];
    const b = categories[index + delta];
    if (!a || !b) return;
    // Swap the two positions. Positions can tie, so give them distinct values.
    await run(a.id, async () => {
      await upsert({ categoryId: a.id as Id<"skuCategories">, slug: a.slug, name: a.name, description: a.description, position: b.position + (delta > 0 ? 0.5 : -0.5), active: a.active });
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Categories" description="How the catalogue is grouped. Hide a category to take it out of the shop without losing it." icon={FolderTree} />

      {writable && (
        <Panel>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const slug = slugify(name);
              if (!slug) return;
              void run(
                "new",
                () => upsert({ slug, name: name.trim(), position: (categories?.length ?? 0) * 10, active: true }),
                "Category added.",
              ).then(() => setName(""));
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New category name" className="max-w-xs" />
            <Button type="submit" disabled={!slugify(name) || busy === "new"}>
              {busy === "new" ? <Loader2 className="animate-spin" /> : <Plus />} Add
            </Button>
          </form>
        </Panel>
      )}

      <Panel flush>
        {categories === undefined ? (
          <Loading />
        ) : categories.length === 0 ? (
          <EmptyState icon={FolderTree} title="No categories yet" />
        ) : (
          <div className="divide-y divide-foreground/10">
            {categories.map((c, i) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex flex-col">
                  <Button size="icon" variant="ghost" className="size-5" disabled={!writable || i === 0} onClick={() => void move(i, -1)} aria-label="Move up">
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" className="size-5" disabled={!writable || i === categories.length - 1} onClick={() => void move(i, 1)} aria-label="Move down">
                    <ArrowDown className="size-3.5" />
                  </Button>
                </div>
                <div className="min-w-0 flex-1">
                  <InlineName value={c.name} disabled={!writable} onSave={(next) => void save(c, { name: next })} />
                  <p className="font-mono text-xs text-muted-foreground">
                    {c.slug} · {c.skuCount} {c.skuCount === 1 ? "item" : "items"}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {c.active ? "Visible" : "Hidden"}
                  <Switch checked={c.active} disabled={!writable} onCheckedChange={(active) => void save(c, { active })} />
                </label>
                {writable && (
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy === c.id || c.skuCount > 0}
                    title={c.skuCount > 0 ? "Move its items first" : "Delete"}
                    onClick={() => void run(c.id, () => remove({ categoryId: c.id as Id<"skuCategories"> }), "Category deleted.")}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function InlineName({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  if (!editing || disabled) {
    return (
      <button type="button" disabled={disabled} onClick={() => { setDraft(value); setEditing(true); }} className="block truncate text-left font-medium hover:underline disabled:no-underline">
        {value}
      </button>
    );
  }
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== value) onSave(draft.trim());
  };
  return (
    <div className="flex items-center gap-1">
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7"
      />
      <Check className="size-4 text-muted-foreground" />
    </div>
  );
}
