"use client";

import { useConvex } from "convex/react";
import { useEffect } from "react";

import type { Id } from "../../convex/_generated/dataModel";
import { routeFromPath } from "../../electron/deeplink";
import { useCall } from "@/components/call/call-provider";
import { useNavigation } from "@/components/home/navigation-context";
import { getDesktopAPI } from "@/lib/desktop";
import { listenForServiceWorkerLinks, registerServiceWorker, resyncPush } from "@/lib/pwa";

/**
 * Deep links into the signed-in app, from wherever they come:
 *
 *  - notification taps (the service worker posts `crystal:navigate`, or opens /app/#/… fresh)
 *  - `crystal://dm/<id>`-style links handed to the desktop app by the OS (`desktopAPI.routes`)
 *  - `web+crystal://…` links handed to the installed web app (manifest `protocol_handlers` → `?link=`)
 *  - a pasted https://usecrystal.app/app/#/… address
 *
 * All of them end up as a hash route, which tabs-context turns into the right tab. This adds what a
 * route asks for beyond "show me this place": `#/call/dm/<id>` and `#/call/channel/<c>/<ch>` also join
 * the call (the "Answer" button on a ringing notification), and `#/friends` shows the Friends list.
 * Once done, the action route is replaced by the plain one, so a refresh doesn't join the call again.
 */

// Read before anything rewrites the address bar on first render.
const INITIAL_HASH = typeof window !== "undefined" ? window.location.hash : "";

function plainRoute(hash: string): string {
  return hash.replace(/^#\/call\/dm\//, "#/dm/").replace(/^#\/call\/channel\//, "#/community/").replace(/^#\/friends\/?$/, "");
}

export function DeepLinkHandler() {
  const nav = useNavigation();
  const { joinDmCall, joinChannelCall } = useCall();
  const convex = useConvex();

  useEffect(() => {
    const act = (hash: string) => {
      const parts = hash.replace(/^#\/?/, "").split("?")[0].split("/").filter(Boolean);
      if (parts[0] === "call" && parts[1] === "dm" && parts[2]) {
        void joinDmCall(parts[2] as Id<"conversations">, { ring: false }).catch(() => {});
      } else if (parts[0] === "call" && parts[1] === "channel" && parts[2] && parts[3]) {
        void joinChannelCall(parts[3] as Id<"channels">, parts[2] as Id<"communities">).catch(() => {});
      } else if (parts[0] === "friends") {
        nav.openFriends();
      } else {
        return;
      }
      window.history.replaceState(window.history.state, "", plainRoute(hash) || window.location.pathname);
    };

    // Give the home layout a beat to register its navigation actions before the first one runs.
    const first = window.setTimeout(() => act(INITIAL_HASH), 400);
    const onPop = () => act(window.location.hash);
    window.addEventListener("popstate", onPop);

    // A link that isn't a hash yet: hand it over as one, which comes back round through popstate.
    const go = (hash: string) => {
      if (window.location.hash === hash) act(hash);
      else window.location.hash = hash;
    };
    const offDesktop = getDesktopAPI()?.routes?.onOpen(go);
    const linkParam = new URLSearchParams(window.location.search).get("link");
    if (linkParam) {
      const route = routeFromPath(linkParam.replace(/^web\+crystal:\/*/i, "/"));
      const url = new URL(window.location.href);
      url.searchParams.delete("link");
      window.history.replaceState(window.history.state, "", url.pathname + url.search + (route ?? url.hash));
      if (route) window.setTimeout(() => go(route), 400);
    }

    return () => {
      window.clearTimeout(first);
      window.removeEventListener("popstate", onPop);
      offDesktop?.();
    };
  }, [nav, joinDmCall, joinChannelCall]);

  // The installed-app plumbing: the service worker, notification taps while open, and making sure this
  // browser's push subscription belongs to whoever is signed in now.
  useEffect(() => {
    void registerServiceWorker();
    const off = listenForServiceWorkerLinks();
    void resyncPush(convex);
    return off;
  }, [convex]);

  return null;
}
