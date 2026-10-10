# Crystal Studio

A sub-app bundled with Crystal where creators make things to sell — cosmetics, packs
and lounge scenes — and send them to the Marketplace. It is the same Next app, the
same Clerk account, the same Convex backend and the same design system as Crystal;
it is a route (`/studio`) opened in its own window, like the profile canvas editor.

## What is new in the product

| Thing | Who makes it | Who buys it | What it does |
| --- | --- | --- | --- |
| **Lounge scene** (`loungeScene`) | creators, in Studio | a **community** (per server) | A picture, where the screen is, where the floor starts, seats, and interactive props (fire, lamps…). A manager puts it on a lounge channel. |
| **Theme pack** (`themePack`) | creators, in Studio | a **person** | A font, a colour theme, a sound pack and an icon set, applied to that person's client. |
| **Cosmetic pack** (a `bundle`) | creators, in Studio | a person | Several cosmetics (decorations, stickers, effects, nameplates) sold as one item. |

Existing creator cosmetics (decoration, sticker, effect, nameplate, community theme)
are made in Studio too — in Studio's own editor, not the profile canvas editor. Nameplates and profile
effects can now be **animated**: they are drawn in the canvas editor and moved in a timeline editor (see
"Animated nameplates and profile effects").

## Where projects live

Desktop app: `~/Documents/Crystal Studio/<Project name>/`

```
<Project name>.crysproj      settings + the list of assets (TOML)
<Project name>.<ext>         the design itself (JSON) — for design kinds
assets/                      every picture, font, sound and icon the design uses
```

Extensions and bots are not designs: they are plain TypeScript projects (see "Code projects" below), and
their `.crysproj` holds only what the Marketplace and registration need.

| Kind | Design file |
| --- | --- |
| Theme pack | `.crystheme` |
| Avatar decoration | `.crysadc` |
| Profile sticker | `.crysprofs` |
| Nameplate | `.crysnp` — the artwork (a canvas document) and its timeline (a motion spec) |
| Profile effect | `.cryspfe` — the same; an older one that is only a picture still opens in the picture editor |
| Lounge scene | `.crysscene` |
| Cosmetic pack | `.cryscospck` |
| Extension | *(none — a code project)* |
| Bot | *(none — a code project)* |

- **Format and validation:** `src/studio/storage/format.ts` (pure; tested). Everything read back is
  treated as untrusted: files may be hand-edited, copied or from a newer version. A project that
  can't be read is reported in Studio and skipped, never fatal.
- **The folder follows the project's name** (made safe for macOS/Windows/Linux, numbered if taken).
  A project folder copied in Finder is given fresh ids so an id always means one project/file.
- **Disk access** is `electron/studioFs.ts`: paths are relative to the root and refused if they would
  leave it (`..`, absolute, odd characters, symlinks pointing out); only the Studio window may call
  it; writes are atomic; deleting a project moves it to the Trash.
- **Assets** are copied into `assets/` when added and uploaded to the CDN on *Submit*. One file is at
  most 10 MB (`CREATION_MAX_BYTES`); icons stay at 64 KB (they're SVG line art drawn through a mask).
- **From the browser:** projects made before this moved are copied to disk the first time the desktop
  app opens Studio. The browser copies are left in place.

## Code projects (extensions and bots)

`src/index.ts` is the code; `package.json` and `tsconfig.json` are what any editor or `npm` expects, so a
project opens in VS Code, goes in git and builds in CI. Studio adds `.crystal/sdk/<kind>/` (the SDK's source,
see `docs/EXTENSIONS.md`), a starter on that SDK, and a code workbench laid out as VS Code's (activity bar,
Explorer, Monaco, Problems / Output / Terminal, status bar) in the app's selected theme.

- **Files on disk are the truth.** Nothing is saved until the person says so (see "Saving" below); if
  something else changed a file (VS Code, git, a script in the terminal) Studio doesn't overwrite it and asks. Disk and terminal access are in
  `electron/studioFs.ts` / `studioTerminal.ts` (Studio window only; paths can't leave the root; the terminal's
  environment is scrubbed of secrets). Build is `electron/studioBuild.ts`.
- **Editor support** for Crystal's APIs: SDK types and docs through the TypeScript service, snippets, and for
  extensions Crystal's own lint (powers, forbidden code, imports, sites) as live problems.
