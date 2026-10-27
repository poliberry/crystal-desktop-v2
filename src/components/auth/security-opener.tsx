"use client";

import { useEffect } from "react";

import { OPEN_SECURITY_EVENT } from "@/components/auth/step-up-dialog";
import { E2eeOnboarding } from "@/components/auth/e2ee-onboarding";
import { CommandCenter } from "@/components/home/command-center";
import { useOpenSettings } from "@/components/pages/page-context";

/**
 * Signed-in hosts that must always be mounted inside the tabs and navigation (where Settings and the
 * places can be opened): opening Settings at Security when the step-up prompt's "turn it on" asks, the
 * encryption setup/unlock prompt, and the command palette with saved messages and their reminders.
 *
 * They hang off this one component, which the home page already mounts in the right spot, so adding
 * them didn't mean touching the page's own tree.
 */
export function SecurityOpener() {
  const openSettings = useOpenSettings();
  useEffect(() => {
    const open = () => openSettings("security");
    window.addEventListener(OPEN_SECURITY_EVENT, open);
    return () => window.removeEventListener(OPEN_SECURITY_EVENT, open);
  }, [openSettings]);
  return (
    <>
      <E2eeOnboarding />
      <CommandCenter />
    </>
  );
}
