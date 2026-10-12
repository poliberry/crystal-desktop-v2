import { MAX_FONT_FACES, PACK_BACKGROUND_DEFAULTS, PACK_BACKGROUND_EXTENSIONS, PACK_SOUNDS, SCENE_BACKGROUND_EXTENSIONS, SCENE_LIMITS, SCENE_PROP_KINDS, THEME_TOKENS } from "../../../convex/lib/creationSpecs";
import { MOTION_LIMITS, MOTION_STAGES } from "../../../convex/lib/motion";
import { MAX_LAYERS } from "../../../convex/lib/cosmeticLayers";
import { ARTBOARDS } from "@/studio/model/doc";
import { DOC_EXT } from "@/studio/storage/format";
import { KIND_LABEL, type Project, type ProjectKind } from "@/studio/model/types";

/**
 * The files that let an AI agent work in a Studio project: instructions it reads on its own, skills it can load, and the
 * configuration that starts Studio's MCP server (agent-kit/mcp-server.mjs).
 *
 * They are the same for every kind of project apart from what the project is made of, and they are written by Studio, not
 * by the person, so each carries a marker and a version: Studio refreshes a file it wrote when its own text is newer, and
 * leaves alone one the person has taken over by removing the marker. Nothing here is secret and nothing is executed by
 * Studio itself; the MCP server only reads.
 *
 * Every number quoted is imported from the code that enforces it, so the text can't drift from the rules.
 */

/** Bumped when any text below changes, so projects written by an older Studio are refreshed. */
export const AGENT_FILES_VERSION = 3;

/** Where Studio puts the MCP server in a project, and what starts it. */
export const MCP_DIR = ".crystal/mcp";
export const MCP_COMMAND = { command: "node", args: [`${MCP_DIR}/server.mjs`] } as const;
export const MCP_NAME = "crystal-studio";

const MARKER = (v = AGENT_FILES_VERSION) => `<!-- crystal-studio:managed v${v} — written by Crystal Studio; delete this line to take the file over and Studio will leave it alone -->`;
export const MARKER_PATTERN = /crystal-studio:managed v(\d+)/;

const designExt = (kind: ProjectKind): string | null => (kind in DOC_EXT ? DOC_EXT[kind as keyof typeof DOC_EXT] : null);

// --- Skills --------------------------------------------------------------------------------------------------

interface Skill {
  /** The folder name, and `name:` in the front matter: lower-case letters, digits and hyphens. */
  name: string;
  description: string;
  body: string;
}

const GENERAL: Skill = {
  name: "crystal-studio",
  description: "Work in a Crystal Studio project folder: what the files are, what not to touch, and how to check and ship it. Use whenever the current folder contains a .crysproj file.",
  body: `# Crystal Studio projects

A Crystal Studio project is a folder. Studio (the desktop app) shows it as a project; you are editing the same files.

## The files

- \`<Name>.crysproj\` — the project's settings and the list of its files, in TOML. Its \`kind\` says what the project is.
- \`<Name>.<ext>\` — the design itself, JSON, for every kind except bots and extensions (their code is in \`src/\`).
- \`assets/\` — pictures, fonts and sounds the design uses. Each is listed in the \`.crysproj\` under \`[[assets]]\` with an \`id\`; a design refers to a file by that id, never by path.
- \`.crystal/\` — **Studio's own files** (the SDK copy, this MCP server and its documents). Studio keeps them current. Never edit them.

## Rules that matter

1. **Read before you write.** Use the \`crystal-studio\` MCP server: \`project_info\` first, then \`search_docs\`, \`read_doc\`, \`sdk_reference\` and \`format_source\`. The file formats and limits are enforced by the store's server, so a guess that "looks right" can be refused when it is submitted.
2. **Check after you edit.** Call \`check_project\`. It finds unreadable files, a design that disagrees with its project file, and files the design uses that the project doesn't list. Studio's **Submit** panel runs the store's own checks, which are stricter.
3. **Don't invent assets.** You can't make a picture, font or sound by writing text. If the design needs one, say so and ask the person to import it in Studio; then refer to it by its listed \`id\`.
4. **Never put a secret in a file.** Bot tokens and signing secrets go in \`.env\` (which must be in \`.gitignore\`), never the \`.crysproj\` or code.
5. **You can't publish.** Submitting for review is done by the person in Studio's Submit panel. Don't claim something is live; say it is ready to submit.
6. **Prefer the editing tools to hand-editing JSON.** For designs the server offers tools that draw, animate and generate effects (\`describe_design\`, \`add_node\`, \`add_effect\`, \`animate\`, \`move_clip\`, \`set_theme_colors\`, …). Each is validated by the store's own rules, tells you if a value was changed to fit, and can be undone with \`undo_last_change\`. Call \`describe_design\` first and again afterwards, and \`sample_design\` to check that something moves the way you meant. Studio picks the change up when its window is next focused; a project with unsaved changes in Studio is left as it is there.
7. Keep \`id\` fields unique inside a design, keep the project file's \`kind\` equal to the design file's \`kind\`, and don't rename or move the \`.crysproj\` and design file apart.`,
};

