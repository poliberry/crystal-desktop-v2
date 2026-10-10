# Extensions: custom components, plugins, integrations and bots

Crystal Studio lets creators write code, not only data. Code someone else wrote runs
on other people's machines and touches other people's messages, so this document is
the threat model first and the feature second. **Nothing here ships until the sandbox
has been attacked by people other than its author.**

## What can be built

| Kind | Runs | Does |
| --- | --- | --- |
| **Component** | in the client, sandboxed | Custom UI for a surface Crystal exposes: a scene prop with behaviour, a profile widget, a channel header, a sidebar panel, a message embed. |
| **Plugin** | in the client, sandboxed | Adds behaviour inside Crystal for the person (or community) that installed it: commands, panels, reactions to events. |
| **Integration** | a service (theirs) + a manifest | Connects an outside service — feeds, alerts, game data — to a community, via Crystal's API and webhooks. |
| **Bot** | a service (theirs) | A member-like account driven over the Bot API. Reads and sends what its token is scoped to. |

All four are *published* through Studio: written and tested there, submitted, reviewed,
and installed from the Marketplace like any other item (some free, some paid, with the
same creator payouts).

## Threat model

An extension author is **untrusted**, and so is anything an extension fetches. They
may be malicious from the first version, or turn malicious in a later update. We defend
against:

1. **Stealing data** — messages, DMs, the token, the user's identity, other tabs.
2. **Acting as the user** — sending messages, joining/leaving, changing settings, spending money.
3. **Escaping** — reaching Crystal's own page, Electron's Node/IPC, the filesystem, other windows.
4. **Phishing & clickjacking** — drawing UI that imitates Crystal's (a fake login or payment prompt).
5. **Exfiltration** — sending anything it can see to a server of the author's.
6. **Abuse of our infrastructure** — SSRF via a proxy, crypto-mining, DoS, storage abuse.
7. **Supply chain** — a reviewed version replaced by a different one after review.
8. **Persistence** — surviving uninstall or revocation.

## The sandbox — client-side code

Extension code **never runs in Crystal's page, its origin, or any context with a DOM**.

- **Engine: QuickJS compiled to WASM, in a dedicated Web Worker.** A fresh VM per
  extension instance. No `window`, `document`, `fetch`, `XMLHttpRequest`, `WebSocket`,
  `localStorage`, `eval`-from-string against the host, timers beyond ones we inject,
  or anything else: the only globals are the language's own and the injected SDK.
  Hard limits: memory ceiling, an interrupt handler that kills a run past its CPU
  budget, and a budget on messages per second across the boundary. Over budget → the
  VM is killed and the extension is suspended, not retried.
  - The memory ceiling is two layers: QuickJS's own limit (objects) **and** a cap on the
    WebAssembly heap itself. QuickJS's limit alone does not count large string/array
    buffers (measured: 300 MB allocated against a 32 MB limit), so the heap cap is what
    actually bounds them.
  - The SDK takes the host doors (`__send`, `__call`) into its closure and deletes them
    from the global scope before the extension's code runs.
  - Verified in a real Electron 43 / Chromium 150 renderer (boot, UI, storage, timers,
    notifications, ungranted powers, hash mismatch, CPU/boot loops, both memory cases,
    call flood, hostile UI trees). Not yet run in a packaged build.
- **Why not iframes alone:** a sandboxed iframe is a real browser context — it can render
  anything, time side channels, and phish. We use one only where a creator needs a free
  pixel canvas (below), and then it is cross-origin (`sandbox="allow-scripts"` with *no*
  `allow-same-origin`, on a separate domain), a CSP of `default-src 'none'`, no
  top-navigation, no popups, and it can only post messages to the host.
