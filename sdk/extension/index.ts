/**
 * @crystal/extension — build extensions for Crystal.
 *
 * ```ts
 * import { Extension, Panel, ui, storage } from "@crystal/extension";
 *
 * const ext = new Extension();
 * const panel = new Panel((s: { count: number }) => ui.column([ui.heading(`Clicked ${s.count}`), ui.button("Click", "click")]), { count: 0 });
 *
 * ext.onOpen(async () => panel.setState({ count: (await storage.get<number>("count")) ?? 0 }));
 * ext.onAction("click", async () => {
 *   const count = panel.state.count + 1;
 *   await storage.set("count", count);
 *   panel.setState({ count });
 * });
 * ```
 *
 * Only what you import is bundled, so the powers your extension asks for can match exactly what it uses.
 */
import "./globals";

export { ActionContext, Extension, Panel, defineAction, defineOpen, type ActionHandler, type OpenHandler } from "./extension";
export { HttpResponse, http } from "./http";
export { notify } from "./notify";
export { storage } from "./storage";
export { ui, type Align, type ListItem, type TextVariant, type Tone, type UiNode } from "./ui";
