/**
 * What each staff role may do. Pure data, imported by the server (to enforce it)
 * and by the console (to decide what to show) — the console hiding something is
 * only ever a courtesy, and the server checks every call itself.
 *
 * Finance is deliberately outside the hierarchy. No other role includes it, the
 * owner's included: whoever holds the `finance` role may see money, and owners
 * can give it out, but being an owner does not quietly mean it. Every grant of it
 * is in the audit log.
 */

export const STAFF_ROLES = ["owner", "admin", "moderator", "support", "finance"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

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

const ALL_BUT_FINANCE: StaffPermission[] = [
  "catalog.read",
  "catalog.write",
  "pricing.write",
  "users.read",
  "users.entitle",
  "users.moderate",
  "communities.read",
  "communities.manage",
  "reports.read",
  "reports.act",
  "staff.manage",
  "audit.read",
  "support.read",
  "support.act",
  "system.broadcast",
  "system.manage",
];

export const ROLE_PERMISSIONS: Record<StaffRole, readonly StaffPermission[]> = {
  owner: ALL_BUT_FINANCE,
  admin: [
    "catalog.read",
    "catalog.write",
    "pricing.write",
    "users.read",
    "users.entitle",
    "users.moderate",
    "communities.read",
    "communities.manage",
    "reports.read",
    "reports.act",
    "audit.read",
    "system.broadcast",
    "system.manage",
  ],
  moderator: ["users.read", "users.moderate", "communities.read", "reports.read", "reports.act"],
  support: ["users.read", "communities.read", "reports.read", "support.read", "support.act"],
  // Sees what is for sale (to read orders against it) and the money, and the
  // trail of who did what — but cannot change the catalogue or its prices.
  finance: ["catalog.read", "finance.read", "finance.refund", "finance.payout", "audit.read"],
};

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  admin: "Admin",
  moderator: "Moderator",
  support: "Support",
  finance: "Finance",
};

/** Everything a set of roles allows. */
export function permissionsFor(roles: readonly StaffRole[]): Set<StaffPermission> {
  const set = new Set<StaffPermission>();
  for (const role of roles) for (const permission of ROLE_PERMISSIONS[role] ?? []) set.add(permission);
  return set;
}

export function can(roles: readonly StaffRole[], permission: StaffPermission): boolean {
  return permissionsFor(roles).has(permission);
}
