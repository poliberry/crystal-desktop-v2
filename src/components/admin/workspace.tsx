"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Puzzle,
  ChevronsLeft,
  ChevronsRight,
  Flag,
  Globe2,
  Home,
  Inbox,
  Package,
  Palette,
  Receipt,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";

import {
  HOME,
  useConsole,
  type ConsoleTab,
  type EntityKind,
  type Session,
} from "@/components/admin/console-state";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const KIND_META: Record<EntityKind, { icon: LucideIcon; label: string; tint: string }> = {
  report: { icon: Flag, label: "Report", tint: "bg-rose-500/20 text-rose-400" },
  user: { icon: UserRound, label: "Account", tint: "bg-sky-500/20 text-sky-400" },
  community: { icon: Globe2, label: "Community", tint: "bg-emerald-500/20 text-emerald-400" },
  ticket: { icon: Inbox, label: "Ticket", tint: "bg-amber-500/20 text-amber-400" },
  order: { icon: Receipt, label: "Order", tint: "bg-violet-500/20 text-violet-400" },
  sku: { icon: Package, label: "Item", tint: "bg-fuchsia-500/20 text-fuchsia-400" },
  submission: { icon: Palette, label: "Submission", tint: "bg-orange-500/20 text-orange-400" },
  extension: { icon: Puzzle, label: "Extension", tint: "bg-violet-500/20 text-violet-400" },
};

/**
 * The session rail down the left edge: Home, then one entry per piece of work
 * in progress.
 *
 * Wide enough to read what each session is, narrow enough to keep out of the
 * way — it folds to icons, with the names in tooltips. The active session is
 * marked with a bar at its edge, as the settings menus mark the page you are on.
 */
export function SessionRail() {
  const { sessions, active, activate, closeSession, reorder } = useConsole();
  const [expanded, setExpanded] = useState(true);
  const [dragging, setDragging] = useState<number | null>(null);

  return (
    <nav
      aria-label="Sessions"
      className={cn(
        "flex shrink-0 flex-col gap-1 border-r border-foreground/10 bg-background/40 p-2 backdrop-blur-xl transition-[width] duration-200",
        expanded ? "w-60" : "w-14",
      )}
    >
      <RailItem
        icon={Home}
        tint="bg-primary/20 text-primary"
        title="Home"
        subtitle="Queues and records"
        active={active === HOME}
        expanded={expanded}
        onClick={() => activate(HOME)}
      />

      <div className="my-1 flex items-center gap-2 px-1">
        <div className="h-px flex-1 bg-foreground/10" />
        {expanded && (
          <span className="text-[10px] font-medium tracking-wider text-muted-foreground uppercase">
            Sessions {sessions.length > 0 && `· ${sessions.length}`}
          </span>
        )}
        <div className="h-px flex-1 bg-foreground/10" />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <AnimatePresence initial={false}>
          {sessions.map((session, index) => {
            const first = session.tabs[0];
            const kind = KIND_META[first.ref.kind];
            return (
              <motion.div
                key={session.id}
                layout
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                draggable
                onDragStart={() => setDragging(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging !== null) reorder(dragging, index);
                  setDragging(null);
                }}
                onDragEnd={() => setDragging(null)}
              >
                <RailItem
                  icon={kind.icon}
                  tint={kind.tint}
                  title={first.ref.title}
                  subtitle={
                    session.tabs.length > 1
                      ? `${kind.label} · ${session.tabs.length} tabs`
                      : (first.ref.subtitle ?? kind.label)
                  }
                  active={active === session.id}
                  expanded={expanded}
                  onClick={() => activate(session.id)}
                  onClose={() => closeSession(session.id)}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
        {sessions.length === 0 && expanded && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Open a report, account or order from Home and it becomes a session here. Open as many as you need — each keeps its place.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? "Collapse sessions" : "Expand sessions"}
        className="flex h-8 items-center justify-center gap-2 rounded-lg text-xs text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
      >
        {expanded ? <ChevronsLeft className="size-4" /> : <ChevronsRight className="size-4" />}
        {expanded && "Collapse"}
      </button>
    </nav>
  );
}

function RailItem({
  icon: Icon,
  tint,
  title,
  subtitle,
  active,
  expanded,
  onClick,
  onClose,
}: {
  icon: LucideIcon;
  tint: string;
  title: string;
  subtitle?: string;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
  onClose?: () => void;
}) {
  const body = (
    <div
      className={cn(
        "group relative flex items-center gap-2.5 rounded-xl border p-1.5 transition-colors",
        active
          ? "border-foreground/15 bg-gradient-to-br from-foreground/[0.14] to-foreground/[0.05] shadow-sm"
          : "border-transparent hover:bg-foreground/5",
      )}
    >
      {active && <span className="absolute top-1/2 -left-2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary" />}
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", tint)}>
          <Icon className="size-4" />
        </span>
        {expanded && (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm leading-tight font-medium">{title}</span>
            {subtitle && <span className="block truncate text-xs leading-tight text-muted-foreground">{subtitle}</span>}
          </span>
        )}
      </button>
      {expanded && onClose && (
        <button
          type="button"
          aria-label={`Close ${title}`}
          onClick={onClose}
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground/10 hover:text-foreground focus-visible:opacity-100"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );

  if (expanded) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{body}</TooltipTrigger>
      <TooltipContent side="right">
        {title}
        {subtitle ? ` — ${subtitle}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

/** The tabs inside one session. */
export function TabStrip({ session }: { session: Session }) {
  const { activateTab, closeTab, closeSession } = useConsole();
  return (
    <div className="flex shrink-0 items-end gap-1 border-b border-foreground/10 px-3 pt-2">
      <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
        {session.tabs.map((tab: ConsoleTab) => {
          const meta = KIND_META[tab.ref.kind];
          const on = tab.id === session.activeTabId;
          return (
            <div
              key={tab.id}
              className={cn(
                "group flex max-w-52 min-w-0 shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 py-1.5 text-sm transition-colors",
                on
                  ? "border-foreground/10 bg-background/70 text-foreground"
                  : "border-transparent text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              <button
                type="button"
                onClick={() => activateTab(session.id, tab.id)}
                className="flex min-w-0 items-center gap-1.5"
              >
                <meta.icon className="size-3.5 shrink-0" />
                <span className="truncate">{tab.ref.title}</span>
              </button>
              {session.tabs.length > 1 && (
                <button
                  type="button"
                  aria-label={`Close ${tab.ref.title}`}
                  onClick={() => closeTab(session.id, tab.id)}
                  className="rounded p-0.5 opacity-0 hover:bg-foreground/10 group-hover:opacity-100"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => closeSession(session.id)}
        className="mb-1 flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
      >
        <X className="size-3.5" /> Close session
      </button>
    </div>
  );
}

