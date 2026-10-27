# End-to-end encryption of messages

This is the contract every part of the E2EE work is written against. If code and this file disagree,
fix one of them in the same change.

## Scope

Encrypted: `messages` (DMs and groups) and `channelMessages` (community channels), including the
fields a bot attaches (`embeds`, `components`).

Not encrypted, on purpose:

- **Attachments.** File bytes and file names stay as they are (R2/CDN). A follow-up has to encrypt
  them with the same room key. Until then an attachment is visible to the server.
- **Reactions, pins, reply ids, timestamps, authors, read markers.** These are routing metadata.
- **Saved-for-me bookmarks and their reminder times** (`savedMessages`). A row is a message
  reference plus times, never text (there is deliberately no note field). `savedMessages.list`
  returns the saved message's `enc` and the client decrypts it like any other row.
- **`loungeMessages`, `forumPosts`, `forumReplies`, `amaQuestions`, `supportTicketMessages`.** The
  first four are public or semi-public rooms; support tickets must be readable by staff.
- **Server-authored system messages** (`system:crystal`). They stay plaintext (`text`, no `enc`).

## Primitives (WebCrypto only; the same code runs in browsers, Electron, Node 20 and Convex)

| Purpose | Primitive |
|---|---|
| Identity key (one per user) | ECDH P-256. Public key as SPKI, base64url. |
| Room key (one per conversation/channel *epoch*) | 32 random bytes, AES-256-GCM |
| Message encryption | AES-256-GCM, 96-bit random IV, AAD below |
| Wrapping a room key to a public key | ephemeral ECDH P-256, then HKDF-SHA-256, then AES-256-GCM |
| Recovery backup of the identity private key | AES-256-GCM under HKDF-SHA-256 of a 32-byte recovery secret |

Encodings are base64url without padding. All of this lives in `src/lib/e2ee/crypto.ts` (client) and
`convex/lib/e2eeCrypto.ts` (server). They are two copies of the same code. `scripts/tests/e2ee.test.mts`
holds fixed test vectors that both must pass.

### Wire formats

- **Message envelope** (stored on the row as `enc`): `{ keyId, iv, ct }`, with `iv` and `ct` base64url.
  The plaintext is UTF-8 JSON: `{ v: 1, text?: string, embeds?: Embed[], components?: ComponentRow[] }`.
- **AAD** for a message: `crystal-e2ee-msg-v1|<scope>|<targetId>|<keyId>|<authorId>` as UTF-8, where
  `scope` is `conversation` or `channel` and `targetId` is the conversation/channel id. This pins a
  ciphertext to its room, key and author so the server cannot move it elsewhere.
- **Wrapped room key** (`w1`): `w1.<ephemeralPublicKey>.<iv>.<ct>`. HKDF salt is
  `ephemeralSPKI || recipientSPKI`, info is `crystal-e2ee-wrap-v1`. The AES key is 256 bits.
- **Recovery backup**: `{ salt, iv, ct }`. The plaintext is the PKCS8 identity private key. HKDF info
  is `crystal-e2ee-backup-v1`. The recovery secret is shown to the user once, as base32 in groups of 4.

## Trust model, stated plainly

- The server never sees a room key in the clear. Legacy plaintext rows predate E2EE and remain
  plaintext until their author replaces them using a client-held room key.
- The server cannot forge a ciphertext it did not receive, but it *can* insert rows with no `enc`,
  and it decides room membership. A malicious server could therefore add itself as a member or inject
  plaintext rows. v1 has no sender signatures and no signed membership list. Clients show
  plaintext rows in an encrypted room with a warning, and refuse to render them unless the author is
  `system:crystal`.
- Mention metadata, reply ids, and the sender's identity are visible to the server.
- Link previews: the client still asks the server to unfurl URLs, so the server learns URLs a user
  chooses to preview. Previews are generated on demand and can be turned off per user.

## Key hierarchy and lifecycle

