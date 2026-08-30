"use client";

import { CallProvider } from "@/components/call/call-provider";
import { HomeLayout } from "@/components/home/home-layout";
import { NavigationProvider } from "@/components/home/navigation-context";
import { InviteDeepLinkHandler } from "@/components/invite-deeplink-handler";
import { TabsProvider } from "@/components/home/tabs-context";
import { SessionBootstrap } from "@/components/session-bootstrap";
import { TopNav } from "@/components/top-nav";
import { WindowControls } from "@/components/window-controls";
import AuthFlow from "@/components/auth/auth-flow";
import { Show } from "@clerk/react";
import { Google_Sans_Flex } from "next/font/google";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BirthdayProvider } from "@/components/home/birthday-provider";

const googleSansFlex = Google_Sans_Flex({
  subsets: ["latin"],
});

const sayings = [
  "Lounge with friends",
  "Jam out to tunes",
  "Get deep into a study sesh",
  "Debate about pineapple on pizza",
  "Share memes with the gang",
  "Have heated discussions with mates",
  "Get your community engaged",
  "Come up with the next big thing",
  "Chat, play and create",
];

export default function HomePage() {
  const [text, setText] = useState("");

  useEffect(() => {
    let cancelled = false;

    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    const getRandomSaying = (previous: string) => {
      const options = sayings.filter((saying) => saying !== previous);
      return options[Math.floor(Math.random() * options.length)];
    };

    const animate = async () => {
      let previous = "";

      while (!cancelled) {
        const saying = getRandomSaying(previous);
        previous = saying;

        // Type
        for (let i = 0; i <= saying.length; i++) {
          if (cancelled) return;

          setText(saying.slice(0, i));
          await sleep(50);
        }

        // Keep it on screen
        await sleep(3000);

        // Delete
        for (let i = saying.length; i >= 0; i--) {
          if (cancelled) return;

          setText(saying.slice(0, i));
          await sleep(30);
        }
      }
    };

    animate();

    return () => {
      cancelled = true;
    };
  }, []);

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
            <div className="h-full w-full animated-gradient">
              <img
                src="/login-overlay.png"
                alt="overlay"
                className="absolute bottom-0 w-full object-center mix-blend-color-dodge opacity-50"
              />
              <div className="absolute top-9 left-2 w-[60%] h-[90%] flex flex-col justify-between">
                <img src="/logo.svg" alt="Crystal" className="w-24" />
                <div className="flex flex-col gap-1">
                  <h1
                    className={`${googleSansFlex.className} font-black tracking-[-10%] text-4xl`}
                  >
                    THE NEW WAY TO
                  </h1>
                  <h1
                    className={`${googleSansFlex.className} font-black tracking-[-10%] uppercase text-6xl bg-white text-black py-3 px-5 text-wrap w-fit rounded-3xl`}
                  >
                    {text}
                    <motion.span
                      animate={{ opacity: [1, 0] }}
                      transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        repeatType: "reverse",
                      }}
                      className="font-normal px-1"
                    >
                      |
                    </motion.span>
                  </h1>
                </div>
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
                <div className="flex h-full flex-col">
                  <TopNav />
                  <div className="min-h-0 flex-1">
                    <HomeLayout />
                  </div>
                </div>
              </BirthdayProvider>
            </NavigationProvider>
          </TabsProvider>
        </CallProvider>
      </Show>
    </main>
  );
}
