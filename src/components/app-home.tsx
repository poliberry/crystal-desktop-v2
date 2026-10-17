"use client";

import { CallProvider } from "@/components/call/call-provider";
import { DeepLinkHandler } from "@/components/deeplink-handler";
import { MobileBottomInset, MobileCallBar, MobileContentHeader, MobileSheetHeader, MobileShellProvider, pageTitle, SHEET_PAGES, useMenuTap, useMobileShell } from "@/components/mobile/mobile-shell";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { PageHost } from "@/components/pages/page-host";
import { useTabs } from "@/components/home/tabs-context";
import { usePage } from "@/components/pages/page-context";
import { PageSidebarSlot } from "@/components/pages/page-sidebar";
import { cn } from "@/lib/utils";
import { HomeLayout } from "@/components/home/home-layout";
import { NavigationProvider } from "@/components/home/navigation-context";
import { PageSidebarProvider } from "@/components/pages/page-sidebar";
import { InstallDeepLinkHandler } from "@/components/install-deeplink-handler";
import { InviteDeepLinkHandler } from "@/components/invite-deeplink-handler";
import { VerifyMembershipHost } from "@/components/community/verify-membership-host";
import { TabsProvider } from "@/components/home/tabs-context";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { TopNav } from "@/components/top-nav";
import { WindowControls } from "@/components/window-controls";
import { WindowControlsDock } from "@/components/window-controls-dock";
import { Show } from "@/components/auth/auth-state";
import { SecurityOpener } from "@/components/auth/security-opener";
import { motion } from "framer-motion";
import { Google_Sans_Flex } from "next/font/google";
import { useCallback, useEffect, useState } from "react";
import { BirthdayProvider } from "@/components/home/birthday-provider";
import { RightSidebarHost, RightSidebarProvider } from "@/components/sidebar/right-sidebar";
import { ResizableSidebarProvider } from "@/components/sidebar/resizable-sidebar";
import { UnifiedSidebar } from "@/components/sidebar/unified-sidebar";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, SidebarInset } from "@/components/ui/sidebar";
import dynamic from "next/dynamic";
import { useIsMobile } from "@/hooks/use-mobile";
import { registerServiceWorker } from "@/lib/pwa";
import { MobileYouBar } from "@/components/sidebar/dock";
import { isElectron } from "@/lib/desktop";

const AuthFlow = dynamic(() => import("@/components/auth/auth-flow"));
const SignInBackdrop = dynamic(() => import("@/components/auth/sign-in-backdrop").then((mod) => mod.SignInBackdrop));
const googleSansFlex = Google_Sans_Flex({ subsets: ["latin"] });

/**
 * The signed-in layout. On a desktop-sized window: sidebar, content and the right-hand panel side by side,
 * as always. On a phone: one screen at a time (the chats list or what's open), with a tab bar; see
 * components/mobile/mobile-shell.tsx.
 */
function SignedInShell() {
  const { mobile, view, showList } = useMobileShell();
  if (!mobile) {
    return (
      <ResizableSidebarProvider className="h-full min-h-0">
        <Sidebar variant="floating"><UnifiedSidebar /></Sidebar>
        <SidebarInset className="min-w-0 overflow-hidden">
          <div className="flex h-full min-w-0 flex-col"><TopNav /><div className="min-h-0 flex-1"><HomeLayout /></div></div>
        </SidebarInset>
        <RightSidebarHost />
      </ResizableSidebarProvider>
    );
  }
  return (
    // Fixed to the screen rather than `h-dvh`: in an installed iPhone app with the translucent status bar,
    // dvh comes out a status bar short, which left a band of empty space under everything.
    <ResizableSidebarProvider className="fixed inset-0 min-h-0 flex-col pt-[env(safe-area-inset-top)]">
      {/* The list screen: the unified sidebar (chats, communities, DMs), the call bar and the You bar. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <Sidebar collapsible="none" className="h-full w-full bg-background"><UnifiedSidebar /></Sidebar>
      </div>
      <MobileCallBar />
      <MobileYouBar />
      {/* A conversation or channel slides in over it from the right, full screen. It stays mounted while
          closed (forceMount, moved off-screen), so going back doesn't end a call or reload a chat, and it's
          non-modal, so menus and dialogs opened from inside it still work. */}
      <Sheet open={view === "content"} onOpenChange={(open) => !open && showList()} modal={false}>
        <SheetContent
          forceMount
          side="right"
          showCloseButton={false}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="w-full max-w-none gap-0 border-0 p-0 pt-[env(safe-area-inset-top)] transition-transform duration-300 ease-out will-change-transform data-[state=closed]:pointer-events-none data-[state=closed]:translate-x-full data-[state=closed]:animate-none data-[state=open]:translate-x-0 data-[state=open]:animate-none sm:max-w-none"
        >
          <SheetTitle className="sr-only">Crystal</SheetTitle>
          <MobileContentHeader />
          <div className="min-h-0 flex-1"><HomeLayout /></div>
          <MobileBottomInset />
        </SheetContent>
      </Sheet>
      <MobilePageDrawer />
      <RightSidebarHost />
    </ResizableSidebarProvider>
  );
}

/**
 * Settings and the other menu pages on a phone: a bottom drawer over the chats. The page's menu first;
 * picking an entry shows that section in the same drawer, with Back to the menu. Drag it down, tap the
 * dimmed chats or press Close to leave.
 */