- **Max upload 10 MB** in Studio; icons stay at 64 KB.
- **Open code projects stay mounted.** A project's terminals are real shells that are killed when the terminal
  unmounts, and its unsaved files live only in the editor, so switching tab (or to Explore or Reference) hides a
  code project's editor instead of unmounting it; closing the tab ends it. Designs keep their state in the project
  and in an undo history that outlives the editor, so they unmount as before (`src/studio/shell/mounted-editors.ts`).
  A hidden editor doesn't draw into the shared title bar (`EditorActiveContext`).
- **Handlers in files.** A new bot starts with `src/events`, `src/commands` and `src/buttons`, one small file each,
  found by `client.loadHandlers()` (`sdk/bot/handlers.ts`); an extension splits into files with `defineAction` /
  `defineOpen` and `ext.use()`. Both are conveniences over the plain APIs and can be mixed with them. Existing projects
  are never rewritten.

## Updating something that is live

Changing a live cosmetic, bot or extension sends the change for review and, once approved, **updates the existing
store page** instead of making a second one. What people see doesn't change until then; if it is turned down nothing
has happened to the live page. Rules are pure and shared (`convex/lib/listingUpdate.ts`, tested), so Studio, the server
and staff review agree.

- **Cosmetics, scenes, theme packs, packs.** `submitCreation` takes `updatesSkuId` (and `supersedes`, a submission of the
  creator's still waiting, which it replaces). The server refuses an update to a listing that isn't the creator's, isn't
  active, is a different kind of thing (`updateBlocker`), or already has an update waiting. Approving (`approveUpdate`)
  replaces name, description, grants and picture in place; the slug, category, share, position, featured flag and
  Stripe ids are untouched; the price is kept unless staff set one (the asked price is shown to them). Owners'
  entitlements are refreshed to the new artwork in batches (`refreshOwners`); what a person has equipped is their own copy
  and stays until they equip again. A kind an update drops is never taken from people who bought it. `myCreations` shows one
  row per listing (its newest approved submission).
- **Studio** remembers the last submission in the `.crysproj` (`[store]`: `submission_id`, `sku_id`, validated on read) and
  derives the state (`listingState`): first send, replace what is waiting, update, replace the waiting update, turned down.
  The link is saved the moment a send succeeds. A duplicate starts without it.
- **Extensions** are versioned already: a new version must be newer than every version sent (`versionBlocker`, numeric
  compare), the live version keeps being served until the new one is approved, a version still waiting is replaced by a new
  send (`replacePending`), and the extension's name/description/kind change on *approval* — they used to change on submit,
  putting unreviewed text on a live page.
- **Bots** gain a reviewed public listing. `visibility: "public"` always means approved; a request to go public, or a change to
  a public bot's name, description or picture, is held in `bots.pending` (`planBotUpdate`) and applied by staff
  (`adminReviewListing`, Admin ▸ Bot listings). Permissions, commands, endpoint and redirects aren't part of the listing and
  still change at once (asking for more changes nothing until a manager grants it). Existing public bots are unaffected.

## Saving

Only theme packs autosave (they are edited with sliders whose every tick is a change). Everything else — the
canvas and timeline editors, extensions, bots, packs — is saved with Ctrl/⌘+S, File ▸ Save, the Save button, or
Build/Run (which save first). A dot on a tab marks unsaved changes; closing asks. The window warns before it is
closed or reloaded with unsaved work (`beforeunload`; a Leave/Stay dialog in the desktop app).

## Explore: the guides

The Explore tab (activity bar) holds the canvas editor's guides and the written SDK guides together, with one
search. Canvas topics are data drawn from the code that defines tools and shortcuts
(`src/studio/explore/content.ts`); the SDK guides are Markdown (`src/studio/docs/content`) with tables read
from the code and samples that are compiled in the tests (`bun run test:studio`). Staff edit or add pages in
the Admin Console under **Studio guides**, no release needed. The editors' Help menus open the right guide.

## The Reference tab

The **Reference** tab (activity bar) lists every class, function, constant, interface and type of the Bot SDK and the
Extension SDK with its signature and documentation, searchable, with types linking to each other. It is *generated
from the SDKs* (`scripts/build-reference.mjs`, the TypeScript 5 compiler API via the `typescript5` dev dependency) into
`src/studio/docs/reference.generated.ts`, so it cannot name something that doesn't exist or give it another signature;
what it says about a thing is its doc comment, so the way to improve it is to write a better comment in the SDK.

- `bun run reference` regenerates it; it is also regenerated by `prepare-studio-assets` (dev/build/postinstall) and
  checked by `bun run test:studio`, which fails if it is stale, if a public item or member has no documentation, if a
  runtime export is missing from it, or if a comment contains an at-sign that TypeScript would take for a tag (it cuts
  the description short, here and in editor hovers).
- The editors' Help menus have "Bot SDK reference" / "Extension SDK reference" (`openReference`), and an address such as
  `bot/Client.on` opens at that member.
- After changing an SDK, bump its version in `sdk/<kind>/package.json` so existing projects get the new copy.

## Principles

1. **Projects are local.** A Studio project lives on the creator's device, as ordinary files
   (see "Where projects live" below). Nothing leaves it until they press *Submit*, which is also
   when its asset files are uploaded.
2. **The server never trusts a spec.** Submission takes a *spec* (JSON) and rebuilds
   the grant server-side: every number clamped, every URL checked to be on our CDN
   in the uploader's own folder, every colour/identifier matched against a strict
   pattern. The same rules are exported from `convex/lib/creationSpecs.ts` so Studio
   validates live while you edit and the server has the last word.
3. **Everything goes through review.** A submission is a `marketplaceSubmissions`
   row; staff approve it into a SKU exactly as they do today.
4. **Buying is unchanged.** A scene is a community SKU (the purchase dialog already
   asks which community); a theme pack is a personal SKU. Both write ordinary
   entitlements.
5. **Studio looks like Crystal.** Same tokens, same components, same theme; a
   VS Code / Figma layout: activity bar, explorer, tabbed editor, inspector, bottom
   panel, status bar.

## The Studio editor

One new editor, used for both cosmetics and scenes — a design tool, not a form. Nothing
from `LayerEditor`/`LayerCanvas` is reused; it is built on its own document model so it
can do what those can't (groups, snapping, undo history, scene objects).

- **Document** — a flat map of typed nodes plus an ordered tree: `frame` (artboard),
  `group`, `image`, `shape` (rect/ellipse/line, fill, stroke, radius), `text`, and, in a
  scene document, the scene objects: `screen` (where a stream shows), `floor`, `seat`,
  `prop` (fire, lamp, …), and `zone` (walkable area); and paths (`path`: anchors with Bézier handles, optionally a
  brush or a live polygon/star). Each has a transform
  (x, y, w, h, rotation), opacity, lock/hide and a name.
- **Canvas** — infinite pan/zoom surface (wheel/trackpad, space-drag, zoom-to-fit),
  with the artboard (an avatar square, a profile card, a 16:9 room…) drawn on it and the
  intended **safe/clip area** shown. Selection with move/resize/rotate handles,
  multi-select + marquee, shift-constrain, alt-duplicate-drag, arrow-key nudge, and
  **snapping** to the artboard, guides and other nodes with visible guide lines.
- **History** — every change is a command; undo/redo are unlimited within a session and
  the history is saved with the project.
- **Panels** — Layers (drag to reorder, group, lock, hide, rename), Inspector
  (transform, fill/stroke, text, scene-object properties), Assets (imported pictures,
  fonts, sounds), and a toolbar (select, hand, shape, text, image, and in scenes: screen,
  seat, prop, floor).
- **Drawing** — Pen, Paintbrush (`B`), Line, Polygon and Star in *every* kind of design, including lounge scenes,
  nameplates and profile effects. Fills and outlines can be a colour, a gradient or a **material**; effects include
  drop and inner shadow, outer and **inner glow** (with Glow looks such as neon) and shaders.
  - **Materials** (`src/studio/model/material.ts`): twelve procedural textures (wood, marble, stone, brick, metal,
    leather, fabric, carbon fibre, ice, lava, glitter, parchment) with ~30 presets. Made from value noise and a seed,
    so the same material is the same pixels at any size and in the editor, the store picture and what is sent. They are
    rendered to a picture on submit, like gradients.
  - **Brushes** (`src/studio/model/brush.ts`): tapered, calligraphy, ink, chalk, spray, and stamped dots, stars,
    hearts and sparkles. A brush turns a stroke into polygons filled in the stroke's paint; a freehand drag is
    smoothed into a Bézier path with few anchors (`fitFreehand`). Same stroke, same marks.
- **Compile** — the document compiles to what the app already renders: cosmetics to the
  layer JSON that the avatar/profile renderers draw, scenes to a `SceneSpec`. Anything
  the renderers cannot draw is flagged live in the *Problems* panel (e.g. "blend modes
  aren't supported by profile stickers") instead of failing at submission.
- **Preview** — the compiled output is drawn by the *real* renderers, in real contexts: an
  avatar in a member list, a profile card, a chat row; a lounge with people in it and a
  stream on the screen.

## Data

### Scene spec (`SceneSpec`, v1)

```
{ v: 1, backgroundUrl, screen: {x,y,w,h}, floorTop,
  seats:  [{x,y}]                      // ≤ 24, percent of the picture
  props:  [{id, kind, x, y, size, interactive}]   // ≤ 24
  lights: { dimOnShare, amount },
  overlay: [{url, x, y, w, h, opacity}]          // ≤ 40, drawn artwork, percent of the room
}
```

`overlay` is what a creator drew over the room picture: each piece is rendered to a PNG on submit (the same renderer as
the canvas, so materials, brushes and glows are right), uploaded, and placed in percent of the room. It is drawn above the
background and below the screen's glow, props and people, never takes clicks, and is optional (scenes made before it
existed have none). Only PNG, WebP and GIF are accepted, every address is checked like the background's, and numbers are
clamped (`normalizeSceneSpec`).

Everything is a percentage of the picture so a scene is the same room at any size.
`kind` is one of a fixed catalogue of animated props the client already knows how to
draw — `fire`, `lamp`, `neon`, `discoball`, `fireflies`, `snow`, `steam`, `candle`.
A creator chooses and places them; they cannot ship code. An **interactive** prop
can be clicked by anyone in the lounge (the fire flares, the lamp toggles); the state
travels between the people in the room as small LiveKit data packets, like movement.

### Motion spec (`MotionSpec`, v1): animated nameplates and profile effects

A timeline of clips on lanes, played live by the app on a canvas — resolution-independent and a few KB, instead of a
video. `convex/lib/motion.ts` is pure (no Convex, no DOM) and shared by three places: the server (checks and
normalises a submission; the authority), Studio (edits and previews with the same functions) and the app (samples a
frame to draw). A frame is a pure function of the spec and the time: particles are closed-form, so scrubbing, seeking
and looping always show the same picture.

```
{ v: 1, kind: "effect" | "nameplate", stage: {w,h}   // fixed by the kind: 600×700 / 960×176
  duration (≤ 12 s), loop: { mode: "loop" | "once", rest },
  clips: [{ track, start, duration, in, speed (number or ramp), reverse, loop,
            source: image | shape | text | solid | gradient | noise | shimmer | rays | particles | compound | adjust,
            transform: x, y, scaleX, scaleY, rotation, opacity — each a number or keyframes (+ easing),
            blend, fx: [blur, glow, shadow, adjust, tint], mask, transitionIn, transitionOut }] }
```

- **Limits** (`MOTION_LIMITS`): 96 clips, nesting depth 3, 24 pictures, 6 effects per clip, 64 keys per property,
  400 particles per emitter. Colours are hex only, enums are matched against lists, numbers clamped, text has no control
  characters, and every picture address must be on the CDN in the creator's folder. There is no code or CSS in a spec.
- **Publishing** (`convex/motion.ts`): the creator's browser renders each canvas layer to a PNG (the canvas renderer) and
  uploads it; the `publish` action then runs the spec through the same normaliser, writes *the checked copy* to
  `marketplace/motion/<sha256>.json` and returns the address. The file is content-addressed and immutable, so what is at a
  published address is exactly what was checked. A grant (`nameplate`, `profileEffect`) carries that address as its payload
  (`isMotionAddress`); a picture or clip is still accepted as before. A design that never changes is sent as a plain picture.
- **Playing** (`src/components/motion/motion-player.tsx`, `src/lib/motion-render.ts`): one shared frame loop for all
  players; off-screen and hidden-tab players do nothing; at most eight animate at once (the rest show a still frame); a
  nameplate runs at 24 fps and a smaller size; "reduce motion" shows a still frame. The app fetches the file, normalises it
  again, and refuses pictures from another origin. `Nameplate` and `ProfileEffectLayer` pick the player by the address.
- **Studio** (`src/studio/motion/`): a Canvas tab (the canvas editor) and an Animate tab laid out like Final Cut Pro —
  Browser, Viewer with transform handles, Inspector, Timeline. Every canvas layer is a *layer clip* (`syncLayers`, with a
  stable id derived from the layer's id); clip operations (split, trim, move, ripple, retime, compound clips, snapping,
  keyframes and easing) are pure functions in `ops.ts`, tested on their own.

### Theme pack spec (`ThemePackSpec`, v1)

```
{ v: 1, font?: {family, url, format}, theme?: {isDark, colors: {token: colour}},
  sounds?: {callJoin: url, message: url, …}, icons?: {video: svgUrl, …} }
```

- **Font** — a `woff2`/`woff`/`ttf` on our CDN; applied with `@font-face` and `--font-sans`.
- **Theme** — only whitelisted design tokens, only plain colours (no `url()`, no `;`).
- **Sounds** — keyed by the app's `UiSound` names; short clips.
- **Icons** — keyed by lucide icon name; an SVG used as a CSS mask on `svg.lucide-<name>`,
  so it inherits `currentColor` and the app's own sizes. No component changes.

Applied by a `ThemePackProvider` from the user's equipped pack (`users.themePackId`
→ entitlement), so it follows the person across devices.

