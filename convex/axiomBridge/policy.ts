/**
 * Axiom Bridge policy for Crystal (poliberry/crystal-desktop-v2, poliberry/crystal-mobile).
 * GENERATED from poliberry/axiom convex/lib/catalog.ts — do not edit here. Change the
 * catalog in the Axiom repo, then run `npm run bridge:install -- crystal <this convex dir>`.
 *
 * Tables not listed are invisible to Axiom. Fields not listed are dropped.
 * Sealed fields never leave this deployment.
 */
import type { BridgePolicy } from "./bridge";

export const policy: BridgePolicy = {
  version: "crystal-1",
  tables: {
    "users": {
      "fields": [
        "username",
        "name",
        "bio",
        "isBot",
        "isGuest",
        "guestExpiresAt",
        "guestExpiredAt",
        "platformSuspendedUntil",
        "platformSuspensionReason",
        "platformBannedAt",
        "platformBanReason",
        "platformLimitedUntil",
        "platformLimitReason",
        "deletedAt",
        "imageUrl"
      ],
      "sealed": {
        "dob": "pii"
      },
      "writable": [
        "username",
        "name",
        "bio",
        "platformSuspendedUntil",
        "platformSuspensionReason",
        "platformBannedAt",
        "platformBanReason",
        "platformLimitedUntil",
        "platformLimitReason"
      ]
    },
    "communities": {
      "fields": [
        "name",
        "ownerId",
        "memberCount",
        "kind",
        "inviteOnly",
        "requireTwoFactor",
        "inviteCode",
        "createdAt"
      ],
      "writable": [
        "name",
        "inviteOnly",
        "requireTwoFactor"
      ]
    },
    "channels": {
      "fields": [
        "name",
        "communityId",
        "type",
        "topic",
        "slowmodeSeconds",
        "createdAt"
      ],
      "writable": [
        "name",
        "topic",
        "slowmodeSeconds"
      ]
    },
    "conversations": {
      "fields": [
        "type",
        "createdBy",
        "createdAt"
      ],
      "sealed": {
        "name": "pii"
      }
    },
    "messages": {
      "fields": [
        "conversationId",
        "authorId",
        "editedAt",
        "pinnedAt"
      ],
      "sealed": {
        "text": "e2ee",
        "enc": "e2ee"
      }
    },
    "channelMessages": {
      "fields": [
        "channelId",
        "authorId",
        "editedAt"
      ],
      "sealed": {
        "text": "e2ee",
        "enc": "e2ee"
      }
    },
    "reports": {
      "fields": [
        "category",
        "targetType",
        "targetId",
        "reporterId",
        "status",
        "assignedTo",
        "details",
        "resolution",
        "createdAt"
      ],
      "writable": [
        "status",
        "assignedTo",
        "resolution"
      ]
    },
    "supportTickets": {
      "fields": [
        "subject",
        "userId",
        "category",
        "priority",
        "status",
        "closureNote",
        "createdAt"
      ],
      "writable": [
        "priority",
        "status",
        "closureNote"
      ]
    },
    "skus": {
      "fields": [
        "name",
        "slug",
        "type",
        "priceCents",
        "status",
        "featured",
        "unlisted",
        "description"
      ],
      "writable": [
        "name",
        "priceCents",
        "status",
        "featured",
        "unlisted",
        "description"
      ]
    },
    "orders": {
      "fields": [
        "skuName",
        "userId",
        "status",
        "amountCents",
        "currency",
        "createdAt"
      ],
      "sealed": {
        "stripePaymentIntentId": "secret"
      }
    },
    "entitlements": {
      "fields": [
        "label",
        "userId",
        "kind",
        "source",
        "expiresAt",
        "revokedAt"
      ],
      "writable": [
        "expiresAt",
        "revokedAt"
      ]
    },
    "bots": {
      "fields": [
        "name",
        "ownerId",
        "visibility",
        "endpointUrl",
        "suspendedAt",
        "suspendedReason"
      ],
      "sealed": {
        "tokenHash": "secret",
        "signingSecret": "secret"
      },
      "writable": [
        "suspendedAt",
        "suspendedReason"
      ]
    },
    "connectedAccounts": {
      "fields": [
        "provider",
        "userId",
        "handle",
        "lastError"
      ],
      "sealed": {
        "accessCipher": "secret",
        "refreshCipher": "secret"
      },
      "delete": true
    },
    "userIps": {
      "fields": [
        "userId",
        "ipHash",
        "firstSeenAt",
        "lastSeenAt"
      ],
      "sealed": {
        "ipCipher": "secret"
      }
    },
    "e2eeKeys": {
      "sealTable": true
    },
    "userTwoFactor": {
      "sealTable": true,
      "visible": [
        "userId"
      ]
    },
    "passkeys": {
      "sealTable": true,
      "visible": [
        "userId"
      ]
    },
    "staffMembers": {
      "fields": [
        "userId",
        "roles",
        "revokedAt",
        "createdAt"
      ],
      "writable": [
        "roles",
        "revokedAt"
      ]
    },
    "staffAuditLog": {
      "fields": [
        "action",
        "actorId",
        "targetType",
        "targetId",
        "summary",
        "createdAt"
      ]
    },
    "platformSettings": {
      "fields": [
        "key",
        "requireStaffTwoFactor",
        "updatedAt"
      ],
      "writable": [
        "requireStaffTwoFactor"
      ]
    }
  },
};
