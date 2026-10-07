"use client";

import { useMutation, useQuery } from "convex/react";
import { Check, Copy, Loader2, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { inviteUrl } from "@/lib/invites";
import { cn } from "@/lib/utils";

/** A button that says it worked for a moment. */
function CopyButton({ text, label = "Copy" }: { text: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={!text}
      onClick={async () => {
        if (!text) return;
        await navigator.clipboard.writeText(text);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/**
 * The last step, once the community exists: the invite link to copy, friends to
 * invite — each is sent the link in a DM when the flow is finished — and the
 * chance to keep this setup as a template.
 */
export function InviteStep({
  communityId,
  communityName,
  selected,
  onToggle,
}: {
  communityId: Id<"communities">;
  communityName: string;
  selected: Set<Id<"users">>;
  onToggle: (id: Id<"users">) => void;
}) {
  const getOrCreateInviteCode = useMutation(api.communities.getOrCreateInviteCode);
  const saveTemplate = useMutation(api.communityTemplates.createFromCommunity);
  const friends = useQuery(api.friends.listFriends);

  const [code, setCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [templateName, setTemplateName] = useState(`${communityName} template`);
  const [templateCode, setTemplateCode] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateError, setTemplateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getOrCreateInviteCode({ communityId }).then((next) => {
      if (!cancelled) setCode(next);
    });
    return () => {
      cancelled = true;
    };
  }, [communityId, getOrCreateInviteCode]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!friends) return [];
    if (!needle) return friends;
    return friends.filter(
      (friend) =>
        friend.name.toLowerCase().includes(needle) || friend.username.toLowerCase().includes(needle),
    );
  }, [friends, search]);

  const link = code ? inviteUrl(code) : null;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Invite link</h3>
        <div className="flex items-center gap-2">
          <Input readOnly value={link ?? "Generating…"} className="font-mono text-xs" aria-label="Invite link" />
          <CopyButton text={link} />
        </div>
        <p className="text-xs text-muted-foreground">
          Anyone with the link can join. Share it anywhere.
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Invite friends</h3>
          <p className="text-xs text-muted-foreground">
            {selected.size > 0
              ? `${selected.size} will get the link in a message`
              : "Pick friends to send the link to"}
          </p>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search friends"
            className="h-8 pl-8"
          />
        </div>
        <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-lg border border-foreground/10 p-1">
          {friends === undefined ? (
            <p className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> Loading friends…
            </p>
          ) : shown.length === 0 ? (
            <p className="p-3 text-xs text-muted-foreground">
              {friends.length === 0 ? "You haven't added any friends yet." : "No friends match that."}
            </p>
          ) : (
            shown.map((friend) => {
              const checked = selected.has(friend.id);
              return (
                <label
                  key={friend.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-foreground/10",
                    checked && "bg-foreground/10",
                  )}
                >
                  <Checkbox checked={checked} onCheckedChange={() => onToggle(friend.id)} />
                  <Avatar size="sm">
                    <AvatarImage src={friend.imageUrl} alt={friend.name} />
                    <AvatarFallback>{friend.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1 truncate text-sm">{friend.name}</span>
                  <span className="truncate text-xs text-muted-foreground">@{friend.username}</span>
                </label>
              );
            })
          )}
        </div>
      </section>

      <section className="space-y-2 rounded-lg border border-foreground/10 bg-gradient-to-br from-foreground/[0.07] to-transparent p-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h3 className="text-sm font-semibold">Save as a template</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Keep this server&apos;s channels, roles and rules to start another from, or share the
          code with someone so they can start from it too.
        </p>
        {templateCode ? (
          <div className="flex items-center gap-2">
            <code className="rounded-md border border-foreground/15 bg-foreground/5 px-2.5 py-1 font-mono text-sm tracking-widest">
              {templateCode}
            </code>
            <CopyButton text={templateCode} label="Copy code" />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              maxLength={64}
              className="h-8"
              aria-label="Template name"
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!templateName.trim() || savingTemplate}
              onClick={async () => {
                setSavingTemplate(true);
                setTemplateError(null);
                try {
                  setTemplateCode(
                    await saveTemplate({ communityId, name: templateName }),
                  );
                } catch (error) {
                  setTemplateError(
                    error instanceof Error ? error.message : "Couldn't save the template.",
                  );
                } finally {
                  setSavingTemplate(false);
                }
              }}
            >
              {savingTemplate ? <Loader2 className="size-3.5 animate-spin" /> : "Save"}
            </Button>
          </div>
        )}
        {templateError && <p className="text-xs text-destructive">{templateError}</p>}
      </section>
    </div>
  );
}
