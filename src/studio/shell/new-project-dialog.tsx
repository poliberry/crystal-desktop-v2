"use client";

import { Armchair, Bot, Frame, ImageIcon, Package, Palette, Puzzle, Sparkles, Stamp, UserRound, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getDesktopAPI } from "@/lib/desktop";
import { KIND_LABEL, isCodeKind, type ProjectKind } from "@/studio/model/types";
import { cn } from "@/lib/utils";

export const KIND_ICON: Record<ProjectKind, LucideIcon> = {
  decoration: UserRound,
  sticker: Stamp,
  nameplate: ImageIcon,
  effect: Sparkles,
  scene: Armchair,
  themePack: Palette,
  pack: Package,
  extension: Puzzle,
  bot: Bot,
};

const BLURB: Record<ProjectKind, string> = {
  decoration: "Rings, crowns and ornaments worn around an avatar.",
  sticker: "Artwork stuck onto a profile card.",
  nameplate: "A banner behind a name in lists.",
  effect: "An animated flourish over a profile.",
  scene: "A room for lounge channels, with a screen, seats and props.",
  themePack: "A font, colours, sounds and icons for the whole app.",
  pack: "Several of your cosmetics, sold together.",
  extension: "A panel inside Crystal, written in TypeScript and run in a sandbox.",
  bot: "A TypeScript app on your own server that joins communities and responds to them.",
};

const GROUPS: { title: string; kinds: ProjectKind[] }[] = [
  { title: "Cosmetics", kinds: ["decoration", "sticker", "nameplate", "effect"] },
  { title: "Rooms", kinds: ["scene"] },
  { title: "Packs", kinds: ["themePack", "pack"] },
  { title: "Code", kinds: ["extension", "bot"] },
];

export function NewProjectDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate: (kind: ProjectKind, name: string) => Promise<void> }) {
  const [kind, setKind] = useState<ProjectKind>("decoration");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // Code projects are folders of files, which only the desktop app can keep.
  const canCode = !!getDesktopAPI()?.studio?.fs;

  const go = async () => {
    setBusy(true);
    try {
      await onCreate(kind, name.trim() || `Untitled ${KIND_LABEL[kind].toLowerCase()}`);
      setName("");
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>Projects live on this device until you submit them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-2">
              <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {g.kinds.map((k) => {
                  const Icon = KIND_ICON[k] ?? Frame;
                  const unavailable = isCodeKind(k) && !canCode;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={unavailable}
                      title={unavailable ? "Extensions and bots are made in the Crystal desktop app" : undefined}
                      onClick={() => setKind(k)}
                      aria-pressed={kind === k}
                      className={cn("flex items-start gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50", kind === k ? "border-primary bg-primary/5" : "border-border hover:border-foreground/30")}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{KIND_LABEL[k]}</span>
                        <span className="block text-xs text-muted-foreground">{BLURB[k]}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <Input placeholder={`Name — e.g. Untitled ${KIND_LABEL[kind].toLowerCase()}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void go()} />
        </div>
        <DialogFooter>
          <Button disabled={busy} onClick={() => void go()}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
