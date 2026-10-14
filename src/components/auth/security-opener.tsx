"use client";

import { useEffect } from "react";

import { OPEN_SECURITY_EVENT } from "@/components/auth/step-up-dialog";
import { useOpenSettings } from "@/components/pages/page-context";

/** Opens Settings at Security when the "turn it on" button of the step-up prompt asks. Lives inside the tabs, where Settings can open. */
export function SecurityOpener() {
  const openSettings = useOpenSettings();
  useEffect(() => {
    const open = () => openSettings("security");
    window.addEventListener(OPEN_SECURITY_EVENT, open);
    return () => window.removeEventListener(OPEN_SECURITY_EVENT, open);
  }, [openSettings]);
  return null;
}
