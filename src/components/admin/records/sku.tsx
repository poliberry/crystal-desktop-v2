"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Loader2, Package, Plus, RotateCcw, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, Fields, Loading, Panel, StatusPill, useRun, useStaff } from "@/components/admin/admin-ui";
import { useConsole } from "@/components/admin/console-state";
import {
  blankDraft,
  blankGrant,
  draftGrants,
  draftImage,
  grantToDraft,
  priceToCents,
  slugify,
  STREAM_RESOLUTIONS,
  type GrantDraft,
  type SkuDraft,
} from "@/components/admin/records/sku-form";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { SkuPreview } from "@/components/marketplace/sku-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { uploadImage } from "@/lib/cdn-upload";
import { errorMessage } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { NAMEPLATE_ACCEPT } from "@/components/profile/nameplate";

type SkuType = SkuDraft["type"];

const TYPE_LABEL: Record<SkuType, string> = {
  cosmetic: "Cosmetic — one piece of artwork",
  bundle: "Bundle — several pieces together",
  subscription: "Subscription — a plan that renews",
  community: "Community item — for one community",
};

/** What each type may give. Mirrors `validateSku` on the server, which decides. */
const KINDS_FOR: Record<SkuType, GrantKind[]> = {
  cosmetic: ["avatarDecoration", "profileSticker", "profileEffect", "nameplate"],
  bundle: ["avatarDecoration", "profileSticker", "profileEffect", "nameplate"],
  subscription: ["plan"],
  community: ["communityTheme", "communityBoost"],
};

const IMAGE_ACCEPT = "image/png,image/gif,image/webp,image/jpeg";

// --- Artwork ---------------------------------------------------------------------------------

