"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, MessageSquare, Users, X } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { AddFriendDialog } from "@/components/home/add-friend-dialog";
import { usePreloadedCosmetics } from "@/hooks/use-preloaded-cosmetics";
import { ActivityFeed } from "@/components/home/activity-feed";
import { FriendRow } from "@/components/home/friend-row";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCachedQuery } from "@/hooks/use-cached-query";
import type { RichPresenceActivity } from "@/types/desktop-api";

interface FriendsPanelProps {
  search: string;
  onMessageFriend: (conversationId: Id<"conversations">) => void;
}

function matches(search: string, ...fields: string[]) {
  if (!search.trim()) return true;
  const needle = search.trim().toLowerCase();
  return fields.some((field) => field.toLowerCase().includes(needle));
}

function EmptyState({ message }: { message: string }) {
  return <p className="px-2 py-8 text-center text-sm text-muted-foreground">{message}</p>;
}

export function FriendsPanel({ search, onMessageFriend }: FriendsPanelProps) {
  const friends = useCachedQuery(api.friends.listFriends, {}, "friends.listFriends") ?? [];
  const incoming =
    useCachedQuery(api.friends.listIncomingRequests, {}, "friends.listIncomingRequests") ?? [];
  const outgoing =
    useCachedQuery(api.friends.listOutgoingRequests, {}, "friends.listOutgoingRequests") ?? [];

  // Everyone here has a card one click away — warm what it draws.
  usePreloadedCosmetics(friends);

  const acceptRequest = useMutation(api.friends.acceptFriendRequest);
  const declineRequest = useMutation(api.friends.declineFriendRequest);
  const cancelRequest = useMutation(api.friends.cancelFriendRequest);
  const removeFriend = useMutation(api.friends.removeFriend);
  const getOrCreateDirect = useMutation(api.conversations.getOrCreateDirect);

  const handleMessage = async (friendId: Id<"users">) => {
    const conversationId = await getOrCreateDirect({ friendId });
    onMessageFriend(conversationId);
  };

  const filteredFriends = friends.filter((f) => matches(search, f.name, f.username));
  const onlineFriends = filteredFriends.filter((f) => f.status !== "offline");
  const filteredIncoming = incoming.filter((r) => matches(search, r.user.name, r.user.username));
  const filteredOutgoing = outgoing.filter((r) => matches(search, r.user.name, r.user.username));

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Friends</h1>
        </div>
        <AddFriendDialog />
      </div>

      <Tabs defaultValue="online" className="min-h-0 flex-1">
        <TabsList className="w-full">
          <TabsTrigger value="online">Online</TabsTrigger>
          <TabsTrigger value="pending" className="gap-1.5">
            Pending
            {incoming.length > 0 && (
              <Badge variant="destructive" className="h-4 min-w-4 rounded-full px-1">
                {incoming.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        <TabsContent value="online" className="min-h-0">
          <ScrollArea className="h-full">
            {onlineFriends.length === 0 ? (
              <EmptyState message="No friends online right now." />
            ) : (
              onlineFriends.map((friend) => (
                <FriendRow
                  key={friend.id}
                  name={friend.name}
                  username={friend.username}
                  imageUrl={friend.imageUrl}
                  status={friend.status}
                  customStatus={friend.customStatus}
                  activities={friend.activities as RichPresenceActivity[]}
                  nameplateUrl={friend.nameplateUrl}
                  avatarDecoration={friend.avatarDecoration}
                  isBirthday={friend.isBirthday}
                  borderGradientStart={friend.borderGradientStart}
                  actions={
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => void handleMessage(friend.id)}
                      >
                        <MessageSquare className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void removeFriend({ friendId: friend.id })}
                      >
                        Remove
                      </Button>
                    </>
                  }
                />
              ))
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="pending" className="min-h-0">
          <ScrollArea className="h-full">
            <div className="flex flex-col gap-4">
              <div>
                <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Incoming — {filteredIncoming.length}
                </p>
                {filteredIncoming.length === 0 ? (
                  <EmptyState message="No incoming requests." />
                ) : (
                  filteredIncoming.map((request) => (
                    <FriendRow
                      key={request.requestId}
                      name={request.user.name}
                      username={request.user.username}
                      imageUrl={request.user.imageUrl}
                      subtitle="Incoming friend request"
                      actions={
                        <>
                          <Button
                            variant="secondary"
                            size="icon"
                            className="size-8"
                            onClick={() => void acceptRequest({ requestId: request.requestId })}
                          >
                            <Check className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            onClick={() => void declineRequest({ requestId: request.requestId })}
                          >
                            <X className="size-4" />
                          </Button>
                        </>
                      }
                    />
                  ))
                )}
              </div>

              <div>
                <p className="px-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Outgoing — {filteredOutgoing.length}
                </p>
                {filteredOutgoing.length === 0 ? (
                  <EmptyState message="No outgoing requests." />
                ) : (
                  filteredOutgoing.map((request) => (
                    <FriendRow
                      key={request.requestId}
                      name={request.user.name}
                      username={request.user.username}
                      imageUrl={request.user.imageUrl}
                      subtitle="Outgoing friend request"
                      actions={
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void cancelRequest({ requestId: request.requestId })}
                        >
                          Cancel
                        </Button>
                      }
                    />
                  ))
                )}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="all" className="min-h-0">
          <ScrollArea className="h-full">
            {filteredFriends.length === 0 ? (
              <EmptyState message="No friends yet — add one to get started." />
            ) : (
              filteredFriends.map((friend) => (
                <FriendRow
                  key={friend.id}
                  name={friend.name}
                  username={friend.username}
                  imageUrl={friend.imageUrl}
                  status={friend.status}
                  customStatus={friend.customStatus}
                  activities={friend.activities as RichPresenceActivity[]}
                  nameplateUrl={friend.nameplateUrl}
                  avatarDecoration={friend.avatarDecoration}
                  isBirthday={friend.isBirthday}
                  borderGradientStart={friend.borderGradientStart}
                  actions={
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => void handleMessage(friend.id)}
                      >
                        <MessageSquare className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void removeFriend({ friendId: friend.id })}
                      >
                        Remove
                      </Button>
                    </>
                  }
                />
              ))
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
      </div>

      <ActivityFeed />
    </div>
  );
}
