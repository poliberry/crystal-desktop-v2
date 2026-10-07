"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { CheckCircle2, ExternalLink, Link2, Loader2, RefreshCw, Rss, Unlink, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CREATOR_PLATFORM_LIST } from "@/lib/community-kinds";

const errorText = (e: unknown, fallback: string) =>
  e instanceof Error ? e.message.replace(/\[CONVEX [^\]]*\]\s*/g, "").replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] || fallback : fallback;

/** A creator community's link to their channel: connect, link, import tiers. */
export function CreatorSettings({ communityId }: { communityId: Id<"communities"> }) {
  const overview = useQuery(api.creatorCommunities.overview, { communityId });
  const accounts = useQuery(api.connectedAccounts.mine);
  const start = useAction(api.connectedAccounts.start);
  const link = useMutation(api.creatorCommunities.linkChannel);
  const unlink = useMutation(api.creatorCommunities.unlinkChannel);
  const syncNow = useMutation(api.creatorCommunities.syncNow);
  const importTiers = useAction(api.creatorCommunities.importTiers);
  const disconnect = useMutation(api.connectedAccounts.disconnect);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorText(e, "That didn't work."));
    } finally {
      setBusy(null);
    }
  };

  if (!overview || !accounts) return <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />;
  const platforms = CREATOR_PLATFORM_LIST.filter((p) => !overview.platform || p.id === overview.platform);

  return (
    <div className="space-y-8">
      <SettingsGroup title="Your channel">
        {platforms.map((p) => {
          const account = accounts.accounts.find((a) => a.provider === p.id);
          const available = accounts.available.includes(p.id);
          const linked = overview.channel?.provider === p.id;
          return (
            <SettingRow
              key={p.id}
              icon={linked ? CheckCircle2 : Link2}
              title={account ? `${p.label} · ${account.displayName}` : p.label}
              description={
                !available
                  ? `${p.label} isn't set up on this deployment yet.`
                  : linked
                    ? "This community is centred on this channel."
                    : account
                      ? account.lastError ?? (p.supportsTiers && !account.canReadMembers ? "Connected, but not allowed to see your members yet." : "Connected.")
                      : `Connect your ${p.label} account to show your streams and match your members.`
              }
            >
              {!available ? null : account ? (
                <>
                  {!linked && (
                    <Button size="sm" disabled={busy === `link-${p.id}`} onClick={() => void run(`link-${p.id}`, () => link({ communityId, accountId: account.id }), "Channel linked.")}>
                      Use this channel
                    </Button>
                  )}
                  {p.supportsTiers && !account.canReadMembers && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void run(`auth-${p.id}`, async () => window.open((await start({ provider: p.id, purpose: "channel" })).url, "_blank", "noopener,noreferrer"))}
                    >
                      Allow member access
                    </Button>
                  )}
                  <Button size="icon" variant="ghost" aria-label={`Disconnect ${p.label}`} onClick={() => void run(`dc-${p.id}`, () => disconnect({ accountId: account.id }))}>
                    <Unlink className="size-4" />
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  disabled={busy === `auth-${p.id}`}
                  onClick={() => void run(`auth-${p.id}`, async () => window.open((await start({ provider: p.id, purpose: "channel" })).url, "_blank", "noopener,noreferrer"))}
                >
                  {busy === `auth-${p.id}` && <Loader2 className="animate-spin" />} Connect
                </Button>
              )}
            </SettingRow>
          );
        })}
      </SettingsGroup>

      {overview.channel && (
        <SettingsGroup title="Newsfeed">
          <SettingRow
            icon={Rss}
            title={overview.channel.name}
            description={
              overview.channel.lastSyncError
                ? `Last update failed: ${overview.channel.lastSyncError}`
                : overview.channel.lastSyncAt
                  ? `Updated ${new Date(overview.channel.lastSyncAt).toLocaleString()}. It refreshes every ten minutes.`
                  : "Updating for the first time…"
            }
          >
            {overview.channel.isLive && <Badge className="bg-red-500/90">Live</Badge>}
            {overview.channel.url && (
              <Button size="icon" variant="ghost" asChild aria-label="Open channel">
                <a href={overview.channel.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            )}
            <Button size="sm" variant="secondary" disabled={busy === "sync"} onClick={() => void run("sync", () => syncNow({ communityId }), "Updating the feed.")}>
              {busy === "sync" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Update now
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void run("unlink", () => unlink({ communityId }))}>
              Unlink
            </Button>
          </SettingRow>
        </SettingsGroup>
      )}

      {overview.channel && platforms.some((p) => p.supportsTiers && p.id === overview.channel?.provider) && (
        <SettingsGroup title="Member tiers">
          <SettingRow
            icon={Users}
            title={overview.tiers.length ? `${overview.tiers.length} tiers imported as roles` : "Import your tiers as roles"}
            description={
              overview.tiers.length
                ? overview.tiers.map((t) => t.name).join(" · ")
                : "Each subscriber tier or channel membership becomes a role. People get it when they verify their membership."
            }
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={busy === "tiers"}
              onClick={() =>
                void run("tiers", async () => {
                  const r = await importTiers({ communityId });
                  toast.success(r.added ? `Added ${r.added} role${r.added === 1 ? "" : "s"}.` : "Already up to date.");
                })
              }
            >
              {busy === "tiers" && <Loader2 className="animate-spin" />} {overview.tiers.length ? "Update" : "Import"}
            </Button>
          </SettingRow>
          <p className="px-1 text-xs text-muted-foreground">
            {overview.audience === "members"
              ? "This community is members-only: people can join once Crystal has confirmed they're a member. Their role follows their tier and is re-checked daily."
              : "This community is public. Members can still verify their tier to get its role."}
          </p>
        </SettingsGroup>
      )}
    </div>
  );
}
