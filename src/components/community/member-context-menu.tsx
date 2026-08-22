"use client";

import { useMutation, useQuery } from "convex/react";
import { Ban, Clock, PencilLine, UserMinus } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import { PERMISSIONS, hasPermission } from "@/lib/permissions";

/** Timeout presets, matching the durations moderators actually reach for. */
const TIMEOUT_OPTIONS: { label: string; ms: number }[] = [
  { label: "60 seconds", ms: 60_000 },
  { label: "5 minutes", ms: 5 * 60_000 },
  { label: "10 minutes", ms: 10 * 60_000 },
  { label: "1 hour", ms: 60 * 60_000 },
  { label: "1 day", ms: 24 * 60 * 60_000 },
  { label: "1 week", ms: 7 * 24 * 60 * 60_000 },
];

/**
 * Right-click moderation for a member row: kick, ban, timeout and nickname.
 *
 * Every item is hidden unless the viewer holds the matching permission, and
 * the whole menu collapses to a plain wrapper when they hold none — so an
 * ordinary member gets the browser's own context menu rather than an empty
 * one. The server re-checks each permission and role hierarchy regardless;
 * this is presentation, not enforcement.
 */
export function MemberContextMenu({
  communityId,
  userId,
  name,
  isSelf,
  timeoutUntil,
  children,
}: {
  communityId: Id<"communities">;
  userId: Id<"users">;
  name: string;
  isSelf: boolean;
  timeoutUntil?: number;
  children: React.ReactNode;
}) {
  const myPermissions = useQuery(api.roles.myPermissions, { communityId }) ?? 0;
  const kickMember = useMutation(api.communities.kickMember);
  const banMember = useMutation(api.communities.banMember);
  const timeoutMember = useMutation(api.communities.timeoutMember);
  const setMemberNickname = useMutation(api.communities.setMemberNickname);

  const [nicknameOpen, setNicknameOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [error, setError] = useState<string | null>(null);

  const canKick = hasPermission(myPermissions, PERMISSIONS.KICK_MEMBERS);
  const canBan = hasPermission(myPermissions, PERMISSIONS.BAN_MEMBERS);
  const canTimeout = hasPermission(myPermissions, PERMISSIONS.MODERATE_MEMBERS);
  // You can always rename yourself; renaming someone else is moderation.
  const canNickname = isSelf || hasPermission(myPermissions, PERMISSIONS.MANAGE_NICKNAMES);
  const canModerate = !isSelf && (canKick || canBan || canTimeout);
  const timedOut = !!timeoutUntil && timeoutUntil > Date.now();

  if (!canModerate && !canNickname) return <>{children}</>;

  const run = (action: () => Promise<unknown>) => {
    setError(null);
    void action().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "That didn't work.");
    });
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuLabel className="truncate">{name}</ContextMenuLabel>
          <ContextMenuSeparator />

          {canNickname && (
            <ContextMenuItem
              onClick={() => {
                setNickname("");
                setNicknameOpen(true);
              }}
            >
              <PencilLine />
              Set nickname
            </ContextMenuItem>
          )}

          {canTimeout && !isSelf && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Clock />
                Timeout
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {timedOut && (
                  <>
                    <ContextMenuItem
                      onClick={() => run(() => timeoutMember({ communityId, userId, durationMs: 0 }))}
                    >
                      Remove timeout
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                  </>
                )}
                {TIMEOUT_OPTIONS.map((option) => (
                  <ContextMenuItem
                    key={option.ms}
                    onClick={() =>
                      run(() => timeoutMember({ communityId, userId, durationMs: option.ms }))
                    }
                  >
                    {option.label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}

          {canKick && !isSelf && (
            <ContextMenuItem
              variant="destructive"
              onClick={() => run(() => kickMember({ communityId, userId }))}
            >
              <UserMinus />
              Kick {name}
            </ContextMenuItem>
          )}

          {canBan && !isSelf && (
            <ContextMenuItem
              variant="destructive"
              onClick={() => run(() => banMember({ communityId, userId }))}
            >
              <Ban />
              Ban {name}
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={nicknameOpen} onOpenChange={setNicknameOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Set nickname</DialogTitle>
            <DialogDescription>
              How {isSelf ? "you appear" : `${name} appears`} in this server. Leave it empty to go
              back to their normal name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="nickname">Nickname</Label>
            <Input
              id="nickname"
              value={nickname}
              maxLength={32}
              placeholder={name}
              onChange={(e) => setNickname(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                run(() => setMemberNickname({ communityId, userId, nickname }));
                setNicknameOpen(false);
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNicknameOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                run(() => setMemberNickname({ communityId, userId, nickname }));
                setNicknameOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && (
        <p className="px-2 pt-1 text-[11px] text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
