import { PERMISSIONS } from "@/lib/permissions";

/**
 * What a new community is made of, and the presets to start from.
 *
 * Mirrors the shape in convex/lib/communitySetup.ts, which is where it is
 * checked: the client builds one of these as the create flow goes, and sends it
 * whole.
 */

export interface SetupChannel {
  name: string;
  type: "text" | "voice";
  topic?: string;
  /** The category it sits under, by name. */
  category?: string;
  /** What a text channel shows in place of messages — see convex/lib/communityKinds.ts. */
  surface?: string;
  /** The clan game it belongs to. */
  gameId?: string;
}

export interface SetupRole {
  name: string;
  color?: string;
  permissions: number;
  hoist?: boolean;
}

export interface SetupRule {
  title: string;
  body?: string;
}

export interface CommunitySetup {
  channels: SetupChannel[];
  /** Highest first. */
  roles: SetupRole[];
  rules: SetupRule[];
}

/** The ceilings the server enforces (convex/lib/communitySetup.ts), so the flow
 * can stop short of them. */
export const SETUP_LIMITS = { channels: 40, roles: 20, rules: 15 } as const;

export function cloneSetup(setup: CommunitySetup): CommunitySetup {
  return {
    channels: setup.channels.map((c) => ({ ...c })),
    roles: setup.roles.map((r) => ({ ...r })),
    rules: setup.rules.map((r) => ({ ...r })),
  };
}

// --- Roles -------------------------------------------------------------------

const MEMBER =
  PERMISSIONS.VIEW_CHANNELS |
  PERMISSIONS.SEND_MESSAGES |
  PERMISSIONS.CONNECT |
  PERMISSIONS.CREATE_INVITE;

const MODERATOR =
  MEMBER |
  PERMISSIONS.MANAGE_MESSAGES |
  PERMISSIONS.KICK_MEMBERS |
  PERMISSIONS.MUTE_MEMBERS |
  PERMISSIONS.DEAFEN_MEMBERS |
  PERMISSIONS.MOVE_MEMBERS |
  PERMISSIONS.MODERATE_MEMBERS |
  PERMISSIONS.MENTION_EVERYONE;

/** The bundles the roles step offers, rather than eighteen checkboxes. The
 * full list is in the community's settings once it exists. */
export const ROLE_PERMISSION_PRESETS = [
  { id: "admin", label: "Administrator", permissions: PERMISSIONS.ADMINISTRATOR },
  { id: "moderator", label: "Moderator", permissions: MODERATOR },
  { id: "member", label: "Member", permissions: MEMBER },
  {
    id: "viewer",
    label: "Viewer",
    permissions: PERMISSIONS.VIEW_CHANNELS | PERMISSIONS.CONNECT,
  },
] as const;

export function permissionPresetFor(permissions: number): string {
  return ROLE_PERMISSION_PRESETS.find((p) => p.permissions === permissions)?.id ?? "custom";
}

const ADMIN_ROLE = (name = "Admin", color = "#ef4444"): SetupRole => ({
  name,
  color,
  permissions: PERMISSIONS.ADMINISTRATOR,
  hoist: true,
});
const MOD_ROLE = (name = "Moderator", color = "#3b82f6"): SetupRole => ({
  name,
  color,
  permissions: MODERATOR,
  hoist: true,
});

// --- Rules -------------------------------------------------------------------

export const SUGGESTED_RULES: SetupRule[] = [
  { title: "Be respectful", body: "Treat everyone with kindness. No harassment, hate or personal attacks." },
  { title: "No spam or self-promotion", body: "Ask a moderator before sharing your own links or projects." },
  { title: "Keep it on topic", body: "Use the right channel for the conversation." },
  { title: "Keep it safe for work", body: "No NSFW, graphic or illegal content." },
  { title: "Listen to the moderators", body: "If a moderator asks you to stop, stop." },
];

// --- Presets -----------------------------------------------------------------

export interface PresetTemplate {
  id: string;
  name: string;
  description: string;
  /** A key into the icon table in the template step. */
  icon: "gamepad" | "book" | "coffee" | "sparkles" | "briefcase";
  setup: CommunitySetup;
}

const [RULE_RESPECT, RULE_SPAM, RULE_TOPIC, RULE_SFW] = SUGGESTED_RULES;

