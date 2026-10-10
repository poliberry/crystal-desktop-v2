"use client";

import { useQuery } from "convex/react";
import {
  Bot,
  BookOpen,
  Puzzle,
  BarChart3,
  CircleDollarSign,
  Flag,
  FolderTree,
  Globe2,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Package,
  Palette,
  ScrollText,
  Settings2,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { useStaff, type StaffPermission } from "@/components/admin/admin-ui";
import { useConsole } from "@/components/admin/console-state";
import { cn } from "@/lib/utils";

export interface SiteMapItem {
  id: string;
  label: string;
  icon: LucideIcon;
  permission?: StaffPermission;
}

export const SITE_MAP: { label: string; items: SiteMapItem[] }[] = [
  {
    label: "Workspace",
    items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Moderation",
    items: [
      { id: "reports", label: "Reports", icon: Flag, permission: "reports.read" },
      { id: "accounts", label: "Accounts", icon: UserRound, permission: "users.read" },
      { id: "communities", label: "Communities", icon: Globe2, permission: "communities.read" },
    ],
  },
  {
    label: "Customers",
    items: [{ id: "support", label: "Support inbox", icon: Inbox, permission: "support.read" }],
  },
  {
    label: "Marketplace",
    items: [
      { id: "catalog", label: "Catalogue", icon: Package, permission: "catalog.read" },
      { id: "submissions", label: "Creator submissions", icon: Palette, permission: "catalog.read" },
      { id: "categories", label: "Categories", icon: FolderTree, permission: "catalog.read" },
    ],
  },
  {
    label: "Finance",
    items: [
      { id: "finance", label: "Revenue", icon: BarChart3, permission: "finance.read" },
      { id: "orders", label: "Orders", icon: CircleDollarSign, permission: "finance.read" },
      { id: "payouts", label: "Creator payouts", icon: Wallet, permission: "finance.read" },
    ],
  },
  {
    label: "Platform",
    items: [
      { id: "broadcast", label: "System messages", icon: Megaphone, permission: "system.broadcast" },
      { id: "extensions", label: "Extensions", icon: Puzzle, permission: "system.manage" },
      { id: "bots", label: "Bot listings", icon: Bot, permission: "system.manage" },
      { id: "guides", label: "Studio guides", icon: BookOpen, permission: "docs.write" },
      { id: "system", label: "System account", icon: Settings2, permission: "system.manage" },
      { id: "staff", label: "Staff & roles", icon: Users, permission: "staff.manage" },
      { id: "audit", label: "Audit log", icon: ScrollText, permission: "audit.read" },
    ],
  },
];

/** The sections this staff member may open. */
export function useVisibleSiteMap() {
  const { can } = useStaff();
  return SITE_MAP.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((group) => group.items.length > 0);
}

/**
 * Home's menu. Sections the staff member has no permission for are not drawn at
 * all — an empty "Finance" heading would only invite the question. The server
 * enforces it regardless.
 */
export function SiteMap() {
  const { section, goHome } = useConsole();
  const groups = useVisibleSiteMap();
  const overview = useQuery(api.operations.overview);

  const badges: Record<string, number | null | undefined> = {
    reports: (overview?.openReports ?? 0) + (overview?.reviewingReports ?? 0),
    support: (overview?.openTickets ?? 0) + (overview?.inProgressTickets ?? 0),
    submissions: overview?.pendingSubmissions,
    payouts: overview?.unpaidPayouts,
  };

  return (
    <aside className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-foreground/10 p-3">
      {groups.map((group) => (
        <div key={group.label} className="space-y-0.5">
          <p className="px-2 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{group.label}</p>
          {group.items.map((item) => {
            const count = badges[item.id];
            const on = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => goHome(item.id)}
                className={cn(
                  "relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors",
                  on ? "bg-foreground/10 font-medium text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                )}
              >
                {on && <span className="absolute top-1/2 -left-3 h-4 w-[3px] -translate-y-1/2 rounded-full bg-primary" />}
                <item.icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {!!count && (
                  <span className="rounded-full bg-primary/20 px-1.5 text-xs font-medium text-primary tabular-nums">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
