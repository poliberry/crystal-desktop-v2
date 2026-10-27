"use client";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import * as A from "@/studio/editor/actions";
import { keyLabel } from "@/studio/editor/keys";
import type { DocEditor } from "@/studio/editor/use-doc-editor";
import { ViewMenuItems, type ViewCommands } from "@/studio/editor/view-menu";
import type { SetViewPrefs, ViewPrefs } from "@/studio/editor/view-prefs";
import { patchNodes } from "@/studio/model/doc";
import { guideCount, clearGuides } from "@/studio/model/doc";
import { SHADER_LABEL } from "@/studio/model/fx";
import type { ShaderType, TextNode } from "@/studio/model/types";

export type PanelId = "color" | "swatches" | "properties" | "appearance" | "pathfinder" | "layers" | "assets";
export type BottomId = "problems" | "preview" | "submit";

const Item = ({ label, keys, onSelect, disabled }: { label: string; keys?: string; onSelect: () => void; disabled?: boolean }) => (
  <DropdownMenuItem onSelect={onSelect} disabled={disabled} className="text-[12px]">
    {label}
    {keys && <DropdownMenuShortcut>{keyLabel(keys)}</DropdownMenuShortcut>}
  </DropdownMenuItem>
);

const SHADERS = Object.keys(SHADER_LABEL) as ShaderType[];