const COSMETIC: Skill = {
  name: "crystal-cosmetic",
  description: "Edit a Crystal avatar decoration, profile sticker, nameplate or profile effect project. Use for .crysadc, .crysprofs, .crysnp and .cryspfe files.",
  body: `# Cosmetics: decorations, stickers, nameplates, profile effects

The design file is JSON: \`{ "format": 1, "kind": "<kind>", "doc": { … } }\`, and for nameplates and profile effects also \`"motion": { … }\`.

| Kind | File | Artboard (w × h) | What it is |
| --- | --- | --- | --- |
| decoration | .${DOC_EXT.decoration} | ${ARTBOARDS.decoration.w} × ${ARTBOARDS.decoration.h} | Drawn around a profile picture; the avatar is the whole artboard, art may reach past it by a margin. |
| sticker | .${DOC_EXT.sticker} | ${ARTBOARDS.sticker.w} × ${ARTBOARDS.sticker.h} | Placed from the top edge of a profile card. |
| nameplate | .${DOC_EXT.nameplate} | ${ARTBOARDS.nameplate.w} × ${ARTBOARDS.nameplate.h} | A strip behind a name; the app fades and dims it, so keep it subtle and keep the left clear of text. |
| effect | .${DOC_EXT.effect} | ${ARTBOARDS.effect.w} × ${ARTBOARDS.effect.h} | Covers the profile card like \`object-fit: cover\`. |

## The document (\`doc\`)

\`artboard\` (the numbers above — keep them), \`nodes\` (an object keyed by id), \`order\` (ids, **bottom first**; every id must exist in \`nodes\` and each node should appear once). Node types: \`image\`, \`shape\`, \`text\`, \`path\`. Positions and sizes are in artboard units. Read \`format_source\` → \`types.ts\` for every field.

- Decorations and stickers go to the server as at most **${MAX_LAYERS} layers**; a gradient, shadow, glow, blur, shader, brush or material is rendered to a picture when the design is compiled, and counts as an image layer.
- An \`image\` node has an \`assetId\` from the project's asset list.

## Animation (\`motion\`, nameplates and profile effects)

A timeline of clips on tracks with keyframes, effects, masks and transitions; a frame is a pure function of time, so particles are closed-form (no simulation). Limits: at most **${MOTION_LIMITS.duration} s**, **${MOTION_LIMITS.clips} clips** (nested included), nesting depth **${MOTION_LIMITS.depth}**, **${MOTION_LIMITS.keys} keyframes** per property, **${MOTION_LIMITS.images} distinct pictures**, **${MOTION_LIMITS.fx} effects** per clip, **${MOTION_LIMITS.particles} particles** alive per emitter. Stage: nameplate ${MOTION_STAGES.nameplate.w} × ${MOTION_STAGES.nameplate.h}, effect ${MOTION_STAGES.effect.w} × ${MOTION_STAGES.effect.h}. Colours are hex; nothing in a design is code or CSS. A picture on the timeline is the address \`studio:asset/<asset id>\`.

Read \`format_source\` → \`motion.ts\` before writing clips by hand: the shapes are strict and the server normalises (and may reject) anything outside them.

## Tools for making these

- Canvas (all four kinds): \`add_node\` (rect, ellipse, star, polygon, text, image), \`set_node\` (position, size, rotation, opacity, colours, gradients), \`remove_node\`. Positions are in the artboard's units, top-left origin.
- Animation (nameplates and profile effects): \`list_presets\`, then \`add_effect\` (sparkles, snow, embers, confetti, hearts, bubbles, aurora, shimmer, rays…), \`add_title\`, \`add_clip\` for full control, \`animate\` (keyframes on x, y, scaleX, scaleY, rotation or opacity), \`move_clip\` (from/to across the stage), \`add_clip_fx\`, \`set_transition\`, \`set_clip\`, \`set_timeline\`, \`remove_clip\`. On the timeline x and y are offsets from the stage's **centre**, y grows downwards, and times are seconds. \`sample_design\` reports where everything is at a given moment. A profile effect can have an **intro**: \`set_timeline\` with \`loopFrom\` makes the first seconds play once when the profile is opened, and only what follows loops while it stays open — so build the opening (a flash, rings, a burst) in the intro, fade the idle layers up under it, and make the idle repeat exactly (particle lives that divide the idle's length). The library's effects are built this way, in layers, with an intro of their own; \`add_effect\` into an empty design sets all of it up.
- A layer drawn on the canvas gets its timeline clip automatically; \`remove_clip\` on one hides the layer so it doesn't return.`,
};