- **UI is declarative.** An extension returns a *tree* describing what to show, made of a
  fixed set of Crystal's own components (stack, text, button, list, input, image from an
  allowed origin, chart…). **Crystal renders it** — with Crystal's theme, in a box
  Crystal draws a labelled border around (so it can't impersonate system UI), with no
  extension CSS, no raw HTML, no script. Interactions come back as events.
  Pixel-level surfaces (scene props, canvases) get a restricted 2D draw-list API
  rendered by the host onto a canvas it owns.
- **No network from the sandbox, ever.** Outbound requests go through a host proxy: only to
  origins in the manifest and approved at install, `https`, resolved server-side with
  private/loopback/link-local ranges refused (SSRF), no redirects off the allowlist,
  size/rate caps, no cookies or credentials forwarded, requests logged. Extensions that
  can read user content and talk to the network are flagged and reviewed hardest.
- **Code is content-addressed.** The bundle is stored at its hash; the client verifies the
  hash before it runs. Updating means a new hash and — if permissions grew or the code
  changed materially — a new review. A reviewed version cannot be swapped.

## Capabilities

An extension declares what it wants in its manifest; the person installing it (or the
community admin, for community-wide extensions) sees it in plain words and grants or
refuses each one. The **host checks every call**; the manifest is a request, not a
credential.

```
ui.panel · ui.widget · ui.messageEmbed · ui.sceneProp
messages.read:{channel|dm|none} · messages.send · messages.react
community.members.read · presence.read
storage (a small private key-value area, per extension per user) 
network:{origins}   (proxied; see above)
notifications · commands (slash-commands)
```

Never available to extension code: the auth token, other extensions' storage, files,
clipboard (reads), DMs unless the user grants it per-conversation, payments, account
settings, moderation actions, anything in Electron. Read access is *scoped and
minimised* — an extension sees the channels it was installed into, not everything.

## Bots (built)

A bot is an account (`users.isBot`) registered by an author (`bots`) and **added to a community by
someone with Manage Integrations** (`botInstalls`). It does what a member can do — messages, embeds and
buttons, moderation, roles and channels, emojis and soundboard clips, direct replies, presence, voice —
with exactly the authority it is given. The aim is parity with a Discord bot, with the authorisation
layer below; the guides creators read are in Studio's Explore tab (`src/studio/docs/content/bots`).

Code: `convex/lib/botAuth.ts` (the rules, pure and tested), `convex/lib/botAccess.ts` (the rules applied
to the live database), `convex/lib/botRoutes.ts` (every route, as data), `convex/botOps.ts` (every
operation), `convex/botHttp.ts` (HTTP at `/bot/v1/*`), `convex/botVoice.ts`, `convex/botDelivery.ts`
(events out), `convex/lib/botEvents.ts` (what fires when), `convex/bots.ts` (people: register, install,
commands, buttons), `convex/lib/embeds.ts` and `components.ts` (content validators).

- **Grantable permissions** are a fixed list of 16 (`BOT_PERMISSIONS`): view channels, send messages,
  join voice, create invites, mention everyone, manage messages, change nicknames, manage emojis and
  sounds, mute / deafen / disconnect members in voice, time out, kick and ban members, manage channels,
  manage roles. **Never grantable, to anyone including the owner:** Administrator, Manage Community,
  Manage Integrations (a bot installing bots would be a ladder), Manage Game Servers, Manage Events.
  Data access is granted separately as scopes: `messages.read`, `members.read`, `dm.send`.
- **You can only give what you hold.** The consent screen shows each permission in plain words; ones the
  installer lacks are disabled, and the server refuses them again, naming them. Nothing is trimmed
  silently: what was approved is what is granted.
- **A bot's authority is its authoriser's.** What it can do now = its channel permissions ∩ its grant ∩
  what the member who authorised it can *still* do. If they are demoted the bot shrinks immediately;
  if they leave or are banned it is refused with instructions until a manager authorises it again
  ("Authorise as me"). Giving a bot more makes the giver the authoriser.
- **A bot can't make something stronger than itself.** Roles it creates or edits, and channel
  overwrites it sets, can't hold a permission the bot doesn't (`grantableToRole`); it can *deny*
  anything but only *allow* what it holds.
- **A bot's role is its grant**, kept by the Bots tab (`roles.managedBotId`): the role editor refuses to
  edit, delete, duplicate or assign it. It sits just above @everyone, so a bot can only act on members
  below it until a manager moves it up (which the role editor already limits to people above it).
  Moderation actions also require the target to be below the bot's role; bots can't act on bots or the owner.
- **How a bot hears events.** With no endpoint (the default) the SDK long-polls `GET /bot/v1/events?after=<cursor>&wait=25`
  (`convex/botEvents.ts`, driven from `botHttp.ts`): events are queued in `botEvents` only for a bot that has asked within
  the last 90 s (`canReceive`), kept 5 minutes and capped at 500, so a bot that is switched off collects no backlog. The
  cursor is the last event's `_creationTime`; the first ask starts from now. A bot *with* an endpoint is pushed signed
  POSTs as before, and an ask from it answers `mode: "webhook"` so its SDK stops asking. This replaced "no endpoint = never
  told anything", which left bots registered without one silent.
- **Events** go only to bots that can see the channel and hold the scope the event needs (message events:
  `messages.read`; member joins/leaves: `members.read`). A bot isn't sent its own messages, reactions or
  voice joins. Slash commands and button presses are addressed to one bot and need no scope.
- **Tokens**: `cbt_<id>.<secret>`, 256 bits, only a SHA-256 is stored, shown once, rotatable.
  **Events** are signed (`X-Crystal-Signature: t=…,v1=hmac(t.body)`), verifiable with the signing secret,
  replay-limited to 5 minutes; delivery is https-only, no redirects, 5 s timeout, retried at
  5 s / 30 s / 2 min / 10 min (commands and buttons: 3 attempts), and switched off after 10 failed events
  in a row. **Rate limits**: 120 requests and 40 sends per bot per minute (`BOT_RATE`).
- **Direct messages** only as an answer: to someone who used one of the bot's commands or buttons in the
  last 15 minutes, in a community that granted `dm.send`; at most 3 per person per window.
- **Voice is audio and the soundboard only.** The LiveKit token a bot gets allows a microphone and nothing
  else (`canPublishSources: [MICROPHONE]`), and the API rejects a `streaming` voice state: no screen share,
  no camera, no stream. Uninstalling a bot evicts it from any room it is in.
- **Audit**: every action, refusal and install change is recorded (30 days) and shown to managers.
- **API** (`/bot/v1`): 56 routes covering the surface above; the list is `ROUTES` in `botRoutes.ts` and is
  rendered, with the limits, into the Bot API guide. Messages are up to 4,000 characters, 4 files of 10 MB,
  10 embeds and 5 rows of 5 buttons.
- **Studio**: the *Bot* project kind registers a bot, makes its token, tests its endpoint and writes a
  runnable starter on the SDK. The token and signing secret are never written to the project file.
- Verified: unit cases on the rules (`scripts/tests/bot-auth.test.mts`, `bot-content`, `bot-routes`), the SDK
  against a mock API (`bot-sdk.test.mts`), and end-to-end runs against the dev deployment including a real
  LiveKit room (screen share and camera refused; speaking works).

## Install links and deep links (built)

**Install links.** `https://usecrystal.app/oauth/authorize?client_id=…&scope=bot|extension` adds a bot to a
community or an extension to an account, as Discord's install links do. Code: `convex/lib/oauthLinks.ts`
(parse, build, redirect rules; pure, `scripts/tests/oauth-links.test.mts`), `bots.authorizeInfo` and
`extensions.installInfoBySlug` (what the page reads), `src/components/oauth/install-flow.tsx` (the screen,
shared by the web page `src/app/oauth/authorize` and the in-app dialog). A link **only asks**: the person
picks a community they hold Manage Integrations in and what to allow, and `bots.install` re-applies every
rule. The link's `permissions` can narrow what the bot registered for, never widen it, and permissions that
can never be granted are dropped when the link is read.
`redirect_uri` is followed only if it is one of the bot's registered `redirectUris` (exact match after
normalisation; https, or http://localhost), and what it carries back (`community_id`, `permissions`, `scopes`,
`state`) is *not* proof of install — the signed `bot.installed` event is. There is no code/token exchange:
nothing is issued to the site the person returns to.

