"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Where a page puts its navigation: in the unified sidebar, not in a column of
 * its own beside the content.
 *
 * Settings, the profile editor and a community's settings each used to draw a
 * sidebar inside the page, next to the app's real one — two sidebars on screen,
 * one of them the same width as the other. They now render their menu through
 * {@link PageSidebar}, which portals it into the slot the unified sidebar
 * leaves for it while a page is open. A portal rather than a registry of menu
 * data because the menus aren't data: the profile editor's rail is its editing
 * state (which profile, which dialog is open), and keeping the rail inside the
 * page keeps that state in one component instead of lifting it somewhere the
 * sidebar can reach.
 */
interface PageSidebarContextValue {
  slot: HTMLElement | null;
  setSlot: (element: HTMLElement | null) => void;
}

const PageSidebarContext = createContext<PageSidebarContextValue | null>(null);

/** Above both the unified sidebar and the page, which are siblings. */
export function PageSidebarProvider({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ slot, setSlot }), [slot]);
  return <PageSidebarContext.Provider value={value}>{children}</PageSidebarContext.Provider>;
}

/** The unified sidebar's end of it: an empty box for the open page to fill. */
export function PageSidebarSlot({ className }: { className?: string }) {
  const ctx = useContext(PageSidebarContext);
  return <div ref={ctx?.setSlot} className={className} />;
}

const LEFTOVER_ATTRIBUTE = "data-page-sidebar-leftover";

/**
 * Removes the previous page's still picture the moment a page puts its own
 * menu in the slot.
 *
 * Needed because one page replacing another isn't always one commit: pages are
 * loaded on demand, so the new one can arrive well after the old one has gone,
 * and by then the slot is empty and the old menu has been put back. Without
 * this the two menus end up in the slot together.
 */
function ClearLeftover({ slot }: { slot: HTMLElement }) {
  useLayoutEffect(() => {
    slot.querySelectorAll(`:scope > [${LEFTOVER_ATTRIBUTE}]`).forEach((el) => el.remove());
  }, [slot]);
  return null;
}

/**
 * Leaves the menu's markup behind in the slot when the page unmounts.
 *
 * The sidebar slides the menu away when the page closes, but the menu is the
 * page's — it is gone from the slot in the same commit that removes the page,
 * so what slid away would be an empty box. This is the first thing in the
 * portal, so its cleanup runs while the rest is still attached: it copies the
 * markup out and puts it back once React has finished emptying the slot. A
 * still picture, which is all a 200ms exit needs. If something else has filled
 * the slot by then (one page replacing another) it does nothing, and if the
 * replacement arrives later, it clears this when it does.
 */
function LeaveBehind({ slot }: { slot: HTMLElement }) {
  useLayoutEffect(
    () => () => {
      const html = slot.innerHTML;
      queueMicrotask(() => {
        if (!slot.isConnected || slot.childElementCount !== 0) return;
        // In a marked wrapper, so the next page can tell it from its own menu
        // and clear it — see `ClearLeftover`. `contents`, so the markup lays out
        // as direct children of the slot, as it did inside the portal.
        const leftover = document.createElement("div");
        leftover.setAttribute(LEFTOVER_ATTRIBUTE, "");
        leftover.style.display = "contents";
        leftover.innerHTML = html;
        slot.appendChild(leftover);
      });
    },
    [slot],
  );
  return null;
}

/** A page's end of it: whatever is inside appears in the sidebar for as long as
 * the page is mounted. Nothing at all where there is no slot (a page shown
 * somewhere that has no unified sidebar). */
export function PageSidebar({ children }: { children: React.ReactNode }) {
  const ctx = useContext(PageSidebarContext);
  if (!ctx?.slot) return null;
  return createPortal(
    <>
      <ClearLeftover slot={ctx.slot} />
      <LeaveBehind slot={ctx.slot} />
      {children}
    </>,
    ctx.slot,
  );
}
