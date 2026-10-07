import type { GrantKind } from "@/components/marketplace/sku-kinds";

/**
 * Turning a catalogue item into something a form can edit, and back.
 *
 * A grant's payload is a string in whatever shape its kind needs — layers as
 * JSON, an address, colours, a plan's perks. The editor shows each as the few
 * controls that matter and writes the payload out itself, so nobody types JSON.
 * Anything it can't represent (an item whose artwork has several layers) is kept
 * exactly as it was and edited as raw text.
 */

export interface PlanPerks {
  plan: string;
  /** Percent off cosmetics, as a person writes it. */
  discountPercent: number;
  streamResolution: string;
  streamFrameRate: number;
  profileEffects: boolean;
  earlyAccess: boolean;
  monthlyBadge: boolean;
}

export interface GrantDraft {
  key: string;
  kind: GrantKind;
  label: string;
  /** The picture, for kinds made of one. */
  artwork: string;
  /** Percent of the avatar or card the artwork is drawn at. */
  width: number;
  start: string;
  end: string;
  plan: PlanPerks;
  /** A payload the form can't show: kept as it was, edited as text. */
  raw: string | null;
}

export interface SkuDraft {
  name: string;
  slug: string;
  slugTouched: boolean;
  description: string;
  categoryId: string;
  type: "cosmetic" | "subscription" | "community" | "bundle";
  price: string;
  currency: string;
  interval: "month" | "year";
  status: "draft" | "active" | "archived";
  featured: boolean;
  grants: GrantDraft[];
}

export const STREAM_RESOLUTIONS = ["720p", "1080p", "1440p", "2160p"];

export const DEFAULT_PLAN: PlanPerks = {
  plan: "",
  discountPercent: 10,
  streamResolution: "1080p",
  streamFrameRate: 30,
  profileEffects: false,
  earlyAccess: false,
  monthlyBadge: true,
};

let counter = 0;
export const newKey = () => `g${Date.now().toString(36)}${counter++}`;

export function blankGrant(kind: GrantKind): GrantDraft {
  return {
    key: newKey(),
    kind,
    label: "",
    artwork: "",
    width: kind === "profileSticker" ? 36 : 100,
    start: "#6366f1",
    end: "#ec4899",
    plan: { ...DEFAULT_PLAN },
    raw: null,
  };
}

export const slugify = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

export function blankDraft(categoryId = ""): SkuDraft {
  return {
    name: "",
    slug: "",
    slugTouched: false,
    description: "",
    categoryId,
    type: "cosmetic",
    price: "1.99",
    currency: "usd",
    interval: "month",
    status: "draft",
    featured: false,
    grants: [blankGrant("avatarDecoration")],
  };
}

interface LayerLike {
  url?: string;
  width?: number;
  kind?: string;
}

/** A stored grant as a draft. */
export function grantToDraft(grant: { kind: GrantKind; payload?: string; label?: string }): GrantDraft {
  const draft = { ...blankGrant(grant.kind), label: grant.label ?? "" };
  const payload = grant.payload ?? "";

  switch (grant.kind) {
    case "avatarDecoration":
    case "profileSticker": {
      try {
        const layers = JSON.parse(payload) as LayerLike[];
        const [only] = layers;
        // One plain picture is something the form can show. Anything richer —
        // several layers, text, shapes — is kept untouched.
        if (Array.isArray(layers) && layers.length === 1 && only?.url && (!only.kind || only.kind === "image")) {
          return { ...draft, artwork: only.url, width: only.width ?? draft.width };
        }
      } catch {
        // fall through to raw
      }
      return { ...draft, raw: payload };
    }
    case "profileEffect":
    case "nameplate":
      return { ...draft, artwork: payload };
    case "communityTheme":
      try {
        const colours = JSON.parse(payload) as { start?: string; end?: string };
        return { ...draft, start: colours.start ?? draft.start, end: colours.end ?? draft.end };
      } catch {
        return { ...draft, raw: payload };
      }
    case "plan":
      try {
        const p = JSON.parse(payload) as Record<string, unknown>;
        return {
          ...draft,
          plan: {
            plan: typeof p.plan === "string" ? p.plan : "",
            discountPercent: typeof p.cosmeticDiscountBps === "number" ? p.cosmeticDiscountBps / 100 : 0,
            streamResolution: typeof p.streamResolution === "string" ? p.streamResolution : DEFAULT_PLAN.streamResolution,
            streamFrameRate: typeof p.streamFrameRate === "number" ? p.streamFrameRate : DEFAULT_PLAN.streamFrameRate,
            profileEffects: !!p.profileEffects,
            earlyAccess: !!p.earlyAccess,
            monthlyBadge: !!p.monthlyBadge,
          },
        };
      } catch {
        return { ...draft, raw: payload };
      }
    default:
      return draft;
  }
}

/** A draft as the payload the server stores. */
export function draftPayload(g: GrantDraft, slug: string): string | undefined {
  if (g.raw !== null) return g.raw;
  switch (g.kind) {
    case "avatarDecoration":
      return JSON.stringify([{ id: "art", url: g.artwork, anchor: "center", x: 50, y: 0, width: g.width }]);
    case "profileSticker":
      return JSON.stringify([{ id: "art", url: g.artwork, anchor: "top", x: 50, y: 50, width: g.width }]);
    case "profileEffect":
    case "nameplate":
      return g.artwork;
    case "communityTheme":
      return JSON.stringify({ start: g.start.toLowerCase(), end: g.end.toLowerCase() });
    case "plan":
      return JSON.stringify({
        plan: g.plan.plan || slug,
        cosmeticDiscountBps: Math.round(g.plan.discountPercent * 100),
        streamResolution: g.plan.streamResolution,
        streamFrameRate: g.plan.streamFrameRate,
        profileEffects: g.plan.profileEffects,
        earlyAccess: g.plan.earlyAccess,
        monthlyBadge: g.plan.monthlyBadge,
      });
    default:
      return undefined;
  }
}

/** What a draft grant gives, as the store and the preview read it. */
export function draftGrants(draft: SkuDraft) {
  return draft.grants.map((g) => ({ kind: g.kind, payload: draftPayload(g, draft.slug), label: g.label || undefined }));
}

/** The picture for the store card: the first piece of artwork there is. */
export function draftImage(draft: SkuDraft): string | undefined {
  return draft.grants.find((g) => g.artwork && g.raw === null)?.artwork || undefined;
}

export function priceToCents(price: string): number {
  return Math.round(Number(price) * 100);
}
