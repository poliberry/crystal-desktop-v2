"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import type { Id } from "../../convex/_generated/dataModel";
import { useNavigation } from "@/components/home/navigation-context";
import { InstallFlow, type InstallResult } from "@/components/oauth/install-flow";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getDesktopAPI } from "@/lib/desktop";
import { parseDeepLink } from "@/lib/deeplinks";

/**
 * Links to add a bot or an extension, arriving in the app.
 *
 * From outside, the OS hands the desktop app `crystal://oauth/authorize?…` (or a `usecrystal.app`
 * link) and the main process passes the query string here; on the web the page that was opened at
 * `/?install=<query>` does the same. Either way the flow is the one the install page shows, in a
 * dialog over whatever the person was doing. It asks before it adds anything, and a link that
 * arrives while signed out waits in the main process until this exists (see `deeplinks.ready`).
 *
 * This also tells the main process the app can take links now, which is why it is mounted once,
 * signed in, next to the invite handler.
 */
export function InstallDeepLinkHandler() {
  const [search, setSearch] = useState<string | null>(null);
  const { openCommunity } = useNavigation();

  useEffect(() => {
    const desktop = getDesktopAPI();
    // The web hand-off: a link opened at /?install=<url-encoded query>. Cleared so a refresh doesn't re-prompt.
    const fromQuery = new URLSearchParams(window.location.search).get("install");
    if (fromQuery) {
      const link = parseDeepLink(`crystal://oauth/authorize${fromQuery.startsWith("?") ? fromQuery : `?${fromQuery}`}`);
      if (link?.kind === "authorize") setSearch(link.search);
      const url = new URL(window.location.href);
      url.searchParams.delete("install");
      window.history.replaceState(null, "", url.toString());
    }
    const off = desktop?.installs?.onOpen((next) => {
      // Checked again on this side: the main process already did, and this costs nothing.
      const link = parseDeepLink(`crystal://oauth/authorize${next}`);
      if (link?.kind === "authorize") setSearch(link.search);
    });
    // Handlers are in place: let anything that arrived while we were starting (or signed out) through.
    desktop?.deeplinks?.ready();
    return off;
  }, []);

  const done = (result: InstallResult) => {
    setSearch(null);
    if (result.redirectTo) window.open(result.redirectTo, "_blank", "noopener,noreferrer");
    if (result.kind === "bot") {
      toast.success(`${result.botName} was added to ${result.communityName}.`);
      openCommunity(result.communityId as Id<"communities">);
    } else {
      toast.success(`${result.name} was added.`);
    }
  };

  return (
    <Dialog open={search !== null} onOpenChange={(open) => !open && setSearch(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-0 bg-transparent p-0 shadow-none sm:max-w-md [&>button]:hidden">
        <DialogTitle className="sr-only">Add a bot or extension</DialogTitle>
        <DialogDescription className="sr-only">Choose where to add it and what to allow.</DialogDescription>
        {search !== null && <InstallFlow search={search} onDone={done} onCancel={() => setSearch(null)} />}
      </DialogContent>
    </Dialog>
  );
}
