import type { Doc } from "../_generated/dataModel";

/**
 * Axiom running one of the console's own functions (see lib/axiomAdmin.ts).
 *
 * The actor lives on the server-built `ctx`, so a client can't set it. `requireStaff` treats it as
 * staff holding only `AXIOM_STAFF_PERMISSIONS`: staff management, finance, platform settings and
 * message encryption stay out of Axiom's reach here, whatever Axiom asks for.
 */
export interface AxiomActor {
  systemUser: Doc<"users">;
  operatorSub: string;
  changeRef?: string;
}

export const AXIOM_STAFF_PERMISSIONS: ReadonlySet<string> = new Set([
  "users.read",
  "users.moderate",
  "users.ban",
  "users.entitle",
  "communities.read",
  "communities.manage",
  "reports.read",
  "reports.act",
  "support.read",
  "support.act",
  "catalog.read",
  "catalog.write",
  "pricing.write",
  "audit.read",
]);

export function axiomActorOf(ctx: object): AxiomActor | undefined {
  return (ctx as { axiomActor?: AxiomActor }).axiomActor;
}
