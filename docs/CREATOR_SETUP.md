# Setting up creator communities, clans and game servers

Everything below is configured on the Convex deployment (`npx convex env set NAME value`),
never in the client. None of it is needed for standard communities.

## Always

| Variable | What |
| --- | --- |
| `CREDENTIALS_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). Encrypts stored Pterodactyl API keys and platform tokens (AES-256-GCM). **Losing it makes stored credentials unreadable; changing it invalidates them.** |
| `OAUTH_STATE_SECRET` | Optional. Signs the OAuth `state`. Falls back to the key above. |
| `APP_URL` | Where the browser lands after connecting an account: `https://usecrystal.app`. For dev, `http://localhost:3000`. |

## Pterodactyl (clans and creator communities)

Nothing to configure on Crystal's side. A community manager enters their panel address and a
**client** API key (Account → API Credentials in the panel) on the game-servers channel. It is
stored encrypted and never shown again.

Everything — stats, start/stop/restart/kill, and the "Open in panel" link — goes through Crystal's
servers or opens the panel in the person's own browser. Nothing is needed on the panel's nodes. The
panel link asks the person to sign in with their *own* panel account, so it grants nothing by itself.

## Platforms (creator communities)

Create an app on each platform you want to offer. A platform with no credentials set is simply not
offered. The redirect URI is the same shape for all three, on the deployment's **site** URL
(`CONVEX_SITE_URL`, the `.convex.site` address):

`https://<deployment>.convex.site/oauth/callback/<twitch|youtube|tiktok>`

### Twitch — https://dev.twitch.tv/console

- Register an application; OAuth Redirect URL: `…/oauth/callback/twitch`; category *Website Integration*.
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`
- Scopes used: `channel:read:subscriptions` (creators only — to read subscriber tiers and check a
  member's tier). Members connect with no scopes (identity only).
- Tiers are Twitch's fixed Tier 1/2/3. The creator must be an Affiliate or Partner.

### YouTube — https://console.cloud.google.com

- Enable **YouTube Data API v3**; create an OAuth client (Web); authorised redirect URI: `…/oauth/callback/youtube`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Scopes: `youtube.readonly` (everyone), and `youtube.channel-memberships.creator` for creators.
  The memberships scope is *sensitive*: the app has to pass Google's verification before it works
  for people outside your test users. Until then, add creators as test users.
- Reading memberships needs the channel to have memberships enabled.

### TikTok — https://developers.tiktok.com

- Create an app with **Login Kit** and **Display API**; redirect URI: `…/oauth/callback/tiktok`.
- `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`
- Scopes: `user.info.basic`, `video.list`. TikTok has no membership API: a TikTok creator community
  is public, shows the newsfeed, and uses hand-made roles. Live status isn't available from the API.

## What runs on a timer

- every 10 minutes: update every linked channel's feed;
- every 6 hours: re-check memberships that haven't been checked in a day (a platform that is down
  never takes anyone's role away).

## Members-only communities

An invite to a members-only creator community is refused until the platform has confirmed the person
is a member (checked within the last 24 hours). The refused person is taken through connecting
their account and Crystal asks the platform on their behalf. Existing members keep their place if a
membership lapses — their *tier role* is removed on the next re-check; removing someone entirely is
a manager's call.
