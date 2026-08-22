"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Clock, Loader2, MessageSquare, UserPlus } from "lucide-react";
import { useState } from "react";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The single relationship button on a profile card. What it offers depends
 * entirely on where the two users stand:
 *
 *  - strangers get **Add Friend**
 *  - a request you've sent shows **Pending** (click to withdraw it)
 *  - a request they've sent shows **Accept**
 *  - friends get **Message**, which opens (or creates) the DM
 *
 * Renders nothing on your own card, where none of those mean anything.
 */
export function FriendActionButton({
  userId,
  username,
  className,
}: {
  userId: Id<"users">;
  username: string;
  className?: string;
}) {
  const relationship = useQuery(api.friends.relationshipWith, { userId });
  const sendRequest = useMutation(api.friends.sendFriendRequest);
  const acceptRequest = useMutation(api.friends.acceptFriendRequest);
  const cancelRequest = useMutation(api.friends.cancelFriendRequest);
  const getOrCreateDirect = useMutation(api.conversations.getOrCreateDirect);
  const navigation = useNavigation();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      variant: "secondary" as const,
      onClick: openDm,
    },
    outgoing: {
      label: "Pending",
      icon: Clock,
      variant: "outline" as const,
      onClick: () =>
        run(() =>
          cancelRequest({ requestId: relationship.requestId as Id<"friendRequests"> })
        ),
    },
    incoming: {
      label: "Accept",
      icon: Check,
      variant: "default" as const,
      onClick: () =>
        run(() =>
          acceptRequest({ requestId: relationship.requestId as Id<"friendRequests"> })
        ),
    },
    none: {
      label: "Add Friend",
      icon: UserPlus,
      variant: "default" as const,
      onClick: () => run(() => sendRequest({ username })),
    },
  }[relationship.kind];

  const Icon = config.icon;

  return (
    <div className={cn("space-y-1", className)}>
      <Button
        type="button"
        size="sm"
        variant={config.variant}
        disabled={busy}
        onClick={() => void config.onClick()}
        className="w-full"
        title={relationship.kind === "outgoing" ? "Cancel friend request" : config.label}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
        {config.label}
      </Button>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
