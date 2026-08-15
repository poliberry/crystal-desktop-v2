"use client";

import { useMutation, useQuery } from "convex/react";
import { Users } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import { useNavigation } from "@/components/home/navigation-context";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

interface InviteEmbedCardProps {
  code: string;
}

export function InviteEmbedCard({ code }: InviteEmbedCardProps) {
  const invite = useQuery(api.communities.resolveInvite, { code });
  const joinByInviteCode = useMutation(api.communities.joinByInviteCode);
  const nav = useNavigation();
  const [joining, setJoining] = useState(false);

  if (invite === undefined) return null;
  if (invite === null) return null;

  const handleJoin = async () => {
    setJoining(true);
    try {
      const communityId = await joinByInviteCode({ code });
      nav.openCommunity(communityId);
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="mt-1 flex max-w-md items-center gap-3 rounded-md border bg-muted/40 p-3">
      <Avatar size="sm">
        <AvatarImage src={invite.imageUrl} alt={invite.name} />
        <AvatarFallback>{invite.name.slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{invite.name}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="size-3" />
          {invite.memberCount} {invite.memberCount === 1 ? "member" : "members"}
        </p>
      </div>
      <Button size="sm" disabled={joining} onClick={() => void handleJoin()}>
        Join
      </Button>
    </div>
  );
}
