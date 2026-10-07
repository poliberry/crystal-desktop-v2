"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GAME_CATALOGUE, type ClanGame } from "@/lib/community-kinds";
import { cn } from "@/lib/utils";

const MAX_GAMES = 5;

/** Pick the clan's games — up to five, from a list or typed in. */
export function GamesStep({ games, onChange }: { games: ClanGame[]; onChange: (games: ClanGame[]) => void }) {
  const [custom, setCustom] = useState("");
  const [query, setQuery] = useState("");
  const full = games.length >= MAX_GAMES;

  const has = (id: string) => games.some((g) => g.id === id);
  const toggle = (game: ClanGame) => {
    if (has(game.id)) onChange(games.filter((g) => g.id !== game.id));
    else if (!full) onChange([...games, game]);
  };
  const addCustom = () => {
    const name = custom.trim().slice(0, 40);
    if (!name || full) return;
    const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "game"}`;
    if (!has(id)) onChange([...games, { id, name }]);
    setCustom("");
  };

  const shown = GAME_CATALOGUE.filter((g) => g.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-foreground/10 p-3">
        <div className="flex items-center justify-between pb-2">
          <p className="text-sm font-medium">Your games</p>
          <p className={cn("text-xs tabular-nums", full ? "text-primary" : "text-muted-foreground")}>
            {games.length} / {MAX_GAMES}
          </p>
        </div>
        {games.length === 0 ? (
          <p className="text-sm text-muted-foreground">Choose at least one. Each one gets its own roster and channels.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {games.map((g) => (
              <span key={g.id} className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 py-1 pr-1 pl-3 text-sm text-primary">
                {g.name}
                <button
                  type="button"
                  onClick={() => onChange(games.filter((x) => x.id !== g.id))}
                  className="flex size-5 items-center justify-center rounded-full hover:bg-primary/20"
                  aria-label={`Remove ${g.name}`}
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Input placeholder="Search games" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="flex max-h-56 flex-wrap gap-2 overflow-y-auto">
          {shown.map((g) => {
            const on = has(g.id);
            return (
              <button
                key={g.id}
                type="button"
                disabled={!on && full}
                onClick={() => toggle(g)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-40",
                  on ? "border-primary bg-primary/15 text-primary" : "border-foreground/15 hover:border-foreground/30",
                )}
              >
                {g.name}
              </button>
            );
          })}
          {shown.length === 0 && <p className="text-sm text-muted-foreground">Not in the list? Add it below.</p>}
        </div>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          addCustom();
        }}
      >
        <Input placeholder="Another game…" value={custom} maxLength={40} onChange={(e) => setCustom(e.target.value)} disabled={full} />
        <Button type="submit" variant="secondary" disabled={!custom.trim() || full}>
          <Plus className="size-4" /> Add
        </Button>
      </form>
    </div>
  );
}