const SCENE: Skill = {
  name: "crystal-scene",
  description: "Edit a Crystal lounge scene project (.crysscene): the room picture, screen, seats, floor and props.",
  body: `# Lounge scenes

Design file \`.${DOC_EXT.scene}\`, artboard ${ARTBOARDS.scene.w} × ${ARTBOARDS.scene.h}. Nodes are the room's picture (an \`image\` node with \`role: "background"\`; ${SCENE_BACKGROUND_EXTENSIONS.join(", ")}), drawn artwork laid over it, and scene objects:

- \`screen\` — where a stream is shown.
- \`seat\` — where someone sits; the node's centre is where their feet go. At most **${SCENE_LIMITS.seats}**.
- \`floor\` — where the floor starts; only its height matters.
- \`prop\` — an animated prop from Crystal's catalogue, standing on its bottom-centre. At most **${SCENE_LIMITS.props}**. Kinds: ${SCENE_PROP_KINDS.join(", ")}. Don't make up a kind.
- Drawn artwork over the room: at most **${SCENE_LIMITS.overlay}** pictures.

Use \`add_scene_object\` (screen, seat, floor, prop), \`set_scene_dim\`, and \`add_node\` / \`set_node\` for drawn artwork.

\`scene\` in the document holds \`dimOnShare\` and \`amount\` (dimming the room while a stream plays). Read \`format_source\` → \`creationSpecs.ts\` for the exact spec.`,
};

