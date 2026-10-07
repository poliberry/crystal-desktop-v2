import { setupValidator } from "./lib/communitySetup";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/** A Rich Presence activity — the subset of Discord's activity shape the
 * client actually renders (see src/components/rich-presence-card.tsx).
 * `type` mirrors Discord's activity types, and decides both the card's verb
 * ("Playing" / "Listening to" / …) and the small icon shown next to the
 * user's status. */
const activityValidator = v.object({
  type: v.union(
    v.literal("playing"),
    v.literal("listening"),
    v.literal("watching"),
    v.literal("streaming")
  ),
  /** Game/app name, or the music app ("Spotify", "Apple Music"). */
  name: v.string(),
  /** First detail line — the track title, for music. */
  details: v.optional(v.string()),
  /** Second detail line — the artist/album, for music. */
  state: v.optional(v.string()),
  /** Large image (box art / album art) when one is known. */
  imageUrl: v.optional(v.string()),
  /** Epoch ms the activity started, for the elapsed-time counter. */
  startedAt: v.optional(v.number()),
  /** Album name, for music. */
  album: v.optional(v.string()),
  /** Track length in ms, when the player reports one. */
  durationMs: v.optional(v.number()),
  /** Playback position in ms, accurate as of `positionUpdatedAt`. */
  positionMs: v.optional(v.number()),
  /** Server clock reading when `positionMs` was recorded. Stamped by
   * `presence.setActivity` rather than sent by the client, so viewers
   * interpolate the seek bar against one authoritative clock instead of the
   * broadcaster's — which may be minutes off. */
  positionUpdatedAt: v.optional(v.number()),
  /** Up to two link buttons under the card, the same shape Discord's Rich
   * Presence uses. Only custom activities set these today — nothing we detect
   * has anywhere to point. */
  buttons: v.optional(v.array(v.object({ label: v.string(), url: v.string() }))),
  /** Where this came from: "detectable" (process scan), "ipc" (a game
   * connected to our Discord-compatible RPC socket), "music", or "custom"
   * (written by the user themselves). */
  source: v.optional(v.string()),
});

/**
 * One piece of artwork placed on a card or an avatar.
 *
 * A frame used to be a single image with four numbers describing where it sat
 * (`profileFrameFit` and friends). That is one decoration; people want a
 * border *and* a badge in the corner *and* a shine over the top, which is
 * three, each placed differently. So placement moved onto the artwork itself
 * and the artwork became a list.
 *
 * Every measurement is a percentage of the target box's *width*, and never of
 * its height. A profile card has no fixed height — a long bio or a rich
 * presence card makes it grow, sometimes by half again — so a layer measured
 * against the height would stretch and slide every time somebody wrote a
 * longer status. Width is the one stable dimension, which makes it the unit
 * for both axes and keeps artwork the shape it was drawn.
 *
 * That leaves the question of what happens to the *rest* of the card when it
 * grows, which is what `anchor` answers: a layer is pinned to the card's top,
 * centre or bottom, and `y` is measured from there. A border along the top
 * stays on the top edge, a badge in the bottom corner follows the bottom
 * edge, and a card that grows grows between them.
 *
 * `"locked"` is the exception to the paragraph above: its `y` is a percentage
 * of the card's *height*, so the layer holds the same relative position as the
 * card grows instead of following one of its edges. That is what artwork placed
 * against something in the middle of the card needs — a signature over the bio,
 * a character standing on the bottom third — where any edge to pin to is the
 * wrong edge. Sizes are still measured against the width, so the artwork keeps
 * its shape either way.
 *
 * `x`/`y` are the layer's *centre*, so rotating and resizing turn about the
 * point the editor's handles surround rather than about a corner.
 */
const cosmeticLayerValidator = v.object({
  /** Stable across edits, so the editor can key on it and a reorder is a
   * reorder rather than a delete and an insert. Minted by the client. */
  id: v.string(),
  url: v.string(),
  /** Absent for a built-in preset, which is drawn from code and owns no file. */
  storageId: v.optional(v.id("_storage")),
  /** Which edge of the card `y` is measured from — or `"locked"`, where it is
   * measured against the card's height instead. */
  anchor: v.union(
    v.literal("top"),
    v.literal("center"),
    v.literal("bottom"),
    v.literal("locked")
  ),
  /** Centre of the layer, as a percentage of the target box's width. `x` is
   * measured from the left edge (50 is centred); `y` downwards from the
   * anchor line, so a negative `y` on a top-anchored layer lifts it above the
   * card — which is how a frame overhangs. On a `"locked"` layer `y` is instead
   * a percentage of the card's height: 0 the top edge, 100 the bottom. */
  x: v.number(),
  y: v.number(),
  /** Width, as a percentage of the target box's width. */
  width: v.number(),
  /** Height, in the same unit. Absent means "keep the artwork's own
   * proportions", which is what almost every decoration wants and what an
   * `<img>` with a width and no height already does by itself. */
  height: v.optional(v.number()),
  /**
   * Height follows the card instead: the layer runs between its anchor line
   * and one of the card's edges, whatever that turns out to be.
   *
   * For the one kind of artwork that *should* stretch — a border drawn to a
   * card's proportions, which has to grow with the card or stop being a
   * border. Ignored when `height` is set, which is the fixed-size answer to
   * the same question.
   */
  stretchY: v.optional(v.boolean()),
  /**
   * Which of its two edges gives. Absent is `"down"`, which is what every
   * stretched layer meant before there was a choice.
   *
   * `"down"` holds the anchor line and follows the card's bottom edge. `"up"`
   * holds the card's top edge and follows the anchor line — what a band across
   * the middle of a card needs, where the space above it should grow and the
   * band itself should stay where it was put.
   */
  stretchDirection: v.optional(v.union(v.literal("down"), v.literal("up"))),
  /**
   * A stretch pinned at *both* ends. When both are set the layer runs between
   * `stretchTop` and `stretchBottom` and grows to keep both as the card's
   * height changes — which is what a full-card border needs on a card whose
   * drawn height isn't its content's (the full profile page).
   *
   * Each end is a point on the card: `anchor` `"top"`/`"bottom"` measures `y`
   * from that edge in percent of card width (negative reaches past it),
   * `"locked"` makes `y` a percent of the card's height. Takes precedence over
   * `stretchDirection`; `anchor`/`y`/`height` stop placing the layer
   * vertically while it's on.
   */
  stretchTop: v.optional(
    v.object({
      anchor: v.union(v.literal("top"), v.literal("bottom"), v.literal("locked")),
      y: v.number(),
    })
  ),
  stretchBottom: v.optional(
    v.object({
      anchor: v.union(v.literal("top"), v.literal("bottom"), v.literal("locked")),
      y: v.number(),
    })
  ),
  /** Degrees clockwise. */
  rotation: v.optional(v.number()),
  /** 0–1. Absent is fully opaque. */
  opacity: v.optional(v.number()),
  /**
   * What this layer is made of. Absent is an image, which is what every layer
   * was before there were three kinds — so nothing stored has to be migrated
   * to keep meaning what it meant.
   *
   * The geometry above is shared by all three: a line of text and a rectangle
   * are placed, sized, turned and anchored exactly the way a picture is.
   */
  kind: v.optional(v.union(v.literal("image"), v.literal("text"), v.literal("shape"))),
  /** Text layers. `fontSize` and `strokeWidth` are percentages of the target
   * box's width, like every other measurement here. */
  text: v.optional(v.string()),
  fontSize: v.optional(v.number()),
  fontWeight: v.optional(v.number()),
  italic: v.optional(v.boolean()),
  align: v.optional(v.union(v.literal("left"), v.literal("center"), v.literal("right"))),
  /** The text's colour, or the shape's fill. */
  color: v.optional(v.string()),
  /** Shape layers. `radius` is a rectangle's corner, in percent of width. */
  shape: v.optional(v.union(v.literal("rect"), v.literal("ellipse"))),
  radius: v.optional(v.number()),
  /** An outline: around the shape, or around the letters. */
  strokeColor: v.optional(v.string()),
  strokeWidth: v.optional(v.number()),
  /**
   * Placement for one shape of card, overriding the numbers above.
   *
   * A card that has grown is not the same picture with more room in it: a badge
   * beside the bio on a short card is halfway up a tall one, and where somebody
   * wants it is a different answer per shape. Anchoring handles the common
   * case; this handles the rest.
   *
   * Keyed by the card shapes in src/lib/cosmetic-layers.ts. Absent — which is
   * what every layer starts as — means the placement above is used for all of
   * them, so nothing has to be arranged three times to be arranged once.
   */
  variants: v.optional(
    v.record(
      v.string(),
      v.object({
        x: v.optional(v.number()),
        y: v.optional(v.number()),
        width: v.optional(v.number()),
        height: v.optional(v.number()),
        rotation: v.optional(v.number()),
      })
    )
  ),
});

/**
 * The cosmetics a profile card is dressed in, shared verbatim by `users` and
 * `serverProfiles`.
 *
 * Spread into both rather than written twice because a server profile is
 * meant to be able to override every one of them — the profile editor picks a
 * scope from a dropdown and then edits the same set of things either way, and
 * a field that existed on only one side would be a section that silently did
 * nothing for servers.
 *
 * The effect and the frame are stored as URL + storage id, the pairing the
 * rest of this table uses for uploads: the id is what a later replacement
 * deletes, and the URL is what every reader renders without another lookup.
 * Unlike `avatarDecoration` there are no built-in presets to encode, so a
 * plain URL is the whole value.
 */
