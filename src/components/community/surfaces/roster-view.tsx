"use client";

import { useMutation, useQuery } from "convex/react";
import { ClipboardList, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { EmptyState, errorText, SurfaceFrame } from "@/components/community/surfaces/surface-frame";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Entry {
  game: { id: string; name: string };
  mine?: { ign: string; rank?: string; role?: string };
}

function EntryDialog({
  communityId,
  entry,
  onClose,
}: {
  communityId: Id<"communities">;
  entry: Entry | null;
  onClose: () => void;
}) {
  const save = useMutation(api.clans.setRoster);
  const [ign, setIgn] = useState("");
  const [rank, setRank] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seeded, setSeeded] = useState<Entry | null>(null);

  // Start from how the person is already listed, once per time it opens.
  if (entry && entry !== seeded) {
    setSeeded(entry);
    setIgn(entry.mine?.ign ?? "");
    setRank(entry.mine?.rank ?? "");
    setRole(entry.mine?.role ?? "");
    setError(null);
  }
  if (!entry && seeded) setSeeded(null);

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry?.game.name}</DialogTitle>
          <DialogDescription>How the clan should know you in this game.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="In-game name" value={ign} maxLength={40} onChange={(e) => setIgn(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Rank (optional)" value={rank} maxLength={40} onChange={(e) => setRank(e.target.value)} />
            <Input placeholder="Role (optional)" value={role} maxLength={40} onChange={(e) => setRole(e.target.value)} />
          </div>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button
            disabled={!ign.trim() || busy}
            onClick={async () => {
              if (!entry) return;
              setBusy(true);
              try {
                await save({ communityId, gameId: entry.game.id, ign, rank: rank || undefined, role: role || undefined });
                onClose();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Who plays each of the clan's games, and as what. */
export function RosterView({ communityId, name, topic }: { communityId: Id<"communities">; name: string; topic?: string }) {
  const roster = useQuery(api.clans.roster, { communityId });
  const leave = useMutation(api.clans.leaveRoster);
  const [editing, setEditing] = useState<Entry | null>(null);

  return (
    <SurfaceFrame communityId={communityId} icon={ClipboardList} name={name} topic={topic}>
      {roster === undefined ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : roster.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No games" body="This clan hasn't chosen any games." />
      ) : (
        <div className="mx-auto grid max-w-5xl gap-4 p-4 lg:grid-cols-2">
          {roster.map(({ game, players }) => {
            const mine = players.find((p) => p.mine);
            return (
              <section key={game.id} className="rounded-xl border border-foreground/10 bg-gradient-to-br from-foreground/[0.05] to-transparent">
                <header className="flex items-center gap-2 border-b border-foreground/10 px-4 py-3">
                  <h2 className="text-sm font-semibold">{game.name}</h2>
                  <span className="text-xs text-muted-foreground">{players.length}</span>
                  <Button
                    size="sm"
                    variant={mine ? "ghost" : "secondary"}
                    className="ml-auto"
                    onClick={() => setEditing({ game, mine: mine ? { ign: mine.ign, rank: mine.rank, role: mine.role } : undefined })}
                  >
                    {mine ? <Pencil /> : <Plus />} {mine ? "Edit" : "I play this"}
                  </Button>
                </header>
                {players.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nobody yet.</p>
                ) : (
                  <ul className="divide-y divide-foreground/5">
                    {players.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                        <Avatar className="size-8">
                          <AvatarImage src={p.user.imageUrl} alt="" />
                          <AvatarFallback className="text-[10px]">{p.user.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{p.ign}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.user.name}
                            {p.rank && ` · ${p.rank}`}
                            {p.role && ` · ${p.role}`}
                          </p>
                        </div>
                        {p.mine && (
                          <Button size="icon" variant="ghost" className="size-7" onClick={() => void leave({ rosterId: p.id })} aria-label="Take me off">
                            <Trash2 className="size-3.5" />
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      <EntryDialog communityId={communityId} entry={editing} onClose={() => setEditing(null)} />
    </SurfaceFrame>
  );
}
