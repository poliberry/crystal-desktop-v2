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
are made in Studio too — in Studio's own editor, not the profile canvas editor.

## Principles

1. **Projects are local.** A Studio project lives on the creator's device
   (IndexedDB, blobs included). Nothing leaves it until they press *Submit*.
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
  `prop` (fire, lamp, …), and `zone` (walkable area). Each has a transform
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
  lights: { dimOnShare, amount } }
```

Everything is a percentage of the picture so a scene is the same room at any size.
`kind` is one of a fixed catalogue of animated props the client already knows how to
draw — `fire`, `lamp`, `neon`, `discoball`, `fireflies`, `snow`, `steam`, `candle`.
A creator chooses and places them; they cannot ship code. An **interactive** prop
can be clicked by anyone in the lounge (the fire flares, the lamp toggles); the state
travels between the people in the room as small LiveKit data packets, like movement.

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
- Animated scene backgrounds (video).
- Code. Theme packs, scenes and cosmetics are data, never code. Custom components, plugins,
  integrations and bots are designed separately — see `docs/EXTENSIONS.md` — and come after
  the data-only Studio works end to end.

## Status

**Built** (typechecks; the canvas was exercised in a browser — select, drag, resize, undo, the real-renderer
preview — but not signed in, and nothing has been submitted end to end):

- **Studio** at `/studio`, opened from Settings → Creator and Marketplace → My creations (its own window in the
  desktop app). Activity bar, project explorer, tabs, editor, bottom panel (Problems / Preview / Submit),
  status bar. Same account, theme and components as Crystal.
- **Projects on this device** (IndexedDB), autosaved; files stored as blobs; duplicate/delete.
- **The editor** (new — nothing from the profile `LayerEditor`): typed node document, undo/redo history that
  survives switching tabs, pan/zoom, selection with move/resize/rotate, marquee, snapping with guides,
  alt-drag duplicate, clipboard, nudge, layers panel (drag to reorder, lock, hide, rename), inspector,
  alignment, drop-in pictures.
- **Cosmetics**: decorations and stickers (shapes, text, pictures) compiled to the app's layer format, with
  its limits checked live; previews drawn by the app's own layer renderer at real sizes.
- **Scenes**: background, screen, seats, floor line, eight animated props (some interactive), dim-on-share;
  previewed as a room with people sitting in it.
- **Nameplates and effects** (a picture each), **theme packs** (colours, font, sounds, icons), **cosmetic
  packs** (several projects sold as one).
- **Submission**: free or paid, the server's own rules run locally as a checklist, files uploaded once each,
  a store picture drawn where the design has none, then `submitCreation`. Staff review as before.
- **In Crystal**: shop/collection support for scenes and theme packs; a theme pack can be applied (font,
  colours, sounds, icons) and removed; bought scenes are chosen in a lounge channel's settings.

**CDN requirement:** fonts and SVG icons are loaded cross-origin (`@font-face`, CSS `mask`), so the R2/CDN
bucket has to send `Access-Control-Allow-Origin` for them (the app's origins, or `*` for these public files).
Without it a pack's font and icons silently don't apply.

**Not built:** code extensions (see `docs/EXTENSIONS.md`); cloud sync of projects; a staff-side preview of
scenes and packs in the console's submission review (it shows the store picture and the data); animated
(video) scene backgrounds; drawing tools beyond shapes/text/pictures; multi-selection resize.
