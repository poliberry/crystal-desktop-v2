"use client";

import { useStudioChrome } from "@/studio/shell/chrome";
import { useConvex, useQuery } from "convex/react";
import { AlertTriangle, BadgeCheck, CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Problem } from "@/studio/model/compile";
import type { Listing, Project } from "@/studio/model/types";
import { checkProject, grantKindsOf, publishAsCrystal, submitProject } from "@/studio/submit";
import { listingState, sameKinds } from "../../../convex/lib/listingUpdate";
import { api } from "../../../convex/_generated/api";
import { listAssets } from "@/studio/storage/db";
import { cn } from "@/lib/utils";

/**
 * How a project is to be sold, and sending it.
 *
 * The checks shown are `checkProject`'s, which are the server's own rules run
 * locally, so "ready" here means the server will take it — not that it will
 * approve it: every submission is reviewed by staff before it is in the shop.
 */
export function SubmitPanel({ project, onChange, extraProblems = [] }: { project: Project; onChange: (p: Project) => void; extraProblems?: Problem[] }) {
  const convex = useConvex();
  const chrome = useStudioChrome();
  const [problems, setProblems] = useState<Problem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const listing = project.listing;
  const setListing = (patch: Partial<Listing>) => onChange({ ...project, listing: { ...listing, ...patch } });

  // Re-check as the project changes, without doing it on every keystroke.
  useEffect(() => {
    let alive = true;
    const t = window.setTimeout(async () => {
      const assets = new Map((await listAssets(project.id)).map((a) => [a.id, a]));
      const found = await checkProject(project, assets);
      if (alive) setProblems(found);
    }, 300);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [project]);

  const all = [...problems, ...extraProblems];
  const errors = all.filter((p) => p.severity === "error");
  const warnings = all.filter((p) => p.severity === "warning");

  // --- Is this a new listing, or a change to one that is already on sale? --------------------------------
  const creations = useQuery(api.marketplace.myCreations);
  const [kinds, setKinds] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void grantKindsOf(project).then((k) => alive && setKinds(k));
    return () => {
      alive = false;
    };
  }, [project]);
  /** Which listing to change: "auto" is the one this project was last sent as; "new" ignores them all. */
  const [target, setTarget] = useState<"auto" | "new" | string>("auto");

  const latest = creations?.find((c) => c.id === project.store?.submissionId) ?? null;
  const state = listingState(latest ? { status: latest.status, updatesSkuId: latest.updatesSkuId ?? undefined, skuId: latest.skuId ?? undefined, reviewNote: latest.reviewNote } : null);
  // Listings of the creator's that are on sale and are the same kind of thing as this project: what it could update.
  const candidates = useMemo(() => {
    const seen = new Set<string>();
    const out: { skuId: string; name: string; priceCents: number; sales: number }[] = [];
    for (const c of creations ?? []) {
      if (!c.sku || c.sku.status !== "active" || seen.has(c.sku.id) || !sameKinds(c.kinds, kinds)) continue;
      seen.add(c.sku.id);
      out.push({ skuId: c.sku.id, name: c.name, priceCents: c.priceCents, sales: c.sku.sales });
    }
    return out;
  }, [creations, kinds]);
  const remembered = "skuId" in state ? candidates.find((c) => c.skuId === state.skuId) : undefined;
  const chosen = target === "new" ? undefined : target === "auto" ? remembered : candidates.find((c) => c.skuId === target);
  // Something of this project's still waiting, which a new send replaces rather than queuing behind.
  const waiting = latest && latest.status === "pending" ? latest : null;
  const cents = listing.free ? 0 : Math.round(Number(listing.priceUsd) * 100);

  // --- Staff only: publish as Crystal ---------------------------------------------------------------------------
  // Shown to people who may write the catalogue. The server checks that again on every call; this only decides what to draw.
  const staff = useQuery(api.staff.me, {});
  const isStaff = !!staff?.permissions.includes("catalog.write");
  const categories = useQuery(api.catalog.adminCategories, isStaff ? {} : "skip");
  const crystalListings = useQuery(api.marketplace.staffCrystalListings, isStaff ? {} : "skip");
  const [asCrystal, setAsCrystal] = useState(false);
  const [categoryId, setCategoryId] = useState("");
  const [featured, setFeatured] = useState(false);
  /** Which of Crystal's listings to replace: "new" for a new listing. */
  const [crystalTarget, setCrystalTarget] = useState<string>("new");
  const [published, setPublished] = useState<string | null>(null);
  const crystalCandidates = useMemo(() => (crystalListings ?? []).filter((l) => sameKinds(l.kinds, kinds)), [crystalListings, kinds]);
  // A project already published as Crystal updates that listing by default: publishing again shouldn't make a second one.
  const lastCrystal = project.store?.skuId;
  useEffect(() => {
    if (crystalTarget === "new" && lastCrystal && crystalCandidates.some((l) => l.skuId === lastCrystal)) setCrystalTarget(lastCrystal);
    // Only when the list arrives or the project changes: a person who picks "a new listing" keeps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastCrystal, crystalCandidates.length]);
  const activeCategories = (categories ?? []).filter((c) => c.active);
  const category = categoryId || activeCategories[0]?.id || "";

  const publish = async () => {
    setBusy("Starting…");
    setError(null);
    setPublished(null);
    try {
      const target = crystalTarget === "new" ? undefined : crystalTarget;
      const r = await publishAsCrystal(convex, project, setBusy, { categoryId: category, featured, updatesSkuId: target });
      onChange({ ...project, store: { submissionId: r.skuId, skuId: r.skuId } });
      await chrome.saveSettings?.(project.id).catch(() => undefined);
      setPublished(target ? `Updated “${listing.name}” in the store. Everyone who owns it gets the new version.` : `“${listing.name}” is live in the store as By Crystal, at /${r.slug}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/\[CONVEX [^\]]*\]\s*/g, "").replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That didn't publish.");
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy("Starting…");
    setError(null);
    setDone(false);
    try {
      const id = await submitProject(convex, project, setBusy, { updatesSkuId: chosen?.skuId, supersedes: waiting?.id });
      onChange({ ...project, store: { submissionId: id, ...(chosen ? { skuId: chosen.skuId } : {}) } });
      // The submission is on the server now, so the link to it is saved with the project straight away: if it
      // waited for a later save and the app closed first, the next send would make a second store page.
      await chrome.saveSettings?.(project.id).catch(() => undefined);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/\[CONVEX [^\]]*\]\s*/g, "").replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That didn't send.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">In the store</h3>
        <Input placeholder="Name" value={listing.name} maxLength={60} onChange={(e) => setListing({ name: e.target.value })} />
        <Textarea placeholder="Describe it" value={listing.description} maxLength={400} onChange={(e) => setListing({ description: e.target.value })} className="min-h-20" />
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">Free</p>
            <p className="text-xs text-muted-foreground">Anyone can add it. No payout account needed.</p>
          </div>
          <Switch checked={listing.free} onCheckedChange={(free) => setListing({ free })} />
        </div>
        {!listing.free && (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-sm">USD</span>
              <Input type="number" min="0.5" max="500" step="0.01" value={listing.priceUsd} onChange={(e) => setListing({ priceUsd: e.target.value })} className="w-28" />
            </div>
            <p className="text-xs text-muted-foreground">Between $0.50 and $500. You keep 80% unless agreed otherwise, paid out through Stripe once it's set up in Settings → Creator.</p>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Before you send</h3>
        {all.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-500">
            <CheckCircle2 className="size-4" /> Everything checks out.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {errors.map((p, i) => (
              <li key={`e${i}`} className="flex items-start gap-2 text-sm">
                <XCircle className="mt-0.5 size-4 shrink-0 text-red-400" /> {p.message}
              </li>
            ))}
            {warnings.map((p, i) => (
              <li key={`w${i}`} className="flex items-start gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-400" /> {p.message}
              </li>
            ))}
          </ul>
        )}
        <StoreStatus state={state} note={"note" in state ? state.note : undefined} chosen={chosen} waiting={!!waiting} candidates={candidates} target={target} setTarget={setTarget} cents={cents} />
        {isStaff && (
          <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3">
            <label className="flex items-start justify-between gap-3">
              <span>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <BadgeCheck className="size-4 text-amber-500" /> Publish as Crystal
                </span>
                <span className="block text-xs text-muted-foreground">Staff only. Skips review and goes live straight away, under “By Crystal”. The artwork is still checked like anyone&apos;s; nothing is paid out.</span>
              </span>
              <Switch checked={asCrystal} onCheckedChange={setAsCrystal} aria-label="Publish as Crystal" />
            </label>
            {asCrystal && (
              <div className="space-y-2">
                <label className="block space-y-1 text-xs text-muted-foreground">
                  Category
                  <select aria-label="Category" value={category} onChange={(e) => setCategoryId(e.target.value)} className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground">
                    {activeCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                {crystalCandidates.length > 0 && (
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    Publish as
                    <select aria-label="Which Crystal listing" value={crystalTarget} onChange={(e) => setCrystalTarget(e.target.value)} className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground">
                      <option value="new">A new listing</option>
                      {crystalCandidates.map((l) => (
                        <option key={l.skuId} value={l.skuId}>
                          An update to “{l.name}”
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex items-center justify-between gap-3 text-sm">
                  Feature it in the store
                  <Switch checked={featured} onCheckedChange={setFeatured} aria-label="Feature it in the store" />
                </label>
              </div>
            )}
          </div>
        )}
        {isStaff && asCrystal ? (
          <Button disabled={errors.length > 0 || busy !== null || !category} onClick={() => void publish()}>
            {busy ? <Loader2 className="animate-spin" /> : <BadgeCheck />} {busy ?? (crystalTarget === "new" ? "Publish now as Crystal" : "Update the Crystal listing now")}
          </Button>
        ) : (
          <Button disabled={errors.length > 0 || busy !== null} onClick={() => void send()}>
            {busy ? <Loader2 className="animate-spin" /> : <Send />} {busy ?? (chosen ? (waiting ? "Replace the update waiting for review" : "Send update for review") : waiting ? "Replace what is waiting for review" : "Submit for review")}
          </Button>
        )}
        {published && <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">{published}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {done && (
          <p className={cn("rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm")}>
            {chosen
              ? "Sent. The store page you have now stays exactly as it is while staff review this; when they approve it, that page is updated in place — same address, same sales, and everyone who owns it gets the new version."
              : "Sent. Staff will review it before it appears in the shop — follow it under Submissions in the activity bar. The project stays here, so you can keep working on it; once it is live, submitting again sends an update to the same store page."}
          </p>
        )}
      </div>
    </div>
  );
}

/** Where this project stands in the store, and which listing a send will change. */
function StoreStatus({
  state, note, chosen, waiting, candidates, target, setTarget, cents,
}: {
  state: ReturnType<typeof listingState>;
  note?: string;
  chosen?: { skuId: string; name: string; priceCents: number; sales: number };
  waiting: boolean;
  candidates: { skuId: string; name: string; priceCents: number; sales: number }[];
  target: string;
  setTarget: (t: string) => void;
  cents: number;
}) {
  const money = (c: number) => (c === 0 ? "Free" : `$${(c / 100).toFixed(2)}`);
  const line =
    state.state === "live"
      ? "Live in the store. Changes you make here aren't live until you send an update and staff approve it."
      : state.state === "reviewing-update"
        ? "An update is waiting for review. The store page is unchanged until it is approved."
        : state.state === "reviewing-first"
          ? "Waiting for review. Sending again replaces it."
          : state.state === "turned-down-update"
            ? "The last update was turned down. The store page is unchanged."
            : state.state === "turned-down-first"
              ? "The last submission was turned down."
              : null;
  return (
    <div className="space-y-2 rounded-lg border border-border p-3 text-sm">
      {line && <p className="text-muted-foreground">{line}</p>}
      {note && <p className="rounded-md bg-amber-500/10 p-2 text-xs">Staff said: {note}</p>}
      {candidates.length > 0 && (
        <label className="block space-y-1 text-xs text-muted-foreground">
          Send this as
          <select aria-label="Which listing" value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground">
            <option value="auto">{chosen ? `An update to “${chosen.name}”` : "A new listing"}</option>
            {candidates.filter((c) => c.skuId !== chosen?.skuId).map((c) => (
              <option key={c.skuId} value={c.skuId}>An update to “{c.name}”</option>
            ))}
            {chosen && <option value="new">A new listing instead</option>}
          </select>
        </label>
      )}
      {chosen && (
        <p className="text-xs text-muted-foreground">
          Updates “{chosen.name}”, which has sold {chosen.sales}. It keeps its address and everyone who owns it.{" "}
          {cents !== chosen.priceCents ? `You are asking for a new price: ${money(chosen.priceCents)} → ${money(cents)}. Staff approve it with the update.` : `Price stays ${money(chosen.priceCents)}.`}
        </p>
      )}
      {waiting && !chosen && <p className="text-xs text-muted-foreground">What is waiting is replaced, not queued twice.</p>}
    </div>
  );
}
