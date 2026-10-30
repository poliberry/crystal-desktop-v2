"use client";

import { useQuery } from "convex/react";
import { Loader2, Table2, TrendingDown, TrendingUp } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SettingsCard, SettingsGroup } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A community's insights: how it is growing and how much it is used, from counters the server
 * keeps per day (convex/lib/communityInsights.ts). Only shown to someone with View Insights; the
 * query refuses anyone else.
 *
 * Colours are the reference data-viz palette's first two categorical slots (blue, orange), swapped
 * for their dark-surface steps under `.dark`. A chart with one series is blue and has no legend,
 * since its title already says what it plots; the two-series chart has a legend and labels the
 * line ends. Every chart has a table view, so no number is reachable only by hovering.
 */

const RANGES = [7, 30, 90] as const;

type Day = { day: number; date: string; joined: number; left: number; messages: number; active: number; voiceMinutes: number };
type Totals = { joined: number; left: number; net: number; messages: number; voiceMinutes: number; peakActive: number; avgActive: number };

const PALETTE =
  "[--series-1:#2a78d6] [--series-2:#eb6834] dark:[--series-1:#3987e5] dark:[--series-2:#d95926]";

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat();
const fmt = (n: number) => (Math.abs(n) >= 10_000 ? compact.format(n) : whole.format(n));
const hours = (minutes: number) => (minutes < 60 ? `${whole.format(minutes)} min` : `${whole.format(Math.round(minutes / 6) / 10)} h`);
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

export function InsightsSettings({ communityId }: { communityId: Id<"communities"> }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const data = useQuery(api.communityInsights.overview, { communityId, days });
  // Held while a new range loads, so the page keeps its shape instead of flashing a spinner.
  const last = useRef(data);
  if (data) last.current = data;
  const shown = data ?? last.current;

  if (!shown) return <Loader2 className="mx-auto my-10 size-5 animate-spin text-muted-foreground" />;
  const { series, totals, previous } = shown;

  return (
    <div className={cn("space-y-6", PALETTE)}>
      <div className="flex items-center gap-1.5" role="group" aria-label="Date range">
        {RANGES.map((r) => (
          <Button key={r} size="sm" variant={r === days ? "default" : "outline"} aria-pressed={r === days} onClick={() => setDays(r)}>
            Last {r} days
          </Button>
        ))}
        <span className="ml-2 text-xs text-muted-foreground">Days are counted in UTC.</span>
      </div>

      <div className={cn("space-y-6 transition-opacity", !data && "opacity-60")}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Stat label="Members joined" value={fmt(totals.joined)} now={totals.joined} before={previous.joined} />
          <Stat label="Members left" value={fmt(totals.left)} now={totals.left} before={previous.left} upIsGood={false} />
          <Stat label="Messages sent" value={fmt(totals.messages)} now={totals.messages} before={previous.messages} />
          <Stat label="Peak active members" value={fmt(totals.peakActive)} now={totals.peakActive} before={previous.peakActive} hint={`${totals.avgActive} a day on average`} />
          <Stat label="Time in voice" value={hours(totals.voiceMinutes)} now={totals.voiceMinutes} before={previous.voiceMinutes} />
        </div>

        <SettingsGroup title="Growth">
          <ChartCard
            title="Members joined and left"
            subtitle={`${totals.net >= 0 ? "+" : ""}${fmt(totals.net)} net over ${days} days`}
            series={series}
            lines={[
              { name: "Joined", pick: (d) => d.joined, slot: 1 },
              { name: "Left", pick: (d) => d.left, slot: 2 },
            ]}
          />
        </SettingsGroup>

        <SettingsGroup title="Activity">
          <ChartCard title="Messages per day" series={series} lines={[{ name: "Messages", pick: (d) => d.messages, slot: 1 }]} />
          <ChartCard
            title="Active members per day"
            subtitle="People who sent at least one message that day"
            series={series}
            lines={[{ name: "Active members", pick: (d) => d.active, slot: 1 }]}
          />
          <ChartCard
            title="Voice time per day"
            subtitle="Total across everyone in a call, to within a few minutes"
            series={series}
            lines={[{ name: "Minutes in voice", pick: (d) => d.voiceMinutes, slot: 1 }]}
            bars
          />
        </SettingsGroup>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  now,
  before,
  upIsGood = true,
  hint,
}: {
  label: string;
  value: string;
  now: number;
  before: number;
  upIsGood?: boolean;
  hint?: string;
}) {
  const change = before === 0 ? (now === 0 ? 0 : null) : Math.round(((now - before) / before) * 100);
  const good = change === null || change === 0 ? null : change > 0 === upIsGood;
  const Icon = change !== null && change < 0 ? TrendingDown : TrendingUp;
  return (
    <SettingsCard className="flex-col items-start gap-1 p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {change === null ? (
          "New this period"
        ) : change === 0 ? (
          "No change"
        ) : (
          <>
            <Icon className={cn("size-3.5", good ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")} aria-hidden />
            <span>
              {change > 0 ? "+" : ""}
              {change}% vs previous
            </span>
          </>
        )}
      </span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </SettingsCard>
  );
}

interface Line {
  name: string;
  pick: (d: Day) => number;
  /** Categorical slot: 1 blue, 2 orange. */
  slot: 1 | 2;
}

