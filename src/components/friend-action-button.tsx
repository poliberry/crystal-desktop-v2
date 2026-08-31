"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Clock, Loader2, MessageSquare, UserCheck, UserPlus } from "lucide-react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * The relationship controls on a profile card. What they offer depends
 * entirely on where the two users stand:
 *
 *  - strangers get **Add Friend**
 *  - a request you've sent shows **Pending** (click to withdraw it)
 *  - a request they've sent shows **Accept**
 *  - friends get **Message**, which opens (or creates) the DM, and beside it a
 *    tick that says so — and, behind it, the way to stop being friends
 *
 * Renders nothing on your own card, where none of those mean anything.
 */
export function FriendActionButton({
  userId,
  username,
  hideMessage = false,
  className,
}: {
  userId: Id<"users">;
  username: string;
  /** Drop the **Message** case, for a card shown inside the very DM that
   * button opens. The other three still mean something there, so only that
   * one goes. */
  hideMessage?: boolean;
  className?: string;
}) {
  const relationship = useQuery(api.friends.relationshipWith, { userId });
  const sendRequest = useMutation(api.friends.sendFriendRequest);
  const acceptRequest = useMutation(api.friends.acceptFriendRequest);
  const cancelRequest = useMutation(api.friends.cancelFriendRequest);
  const removeFriend = useMutation(api.friends.removeFriend);
  const getOrCreateDirect = useMutation(api.conversations.getOrCreateDirect);
  const navigation = useNavigation();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  // Undefined while the query is in flight — showing "Add Friend" then
  // flipping it to "Message" a beat later would be worse than a placeholder.
  if (!relationship || relationship.kind === "self") return null;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const openDm = () =>
    run(async () => {
      const conversationId = await getOrCreateDirect({ friendId: userId });
      navigation.openConversation(conversationId as Id<"conversations">);
    });

  const config = {
    friends: {
      label: "Message",
      icon: MessageSquare,
      size: "default" as const,
      className: 'w-fit',
      variant: "outline" as const,
      onClick: openDm,
    },
    outgoing: {
      label: "Pending",
      icon: Clock,
      size: "icon" as const,
      variant: "outline" as const,
      onClick: () =>
        run(() =>
          cancelRequest({
            requestId: relationship.requestId as Id<"friendRequests">,
          }),
        ),
    },
    incoming: {
      label: "Accept",
      icon: Check,
      size: "icon" as const,
      variant: "default" as const,
      onClick: () =>
        run(() =>
          acceptRequest({
            requestId: relationship.requestId as Id<"friendRequests">,
          }),
        ),
    },
    none: {
      label: "Add Friend",
      icon: UserPlus,
      size: "icon" as const,
      variant: "default" as const,
      onClick: () => run(() => sendRequest({ username })),
    },
  }[relationship.kind];

  // After the config, not before: `relationship.kind` is the only thing that
  // says whether this would have been the Message button at all. Only that
  // button goes — being able to unfriend somebody from inside the DM you have
  // with them is not the same question as being able to message them from it.
  const friends = relationship.kind === "friends";
  const showPrimary = !(hideMessage && friends);
  if (!showPrimary && !friends) return null;

  const Icon = config.icon;

  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center gap-1">
        {showPrimary && (
          <Button
            type="button"
            size={config.size}
            variant={config.variant}
            disabled={busy}
            onClick={() => void config.onClick()}
            className={config.className ? config.className : "w-full"}
            title={
              relationship.kind === "outgoing"
                ? "Cancel friend request"
                : config.label
            }
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Icon className="size-4" />
            )}
            {config.label}
          </Button>
        )}

        {/* Unfriending is one click from undoable to gone — there is no
            "undo", only asking them again — so the button opens the question
            rather than doing the thing. */}
        {friends && (
          <Popover open={confirmingRemove} onOpenChange={setConfirmingRemove}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                disabled={busy}
                title={`Friends with @${username}`}
                aria-label={`Friends with @${username}`}
              >
                <UserCheck className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-3">
              <p className="text-sm font-medium">Remove friend?</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You and @{username} will stop being friends. Your conversation
                stays where it is.
              </p>
              <div className="mt-3 flex justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingRemove(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  // Closed either way: `run` swallows the failure into
                  // `error`, which is rendered under the row where a popover
                  // covering it would hide the only explanation.
                  onClick={() =>
                    void run(() => removeFriend({ friendId: userId })).then(() =>
                      setConfirmingRemove(false),
                    )
                  }
                >
                  {busy && <Loader2 className="size-3.5 animate-spin" />}
                  Remove
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
