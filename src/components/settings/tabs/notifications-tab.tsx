"use client";

import { useMutation, useQuery } from "convex/react";
import { BellOff } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { STATUS_LABEL } from "@/lib/presence";

const LEVELS = [
  { value: "all", label: "All messages" },
  { value: "mentions", label: "Only @mentions" },
  { value: "none", label: "Nothing" },
] as const;

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

export function NotificationsTab() {
  const settings = useQuery(api.notificationSettings.get);
  const update = useMutation(api.notificationSettings.update);
  const setCommunityLevel = useMutation(api.notificationSettings.setCommunityLevel);

  if (!settings) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  return (
    <div className="space-y-6">
      {/* Two statuses suppress, and they are different sentences: naming the
          one that is actually on is the difference between an explanation and
          a puzzle. */}
      {settings.suppressedBy && (
        <div className="flex items-start gap-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
          <BellOff className="mt-0.5 size-4 shrink-0 text-amber-500" />
          <div className="text-sm">
            <p className="font-medium text-amber-600 dark:text-amber-400">
              {STATUS_LABEL[settings.suppressedBy]} is on
            </p>
            <p className="text-xs text-muted-foreground">
              Nothing below applies while it is — every notification is suppressed. Change your
              status from the user card to start receiving them again.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>What you're notified about</CardTitle>
          <CardDescription>
            Applies everywhere, on desktop and on mobile.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            id="notify-dms"
            label="Direct messages"
            description="DMs and group conversations."
            checked={settings.dmMessages}
            disabled={!!settings.suppressedBy}
            onChange={(dmMessages) => void update({ dmMessages }).catch(() => {})}
          />
          <ToggleRow
            id="notify-channels"
            label="Channel messages"
            description="Messages in servers that don't mention you. Mentions are controlled per server below."
            checked={settings.channelMessages}
            disabled={!!settings.suppressedBy}
            onChange={(channelMessages) => void update({ channelMessages }).catch(() => {})}
          />
          <ToggleRow
            id="notify-replies"
            label="Replies"
            description="Someone replies to one of your messages. The sender can mute an individual reply."
            checked={settings.replies}
            disabled={!!settings.suppressedBy}
            onChange={(replies) => void update({ replies }).catch(() => {})}
          />
          <ToggleRow
            id="notify-friends"
            label="Friend requests"
            description="New requests and accepted ones."
            checked={settings.friendRequests}
            disabled={!!settings.suppressedBy}
            onChange={(friendRequests) => void update({ friendRequests }).catch(() => {})}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Calls</CardTitle>
          <CardDescription>
            Ringing, and who&apos;s in a call. Do Not Disturb and Busy silence all of these,
            including the incoming-call ringtone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ToggleRow
            id="notify-incoming-calls"
            label="Incoming calls"
            description="Someone rings you in a DM or group."
            checked={settings.incomingCalls}
            disabled={!!settings.suppressedBy}
            onChange={(incomingCalls) => void update({ incomingCalls }).catch(() => {})}
          />
          <ToggleRow
            id="notify-call-activity"
            label="Call activity"
            description="Someone joins a call you're in, or a friend joins a server voice channel you can see."
            checked={settings.callActivity}
            disabled={!!settings.suppressedBy}
            onChange={(callActivity) => void update({ callActivity }).catch(() => {})}
          />
          <ToggleRow
            id="notify-streaming"
            label="Streaming"
            description="Someone starts sharing their screen in a call."
            checked={settings.streamActivity}
            disabled={!!settings.suppressedBy}
            onChange={(streamActivity) => void update({ streamActivity }).catch(() => {})}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Per server</CardTitle>
          <CardDescription>
            How much each server is allowed to notify you. &ldquo;Only @mentions&rdquo; still
            reaches you even with channel messages turned off above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {settings.communities.length === 0 ? (
            <p className="text-sm text-muted-foreground">You&apos;re not in any servers yet.</p>
          ) : (
            settings.communities.map((community) => (
              <div key={community.communityId} className="flex items-center gap-3">
                <Avatar className="size-8 shrink-0 rounded-md">
                  <AvatarImage src={community.imageUrl} alt="" className="rounded-md" />
                  <AvatarFallback className="rounded-md text-[10px]">
                    {community.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm">{community.name}</span>
                <Select
                  value={community.level}
                  disabled={!!settings.suppressedBy}
                  onValueChange={(level) =>
                    void setCommunityLevel({
                      communityId: community.communityId as Id<"communities">,
                      level: level as "all" | "mentions" | "none",
                    }).catch(() => {})
                  }
                >
                  <SelectTrigger className="w-44 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEVELS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
