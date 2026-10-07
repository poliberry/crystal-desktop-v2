"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Status } from "@/extensions/host";
import type { Tone, UiNode } from "@/extensions/ui-schema";
import { cn } from "@/lib/utils";

const TONE: Record<Tone, string> = {
  neutral: "bg-foreground/10 text-foreground",
  good: "bg-emerald-500/15 text-emerald-500",
  warn: "bg-amber-500/15 text-amber-500",
  bad: "bg-red-500/15 text-red-400",
  info: "bg-sky-500/15 text-sky-400",
};
const TEXT_TONE: Record<Tone, string> = { neutral: "", good: "text-emerald-500", warn: "text-amber-500", bad: "text-red-400", info: "text-sky-400" };
const GAP = ["gap-0", "gap-1", "gap-2", "gap-3", "gap-4", "gap-6", "gap-8"];

type Values = Record<string, string | boolean>;

/** The initial values of every control in a tree, by name, so a button can report them all. */
function collect(node: UiNode, into: Values) {
  switch (node.type) {
    case "input":
    case "select":
      into[node.name] = node.value;
      break;
    case "toggle":
      into[node.name] = node.checked;
      break;
    case "stack":
    case "card":
      node.children.forEach((c) => collect(c, into));
      break;
  }
}

/**
 * Draws a sanitised tree with Crystal's own components.
 *
 * Controls keep their own state while the extension thinks; what the extension learns
 * is the *action* that happened and, for a button, the current value of every control.
 * Text is always rendered as text — there is no path from a string an extension sent to
 * markup — and an image can only come from a site it was allowed to talk to.
 */
