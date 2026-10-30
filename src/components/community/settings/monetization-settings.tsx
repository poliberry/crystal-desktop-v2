"use client";

import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";

const money = (cents: number, currency: string) => {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
};

/**
 * A creator community's subscribers by tier and what the creator has earned. Shown to someone who
 * holds View Creator Monetization; the query refuses everyone else.
 */
export function MonetizationSettings({ communityId }: { communityId: Id<"communities"> }) {
  const data = useQuery(api.creatorCommunities.monetization, { communityId });
  if (!data) return <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />;

  return (
    <div className="space-y-8">
      <SettingsGroup title="Subscribers">
        <SettingRow title="Subscribers" description="Members checked against the creator's platform and found on a paid tier.">
          <span className="text-lg font-semibold tabular-nums">{data.subscribers}</span>
        </SettingRow>
        {data.tiers.map((t) => (
          <SettingRow key={t.key || "other"} title={t.name}>
            <span className="tabular-nums">{t.count}</span>
          </SettingRow>
        ))}
        <SettingRow title="Members without a tier" description="Verified, but not subscribed.">
          <span className="tabular-nums">{data.untiered}</span>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Earnings">
        {data.earnings.length === 0 ? (
          <SettingRow title="No earnings yet" description="Sales of the creator's items will show up here." />
        ) : (
          data.earnings.map((e) => (
            <SettingRow
              key={e.currency}
              title={e.currency.toUpperCase()}
              description={`${money(e.waiting, e.currency)} waiting to be paid${e.reversed ? ` · ${money(e.reversed, e.currency)} taken back` : ""}`}
            >
              <span className="text-lg font-semibold tabular-nums">{money(e.paid, e.currency)}</span>
            </SettingRow>
          ))
        )}
        {data.earningsTruncated && <p className="px-1 text-xs text-muted-foreground">Only the latest 500 sales are counted.</p>}
      </SettingsGroup>
    </div>
  );
}
