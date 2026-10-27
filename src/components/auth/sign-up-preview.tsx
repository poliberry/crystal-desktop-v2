"use client";

import { motion } from "framer-motion";
import { Check, Hash, Mail, Users, Volume2 } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** Colours an avatar is given until there is a picture, taken from the name so the same name always looks the same. */
const TINTS = [
  "from-emerald-400 to-teal-500",
  "from-sky-400 to-blue-600",
  "from-violet-400 to-indigo-600",
  "from-pink-400 to-rose-500",
  "from-amber-400 to-orange-500",
];
const tintFor = (text: string) => TINTS[[...text].reduce((n, c) => n + c.charCodeAt(0), 0) % TINTS.length]!;

/**
 * The right-hand side of making an account: a miniature of how you'll look in Crystal, drawn from
 * what has been typed so far — the same idea as the community wizard's preview, which redraws the
 * community as you name it. Nothing here is saved; it is the form, shown back.
 */
export function SignUpPreview({ name, username, step }: { name: string; username: string; step: string }) {
  const shownName = name.trim() || "Your name";
  const shownHandle = username.trim() || "username";
  const focus = step === "profile" ? "profile" : step === "code" ? "email" : "done";

  return (
    <div className="relative w-full max-w-lg">
      {/* A soft halo that follows the avatar's colour. */}
      <motion.div
        aria-hidden
        className={cn("absolute -inset-10 rounded-full bg-gradient-to-br opacity-25 blur-3xl", tintFor(shownName))}
        animate={{ scale: focus === "profile" ? 1.05 : 0.95 }}
        transition={{ type: "spring", stiffness: 120, damping: 20 }}
      />
      <div className="relative overflow-hidden rounded-2xl border border-foreground/10 bg-background/70 shadow-2xl backdrop-blur-xl">
        {/* The window's chrome, the way it is in the app. */}
        <div className="flex items-center gap-1.5 border-b border-foreground/10 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
        </div>
        <div className="grid grid-cols-[11rem_1fr]">
          <div className="space-y-1 border-r border-foreground/10 p-3 text-xs text-muted-foreground">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider">Channels</p>
            {["general", "clips", "off-topic"].map((c, i) => (
              <div key={c} className={cn("flex items-center gap-1.5 rounded-md px-2 py-1.5", i === 0 && "bg-foreground/10 text-foreground")}>
                <Hash className="size-3.5" />
                {c}
              </div>
            ))}
            <div className="flex items-center gap-1.5 rounded-md px-2 py-1.5">
              <Volume2 className="size-3.5" />
              Lounge
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-foreground/5 p-2">
              <Avatar className="size-7">
                <AvatarFallback className={cn("bg-gradient-to-br text-[11px] font-semibold text-white", tintFor(shownName))}>
                  {shownName.slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-[11px] font-semibold text-foreground">{shownName}</p>
                <p className="truncate text-[10px]">@{shownHandle}</p>
              </div>
            </div>
          </div>

          <div className="space-y-3 p-4">
            <Message name={shownName} text="Hey everyone, I just got here!" tint={tintFor(shownName)} highlight={focus === "profile"} />
            <Message name="Crystal" text={`Welcome, ${shownName}. Pick a server or start one of your own.`} tint="from-teal-400 to-emerald-500" />
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-foreground/15 p-2.5 text-[11px] text-muted-foreground">
              {focus === "email" ? <Mail className="size-3.5" /> : <Users className="size-3.5" />}
              {focus === "email" ? "Confirming your email…" : "Your friends and servers will show up here"}
            </div>
          </div>
        </div>

        {focus === "done" && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 border-t border-foreground/10 bg-primary/10 px-4 py-2.5 text-xs">
            <Check className="size-3.5 text-primary" />
            Almost there. Choose a password and you're in.
          </motion.div>
        )}
      </div>
    </div>
  );
}

function Message({ name, text, tint, highlight }: { name: string; text: string; tint: string; highlight?: boolean }) {
  return (
    <motion.div layout className={cn("flex gap-2.5 rounded-lg p-2 transition-colors", highlight && "bg-primary/10")}>
      <Avatar className="mt-0.5 size-8 shrink-0">
        <AvatarFallback className={cn("bg-gradient-to-br text-xs font-semibold text-white", tint)}>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 text-xs">
        <p className="font-semibold">{name}</p>
        <p className="text-muted-foreground">{text}</p>
      </div>
    </motion.div>
  );
}
