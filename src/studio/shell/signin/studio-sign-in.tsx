"use client";

import { motion } from "framer-motion";
import { Google_Sans_Flex } from "next/font/google";
import dynamic from "next/dynamic";

import AuthFlow from "@/components/auth/auth-flow";
import { Card } from "@/components/ui/card";
import { SignInBackdrop } from "@/components/auth/sign-in-backdrop";
import { WindowControls } from "@/components/window-controls";
import { useTrafficLightsInset } from "@/hooks/use-window-controls";

const googleSansFlex = Google_Sans_Flex({ subsets: ["latin"] });

/** three.js is large and only this screen wants it, so it loads after the page, on the client. */
const StudioScene = dynamic(() => import("./studio-scene"), { ssr: false });

const WORDS = ["Create,", "Build,", "Earn"] as const;

/**
 * What Studio shows before you sign in: a marketing page with the sign-in as a card on top of it, in the same style as
 * Crystal's. The headline sits top left, the 3D scene floats along the bottom, and the whole window is draggable
 * except the card and the window buttons.
 */
export function StudioSignIn() {
  const inset = useTrafficLightsInset();
  return (
    <main className="dark relative h-full w-full overflow-hidden bg-[#06080c] text-foreground">
      <SignInBackdrop />
      <StudioScene className="pointer-events-none absolute inset-0 z-[1]" />

      <header
        style={{ WebkitAppRegion: "drag", paddingLeft: inset || undefined } as React.CSSProperties}
        className="absolute inset-x-0 top-0 z-20 flex h-[30px] items-stretch"
      >
        <div className="flex flex-1 items-center gap-2 pl-3 text-[12px] font-medium text-white/70">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/studio-icon.png" alt="" aria-hidden draggable={false} className="size-[18px] rounded-[5px]" />
          Crystal Studio
        </div>
        <WindowControls className="border-none" />
      </header>

      <div className="relative z-10 flex h-full w-full items-start justify-between gap-8 px-[6%] pt-[9vh] pb-8">
        <section className="relative isolate min-w-0 max-w-[640px] select-none" style={{ WebkitAppRegion: "drag" } as React.CSSProperties}>
          <Scrim className="-inset-x-12 -inset-y-10" />
          <h1 className={`${googleSansFlex.className} text-[clamp(2.6rem,6.4vw,5.6rem)] font-black leading-[0.98] tracking-[-0.045em]`}>
            {WORDS.map((word, i) => (
              <motion.span
                key={word}
                initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                transition={{ duration: 0.6, delay: 0.12 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
                className="block text-white"
              >
                {word}
              </motion.span>
            ))}
            <motion.span
              initial={{ opacity: 0, y: 24, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.6, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
              className="block"
            >
              <span className="text-white">on </span>
              <span className="bg-gradient-to-r from-emerald-300 via-teal-300 to-blue-400 bg-clip-text text-transparent">Crystal.</span>
            </motion.span>
          </h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="mt-5 max-w-md text-[15px] leading-relaxed text-white/60"
          >
            Design cosmetics, write bots and extensions, and sell what you make in the Marketplace.
          </motion.p>
        </section>

        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="relative isolate mt-[2vh] w-[380px] max-w-full shrink-0"
        >
          <Scrim className="-inset-8" />
          <Card className="gap-5 border-white/10 bg-card/80 p-7 shadow-[0_24px_80px_-12px_rgba(0,0,0,0.7)] backdrop-blur-xl">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/studio-icon.png" alt="" aria-hidden draggable={false} className="size-10 rounded-[10px]" />
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-tight">Sign in to Studio</h2>
                <p className="text-sm text-muted-foreground">Use your Crystal account.</p>
              </div>
            </div>
            <AuthFlow bare returnTo="/studio/" />
            <p className="text-xs leading-relaxed text-muted-foreground">New here? Enter your email and a password and we&apos;ll make you an account.</p>
          </Card>
        </motion.div>
      </div>
    </main>
  );
}

/**
 * A soft, semi-transparent black pad behind what has to be read, so the scene's bright shapes passing underneath don't
 * cut across the words. Blurred, so it has no edge of its own: it reads as the scene dimming, not as a box.
 */
function Scrim({ className }: { className: string }) {
  return <div aria-hidden className={`pointer-events-none absolute -z-10 rounded-[48px] bg-black/60 blur-2xl ${className}`} />;
}
