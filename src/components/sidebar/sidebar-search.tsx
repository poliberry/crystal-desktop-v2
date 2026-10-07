"use client";

import { Search } from "lucide-react";

import { GlobalSearch } from "@/components/home/global-search";

/**
 * The sidebar's search field.
 *
 * A button dressed as an input rather than a real input: the search itself is
 * the quick-switcher dialog the top bar already opens, so there is exactly one
 * search with one set of results, and this is just a bigger door to it.
 */
export function SidebarSearch() {
  return (
    <GlobalSearch
      trigger={(open) => (
        <button
          type="button"
          onClick={open}
          aria-label="Search"
          className="flex h-9 w-full items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
        >
          <Search className="size-4 shrink-0" />
          <span className="truncate">Search</span>
        </button>
      )}
    />
  );
}
