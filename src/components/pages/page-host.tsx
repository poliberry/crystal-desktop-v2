"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";

import { usePage, type AppPage } from "@/components/pages/page-context";

const loading = (label: string) => () => (
  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
    {label}
  </div>
);

const SettingsShell = dynamic(
  () => import("@/components/settings/settings-shell").then((m) => m.SettingsShell),
  { loading: loading("Loading settings…") },
);
const ProfileEditor = dynamic(
  () => import("@/components/profile/profile-editor").then((m) => m.ProfileEditor),
  { loading: loading("Loading profile editor…") },
);
const CreateCommunityPage = dynamic(
  () =>
    import("@/components/community/create-community-page").then((m) => m.CreateCommunityPage),
  { loading: loading("Loading…") },
);
const CommunitySettingsPage = dynamic(
  () =>
    import("@/components/community/community-settings-page").then((m) => m.CommunitySettingsPage),
  { loading: loading("Loading community settings…") },
);
const MarketplacePage = dynamic(
  () => import("@/components/marketplace/marketplace-page").then((m) => m.MarketplacePage),
  { loading: loading("Loading Marketplace…") },
);

/**
 * Draws the open page in the main content area.
 *
 * Owns the one thing every page needs and none of them should each reinvent:
 * Escape to leave — except when something inside the page (a menu, a dialog, a
 * popover) is open, in which case Escape belongs to that, the same as it would
 * on any other screen. The other way out is the back button the sidebar shows
 * while a page is open; the page itself has no bar, so its title is the page's
 * own to draw.
 */
export function PageHost({ page }: { page: AppPage }) {
  const { closePage } = usePage();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        document.querySelector(
          '[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]',
        )
      ) {
        return;
      }
      closePage();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePage]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col border-t bg-background">
      {/* The page's own box: whatever is inside is clipped to it, or scrolls
          (the profile editor, which has fixed-width panes), and never spills
          into the rest of the window. */}
      <div
        className={
          page.type === "profile-editor"
            ? "min-h-0 min-w-0 flex-1 overflow-auto"
            : "min-h-0 min-w-0 flex-1 overflow-hidden"
        }
      >
        {page.type === "settings" && <SettingsShell onRequestClose={closePage} />}
        {page.type === "profile-editor" && <ProfileEditor onRequestClose={closePage} />}
        {page.type === "create-community" && <CreateCommunityPage />}
        {page.type === "marketplace" && <MarketplacePage onClose={closePage} />}
        {page.type === "community-settings" && (
          <CommunitySettingsPage communityId={page.communityId} onClose={closePage} />
        )}
      </div>
    </div>
  );
}