**Deep links.** One parser, `electron/deeplink.ts` (tested: `deeplink.test.mts`), decides what is ours: https
links on `usecrystal.app` / `www.usecrystal.app` (and the old `crystal.poliberry.com` for invites already
posted) and the `crystal://` scheme. `crystal://auth/callback` is accepted in scheme form only. In the app:
a click on one of our links (message, window.open, navigation) is handled in-app instead of by the browser;
links arriving from the OS (argv, `open-url`, `second-instance`, macOS `continue-activity`) are queued in the
main process until the signed-in page says it can take them (`deeplinks.ready`), so one that arrives during
start-up or sign-in isn't lost. On the web, the invite and install pages try `crystal://` once per tab on a
computer and always show an "Open in the Crystal app" button.

**Deployed.** The website is the Cloudflare Pages project `crystal-web` (serves `usecrystal.app`); publish it with
`bun run deploy:web` (a preview URL) and `bun run deploy:web -- --production`, which print the Convex deployment
and Clerk instance the build is for before publishing. `public/_redirects` rewrites `/invite/<code>` to the invite
page (a static export has no dynamic segments) and `public/_headers` forbids framing `/oauth/*` and `/invite/*`.
The Bot API's address `api.usecrystal.app` is the Worker in `workers/api` (`bun run deploy:api`). Both currently
point at the *dev* Convex deployment, which is what the site was already built against; moving to production means
changing `NEXT_PUBLIC_CONVEX_URL` / Clerk for the site build and `CONVEX_SITE_URL` in `workers/api/wrangler.toml`.
What is still needed: *Real* universal links (an https link opening the app straight from another app, with no browser
step) need a macOS build signed with a Developer ID and provisioning profile carrying
`com.apple.developer.associated-domains = applinks:usecrystal.app`, plus
`/.well-known/apple-app-site-association` listing `<TEAMID>.dev.crystal.desktop` for `/invite/*` and
`/oauth/authorize`. Current builds are ad-hoc signed, where that entitlement would stop the app launching, so
it isn't added; the `continue-activity` handler is in place for when it is. Windows and Linux have no
equivalent for a desktop app, so the web page's hand-off is the mechanism there. The Bot API is served at
`https://api.usecrystal.app/bot/v1` by a small Worker (`workers/api`, tested by `api-worker.test.mts`) that
forwards `/bot/v1/*` to the backend's HTTP site and refuses every other path, so the backend's webhooks and
callbacks are not reachable through that name. Its one setting, `CONVEX_SITE_URL` in `workers/api/wrangler.toml`,
is the backend to use; `wrangler deploy` there publishes a change. The SDK uses this address by default.

