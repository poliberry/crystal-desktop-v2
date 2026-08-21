"use client";

import { useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ServerProfileDialog } from "../../community/server-profile-dialog";

export function ServerProfilesTab() {
  const communities = useQuery(api.communities.listMine);
  const [selectedCommunityId, setSelectedCommunityId] = useState<Id<"communities"> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const openDialog = (id: Id<"communities">) => {
    setSelectedCommunityId(id);
    setDialogOpen(true);
  };

  const selectedCommunity =
    selectedCommunityId != null
      ? (communities ?? []).find((c) => c.id === selectedCommunityId)
      : undefined;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Server Profiles</CardTitle>
          <CardDescription>
            Customize your profile for each server you&apos;re in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {communities === undefined ? null : communities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You&apos;re not in any servers yet.
            </p>
          ) : (
            <ul className="divide-y">
              {communities.map((community) => (
                <li
                  key={community.id}
                  className="flex items-center gap-3 py-3 cursor-pointer hover:bg-muted/40 rounded-md px-2 -mx-2 transition-colors"
                  onClick={() => openDialog(community.id)}
                >
                  <Avatar className="size-9 shrink-0">
                    <AvatarImage src={community.imageUrl} alt={community.name} />
                    <AvatarFallback>{community.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1 text-sm font-medium">{community.name}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      openDialog(community.id);
                    }}
                  >
                    Edit
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {selectedCommunityId != null && selectedCommunity != null && (
        <ServerProfileDialog
          communityId={selectedCommunityId}
          communityName={selectedCommunity.name}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
        />
      )}
    </>
  );
}
