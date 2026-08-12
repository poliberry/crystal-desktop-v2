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
import type * as conversations from "../conversations.js";
import type * as crons from "../crons.js";
import type * as friends from "../friends.js";
import type * as linkPreviews from "../linkPreviews.js";
import type * as messages from "../messages.js";
import type * as presence from "../presence.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  callTokens: typeof callTokens;
  calls: typeof calls;
  conversations: typeof conversations;
  crons: typeof crons;
  friends: typeof friends;
  linkPreviews: typeof linkPreviews;
  messages: typeof messages;
  presence: typeof presence;
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