const THEME_PACK: Skill = {
  name: "crystal-theme-pack",
  description: "Edit a Crystal theme pack project (.crystheme): colours, an app-wide background picture, a font, replacement sounds and icons, with optional light and dark looks.",
  body: `# Theme packs

Design file \`.${DOC_EXT.themePack}\`: \`{ "format": 1, "kind": "themePack", "themePack": { "theme"?, "background"?, "font"?, "sounds", "icons" } }\`. A pack changes how Crystal looks and sounds and cannot change what it does.

- **theme.colors** — token → a plain CSS colour (hex, \`rgb()\`, \`hsl()\`, \`oklch()\`): no \`url()\`, no \`;\` or \`}\`. Allowed tokens: ${THEME_TOKENS.join(", ")}. Leave a token out to keep the app's own.
- **theme.isDark** — which scheme \`colors\` is for. **theme.alt.colors** — an optional second palette for the other scheme. With \`alt\` the pack follows each person's light/dark setting; without it the pack forces its one scheme on. \`theme.template\` is Studio's own note, never sent.
- **background** — \`{ "assetId", "dim", "blur", "panels" }\`: a picture behind the whole app (\`assetId\` is a ${PACK_BACKGROUND_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")} asset). \`dim\` 0–90 (% of the theme's background colour laid over it), \`blur\` 0–24 (px), \`panels\` 30–100 (% opaque the app's panels are over it). Defaults ${PACK_BACKGROUND_DEFAULTS.dim} / ${PACK_BACKGROUND_DEFAULTS.blur} / ${PACK_BACKGROUND_DEFAULTS.panels}.
- **font** — a family name (letters, digits, space, - and _) and up to **${MAX_FONT_FACES}** files, each with a weight (100–900, in hundreds) and a style; a variable font is one file with a weight range. Files are \`assetId\` references to WOFF2, WOFF, TTF or OTF files.
- **sounds** — replace any of: ${PACK_SOUNDS.join(", ")}. WAV, MP3, OGG or M4A.
- **icons** — Lucide icon name (lower-case, hyphenated) → an SVG asset.

Use \`describe_theme\`, \`set_theme_colors\` (with \`scheme: "alt"\` for the second look) and \`remove_theme_variant\` rather than editing the JSON; each is checked by the store's validator before it is saved. Everything is checked by the server's own validator, which Studio also runs locally; read \`format_source\` → \`creationSpecs.ts\` (\`normalizeThemePackSpec\`) for the rules.`,
};

const PACK: Skill = {
  name: "crystal-pack",
  description: "Edit a Crystal cosmetic pack project (.cryscospck): several cosmetics sold together.",
  body: `# Cosmetic packs

Design file \`.${DOC_EXT.pack}\`: \`{ "format": 1, "kind": "pack", "pack": { "projectIds": [ … ] } }\`. A pack is a list of other Studio projects **on this computer**, by project id (the \`id\` in each one's \`.crysproj\`).

- At least two projects, and at most one of each kind.
- Lounge scenes and other packs can't go in a pack.
- Every project in it must pass its own checks; a problem in one is a problem in the pack.

You can't see the other projects from here, so ask the person which they want, and don't invent ids.`,
};

const BOT: Skill = {
  name: "crystal-bot",
  description: "Write or change a Crystal bot (TypeScript, @crystal/bot SDK) in a Studio bot project.",
  body: `# Crystal bots

An ordinary TypeScript project. \`src/index.ts\` creates the \`Client\` and logs in; \`src/events/\`, \`src/commands/\` and \`src/buttons/\` hold one handler per file, made with \`defineEvent\`, \`defineCommand\` or \`defineButton\` and found by \`client.loadHandlers()\`. A file starting with \`_\` is skipped, so helpers can sit beside them.

- Import from \`@crystal/bot\`. Its source is in \`.crystal/sdk/bot\` (don't edit it). Look things up with \`sdk_reference\` instead of guessing method names; \`read_doc\` the guides \`bots/first-bot\`, \`bots/events\`, \`bots/commands\`, \`bots/limits\`.
- Run: \`npm install\`, \`cp .env.example .env\`, fill the token and signing secret (shown once, when the person registers the bot in Studio), then \`npm start\`. Type-check with \`npm run check\`.
- Never write the token or signing secret anywhere but \`.env\`.
- The bot's description, who can add it, its permissions and its slash commands are the project's settings in the \`.crysproj\` (\`[bot]\`). Adding a command means adding both its settings entry and its handler file.
- Message, embed and component limits are in \`bots/limits\`; check before sending large content.`,
};