const W = 640;
const H = 200;
const PAD = { top: 12, right: 12, bottom: 24, left: 40 };

/** Round a maximum up to a number a person would pick as an axis end. */
function niceMax(max: number): number {
  if (max <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(max));
  const n = max / pow;
  return (n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function ChartCard({
  title,
  subtitle,
  series,
  lines,
  bars = false,
}: {
  title: string;
  subtitle?: string;
  series: Day[];
  lines: Line[];
  bars?: boolean;
}) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const titleId = useId();

  const max = niceMax(Math.max(0, ...series.flatMap((d) => lines.map((l) => l.pick(d)))));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const slot = bars ? innerW / series.length : 0;
  const barX = (i: number) => PAD.left + i * slot;
  const barW = Math.min(24, Math.max(2, slot - 2));

  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(series.length / 6);

  const paths = useMemo(
    () => lines.map((l) => series.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(l.pick(d)).toFixed(1)}`).join(" ")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, lines, max],
  );

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * innerW;
    const i = bars ? Math.floor(px / slot) : Math.round((px / innerW) * (series.length - 1));
    setHover(Math.min(series.length - 1, Math.max(0, i)));
  };

  const color = (l: Line) => `var(--series-${l.slot})`;
  const point = hover === null ? null : series[hover];
  const pointX = hover === null ? 0 : bars ? barX(hover) + slot / 2 : x(hover);

  return (
    <SettingsCard className="flex-col items-stretch gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={titleId} className="text-sm font-semibold">
            {title}
          </h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <Button size="icon-sm" variant={table ? "secondary" : "ghost"} aria-pressed={table} aria-label={table ? "Show chart" : "Show as table"} title={table ? "Show chart" : "Show as table"} onClick={() => setTable((t) => !t)}>
          <Table2 className="size-4" />
        </Button>
      </div>

      {lines.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
          {lines.map((l) => (
            <li key={l.name} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3.5 rounded-full" style={{ background: color(l) }} aria-hidden />
              {l.name}
            </li>
          ))}
        </ul>
      )}

      {table ? (
        <div className="max-h-64 overflow-auto rounded-md border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-card text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 font-medium">Day</th>
                {lines.map((l) => (
                  <th key={l.name} className="px-3 py-1.5 text-right font-medium">
                    {l.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((d) => (
                <tr key={d.day} className="border-t">
                  <td className="px-3 py-1">{shortDate(d.date)}</td>
                  {lines.map((l) => (
                    <td key={l.name} className="px-3 py-1 text-right tabular-nums">
                      {whole.format(l.pick(d))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-labelledby={titleId} onPointerLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} />
                <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-muted-foreground" fontSize={11}>
                  {compact.format(t)}
                </text>
              </g>
            ))}
            {series.map((d, i) =>
              i % labelEvery === 0 ? (
                <text key={d.day} x={bars ? barX(i) + slot / 2 : x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground" fontSize={11}>
                  {shortDate(d.date)}
                </text>
              ) : null,
            )}

            {bars
              ? series.map((d, i) => {
                  const v = lines[0].pick(d);
                  const h = (v / max) * innerH;
                  if (v === 0) return null;
                  const r = Math.min(4, barW / 2, h);
                  const bx = barX(i) + (slot - barW) / 2;
                  const by = y(v);
                  // Rounded at the top (the data end), square on the baseline.
                  return (
                    <path
                      key={d.day}
                      d={`M${bx},${by + h} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + barW - r} Q${bx + barW},${by} ${bx + barW},${by + r} V${by + h} Z`}
                      fill={color(lines[0])}
                      opacity={hover === null || hover === i ? 1 : 0.55}
                    />
                  );
                })
              : lines.map((l, k) => (
                  <g key={l.name}>
                    {lines.length === 1 && (
                      <path d={`${paths[k]} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={color(l)} opacity={0.1} />
                    )}
                    <path d={paths[k]} fill="none" stroke={color(l)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                    {/* End dot with its surface ring, so the line's last value is a mark and not just a stroke ending. */}
                    <circle cx={x(series.length - 1)} cy={y(l.pick(series[series.length - 1]))} r={4} fill={color(l)} className="stroke-card" strokeWidth={2} />
                  </g>
                ))}

            {point && !bars && <line x1={pointX} x2={pointX} y1={PAD.top} y2={PAD.top + innerH} className="stroke-muted-foreground" strokeWidth={1} opacity={0.5} />}
            {point &&
              !bars &&
              lines.map((l) => <circle key={l.name} cx={pointX} cy={y(l.pick(point))} r={4} fill={color(l)} className="stroke-card" strokeWidth={2} />)}

            {/* Wider than the marks: a pointer anywhere over the plot finds the nearest day. */}
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerDown={onMove} />
          </svg>

          {point && (
            <div
              className="pointer-events-none absolute top-1 z-10 min-w-28 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
              style={{ left: `${Math.min(86, Math.max(14, (pointX / W) * 100))}%` }}
            >
              <div className="text-muted-foreground">{shortDate(point.date)}</div>
              {lines.map((l) => (
                <div key={l.name} className="flex items-center gap-1.5">
                  <span className="h-0.5 w-3 rounded-full" style={{ background: color(l) }} aria-hidden />
                  <span className="font-semibold tabular-nums">{whole.format(l.pick(point))}</span>
                  <span className="text-muted-foreground">{l.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
