"use client";

import { Package, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SubmitPanel } from "@/studio/shell/submit-panel";
import { KIND_LABEL, type Project } from "@/studio/model/types";

/** Kinds that can go in a pack: things a person wears. Scenes and theme packs are bought differently. */
const PACKABLE = ["decoration", "sticker", "nameplate", "effect"] as const;

/**
 * A cosmetic pack is other projects on this device, sold as one. Each keeps being
 * its own project — edit it there and the pack follows — and a pack holds at most
 * one of each kind, since two decorations would only fight over the same slot.
 */
export function PackEditor({ project, all, onChange, onOpen }: { project: Project; all: Project[]; onChange: (p: Project) => void; onOpen: (id: string) => void }) {
  const ids = project.pack?.projectIds ?? [];
  const members = ids.map((id) => all.find((p) => p.id === id)).filter(Boolean) as Project[];
  const takenKinds = new Set(members.map((m) => m.kind));
  const candidates = all.filter((p) => (PACKABLE as readonly string[]).includes(p.kind) && !ids.includes(p.id) && !takenKinds.has(p.kind));
  const set = (projectIds: string[]) => onChange({ ...project, pack: { projectIds } });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="mx-auto grid w-full max-w-4xl gap-6 p-6 md:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-sm font-semibold">In this pack ({members.length})</h2>
          {members.length === 0 && <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">Add at least two things from your projects.</p>}
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <Package className="size-4 shrink-0 text-muted-foreground" />
              <button type="button" onClick={() => onOpen(m.id)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium hover:underline">{m.name}</p>
                <p className="text-xs text-muted-foreground">{KIND_LABEL[m.kind]}</p>
              </button>
              <Button size="icon" variant="ghost" className="size-8" aria-label={`Remove ${m.name}`} onClick={() => set(ids.filter((i) => i !== m.id))}>
                <X className="size-4" />
              </Button>
            </div>
          ))}
          {ids.length > members.length && <p className="text-xs text-destructive">A project in this pack has been deleted — remove it to continue.</p>}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Your projects</h2>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing else to add. Make decorations, stickers, nameplates or effects as their own projects first. A pack holds one of each.</p>
          ) : (
            candidates.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{KIND_LABEL[c.kind]}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => set([...ids, c.id])}>
                  <Plus /> Add
                </Button>
              </div>
            ))
          )}
        </section>
      </div>
      <div className="border-t border-border/60">
        <SubmitPanel project={project} onChange={onChange} />
      </div>
    </div>
  );
}
