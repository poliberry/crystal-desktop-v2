"use client";

import { useMutation, useQuery } from "convex/react";
import { Armchair, Hash, Volume2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChannelGlyph } from "@/components/community/channel-glyph";
import { CHANNEL_SURFACES, SURFACE_META, type ChannelSurface } from "@/lib/community-kinds";
import { cn } from "@/lib/utils";

interface CreateChannelDialogProps {
  communityId: Id<"communities">;
  categoryId?: Id<"channelCategories">;
  defaultType?: "text" | "voice";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateChannelDialog({
  communityId,
  categoryId,
  defaultType = "text",
  open,
  onOpenChange,
}: CreateChannelDialogProps) {
  const create = useMutation(api.channels.create);
  const community = useQuery(api.communities.get, { communityId }) as { kind?: "creator" | "clan" } | null | undefined;
  const [surface, setSurface] = useState<ChannelSurface | null>(null);
  // The special channels this kind of community can have.
  const surfaces = CHANNEL_SURFACES.filter((s) => {
    const kinds = SURFACE_META[s].kinds;
    return community?.kind && (kinds === "any" || kinds.includes(community.kind));
  });
  const [type, setType] = useState<"text" | "voice">(defaultType);
  const [lounge, setLounge] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await create({ communityId, name, type, categoryId, lounge: type === "voice" && lounge, surface: surface ?? undefined });
      onOpenChange(false);
      setName("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>
            {type === "text"
              ? "A place for text conversation."
              : lounge
                ? "A room people walk around in, with a screen for whatever is being shared."
                : "A place people can join to talk with voice/video."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setType("text");
              setLounge(false);
              setSurface(null);
            }}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm",
              type === "text" ? "border-primary bg-primary/10" : "text-muted-foreground"
            )}
          >
            <Hash className="size-4" /> Text
          </button>
          <button
            type="button"
            onClick={() => {
              setType("voice");
              setLounge(false);
              setSurface(null);
            }}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm",
              type === "voice" && !lounge ? "border-primary bg-primary/10" : "text-muted-foreground"
            )}
          >
            <Volume2 className="size-4" /> Voice
          </button>
          <button
            type="button"
            onClick={() => {
              setType("voice");
              setLounge(true);
              setSurface(null);
            }}
            className={cn(
              "flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-sm",
              type === "voice" && lounge ? "border-primary bg-primary/10" : "text-muted-foreground"
            )}
          >
            <Armchair className="size-4" /> Lounge
          </button>
        </div>

        {surfaces.length > 0 && (
          <div className="space-y-1.5">
            <Label>Or a special channel</Label>
            <div className="grid grid-cols-2 gap-2">
              {surfaces.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setType("text");
                    setLounge(false);
                    setSurface(surface === s ? null : s);
                    if (!name.trim()) setName(SURFACE_META[s].label.toLowerCase().replace(/[^a-z0-9]+/g, "-"));
                  }}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm",
                    surface === s ? "border-primary bg-primary/10" : "text-muted-foreground",
                  )}
                >
                  <ChannelGlyph type="text" surface={s} className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="block font-medium text-foreground">{SURFACE_META[s].label}</span>
                    <span className="block text-xs">{SURFACE_META[s].blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="channel-name">Name</Label>
          <Input
            id="channel-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={type === "text" ? "general" : lounge ? "Movie Night" : "General Voice"}
            maxLength={64}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
            }}
          />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button disabled={!name.trim() || creating} onClick={() => void handleCreate()}>
            {creating ? "Creating…" : "Create channel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
