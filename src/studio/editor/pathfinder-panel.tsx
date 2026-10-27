"use client";

import { Combine, Shapes, SquaresExclude, SquaresIntersect, SquaresSubtract, SquaresUnite, Unlink } from "lucide-react";
import { useEffect, useState } from "react";

import * as A from "@/studio/editor/actions";
import { keyLabel } from "@/studio/editor/keys";
import { Section } from "@/studio/editor/fields";
import type { DocEditor } from "@/studio/editor/use-doc-editor";
import type { PathfinderOp } from "@/studio/model/boolean";

const MODES: { op: PathfinderOp; label: string; hint: string; Icon: React.ComponentType<{ className?: string; strokeWidth?: number }> }[] = [
  { op: "unite", label: "Unite", hint: "One shape from all of them", Icon: SquaresUnite },
  { op: "minusFront", label: "Minus Front", hint: "The back shape, with everything in front cut out of it", Icon: SquaresSubtract },
  { op: "intersect", label: "Intersect", hint: "Only where they all overlap", Icon: SquaresIntersect },
  { op: "exclude", label: "Exclude Overlap", hint: "Everything but where they overlap", Icon: SquaresExclude },
];

/**
 * The Pathfinder panel, as Illustrator's: shape modes in a row, then pathfinders, then compound-path
 * and conversion commands. Each button runs the same function as its menu item. They are disabled until
 * the selection is something they can do, and the reason is the button's tooltip.
 */
export function PathfinderPanel({ editor, onNotice }: { editor: DocEditor; onNotice: (message: string) => void }) {
  // Whether the selection can be combined depends on a module that loads on first use, so it is asked, not computed.
  const [reason, setReason] = useState<string | null>("Select two or more shapes");
  useEffect(() => {
    let live = true;
    void A.combineReason(editor).then((r) => live && setReason(r));
    return () => {
      live = false;
    };
    // The selection and what it is made of: a new document with the same selection can still differ.
  }, [editor.selection, editor.doc.nodes]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = (p: Promise<string | null>) => void p.then((m) => m && onNotice(m));
  const cell = "ai-tool !h-9 !w-full flex-col gap-0.5 !rounded-[3px] border border-[var(--ai-edge)] text-[10px]";
  const disabled = reason !== null;

  return (
    <div>
      <Section title="Shape Modes">
        <div className="grid grid-cols-2 gap-1">
          {MODES.map(({ op, label, hint, Icon }) => (
            <button key={op} type="button" className={cell} disabled={disabled} title={disabled ? reason! : `${label} — ${hint}`} onClick={() => run(A.pathfinderOp(editor, op))}>
              <Icon className="size-4" strokeWidth={1.5} />
              {label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Pathfinders">
        <div className="grid grid-cols-2 gap-1">
          <button type="button" className={cell} disabled={disabled} title={disabled ? reason! : "Minus Back — the front shape, with everything behind it cut out of it"} onClick={() => run(A.pathfinderOp(editor, "minusBack"))}>
            <SquaresSubtract className="size-4 -scale-x-100" strokeWidth={1.5} />
            Minus Back
          </button>
        </div>
        <p className="text-[10px] text-[var(--ai-dim)]">The result is a path and takes the look of the front shape (Minus Front keeps the back one). Open paths count as closed.</p>
      </Section>
      <Section title="Compound path">
        <div className="grid grid-cols-2 gap-1">
          <button type="button" className={cell} disabled={disabled} title={disabled ? reason! : `Make compound path (${keyLabel("mod+8")}) — overlaps become holes`} onClick={() => run(A.makeCompound(editor))}>
            <Combine className="size-4" strokeWidth={1.5} />
            Make
          </button>
          <button type="button" className={cell} disabled={!A.hasCompound(editor)} title={`Release compound path (${keyLabel("mod+alt+8")})`} onClick={() => run(A.releaseCompound(editor))}>
            <Unlink className="size-4" strokeWidth={1.5} />
            Release
          </button>
        </div>
      </Section>
      <Section title="Convert">
        <div className="grid grid-cols-2 gap-1">
          <button type="button" className={cell} disabled={!A.hasShape(editor)} title="Expand shape — turn a rectangle or ellipse into a path you can edit anchor by anchor" onClick={() => run(A.expandShape(editor))}>
            <Shapes className="size-4" strokeWidth={1.5} />
            Expand Shape
          </button>
        </div>
      </Section>
    </div>
  );
}
