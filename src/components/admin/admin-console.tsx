"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { Globe2, LockKeyhole, Search, ShieldAlert, ShieldCheck, UserRound } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { StaffProvider, StatusPill, useStaff } from "@/components/admin/admin-ui";
import { ConsoleProvider, HOME, useConsole, type EntityRef } from "@/components/admin/console-state";
import { CommunityRecord } from "@/components/admin/records/community";
import { OrderRecord } from "@/components/admin/records/order";
import { ReportRecord } from "@/components/admin/records/report";
import { SkuRecord } from "@/components/admin/records/sku";
import { ExtensionRecord } from "@/components/admin/records/extension";
import { SubmissionRecord } from "@/components/admin/records/submission";
import { BotsSection } from "@/components/admin/sections/bots";
import { ExtensionsSection } from "@/components/admin/sections/extensions";
import { E2eeSection } from "@/components/admin/sections/e2ee";
import { GuidesSection } from "@/components/admin/sections/guides";
import { TicketRecord } from "@/components/admin/records/ticket";
import { UserRecord } from "@/components/admin/records/user";
import { CatalogSection, CategoriesSection } from "@/components/admin/sections/catalog";
import { DashboardSection } from "@/components/admin/sections/dashboard";
import { AccountsSection, CommunitiesSection } from "@/components/admin/sections/directory";
import { OrdersSection, PayoutsSection, RevenueSection } from "@/components/admin/sections/finance";
import { AuditSection, BroadcastSection, StaffSection, SystemAccountSection } from "@/components/admin/sections/platform";
import { ReportsSection, SubmissionsSection, SupportSection } from "@/components/admin/sections/queues";
import { SiteMap, useVisibleSiteMap } from "@/components/admin/site-map";
import { SessionRail, TabStrip } from "@/components/admin/workspace";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPrompt } from "@/lib/step-up";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WindowControls } from "@/components/window-controls";
import { useTrafficLightsInset } from "@/hooks/use-window-controls";
import { ROLE_LABELS, type StaffRole } from "../../../convex/lib/staffPermissions";
import { cn } from "@/lib/utils";

const SECTIONS: Record<string, () => React.JSX.Element> = {
  dashboard: DashboardSection,
  reports: ReportsSection,
  accounts: AccountsSection,
  communities: CommunitiesSection,
  support: SupportSection,
  catalog: CatalogSection,
  submissions: SubmissionsSection,
  extensions: ExtensionsSection,
  e2ee: E2eeSection,
  bots: BotsSection,
  guides: GuidesSection,
  categories: CategoriesSection,
  finance: RevenueSection,
  orders: OrdersSection,
  payouts: PayoutsSection,
  broadcast: BroadcastSection,
  system: SystemAccountSection,
  staff: StaffSection,
  audit: AuditSection,
};

function Record({ entity }: { entity: EntityRef }) {
  switch (entity.kind) {
    case "report":
      return <ReportRecord id={entity.id} />;
    case "user":
      return <UserRecord id={entity.id} />;
    case "community":
      return <CommunityRecord id={entity.id} />;
    case "ticket":
      return <TicketRecord id={entity.id} />;
    case "order":
      return <OrderRecord id={entity.id} />;
    case "sku":
      return <SkuRecord id={entity.id} />;
    case "submission":
      return <SubmissionRecord id={entity.id} />;
    case "extension":
      return <ExtensionRecord id={entity.id} />;
  }
}

/** A scrolling page with the console's standard gutter. */
function Page({ children }: { children: React.ReactNode }) {
  return (
    <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
      <div className="mx-auto w-full max-w-6xl p-6 pb-10">{children}</div>
    </ScrollArea>
  );
}

/**
 * Everything open, all of it mounted.
 *
 * Inactive sessions are hidden, not removed: unmounting one would throw away
 * the reply half-written in it, the form half-filled, the place it was scrolled
 * to. That is the point of a session over a page you navigate away from.
 */
