"use client";

import { CallProvider } from "@/components/call/call-provider";
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
import AuthFlow from "@/components/auth/auth-flow";
import { SignInBackdrop } from "@/components/auth/sign-in-backdrop";
import dynamic from "next/dynamic";
import { Show } from "@clerk/react";
import { Google_Sans_Flex } from "next/font/google";
import { BirthdayProvider } from "@/components/home/birthday-provider";
import { RightSidebarHost, RightSidebarProvider } from "@/components/sidebar/right-sidebar";
import { ResizableSidebarProvider } from "@/components/sidebar/resizable-sidebar";
import { UnifiedSidebar } from "@/components/sidebar/unified-sidebar";
import { Sidebar, SidebarInset } from "@/components/ui/sidebar";

/** three.js is large and only the signed-out screen wants it. */
const LoginScene = dynamic(() => import("@/components/auth/login-scene"), { ssr: false });

const googleSansFlex = Google_Sans_Flex({
  subsets: ["latin"],
});

export default function HomePage() {
  return (
    <main className="h-full dark">
      <Show when="signed-out">
        <div className="flex flex-col h-full w-full items-center justify-center">
          <header
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            className="fixed top-0 left-0 w-full flex h-10 shrink-0 items-center justify-end gap-2 bg-transparent pl-3 z-[99]"
          >
            <WindowControls className="ml-1 z-[999] pointer-events-auto border-none" />
          </header>
          <div className="flex flex-row w-full h-full">
            <div className="relative h-full w-full overflow-hidden bg-[#06080c]">
              <SignInBackdrop />
              {/* Drawn once, with nothing moving, in the lower part of the panel under the headline. */}
              <LoginScene className="pointer-events-none absolute bottom-0 left-0 h-[55%] w-full" />
              <div className="absolute top-9 left-2 z-10 flex w-[60%] flex-col gap-7 pl-6">
                <img src="/logo.svg" alt="Crystal" className="w-24" />
                <h1
                  className={`${googleSansFlex.className} text-[clamp(2.4rem,min(5.4vw,8.6vh),5rem)] font-black leading-[0.98] tracking-[-0.045em] text-white`}
                >
                  <span className="block">Chat,</span>
                  <span className="block">Play,</span>
                  <span className="block bg-gradient-to-r from-emerald-300 via-teal-300 to-blue-400 bg-clip-text text-transparent">Create.</span>
                </h1>
              </div>
            </div>
            <div className="h-full w-1/2 bg-background z-[50]">
              <AuthFlow />
            </div>
            {/* <SignIn forceRedirectUrl="crystal://auth/callback" fallbackRedirectUrl="crystal://auth/callback" oauthFlow="popup" /> */}
          </div>
        </div>
      </Show>

      <Show when="signed-in">
        <SessionBootstrap />
        <CallProvider>
          <TabsProvider>
            <NavigationProvider>
              <BirthdayProvider>
                {/* Inside NavigationProvider: accepting an invite jumps
                    straight into the server it was for. */}
                <InviteDeepLinkHandler />
                <InstallDeepLinkHandler />
                <VerifyMembershipHost />
                {/* Both halves of a page — its menu in the sidebar, its
                    content beside it — need to find each other. */}
                <PageSidebarProvider>
                  <RightSidebarProvider>
                    {/* Wider than the stock 16rem by default, and the user's to
                        change: the Priority card, the community previews and the
                        user card's controls all want the room. */}
                    <ResizableSidebarProvider className="h-full min-h-0">
                      <Sidebar variant="floating">
                        <UnifiedSidebar />
                      </Sidebar>
                      {/* `min-w-0` / `overflow-hidden`: a flex child won't shrink
                          below its content by default, so a wide page (the profile
                          editor is three panes) would widen the whole app instead
                          of fitting beside the sidebar. */}
                      <SidebarInset className="min-w-0 overflow-hidden">
                        <div className="flex h-full min-w-0 flex-col">
                          <TopNav />
                          <div className="min-h-0 flex-1">
                            <HomeLayout />
                          </div>
                        </div>
                      </SidebarInset>
                      {/* The other full-height column: what the view in front
                          puts at the right, so the top bar narrows for it too. */}
                      <RightSidebarHost />
                    </ResizableSidebarProvider>
                  </RightSidebarProvider>
                </PageSidebarProvider>
              </BirthdayProvider>
            </NavigationProvider>
          </TabsProvider>
        </CallProvider>
      </Show>
    </main>
  );
}