### Cosmetic pack

A `bundle` SKU with several creator grants (decoration, sticker, effect, nameplate).

## Phases

1. **Backend** — spec validators, schema, `submitCreation`, approve for multi-grant
   packs, `equip`/`unequip` for theme packs, scene application with the full spec,
   CDN upload types for fonts/audio/SVG.
2. **Runtime in Crystal** — scenes with seats + props in the lounge; the theme-pack
   provider (font, tokens, sounds, icons); shop and collection support for the new kinds.
3. **Studio** — shell, project store, scene editor, theme-pack editor, cosmetic
   editor (new — not the profile `LayerEditor`), pack composer, submission panel, previews,
   Electron window and entry points.

## Out of scope for now

- Cloud sync of projects; sharing a project with another creator.
- Code *in designs*. Theme packs, scenes and cosmetics are data, never code. Extensions and bots are code
  projects with their own kinds — see "Code projects" above and `docs/EXTENSIONS.md`.

## Status

**Built** (typechecks; the canvas was exercised in a browser — select, drag, resize, undo, the real-renderer
preview — but not signed in, and nothing has been submitted end to end):

- **Studio** at `/studio`, opened from Settings → Creator and Marketplace → My creations (its own window in the
  desktop app). Activity bar, project explorer, tabs, editor, bottom panel (Problems / Preview / Submit),
  status bar. Same account, theme and components as Crystal.