function Workspace() {
  const { sessions, active, section } = useConsole();
  const groups = useVisibleSiteMap();
  const allowed = new Set(groups.flatMap((g) => g.items.map((i) => i.id)));
  // A section remembered from before this person's access changed.
  const current = allowed.has(section) ? section : "dashboard";
  const Section = SECTIONS[current] ?? DashboardSection;

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className={cn("flex min-h-0 flex-1", active !== HOME && "hidden")}>
        <SiteMap />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Page>
            <Section />
          </Page>
        </div>
      </div>

      {sessions.map((session) => (
        <div key={session.id} className={cn("flex min-h-0 flex-1 flex-col", active !== session.id && "hidden")}>
          <TabStrip session={session} />
          {session.tabs.map((tab) => (
            <div key={tab.id} className={cn("flex min-h-0 flex-1 flex-col", tab.id !== session.activeTabId && "hidden")}>
              <Page>
                <Record entity={tab.ref} />
              </Page>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The box at the top: find a person or a community from anywhere. */
function GlobalSearch() {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [debounced, setDebounced] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const { open: openIn } = useConsole();
  const staff = useStaff();
  const results = useQuery(
    api.operations.search,
    debounced.trim().length >= 2 && (staff.can("users.read") || staff.can("communities.read")) ? { query: debounced } : "skip",
  );

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(text), 200);
    return () => window.clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (ref: EntityRef) => {
    openIn(ref, "session");
    setText("");
    input.current?.blur();
  };

  const show = focused && text.trim().length >= 2;
  const empty = results && results.users.length === 0 && results.communities.length === 0;

  return (
    <div className="relative w-[26rem] max-w-[36vw]" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onKeyDown={(e) => e.key === "Escape" && input.current?.blur()}
        placeholder="Find an account or community"
        className="h-7 bg-foreground/5 pr-12 pl-8 text-xs"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border border-foreground/15 px-1 text-[10px] text-muted-foreground">
        Ctrl K
      </kbd>

      {show && (
        <div className="absolute top-9 left-0 z-50 max-h-96 w-full overflow-y-auto rounded-xl border border-foreground/10 bg-popover p-1 shadow-xl">
          {results === undefined && <p className="px-3 py-2 text-xs text-muted-foreground">Searching…</p>}
          {empty && <p className="px-3 py-2 text-xs text-muted-foreground">No matches.</p>}
          {results?.users.map((u) => (
            <button
              key={u.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go({ kind: "user", id: u.id, title: u.name, subtitle: `@${u.username}` })}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-foreground/10"
            >
              <Avatar className="size-6">
                <AvatarImage src={u.imageUrl} alt="" />
                <AvatarFallback className="text-[10px]">{u.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate">
                {u.name} <span className="text-muted-foreground">@{u.username}</span>
              </span>
              <UserRound className="size-3.5 text-muted-foreground" />
            </button>
          ))}
          {results?.communities.map((c) => (
            <button
              key={c.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go({ kind: "community", id: c.id, title: c.name })}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-foreground/10"
            >
              <Avatar className="size-6 rounded-md">
                <AvatarImage src={c.imageUrl} alt="" />
                <AvatarFallback className="rounded-md text-[10px]">{c.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <Globe2 className="size-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Alt+1…9 for a session, Alt+0 for Home, Alt+W to close the tab you're in. */
function useShortcuts() {
  const { sessions, current, activate, closeTab, closeSession } = useConsole();
  const latest = useRef({ sessions, current });
  latest.current = { sessions, current };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const { sessions, current } = latest.current;
      if (e.key === "0") {
        e.preventDefault();
        activate(HOME);
      } else if (/^[1-9]$/.test(e.key)) {
        const target = sessions[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          activate(target.id);
        }
      } else if (e.key.toLowerCase() === "w" && current) {
        e.preventDefault();
        if (e.shiftKey || current.tabs.length === 1) closeSession(current.id);
        else closeTab(current.id, current.activeTabId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activate, closeTab, closeSession]);
}

/**
 * What the console window shows before there is a console (loading, or not staff): a drag strip with the window's own
 * buttons, over the message. The window is frameless, so without this it could be neither moved nor closed.
 */
export function PlainWindow({ children }: { children: React.ReactNode }) {
  const trafficLights = useTrafficLightsInset();
  return (
    <div className="flex h-full flex-col bg-background">
      <header
        style={{ WebkitAppRegion: "drag", paddingLeft: trafficLights ? trafficLights : undefined } as React.CSSProperties}
        className="flex h-11 shrink-0 items-center justify-end"
      >
        <WindowControls className="h-full self-stretch border-none [&>button]:h-full" />
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center">{children}</div>
    </div>
  );
}

function Shell() {
  const trafficLights = useTrafficLightsInset();
  const staff = useStaff();
  useShortcuts();

  return (
    <div className="settings-surface flex h-full flex-col text-foreground">
      <header
        style={{ WebkitAppRegion: "drag", paddingLeft: trafficLights ? trafficLights : undefined } as React.CSSProperties}
        // Four columns: title, search, the staff badge, and the window's own buttons. The buttons used to be a fourth child of
        // a three-column grid, so they wrapped onto a second row of a fixed-height header and were clipped away. They sit
        // flush against the right edge, so the header has no right padding of its own (the badge column carries it).
        className="grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-4 border-b border-foreground/10 bg-background/60 pl-3 backdrop-blur-xl"
      >
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 shrink-0 text-primary" />
          <span className="truncate">Crystal administration</span>
        </div>
        <GlobalSearch />
        <div className="flex min-w-0 items-center justify-end gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <div className="hidden items-center gap-1 md:flex">
            {staff.roles.map((role) => (
              <StatusPill key={role} tone={role === "finance" ? "warn" : "info"}>
                {ROLE_LABELS[role as StaffRole] ?? role}
              </StatusPill>
            ))}
          </div>
          <Avatar className="size-6 shrink-0">
            <AvatarImage src={staff.imageUrl} alt="" />
            <AvatarFallback className="text-[10px]">{staff.name.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
        </div>
        {/* Windows and Linux only: draws nothing on macOS, which has the system's traffic lights at the left. A no-drag
            region inside the header's drag one, so clicks reach the buttons. */}
        <WindowControls className="h-full self-stretch border-none [&>button]:h-full" />
      </header>

      <div className="flex min-h-0 flex-1">
        <SessionRail />
        <Workspace />
      </div>
    </div>
  );
}

export function AdminConsole() {
  const staff = useQuery(api.staff.me);
  const value = useMemo(() => (staff ? { ...staff, userId: String(staff.userId) } : null), [staff]);

  if (staff === undefined) {
    return (
      <PlainWindow>
        <p className="text-muted-foreground">Checking staff access…</p>
      </PlainWindow>
    );
  }
  if (!value) {
    return (
      <PlainWindow>
        <div className="p-6 text-center">
          <ShieldCheck className="mx-auto size-10 text-muted-foreground" />
          <h1 className="mt-4 text-xl font-semibold">Staff access required</h1>
          <p className="mt-1 text-sm text-muted-foreground">This window is restricted to authorised Crystal staff.</p>
        </div>
      </PlainWindow>
    );
  }

  return (
    <AdminGate gate={staff!.twoFactor.gate}>
      <StaffProvider value={value}>
        <ConsoleProvider userId={value.userId}>
          <TooltipProvider delayDuration={200}>
            <Shell />
          </TooltipProvider>
        </ConsoleProvider>
      </StaffProvider>
    </AdminGate>
  );
}

/**
 * Keeps the console shut only when the platform requires two-step verification and this account
 * hasn't turned it on. A code is not asked for on the way in: destructive actions ask for one at
 * the moment they are taken (see `requireStaff`, and the Convex client that prompts and retries).
 */
function AdminGate({ gate, children }: { gate: "open" | "enroll"; children: React.ReactNode }) {
  if (gate === "open") return <>{children}</>;
  return (
    <PlainWindow>
      <div className="max-w-sm space-y-4 p-6 text-center">
        <ShieldAlert className="mx-auto size-10 text-amber-400" />
        <h1 className="text-xl font-semibold">Two-step verification required</h1>
        <p className="text-sm text-muted-foreground">
          Crystal requires two-step verification on staff accounts. Open Crystal, go to Settings → Security, turn it on with an authenticator app or a passkey, then come back.
        </p>
      </div>
    </PlainWindow>
  );
}