function Node({ node, values, set, act }: { node: UiNode; values: Values; set: (name: string, v: string | boolean) => void; act: (action: string, value?: unknown) => void }) {
  switch (node.type) {
    case "stack":
      return (
        <div
          className={cn("flex", node.direction === "row" ? "flex-row flex-wrap" : "flex-col", GAP[node.gap] ?? "gap-2", node.align === "center" && "items-center", node.align === "start" && "items-start", node.align === "end" && "items-end")}
        >
          {node.children.map((c, i) => (
            <Node key={i} node={c} values={values} set={set} act={act} />
          ))}
        </div>
      );
    case "card":
      return (
        <div className="space-y-2 rounded-xl border border-border bg-card/50 p-3">
          {node.title && <p className="text-sm font-semibold">{node.title}</p>}
          {node.children.map((c, i) => (
            <Node key={i} node={c} values={values} set={set} act={act} />
          ))}
        </div>
      );
    case "divider":
      return <hr className="border-border" />;
    case "text":
      return (
        <p
          className={cn(
            "break-words whitespace-pre-wrap",
            node.variant === "muted" && "text-sm text-muted-foreground",
            node.variant === "title" && "text-xl font-semibold tracking-tight",
            node.variant === "heading" && "text-sm font-semibold",
            node.variant === "mono" && "font-mono text-xs",
            node.variant === "body" && "text-sm",
            node.tone && TEXT_TONE[node.tone],
          )}
        >
          {node.text}
        </p>
      );
    case "badge":
      return (
        <Badge variant="secondary" className={cn("w-fit", TONE[node.tone])}>
          {node.text}
        </Badge>
      );
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={node.src} alt={node.alt} referrerPolicy="no-referrer" draggable={false} className={cn("rounded-lg object-cover", node.size === "sm" ? "size-10" : node.size === "md" ? "size-20" : "size-40")} />
      );
    case "progress":
      return (
        <div className="space-y-1">
          {node.label && <p className="text-xs text-muted-foreground">{node.label}</p>}
          <div className="h-2 overflow-hidden rounded-full bg-foreground/10">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${node.value}%` }} />
          </div>
        </div>
      );
    case "list":
      return (
        <ul className="divide-y divide-border/60 rounded-lg border border-border">
          {node.items.map((it) => {
            const row = (
              <>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{it.title}</span>
                  {it.subtitle && <span className="block truncate text-xs text-muted-foreground">{it.subtitle}</span>}
                </span>
                {it.badge && <Badge variant="secondary">{it.badge}</Badge>}
              </>
            );
            return (
              <li key={it.id}>
                {it.action ? (
                  <button type="button" onClick={() => act(it.action!, { id: it.id })} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-accent/50">
                    {row}
                  </button>
                ) : (
                  <div className="flex items-center gap-2 px-3 py-2">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      );
    case "button":
      return (
        <Button size="sm" variant={node.variant === "primary" ? "default" : node.variant === "danger" ? "destructive" : "secondary"} disabled={node.disabled} onClick={() => act(node.action, { values })} className="w-fit">
          {node.label}
        </Button>
      );
    case "input":
      return (
        <label className="block space-y-1">
          {node.label && <span className="text-xs text-muted-foreground">{node.label}</span>}
          <Input
            // Never a password field: nothing an extension draws should be asking for one.
            type="text"
            autoComplete="off"
            value={String(values[node.name] ?? "")}
            placeholder={node.placeholder}
            onChange={(e) => {
              set(node.name, e.target.value);
              if (node.action) act(node.action, { name: node.name, value: e.target.value });
            }}
          />
        </label>
      );
    case "toggle":
      return (
        <label className="flex items-center justify-between gap-3 text-sm">
          {node.label}
          <Switch
            checked={values[node.name] === true}
            onCheckedChange={(v) => {
              set(node.name, v);
              if (node.action) act(node.action, { name: node.name, value: v });
            }}
          />
        </label>
      );
    case "select":
      return (
        <label className="block space-y-1">
          {node.label && <span className="text-xs text-muted-foreground">{node.label}</span>}
          <Select
            value={String(values[node.name] ?? "")}
            onValueChange={(v) => {
              set(node.name, v);
              if (node.action) act(node.action, { name: node.name, value: v });
            }}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {node.options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      );
  }
}

export function UiView({ tree, act }: { tree: UiNode; act: (action: string, value?: unknown) => void }) {
  const initial = useMemo(() => {
    const v: Values = {};
    collect(tree, v);
    return v;
  }, [tree]);
  const [values, setValues] = useState<Values>(initial);
  const seen = useRef(initial);
  // A new picture from the extension re-seeds controls it has changed, and leaves alone the ones it hasn't.
  useEffect(() => {
    const prev = seen.current;
    seen.current = initial;
    setValues((cur) => {
      const next = { ...cur };
      for (const [k, v] of Object.entries(initial)) if (!(k in cur) || prev[k] !== v) next[k] = v;
      return next;
    });
  }, [initial]);
  return <Node node={tree} values={values} set={(n, v) => setValues((m) => ({ ...m, [n]: v }))} act={act} />;
}

const STATUS_TEXT: Record<Status, { label: string; tone: Tone }> = {
  starting: { label: "Starting…", tone: "info" },
  running: { label: "Running", tone: "good" },
  suspended: { label: "Stopped", tone: "bad" },
  stopped: { label: "Off", tone: "neutral" },
};

/**
 * The frame an extension's picture is always drawn in. It belongs to Crystal, sits
 * outside the extension's tree, and can't be changed or covered by it: it says whose
 * this is and that it is sandboxed, so nothing inside it can pass for part of the app.
 */
export function ExtensionFrame({
  name,
  version,
  status,
  detail,
  tree,
  act,
  onRestart,
  onStop,
  children,
}: {
  name: string;
  version: string;
  status: Status;
  detail?: string;
  tree: UiNode | null;
  act: (action: string, value?: unknown) => void;
  onRestart?: () => void;
  onStop?: () => void;
  children?: React.ReactNode;
}) {
  const s = STATUS_TEXT[status];
  return (
    <section className="overflow-hidden rounded-2xl border-2 border-dashed border-primary/40 bg-background">
      <header className="flex items-center gap-2 border-b border-border/60 bg-primary/5 px-3 py-2">
        {status === "suspended" ? <ShieldAlert className="size-4 text-red-400" /> : <ShieldCheck className="size-4 text-primary" />}
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className="font-semibold">{name}</span> <span className="text-muted-foreground">v{version} · an extension, running in a sandbox</span>
        </span>
        <Badge variant="secondary" className={TONE[s.tone]}>
          {s.label}
        </Badge>
        {status === "running" && onStop && (
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onStop}>
            Stop
          </Button>
        )}
      </header>
      <div className="min-h-24 p-4">
        {status === "suspended" ? (
          <div className="space-y-3 text-sm">
            <p className="text-red-400">This extension was stopped: {detail}.</p>
            <p className="text-muted-foreground">It stays stopped until you start it again.</p>
            {onRestart && (
              <Button size="sm" variant="secondary" onClick={onRestart}>
                Start it again
              </Button>
            )}
          </div>
        ) : tree ? (
          <UiView tree={tree} act={act} />
        ) : (
          <p className="text-sm text-muted-foreground">{status === "starting" ? "Starting…" : "Nothing to show yet."}</p>
        )}
        {children}
      </div>
      <footer className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">Crystal never asks for a password, a code or payment details inside an extension. Don&apos;t enter any here.</footer>
    </section>
  );
}