const profileCosmetics = {
  /** How the display name is drawn on a profile card — a key from
   * src/lib/profile-cosmetics.ts. Absent means the plain one everybody had
   * before the choice existed. */
  displayNameStyle: v.optional(v.string()),
  /** An image played *over* the whole profile card: sparkles, rain, a sweep of
   * light. Purely decorative and never hit-tested, so it can cover the card's
   * buttons without swallowing them. */
  profileEffect: v.optional(v.string()),
  profileEffectStorageId: v.optional(v.id("_storage")),
  /** An image drawn around (or on) the whole card — the avatar decoration
   * idea at card scale. See `profileFrameMode`. */
  profileFrame: v.optional(v.string()),
  profileFrameStorageId: v.optional(v.id("_storage")),
  /**
   * Which of the two things an uploaded frame is.
   *
   * `wrap` scales the image out past the card's edges, for a frame with its
   * own border thickness drawn around the outside — the way an avatar
   * decoration overhangs its avatar. `overlay` lays it over the card at
   * exactly the card's size, for artwork meant to sit on top.
   *
   * A stored choice rather than something inferred from the file: both kinds
   * are transparent PNGs of similar proportions, and nothing in the pixels
   * says which one the artist meant. Absent means `wrap`.
   */
  profileFrameMode: v.optional(v.union(v.literal("wrap"), v.literal("overlay"))),
  /**
   * Where the frame is drawn, chosen per upload.
   *
   * Frames are user artwork of unknown shape: some are a border drawn to a
   * card's proportions, some are a tall piece meant to grow out of the card's
   * top with most of the file transparent. Nothing in the pixels says which,
   * and every rule we guessed was wrong for half of them — so the person who
   * just picked the file places it, and these four numbers are what they place
   * it with.
   *
   * `fit`     whether to stretch to the box or keep the artwork's own aspect.
   * `anchor`  which edge of the card the artwork is pinned to.
   * `scale`   width as a percentage of the card.
   * `offsetY` pixels to shift it, negative being up.
   */
  profileFrameFit: v.optional(v.union(v.literal("stretch"), v.literal("aspect"))),
  profileFrameAnchor: v.optional(
    v.union(v.literal("top"), v.literal("center"), v.literal("bottom"))
  ),
  profileFrameScale: v.optional(v.number()),
  profileFrameOffsetY: v.optional(v.number()),
  /**
   * The frame as a list of placed images — what the four fields above became.
   *
   * When this is set it *is* the frame, and the single-image fields are
   * ignored: a profile written by this build carries its whole frame here, and
   * one written before it is read through `frameLayersFrom`, which turns the
   * old fields into a single layer at the same place they described. Nothing
   * is migrated on write, so an older client keeps rendering what it always
   * did until the frame is next edited.
   */
  profileFrameLayers: v.optional(v.array(cosmeticLayerValidator)),
  /**
   * A stylesheet the owner writes for their own profile card.
   *
   * Stored raw and scoped on the client at render time (see
   * src/lib/scoped-css.ts), not scoped here: the scope selector contains an id
   * that only exists on the client, and rewriting on write would mean every
   * stored sheet had to be migrated the day that changes. Length is capped by
   * the mutation, which is the part that has to be enforced.
   *
   * Unlike the app-wide custom CSS, this one is rendered in *other people's*
   * clients — which is the whole reason it's confined to the card rather than
   * injected as-is.
   */
  profileCss: v.optional(v.string()),
};

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    name: v.string(),
    username: v.string(),
    imageUrl: v.optional(v.string()),
    dob: v.optional(v.string()),
    bio: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    /** Dominant colour of the avatar, sampled on the client (see
     * src/lib/avatar-color.ts) and cached here so a call tile can paint it on
     * its first frame instead of flashing while it re-samples the image.
     * Stored with the URL it was derived from, so a new avatar invalidates it
     * rather than tinting the tile with the old one. */
    avatarAccent: v.optional(v.string()),
    avatarAccentUrl: v.optional(v.string()),
    /** The picture as uploaded, before cropping. `imageUrl` is the cropped
     * render that everything actually displays; this is kept only so the crop
     * can be adjusted later without asking for the file again, and without
     * re-cropping an already-cropped image. */
    avatarOriginalUrl: v.optional(v.string()),
    avatarOriginalStorageId: v.optional(v.id("_storage")),
    // Profile cosmetics
    bannerUrl: v.optional(v.string()),
    bannerStorageId: v.optional(v.id("_storage")),
    bannerOriginalUrl: v.optional(v.string()),
    bannerOriginalStorageId: v.optional(v.id("_storage")),
    borderGradientStart: v.optional(v.string()),
    borderGradientEnd: v.optional(v.string()),
    profileBg: v.optional(v.string()),
    customStatus: v.optional(v.string()),
    /** How the custom status is drawn beside this user's avatar on their
     * profile card: said, or thought. Cosmetic and chosen by the person whose
     * status it is, so it travels with the status rather than being a viewer's
     * setting. Absent means "speech", which is what everyone had before the
     * choice existed. */
    statusBubble: v.optional(v.union(v.literal("speech"), v.literal("thought"))),
    /** When the custom status stops being shown, for the "clear after…"
     * presets. Absent means it stays until cleared by hand. Enforced on read
     * as well as by the sweep, so an expired status is never shown even if
     * nothing has run to delete it yet. */
    customStatusExpiresAt: v.optional(v.number()),
    /**
     * A Rich Presence activity the user wrote themselves, shown ahead of
     * anything detected.
     *
     * Lives on the profile rather than on `presence` because it outlives a
     * session: detected activities are cleared when the last desktop client
     * disconnects (see `reconcile`), whereas "I'm at work until 5" should
     * survive closing the app and be visible from a phone.
     */
    customActivity: v.optional(activityValidator),
    /** When `customActivity` stops being shown. Same rules as
     * `customStatusExpiresAt`. */
    customActivityExpiresAt: v.optional(v.number()),
    nameplateUrl: v.optional(v.string()),
    nameplateStorageId: v.optional(v.id("_storage")),
    /** The theme pack applied to this person's client — an entitlement of theirs,
     * looked up and checked again whenever it is read, so one that has run out
     * simply stops applying. */
    themePackEntitlementId: v.optional(v.id("entitlements")),
    /** The frame drawn around this user's avatar: a `builtin:<key>` preset or
     * the storage URL of a picture they uploaded. One field rather than a key
     * and a URL, so the queries that carry it to every avatar on screen carry
     * one thing — see src/lib/avatar-decorations.ts, which draws it. */
    avatarDecoration: v.optional(v.string()),
    avatarDecorationStorageId: v.optional(v.id("_storage")),
    /**
     * The decoration as a list of placed images, for the same reason a frame
     * is one: one picture around an avatar is a decoration, and people want
     * two.
     *
     * The target box here is the avatar, which is square — so the layer
     * geometry means what it says on both axes and `anchor` is almost always
     * "center". A single-image decoration (a preset, a birthday gift, an old
     * upload) is read as one centred layer at the ratio decorations have
     * always been drawn at; see `decorationLayers`.
     *
     * Every query that carries a decoration carries it as one string, so this
     * list is serialised into `avatarDecoration` on read rather than added
     * beside it — otherwise every member list, message row and call tile in
     * the app would need a second field threaded through it.
     */
    avatarDecorationLayers: v.optional(v.array(cosmeticLayerValidator)),
    ...profileCosmetics,
    /** The decoration generated as a birthday present, and when it stops being
     * worn. Kept separate from `avatarDecoration` so the user's own choice is
     * still there underneath and comes back by itself the next day.
     *
     * `birthdayUntil` is local midnight as reported by the user's own client
     * (see `claimBirthday`), because the server has no timezone and a birthday
     * is a local date. It's also what tells everyone *else* it's this person's
     * birthday — the cake in place of a presence dot, the prompt above a
     * friend's composer. See convex/lib/birthday.ts. */
    birthdayDecoration: v.optional(v.string()),
    birthdayUntil: v.optional(v.number()),
    /** Clip played to everyone else when this user joins a call. Either a
     * `builtin:<name>` id or a `communitySounds` document id — see
     * src/lib/soundboard.ts. A per-server override lives on
     * `serverProfiles.joinSoundId`. */
    joinSoundId: v.optional(v.string()),
    /** Optional platform-level moderation state, separate from community bans. */
    platformSuspendedUntil: v.optional(v.number()),
    platformSuspensionReason: v.optional(v.string()),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_username", ["username"])
    .searchIndex("search_name", { searchField: "name" }),

  /**
   * What each badge looks like and means — the catalogue the ids in
   * `userBadges` point at.
   *
   * Data rather than code, so a new badge is a row instead of a release: the
   * definition used to live in the client bundle, which meant granting one to
   * somebody on an older build showed them nothing at all.
   *
   * A badge is drawn as *either* an icon or a picture. `icon` is the export
   * name of a react-icons glyph ("BsFillPersonBadgeFill"), which the client
   * resolves at render time — see src/lib/react-icons.ts for which packs it
   * knows how to reach and what a name has to look like. `imageUrl` is for the
   * ones a glyph can't be: a logo, an event badge, anything with more than one
   * colour in it. Set both and the picture wins.
   */
  badges: defineTable({
    /** Stable key. What `userBadges.badgeId` holds, and what a grant names. */
    badgeId: v.string(),
    label: v.string(),
    /** Shown on hover — the reason someone has it. */
    description: v.string(),
    /** A react-icons export name, e.g. "BsBugFill". */
    icon: v.optional(v.string()),
    /** Or a picture, for badges a single-colour glyph can't carry. */
    imageUrl: v.optional(v.string()),
    /** Tailwind classes for the glyph's colour. Each badge gets its own so a
     * row of them reads as distinct things rather than one thing repeated.
     * Ignored for `imageUrl` badges, which bring their own colours. */
    className: v.optional(v.string()),
    /**
     * Badges that are tiers of one thing — Bug Hunter bronze through diamond —
     * share a `group`, and only the highest `tier` a user holds is drawn. Five
     * identical bug glyphs say less than one diamond one.
     *
     * A group rather than a level field on `userBadges`, because a promotion
     * stays "revoke tier N, grant tier N+1" with no new machinery, and the
     * grant history keeps the date each tier was reached.
     */
    group: v.optional(v.string()),
    tier: v.optional(v.number()),
    /** Where it sits in a row of badges. Ties fall back to when it was
     * granted, so an unordered catalogue still renders consistently. */
    position: v.optional(v.number()),
  }).index("by_badge_id", ["badgeId"]),

  /**
   * Badges earned by a user — "Early Supporter" and whatever comes after.
   *
   * A row per (user, badge) rather than a field on `users`, so granting one
   * doesn't rewrite the user document and `grantedAt` is recorded per badge
   * ("Early Supporter since March"). `badgeId` names a row in `badges` above;
   * an id with no definition is skipped on read rather than breaking the card,
   * so deleting a definition is safe.
   */
  userBadges: defineTable({
    userId: v.id("users"),
    badgeId: v.string(),
    grantedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_badge", ["userId", "badgeId"]),

  friendships: defineTable({
    ownerId: v.id("users"),
    friendId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_friend", ["ownerId", "friendId"]),

  friendRequests: defineTable({
    requesterId: v.id("users"),
    recipientId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_recipient", ["recipientId"])
    .index("by_requester", ["requesterId"])
    .index("by_pair", ["requesterId", "recipientId"]),

  presence: defineTable({
    userId: v.id("users"),
    /** What they chose. See src/lib/presence.ts for what each one means;
     * "online" is the key for the active state, kept as it is so no row has to
     * be migrated to say the same thing in different letters. */
    manualStatus: v.union(
      v.literal("online"),
      v.literal("idle"),
      v.literal("away"),
      v.literal("dnd"),
      v.literal("busy"),
      v.literal("invisible")
    ),
    isIdle: v.boolean(),
    lastHeartbeat: v.number(),
    /** What everybody else sees — the same set, with invisible collapsed into
     * offline, which is the whole point of it. */
    effective: v.union(
      v.literal("online"),
      v.literal("idle"),
      v.literal("away"),
      v.literal("dnd"),
      v.literal("busy"),
      v.literal("offline")
    ),
    /** Rich Presence, richest first — a user can be playing something and
     * listening to something at once (see electron/richPresence.ts). Empty or
     * undefined when nothing is detected. */
    activities: v.optional(v.array(activityValidator)),
    /** @deprecated Superseded by `activities`. Kept so presence rows written
     * before the list existed still validate; read via `activitiesOf`. */
    activity: v.optional(activityValidator),
  })
    .index("by_user", ["userId"])
    .index("by_last_heartbeat", ["lastHeartbeat"]),

  /**
   * One row per signed-in device, so "is this user online" becomes a question
   * about their devices rather than about a single shared counter.
   *
   * The `presence` row above is the *answer* — one status per user, which is
   * what every viewer renders. It used to be the question too: it carried the
   * only `lastHeartbeat`, so whichever client wrote last owned it, and the
   * stale sweep flipped the user offline the moment that client stopped. A
   * phone going into the background could therefore mark someone offline while
   * their desktop app sat open in front of them.
   *
   * Splitting the two lets the sweep ask "are *any* of this user's devices
   * still beating?" and only fall back to offline when none are.
   */
  presenceSessions: defineTable({
    userId: v.id("users"),
    /** Stable per-install id. Two clients on one account are two rows. */
    deviceId: v.string(),
    platform: v.union(v.literal("desktop"), v.literal("mobile"), v.literal("web")),
    /** This device's own idle state. A user counts as idle only when every
     * live device is — a phone in a pocket shouldn't idle out a desktop. */
    isIdle: v.boolean(),
    lastHeartbeat: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_device", ["userId", "deviceId"])
    .index("by_last_heartbeat", ["lastHeartbeat"]),

  /**
   * Play history, one row per (user, game) rather than per session — the
   * profile's "Recent activity" list only needs "what, when last, how long in
   * total", and collapsing it this way keeps the table bounded no matter how
   * often someone alt-tabs.
   *
   * Games only. Music and other activity types are deliberately not recorded:
   * a track-by-track history is a different feature with very different
   * privacy weight, and the live `presence.activities` already covers
   * "what are they listening to right now".
   */
  gameHistory: defineTable({
    userId: v.id("users"),
    /** Lowercased game name — stable across the detectable and IPC sources,
     * which can report the same title with different casing. */
    gameKey: v.string(),
    name: v.string(),
    imageUrl: v.optional(v.string()),
    /** Start of the session currently being timed, if one is running. */
    startedAt: v.optional(v.number()),
    /** Epoch ms the game was last seen running. */
    lastPlayedAt: v.number(),
    /** Total play time across every recorded session, in ms. */
    totalMs: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_game", ["userId", "gameKey"])
    .index("by_user_last_played", ["userId", "lastPlayedAt"]),

  conversations: defineTable({
    type: v.union(v.literal("dm"), v.literal("group")),
    name: v.optional(v.string()),
    dmKey: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    /** Custom group icon (group conversations only) — falls back to the
     * first two members' avatars overlapping when unset. */
    imageUrl: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
    /** A picture behind this conversation's messages. Set by any member —
     * a DM has no roles, and two people sharing a room can share its
     * wallpaper. Same fields as `channels`, and drawn by the same component. */
    backgroundUrl: v.optional(v.string()),
    backgroundStorageId: v.optional(v.id("_storage")),
    backgroundOpacity: v.optional(v.number()),
  }).index("by_dm_key", ["dmKey"]),

  conversationMembers: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    joinedAt: v.number(),
    lastReadAt: v.number(),
    /** Kept at the top of this member's DM list, above the by-recency rest.
     * Per-member — pinning a DM is one person's arrangement of their own list. */
    pinnedAt: v.optional(v.number()),
    /** This member closed the DM: it drops out of their list until something
     * new is said in it (a message after `closedAt`) or they open it again.
     * The conversation and its history are untouched — this is "hide from my
     * list", not "delete". */
    closedAt: v.optional(v.number()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user", ["userId"])
    .index("by_conversation_user", ["conversationId", "userId"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    authorId: v.id("users"),
    text: v.optional(v.string()),
    editedAt: v.optional(v.number()),
    pinnedAt: v.optional(v.number()),
    /** The message this one is a reply to, in the same conversation. Optional
     * ⇒ nothing to backfill; a dangling id (target since deleted) renders as
     * "original message was deleted". */
    replyToId: v.optional(v.id("messages")),
    /** This message was sent from the "wish them a happy birthday" prompt.
     * Recorded on the message rather than announced some other way because
     * both people need to see the cakes fall and both are already subscribed
     * to this conversation — the message arriving *is* the signal. */
    birthdayWish: v.optional(v.boolean()),
    /** Client-minted idempotency key for the durable send outbox (see
     * src/lib/outbox.ts). A queued send that gets retried after its ack was
     * lost carries the same `clientId`, so `send` can hand back the row it
     * already inserted instead of a duplicate. Also what the optimistic
     * overlay matches a pending send against once the real row lands. */
    clientId: v.optional(v.string()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_client_id", ["clientId"])
    // Scoped search — see convex/search.ts. The filter field is what lets a
    // search mean "in this conversation" without scanning every message.
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["conversationId"],
    }),

  messageAttachments: defineTable({
    messageId: v.id("messages"),
    storageId: v.optional(v.id("_storage")),
    cdnKey: v.optional(v.string()),
    cdnUrl: v.optional(v.string()),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
  }).index("by_message", ["messageId"]),

  messageReactions: defineTable({
    messageId: v.id("messages"),
    userId: v.id("users"),
    emoji: v.string(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_user_emoji", ["messageId", "userId", "emoji"]),

  callParticipants: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    joinedAt: v.number(),
    /** Screen-share state, as on `channelCallParticipants`. */
    streaming: v.optional(v.boolean()),
    streamThumbnailUrl: v.optional(v.string()),
    streamThumbnailStorageId: v.optional(v.id("_storage")),
    streamThumbnailAt: v.optional(v.number()),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_user", ["conversationId", "userId"])
    .index("by_user", ["userId"]),

  /**
   * An in-flight "someone is calling you" for a DM or group conversation.
   *
   * One row per recipient rather than one per call, so each person's ring can
   * be answered, declined or expired independently. Rows are deleted the
   * moment they're resolved — a row existing *is* the ringing state, which
   * keeps the recipient's query trivial.
   */
  callRings: defineTable({
    conversationId: v.id("conversations"),
    callerId: v.id("users"),
    recipientId: v.id("users"),
    createdAt: v.number(),
    /** Scheduled sweep that turns an unanswered ring into a missed call. */
    expiryJobId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_recipient", ["recipientId"])
    .index("by_conversation", ["conversationId"])
    .index("by_conversation_recipient", ["conversationId", "recipientId"]),

  linkPreviews: defineTable({
    url: v.string(),
    status: v.union(v.literal("ok"), v.literal("error")),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    image: v.optional(v.string()),
    siteName: v.optional(v.string()),
    /** Recognised provider key ("youtube", "spotify", …) — see
     * convex/lib/richEmbeds.ts. Absent for the ordinary scraped link that
     * just gets a generic card. */
    provider: v.optional(v.string()),
    /** What the card should offer: a plain link, or something playable. */
    kind: v.optional(v.union(v.literal("link"), v.literal("video"), v.literal("audio"))),
    /** Who made it — the uploader, artist or author, where a provider says. */
    authorName: v.optional(v.string()),
    authorUrl: v.optional(v.string()),
    /** In-place player. Always built from a parsed resource id rather than
     * copied out of a provider's oEmbed HTML, and framed by the client only
     * if its host is on the client's allow-list. */
    embedUrl: v.optional(v.string()),
    /** Player aspect ratio (width ÷ height), for video. */
    embedAspect: v.optional(v.number()),
    /** Fixed player height in pixels, for audio. */
    embedHeight: v.optional(v.number()),
    /** The site's own accent colour, used for the card's edge. */
    themeColor: v.optional(v.string()),
    faviconUrl: v.optional(v.string()),
    /** Which version of the unfurler produced this row — see
     * `UNFURL_VERSION` in convex/lib/richEmbeds.ts. Anything older is
     * re-unfurled on sight. */
    version: v.optional(v.number()),
    fetchedAt: v.number(),
  }).index("by_url", ["url"]),

  // --- Communities ---------------------------------------------------------

  communities: defineTable({
    name: v.string(),
    ownerId: v.id("users"),
    imageUrl: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    inviteCode: v.optional(v.string()),
    bannerUrl: v.optional(v.string()),
    bannerStorageId: v.optional(v.id("_storage")),
    /** When true (the default — treat a missing value as `true`), the server
     * can only be joined with an invite code/link: it's hidden from Discovery
     * and the "join" button on an emoji card is replaced with a notice. */
    inviteOnly: v.optional(v.boolean()),
    /**
     * The community's colours: the two ends of a gradient (`#rrggbb`) that tints
     * its overview and channels for everyone who is in it. Both or neither —
     * half a gradient is just a colour, and not the one that was chosen.
     */
    themeStart: v.optional(v.string()),
    themeEnd: v.optional(v.string()),
    /**
     * What kind of community this is. Absent is a standard one. See
     * convex/lib/communityKinds.ts: a kind is a set of capabilities (special
     * channels and tools), not a different thing.
     */
    kind: v.optional(v.union(v.literal("creator"), v.literal("clan"))),
    /** A clan's games — one to five, in the order the clan listed them. */
    clanGames: v.optional(v.array(v.object({ id: v.string(), name: v.string() }))),
    /** A creator community's home platform and who may join. */
    creatorPlatform: v.optional(v.union(v.literal("twitch"), v.literal("youtube"), v.literal("tiktok"))),
    creatorAudience: v.optional(v.union(v.literal("public"), v.literal("members"))),
  })
    .index("by_owner", ["ownerId"])
    .searchIndex("search_name", { searchField: "name" })
    .index("by_invite_code", ["inviteCode"]),

  communityMembers: defineTable({
    communityId: v.id("communities"),
    userId: v.id("users"),
    joinedAt: v.number(),
    /** Epoch ms a timeout expires. While in the future the member stays in
     * the server but can't send messages or join voice. */
    timeoutUntil: v.optional(v.number()),
  })
    .index("by_community", ["communityId"])
    .index("by_user", ["userId"])
    .index("by_community_user", ["communityId", "userId"]),

  /** Bans are kept after the membership row is deleted, so a banned user
   * can't simply rejoin with a fresh invite. */
  communityBans: defineTable({
    communityId: v.id("communities"),
    userId: v.id("users"),
    bannedBy: v.id("users"),
    reason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_user", ["communityId", "userId"]),

  /** A role's `permissions` is a bitfield — see convex/permissions.ts. Every
   * community gets one `isEveryone` role at creation (the permission floor
   * every member has); it can't be renamed or deleted. */
  roles: defineTable({
    communityId: v.id("communities"),
    name: v.string(),
    color: v.optional(v.string()),
    permissions: v.number(),
    position: v.number(),
    isEveryone: v.boolean(),
    /** "Display members with this role separately from online members" —
     * mirrors Discord's per-role hoist toggle. Used to group the member
     * list (src/components/community/member-list.tsx). */
    hoist: v.optional(v.boolean()),
  })
    .index("by_community", ["communityId"])
    .index("by_community_position", ["communityId", "position"]),

  memberRoles: defineTable({
    communityId: v.id("communities"),
    userId: v.id("users"),
    roleId: v.id("roles"),
  })
    .index("by_member", ["communityId", "userId"])
    .index("by_role", ["roleId"]),

  /** A community's channels can be grouped under collapsible categories
   * (or left uncategorized — `channels.categoryId` unset). `position`
   * orders categories relative to each other, same convention as
   * `channels.position` ordering channels within one. */
  channelCategories: defineTable({
    communityId: v.id("communities"),
    name: v.string(),
    position: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_position", ["communityId", "position"]),

  channels: defineTable({
    communityId: v.id("communities"),
    name: v.string(),
    type: v.union(v.literal("text"), v.literal("voice")),
    topic: v.optional(v.string()),
    categoryId: v.optional(v.id("channelCategories")),
    position: v.number(),
    createdAt: v.number(),
    /** When the newest message landed, denormalised from `channelMessages`.
     * Unread state is a comparison against `channelReads.lastReadAt`, and
     * doing it from here means one read per channel list rather than one
     * "newest message" query per channel every time anyone says anything
     * anywhere. */
    lastMessageAt: v.optional(v.number()),
    /**
     * A picture behind the message list.
     *
     * A property of the channel rather than of the viewer: it's set by whoever
     * can manage the channel and everybody in it sees the same room. `opacity`
     * is stored alongside because the only way to make an arbitrary photograph
     * work behind text is to be able to turn it down.
     */
    backgroundUrl: v.optional(v.string()),
    backgroundStorageId: v.optional(v.id("_storage")),
    backgroundOpacity: v.optional(v.number()),
    /**
     * The banner strip under the channel header: a faded picture with a title
     * and a line of description over it.
     *
     * Its own title rather than reusing `name`, and its own text rather than
     * reusing `topic`, because a banner is an announcement — "Read the rules
     * before posting" — and a topic is a label. Either may be absent; a banner
     * with only a picture is a picture.
     */
    bannerUrl: v.optional(v.string()),
    bannerStorageId: v.optional(v.id("_storage")),
    bannerTitle: v.optional(v.string()),
    bannerDescription: v.optional(v.string()),
    /**
     * A voice channel that is a **lounge**: a 2D room people walk around in,
     * with a screen on the wall for whichever stream is being watched. It is
     * still a voice channel in every way that matters (the same LiveKit room,
     * the same participant rows, the same permissions), which is why this is a
     * flag on a voice channel and not a third channel type.
     */
    isLounge: v.optional(v.boolean()),
    /**
     * A text channel that shows something other than a message list — a feed, a
     * calendar, a forum, a game server. See convex/lib/communityKinds.ts. Only
     * communities of a kind that allows it can have one.
     */
    surface: v.optional(
      v.union(
        v.literal("feed"),
        v.literal("calendar"),
        v.literal("ama"),
        v.literal("threads"),
        v.literal("servers"),
        v.literal("lfg"),
        v.literal("roster"),
      ),
    ),
    /** The clan game a channel belongs to, where it belongs to one. */
    gameId: v.optional(v.string()),
    /** A built-in scene's id (src/lib/lounge-scenes.tsx), or `"custom"` when
     * `loungeSceneCustom` — a scene bought from the marketplace — is in use. */
    loungeScene: v.optional(v.string()),
    loungeSceneCustom: v.optional(
      v.object({
        name: v.string(),
        backgroundUrl: v.string(),
        /** Where the screen is, as percentages of the picture. */
        screen: v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
        /** Where the floor starts, as a percentage from the top. */
        floorTop: v.number(),
        /** Where people can sit, and the animated props — see
         * convex/lib/creationSpecs.ts. Absent on scenes bought before they existed. */
        seats: v.optional(v.array(v.object({ x: v.number(), y: v.number() }))),
        props: v.optional(
          v.array(
            v.object({
              id: v.string(),
              kind: v.string(),
              x: v.number(),
              y: v.number(),
              size: v.number(),
              interactive: v.boolean(),
              on: v.boolean(),
            }),
          ),
        ),
        lights: v.optional(v.object({ dimOnShare: v.boolean(), amount: v.number() })),
      }),
    ),
    /** What the room is about right now. Set by anyone in it, and gone when
     * the last person leaves. */
    loungeTopic: v.optional(v.string()),
    loungeTopicBy: v.optional(v.id("users")),
    loungeTopicAt: v.optional(v.number()),
  })
    .index("by_community", ["communityId"])
    .index("by_community_position", ["communityId", "position"]),

  // --- Extensions ------------------------------------------------------------------------

  /** Something a person can install to extend Crystal: its identity and who made it.
   * What it does is in its versions, each reviewed on its own. */
  extensions: defineTable({
    slug: v.string(),
    publisherId: v.id("users"),
    name: v.string(),
    description: v.string(),
    kind: v.union(v.literal("plugin"), v.literal("component")),
    /** Stopping one stops it everywhere, for everyone, whatever version they have. */
    suspendedAt: v.optional(v.number()),
    suspendedReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_publisher", ["publisherId"]),

  /**
   * One release of an extension: its code, exactly as submitted, and the hash of it.
   *
   * The code is stored here rather than as a file somewhere else so that what was
   * reviewed *is* what is run: the client checks the hash before it runs anything, and
   * a version is never edited — a change is a new version and a new review.
   */
  extensionVersions: defineTable({
    extensionId: v.id("extensions"),
    version: v.string(),
    manifest: v.object({
      v: v.literal(1),
      name: v.string(),
      description: v.string(),
      version: v.string(),
      kind: v.union(v.literal("plugin"), v.literal("component")),
      capabilities: v.array(v.string()),
      network: v.array(v.string()),
      panel: v.optional(v.object({ title: v.string() })),
    }),
    source: v.string(),
    hash: v.string(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"), v.literal("revoked")),
    /** What the scan found when it was submitted, kept with it for the reviewer. */
    findings: v.array(v.object({ level: v.string(), message: v.string() })),
    reviewNote: v.optional(v.string()),
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_extension", ["extensionId", "createdAt"])
    .index("by_status", ["status", "createdAt"]),

  /** An extension a person has turned on, and the powers they agreed to give it. */
  extensionInstalls: defineTable({
    userId: v.id("users"),
    extensionId: v.id("extensions"),
    versionId: v.id("extensionVersions"),
    /** A subset of what the version's manifest asks for — what the person said yes to. */
    granted: v.array(v.string()),
    installedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_extension", ["userId", "extensionId"])
    .index("by_extension", ["extensionId"]),

  /** An extension's private data, per person. Another extension can't see it. */
  extensionStorage: defineTable({
    userId: v.id("users"),
    extensionId: v.id("extensions"),
    key: v.string(),
    value: v.string(),
  })
    .index("by_user_extension", ["userId", "extensionId"])
    .index("by_user_extension_key", ["userId", "extensionId", "key"]),

  /** Requests an extension has made through Crystal's proxy, for rate limiting. */
  extensionHttpLog: defineTable({
    userId: v.id("users"),
    extensionId: v.id("extensions"),
    at: v.number(),
  }).index("by_user_extension_at", ["userId", "extensionId", "at"]),

  // --- Creator communities --------------------------------------------------------------

  /**
   * An outside account a person has connected to theirs — a Twitch, YouTube or
   * TikTok login. Tokens are stored only as ciphertext (convex/lib/secrets.ts)
   * and are never returned to a client; what a client sees is who the account is.
   */
  connectedAccounts: defineTable({
    userId: v.id("users"),
    provider: v.union(v.literal("twitch"), v.literal("youtube"), v.literal("tiktok")),
    /** The platform's own id for the account — stable, unlike a handle. */
    externalId: v.string(),
    displayName: v.string(),
    handle: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    accessCipher: v.string(),
    refreshCipher: v.optional(v.string()),
    /** When the access token stops working, in epoch ms. */
    expiresAt: v.optional(v.number()),
    scopes: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastError: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_provider_external", ["provider", "externalId"]),

  /** The platform channel a creator community is centred on. */
  creatorChannels: defineTable({
    communityId: v.id("communities"),
    accountId: v.id("connectedAccounts"),
    provider: v.union(v.literal("twitch"), v.literal("youtube"), v.literal("tiktok")),
    /** The channel's id on the platform (a Twitch user id, a YouTube channel id…). */
    channelId: v.string(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
    url: v.optional(v.string()),
    isLive: v.boolean(),
    liveTitle: v.optional(v.string()),
    liveSince: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    lastSyncError: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_account", ["accountId"]),

  /** Recent streams, VODs and uploads from the channel, normalised. */
  creatorFeedItems: defineTable({
    communityId: v.id("communities"),
    provider: v.union(v.literal("twitch"), v.literal("youtube"), v.literal("tiktok")),
    /** The platform's id for the item — makes a re-sync an update, not a duplicate. */
    externalId: v.string(),
    kind: v.union(v.literal("live"), v.literal("vod"), v.literal("upload"), v.literal("short")),
    title: v.string(),
    thumbnailUrl: v.optional(v.string()),
    url: v.string(),
    durationSeconds: v.optional(v.number()),
    views: v.optional(v.number()),
    publishedAt: v.number(),
  })
    .index("by_community_published", ["communityId", "publishedAt"])
    .index("by_community_external", ["communityId", "externalId"]),

  /** A platform membership tier, and the role it was imported as. */
  creatorTiers: defineTable({
    communityId: v.id("communities"),
    /** The platform's key for the tier: `1000`/`2000`/`3000` on Twitch, a level id on YouTube. */
    tierKey: v.string(),
    name: v.string(),
    /** Lowest first, so a higher tier outranks the ones below it. */
    rank: v.number(),
    roleId: v.id("roles"),
  })
    .index("by_community", ["communityId"])
    .index("by_role", ["roleId"]),

  /** What a member is, on the platform, as last checked. One row per member. */
  creatorMemberships: defineTable({
    communityId: v.id("communities"),
    userId: v.id("users"),
    tierKey: v.optional(v.string()),
    checkedAt: v.number(),
  }).index("by_community_user", ["communityId", "userId"]),

  /** A question put to the creator in an AMA channel. */
  amaQuestions: defineTable({
    channelId: v.id("channels"),
    communityId: v.id("communities"),
    authorId: v.id("users"),
    text: v.string(),
    votes: v.number(),
    status: v.union(v.literal("open"), v.literal("current"), v.literal("answered"), v.literal("dismissed")),
    answer: v.optional(v.string()),
    createdAt: v.number(),
    answeredAt: v.optional(v.number()),
  })
    .index("by_channel_status", ["channelId", "status", "votes"])
    .index("by_channel_created", ["channelId", "createdAt"]),

  amaVotes: defineTable({
    questionId: v.id("amaQuestions"),
    userId: v.id("users"),
  })
    .index("by_question_user", ["questionId", "userId"])
    .index("by_question", ["questionId"]),

  /** A thread channel's posts: each one a conversation of its own. */
  forumPosts: defineTable({
    channelId: v.id("channels"),
    communityId: v.id("communities"),
    authorId: v.id("users"),
    title: v.string(),
    body: v.string(),
    createdAt: v.number(),
    lastActivityAt: v.number(),
    replyCount: v.number(),
    pinned: v.boolean(),
    locked: v.boolean(),
  })
    .index("by_channel_activity", ["channelId", "lastActivityAt"])
    .index("by_channel_pinned", ["channelId", "pinned", "lastActivityAt"]),

  forumReplies: defineTable({
    postId: v.id("forumPosts"),
    authorId: v.id("users"),
    text: v.string(),
    createdAt: v.number(),
  }).index("by_post", ["postId", "createdAt"]),

  // --- Clans and the calendar ---------------------------------------------------------

  /** Who plays a clan's game, as what. One row per member per game. */
  clanRoster: defineTable({
    communityId: v.id("communities"),
    userId: v.id("users"),
    gameId: v.string(),
    /** Their name in the game, which is rarely their name here. */
    ign: v.string(),
    rank: v.optional(v.string()),
    role: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_community_game", ["communityId", "gameId"])
    .index("by_member", ["communityId", "userId"]),

  /** "Need two for ranked": a call for people to play something now, which
   * expires on its own. */
  lfgPosts: defineTable({
    communityId: v.id("communities"),
    gameId: v.string(),
    authorId: v.id("users"),
    title: v.string(),
    details: v.optional(v.string()),
    /** How many more people it needs. */
    slots: v.number(),
    joined: v.array(v.id("users")),
    createdAt: v.number(),
    expiresAt: v.number(),
    closedAt: v.optional(v.number()),
  }).index("by_community", ["communityId", "createdAt"]),

  /** Something scheduled: an event, a scrim, a stream. Shared by clans and
   * creator communities. */
  communityEvents: defineTable({
    communityId: v.id("communities"),
    kind: v.union(v.literal("event"), v.literal("scrim"), v.literal("stream")),
    title: v.string(),
    details: v.optional(v.string()),
    gameId: v.optional(v.string()),
    startsAt: v.number(),
    endsAt: v.optional(v.number()),
    /** For a scrim: how many it can field. */
    capacity: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    cancelledAt: v.optional(v.number()),
  }).index("by_community_start", ["communityId", "startsAt"]),

  eventRsvps: defineTable({
    eventId: v.id("communityEvents"),
    communityId: v.id("communities"),
    userId: v.id("users"),
    status: v.union(v.literal("going"), v.literal("maybe")),
    /** In the lineup, for a scrim — set by whoever manages events. */
    starter: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_event_user", ["eventId", "userId"]),

  // --- Game servers (Pterodactyl) -----------------------------------------------------

  /**
   * A community's connection to a Pterodactyl panel.
   *
   * The API key is a *client* key — the same reach as the person who made it —
   * and is stored only as ciphertext (AES-GCM under CREDENTIALS_ENCRYPTION_KEY).
   * It is read by server-side actions and never returned to any client; what a
   * client gets is `keyHint`, the last four characters, to tell keys apart.
   */
  gameServerPanels: defineTable({
    communityId: v.id("communities"),
    /** `https://panel.example.com` — an origin, validated on the way in. */
    baseUrl: v.string(),
    keyCipher: v.string(),
    keyHint: v.string(),
    connectedBy: v.id("users"),
    createdAt: v.number(),
    lastOkAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index("by_community", ["communityId"]),

  /**
   * One panel server a community has chosen to show, and who may do what to it.
   *
   * `access` is what Crystal allows, and the panel key's own reach is the ceiling:
   * a member can never do something to a server the key can't. `view` sees state
   * and usage and `power` also starts and stops it. Managers always have all of it.
   */
  gameServers: defineTable({
    communityId: v.id("communities"),
    panelId: v.id("gameServerPanels"),
    /** The panel's short id for the server — the 8 characters in its URL. */
    identifier: v.string(),
    name: v.string(),
    /** The clan game it belongs to, where there is one. */
    gameId: v.optional(v.string()),
    /**
     * Whether every member sees this server's details — its picture, description,
     * game and what to install — whether or not they may operate it. Operating it
     * is `everyoneLevel`/`roleAccess`; this is only about being told it exists.
     */
    listed: v.optional(v.boolean()),
    /** What is shown about it. Rebuilt on the way in — see convex/lib/serverProfile.ts. */
    profile: v.optional(
      v.object({
        displayName: v.optional(v.string()),
        description: v.optional(v.string()),
        gameName: v.optional(v.string()),
        gameVersion: v.optional(v.string()),
        address: v.optional(v.string()),
        minecraft: v.optional(
          v.object({
            loader: v.string(),
            loaderVersion: v.optional(v.string()),
            modpack: v.optional(
              v.object({
                name: v.string(),
                url: v.string(),
                version: v.optional(v.string()),
                format: v.union(v.literal("mrpack"), v.literal("zip")),
                source: v.union(v.literal("modrinth"), v.literal("curseforge"), v.literal("other")),
                pageUrl: v.optional(v.string()),
              }),
            ),
            packs: v.array(
              v.object({
                name: v.string(),
                url: v.string(),
                version: v.optional(v.string()),
                kind: v.union(v.literal("resourcepack"), v.literal("shader")),
                required: v.boolean(),
              }),
            ),
          }),
        ),
      }),
    ),
    iconUrl: v.optional(v.string()),
    iconStorageId: v.optional(v.id("_storage")),
    everyoneLevel: v.union(v.literal("none"), v.literal("view"), v.literal("power")),
    roleAccess: v.array(
      v.object({
        roleId: v.id("roles"),
        level: v.union(v.literal("view"), v.literal("power")),
      }),
    ),
    position: v.number(),
    createdAt: v.number(),
  })
    .index("by_community", ["communityId", "position"])
    .index("by_panel", ["panelId"]),

  /** Everything done to a game server through Crystal, and by whom. */
  gameServerAudit: defineTable({
    communityId: v.id("communities"),
    serverId: v.id("gameServers"),
    userId: v.id("users"),
    action: v.string(),
    detail: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_community", ["communityId", "createdAt"]),

  /** What is said in a lounge. Kept only while people are in it. */
  loungeMessages: defineTable({
    channelId: v.id("channels"),
    authorId: v.id("users"),
    kind: v.union(v.literal("text"), v.literal("image"), v.literal("emoji"), v.literal("sticker")),
    text: v.optional(v.string()),
    /** An emoji, unicode or `<:name:id>`, for the kind that floats. */
    emoji: v.optional(v.string()),
    sticker: v.optional(v.object({ source: v.union(v.literal("builtin"), v.literal("emoji")), id: v.string() })),
    image: v.optional(
      v.object({
        storageId: v.optional(v.id("_storage")),
        cdnUrl: v.optional(v.string()),
        cdnKey: v.optional(v.string()),
        fileName: v.string(),
        fileType: v.string(),
        fileSize: v.number(),
      }),
    ),
    createdAt: v.number(),
  }).index("by_channel", ["channelId", "createdAt"]),

  /**
   * How far a member has read in a channel.
   *
   * Absent means "never opened it", which reads as unread if the channel has
   * any message at all — the same thing Discord does with a channel you've
   * just been invited to. Carries `communityId` so a server's worth of
   * markers is one indexed read rather than a scan of every channel the user
   * has ever opened.
   */
  channelReads: defineTable({
    userId: v.id("users"),
    channelId: v.id("channels"),
    communityId: v.id("communities"),
    lastReadAt: v.number(),
  })
    .index("by_user_channel", ["userId", "channelId"])
    .index("by_user_community", ["userId", "communityId"]),

  /** Per-channel allow/deny overwrite for a role OR a specific member
   * (exactly one of `roleId`/`userId` is set) — see
   * `computeChannelPermissions` in convex/permissions.ts for precedence. */
  channelPermissionOverwrites: defineTable({
    channelId: v.id("channels"),
    roleId: v.optional(v.id("roles")),
    userId: v.optional(v.id("users")),
    allow: v.number(),
    deny: v.number(),
  }).index("by_channel", ["channelId"]),

  channelMessages: defineTable({
    channelId: v.id("channels"),
    authorId: v.id("users"),
    text: v.optional(v.string()),
    editedAt: v.optional(v.number()),
    pinnedAt: v.optional(v.number()),
    /** The message this one is a reply to, in the same channel. See the twin
     * on `messages` above. */
    replyToId: v.optional(v.id("channelMessages")),
    /** Idempotency key for the durable send outbox — see the twin field on
     * `messages` above and src/lib/outbox.ts. */
    clientId: v.optional(v.string()),
  })
    .index("by_channel", ["channelId"])
    .index("by_client_id", ["clientId"])
    // Scoped search — see convex/search.ts. Filtered by channel rather than
    // community because these rows carry no community id; a server-wide search
    // fans out over the channels the caller can see instead, which needs no
    // backfill of existing messages.
    .searchIndex("search_text", {
      searchField: "text",
      filterFields: ["channelId"],
    }),

  channelMessageAttachments: defineTable({
    messageId: v.id("channelMessages"),
    storageId: v.optional(v.id("_storage")),
    cdnKey: v.optional(v.string()),
    cdnUrl: v.optional(v.string()),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
  }).index("by_message", ["messageId"]),

  channelMessageReactions: defineTable({
    messageId: v.id("channelMessages"),
    userId: v.id("users"),
    emoji: v.string(),
  })
    .index("by_message", ["messageId"])
    .index("by_message_user_emoji", ["messageId", "userId", "emoji"]),

  channelCallParticipants: defineTable({
    channelId: v.id("channels"),
    userId: v.id("users"),
    joinedAt: v.number(),
    /** Live call state, mirrored here by the connected client so the channel
     * list can show it to people who aren't in that call themselves — LiveKit
     * only tells you about rooms you're connected to. */
    muted: v.optional(v.boolean()),
    deafened: v.optional(v.boolean()),
    streaming: v.optional(v.boolean()),
    /** A recent still from this member's screen share, published by their own
     * client every few seconds while they're sharing. Lets somebody outside
     * the call see what's on before deciding to join it — the stream itself
     * can't be sampled without subscribing to it. */
    streamThumbnailUrl: v.optional(v.string()),
    streamThumbnailStorageId: v.optional(v.id("_storage")),
    streamThumbnailAt: v.optional(v.number()),
    /** Moderator-imposed, unlike `muted`/`deafened` above which the member
     * sets themselves. The connected client enforces these on itself — see
     * CallProvider — so they survive a reconnect. */
    serverMuted: v.optional(v.boolean()),
    serverDeafened: v.optional(v.boolean()),
  })
    .index("by_channel", ["channelId"])
    .index("by_channel_user", ["channelId", "userId"])
    .index("by_user", ["userId"]),

  /** Custom emoji uploaded per-community. Emoji are referenced in message
   * text and reactions as `<:name:id>` where `id` is the Convex document _id.
   * Each community can have at most 50 custom emoji slots. */
  communityEmojis: defineTable({
    communityId: v.id("communities"),
    /** Short identifier used in `<:name:id>` encoding — alphanumeric + underscores. */
    name: v.string(),
    /** Public served URL from Convex file storage — populated on add. */
    imageUrl: v.string(),
    /** Absent for an emoji uploaded to the CDN, which has no Convex file. */
    storageId: v.optional(v.id("_storage")),
    uploadedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_name", ["communityId", "name"]),

  /** Soundboard clips uploaded per-community, playable into a voice call by
   * any member. Built-in sounds (src/lib/soundboard.ts) ship with the app and
   * are available everywhere, so they are deliberately not stored here. */
  communitySounds: defineTable({
    communityId: v.id("communities"),
    name: v.string(),
    /** Emoji shown on the soundboard button. */
    emoji: v.optional(v.string()),
    /** Public served URL from Convex file storage — populated on add. */
    soundUrl: v.string(),
    storageId: v.id("_storage"),
    /** Clip length in ms, measured client-side at upload time. */
    durationMs: v.optional(v.number()),
    uploadedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_community", ["communityId"])
    .index("by_community_name", ["communityId", "name"]),

  /** Per-server profile overrides. Fields left undefined fall back to the
   * user's global profile. */
  serverProfiles: defineTable({
    userId: v.id("users"),
    communityId: v.id("communities"),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    customStatus: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    avatarStorageId: v.optional(v.id("_storage")),
    /** Same pairing as `users.avatarAccent`, for the per-server avatar. */
    avatarAccent: v.optional(v.string()),
    avatarAccentUrl: v.optional(v.string()),
    /** Pre-crop originals, as on `users` — kept so the crop stays adjustable. */
    avatarOriginalUrl: v.optional(v.string()),
    avatarOriginalStorageId: v.optional(v.id("_storage")),
    bannerUrl: v.optional(v.string()),
    bannerStorageId: v.optional(v.id("_storage")),
    bannerOriginalUrl: v.optional(v.string()),
    bannerOriginalStorageId: v.optional(v.id("_storage")),
    borderGradientStart: v.optional(v.string()),
    borderGradientEnd: v.optional(v.string()),
    profileBg: v.optional(v.string()),
    nameplateUrl: v.optional(v.string()),
    nameplateStorageId: v.optional(v.id("_storage")),
    ...profileCosmetics,
    /** Overrides `users.joinSoundId` in this community. */
    joinSoundId: v.optional(v.string()),
  })
    .index("by_user_community", ["userId", "communityId"])
    .index("by_community", ["communityId"]),

  /**
   * The cards on someone's profile Board — a favourite game, an about-me, what
   * they're playing this month.
   *
   * A row per widget rather than an array on the profile, because a widget
   * carries an uploaded image and its own fields: putting them in one document
   * would mean rewriting every widget to reorder two of them, and would put a
   * hard ceiling on the board at Convex's document size.
   *
   * `communityId` is what makes a board per-server. Absent is the account's
   * own board, which is what a DM or a friends-list profile shows; set means
   * "this is the board people in that community see instead". The index is on
   * the pair so both reads are one lookup, with the account board stored under
   * an undefined community rather than in a second table.
   */
  profileWidgets: defineTable({
    userId: v.id("users"),
    communityId: v.optional(v.id("communities")),
    /** Sort key within the board. Sparse and rewritten wholesale on reorder —
     * a board is a handful of cards, so there's nothing to be gained from
     * fractional indices here. */
    position: v.number(),
    title: v.optional(v.string()),
    subtitle: v.optional(v.string()),
    description: v.optional(v.string()),
    /** Cover image across the top of the card. */
    imageUrl: v.optional(v.string()),
    imageStorageId: v.optional(v.id("_storage")),
    /**
     * Label/value rows under the description.
     *
     * A text field's `value` is what it says; an image field's is the storage
     * URL of a picture, with `storageId` alongside so replacing or deleting the
     * widget can clean the file up. One array of a tagged union rather than two
     * arrays, so the order the user arranged them in survives.
     */
    fields: v.optional(
      v.array(
        v.object({
          id: v.string(),
          kind: v.union(v.literal("text"), v.literal("image")),
          label: v.string(),
          value: v.string(),
          storageId: v.optional(v.id("_storage")),
        })
      )
    ),
    /** Link buttons along the bottom. Capped by the mutation, not here. */
    buttons: v.optional(
      v.array(v.object({ id: v.string(), label: v.string(), url: v.string() }))
    ),
    /** Hex tint for the card's border and header wash. */
    accent: v.optional(v.string()),
  })
    .index("by_user_community", ["userId", "communityId"])
    .index("by_user", ["userId"]),

  /**
   * The cards on a server's Overview — its front page.
   *
   * Typed, unlike `profileWidgets`, which is deliberately shapeless. The
   * difference is who resolves the contents: a profile widget is words and
   * pictures its owner typed, so one free-form shape covers everything, whereas
   * "recent messages in #general" and "these five channels" have to be looked
   * up on the server at read time. A `kind` is what tells the query which
   * lookup to do.
   *
   * The per-kind configuration is a union rather than a bag of optional
   * fields, so a widget cannot be half a channel list and half a banner.
   */
  communityWidgets: defineTable({
    communityId: v.id("communities"),
    position: v.number(),
    /** Shown above the card. Optional — a banner is usually its own title. */
    title: v.optional(v.string()),
    /** How much of the row it takes. Kept in step with `layout` for readers
     * that predate it: wide enough to be "full", else "half". */
    width: v.optional(v.union(v.literal("half"), v.literal("full"))),
    /** Where the card sits on the overview's twelve-column grid, in cells.
     * Absent on cards from before the pinboard; the client places those. */
    layout: v.optional(v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() })),
    config: v.union(
      /** A short list of channels worth reading first. */
      v.object({
        kind: v.literal("channels"),
        channelIds: v.array(v.id("channels")),
        description: v.optional(v.string()),
      }),
      /** The last few messages from one channel, as a preview. */
      v.object({
        kind: v.literal("recentMessages"),
        channelId: v.id("channels"),
        limit: v.optional(v.number()),
      }),
      /** Free text. The one escape hatch, so a server can say anything the
       * other kinds don't cover without waiting for a release. */
      v.object({
        kind: v.literal("markdown"),
        body: v.string(),
      }),
      /** A picture with words over it. */
      v.object({
        kind: v.literal("banner"),
        imageUrl: v.optional(v.string()),
        imageStorageId: v.optional(v.id("_storage")),
        heading: v.optional(v.string()),
        subheading: v.optional(v.string()),
        linkUrl: v.optional(v.string()),
        linkLabel: v.optional(v.string()),
      }),
      /** A numbered list of the community's rules, each a short title and an
       * optional sentence of explanation. */
      v.object({
        kind: v.literal("rules"),
        rules: v.array(v.object({ title: v.string(), body: v.optional(v.string()) })),
      }),
      /** A personal note from the community's owner, drawn as a post-it. The
       * author is not stored: it is whoever owns the community when it is read,
       * so the name and avatar are never out of date. */
      v.object({
        kind: v.literal("note"),
        body: v.string(),
        color: v.optional(v.string()),
      }),
      /** A timer counting down to a moment. */
      v.object({
        kind: v.literal("countdown"),
        /** Epoch ms. */
        target: v.number(),
        description: v.optional(v.string()),
      }),
      /** A month calendar with the days something is happening marked. */
      v.object({
        kind: v.literal("calendar"),
        events: v.array(v.object({ date: v.string(), title: v.string() })),
      }),
      /** A question with a few answers, voted on by members. Votes live in
       * `communityPollVotes`, one row each. */
      v.object({
        kind: v.literal("poll"),
        question: v.string(),
        options: v.array(v.string()),
        /** Epoch ms voting stops. Open-ended when absent. */
        closesAt: v.optional(v.number()),
      }),
    ),
  }).index("by_community", ["communityId"]),

  /** One member's vote on one poll card. At most one row per member per card:
   * voting again replaces it, retracting deletes it. */
  communityPollVotes: defineTable({
    widgetId: v.id("communityWidgets"),
    communityId: v.id("communities"),
    userId: v.id("users"),
    optionIndex: v.number(),
  })
    .index("by_widget", ["widgetId"])
    .index("by_widget_user", ["widgetId", "userId"]),

  /**
   * A reusable shape for a community — channels, roles and rules — that
   * somebody saved and can hand out by code. The built-in presets live in the
   * client (src/lib/community-templates.ts) and are not rows here.
   */
  communityTemplates: defineTable({
    ownerId: v.id("users"),
    /** What is shared: short, upper-case, easy to read out. */
    code: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    setup: setupValidator,
    createdAt: v.number(),
    /** How many communities have been made from it. */
    uses: v.optional(v.number()),
  })
    .index("by_code", ["code"])
    .index("by_owner", ["ownerId"]),

  typing: defineTable({
    userId: v.id("users"),
    channelId: v.optional(v.id("channels")),
    conversationId: v.optional(v.id("conversations")),
    scheduledJobId: v.optional(v.id("_scheduled_functions")),
  })
    .index("by_channel", ["channelId"])
    .index("by_conversation", ["conversationId"])
    .index("by_user_channel", ["userId", "channelId"])
    .index("by_user_conversation", ["userId", "conversationId"]),

  // --- Notifications (mobile) ----------------------------------------------

  /** Persisted, per-recipient notification. Created by `notifyUsers` in
   * convex/notifications.ts, called from message-send/friend-request
   * mutations. Powers both the mobile app's Notifications tab and, via
   * convex/push.ts, real device push delivery. */
  notifications: defineTable({
    userId: v.id("users"),
    type: v.union(
      v.literal("dm_message"),
      v.literal("channel_mention"),
      v.literal("friend_request"),
      v.literal("friend_accept"),
      /** Someone is ringing a DM/group call you're in. */
      v.literal("call_ring"),
      /** Someone joined a call — a DM/group you're in, or a server voice
       * channel a friend of yours is now in. */
      v.literal("call_started"),
      /** Someone started screen sharing in a call/voice channel. */
      v.literal("stream_started"),
      /** Someone replied to one of your messages. */
      v.literal("reply")
    ),
    actorId: v.optional(v.id("users")),
    conversationId: v.optional(v.id("conversations")),
    channelId: v.optional(v.id("channels")),
    communityId: v.optional(v.id("communities")),
    messageId: v.optional(v.id("messages")),
    channelMessageId: v.optional(v.id("channelMessages")),
    requestId: v.optional(v.id("friendRequests")),
    title: v.string(),
    body: v.optional(v.string()),
    read: v.boolean(),
    createdAt: v.number(),
    /** Only set on `channel_mention` rows: true when the message actually
     * pinged this user (`<@id>`, `@everyone`, `@here`, a role), false for
     * ordinary traffic delivered because the server is on "all messages".
     * Absent on rows written before this field existed — those were titled
     * "X mentioned you in #y" when they were mentions, which the sidebar falls
     * back to reading. */
    isMention: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"])
    .index("by_user_read", ["userId", "read"])
    .index("by_user_created", ["userId", "createdAt"]),

  /**
   * A conversation or channel its owner has marked as a VIP — it is lifted
   * into the sidebar's Priority card, with its latest activity on show.
   *
   * Distinct from `conversationMembers.pinnedAt`, which only orders the DM
   * list: a priority item can also be a channel in a server, which has no
   * other place to be pinned, and the card is a separate surface from the list
   * it's lifted out of. Exactly one of `conversationId` / `channelId` is set.
   */
  priorityItems: defineTable({
    userId: v.id("users"),
    conversationId: v.optional(v.id("conversations")),
    channelId: v.optional(v.id("channels")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_conversation", ["userId", "conversationId"])
    .index("by_user_channel", ["userId", "channelId"]),

  /**
   * Account-wide notification switches. Absent means the defaults in
   * `convex/lib/notificationPolicy.ts` apply, so a user who has never opened
   * the settings behaves exactly as before.
   */
  notificationSettings: defineTable({
    userId: v.id("users"),
    /** Direct and group messages. */
    dmMessages: v.boolean(),
    /** Channel messages that don't mention you. Mentions are governed by the
     * per-community level below. */
    channelMessages: v.boolean(),
    friendRequests: v.boolean(),
    /** Someone rings you in a DM or group call. Optional so rows written
     * before this field existed keep validating — the policy supplies the
     * default (see convex/lib/notificationPolicy.ts). */
    incomingCalls: v.optional(v.boolean()),
    /** Someone joins a call you're in, or a server voice channel shared with
     * a friend. */
    callActivity: v.optional(v.boolean()),
    /** A friend starts streaming in a call. */
    streamActivity: v.optional(v.boolean()),
    /** Someone replies to one of your messages. */
    replies: v.optional(v.boolean()),
  }).index("by_user", ["userId"]),

  /** Per-server override of how much a user wants to hear from it. */
  communityNotificationSettings: defineTable({
    userId: v.id("users"),
    communityId: v.id("communities"),
    level: v.union(v.literal("all"), v.literal("mentions"), v.literal("none")),
  })
    .index("by_user", ["userId"])
    .index("by_user_community", ["userId", "communityId"]),

  /** One row per (user, device) Expo push token, so `push.sendExpoPush` can
   * fan a single notification out to every device a user is signed into. */
  devicePushTokens: defineTable({
    userId: v.id("users"),
    expoPushToken: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android")),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["expoPushToken"]),

  /**
   * The caller's own arrangement of their community list in the unified
   * sidebar — a personal order, Discord-style. One row per user holding the
   * full ordering; communities missing from it (newly joined) sort after the
   * ordered ones by join time, and ids for communities since left are pruned
   * on the next reorder rather than eagerly.
   */
  sidebarCommunityOrders: defineTable({
    userId: v.id("users"),
    orderedCommunityIds: v.array(v.id("communities")),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  /**
   * The pictures a person has recently worn as their avatar, banner or
   * nameplate — at most `RECENT_LIMIT` per kind per profile, newest first by
   * `lastUsedAt`.
   *
   * One row per picture, per profile: the account's (`communityId` absent) and
   * each server identity's keep separate histories, because a server profile is
   * a different face. The row holds everything needed to put the picture back
   * — the cropped file that is displayed and the untouched original it was cut
   * from, so a picture can be re-cropped later — and is also what owns the
   * files: nothing is deleted when a picture is replaced, only when its row
   * falls out of the list (see convex/profileImages.ts).
   *
   * `url` is the CDN address of an R2 object, or a Convex storage url for one
   * uploaded before the CDN was on; `storageId` is only set in the second case.
   */
  profileImages: defineTable({
    userId: v.id("users"),
    communityId: v.optional(v.id("communities")),
    kind: v.union(v.literal("avatar"), v.literal("banner"), v.literal("nameplate")),
    url: v.string(),
    storageId: v.optional(v.id("_storage")),
    originalUrl: v.optional(v.string()),
    originalStorageId: v.optional(v.id("_storage")),
    lastUsedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_scope", ["userId", "kind", "communityId"]),

  /** R2 asset metadata — one row per file in Cloudflare R2, so we can fetch by
   * path, track owner, hash, and handle canvas-editor layers + server profiles.
   * Migrated Convex `_storage` files live under `migrated/<storageId>`; new
   * uploads use structured paths:
   *  attachments/<channelOrUserId>/<name>.<ext>
   *  avatars/<userId>/<hash>.webp
   *  avatar-decorations/<userId>/<hash>.webp
   *  avatar-frames/<userId>/<hash>.webp
   *  icons/<communityId>/<hash>.webp
   *  banners/<communityOrUserId>/<hash>.webp
   *  nameplates/<userId>/<hash>.webp
   * Frames/decorations canvas layers and server-profile overrides store their
   * own rows with communityId/userId so we can list/replace per scope. */
  r2Assets: defineTable({
    key: v.string(), // full R2 key, e.g. avatars/<userId>/<hash>.webp
    kind: v.union(
      v.literal("attachments"),
      v.literal("avatars"),
      v.literal("avatar-decorations"),
      v.literal("avatar-frames"),
      v.literal("icons"),
      v.literal("banners"),
      v.literal("nameplates")
    ),
    ownerId: v.string(), // channelId / userId / communityId that owns the path
    communityId: v.optional(v.id("communities")), // for server-profile scoped assets
    userId: v.id("users"), // uploader
    fileName: v.string(),
    ext: v.string(),
    hash: v.string(),
    size: v.optional(v.number()),
    contentType: v.optional(v.string()),
    // For canvas-editor layers: which layer index / frame set it belongs to
    layerId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_owner", ["ownerId"])
    .index("by_user", ["userId"])
    .index("by_community", ["communityId"])
    .index("by_kind", ["kind"]),

  // --- Staff ----------------------------------------------------------------

  /**
   * Who may use the admin console, and as what.
   *
   * A row is the only thing that grants access: the staff email badge is a
   * label on a profile, not a permission. `roles` is what the console checks
   * (see convex/lib/staffPermissions.ts), and `finance` is a role of its own that
   * no other role includes — owners hold it only if they are given it.
   * Revoking sets `revokedAt` rather than deleting, so the audit log still has
   * someone to point at.
   */
  staffMembers: defineTable({
    userId: v.id("users"),
    roles: v.array(
      v.union(
        v.literal("owner"),
        v.literal("admin"),
        v.literal("moderator"),
        v.literal("support"),
        v.literal("finance")
      )
    ),
    grantedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  /** Every change a staff member makes in the console, and every look at
   * finance. Append-only: there is no mutation that edits or deletes a row. */
  staffAuditLog: defineTable({
    actorId: v.id("users"),
    /** `catalog.sku.update`, `staff.grant`, `finance.refund`… */
    action: v.string(),
    targetType: v.optional(v.string()),
    targetId: v.optional(v.string()),
    /** Small, human-readable detail — what changed, not whole documents. */
    summary: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_actor", ["actorId", "createdAt"])
    .index("by_target", ["targetType", "targetId"]),

  // --- Reports --------------------------------------------------------------

  /**
   * A user's report of a person, a message or a community.
   *
   * `evidence` is a snapshot taken when the report was made: what the message
   * said, who wrote it, where. Staff review what was reported, not whatever the
   * message has since been edited into or deleted as — and they never need to
   * open a private conversation to do it, because only what the reporter chose to
   * report is ever in front of them.
   */
  reports: defineTable({
    reporterId: v.id("users"),
    targetType: v.union(
      v.literal("user"),
      v.literal("message"),
      v.literal("channelMessage"),
      v.literal("community")
    ),
    /** The reported thing's id, as a string (it is one of several tables'). */
    targetId: v.string(),
    /** The person responsible, where there is one: a message's author, the user
     * reported, a community's owner. What reports are grouped by. */
    targetUserId: v.optional(v.id("users")),
    communityId: v.optional(v.id("communities")),
    category: v.union(
      v.literal("spam"),
      v.literal("harassment"),
      v.literal("hate"),
      v.literal("sexual"),
      v.literal("violence"),
      v.literal("self_harm"),
      v.literal("impersonation"),
      v.literal("scam"),
      v.literal("other")
    ),
    details: v.optional(v.string()),
    evidence: v.optional(
      v.object({
        text: v.optional(v.string()),
        authorName: v.optional(v.string()),
        authorUsername: v.optional(v.string()),
        attachments: v.optional(v.array(v.object({ fileName: v.string(), url: v.optional(v.string()) }))),
        context: v.optional(v.string()),
      })
    ),
    status: v.union(
      v.literal("open"),
      v.literal("reviewing"),
      v.literal("resolved"),
      v.literal("dismissed")
    ),
    assignedTo: v.optional(v.id("users")),
    resolution: v.optional(v.string()),
    resolvedBy: v.optional(v.id("users")),
    resolvedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status", "createdAt"])
    .index("by_target", ["targetType", "targetId"])
    .index("by_target_user", ["targetUserId"])
    .index("by_reporter", ["reporterId", "createdAt"]),

  /** Staff-only notes on a report. */
  reportNotes: defineTable({
    reportId: v.id("reports"),
    authorId: v.id("users"),
    body: v.string(),
    createdAt: v.number(),
  }).index("by_report", ["reportId", "createdAt"]),

  // --- Support -------------------------------------------------------------

  supportTickets: defineTable({
    userId: v.id("users"),
    subject: v.string(),
    category: v.union(v.literal("account"), v.literal("billing"), v.literal("community"), v.literal("technical"), v.literal("other")),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("urgent")),
    status: v.union(v.literal("open"), v.literal("in_progress"), v.literal("waiting_on_user"), v.literal("resolved"), v.literal("closed")),
    assignedTo: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_status", ["status", "updatedAt"]).index("by_user", ["userId", "updatedAt"]),

  supportTicketMessages: defineTable({
    ticketId: v.id("supportTickets"),
    authorId: v.id("users"),
    body: v.string(),
    internal: v.boolean(),
    createdAt: v.number(),
  }).index("by_ticket", ["ticketId", "createdAt"]),

  /** Immutable record of platform-wide account moderation. */
  platformModerationLog: defineTable({
    userId: v.id("users"),
    actorId: v.id("users"),
    action: v.union(v.literal("suspend"), v.literal("unsuspend")),
    reason: v.optional(v.string()),
    until: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user", ["userId", "createdAt"]),

  /** Staff-visible state for a community, without deleting its content. */
  communityModeration: defineTable({
    communityId: v.id("communities"),
    status: v.union(v.literal("active"), v.literal("restricted"), v.literal("archived")),
    reason: v.optional(v.string()),
    actorId: v.id("users"),
    updatedAt: v.number(),
  }).index("by_community", ["communityId"]),

  // --- Marketplace ----------------------------------------------------------

  skuCategories: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    position: v.number(),
    active: v.boolean(),
  }).index("by_slug", ["slug"]),

  /**
   * Something that can be sold. The catalogue lives here, not in Stripe: Stripe
   * is told about a SKU when it is published (`stripeProductId`/`stripePriceId`)
   * and is never asked what a SKU costs. Prices are read from this row on the
   * server at the moment of purchase, so nothing the client sends can set one.
   *
   * What a purchase gives is `grants`, a snapshot-able list: a cosmetic grants
   * its artwork, a bundle several things, a plan some perks, a community item
   * something for one server.
   */
  skus: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    categoryId: v.id("skuCategories"),
    type: v.union(
      v.literal("cosmetic"),
      v.literal("subscription"),
      v.literal("community"),
      v.literal("bundle")
    ),
    /** Cents, in `currency`'s smallest unit. 0 is free. */
    priceCents: v.number(),
    currency: v.string(),
    /** Subscriptions only. */
    interval: v.optional(v.union(v.literal("month"), v.literal("year"))),
    grants: v.array(
      v.object({
        kind: v.union(
          v.literal("avatarDecoration"),
          v.literal("profileSticker"),
          v.literal("profileEffect"),
          v.literal("nameplate"),
          v.literal("communityTheme"),
          v.literal("communityBoost"),
          v.literal("loungeScene"),
          v.literal("themePack"),
          v.literal("plan")
        ),
        /** What it is, by kind: layers as JSON for artwork made of layers, an
         * address for a single picture, colours as JSON for a theme. */
        payload: v.optional(v.string()),
        label: v.optional(v.string()),
      })
    ),
    /** The picture shown in the store. A CDN address. */
    imageUrl: v.optional(v.string()),
    status: v.union(v.literal("draft"), v.literal("active"), v.literal("archived")),
    featured: v.boolean(),
    position: v.number(),
    stripeProductId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    /** User-created listings are moderated before becoming active. */
    creatorId: v.optional(v.id("users")),
    creatorShareBps: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_category", ["categoryId", "position"])
    .index("by_status", ["status", "position"]),

  /** A creator's submission before staff approves it into `skus`. */
  marketplaceSubmissions: defineTable({
    creatorId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    type: v.union(v.literal("cosmetic"), v.literal("community"), v.literal("bundle")),
    grants: v.array(v.object({
      kind: v.string(),
      payload: v.optional(v.string()),
      label: v.optional(v.string()),
    })),
    requestedPriceCents: v.number(),
    currency: v.string(),
    /** The picture for the store: set for kinds whose grant has no single picture
     * of its own (a theme pack, a pack of several things). */
    previewUrl: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    reviewNote: v.optional(v.string()),
    skuId: v.optional(v.id("skus")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_creator", ["creatorId", "createdAt"])
    .index("by_status", ["status", "createdAt"]),

  /** Stripe Connect identity for creators who have completed onboarding. */
  creatorAccounts: defineTable({
    userId: v.id("users"),
    stripeAccountId: v.string(),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    /** Whether the creator has finished giving Stripe their details. */
    detailsSubmitted: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]).index("by_stripe_account", ["stripeAccountId"]),

  /** Immutable creator-share ledger. Transfers are created only after payment
   * confirmation, and this row makes retries idempotent. */
  creatorEarnings: defineTable({
    creatorId: v.id("users"),
    orderId: v.id("orders"),
    skuId: v.id("skus"),
    grossCents: v.number(),
    platformFeeCents: v.number(),
    creatorCents: v.number(),
    currency: v.string(),
    status: v.union(v.literal("pending"), v.literal("transferred"), v.literal("held"), v.literal("refunded")),
    stripeTransferId: v.optional(v.string()),
    stripeReversalId: v.optional(v.string()),
    /** Why a payout is waiting or failed, for whoever has to look at it. */
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_order", ["orderId"])
    .index("by_creator", ["creatorId", "createdAt"])
    .index("by_status", ["status", "createdAt"]),

  /** A Stripe customer for a user. One each. */
  stripeCustomers: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  /**
   * One attempt to buy a SKU. `amountCents` and `grants` are copied from the SKU
   * at the moment of purchase: what was charged and what was promised stay true
   * if the SKU is later repriced or changed.
   */
  orders: defineTable({
    userId: v.id("users"),
    skuId: v.id("skus"),
    skuName: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("failed"),
      v.literal("canceled"),
      v.literal("refunded")
    ),
    amountCents: v.number(),
    discountCents: v.optional(v.number()),
    currency: v.string(),
    /** For a community item: which community it was bought for. */
    communityId: v.optional(v.id("communities")),
    grants: v.array(
      v.object({
        kind: v.string(),
        payload: v.optional(v.string()),
        label: v.optional(v.string()),
      })
    ),
    stripePaymentIntentId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
    refundedAt: v.optional(v.number()),
    refundedCents: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_status", ["status", "createdAt"])
    .index("by_payment_intent", ["stripePaymentIntentId"])
    .index("by_subscription", ["stripeSubscriptionId"])
    .index("by_sku", ["skuId", "createdAt"])
    .index("by_created", ["createdAt"]),

  /** What a user owns. A purchase writes these; so does a staff comp. */
  entitlements: defineTable({
    userId: v.id("users"),
    skuId: v.id("skus"),
    kind: v.string(),
    payload: v.optional(v.string()),
    label: v.optional(v.string()),
    communityId: v.optional(v.id("communities")),
    source: v.union(v.literal("purchase"), v.literal("subscription"), v.literal("staff")),
    orderId: v.optional(v.id("orders")),
    /** A subscription's entitlements stop at the end of what has been paid for. */
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_sku", ["userId", "skuId"])
    .index("by_order", ["orderId"])
    .index("by_community", ["communityId"]),

  /** Stripe webhook events already handled, so a retried delivery is a no-op. */
  stripeEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    handledAt: v.number(),
  }).index("by_event", ["eventId"]),
});
