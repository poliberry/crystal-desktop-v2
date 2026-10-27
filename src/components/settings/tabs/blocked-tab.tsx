"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { describeIgnoreEnd } from "@/components/blocking/block-ignore";
import { SettingRow, SettingsCard, SettingsGroup } from "@/components/settings/settings-ui";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

type Person = { id: Id<"users">; name: string; username: string; imageUrl?: string };

function PersonAvatar({ person }: { person: Person }) {
  return (
    <Avatar className="size-9 shrink-0">
      <AvatarImage src={person.imageUrl} alt="" />
      <AvatarFallback>{person.name.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}

/**
 * Everyone you've ignored or blocked, in one place, with the way to undo it.
 *
 * A menu on someone's profile is the quick way in, but a person you've blocked
 * has gone from where you'd look for them — this is where they can always be
 * found again.
 */
export function BlockedTab() {
  const lists = useQuery(api.blocks.listMine);
  const unblockUser = useMutation(api.blocks.unblockUser);
  const unignoreUser = useMutation(api.blocks.unignoreUser);
  const [busyId, setBusyId] = useState<string | null>(null);

  const undo = async (person: Person, action: () => Promise<unknown>, done: string) => {
    setBusyId(person.id);
    try {
      await action();
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err, "That didn't work."));
    } finally {
      setBusyId(null);
    }
  };

  if (!lists) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const nothing = lists.blocked.length === 0 && lists.ignored.length === 0;

  return (
    <div className="space-y-6">
      {nothing && (
        <SettingsCard className="px-4 py-6 text-center text-sm text-muted-foreground">
          You haven&apos;t ignored or blocked anyone. Right-click someone, or use the ⋯ menu on their
          profile, to do either.
        </SettingsCard>
      )}

      {lists.blocked.length > 0 && (
        <SettingsGroup title={`Blocked — ${lists.blocked.length}`}>
          {lists.blocked.map((person) => (
            <SettingRow
              key={person.id}
              title={person.name}
              description={`@${person.username}`}
            >
              <PersonAvatar person={person} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId === person.id}
                onClick={() =>
                  void undo(person, () => unblockUser({ userId: person.id }), `Unblocked ${person.name}.`)
                }
              >
                {busyId === person.id && <Loader2 className="size-3.5 animate-spin" />}
                Unblock
              </Button>
            </SettingRow>
          ))}
        </SettingsGroup>
      )}

      {lists.ignored.length > 0 && (
        <SettingsGroup title={`Ignored — ${lists.ignored.length}`}>
          {lists.ignored.map((person) => (
            <SettingRow
              key={person.id}
              title={person.name}
              description={`@${person.username} · ${describeIgnoreEnd(person.until)}`}
            >
              <PersonAvatar person={person} />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId === person.id}
                onClick={() =>
                  void undo(
                    person,
                    () => unignoreUser({ userId: person.id }),
                    `You're no longer ignoring ${person.name}.`,
                  )
                }
              >
                {busyId === person.id && <Loader2 className="size-3.5 animate-spin" />}
                Stop ignoring
              </Button>
            </SettingRow>
          ))}
        </SettingsGroup>
      )}

      {!nothing && (
        <p className="px-1 text-xs text-muted-foreground">
          What someone sends while you&apos;re ignoring or blocking them stays hidden, even after you
          stop. They aren&apos;t told either way.
        </p>
      )}
    </div>
  );
}
