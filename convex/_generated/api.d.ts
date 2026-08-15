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
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as friends from "../friends.js";
import type * as http from "../http.js";
import type * as lib_callReconciliation from "../lib/callReconciliation.js";
import type * as lib_liveKitAdmin from "../lib/liveKitAdmin.js";
import type * as lib_liveKitWebhook from "../lib/liveKitWebhook.js";
import type * as linkPreviews from "../linkPreviews.js";
import type * as messages from "../messages.js";
import type * as notifications from "../notifications.js";
import type * as permissions from "../permissions.js";
import type * as presence from "../presence.js";
import type * as roles from "../roles.js";
import type * as serverProfiles from "../serverProfiles.js";
import type * as typing from "../typing.js";
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
  conversations: typeof conversations;
  crons: typeof crons;
  friends: typeof friends;
  http: typeof http;
  "lib/callReconciliation": typeof lib_callReconciliation;
  "lib/liveKitAdmin": typeof lib_liveKitAdmin;
  "lib/liveKitWebhook": typeof lib_liveKitWebhook;
  linkPreviews: typeof linkPreviews;
  messages: typeof messages;
  notifications: typeof notifications;
  permissions: typeof permissions;
  presence: typeof presence;
  roles: typeof roles;
  serverProfiles: typeof serverProfiles;
  typing: typeof typing;
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
