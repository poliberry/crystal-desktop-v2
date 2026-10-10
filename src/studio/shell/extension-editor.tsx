"use client";

import { useConvex, useQuery } from "convex/react";
import { CheckCircle2, Hammer, Info, Loader2, Play, Send, Square, AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { api } from "../../../convex/_generated/api";
import { CAPABILITIES, CAPABILITY_INFO, sourceHash, type Capability } from "../../../convex/lib/extensionManifest";
import { ExtensionHost, type Backend, type LogLine, type Status } from "@/extensions/host";
import { ExtensionFrame } from "@/extensions/ui-render";
import type { UiNode } from "@/extensions/ui-schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodeWorkbenchView } from "@/studio/code/code-workbench";
import { useCodeWorkbench } from "@/studio/code/use-code-workbench";
import { extensionInstallUrl } from "../../../convex/lib/oauthLinks";
import { nextVersion, versionBlocker } from "../../../convex/lib/listingUpdate";
import { APP_ORIGIN } from "@/lib/deeplinks";
import { checkExtension, manifestOf, slugFor } from "@/studio/model/extension";
import type { ExtensionData, Project } from "@/studio/model/types";
import { cn } from "@/lib/utils";

/** The link that adds an approved extension to someone's account: only offered once a version is approved, since before that it would lead nowhere. */
function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => void navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      title={url}
    >
      {copied ? "Link copied" : "Copy the link that adds it to someone's account"}
    </button>
  );
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message.replace(/^.*Uncaught Error:\s*/s, "").split("\n")[0] : "That didn't work.");

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * An extension: a TypeScript project in the code workbench, with its manifest in the project
 * settings (saved to the `.crysproj`), a test run in the real sandbox, and Send for review.
 *
 * What runs, and what is reviewed, is the *built* script (`dist/extension.js`): the bundle of
 * `src/` that the sandbox actually executes. Type errors are shown as problems and stop a
 * submission, but not a test run — the types are stripped when it is built, so it still runs and
 * you can see what the mistake does.
 *
 * The test run is the genuine thing: the same worker, engine, limits and host as for someone who
 * installs it, with the network simulated and storage a throwaway in memory.
 */