- **Projects on disk** (desktop app), saved on request (theme packs autosave); duplicate/delete (delete moves to the Trash). On the web,
  where a page can't write to a folder, projects stay in the browser's IndexedDB.
- **The editor** (new — nothing from the profile `LayerEditor`): typed node document, undo/redo history that
  survives switching tabs, pan/zoom, selection with move/resize/rotate, marquee, snapping with guides,
  alt-drag duplicate, clipboard, nudge, layers panel (drag to reorder, lock, hide, rename), inspector,
  alignment, drop-in pictures.
- **Cosmetics**: decorations and stickers (shapes, text, pictures) compiled to the app's layer format, with
  its limits checked live; previews drawn by the app's own layer renderer at real sizes.
- **Scenes**: background, screen, seats, floor line, eight animated props (some interactive), dim-on-share;
  previewed as a room with people sitting in it.
- **Nameplates and effects**: drawn in the canvas editor and, optionally, animated in the timeline editor (see the
  motion spec); an older one that is only a picture still works. **Theme packs** (colours, font, sounds, icons), **cosmetic
  packs** (several projects sold as one).
- **Submission**: free or paid, the server's own rules run locally as a checklist, files uploaded once each,
  a store picture drawn where the design has none, then `submitCreation`. Staff review as before.
- **In Crystal**: shop/collection support for scenes and theme packs; a theme pack can be applied (font,
  colours, sounds, icons) and removed; bought scenes are chosen in a lounge channel's settings.

**CDN requirement:** fonts and SVG icons are loaded cross-origin (`@font-face`, CSS `mask`), so the R2/CDN
bucket has to send `Access-Control-Allow-Origin` for them (the app's origins, or `*` for these public files).
Without it a pack's font and icons silently don't apply.

**Not built:** code extensions (see `docs/EXTENSIONS.md`); cloud sync of projects; a staff-side preview of
scenes, packs and animated designs in the console's submission review (it shows the store picture, the data and, for a
scene, the drawn overlay); a real-account run of the animation editor's publish step and of an animated design in the
app's profile cards (both are covered by tests of the pure parts and a browser run of the editor, not by a signed-in
submission); multi-selection resize in the timeline.
