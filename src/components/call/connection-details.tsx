"use client";

import { Radio } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  STATS_HISTORY,
  useCallStats,
  type CallStatsSample,
  type ConnectionGrade,
} from "@/hooks/use-call-stats";
import { cn } from "@/lib/utils";
import type { Room } from "livekit-client";

/**
 * How the call is going, in one glyph and one panel behind it.
 *
 * The glyph was a green icon that was green whatever was happening — decoration
 * where the one live fact about a call belongs. It is a button now, coloured by
 * the connection, and what is behind it is the evidence: where the call is
 * hosted, the round trip time, the packet loss, and a graph of both so a hiccup
 * ten seconds ago is still visible.
 *
 * Status colours, which are reserved for exactly this — good, warning, bad —
 * and never carried alone: every one of them appears beside a number or a word
 * that says the same thing.
 */

/** The three states, and the one before the first sample lands. Deliberately
 * the app's status ramp rather than the chart palette: this is a state, not a
 * series. */
const GRADE = {
  good: {
    label: "Voice Connected",
    tone: "text-emerald-500",
    stroke: "#10b981",
    hint: "Everything is running normally.",
  },
  fair: {
    label: "Voice Connected",
    tone: "text-amber-500",
    stroke: "#f59e0b",
    hint: "Audio may be delayed. You are still audible.",
  },
  poor: {
    label: "Poor Connection",
    tone: "text-red-500",
    stroke: "#ef4444",
    hint: "Audio may break up or arrive late. If this persists, disconnect and try again.",
  },
  unknown: {
    label: "Voice Connected",
    tone: "text-muted-foreground",
    stroke: "#71717a",
    hint: "Measuring…",
  },
} as const satisfies Record<ConnectionGrade, unknown>;

export function ConnectionDetails({
  room,
  /** The call this is about — no call, no measuring. */
  active,
  /** Which channel or conversation, under the status line. */
  title,
  onExpand,
}: {
  room: Room;
  active: boolean;
  title: string;
  onExpand: () => void;
}) {
  const stats = useCallStats(room, active);
  const grade = GRADE[stats.grade];

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Connection details"
            title="Connection details"
            className={cn(
              // Outlined, because it is a control now and has to look like
              // one. The border takes the status colour at a tenth of its
              // strength, which reads as a tint rather than as a second glyph.
              "flex size-7 shrink-0 items-center justify-center rounded-md border border-current/25 transition-colors hover:bg-current/10",
              grade.tone,
            )}
          >
            <Radio className="size-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-72 p-3">
          <ConnectionPanel stats={stats} />
        </PopoverContent>
      </Popover>

      <button
        type="button"
        onClick={onExpand}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-xs font-semibold", grade.tone)}>{grade.label}</p>
          <p className="truncate text-xs text-muted-foreground">{title}</p>
        </div>
      </button>
    </div>
  );
}

function ConnectionPanel({ stats }: { stats: ReturnType<typeof useCallStats> }) {
  const grade = GRADE[stats.grade];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-2">
        <p className="text-sm font-semibold">Connection</p>
        <span className={cn("text-xs font-medium", grade.tone)}>
          {stats.grade === "unknown" ? "—" : GRADE_WORD[stats.grade]}
        </span>
      </div>

      <PingGraph samples={stats.samples} stroke={grade.stroke} />

      {stats.server && (
        <p className="truncate font-mono text-xs text-muted-foreground" title={stats.server}>
          {stats.server}
        </p>
      )}

      <dl className="space-y-1 text-xs">
        <Row label="Ping" value={stats.pingMs === null ? "—" : `${stats.pingMs} ms`} />
        <Row
          label="Packet loss (outbound)"
          value={stats.lossRate === null ? "—" : `${(stats.lossRate * 100).toFixed(1)}%`}
        />
      </dl>

      <p className="text-[11px] leading-snug text-muted-foreground">{grade.hint}</p>
    </div>
  );
}

const GRADE_WORD: Record<ConnectionGrade, string> = {
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  unknown: "—",
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

const GRAPH = { width: 264, height: 56, padding: 4 };

/** Below this the axis is flat and the line sits in the middle rather than
 * jittering across the full height over a two-millisecond spread. */
const MIN_SCALE_MS = 100;

/**
 * Round trip time over the last two minutes, with the moments that lost
 * packets marked.
 *
 * One series, so no legend — the label above it names it — and no axis: the
 * numbers underneath are the reading, and this is here to show *shape*, which
 * is the one thing a number can't. Loss is marked rather than plotted as a
 * second line, because two scales on one frame is the mistake that makes a
 * chart lie, and what matters about loss at this size is when it happened.
 */
function PingGraph({ samples, stroke }: { samples: CallStatsSample[]; stroke: string }) {
  const points = samples.filter((sample) => sample.pingMs !== null);
  const { width, height, padding } = GRAPH;
  const usable = height - padding * 2;
  const top = Math.max(MIN_SCALE_MS, ...points.map((point) => point.pingMs ?? 0));

  // Always the full window wide, so the line grows in from the left as the
  // call goes on rather than restretching every second.
  const x = (index: number) =>
    padding + (index / Math.max(1, STATS_HISTORY - 1)) * (width - padding * 2);
  const y = (ping: number) => padding + usable - (Math.min(ping, top) / top) * usable;

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)},${y(point.pingMs!).toFixed(1)}`)
    .join(" ");

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full rounded-md bg-muted/40"
        role="img"
        aria-label={
          points.length === 0
            ? "Waiting for the first measurement"
            : `Round trip time over the last ${points.length} seconds, peaking at ${Math.round(top)} milliseconds`
        }
      >
        {/* One recessive rule, at the top of the scale — enough to say the
            line has a ceiling without drawing a grid nobody reads. */}
        <line
          x1={padding}
          x2={width - padding}
          y1={padding}
          y2={padding}
          className="stroke-border"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
        {line && (
          <path
            d={line}
            fill="none"
            stroke={stroke}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {points.map((point, index) =>
          point.lossRate && point.lossRate > 0 ? (
            // Marked on the baseline rather than on the line: loss is an event
            // in time, and putting it under the reading it belongs to says
            // "here" without implying it shares the vertical scale.
            <circle
              key={point.at}
              cx={x(index)}
              cy={height - padding}
              r={2.5}
              className="fill-red-500"
            >
              <title>{`${(point.lossRate * 100).toFixed(1)}% lost`}</title>
            </circle>
          ) : null,
        )}
      </svg>
      <figcaption className="sr-only">
        Round trip time, one reading a second. Red marks are seconds that lost packets.
      </figcaption>
    </figure>
  );
}

