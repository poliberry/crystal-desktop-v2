"use client";

import { useState } from "react";
import { useConvex, useMutation } from "convex/react";
import { ImagePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import { GRANT_KIND_META, type GrantKind } from "@/components/marketplace/sku-kinds";
import { SkuPreview, type PreviewGrant } from "@/components/marketplace/sku-preview";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CREATION_ACCEPT, uploadCreation } from "@/lib/creation-upload";

type CreationKind = Extract<GrantKind, "avatarDecoration" | "profileSticker" | "profileEffect" | "nameplate" | "communityTheme">;
const KINDS: CreationKind[] = ["avatarDecoration", "profileSticker", "profileEffect", "nameplate", "communityTheme"];

const HINTS: Record<CreationKind, string> = {
  avatarDecoration: "A transparent PNG, GIF or WebP that wraps around an avatar. Square artwork works best.",
  profileSticker: "A transparent PNG, GIF or WebP that is stuck onto a profile card.",
  profileEffect: "A full-card PNG, GIF or WebP that plays over a profile. Make it transparent.",
  nameplate: "A wide image or short WebM/MP4 clip that sits behind a name.",
  communityTheme: "Two colours that become a gradient across a community.",
};

/** The grant's payload as the preview should draw it, before it is submitted —
 * the same shapes the server builds. */
function previewPayload(kind: CreationKind, url: string | null, start: string, end: string): string | undefined {
  if (kind === "communityTheme") return JSON.stringify({ start, end });
  if (!url) return undefined;
  if (kind === "avatarDecoration") return JSON.stringify([{ id: "a", url, anchor: "center", x: 50, y: 0, width: 100 }]);
  if (kind === "profileSticker") return JSON.stringify([{ id: "a", url, anchor: "top", x: 50, y: 50, width: 36 }]);
  return url;
}

export function CreationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const convex = useConvex();
  const submit = useMutation(api.marketplace.submitListing);

  const [kind, setKind] = useState<CreationKind>("avatarDecoration");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("1.99");
  const [free, setFree] = useState(false);
  const [artwork, setArtwork] = useState<string | null>(null);
  const [start, setStart] = useState("#6366f1");
  const [end, setEnd] = useState("#ec4899");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setDescription("");
    setPrice("1.99");
    setFree(false);
    setArtwork(null);
    setError(null);
  };

  // Free is a choice of its own, not a price typed as zero: a free item needs no
  // payout account and nothing is charged or paid out for it.
  const cents = free ? 0 : Math.round(Number(price) * 100);
  const priceOk = cents === 0 || (Number.isInteger(cents) && cents >= 50 && cents <= 50_000);
  const payload = previewPayload(kind, artwork, start, end);
  const grants: PreviewGrant[] = payload ? [{ kind, payload, label: name }] : [];
  const ready = name.trim().length >= 2 && priceOk && (kind === "communityTheme" || !!artwork);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      setArtwork(await uploadCreation(convex, file));
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "") : "The upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await submit({
        kind,
        name,
        description: description || undefined,
        artworkUrl: artwork ?? undefined,
        themeStart: kind === "communityTheme" ? start : undefined,
        themeEnd: kind === "communityTheme" ? end : undefined,
        priceCents: cents,
        currency: "usd",
      });
      toast.success("Submitted. We'll review it soon.");
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "") : "Couldn't submit that.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <div className="grid md:grid-cols-[1fr_1.1fr]">
          <div className="flex min-h-72 flex-col">
            {grants.length > 0 ? (
              <SkuPreview grants={grants} size="lg" className="flex-1" />
            ) : (
              <div className="flex flex-1 items-center justify-center bg-foreground/5 p-6 text-center text-sm text-muted-foreground">
                Upload your artwork to see it on your own profile.
              </div>
            )}
          </div>

          <div className="space-y-4 p-6">
            <DialogHeader>
              <DialogTitle>New creation</DialogTitle>
              <DialogDescription>It goes to staff for review before it appears in the shop.</DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">What is it?</label>
              <Select
                value={kind}
                onValueChange={(v) => {
                  setKind(v as CreationKind);
                  setArtwork(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {GRANT_KIND_META[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{HINTS[kind]}</p>
            </div>

            {kind === "communityTheme" ? (
              <div className="grid grid-cols-2 gap-3">
                {(
                  [
                    ["Start colour", start, setStart],
                    ["End colour", end, setEnd],
                  ] as const
                ).map(([label, value, set]) => (
                  <label key={label} className="space-y-1.5 text-sm font-medium">
                    {label}
                    <input
                      type="color"
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      className="block h-9 w-full cursor-pointer rounded-md border bg-transparent"
                    />
                  </label>
                ))}
              </div>
            ) : (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-foreground/25 p-4 text-sm text-muted-foreground transition-colors hover:bg-foreground/5">
                {uploading ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />}
                {artwork ? "Replace artwork" : "Upload artwork"}
                <input
                  type="file"
                  accept={kind === "nameplate" ? CREATION_ACCEPT : CREATION_ACCEPT.split(",").filter((t) => t.startsWith("image/")).join(",")}
                  className="sr-only"
                  onChange={(e) => {
                    void pick(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            )}

            <Input placeholder="Name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <Textarea
              placeholder="Describe it (optional)"
              value={description}
              maxLength={400}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-16"
            />
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <label htmlFor="creation-free" className="text-sm font-medium">
                    Free
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Anyone can add it at no cost. No payout account needed.
                  </p>
                </div>
                <Switch id="creation-free" checked={free} onCheckedChange={setFree} />
              </div>
              {!free && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Price (USD)</label>
                  <Input
                    type="number"
                    min="0.5"
                    max="500"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    aria-invalid={!priceOk}
                  />
                  <p className={priceOk ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
                    Between $0.50 and $500. You get paid once payouts are set up in Settings → Creator.
                  </p>
                </div>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button disabled={!ready || busy || uploading} onClick={() => void send()}>
                {busy && <Loader2 className="animate-spin" />} Submit for review
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