1. **Identity.** On first launch after the rollout (or on sign-in on a new device) the client
   generates an identity keypair, registers the public key (`e2eeKeys.registerIdentity`), and shows
   the recovery secret. The private key is stored on the device: Electron main process encrypts it
   with `safeStorage`; the web build keeps a non-extractable `CryptoKey` in IndexedDB. A new device
   signs in, then enters the recovery secret to fetch and decrypt `e2eeIdentities.backup`.
   The client prompts for this right after sign-up (registering needs a session, so it can't happen
   on the sign-up screen) and once per launch while setup or unlock is outstanding
   (`src/components/auth/e2ee-onboarding.tsx`). The person may defer it; nothing falls back to
   plaintext meanwhile, sending just waits for encryption. The identity is uploaded only after they
   confirm they stored the recovery secret (and, for full accounts, retype its last group). Losing
   the secret with no unlocked device left means `rotateIdentity`: a new identity, and earlier
   epochs stay unreadable to that person.
2. **Epochs.** A conversation/channel has `e2eeKeys` rows, one per epoch. The current epoch is the
   highest one with no `supersededAt`. Each row has one `e2eeKeyWraps` row per recipient.
3. **Sending.** The sender asks `e2eeKeys.current({ scope, targetId })`. If there is no epoch, or the
   room is flagged `needsRotation`, the sender generates a room key, wraps it to every recipient from
   `e2eeKeys.recipients(...)` and calls `e2eeKeys.createEpoch`. The server checks the wraps cover
   exactly the current recipient set; it cannot check the contents.
4. **Membership changes.**
   - Member added: the new member needs every epoch's key (history stays visible, as it is today).
     Any online member who holds the keys fulfils the pending request through
     `e2eeKeys.pendingWrapRequests` and `e2eeKeys.fulfilWrapRequests`.
   - Member removed, banned, role lost, or channel made private: the server sets `needsRotation` on
     the room. The next sender creates a new epoch that excludes the removed member. The removed
     member keeps the old epochs they already held. This is the usual limit of lazy rotation.
5. **Bots.** A bot has its own P-256 key (`bots.e2eePublicKey`). It is a recipient of any room
   where it holds `messages.read` or may send, and gets wraps like a user. The bot SDK holds the
   private key and decrypts locally. See the bot section.

## Existing plaintext messages and escrow disclosure

Legacy plaintext can be converted in resumable batches by `e2eeMigrate.run`. Migration creates an
escrowed room-key epoch, encrypts old message bodies, then provisions user wraps during onboarding.
This is an explicit trust exception: anyone holding `E2EE_ESCROW_PRIVATE` can decrypt migrated and
otherwise escrowed message content until that epoch's escrow wrap is removed. Protect that secret as
a production data key, disclose the exception to users, and remove escrow wraps after every current
user and bot recipient has a usable wrap. The server-side migration reads plaintext while converting
it; migration is not end-to-end confidential from the deployment operator.

For a production database, use the all-rooms driver rather than enumerating rooms manually. Set
`E2EE_ESCROW_PUBLIC` and `E2EE_ESCROW_PRIVATE` in the Convex deployment environment before starting
it. As a staff operator with `system.manage` and current staff step-up assurance, run
`const { jobId } = await convex.action(api.e2eeMigrate.startAll, { batchSize: 100 })` from an
authenticated Convex client (or invoke `e2eeMigrate:startAll` in the Convex dashboard). Observe it
with `convex.query(api.e2eeMigrate.status, { jobId })`; cancel with
`convex.action(api.e2eeMigrate.cancel, { jobId })`; resume a failed job from its last committed page
using `convex.action(api.e2eeMigrate.retry, { jobId })`. Batches are scheduled
durably and bounded to at most 200 messages. The driver visits every conversation and channel,
skips the `system:crystal` account, and persists progress. A cancelled or failed job leaves already
encrypted messages intact. Start another job only after the current one finishes or is cancelled.