const EXTENSION: Skill = {
  name: "crystal-extension",
  description: "Write or change a Crystal extension (TypeScript, @crystal/extension SDK) in a Studio extension project.",
  body: `# Crystal extensions

An extension is **one script** that runs in Crystal's sandbox. \`src/index.ts\` is the code; it may import its own files (\`./like-this\`) but **no other packages**.

- Import from \`@crystal/extension\` (\`Extension\`, \`Panel\`, the \`ui\` builders, and \`storage\`, \`http\`, \`notify\`). Its source is in \`.crystal/sdk/extension\` (don't edit it). Use \`sdk_reference\` for exact signatures and \`read_doc\` for \`extensions/overview\`, \`extensions/powers\`, \`extensions/panels\`, \`extensions/limits\`.
- It can only do what it asks for: the "powers" (capabilities) and the sites it may talk to are settings in the \`.crysproj\` (\`[extension]\`). Ask for the least it needs, and add \`http\` sites explicitly.
- Type-check with \`npm run check\`. In Studio, **Run** tries it in the real sandbox and **Build** produces \`dist/extension.js\`, the script that is reviewed and published.`,
};

/** The skills that apply to a project: the general one, and the one for what it is made of. */
export function skillsFor(kind: ProjectKind): Skill[] {
  const specific: Record<ProjectKind, Skill> = {
    decoration: COSMETIC,
    sticker: COSMETIC,
    nameplate: COSMETIC,
    effect: COSMETIC,
    scene: SCENE,
    themePack: THEME_PACK,
    pack: PACK,
    bot: BOT,
    extension: EXTENSION,
  };
  return [GENERAL, specific[kind]];
}

const skillFile = (s: Skill): string => `---\nname: ${s.name}\ndescription: ${s.description}\n---\n${MARKER()}\n\n${s.body}\n`;

// --- Instructions every agent reads ------------------------------------------------------------------------------

function agentsMd(project: Pick<Project, "kind">): string {
  const skills = skillsFor(project.kind);
  const ext = designExt(project.kind);
  // No project name in it: a rename would leave it stale, and `project_info` says the name.
  return `${MARKER()}
# A Crystal Studio ${KIND_LABEL[project.kind].toLowerCase()} project

This folder is a project in **Crystal Studio** (the Crystal desktop app for making cosmetics, themes, scenes, bots and extensions). ${ext ? `The design is \`.${ext}\` (JSON) beside the \`.crysproj\` settings file.` : "The code is in \`src/\`; settings are in the \`.crysproj\`."}

## Before you change anything

1. Read the skills for this project: ${skills.map((s) => `**${s.name}**`).join(" and ")} (in \`.claude/skills/\` and \`.agents/skills/\`; the text is also summarised below).
2. Use the **${MCP_NAME}** MCP server if your tool has it (configured in \`.mcp.json\`, \`.cursor/mcp.json\`, \`.vscode/mcp.json\`, \`opencode.json\` and \`.gemini/settings.json\`). Start with \`project_info\`; look things up with \`search_docs\`, \`read_doc\`, \`sdk_reference\` and \`format_source\`; check your work with \`check_project\`. If your tool has no project-level MCP config (Codex, for one), add a stdio server named \`${MCP_NAME}\` running \`${MCP_COMMAND.command} ${MCP_COMMAND.args.join(" ")}\` from this folder.
3. Don't edit \`.crystal/\`: Studio owns it and overwrites it.

## Ground rules

- File formats and limits are enforced by Crystal's server. Look them up; don't guess.
- You can't create pictures, fonts or sounds by writing text; ask the person to import them in Studio, then refer to them by their listed id.
- Never put a token or secret in a file other than \`.env\`.
- Publishing is the person's step (Studio → Submit). Say "ready to submit", never "published".
- Run \`check_project\` after editing.
`;
}

const claudeMd = (): string => `${MARKER()}\n@AGENTS.md\n`;
const geminiMd = (): string => `${MARKER()}\n@AGENTS.md\n`;

