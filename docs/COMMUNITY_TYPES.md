# Community types: Creator Communities and Clans

Today every community is the same shape. This adds a **kind** to a community, chosen
in the create flow, which decides what the onboarding asks for and which extra
features the community has. Standard communities are unchanged.

```
communities.kind: "standard" | "creator" | "clan"     (absent = standard)
```

Features are *capabilities* of a kind, not forks of the app: a Creator Community is a
community with extra channel types and a platform connection; a Clan is a community with
a game list and game tools. The things they share — Pterodactyl game-server
management, gradient roles, backgrounds, icons, threads, AMA, a calendar — are built
once and switched on per kind.

## Creator Communities

A creator connects a **Twitch, YouTube or TikTok** account to their Crystal account and
creates a community centred on that channel.

### Onboarding

1. **Connect** a platform (OAuth, stored per user in `connectedAccounts`). One platform
   is enough; a creator may connect several and pick one as the community's home.
2. **Audience** — *public* (anyone can join) or *members-only* (join requires
   membership/subscription on the platform, checked server-side against the platform).
3. **Tiers → roles** — the platform's member tiers (Twitch sub tiers, YouTube channel
   membership levels) are imported as roles, in order, with their names and colours.
   Members are matched to roles by their connected account and re-synced periodically.
   TikTok has no membership API, so a TikTok creator gets a public community and
   hand-made roles.
4. **Look** — gradient roles, a background, an icon (all of which are creator-community
   features, and uses the cosmetic pipeline already in the app).

### Features

- **Newsfeed channel** — recent VODs, live streams and uploads from the connected channel
  (Twitch Helix, YouTube Data API, TikTok Display API), polled by a cron into
  `creatorFeedItems`; live status changes post immediately via platform webhooks where
  available (Twitch EventSub, YouTube PubSubHubbub).
- **Creator calendar** — scheduled streams and events, shown in a calendar channel, with
  "remind me".
- **AMA channels** — a channel where members submit and upvote questions and the
  creator answers them one at a time.
- **Thread channels** — a forum-style channel: every post is a thread with its own
  replies.
- **Game server (Pterodactyl)** — see below.
- Gradient roles, backgrounds and icons.

## Clans

A community centred on **up to five games**.

- **Games** — chosen at creation and editable by managers (1–5). Each game gets a
  *roster* (members who play it, with an in-game name and rank/role) and its own
  channels and tools.
- **Looking for group** — a post per game ("need 2 for ranked"), joinable with one tap,
  expiring on its own.
- **Scrims & events** — scheduled matches with sign-ups and a lineup; shown in the
  calendar.
- **Game servers** — Pterodactyl, below.
- **Clan identity** — tag, banner, colours; gradient roles; the same decoration pipeline.

## Pterodactyl game-server management

Available to Clans and Creator Communities (`servers` capability).

A manager connects a **panel** (URL + a *client* API key — never an application/admin
key). Crystal shows that panel's servers in the community and lets people with the
right permission operate them without leaving the app.

**Security model — the part that matters**

- The key is entered once and **stored encrypted in Convex, never sent to a client**.
  Every call goes browser → Convex action → panel. Members never see the panel URL's
  credentials, only what an action returns.
- Panel URLs must be `https`, are resolved server-side, and **private/loopback/link-local
  addresses are refused** (SSRF), with a redirect limit and a response size cap.
- A community maps **servers** (by panel identifier) to Crystal permissions per role:
  `view` and `power` (start/stop/restart). A member can only do what
  their role allows *in Crystal*; the panel key's own reach is the ceiling.
- Every power action is written to an **audit log** with who did it.
- Resource stats are fetched server-side; credentials never touch the browser. "Open in panel" is a plain
  link to the server's page, which asks for the person's own panel login.

**What it shows**: server list with live state, CPU/memory/disk/network, power controls,
start/stop/restart/kill and a link to the server in the panel, and (later) a file browser and
schedules.

## Data (new tables)

- `connectedAccounts` — user ↔ platform account (provider, external id, encrypted tokens,
  display name, scopes, expiry).
- `creatorChannels` — a community's home platform channel and sync state.
- `creatorFeedItems` — normalised feed entries.
- `communityEvents`, `communityEventRsvps` — calendar and scrims.
- `amaQuestions`, `amaVotes` — AMA.
- `threads`, `threadPosts` — thread channels.
- `clanGames`, `clanRoster`, `lfgPosts`.
- `gameServerPanels` (encrypted key), `gameServers` (per-community mapping + role
  permissions), `gameServerAudit`.

Channel types gain `"feed" | "calendar" | "ama" | "threads" | "servers"`.

## What you need to provide

- **Platform apps** — a Twitch application (client id/secret), a Google Cloud project with the
  YouTube Data API (OAuth client), and a TikTok developer app. Redirect URIs and webhook
  endpoints will be listed in the setup doc, like `STRIPE_SETUP.md`.
- **An encryption key** for stored tokens/keys (`CREDENTIALS_ENCRYPTION_KEY`).

## Phases

1. Community `kind`, create-flow branching, and the Clan/Creator onboarding screens.
2. **Pterodactyl** (shared): panel connection, server list, power, stats, audit.
3. Clans: games, roster, LFG, scrims.
4. Creator: platform connect, tier→role import, newsfeed, calendar, AMA, threads.

## Status

Built, and typechecking: community kinds and the create flow (type → games / creator → profile → rules →
channels → roles → invite); special channels (`surface`) with their own icons; Pterodactyl (panel
connection, server list, per-role access, power, a link to the panel, audit log); clan games, roster,
looking-for-group; the calendar (events, scrims, streams, RSVPs, lineups); AMA; threads; platform
connection (Twitch, YouTube, TikTok OAuth), channel linking, the newsfeed with live status, tier import
as roles, member verification and the members-only gate.

Not yet exercised against the real services — that needs the credentials in `docs/CREATOR_SETUP.md` and a
real panel. The pure parts (panel address checks, spec validators, encryption, signed state) have been
tested directly.

Not built: a user-level "Connections" settings page (accounts are connected from a community's Creator
settings, or from the members-only prompt); webhook-driven live notifications (the feed polls every ten
minutes); a Pterodactyl file browser and schedules; posting new feed items into a channel as messages.