Encrypted reads return `enc` and preserve legacy `text` for old rows; consumers must treat the two
forms separately. A legacy message is upgraded only when its author edits it from an E2EE-capable
client: the client encrypts the replacement using a room key it holds, then `messages.update` or
`channelMessages.update` stores `enc` and clears the plaintext fields in the same mutation. Those
mutations remain author-only, so another member cannot silently rewrite the original message as its
author. The operation is retry-safe for the same envelope. If the author cannot return with access
to the content and a usable room key, that row stays legacy; retaining it is more honest than
claiming server-side encryption.

The batch action is dry-run by default and never runs automatically. Invoke it per room with
`dryRun: false` repeatedly; each pass only selects remaining plaintext rows, so retries resume
without double-encrypting. New messages can still be required to use `enc` independently via
`E2EE_ENFORCE=1`.

## Schema (see `convex/schema.ts`)

- `e2eeIdentities`: `userId`, `publicKey`, `fingerprint`, `backup?`, `createdAt`, `supersededAt?`.
- `e2eeKeys`: `scope`, `conversationId?`, `channelId?`, `epoch`, `origin` (`client`, `migration`, or transitional `onboarding`), `escrowed`, `createdAt`,
  `createdBy?`, `supersededAt?`.
- `e2eeKeyWraps`: `keyId`, `kind` (`user` | `bot` | `escrow`), `userId?`, `botId?`, `wrapped`, `createdAt`.
- `e2eeRoomState`: `scope`, `conversationId?`, `channelId?`, `needsRotation`, `updatedAt`.
- `e2eeWrapRequests`: `keyId`, `userId?`, `botId?`, `createdAt`.
- On `messages` and `channelMessages`: `enc?` and `mentions?`. `text`, `embeds`, `components` stay
  optional for legacy rows and system messages. New rows from users and bots must not set them.
- On `bots`: `e2eePublicKey?`, `e2eeFingerprint?`.

`mentions` is `{ users: Id<"users">[], roles: Id<"roles">[], everyone: boolean, here: boolean }`,
sent in the clear by the sender's client. The server enforces `MENTION_EVERYONE` on `everyone`/`here`,
and drops user/role ids that are not members of the room. It cannot check that the text matches.

## Server rules once `E2EE_ENFORCE=1`

- `messages.send`, `channelMessages.send`, `update`, `editChannelMessage`, bot `message.send`/`edit`
  and bot `dm.send` reject a write whose author is not `system:crystal` and that has `text`, `embeds`
  or `components` instead of `enc`. Before the flag is set, plaintext is still accepted so old clients
  keep working during rollout.
- `enc.keyId` must belong to the target room. The key must be the current epoch for a send. An edit
  may use any epoch the author holds.
- Nothing on the server reads message bodies. Everything that did is replaced as follows:

| Was | Becomes |
|---|---|
| `search.ts` (`search_text` indexes) | Client-side index of decrypted messages (`src/lib/e2ee/search-index.ts`). Server search functions removed. The `search_text` indexes are dropped in a follow-up deploy after the migration. |
| `renderMentionsAsText` in notification bodies | Generic body: `"New message"`, `"Mentioned you"`, `"Replied to you"`. Never message text. |
| `notifications.feed` / `sidebar` / `priority` / `conversations.listMine` / `communityWidgets` text | Return `enc` plus a `mentionsMe` boolean from `mentions`. The client decrypts previews. |
| `push.ts` body | Generic body. |
| Reply previews built in `resolveReplyPreview` | Client builds the preview from the decrypted target. Server returns `replyToId` only. |
| Redis first-page caches | Cache ciphertext rows only, or remove. |
| `reports` evidence | The reporter's client attaches the decrypted text it saw, marked `disclosedByReporter: true`. The server cannot verify it. |
| `communities` link counts and last-active scans of `text` | Count by row, not by content. |
| `botEvents` / bot `message.*` payloads | Carry `enc` and the bot's wrap. See below. |

## Bots

