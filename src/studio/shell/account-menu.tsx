"use client";

import { SignOutButton, useUser } from "@clerk/react";
import { useQuery } from "convex/react";
import { ExternalLink, LogOut } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { openCrystal } from "@/studio/open-crystal";

/**
 * Where Clerk sends you after signing out. Its default is `/`, which is Crystal's own home and login: Studio has to name
 * itself, or logging out of Studio lands you on Crystal's sign-in instead of Studio's.
 */
const STUDIO_HOME = "/studio/";

/**
 * The account button at the right of Studio's title bar: who is signed in, a way to open Crystal itself, and to log out.
 *
 * Logging out leaves the projects alone (they are files on this computer, not part of the account) but closes the editors,
 * so with unsaved changes it asks first rather than throwing them away.
 */
export function AccountMenu({ hasUnsaved }: { hasUnsaved: () => boolean }) {
  const me = useQuery(api.users.getCurrentUser);
  const { user } = useUser();
  const [confirming, setConfirming] = useState(false);
  const name = me?.name ?? user?.fullName ?? user?.username ?? "Your account";
  const email = user?.primaryEmailAddress?.emailAddress;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Account"
            title={name}
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
            className="flex w-10 shrink-0 items-center justify-center outline-none hover:bg-white/5 focus-visible:bg-white/10 data-[state=open]:bg-white/10"
          >
            <Avatar className="size-5">
              <AvatarImage src={me?.imageUrl ?? user?.imageUrl} alt="" />
              <AvatarFallback className="text-[10px]">{name.slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
            <span className="truncate text-sm font-medium text-foreground">{name}</span>
            {email && <span className="truncate text-xs text-muted-foreground">{email}</span>}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openCrystal()}>
            <ExternalLink />
            Open Crystal
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              // With unsaved work, ask first; the menu is still closing, so the dialog opens after it.
              if (hasUnsaved()) {
                e.preventDefault();
                setConfirming(true);
              } else {
                document.getElementById("studio-sign-out")?.click();
              }
            }}
          >
            <LogOut />
            Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Clerk's own button does the signing out; this one is only ever clicked by the menu item above. */}
      <SignOutButton redirectUrl={STUDIO_HOME}>
        <button id="studio-sign-out" type="button" hidden aria-hidden tabIndex={-1} />
      </SignOutButton>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Log out with unsaved changes?</DialogTitle>
            <DialogDescription>Some of your projects have changes that aren&apos;t saved. Logging out closes them and the changes are lost. Save first (⌘S) to keep them.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <SignOutButton redirectUrl={STUDIO_HOME}>
              <Button variant="destructive">Log out anyway</Button>
            </SignOutButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