export function ExtensionEditor({ project, onChange }: { project: Project; onChange: (p: Project) => void }) {
  const ext = project.extension!;
  const convex = useConvex();
  const wb = useCodeWorkbench(project);
  const set = (patch: Partial<ExtensionData>) => onChange({ ...project, extension: { ...ext, ...patch } });
  const publishing = useQuery(api.extensions.publishingAllowed, {});
  const mine = useQuery(api.extensions.mine, {});

  /** The last successful build: what the checks scan and what is sent for review. */
  const [compiled, setCompiled] = useState<string | null>(null);
  const check = useMemo(() => checkExtension(project.name, ext, compiled), [project.name, ext, compiled]);
  // Edits make the built script out of date; checks that depend on it are only as good as the last build.
  const stale = compiled !== null && wb.dirty.size > 0;

  // --- test run ---------------------------------------------------------------------------
  const [status, setStatus] = useState<Status>("stopped");
  const [detail, setDetail] = useState<string | undefined>();
  const [tree, setTree] = useState<UiNode | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [runSignal, setRunSignal] = useState(0);
  const [notices, setNotices] = useState<string[]>([]);
  const host = useRef<ExtensionHost | null>(null);
  const store = useRef(new Map<string, string>());

  const stop = useCallback(() => {
    host.current?.stop();
    host.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const build = useCallback(async () => {
    const r = await wb.buildExtension();
    if (r.ok) setCompiled(r.code);
    return r;
  }, [wb]);

  const run = async () => {
    setRunSignal((n) => n + 1);
    stop();
    setTree(null);
    setLogs([]);
    setNotices([]);
    setDetail(undefined);
    const built = await build();
    if (!built.ok) return;
    const verdict = checkExtension(project.name, ext, built.code);
    if (!verdict.manifest) return;
    const backend: Backend = {
      storage: {
        get: async (k) => store.current.get(k) ?? null,
        set: async (k, v) => void store.current.set(k, v),
        delete: async (k) => void store.current.delete(k),
        list: async () => [...store.current.keys()],
      },
      http: async (req) => {
        throw new Error(`Test runs don't reach the network (it would have fetched ${req.url.slice(0, 60)}).`);
      },
      notify: (t) => setNotices((n) => [...n.slice(-4), t]),
    };
    const h = new ExtensionHost(
      { extensionId: "studio-test", name: verdict.manifest.name, version: verdict.manifest.version, source: built.code, hash: await sourceHash(built.code), manifest: verdict.manifest, granted: verdict.manifest.capabilities },
      backend,
      {
        onUi: (t) => setTree(t),
        onStatus: (s, d) => {
          setStatus(s);
          setDetail(d);
          // Told to open only once the sandbox has said it is ready: anything sent sooner is dropped.
          if (s === "running") queueMicrotask(() => host.current?.open());
        },
        onLog: (l) => setLogs((cur) => [...cur.slice(-99), l]),
      },
    );
    host.current = h;
    await h.start();
  };

  // --- publishing -------------------------------------------------------------------------
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const existing = mine?.find((m) => m.slug === ext.slug);
  // Where this extension is in the store: what is live, what is waiting, what to send next.
  const versions = existing?.versions ?? [];
  const live = versions.find((v) => v.status === "approved");
  const waiting = versions.find((v) => v.status === "pending");
  const lastTurnedDown = versions[0]?.status === "rejected" ? versions[0] : undefined;
  // A version waiting for review is replaced by a newer send, so it doesn't count against the new number.
  const blocker = existing ? versionBlocker(versions.filter((v) => v.status !== "pending").map((v) => v.version), ext.version) : null;
  const suggested = nextVersion(versions.map((v) => v.version));

  const publish = async () => {
    setBusy(true);
    setError(null);
    setPublished(null);
    try {
      await wb.saveAll();
      const typeErrors = (await wb.check()).filter((p) => p.severity === "error");
      if (typeErrors.length > 0) throw new Error(`Fix the ${typeErrors.length} error${typeErrors.length === 1 ? "" : "s"} in the code first — see Problems.`);
      const built = await build();
      if (!built.ok) throw new Error("The build failed — see Build.");
      if (blocker) throw new Error(blocker);
      const verdict = checkExtension(project.name, ext, built.code);
      if (!verdict.ok) throw new Error(verdict.findings.find((f) => f.level === "error")?.message ?? "It didn't pass the checks.");
      await convex.mutation(api.extensions.submitVersion, { slug: ext.slug, manifest: manifestOf(project.name, ext), source: built.code, replacePending: !!waiting });
      setPublished(live ? `Version ${ext.version} was sent for review. v${live.version} stays live until it is approved; then people who have it are offered the update.` : `Version ${ext.version} was sent for review.`);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const toggleCap = (c: Capability, on: boolean) => set({ capabilities: on ? [...new Set([...ext.capabilities, c])] : ext.capabilities.filter((x) => x !== c) });

  const settings = (
    <div className="mx-auto max-w-xl space-y-4 p-5">
      <p className="text-xs text-muted-foreground">Saved to this project&apos;s <code>.crysproj</code>. The code is in <code>src/</code>.</p>
      <Field label="Id" hint="Its permanent name. Lowercase letters, numbers and hyphens; can't be changed once published.">
        <div className="flex gap-2">
          <Input value={ext.slug} onChange={(e) => set({ slug: e.target.value.toLowerCase() })} className="font-mono text-xs" />
          <Button type="button" variant="secondary" size="sm" onClick={() => set({ slug: slugFor(project.name) })}>
            From name
          </Button>
        </div>
      </Field>
      <Field label="What it does" hint="At least a sentence. People read this before they install it.">
        <Textarea value={ext.description} maxLength={400} rows={3} onChange={(e) => set({ description: e.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Version" hint={existing && live ? `${live.version} is live — an update needs a newer number, such as ${suggested}.` : "1.0.0 — each submission needs a new one."}>
          <Input value={ext.version} onChange={(e) => set({ version: e.target.value })} className="font-mono text-xs" />
        </Field>
        <Field label="Panel title">
          <Input value={ext.panelTitle} maxLength={40} onChange={(e) => set({ panelTitle: e.target.value })} />
        </Field>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">What it asks for</p>
        {CAPABILITIES.map((c) => (
          <label key={c} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-accent/40">
            <input type="checkbox" className="mt-1" checked={ext.capabilities.includes(c)} onChange={(e) => toggleCap(c, e.target.checked)} />
            <span>
              <span className="block text-sm font-medium">{CAPABILITY_INFO[c].label}</span>
              <span className="block text-xs text-muted-foreground">{CAPABILITY_INFO[c].description}</span>
            </span>
          </label>
        ))}
      </div>
      {ext.capabilities.includes("network") && (
        <Field label="Sites it may talk to" hint="One per line, as https://host. Nothing else can be reached.">
          <Textarea rows={3} value={ext.network.join("\n")} className="font-mono text-xs" onChange={(e) => set({ network: e.target.value.split("\n").map((l) => l.trim()).filter(Boolean) })} />
        </Field>
      )}

      <div className="space-y-1 border-t border-border/60 pt-4">
        <p className="text-xs font-medium">Checks</p>
        {check.findings.map((f, i) => (
          <p key={i} className="flex items-start gap-2 text-xs">
            {f.level === "error" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" /> : f.level === "warning" ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" /> : <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
            <span>{f.message}</span>
          </p>
        ))}
        {stale && <p className="text-[11px] text-amber-500">The code has changed since it was last built.</p>}
      </div>
    </div>
  );

  const runView = (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Test run</h2>
        <span className="ml-auto flex gap-2">
          {status === "running" || status === "starting" ? (
            <Button size="sm" variant="secondary" onClick={() => { stop(); setStatus("stopped"); }}>
              <Square className="size-3.5" /> Stop
            </Button>
          ) : null}
        </span>
      </div>
      <p className="text-[11px] text-muted-foreground">Builds, then runs in the real sandbox. The network is simulated.</p>
      <ExtensionFrame name={check.manifest?.name ?? project.name} version={ext.version} status={status} detail={detail} tree={tree} act={(a, v) => host.current?.action(a, v)} onRestart={() => void run()} onStop={stop} />
      {notices.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">Notices it showed</p>
          {notices.map((n, i) => (
            <p key={i} className="rounded-md bg-muted px-2 py-1 text-xs">{n}</p>
          ))}
        </div>
      )}
      <div>
        <p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">Console</p>
        <div className="max-h-40 overflow-y-auto rounded-md bg-muted/50 p-2 font-mono text-[11px]">
          {logs.length === 0 ? <span className="text-muted-foreground">Nothing logged.</span> : logs.map((l, i) => (
            <p key={i} className={cn(l.level === "error" && "text-destructive", l.level === "warn" && "text-amber-500", l.level === "host" && "text-primary")}>{l.text}</p>
          ))}
        </div>
      </div>
      <div className="space-y-2 border-t border-border/60 pt-3 text-xs">
        {published ? (
          <span className="flex items-center gap-1.5 text-emerald-500"><CheckCircle2 className="size-4" /> {published}</span>
        ) : error ? (
          <span role="alert" className="text-destructive">{error}</span>
        ) : publishing && !publishing.allowed ? (
          <span className="text-muted-foreground">Publishing is limited to Crystal staff for now. You can still build and test here.</span>
        ) : (
          <div className="space-y-1 text-muted-foreground">
            <p>
              {existing
                ? `Published as “${existing.slug}”. ${live ? `v${live.version} is live.` : "Nothing is live yet."}${waiting ? ` v${waiting.version} is waiting for review${live ? "; the page stays as it is until it is approved" : ""}.` : ""}`
                : "Every version is reviewed before anyone can install it."}
            </p>
            {lastTurnedDown && !waiting && <p className="rounded-md bg-amber-500/10 p-2 text-foreground">v{lastTurnedDown.version} was turned down{lastTurnedDown.reviewNote ? `: ${lastTurnedDown.reviewNote}` : "."} Fix it and send it again.</p>}
            {existing && blocker && (
              <p className="rounded-md bg-amber-500/10 p-2 text-foreground">
                {blocker}{" "}
                <button type="button" className="underline" onClick={() => set({ version: suggested })}>Use {suggested}</button>
              </p>
            )}
            {existing && !blocker && waiting && <p>Sending now replaces v{waiting.version} in the queue.</p>}
            {live && !blocker && !waiting && <p>Sending this updates the live page: people who have it installed are offered v{ext.version}.</p>}
          </div>
        )}
        {existing?.versions.some((v) => v.status === "approved") && <ShareLink url={extensionInstallUrl(APP_ORIGIN, existing.slug)} />}
      </div>
    </div>
  );

  const running = status === "running" || status === "starting";
  const flat = "flex h-[22px] items-center gap-1 rounded-[2px] px-2 text-[12px] hover:bg-[var(--vsc-list-hover)] disabled:opacity-40";
  return (
    <CodeWorkbenchView
      wb={wb}
      projectName={project.name}
      settings={settings}
      settingsLabel="Project"
      run={runView}
      runSignal={runSignal}
      runLabel="Test Run"
      hasBuild
      guide={{ label: "Extension SDK guides", id: "extensions/overview" }}
      reference={{ label: "Extension SDK reference", anchor: "extension/Extension" }}
      runItems={[
        { label: "Build", run: () => void build(), disabled: !wb.ready || wb.build.status === "building" },
        { label: running || logs.length > 0 || tree ? "Run again" : "Run", run: () => void run(), disabled: !wb.ready || !check.manifest },
        { label: live ? "Send update for review" : "Send for review", run: () => void publish(), disabled: busy || !wb.ready || !publishing?.allowed },
      ]}
      toolbar={
        <>
          <button type="button" className={flat} disabled={!wb.ready || wb.build.status === "building"} onClick={() => void build()}>
            {wb.build.status === "building" ? <Loader2 className="size-3.5 animate-spin" /> : <Hammer className="size-3.5" />} Build
          </button>
          <button type="button" className={flat} disabled={!wb.ready || !check.manifest} onClick={() => void run()}>
            <Play className="size-3.5" /> {running || logs.length > 0 || tree ? "Run again" : "Run"}
          </button>
          <button type="button" className={flat} disabled={busy || !wb.ready || !publishing?.allowed} onClick={() => void publish()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} {live ? "Send update for review" : "Send for review"}
          </button>
        </>
      }
    />
  );
}
