/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as callTokens from "../callTokens.js";
import type * as calls from "../calls.js";
import type * as channelCalls from "../channelCalls.js";
import type * as channelCategories from "../channelCategories.js";
import type * as channelMessages from "../channelMessages.js";
import type * as channels from "../channels.js";
import type * as communities from "../communities.js";
import type * as communityEmojis from "../communityEmojis.js";
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as friends from "../friends.js";
import type * as http from "../http.js";
import type * as lib_activities from "../lib/activities.js";
import type * as lib_callReconciliation from "../lib/callReconciliation.js";
import type * as lib_gameHistory from "../lib/gameHistory.js";
import type * as lib_liveKitAdmin from "../lib/liveKitAdmin.js";
import type * as lib_liveKitWebhook from "../lib/liveKitWebhook.js";
import type * as lib_mentions from "../lib/mentions.js";
import type * as lib_notificationPolicy from "../lib/notificationPolicy.js";
import type * as lib_richEmbeds from "../lib/richEmbeds.js";
import type * as linkPreviews from "../linkPreviews.js";
import type * as messages from "../messages.js";
import type * as notificationSettings from "../notificationSettings.js";
import type * as notifications from "../notifications.js";
import type * as permissions from "../permissions.js";
import type * as presence from "../presence.js";
import type * as push from "../push.js";
import type * as roles from "../roles.js";
import type * as serverProfiles from "../serverProfiles.js";
import type * as soundboard from "../soundboard.js";
import type * as typing from "../typing.js";
import type * as uploadLimits from "../uploadLimits.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  callTokens: typeof callTokens;
  calls: typeof calls;
  channelCalls: typeof channelCalls;
  channelCategories: typeof channelCategories;
  channelMessages: typeof channelMessages;
  channels: typeof channels;
  communities: typeof communities;
  communityEmojis: typeof communityEmojis;
  conversations: typeof conversations;
  crons: typeof crons;
  friends: typeof friends;
  http: typeof http;
  "lib/activities": typeof lib_activities;
  "lib/callReconciliation": typeof lib_callReconciliation;
  "lib/gameHistory": typeof lib_gameHistory;
  "lib/liveKitAdmin": typeof lib_liveKitAdmin;
  "lib/liveKitWebhook": typeof lib_liveKitWebhook;
  "lib/mentions": typeof lib_mentions;
  "lib/notificationPolicy": typeof lib_notificationPolicy;
  "lib/richEmbeds": typeof lib_richEmbeds;
  linkPreviews: typeof linkPreviews;
  messages: typeof messages;
  notificationSettings: typeof notificationSettings;
  notifications: typeof notifications;
  permissions: typeof permissions;
  presence: typeof presence;
  push: typeof push;
  roles: typeof roles;
  serverProfiles: typeof serverProfiles;
  soundboard: typeof soundboard;
  typing: typeof typing;
  uploadLimits: typeof uploadLimits;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
