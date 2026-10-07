"use client";

import { useConvex, useQuery } from "convex/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { toast } from "sonner";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { ExtensionHost, type Backend, type Installed, type LogLine, type Status } from "@/extensions/host";
import type { FaultReason } from "@/extensions/protocol";
import type { UiNode } from "@/extensions/ui-schema";

/**
 * The extensions the signed-in person has installed, and the sandboxes running them.
 *
 * Nothing starts by itself: a sandbox is made when its panel is opened and torn down
 * when it is closed. What *is* always running is the subscription to the install list —
 * which is how revoking an extension takes effect at once: its row leaves the list, and
 * this tears the sandbox down on the very next push, rather than at the next launch.
 */

export interface ExtState {
  status: Status;
  detail?: string;
  reason?: FaultReason;
  tree: UiNode | null;
  problems: string[];
  logs: LogLine[];
}

const BLANK: ExtState = { status: "stopped", tree: null, problems: [], logs: [] };

interface Ctx {
  installed: ReturnType<typeof useInstalledQuery>;
  state: (id: string) => ExtState;
  /** Make its sandbox (if it has none) and tell it its panel is open. */
  open: (id: string) => void;
  action: (id: string, action: string, value?: unknown) => void;
  stop: (id: string) => void;
}

const useInstalledQuery = () => useQuery(api.extensions.myInstalled);
const ExtensionsContext = createContext<Ctx | null>(null);

export function ExtensionsProvider({ children }: { children: React.ReactNode }) {
  const convex = useConvex();
  const installed = useInstalledQuery();
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const hosts = useRef(new Map<string, { host: ExtensionHost; key: string }>());
  const states = useRef(new Map<string, ExtState>());

  const patch = useCallback((id: string, p: Partial<ExtState>) => {
    states.current.set(id, { ...(states.current.get(id) ?? BLANK), ...p });
    bump();
  }, []);

  const backendFor = useCallback(
    (extensionId: Id<"extensions">, name: string): Backend => ({
      storage: {
        get: (key) => convex.query(api.extensions.storageGet, { extensionId, key }),
        set: async (key, value) => void (await convex.mutation(api.extensions.storageSet, { extensionId, key, value })),
        delete: async (key) => void (await convex.mutation(api.extensions.storageDelete, { extensionId, key })),
        list: () => convex.query(api.extensions.storageList, { extensionId }),
      },
      http: (req) => convex.action(api.extensions.http, { extensionId, ...req }),
      // Always attributed: a notice can't pretend to come from Crystal.
      notify: (text) => void toast(`${name} (extension)`, { description: text }),
    }),
    [convex],
  );

  const teardown = useCallback(
    (id: string) => {
      hosts.current.get(id)?.host.stop();
      hosts.current.delete(id);
      states.current.delete(id);
      bump();
    },
    [],
  );

  // Anything that is no longer installed, no longer approved, or has changed (a new version,
  // or different powers) is torn down at once.
  useEffect(() => {
    if (!installed) return;
    const live = new Map(installed.map((i) => [i.extensionId as string, `${i.hash}:${[...i.granted].sort().join()}`]));
    for (const [id, h] of [...hosts.current]) if (live.get(id) !== h.key) teardown(id);
  }, [installed, teardown]);

  useEffect(
    () => () => {
      for (const h of hosts.current.values()) h.host.stop();
      hosts.current.clear();
    },
    [],
  );

  const ensure = useCallback(
    (id: string): ExtensionHost | null => {
      const ext = installed?.find((i) => i.extensionId === id);
      if (!ext) return null;
      const key = `${ext.hash}:${[...ext.granted].sort().join()}`;
      const existing = hosts.current.get(id);
      if (existing && existing.key === key && existing.host.status !== "stopped") return existing.host;
      existing?.host.stop();
      const info: Installed = { extensionId: ext.extensionId, name: ext.name, version: ext.version, source: ext.source, hash: ext.hash, manifest: ext.manifest, granted: ext.granted };
      const host = new ExtensionHost(info, backendFor(ext.extensionId, ext.name), {
        onUi: (tree, problems) => patch(id, { tree, problems }),
        onStatus: (status, detail, reason) => patch(id, { status, detail, reason, ...(status === "suspended" || status === "stopped" ? {} : {}) }),
        onLog: () => patch(id, { logs: [...(hosts.current.get(id)?.host.logs ?? [])] }),
      });
      hosts.current.set(id, { host, key });
      patch(id, { ...BLANK, status: "starting" });
      return host;
    },
    [installed, backendFor, patch],
  );

  const open = useCallback(
    (id: string) => {
      const host = ensure(id);
      if (!host) return;
      void host.start().then(() => {
        // Told it's open once it's running — a sandbox that isn't up yet hears it on arrival.
        const wait = () => (host.status === "running" ? host.open() : host.status === "starting" ? setTimeout(wait, 30) : undefined);
        wait();
      });
    },
    [ensure],
  );

  const value = useMemo<Ctx>(
    () => ({
      installed,
      state: (id) => states.current.get(id) ?? BLANK,
      open,
      action: (id, action, v) => hosts.current.get(id)?.host.action(action, v),
      stop: teardown,
    }),
    // The state lives in a ref so a drag of messages doesn't churn React; `version` is what
    // tells consumers that something in it changed.
    [installed, open, teardown, version],
  );

  return <ExtensionsContext.Provider value={value}>{children}</ExtensionsContext.Provider>;
}

export function useExtensions(): Ctx {
  const ctx = useContext(ExtensionsContext);
  if (!ctx) throw new Error("useExtensions must be used within <ExtensionsProvider>");
  return ctx;
}
