import type { Id } from "../../../../convex/_generated/dataModel";

/** Every section the flow can have. Which of them a given community goes through
 * depends on its kind — see `stepsFor`. */
export const STEP_DEFS = {
  type: { id: "type", label: "Type" },
  template: { id: "template", label: "Template" },
  games: { id: "games", label: "Games" },
  creator: { id: "creator", label: "Creator" },
  profile: { id: "profile", label: "Profile" },
  rules: { id: "rules", label: "Rules" },
  channels: { id: "channels", label: "Channels" },
  roles: { id: "roles", label: "Roles" },
  invite: { id: "invite", label: "Invite" },
} as const;

export type StepId = keyof typeof STEP_DEFS;

/** The flow for a kind of community, in order — also the segments of the progress
 * bar. A standard community picks a template; a clan picks its games and a creator
 * community its platform, and each of those sets up its own channels. */
export function stepsFor(kind: "creator" | "clan" | undefined): (typeof STEP_DEFS)[StepId][] {
  const second = kind === "clan" ? STEP_DEFS.games : kind === "creator" ? STEP_DEFS.creator : STEP_DEFS.template;
  return [
    STEP_DEFS.type,
    second,
    STEP_DEFS.profile,
    STEP_DEFS.rules,
    STEP_DEFS.channels,
    STEP_DEFS.roles,
    STEP_DEFS.invite,
  ];
}

/** Where the starting point came from. */
export interface TemplateChoice {
  kind: "scratch" | "preset" | "saved" | "code";
  /** The preset id, the saved template's id or the code; "scratch" for none. */
  key: string;
  name: string;
  /** A saved or shared template, to count its uses. */
  templateId?: Id<"communityTemplates">;
}

export const SCRATCH_CHOICE: TemplateChoice = {
  kind: "scratch",
  key: "scratch",
  name: "From scratch",
};
