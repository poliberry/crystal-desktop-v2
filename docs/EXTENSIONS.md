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

## Bots and integrations — server-side

We do **not** run untrusted code on our servers in v1. Bots and integrations run on the
author's infrastructure and talk to Crystal over:

- a **Bot API** (HTTP) and **Gateway** (WebSocket) — a bot account with a scoped token, the
  community's permission system applied to it like any member, rate-limited and audited;
- **webhooks** (signed, retried) both ways;
- **interactions** — slash-commands and buttons delivered as signed HTTP requests.

A hosted bot runtime (Cloudflare Workers for Platforms — per-script isolates, which fits
our Cloudflare footprint) is a *later* phase, after the client sandbox has proven itself.

## SDK

`@crystal/sdk` — TypeScript, the same surface for components, plugins and bots where it
makes sense: typed events (`onMessage`, `onMemberJoin`, `onPresenceChange`…), the
declarative UI builders, `storage`, `http` (the proxied one), `commands`. Studio provides
a code editor (Monaco), types, a local runner with the real sandbox and a *simulated
community* to test against, a permission inspector, and a profiler showing CPU/memory
against the budget.

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