function ArtworkField({ value, onChange, accept }: { value: string; onChange: (url: string) => void; accept: string }) {
  const convex = useConvex();
  const generate = useMutation(api.catalog.adminGenerateUploadUrl);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const isVideo = /\.(webm|mp4)(\?.*)?$/i.test(value);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const uploaded = await uploadImage(convex, file, "marketplace", () => generate({}), file.name);
      // Store artwork has to live at a public address everyone can load; a
      // Convex storage id isn't one.
      if (!uploaded.cdnUrl) throw new Error("The CDN isn't set up, so store artwork can't be uploaded.");
      onChange(uploaded.cdnUrl);
    } catch (e) {
      toast.error(errorMessage(e, "The upload failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-foreground/10 bg-[repeating-conic-gradient(var(--foreground)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px] bg-clip-padding opacity-90 [background-blend-mode:soft-light]">
        {value ? (
          isVideo ? (
            <video src={value} muted loop autoPlay playsInline className="size-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="size-full object-contain" />
          )
        ) : (
          <Upload className="size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <Input value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="https://… or upload" className="h-8 font-mono text-xs" />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="animate-spin" /> : <Upload />} Upload
        </Button>
        <input
          ref={input}
          type="file"
          accept={accept}
          className="sr-only"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// --- One grant -------------------------------------------------------------------------------

function GrantCard({
  grant,
  allowed,
  onChange,
  onRemove,
  removable,
}: {
  grant: GrantDraft;
  allowed: GrantKind[];
  onChange: (next: GrantDraft) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const set = (patch: Partial<GrantDraft>) => onChange({ ...grant, ...patch });
  const meta = GRANT_KIND_META[grant.kind];
  const plan = grant.plan;
  const setPlan = (patch: Partial<GrantDraft["plan"]>) => set({ plan: { ...plan, ...patch } });

  return (
    <div className="space-y-3 rounded-xl border border-foreground/10 bg-foreground/[0.03] p-3">
      <div className="flex items-center gap-2">
        <meta.icon className="size-4 text-muted-foreground" />
        <Select value={grant.kind} onValueChange={(kind) => onChange({ ...blankGrant(kind as GrantKind), key: grant.key, label: grant.label })}>
          <SelectTrigger size="sm" className="w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allowed.map((k) => (
              <SelectItem key={k} value={k}>
                {GRANT_KIND_META[k].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={grant.label} onChange={(e) => set({ label: e.target.value })} placeholder="Label (optional)" className="h-8 flex-1" maxLength={80} />
        {removable && (
          <Button size="icon" variant="ghost" className="size-8" onClick={onRemove} aria-label="Remove">
            <Trash2 className="size-4 text-destructive" />
          </Button>
        )}
      </div>

      {grant.raw !== null ? (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            This one has more than the form can show (several layers, text or shapes). It&apos;s kept exactly as it is — edit the raw
            data if you need to.
          </p>
          <Textarea value={grant.raw} onChange={(e) => set({ raw: e.target.value })} className="min-h-24 font-mono text-xs" />
        </div>
      ) : (
        <>
          {(grant.kind === "avatarDecoration" || grant.kind === "profileSticker") && (
            <>
              <ArtworkField value={grant.artwork} onChange={(artwork) => set({ artwork })} accept={IMAGE_ACCEPT} />
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Size</span>
                  <span className="tabular-nums">{grant.width}%</span>
                </div>
                <Slider
                  min={grant.kind === "avatarDecoration" ? 70 : 15}
                  max={grant.kind === "avatarDecoration" ? 140 : 70}
                  step={1}
                  value={[grant.width]}
                  onValueChange={([width]) => set({ width })}
                />
                <p className="text-xs text-muted-foreground">
                  {grant.kind === "avatarDecoration"
                    ? "Percent of the avatar's width. People can still adjust it in their profile."
                    : "Percent of the card's width. People can move it after they equip it."}
                </p>
              </div>
            </>
          )}

          {(grant.kind === "profileEffect" || grant.kind === "nameplate") && (
            <ArtworkField
              value={grant.artwork}
              onChange={(artwork) => set({ artwork })}
              accept={grant.kind === "nameplate" ? NAMEPLATE_ACCEPT : IMAGE_ACCEPT}
            />
          )}

          {grant.kind === "communityTheme" && (
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["Start colour", "start"],
                  ["End colour", "end"],
                ] as const
              ).map(([label, field]) => (
                <label key={field} className="space-y-1.5 text-xs text-muted-foreground">
                  {label}
                  <div className="flex items-center gap-2">
                    <input type="color" value={grant[field]} onChange={(e) => set({ [field]: e.target.value })} className="h-8 w-12 cursor-pointer rounded border bg-transparent" />
                    <span className="font-mono">{grant[field]}</span>
                  </div>
                </label>
              ))}
            </div>
          )}

          {grant.kind === "plan" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs text-muted-foreground">
                Plan key
                <Input value={plan.plan} onChange={(e) => setPlan({ plan: slugify(e.target.value) })} placeholder="e.g. crystal-geode" className="h-8" />
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                Cosmetic discount (%)
                <Input type="number" min={0} max={50} value={plan.discountPercent} onChange={(e) => setPlan({ discountPercent: Math.min(50, Math.max(0, Number(e.target.value))) })} className="h-8" />
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                Streaming quality
                <Select value={plan.streamResolution} onValueChange={(streamResolution) => setPlan({ streamResolution })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STREAM_RESOLUTIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="space-y-1.5 text-xs text-muted-foreground">
                Frame rate
                <Select value={String(plan.streamFrameRate)} onValueChange={(v) => setPlan({ streamFrameRate: Number(v) })}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[30, 60].map((f) => (
                      <SelectItem key={f} value={String(f)}>
                        {f} fps
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              {(
                [
                  ["profileEffects", "Premium profile effects"],
                  ["earlyAccess", "Early access to new drops"],
                  ["monthlyBadge", "Rotating monthly badge"],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex items-center justify-between gap-2 text-sm">
                  {label}
                  <Switch checked={plan[field]} onCheckedChange={(checked) => setPlan({ [field]: checked })} />
                </label>
              ))}
            </div>
          )}

          {grant.kind === "communityBoost" && (
            <p className="text-xs text-muted-foreground">A boost has nothing to configure — owning it is what gives the community its perks.</p>
          )}
        </>
      )}
    </div>
  );
}

// --- The record ---------------------------------------------------------------------------------

export function SkuRecord({ id }: { id: string }) {
  const staff = useStaff();
  const { retitle, open, closeSession } = useConsole();
  const isNew = id.startsWith("new:");
  const sku = useQuery(api.catalog.adminGetSku, isNew ? "skip" : { skuId: id as Id<"skus"> });
  const categories = useQuery(api.catalog.adminCategories);
  const upsert = useMutation(api.catalog.adminUpsertSku);
  const { run, busy } = useRun();

  const source = useMemo<SkuDraft | null>(() => {
    if (isNew) return blankDraft();
    if (!sku) return null;
    return {
      name: sku.name,
      slug: sku.slug,
      slugTouched: true,
      description: sku.description ?? "",
      categoryId: sku.categoryId,
      type: sku.type,
      price: (sku.priceCents / 100).toFixed(2),
      currency: sku.currency,
      interval: sku.interval ?? "month",
      status: sku.status,
      featured: sku.featured,
      grants: sku.grants.map(grantToDraft),
    };
  }, [isNew, sku]);

  const [draft, setDraft] = useState<SkuDraft | null>(null);
  const [baseline, setBaseline] = useState("");

  // Take the stored version in when it arrives, and again if it changes while
  // nothing here has been touched.
  useEffect(() => {
    if (!source) return;
    const next = JSON.stringify(source);
    setDraft((current) => {
      if (current === null || JSON.stringify(current) === baseline) {
        setBaseline(next);
        return source;
      }
      return current;
    });
    // `baseline` is deliberately not a dependency: it is what the comparison is against.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // A new item starts in the first category there is.
  useEffect(() => {
    if (isNew && draft && !draft.categoryId && categories?.[0]) {
      const next = { ...draft, categoryId: categories[0].id };
      setDraft(next);
      setBaseline(JSON.stringify(next));
    }
  }, [isNew, draft, categories]);

  useEffect(() => {
    if (draft) retitle({ kind: "sku", id }, draft.name || "New item", isNew ? "Draft" : (categories?.find((c) => c.id === draft.categoryId)?.name ?? undefined));
  }, [draft?.name, draft?.categoryId, id, isNew, categories, retitle, draft]);

  if (!isNew && sku === undefined) return <Loading />;
  if (!isNew && sku === null) return <EmptyState icon={Package} title="That item no longer exists" />;
  if (!draft) return <Loading />;

  const dirty = JSON.stringify(draft) !== baseline;
  const canWrite = staff.can("catalog.write");
  const canPrice = staff.can("pricing.write");
  const set = (patch: Partial<SkuDraft>) => setDraft({ ...draft, ...patch });
  const cents = priceToCents(draft.price);
  const grants = draftGrants(draft);
  const allowed = KINDS_FOR[draft.type];
  const multiple = draft.type === "bundle";

  const changeType = (type: SkuType) => {
    const fits = draft.grants.every((g) => KINDS_FOR[type].includes(g.kind));
    set({
      type,
      grants: fits ? (type === "bundle" ? draft.grants : draft.grants.slice(0, 1)) : [blankGrant(KINDS_FOR[type][0])],
      ...(type === "subscription" ? {} : {}),
    });
  };

  const save = async () => {
    const result = await run(
      "save",
      () =>
        upsert({
          skuId: isNew ? undefined : (id as Id<"skus">),
          slug: draft.slug,
          name: draft.name,
          description: draft.description || undefined,
          categoryId: draft.categoryId as Id<"skuCategories">,
          type: draft.type,
          priceCents: cents,
          currency: draft.currency,
          interval: draft.type === "subscription" ? draft.interval : undefined,
          grants,
          imageUrl: draftImage(draft) ?? sku?.imageUrl,
          status: draft.status,
          featured: draft.featured,
          position: sku?.position ?? Date.now(),
        }),
      "Saved.",
    );
    if (!result) return;
    if (isNew) {
      // The draft has become a real item with a real address: open that, and
      // let the draft's session go.
      open({ kind: "sku", id: result, title: draft.name, subtitle: "Item" }, "session");
      closeSession(`sku:${id}`);
    } else {
      setBaseline(JSON.stringify(draft));
    }
  };

  const problem =
    draft.name.trim().length < 2
      ? "Give it a name."
      : !draft.slug
        ? "It needs a slug."
        : !draft.categoryId
          ? "Choose a category."
          : draft.grants.some((g) => g.raw === null && ["avatarDecoration", "profileSticker", "profileEffect", "nameplate"].includes(g.kind) && !g.artwork)
            ? "Add the artwork."
            : !Number.isFinite(cents) || cents < 0
              ? "Enter a valid price."
              : null;

  return (
    <div className="space-y-5 pb-20">
      <header className="flex flex-wrap items-center gap-3">
        <Package className="size-6 text-fuchsia-400" />
        <h1 className="text-2xl font-semibold tracking-tight">{draft.name || "New item"}</h1>
        {!isNew && <StatusPill tone={draft.status === "active" ? "good" : draft.status === "draft" ? "warn" : "neutral"}>{draft.status}</StatusPill>}
        {sku?.creator && <StatusPill tone="info">by @{sku.creator.username}</StatusPill>}
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-5">
          <Panel title="Basics">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-sm font-medium">
                  Name
                  <Input
                    value={draft.name}
                    disabled={!canWrite}
                    maxLength={80}
                    onChange={(e) => set({ name: e.target.value, ...(draft.slugTouched || !isNew ? {} : { slug: slugify(e.target.value) }) })}
                  />
                </label>
                <label className="space-y-1.5 text-sm font-medium">
                  Slug
                  <Input value={draft.slug} disabled={!canWrite} onChange={(e) => set({ slug: slugify(e.target.value), slugTouched: true })} className="font-mono" />
                </label>
              </div>
              <label className="block space-y-1.5 text-sm font-medium">
                Description
                <Textarea value={draft.description} disabled={!canWrite} maxLength={600} onChange={(e) => set({ description: e.target.value })} className="min-h-20" />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Category</label>
                  <Select value={draft.categoryId} disabled={!canWrite} onValueChange={(categoryId) => set({ categoryId })}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a category" />
                    </SelectTrigger>
                    <SelectContent>
                      {(categories ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Type</label>
                  <Select value={draft.type} disabled={!canWrite || !isNew} onValueChange={(t) => changeType(t as SkuType)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TYPE_LABEL) as SkuType[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPE_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!isNew && <p className="text-xs text-muted-foreground">An item&apos;s type can&apos;t change once it exists.</p>}
                </div>
              </div>
            </div>
          </Panel>

          <Panel title="What it gives" description="Each of these is put in the buyer's collection when they pay.">
            <div className="space-y-3">
              {draft.grants.map((g, i) => (
                <GrantCard
                  key={g.key}
                  grant={g}
                  allowed={allowed}
                  removable={multiple && draft.grants.length > 1}
                  onChange={(next) => set({ grants: draft.grants.map((x, j) => (j === i ? next : x)) })}
                  onRemove={() => set({ grants: draft.grants.filter((_, j) => j !== i) })}
                />
              ))}
              {multiple && draft.grants.length < 12 && canWrite && (
                <Button variant="outline" size="sm" onClick={() => set({ grants: [...draft.grants, blankGrant(allowed[0])] })}>
                  <Plus /> Add another piece
                </Button>
              )}
            </div>
          </Panel>

          <Panel title="Price and visibility">
            <div className="space-y-3">
              {!canPrice && <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-500">Setting prices needs the pricing permission. You can edit everything else.</p>}
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="space-y-1.5 text-sm font-medium">
                  Price
                  <Input type="number" min="0" step="0.01" value={draft.price} disabled={!canPrice} onChange={(e) => set({ price: e.target.value })} />
                </label>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Currency</label>
                  <Select value={draft.currency} disabled={!canPrice} onValueChange={(currency) => set({ currency })}>
                    <SelectTrigger className="w-full uppercase">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["usd", "aud", "eur", "gbp"].map((c) => (
                        <SelectItem key={c} value={c} className="uppercase">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {draft.type === "subscription" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">Billed</label>
                    <Select value={draft.interval} disabled={!canPrice} onValueChange={(interval) => set({ interval: interval as "month" | "year" })}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="month">Monthly</SelectItem>
                        <SelectItem value="year">Yearly</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {cents > 0 && cents < 50 && <p className="text-xs text-destructive">Paid items start at 0.50 — the least Stripe will take.</p>}

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Visibility</label>
                  <Select value={draft.status} disabled={!canWrite} onValueChange={(status) => set({ status: status as SkuDraft["status"] })}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Draft — hidden</SelectItem>
                      <SelectItem value="active" disabled={!canPrice}>
                        On sale
                      </SelectItem>
                      <SelectItem value="archived">Archived — hidden, owners keep it</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center justify-between gap-2 self-end rounded-lg border border-foreground/10 px-3 py-2 text-sm">
                  <span>
                    Featured
                    <span className="block text-xs text-muted-foreground">Shown in the shop&apos;s banner</span>
                  </span>
                  <Switch checked={draft.featured} disabled={!canWrite} onCheckedChange={(featured) => set({ featured })} />
                </label>
              </div>
            </div>
          </Panel>
        </div>

        <aside className="space-y-5 xl:sticky xl:top-0 xl:self-start">
          <Panel title="Preview" description="On your own avatar and profile, as a buyer would see it." flush>
            {grants.some((g) => g.payload) ? (
              <SkuPreview grants={grants} size="lg" className="min-h-64" />
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Add some artwork to see it here.</p>
            )}
            <div className="space-y-0.5 border-t border-foreground/10 p-4">
              <p className="font-semibold">{draft.name || "Untitled"}</p>
              <p className="text-sm text-muted-foreground">
                {cents === 0 ? "Free" : formatMoney(cents, draft.currency)}
                {draft.type === "subscription" && cents > 0 ? ` / ${draft.interval}` : ""}
              </p>
            </div>
          </Panel>

          {!isNew && sku && (
            <Panel title="Sales and Stripe">
              <Fields
                items={[
                  ["Sold", sku.sold],
                  ["Product", sku.stripeProductId ? <code key="p" className="text-xs">{sku.stripeProductId}</code> : "—"],
                  ["Price", sku.stripePriceId ? <code key="r" className="text-xs">{sku.stripePriceId}</code> : sku.priceCents === 0 ? "Free — none needed" : "Not published yet"],
                  ...(sku.creator ? ([["Creator keeps", `${sku.creator.shareBps / 100}%`]] as [string, React.ReactNode][]) : []),
                ]}
              />
              {sku.status === "active" && sku.priceCents > 0 && !sku.stripePriceId && (
                <p className="mt-3 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-500">
                  Not on Stripe yet. It publishes on its own when payments are configured and the item is saved.
                </p>
              )}
            </Panel>
          )}
        </aside>
      </div>

      {canWrite && (
        <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background/90 px-4 py-3 shadow-lg backdrop-blur-xl">
          <p className="text-sm text-muted-foreground">{problem ?? (dirty ? "You have unsaved changes." : "Everything is saved.")}</p>
          <div className="flex gap-2">
            {dirty && !isNew && (
              <Button variant="ghost" onClick={() => source && setDraft(source)}>
                <RotateCcw /> Discard
              </Button>
            )}
            <Button disabled={!dirty || !!problem || busy === "save"} onClick={() => void save()}>
              {busy === "save" ? <Loader2 className="animate-spin" /> : <Save />} {isNew ? "Create item" : "Save changes"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
