"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Plus, Swords, X } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, errorText, SurfaceFrame } from "@/components/community/surfaces/surface-frame";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function timeLeft(ms: number): string {
  const m = Math.max(0, Math.round((ms - Date.now()) / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m left` : `${m}m left`;
}

function PostDialog({
  communityId,
  games,
  open,
  onOpenChange,
}: {
  communityId: Id<"communities">;
  games: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const post = useMutation(api.clans.postLfg);
  const [gameId, setGameId] = useState(games[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [slots, setSlots] = useState(2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setGameId(games[0]?.id ?? "");
      setTitle("");
      setDetails("");
      setSlots(2);
      setError(null);
    }
  }, [open, games]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Looking for group</DialogTitle>
          <DialogDescription>It stays up for three hours, or until you close it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={gameId} onValueChange={setGameId}>
            <SelectTrigger>
              <SelectValue placeholder="Which game?" />
            </SelectTrigger>
            <SelectContent>
              {games.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder="Need two for ranked" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
          <Textarea placeholder="Anything else? (optional)" value={details} maxLength={300} onChange={(e) => setDetails(e.target.value)} className="min-h-16" />
          <div className="flex items-center gap-3">
            <span className="text-sm">People needed</span>
            <Input type="number" min={1} max={9} value={slots} onChange={(e) => setSlots(Math.min(9, Math.max(1, Number(e.target.value) || 1)))} className="w-20" />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            disabled={!title.trim() || !gameId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await post({ communityId, gameId, title, details: details || undefined, slots });
                onOpenChange(false);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LfgView({ communityId, name, topic }: { communityId: Id<"communities">; name: string; topic?: string }) {
  const community = useQuery(api.communities.get, { communityId });
  const posts = useQuery(api.clans.lfg, { communityId });
  const join = useMutation(api.clans.joinLfg);
  const leave = useMutation(api.clans.leaveLfg);
  const close = useMutation(api.clans.closeLfg);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [error, setError] = useState<string | null>(null);

  const games = (community as { clanGames?: { id: string; name: string }[] } | null | undefined)?.clanGames ?? [];
  const shown = (posts ?? []).filter((p) => filter === "all" || p.gameId === filter);

  return (
    <SurfaceFrame
      communityId={communityId}
      icon={Swords}
      name={name}
      topic={topic}
      actions={
        <Button size="sm" onClick={() => setCreating(true)} disabled={games.length === 0}>
          <Plus /> Post
        </Button>
      }
    >
      {games.length > 1 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-4">
          {[{ id: "all", name: "All games" }, ...games].map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setFilter(g.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                filter === g.id ? "border-primary bg-primary/15 text-primary" : "border-foreground/15 hover:border-foreground/30",
              )}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}
      {error && <p className="px-4 pt-3 text-sm text-destructive">{error}</p>}
      {posts === undefined ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState icon={Swords} title="Nobody's looking right now" body="Post what you want to play and who you need." />
      ) : (
        <div className="mx-auto grid max-w-4xl gap-3 p-4">
          {shown.map((p) => {
            const need = Math.max(0, p.slots - p.joined.length);
            const act = async (fn: () => Promise<unknown>) => {
              setError(null);
              try {
                await fn();
              } catch (e) {
                setError(errorText(e));
              }
            };
            return (
              <article key={p.id} className="space-y-3 rounded-xl border border-foreground/10 bg-gradient-to-br from-foreground/[0.05] to-transparent p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-primary">{games.find((g) => g.id === p.gameId)?.name ?? p.gameId}</p>
                    <h3 className="text-sm font-semibold">{p.title}</h3>
                    {p.details && <p className="pt-0.5 text-sm text-muted-foreground">{p.details}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{timeLeft(p.expiresAt)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex -space-x-2">
                    {[p.author, ...p.joined].map((u) => (
                      <Avatar key={u.id} className="size-7 ring-2 ring-background" title={u.name}>
                        <AvatarImage src={u.imageUrl} alt="" />
                        <AvatarFallback className="text-[9px]">{u.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                    ))}
                  </div>
                  <span className="text-xs text-muted-foreground">{p.full ? "Full" : `${need} more needed`}</span>
                  <div className="ml-auto flex gap-1.5">
                    {p.mine ? (
                      <Button size="sm" variant="ghost" onClick={() => void act(() => close({ postId: p.id }))}>
                        <X /> Close
                      </Button>
                    ) : p.iJoined ? (
                      <Button size="sm" variant="secondary" onClick={() => void act(() => leave({ postId: p.id }))}>
                        Leave
                      </Button>
                    ) : (
                      <Button size="sm" disabled={p.full} onClick={() => void act(() => join({ postId: p.id }))}>
                        Join
                      </Button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <PostDialog communityId={communityId} games={games} open={creating} onOpenChange={setCreating} />
    </SurfaceFrame>
  );
}