function Menu({ label, children, width = "w-60" }: { label: string; children: React.ReactNode; width?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="ai-menu outline-none">
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={0} className={`${width} rounded-[2px] p-1`}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The menu bar: File Edit Object Type Select Effect View Window Help, in Illustrator's order. Every
 * item runs the same function as its shortcut (see actions.ts), and shows the shortcut beside it.
 * Items that don't apply to this editor (there is no Type menu of fonts, no Window ▸ Brushes) are
 * left out rather than shown dead.
 */
export function MenuBar({
  editor,
  prefs,
  setPrefs,
  commands,
  panels,
  onTogglePanel,
  bottom,
  onBottom,
  onImport,
  onOpenGuides,
  onSave,
  canSave,
  onNotice,
  trailing,
}: {
  editor: DocEditor;
  prefs: ViewPrefs;
  setPrefs: SetViewPrefs;
  commands: React.RefObject<ViewCommands | null>;
  panels: Record<PanelId, boolean>;
  onTogglePanel: (id: PanelId) => void;
  bottom: BottomId | null;
  onBottom: (id: BottomId | null) => void;
  onImport: () => void;
  onOpenGuides?: () => void;
  /** Save the design. A canvas editor saves only when asked; with none given the item is left out. */
  onSave?: () => void;
  canSave?: boolean;
  /** Where to say why a command couldn't be done. */
  onNotice: (message: string) => void;
  /** Controls at the right end of the bar (Illustrator puts Share and the workspace controls there). */
  trailing?: React.ReactNode;
}) {
  const has = editor.selection.length > 0;
  const texts = editor.selection.map((id) => editor.doc.nodes[id]).filter((n): n is TextNode => n?.type === "text");
  const run = (p: Promise<string | null>) => void p.then((m) => m && onNotice(m));
  const setText = (p: Partial<TextNode>) => editor.commit(patchNodes(editor.doc, texts.map((t) => t.id), p as never));

  return (
    <div className="flex h-[30px] min-w-0 items-stretch bg-[var(--ai-body)]" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Menu label="File">
        {onSave && (
          <>
            <Item label="Save" keys="mod+s" disabled={!canSave} onSelect={onSave} />
            <DropdownMenuSeparator />
          </>
        )}
        <Item label="Place picture…" onSelect={onImport} />
        <DropdownMenuSeparator />
        <Item label="Submit to Marketplace…" onSelect={() => onBottom("submit")} />
      </Menu>
      <Menu label="Edit">
        <Item label="Undo" keys="mod+z" disabled={!editor.canUndo} onSelect={editor.undo} />
        <Item label="Redo" keys="mod+shift+z" disabled={!editor.canRedo} onSelect={editor.redo} />
        <DropdownMenuSeparator />
        <Item label="Cut" keys="mod+x" disabled={!has} onSelect={() => A.cut(editor)} />
        <Item label="Copy" keys="mod+c" disabled={!has} onSelect={() => A.copy(editor)} />
        <Item label="Paste" keys="mod+v" disabled={!A.hasClipboard()} onSelect={() => A.paste(editor)} />
        <Item label="Paste in Front" keys="mod+f" disabled={!A.hasClipboard()} onSelect={() => A.paste(editor, "front")} />
        <Item label="Paste in Back" keys="mod+b" disabled={!A.hasClipboard()} onSelect={() => A.paste(editor, "back")} />
        <Item label="Paste in Place" keys="mod+shift+v" disabled={!A.hasClipboard()} onSelect={() => A.paste(editor, "place")} />
        <DropdownMenuSeparator />
        <Item label="Duplicate" keys="mod+d" disabled={!has} onSelect={() => A.duplicate(editor)} />
        <Item label="Clear" keys="Delete" disabled={!has} onSelect={() => A.remove(editor)} />
      </Menu>
      <Menu label="Object">
        <Item label="Group" keys="mod+g" disabled={editor.selection.length < 2} onSelect={() => A.group(editor)} />
        <Item label="Ungroup" keys="mod+shift+g" disabled={!A.hasGroup(editor)} onSelect={() => A.ungroup(editor)} />
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[12px]">Arrange</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 rounded-[2px] p-1">
            <Item label="Bring to Front" keys="mod+shift+]" disabled={!has} onSelect={() => A.arrange(editor, "front")} />
            <Item label="Bring Forward" keys="mod+]" disabled={!has} onSelect={() => A.arrange(editor, "up")} />
            <Item label="Send Backward" keys="mod+[" disabled={!has} onSelect={() => A.arrange(editor, "down")} />
            <Item label="Send to Back" keys="mod+shift+[" disabled={!has} onSelect={() => A.arrange(editor, "back")} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[12px]">Compound Path</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 rounded-[2px] p-1">
            <Item label="Make" keys="mod+8" disabled={editor.selection.length < 2} onSelect={() => run(A.makeCompound(editor))} />
            <Item label="Release" keys="mod+alt+8" disabled={!A.hasCompound(editor)} onSelect={() => run(A.releaseCompound(editor))} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[12px]">Pathfinder</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56 rounded-[2px] p-1">
            <Item label="Unite" disabled={editor.selection.length < 2} onSelect={() => run(A.pathfinderOp(editor, "unite"))} />
            <Item label="Minus Front" disabled={editor.selection.length < 2} onSelect={() => run(A.pathfinderOp(editor, "minusFront"))} />
            <Item label="Intersect" disabled={editor.selection.length < 2} onSelect={() => run(A.pathfinderOp(editor, "intersect"))} />
            <Item label="Exclude Overlap" disabled={editor.selection.length < 2} onSelect={() => run(A.pathfinderOp(editor, "exclude"))} />
            <DropdownMenuSeparator />
            <Item label="Minus Back" disabled={editor.selection.length < 2} onSelect={() => run(A.pathfinderOp(editor, "minusBack"))} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <Item label="Expand Shape" disabled={!A.hasShape(editor)} onSelect={() => run(A.expandShape(editor))} />
        <DropdownMenuSeparator />
        <Item label="Lock Selection" keys="mod+2" disabled={!has} onSelect={() => A.lockSelection(editor)} />
        <Item label="Unlock All" keys="mod+alt+2" onSelect={() => A.unlockAll(editor)} />
        <DropdownMenuSeparator />
        <Item label="Hide Selection" keys="mod+3" disabled={!has} onSelect={() => A.hideSelection(editor)} />
        <Item label="Show All" keys="mod+alt+3" onSelect={() => A.showAll(editor)} />
      </Menu>
      <Menu label="Type">
        <Item label="Left align" disabled={!texts.length} onSelect={() => setText({ align: "left" })} />
        <Item label="Centre align" disabled={!texts.length} onSelect={() => setText({ align: "center" })} />
        <Item label="Right align" disabled={!texts.length} onSelect={() => setText({ align: "right" })} />
        <DropdownMenuSeparator />
        <Item label="Bold" disabled={!texts.length} onSelect={() => setText({ fontWeight: texts[0].fontWeight >= 700 ? 400 : 700 })} />
        <Item label="Italic" disabled={!texts.length} onSelect={() => setText({ italic: !texts[0].italic })} />
        <DropdownMenuSeparator />
        <Item label="Type tool" keys="t" onSelect={() => editor.setTool("text")} />
      </Menu>
      <Menu label="Select">
        <Item label="All" keys="mod+a" onSelect={() => A.selectAll(editor)} />
        <Item label="Deselect" keys="mod+shift+a" disabled={!has} onSelect={() => A.deselect(editor)} />
        <Item label="Inverse" onSelect={() => A.invertSelection(editor)} />
        <DropdownMenuSeparator />
        <Item label="Same kind" disabled={!has} onSelect={() => A.selectSameType(editor)} />
      </Menu>
      <Menu label="Effect">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[12px]">Stylize</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48 rounded-[2px] p-1">
            <Item label="Drop Shadow…" disabled={!has} onSelect={() => A.applyEffect(editor, "shadow")} />
            <Item label="Inner Shadow…" disabled={!has} onSelect={() => A.applyEffect(editor, "innerShadow")} />
            <Item label="Outer Glow…" disabled={!has} onSelect={() => A.applyEffect(editor, "glow")} />
            <Item label="Inner Glow…" disabled={!has} onSelect={() => A.applyEffect(editor, "innerGlow")} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[12px]">Blur</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48 rounded-[2px] p-1">
            <Item label="Gaussian Blur…" disabled={!has} onSelect={() => A.applyEffect(editor, "blur")} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="text-[12px]">Shaders</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52 rounded-[2px] p-1">
            {SHADERS.map((s) => (
              <Item key={s} label={SHADER_LABEL[s]} disabled={!has} onSelect={() => A.applyEffect(editor, `shader:${s}`)} />
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <Item label="Remove all effects" disabled={!has} onSelect={() => A.clearEffects(editor)} />
      </Menu>
      <Menu label="View" width="w-64">
        <ViewMenuItems
          kind={editor.doc.kind}
          prefs={prefs}
          setPrefs={setPrefs}
          guideCount={guideCount(editor.doc)}
          onClearGuides={() => editor.commit((cur) => clearGuides(cur))}
          commands={commands}
        />
      </Menu>
      <Menu label="Window">
        {(
          [
            ["color", "Color"],
            ["swatches", "Swatches"],
            ["properties", "Properties"],
            ["appearance", "Appearance"],
            ["pathfinder", "Pathfinder"],
            ["layers", "Layers"],
            ["assets", "Assets"],
          ] as const
        ).map(([id, label]) => (
          <DropdownMenuCheckboxItem key={id} checked={panels[id]} onCheckedChange={() => onTogglePanel(id)} className="text-[12px]">
            {label}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        {(
          [
            ["problems", "Problems"],
            ["preview", "Preview"],
            ["submit", "Submit"],
          ] as const
        ).map(([id, label]) => (
          <DropdownMenuCheckboxItem key={id} checked={bottom === id} onCheckedChange={(on) => onBottom(on ? id : null)} className="text-[12px]">
            {label}
          </DropdownMenuCheckboxItem>
        ))}
      </Menu>
      <Menu label="Help">
        <Item label="Canvas editor guides" onSelect={() => onOpenGuides?.()} disabled={!onOpenGuides} />
      </Menu>
      {trailing && <div className="flex items-center gap-2 pl-2">{trailing}</div>}
    </div>
  );
}