## Extensions in Studio (built)

The *Extension* project kind is an ordinary TypeScript project (`src/`, `package.json`, `tsconfig.json`) in
`~/Documents/Crystal Studio/<name>/`, edited in the code workbench (Monaco, a file tree, a terminal).
The `.crysproj` holds only Marketplace settings (name, description, version, powers, sites); there is no
design file. Studio offers *Build* (esbuild bundles `src/` and the SDK into `dist/extension.js`, the single
script that is scanned, hashed, reviewed and shipped), a **test run in the real sandbox** (network
simulated, storage in memory), and *Send for review* (`extensions.submitVersion`; publishing stays
staff-only unless `EXTENSIONS_PUBLIC=1`).

`electron/studioBuild.ts` decides what may be bundled: relative imports of files inside `src`, and the one
package `@crystal/extension`. Any other import is refused with an explanation, so third-party code is never
bundled in unread. The bundle labels files by project path, never by a path on the author's computer.

## SDK (built)

Two TypeScript SDKs, in `sdk/`, copied into a project's `.crystal/sdk/<kind>/` by Studio so a creator can
read and step into the source (no network; refreshed when Studio carries a newer version):

- **`@crystal/extension`** — `Extension`, `Panel`, the `ui` builders, `storage`, `http`, `notify`, and
  `defineAction` / `defineOpen` with `ext.use(...)` for handlers in their own files. Only what is imported is bundled,
  so the powers an extension asks for can match what it uses.
- **`@crystal/bot`** — a discord.js-shaped client: `Client` (login, `listen`, `handleWebhook`, events,
  `command`, `button`), `Message`, `Channel`, `Community`, `Member`, `Role`, `EmbedBuilder` and buttons,
  `Permissions`, presence, `VoiceConnection` (via the optional `@livekit/rtc-node`), and file-based handlers:
  `defineEvent` / `defineCommand` / `defineButton` found by `client.loadHandlers(dir)` (`events/`, `commands/`,
  `buttons/`; files starting with `_` are skipped; duplicates and bad exports are errors that name the file; loading is
  all or nothing). `registerCommands()` with no argument registers the commands it found.

Every exported item and member has a doc comment, because the **Reference tab** is generated from them (see
`docs/CRYSTAL_STUDIO.md`); a test fails on an undocumented one. Don't write an at-sign followed by a word in a doc
comment — TypeScript reads it as a tag and cuts the description there (editor hovers too).

