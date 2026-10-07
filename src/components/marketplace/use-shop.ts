"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ShopSku } from "@/components/marketplace/sku-kinds";

/** The most a plan can take off a cosmetic — mirrors the cap in `store.prepareOrder`,
 * which is what actually decides the price. This only decides what is *shown*. */
const MAX_DISCOUNT_BPS = 5000;

/**
 * Everything the shop pages share: the catalogue, what the viewer already owns
 * and what their plan takes off.
 */
export function useShop() {
  const skus = useQuery(api.catalog.list, {}) as ShopSku[] | undefined;
  const entitlements = useQuery(api.marketplace.myEntitlements);
  const plan = useQuery(api.marketplace.myPlan);

  const ownedSkuIds = useMemo(() => new Set((entitlements ?? []).map((e) => e.skuId)), [entitlements]);
  const discountBps = Math.min(MAX_DISCOUNT_BPS, Math.max(0, plan?.cosmeticDiscountBps ?? 0));

  return {
    loading: skus === undefined,
    skus: skus ?? [],
    entitlements: entitlements ?? [],
    ownedSkuIds,
    plan,
    discountBps,
    owns: (id: Id<"skus">) => ownedSkuIds.has(id),
  };
}

/** What a viewer pays for an item, as the server will compute it: plans take a
 * share off cosmetics and community items, not off subscriptions or bundles. */
export function priceFor(sku: Pick<ShopSku, "priceCents" | "type">, discountBps: number): number {
  if (sku.type !== "cosmetic" && sku.type !== "community") return sku.priceCents;
  return Math.max(0, Math.floor((sku.priceCents * (10_000 - discountBps)) / 10_000));
}
