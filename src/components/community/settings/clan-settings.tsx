"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { GamesStep } from "@/components/community/create/games-step";
import { SettingsGroup } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import type { ClanGame } from "@/lib/community-kinds";

/** The clan's games. The same picker as when it was made. */
export function ClanSettings({ communityId, canManage }: { communityId: Id<"communities">; canManage: boolean }) {
  const community = useQuery(api.communities.get, { communityId }) as { clanGames?: ClanGame[] } | null | undefined;
  const setGames = useMutation(api.clans.setGames);
  const [games, setLocal] = useState<ClanGame[]>([]);
  const [busy, setBusy] = useState(false);

  const saved = JSON.stringify(community?.clanGames ?? []);
  useEffect(() => setLocal(community?.clanGames ?? []), [saved]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!community) return <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />;
  const dirty = JSON.stringify(games) !== saved;

  return (
    <SettingsGroup title="Games">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Up to five. Removing a game keeps its roster and channels; they come back if you add it again.
        </p>
        <div className={canManage ? "" : "pointer-events-none opacity-60"}>
          <GamesStep games={games} onChange={setLocal} />
        </div>
        {canManage && (
          <Button
            disabled={!dirty || games.length === 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await setGames({ communityId, games });
                toast.success("Games saved.");
              } catch (e) {
                toast.error(e instanceof Error ? e.message.replace(/^.*Error:\s*/, "").split("\n")[0] : "Couldn't save.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy && <Loader2 className="animate-spin" />} Save games
          </Button>
        )}
      </div>
    </SettingsGroup>
  );
}