The project's `tsconfig.json` maps the package name to that folder (`paths`), so the same project opens in
VS Code or builds in CI. Edits to `.crystal/sdk` are overwritten by an update; bump the version in the SDK's
`package.json` to roll a change out to existing projects.

## Editor support (built)

Beyond TypeScript's own checks, the workbench lints an extension's source with Crystal's rules
(`src/studio/code/crystal-lint.ts`, tested): a power used but not asked for, code that builds code
(`DYNAMIC` in `extensionManifest.ts`, the same list the server scans with), imports the sandbox can't load,
and web addresses outside *Sites it may talk to*. They are Monaco markers, so they underline and join the
Problems list. Snippets for the common shapes of each SDK are offered as completions
(`crystal-snippets.ts`). The build still runs the server's own scan on the finished script, which is what
counts.

## Guides and reference (built)

Studio's **Reference** tab is the generated, searchable API reference for both SDKs (see `docs/CRYSTAL_STUDIO.md`). The
Explore tab carries guides for both SDKs next to the canvas editor's. They are Markdown in
`src/studio/docs/content/`, compiled into the app by `scripts/build-guides.mjs`; tables of permissions,
routes and limits are *read from the code that enforces them* (`{{bot-permissions}}`, `{{bot-routes}}`,
`{{extension-limits}}`…, see `src/studio/docs/facts.ts`), and every code sample is type-checked against the
SDK it is about (`scripts/tests/guides.test.mts`). Staff can edit a shipped page or add one in the Admin
Console (**Studio guides**, permission `docs.write`): a saved page with a shipped page's address replaces it
for everyone, removing it brings the shipped one back; drafts, a 20-version history and an audit trail are
kept (`convex/studioDocs.ts`).

## Bots and integrations — server-side (original design)

We do **not** run untrusted code on our servers in v1. Bots and integrations run on the
author's infrastructure and talk to Crystal over:

- a **Bot API** (HTTP) and **Gateway** (WebSocket) — a bot account with a scoped token, the
  community's permission system applied to it like any member, rate-limited and audited;
- **webhooks** (signed, retried) both ways;
- **interactions** — slash-commands and buttons delivered as signed HTTP requests.

A hosted bot runtime (Cloudflare Workers for Platforms — per-script isolates, which fits
our Cloudflare footprint) is a *later* phase, after the client sandbox has proven itself.

## Later: a simulated community

Still to build: a local runner with a *simulated community* to test a bot against, a permission inspector,
and a profiler showing CPU/memory against the budget.

## Review & trust

1. **Automatic, on submit** — manifest schema; size caps; the bundle must parse as our
   restricted subset (no dynamic code generation, no host-object access attempts);
   static scan for known abuse patterns; declared permissions vs. calls actually made
   (a call to a capability not declared fails the build); dependency allowlist.
2. **Human review** — every first submission, every update that adds a capability or
   network origin, and anything touching `messages.read` + `network`.
3. **Publisher verification** — a verified identity for anyone shipping code; strikes
   and bans; extensions are attributable.
4. **After release** — user reports; **a kill switch** (staff can revoke an extension or a
   single version everywhere, effective on the next heartbeat — clients check the
   revocation list at start-up and periodically); crash and budget telemetry; an
   extension that is killed repeatedly is suspended automatically.
5. **Uninstall means gone** — its storage is deleted and its grants revoked; nothing
   persists outside the sandbox.

## Phasing

Code execution is added **after** the data-only Studio (cosmetics, scenes, theme packs)
works end to end.

1. Studio v1 — data creations (in progress).
2. **Extension runtime, staff-only** — the QuickJS worker, bridge, declarative UI,
   capability checks, content-addressed bundles, kill switch. Only staff-published
   extensions load. Internal red-team and an external security review before step 3.
3. **Components & plugins, public** — Studio code editor + SDK + review pipeline; free first,
   paid after the review process has had real volume.
4. **Bot API & Gateway, integrations** — then hosted bots.

## Decisions to confirm

- QuickJS-in-Worker + declarative UI as the *only* client execution model (rather than
  letting extensions use iframes with free DOM). Strongly recommended.
- Bots self-hosted in v1, hosted runtime later.
- Staff-only runtime first, behind a flag, with an external security review before public.
