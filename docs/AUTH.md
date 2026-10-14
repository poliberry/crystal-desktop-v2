# Authentication and account migration

Crystal uses Convex Auth for sessions. Passwords, email verification codes, TOTP, passkeys, guest
accounts, and the decision to allow a sign-in are handled by Convex functions before a session is
created. A suspended or banned account is refused before it receives a session.

## Configure a deployment

Generate a signing key pair and code-hashing secret separately for each Convex deployment:

```sh
bun run auth:keys
bun run auth:keys -- --prod
```

Run the printed `npx convex env set` commands against the indicated deployment. Keep the private
key private. Do not generate a replacement unless the existing key is compromised: replacing it
ends all existing sessions.

Set these deployment variables to send sign-in and verification codes:

- `RESEND_API_KEY`: a Resend API key with permission to send email.
- `AUTH_EMAIL_FROM`: a sender address on a domain verified with Resend, such as
  `Crystal <no-reply@usecrystal.app>`.

Passkeys work on the app's recognized production and local origins. Set `WEBAUTHN_ORIGINS` to a
comma-separated list of additional exact origins if the app is served elsewhere. The relying-party
ID is derived from those origins.

Without the mail variables, email-code sign-in and account recovery are unavailable. For local
development only, `AUTH_LOG_CODES=true` logs codes to the Convex function logs instead of sending
them. Never enable this on a shared or production deployment.

## Copy existing email addresses from Clerk

The backfill preserves each Convex user row and copies the primary Clerk address (or the first
verified address when no primary is set). It does not create a password or sign a user in. Each
person proves they still control the address with an emailed code, then chooses a password on the
sign-in screen. Accounts with duplicate addresses, no address, or no matching Convex row are
reported and left untouched.

Before running the migration, deploy the current Convex schema and functions. Set `CLERK_SECRET_KEY`
to a Clerk secret key with read access to the Clerk instance, and set `CLERK_MIGRATION_TOKEN` to a
new random secret used only for this migration (for example, `openssl rand -hex 32`, then
`npx convex env set CLERK_MIGRATION_TOKEN -- '<generated value>'`). The token protects the
temporary public entry points; do not use the Clerk secret key as the migration token.

Run a dry run first, then apply it:

```sh
npx convex run clerkMigration:backfillEmails '{"token":"YOUR_MIGRATION_TOKEN","dryRun":true}'
npx convex run clerkMigration:backfillEmails '{"token":"YOUR_MIGRATION_TOKEN"}'
npx convex run clerkMigration:coverage '{"token":"YOUR_MIGRATION_TOKEN"}'
```

The coverage result reports account counts, not addresses. Resolve every account without an email,
every duplicate address, and every missing Convex row before requiring the new sign-in flow. Once
the backfill is complete, unset `CLERK_SECRET_KEY` and `CLERK_MIGRATION_TOKEN` from the deployment.

## Account security

Users can enable an authenticator app (TOTP), add passkeys, and save one-use backup codes in
**Settings → Security**. A passkey requires user verification (such as a fingerprint, face, or PIN).
An administrator who has a second factor enabled must enter a fresh second-factor code before
administrative actions. Platform staff can be required to enroll by the platform security setting;
each community owner can require enrollment for server moderators and administrators in that
community's settings.

Temporary guest accounts need only a username and expire after 24 hours. They cannot create
communities, upload media, or send friend requests.
