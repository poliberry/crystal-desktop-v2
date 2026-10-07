"use client";

import { useQuery } from "convex/react";
import { Loader2, Server } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";

const LABEL: Record<string, string> = {
  "power.start": "started",
  "power.stop": "stopped",
  "power.restart": "restarted",
  "power.kill": "killed",
  "profile.change": "changed the details of",
  "access.change": "changed who can use",
};

/** Everything done to the community's game servers, and by whom. Connecting the
 * panel and choosing who can use each server happens on the servers channel. */
export function ServersSettings({ communityId }: { communityId: Id<"communities"> }) {
  const overview = useQuery(api.gameServers.overview, { communityId });
  const log = useQuery(api.gameServers.auditLog, { communityId });

  if (!overview || !log) return <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />;
  return (
    <div className="space-y-8">
      <SettingsGroup title="Panel">
        <SettingRow
          icon={Server}
          title={overview.panel.connected ? "Connected" : "Not connected"}
          description={
            overview.panel.connected
              ? `${"baseUrl" in overview.panel ? overview.panel.baseUrl : ""} — ${overview.servers.length} server${overview.servers.length === 1 ? "" : "s"} shown. Manage it on the game servers channel.`
              : "Open the game servers channel to connect a Pterodactyl panel."
          }
        />
      </SettingsGroup>
      <SettingsGroup title="Activity">
        {log.length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          log.map((row) => (
            <SettingRow
              key={row.id}
              title={`${row.who} ${LABEL[row.action] ?? row.action} ${row.server}`}
              description={`${new Date(row.at).toLocaleString()}${row.detail ? ` · ${row.detail}` : ""}`}
            />
          ))
        )}
      </SettingsGroup>
    </div>
  );
}
