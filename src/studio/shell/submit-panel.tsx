"use client";

import { useConvex } from "convex/react";
import { AlertTriangle, CheckCircle2, Loader2, Send, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { Problem } from "@/studio/model/compile";
import type { Listing, Project } from "@/studio/model/types";
import { checkProject, submitProject } from "@/studio/submit";
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

  const send = async () => {
    setBusy("Starting…");
    setError(null);
    setDone(false);
    try {
      await submitProject(convex, project, setBusy);
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
        <Button disabled={errors.length > 0 || busy !== null} onClick={() => void send()}>
          {busy ? <Loader2 className="animate-spin" /> : <Send />} {busy ?? "Submit for review"}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {done && (
          <p className={cn("rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm")}>
            Sent. Staff will review it before it appears in the shop — you can follow it under My creations in the Marketplace. The project stays here, so you can keep working on it and submit an update.
          </p>
        )}
      </div>
    </div>
  );
}