function cursorRule(project: Pick<Project, "kind">): string {
  const s = skillsFor(project.kind);
  return `---\ndescription: Crystal Studio project: how to work in it\nalwaysApply: true\n---\n${MARKER()}\n\nThis is a Crystal Studio project. Read AGENTS.md, then the skills (${s.map((x) => x.name).join(", ")}) in .claude/skills/. Use the ${MCP_NAME} MCP server (.cursor/mcp.json) to look up formats and limits and to run check_project.\n`;
}

const copilotInstructions = (): string => `${MARKER()}\nThis is a Crystal Studio project. Follow AGENTS.md and the skills in .claude/skills/. File formats and limits are enforced by Crystal's server: look them up (the ${MCP_NAME} MCP server in .vscode/mcp.json has search_docs, read_doc, sdk_reference, format_source and check_project) rather than guessing. Don't edit .crystal/. Never put a token or secret in a file other than .env.\n`;

// --- MCP configuration, in each tool's own shape -----------------------------------------------------------------

const asJson = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;

/** How each tool names its MCP servers: the file, the object key that holds them, and the entry for ours. */
export const MCP_CONFIGS: { path: string; key: string; entry: unknown; extra?: Record<string, unknown> }[] = [
  { path: ".mcp.json", key: "mcpServers", entry: { ...MCP_COMMAND } },
  { path: ".cursor/mcp.json", key: "mcpServers", entry: { ...MCP_COMMAND } },
  { path: ".vscode/mcp.json", key: "servers", entry: { type: "stdio", ...MCP_COMMAND } },
  { path: ".gemini/settings.json", key: "mcpServers", entry: { ...MCP_COMMAND } },
  { path: "opencode.json", key: "mcp", entry: { type: "local", command: [MCP_COMMAND.command, ...MCP_COMMAND.args], enabled: true }, extra: { $schema: "https://opencode.ai/config.json" } },
];

/** A fresh MCP config file for one tool. */
export const mcpConfigText = (c: (typeof MCP_CONFIGS)[number]): string => asJson({ ...(c.extra ?? {}), [c.key]: { [MCP_NAME]: c.entry } });

/**
 * An existing config with our server added, or `null` when nothing should change: the file isn't JSON we can read,
 * isn't an object, or already has a server of that name (which the person may have edited).
 */
export function mergeMcpConfig(existing: string, c: (typeof MCP_CONFIGS)[number]): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(existing);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  const servers = root[c.key];
  if (servers !== undefined && (typeof servers !== "object" || servers === null || Array.isArray(servers))) return null;
  if (servers && MCP_NAME in (servers as object)) return null;
  return asJson({ ...root, [c.key]: { ...((servers as object | undefined) ?? {}), [MCP_NAME]: c.entry } });
}

// --- The whole set -----------------------------------------------------------------------------------------------

/** A text file Studio writes and keeps current (see `MARKER_PATTERN`). */
export interface ManagedFile {
  path: string;
  text: string;
}

/** Every instruction and skill file for a project, by path. The MCP configs are handled by `mergeMcpConfig`. */
export function managedFiles(project: Pick<Project, "kind">): ManagedFile[] {
  const files: ManagedFile[] = [
    { path: "AGENTS.md", text: agentsMd(project) },
    { path: "CLAUDE.md", text: claudeMd() },
    { path: "GEMINI.md", text: geminiMd() },
    { path: ".cursor/rules/crystal-studio.mdc", text: cursorRule(project) },
    { path: ".github/copilot-instructions.md", text: copilotInstructions() },
  ];
  // Claude Code and OpenCode read `.claude/skills`; Codex and others read `.agents/skills`. The same files in both.
  for (const dir of [".claude/skills", ".agents/skills"]) {
    for (const s of skillsFor(project.kind)) files.push({ path: `${dir}/${s.name}/SKILL.md`, text: skillFile(s) });
  }
  return files;
}

/** Whether a file Studio wrote earlier should be replaced by the current text: it still has the marker, and is older. */
export function shouldRefresh(existing: string): boolean {
  const m = MARKER_PATTERN.exec(existing.slice(0, 800));
  return !!m && Number(m[1]) < AGENT_FILES_VERSION;
}
