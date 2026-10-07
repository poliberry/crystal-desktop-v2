"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Library, Palette, Search, X } from "lucide-react";

import { CollectionView } from "@/components/marketplace/collection-view";
import { CreationsView } from "@/components/marketplace/creations-view";
import { SHOP_TABS, type ShopPage, type ShopSku } from "@/components/marketplace/sku-kinds";
import { SkuDialog } from "@/components/marketplace/sku-dialog";
import { SearchResults, ShopCategory, ShopHome } from "@/components/marketplace/shop-views";
import { useShop } from "@/components/marketplace/use-shop";
import { PageSidebar } from "@/components/pages/page-sidebar";
import { SETTINGS_NAV_BUTTON } from "@/components/settings/settings-ui";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { onPageSection, takePageSection } from "@/lib/page-intent";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

/** The shop's menu, in the unified sidebar: what is sold, then what is yours. */
const NAV: { label: string; items: { id: ShopPage; label: string; icon: LucideIcon }[] }[] = [
  { label: "Shop", items: SHOP_TABS },
  {
    label: "Yours",
    items: [
      { id: "collection", label: "My collection", icon: Library },
      { id: "creations", label: "My creations", icon: Palette },
    ],
  },
];

const PAGES = new Set<string>(NAV.flatMap((g) => g.items.map((i) => i.id)));
const asPage = (value: string | undefined): ShopPage => (value && PAGES.has(value) ? (value as ShopPage) : "home");

/**
 * The shop — laid out the way Discord's is: a front page with a banner and rows
 * of things to look at, a page per kind of item, and your own collection and
 * creations. The pages are in the unified sidebar, like Settings'.
 *
 * Everything is shown on *you*: a decoration around your avatar, a sticker on a
 * card with your name on it. Opening an item opens it in a dialog in which it
 * is also bought, so nothing about shopping takes you away from the page.
 */
export function MarketplacePage({ onClose: _onClose }: { onClose: () => void }) {
  const shop = useShop();
  const [page, setPage] = useState<ShopPage>(() => asPage(takePageSection("marketplace")));
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<ShopSku | null>(null);

  // Someone asked for a particular page while the shop was already open.
  useEffect(() => onPageSection("marketplace", (section) => setPage(asPage(section))), []);

  const searching = search.trim().length > 0;
  const view = { skus: shop.skus, ownedIds: shop.ownedSkuIds as Set<string>, discountBps: shop.discountBps, onOpen: setOpen };
  const go = (next: ShopPage) => {
    setSearch("");
    setPage(next);
  };

  // The dialog shows the item as it is *now*: a purchase changes what is owned.
  const current = open ? (shop.skus.find((s) => s.id === open.id) ?? open) : null;

  return (
    <div className="settings-surface flex h-full min-h-0 flex-col">
      {/* The pages are the unified sidebar's, not a bar of their own: see
          `PageSidebar`. */}
      <PageSidebar>
        <SidebarHeader className="pt-1">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the shop"
              className="h-8 pr-7 pl-8"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setSearch("")}
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
        </SidebarHeader>
        <SidebarContent>
          {NAV.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => (
                    <SidebarMenuItem key={item.id} onClick={() => go(item.id)}>
                      <SidebarMenuButton
                        isActive={!searching && page === item.id}
                        className={cn("flex flex-row items-center gap-2", SETTINGS_NAV_BUTTON)}
                      >
                        <item.icon />
                        {item.label}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>
      </PageSidebar>

      <ScrollArea className="min-h-0 flex-1 [&>[data-slot=scroll-area-viewport]>div]:!block">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={searching ? "search" : page}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="mx-auto w-full max-w-6xl px-8 py-8"
          >
            {searching ? (
              <SearchResults query={search} {...view} />
            ) : page === "home" ? (
              <ShopHome {...view} go={go} />
            ) : page === "collection" ? (
              <CollectionView />
            ) : page === "creations" ? (
              <CreationsView />
            ) : (
              <ShopCategory page={page} {...view} />
            )}
          </motion.div>
        </AnimatePresence>
      </ScrollArea>

      <SkuDialog sku={current} onClose={() => setOpen(null)} />
    </div>
  );
}