- `bots.setPublicKey` (owner only) stores `e2eePublicKey` and `e2eeFingerprint`. The SDK can generate
  a key (`Crystal.generateE2eeKey()`), keep the private JWK, and register the public one.
- When a bot is installed, or its scopes change, the installing client wraps every relevant current
  and past epoch to the bot's public key and uploads them (`e2eeKeys.fulfilWrapRequests`).
- Endpoints that return message content return ciphertext and what the bot needs to open it:

  ```
  { id, channelId, authorId, replyToId?, createdAt, editedAt?, mentions?,
    enc: { keyId, iv, ct },
    keyWraps: { [keyId]: "w1...." } }     // only wraps this bot holds, and only for keys it needs
  ```

  Affected: `GET /channels/:id/messages`, `GET /channels/:id/messages/:mid`, `GET /channels/:id/pins`,
  the `message.created` / `message.updated` events (webhook and polling), and the command/interaction
  payloads. A bot with no wrap for a key gets `enc` and no `keyWraps[keyId]`, and cannot read it.
- The SDK (`sdk/bot/e2ee.ts`) unwraps, decrypts and exposes `message.content` / `message.embeds` as
  before, so most bot code does not change. If it cannot decrypt, `message.content` is `undefined`
  and `message.encrypted` is `true`.
- Sending: the SDK encrypts with the current epoch it holds a wrap for (fetched with
  `GET /channels/:id/e2ee-key`) and posts `{ enc, mentions }`. The request body may still carry
  `content` for the SDK, but the SDK, not the server, converts it. A raw REST client that posts
  `content` is rejected once `E2EE_ENFORCE=1`.
- Bot DMs to a user: the SDK creates a conversation epoch, wraps it to the bot and to the user's
  public key (`GET /users/:id/e2ee-key`), and posts it. The server stores both wraps.
- Slash-command arguments: the invoking client seals `args` to the bot's public key (one `w1`-style
  box over the JSON of the args) and the server forwards `sealedArgs` and no plaintext `args`.
  Button `customId`s stay in the clear.
- Breaking change: bots on SDK < 2.0 cannot read or send in encrypted rooms. SDK 2.0 is published
  with this change.

## Convex functions (`convex/e2eeKeys.ts`, `convex/e2eeOnboard.ts`)

Queries and mutations, all authenticated as the caller:

- `registerIdentity({ publicKey, fingerprint, backup? })`
- `myIdentity()`, `getBackup()`, `rotateIdentity({ publicKey, fingerprint, backup })`
- `publicKeys({ userIds })` returns each user's active public key and fingerprint
- `current({ scope, conversationId?, channelId? })` returns `{ keyId, epoch, escrowed, needsRotation, myWrap? } | null`
- `wrapsForMe({ keyIds })` returns `{ [keyId]: wrapped }`
- `recipients({ scope, conversationId?, channelId? })` returns `[{ userId?, botId?, publicKey? }]`
  (no `publicKey` means the member has not set up E2EE)
- `createEpoch({ scope, conversationId?, channelId?, wraps: [{ userId?, botId?, wrapped }], escrowWrap? })`
- `pendingWrapRequests({ limit })`, `fulfilWrapRequests({ items: [{ requestId, wrapped }] })`
- `markNeedsRotation(ctx, room)` is an internal helper called from membership changes.

Actions: `e2eeOnboard.*` provisions wraps for newly registered identities. `e2eeMigrate.run` is
staff-gated (`system.manage`), dry-run by default, and processes a bounded batch per call.

## Rollout order

1. Ship schema, key functions, and clients that can read and write both forms.
2. Users sign in and set up identities. Run `e2eeMigrate.run` in dry-run mode for each room, then
   repeat with `dryRun: false` until each room reports `done: true`. The five-minute escrow sweep
   provisions wraps and removes escrow only when all eligible user and bot recipients have one.
   Rows that are not migrated can still be upgraded by their authors through encrypted edits.
3. Set `E2EE_ENFORCE=1` when all supported writers send ciphertext. Remove the `search_text` indexes
   in a later deploy.
