"use client";

import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";

import { CallProvider } from "@/components/call/call-provider";
import { HomeLayout } from "@/components/home/home-layout";
import { NavigationProvider } from "@/components/home/navigation-context";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { TopNav } from "@/components/top-nav";

export default function HomePage() {
  return (
    <main className="h-full dark">
      <SignedOut>
        <div className="flex h-full items-center justify-center">
          <SignIn />
        </div>
      </SignedOut>

      <SignedIn>
        <SessionBootstrap />
        <CallProvider>
          <NavigationProvider>
            <div className="flex h-full flex-col">
              <TopNav />
              <div className="min-h-0 flex-1">
                <HomeLayout />
              </div>
            </div>
          </NavigationProvider>
        </CallProvider>
      </SignedIn>
    </main>
  );
}