export const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    id: "gaming",
    name: "Gaming",
    description: "Squads, clips and a lobby to wait in.",
    icon: "gamepad",
    setup: {
      channels: [
        { name: "announcements", type: "text", category: "Info", topic: "News about the community" },
        { name: "general", type: "text", category: "Text" },
        { name: "looking-for-group", type: "text", category: "Text", topic: "Find people to play with" },
        { name: "clips", type: "text", category: "Text", topic: "Your best moments" },
        { name: "Lobby", type: "voice", category: "Voice" },
        { name: "Squad 1", type: "voice", category: "Voice" },
        { name: "Squad 2", type: "voice", category: "Voice" },
      ],
      roles: [ADMIN_ROLE(), MOD_ROLE(), { name: "Regular", color: "#22c55e", permissions: MEMBER }],
      rules: [RULE_RESPECT, RULE_SPAM, RULE_SFW, { title: "No cheating", body: "Play fair, in matches and out of them." }],
    },
  },
  {
    id: "study",
    name: "Study group",
    description: "Focused rooms, resources and a place to take a break.",
    icon: "book",
    setup: {
      channels: [
        { name: "announcements", type: "text", category: "Info" },
        { name: "general", type: "text", category: "Study" },
        { name: "resources", type: "text", category: "Study", topic: "Notes, links and guides" },
        { name: "homework-help", type: "text", category: "Study" },
        { name: "Study hall", type: "voice", category: "Voice" },
        { name: "Break room", type: "voice", category: "Voice" },
      ],
      roles: [ADMIN_ROLE("Organiser", "#a855f7"), { name: "Mentor", color: "#f59e0b", permissions: MODERATOR, hoist: true }],
      rules: [RULE_RESPECT, RULE_TOPIC, { title: "Help, don't hand over answers", body: "Explain how you got there." }],
    },
  },
  {
    id: "friends",
    name: "Friends & hangout",
    description: "A relaxed place for the group chat to live.",
    icon: "coffee",
    setup: {
      channels: [
        { name: "general", type: "text", category: "Chat" },
        { name: "memes", type: "text", category: "Chat" },
        { name: "music", type: "text", category: "Chat", topic: "What are you listening to?" },
        { name: "photos", type: "text", category: "Chat" },
        { name: "Hangout", type: "voice", category: "Voice" },
        { name: "Movie night", type: "voice", category: "Voice" },
      ],
      roles: [],
      rules: [RULE_RESPECT, RULE_SFW],
    },
  },
  {
    id: "creators",
    name: "Creators",
    description: "Share work, get feedback, and talk to your audience.",
    icon: "sparkles",
    setup: {
      channels: [
        { name: "announcements", type: "text", category: "Info" },
        { name: "showcase", type: "text", category: "Community", topic: "Show what you've made" },
        { name: "feedback", type: "text", category: "Community" },
        { name: "chat", type: "text", category: "Community" },
        { name: "Stream hangout", type: "voice", category: "Voice" },
      ],
      roles: [
        ADMIN_ROLE("Creator", "#ec4899"),
        MOD_ROLE(),
        { name: "Supporter", color: "#eab308", permissions: MEMBER, hoist: true },
      ],
      rules: [RULE_RESPECT, RULE_SPAM, { title: "Give credit", body: "Say where things came from." }],
    },
  },
  {
    id: "team",
    name: "Project team",
    description: "Channels for building something together.",
    icon: "briefcase",
    setup: {
      channels: [
        { name: "announcements", type: "text", category: "Team" },
        { name: "general", type: "text", category: "Team" },
        { name: "dev", type: "text", category: "Work" },
        { name: "design", type: "text", category: "Work" },
        { name: "Stand-up", type: "voice", category: "Voice" },
        { name: "Pairing", type: "voice", category: "Voice" },
      ],
      roles: [ADMIN_ROLE("Lead", "#6366f1"), { name: "Contributor", color: "#14b8a6", permissions: MEMBER }],
      rules: [RULE_TOPIC, { title: "Write it down", body: "Decisions belong in a channel, not in a call." }],
    },
  },
];

/** The default for "set up from scratch" — what every community used to start
 * with. */
export const SCRATCH_SETUP: CommunitySetup = {
  channels: [
    { name: "general", type: "text" },
    { name: "General Voice", type: "voice" },
  ],
  roles: [],
  rules: [],
};

/** What a template amounts to, in a line. */
export function describeSetup(setup: CommunitySetup): string {
  const parts = [
    `${setup.channels.length} channel${setup.channels.length === 1 ? "" : "s"}`,
    `${setup.roles.length} role${setup.roles.length === 1 ? "" : "s"}`,
  ];
  if (setup.rules.length) parts.push(`${setup.rules.length} rule${setup.rules.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
