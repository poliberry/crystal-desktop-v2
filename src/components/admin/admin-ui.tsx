"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Loader2, type LucideIcon } from "lucide-react";
import { toast } from "sonner";

import type { EntityRef } from "@/components/admin/console-state";
import { useOpenEntity } from "@/components/admin/console-state";
import { GLASS_SETTINGS } from "@/components/sidebar/glass";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/**
 * The console's vocabulary: the handful of pieces every section and record is
 * built from, so a table in Finance and a table in Reports are the same table.
 */

// --- Who is looking ------------------------------------------------------------------

export type StaffPermission =
  | "catalog.read"
  | "catalog.write"
  | "pricing.write"
  | "users.read"
  | "users.entitle"
  | "users.moderate"
  | "support.read"
  | "support.act"
  | "system.broadcast"
  | "system.manage"
  | "communities.read"
  | "communities.manage"
  | "reports.read"
  | "reports.act"
  | "finance.read"
  | "finance.refund"
  | "finance.payout"
  | "staff.manage"
  | "audit.read";

interface StaffValue {
  userId: string;
  name: string;
  username: string;
  imageUrl?: string;
  roles: string[];
  permissions: string[];
}

const StaffContext = createContext<StaffValue | null>(null);
export const StaffProvider = StaffContext.Provider;

/** The signed-in staff member and what they may do. A courtesy to the interface
 * only — the server checks every call itself. */
export function useStaff() {
  const staff = useContext(StaffContext);
  if (!staff) throw new Error("useStaff must be used inside <StaffProvider>");
  return { ...staff, can: (permission: StaffPermission) => staff.permissions.includes(permission) };
}

// --- Layout ----------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 pb-5">
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Icon className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  flush,
}: {
  title?: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** No padding, for tables and lists that run to the edges. */
  flush?: boolean;
}) {
  return (
    <section className={cn(GLASS_SETTINGS, "overflow-hidden", className)}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="truncate text-sm font-semibold">{title}</h2>}
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

const TONES = {
  neutral: "bg-foreground/10 text-muted-foreground",
  good: "bg-emerald-500/15 text-emerald-500",
  warn: "bg-amber-500/15 text-amber-500",
  bad: "bg-destructive/15 text-destructive",
  info: "bg-sky-500/15 text-sky-400",
} as const;
export type Tone = keyof typeof TONES;

export function StatusPill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap capitalize", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function StatCard({
  label,
  value,
  detail,
  tone,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  detail?: string;
  tone?: Tone;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("mt-1.5 text-2xl font-semibold tabular-nums", tone && tone !== "neutral" && TONES[tone].split(" ")[1])}>{value}</p>
      {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
    </>
  );
  const cls = cn(GLASS_SETTINGS, "p-4 text-left");
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(cls, "transition-colors hover:bg-foreground/5")}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon?: LucideIcon; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-muted-foreground">
      {Icon && <Icon className="size-8 opacity-60" />}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {children && <p className="max-w-sm text-xs">{children}</p>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> {label}
    </div>
  );
}

/** Label and value pairs. */
export function Fields({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-6 gap-y-2.5 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A row in a list of records, which opens one. */
export function ListRow({
  onOpen,
  children,
  className,
  active,
}: {
  onOpen?: (event: React.MouseEvent) => void;
  children: React.ReactNode;
  className?: string;
  active?: boolean;
}) {
  const cls = cn(
    "flex w-full items-center gap-3 px-4 py-3 text-left text-sm",
    onOpen && "transition-colors hover:bg-foreground/5",
    active && "bg-foreground/10",
    className,
  );
  return onOpen ? (
    <button type="button" onClick={onOpen} className={cls}>
      {children}
    </button>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function Person({
  user,
  className,
}: {
  user: { name?: string; username: string; imageUrl?: string };
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <Avatar className="size-6 shrink-0">
        <AvatarImage src={user.imageUrl} alt="" />
        <AvatarFallback className="text-[10px]">{(user.name ?? user.username).slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="min-w-0 truncate">
        {user.name && <span className="font-medium">{user.name} </span>}
        <span className="text-muted-foreground">@{user.username}</span>
      </span>
    </span>
  );
}

/** Text that opens a record — in a tab of the current session, or in a new one
 * with Ctrl/⌘. */
export function EntityLink({ entity, children, className }: { entity: EntityRef; children: React.ReactNode; className?: string }) {
  const open = useOpenEntity();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        open(entity, e);
      }}
      className={cn("rounded text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none", className)}
    >
      {children}
    </button>
  );
}

export function PillTabs<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (value: T) => void;
  tabs: { id: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-foreground/10 pb-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === tab.id ? "bg-foreground/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
          )}
        >
          {tab.label}
          {tab.count !== undefined && tab.count > 0 && (
            <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 text-xs text-primary">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// --- Doing things ----------------------------------------------------------------------------

/** Runs a mutation or action with a busy flag and a toast either way. */
export function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, work: () => Promise<T>, done?: string): Promise<T | undefined> => {
    setBusy(key);
    try {
      const result = await work();
      if (done) toast.success(done);
      return result;
    } catch (error) {
      toast.error(errorMessage(error));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);
  return { run, busy };
}

/** A confirmation that wants a reason, which goes on the record. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive,
  minLength = 3,
  placeholder = "Reason (recorded in the audit log)",
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  destructive?: boolean;
  minLength?: number;
  placeholder?: string;
  children?: React.ReactNode;
  onConfirm: (reason: string) => Promise<unknown> | unknown;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm(reason.trim());
      setReason("");
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} className="min-h-20" maxLength={500} />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={busy || reason.trim().length < minLength}
            onClick={() => void confirm()}
          >
            {busy && <Loader2 className="animate-spin" />} {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Convex errors carry the server's words; keep them readable. */
export { errorMessage };
