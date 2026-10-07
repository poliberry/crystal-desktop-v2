import { Armchair, Crown, Gem, ImageIcon, Package, Palette, Rocket, Shapes, Sparkles, Stamp, UserRound, Wand2, type LucideIcon } from "lucide-react";

import type { Id } from "../../../convex/_generated/dataModel";

/**
 * What the store sells, and how it is grouped.
 *
 * One list that both the shop and the staff console read, so a kind of item has
 * the same name and icon wherever it appears.
 */

export type GrantKind =
  | "avatarDecoration"
  | "profileSticker"
  | "profileEffect"
  | "nameplate"
  | "communityTheme"
  | "communityBoost"
  | "loungeScene"
  | "themePack"
  | "plan";

export const GRANT_KIND_META: Record<GrantKind, { label: string; plural: string; icon: LucideIcon; blurb: string }> = {
  avatarDecoration: {
    label: "Avatar decoration",
    plural: "Avatar decorations",
    icon: UserRound,
    blurb: "Rings, crowns and ornaments that wear around your avatar.",
  },
  profileSticker: {
    label: "Profile sticker",
    plural: "Profile stickers",
    icon: Stamp,
    blurb: "Artwork stuck onto your profile card.",
  },
  profileEffect: {
    label: "Profile effect",
    plural: "Profile effects",
    icon: Wand2,
    blurb: "Animated flourishes that play over your profile.",
  },
  nameplate: {
    label: "Nameplate",
    plural: "Nameplates",
    icon: ImageIcon,
    blurb: "A banner behind your name in lists and chats.",
  },
  communityTheme: {
    label: "Community theme",
    plural: "Community themes",
    icon: Palette,
    blurb: "A colour scheme for a whole community.",
  },
  communityBoost: {
    label: "Community boost",
    plural: "Community boosts",
    icon: Rocket,
    blurb: "Perks for a community you manage.",
  },
  loungeScene: {
    label: "Lounge scene",
    plural: "Lounge scenes",
    icon: Armchair,
    blurb: "A room for a lounge channel, with seats, a screen and props.",
  },
  themePack: {
    label: "Theme pack",
    plural: "Theme packs",
    icon: Shapes,
    blurb: "A font, colours, sounds and icons for your whole client.",
  },
  plan: {
    label: "Crystal plan",
    plural: "Crystal plans",
    icon: Gem,
    blurb: "A membership with perks across the app.",
  },
};

export interface ShopSku {
  id: Id<"skus">;
  slug: string;
  name: string;
  description?: string;
  categoryId: Id<"skuCategories">;
  type: "cosmetic" | "subscription" | "community" | "bundle";
  priceCents: number;
  currency: string;
  interval?: "month" | "year";
  imageUrl?: string;
  featured: boolean;
  createdAt: number;
  creator: { username: string; name: string; imageUrl?: string } | null;
  grants: { kind: GrantKind; payload?: string; label?: string }[];
}

/** The shop's pages. Each is a way of slicing the same catalogue; "home" is the
 * front page, the rest filter by what an item gives. */
export type ShopPage =
  | "home"
  | "avatarDecoration"
  | "profileSticker"
  | "profileEffect"
  | "nameplate"
  | "community"
  | "plans"
  | "bundles"
  | "collection"
  | "creations";

export const SHOP_TABS: { id: ShopPage; label: string; icon: LucideIcon }[] = [
  { id: "home", label: "Shop", icon: Sparkles },
  { id: "avatarDecoration", label: "Decorations", icon: UserRound },
  { id: "profileSticker", label: "Stickers", icon: Stamp },
  { id: "profileEffect", label: "Effects", icon: Wand2 },
  { id: "nameplate", label: "Nameplates", icon: ImageIcon },
  { id: "community", label: "Community", icon: Rocket },
  { id: "plans", label: "Crystal", icon: Crown },
  { id: "bundles", label: "Bundles", icon: Package },
];

/** The kind a card is mostly about: a bundle's first piece, otherwise its only one. */
export function primaryKind(sku: Pick<ShopSku, "grants">): GrantKind {
  return sku.grants[0]?.kind ?? "plan";
}

/** Which page an item lives on. */
export function pageOf(sku: ShopSku): ShopPage {
  if (sku.type === "bundle") return "bundles";
  if (sku.type === "subscription") return "plans";
  if (sku.type === "community") return "community";
  const kind = primaryKind(sku);
  return kind === "avatarDecoration" || kind === "profileSticker" || kind === "profileEffect" || kind === "nameplate"
    ? kind
    : "bundles";
}

/** Per-page copy for the banner at the top. */
export const PAGE_COPY: Record<Exclude<ShopPage, "home" | "collection" | "creations">, { title: string; blurb: string }> = {
  avatarDecoration: { title: "Avatar decorations", blurb: GRANT_KIND_META.avatarDecoration.blurb },
  profileSticker: { title: "Profile stickers", blurb: GRANT_KIND_META.profileSticker.blurb },
  profileEffect: { title: "Profile effects", blurb: GRANT_KIND_META.profileEffect.blurb },
  nameplate: { title: "Nameplates", blurb: GRANT_KIND_META.nameplate.blurb },
  community: { title: "Community items", blurb: "Themes and boosts for the communities you run." },
  plans: { title: "Crystal", blurb: "Memberships with discounts, better streaming and early access." },
  bundles: { title: "Bundles", blurb: "Several pieces together, for less." },
};
