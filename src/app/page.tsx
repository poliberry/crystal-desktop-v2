"use client";

import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";

import { HomeLayout } from "@/components/home/home-layout";
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
        <div className="flex h-full flex-col">
          <TopNav />
          <div className="min-h-0 flex-1">
            <HomeLayout />
          </div>
        </div>
      </SignedIn>
    </main>
  );
}