function MobilePageDrawer() {
  const { page, closePage } = usePage();
  const { activeTab } = useTabs();
  const open = !!page && SHEET_PAGES.has(page.type);
  // What the drawer shows outlives the page by its closing animation, so it slides away with its
  // contents rather than emptying first.
  const [shown, setShown] = useState(page);
  if (open && page !== shown) setShown(page);
  const [level, setLevel] = useState<"menu" | "section">("menu");
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = open ? `${page!.type}:${activeTab.id}` : null;
  if (key && key !== openedFor) {
    setOpenedFor(key);
    setLevel("menu");
  }
  const menuTapRef = useMenuTap(useCallback(() => setLevel("section"), []));
  const current = open ? page : shown;
  const showing = !!current && SHEET_PAGES.has(current.type);

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => !next && closePage()}
      onAnimationEnd={(isOpen) => {
        if (!isOpen) {
          setShown(null);
          setOpenedFor(null);
        }
      }}
      repositionInputs={false}
    >
      <DrawerContent className="h-[calc(100%-env(safe-area-inset-top)-0.5rem)] max-h-none rounded-t-2xl border-border/60 data-[vaul-drawer-direction=bottom]:mt-0 data-[vaul-drawer-direction=bottom]:max-h-none">
        <DrawerTitle className="sr-only">{pageTitle(current?.type)}</DrawerTitle>
        <MobileSheetHeader
          title={pageTitle(current?.type)}
          onBack={level === "section" ? () => setLevel("menu") : undefined}
          onClose={closePage}
        />
        {/* The page's menu: the page portals it into this slot. */}
        <div ref={menuTapRef} className={cn("min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]", level === "menu" ? "flex" : "hidden")}>
          <PageSidebarSlot className="flex min-h-0 flex-1 flex-col" />
        </div>
        <div className={cn("min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)]", level === "section" ? "flex" : "hidden")}>
          {showing && <PageHost key={current!.type} page={current!} />}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Keeps the address bar honest: `/login` is the sign-in page and `/app` is the app. Both routes render
 * this same component, so without this, signing in on /login would show the app at /login. Swapped
 * with replaceState (no reload, no extra history entry), keeping the query and the hash route, so a
 * deep link opened while signed out still lands on its chat after signing in. Web only: the desktop
 * app always loads /app/.
 */
function AuthRoute({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    if (isElectron()) return;
    const path = window.location.pathname.replace(/\/+$/, "");
    const want = signedIn ? (path === "/login" ? "/app/" : null) : path === "/app" ? "/login/" : null;
    if (want) window.history.replaceState(window.history.state, "", want + window.location.search + window.location.hash);
  }, [signedIn]);
  return null;
}

export function AppHome() {
  const [wide, setWide] = useState(false);
  // On a phone the sign-in form has the whole screen; the artwork beside it is for wider windows.
  const phone = useIsMobile();
  // Signed in or not: installing the app from the sign-in screen needs the service worker already running.
  useEffect(() => {
    void registerServiceWorker();
  }, []);
  return (
    <main className="h-full dark">
      <Show when="signed-out">
        <AuthRoute signedIn={false} />
        <div className="flex h-full w-full flex-col items-center justify-center">
          <header style={{ WebkitAppRegion: "drag" } as React.CSSProperties} className="fixed left-0 top-0 z-[99] flex h-10 w-full shrink-0 items-center justify-end gap-2 bg-transparent pl-3">
            <WindowControls className="ml-1 z-[999] pointer-events-auto border-none" />
          </header>
          <div className="relative flex h-full w-full flex-row">
            <div className="relative h-full w-full overflow-hidden bg-[#06080c] max-md:hidden">
              <SignInBackdrop />
              <div className="absolute left-2 top-9 z-10 flex w-[60%] flex-col gap-7 pl-6">
                <img src="/logo.svg" alt="Crystal" className="w-24" />
                <h1 className={`${googleSansFlex.className} text-[clamp(2.4rem,min(5.4vw,8.6vh),5rem)] font-black leading-[0.98] tracking-[-0.045em] text-white`}>
                  <span className="block">Chat,</span><span className="block">Play,</span><span className="block bg-gradient-to-r from-emerald-300 via-teal-300 to-blue-400 bg-clip-text text-transparent">Create.</span>
                </h1>
              </div>
            </div>
            <motion.div layout animate={{ width: wide || phone ? "100%" : "50%" }} transition={{ type: "spring", stiffness: 260, damping: 32 }} className={`z-[50] h-full bg-background ${wide ? "absolute inset-0" : "relative"}`}>
              <div className="h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:contents"><AuthFlow onWideChange={setWide} /></div>
            </motion.div>
          </div>
        </div>
      </Show>
      <Show when="signed-in">
        <AuthRoute signedIn />
        <SessionBootstrap />
        <WindowControlsDock />
        <CallProvider>
          <TabsProvider>
            <NavigationProvider>
              <BirthdayProvider>
                <InviteDeepLinkHandler />
                <SecurityOpener />
                <InstallDeepLinkHandler />
                <VerifyMembershipHost />
                <DeepLinkHandler />
                <MobileShellProvider>
                  <PageSidebarProvider>
                    <RightSidebarProvider>
                      <SignedInShell />
                    </RightSidebarProvider>
                  </PageSidebarProvider>
                </MobileShellProvider>
              </BirthdayProvider>
            </NavigationProvider>
          </TabsProvider>
        </CallProvider>
      </Show>
    </main>
  );
}
