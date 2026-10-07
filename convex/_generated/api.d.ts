/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ama from "../ama.js";
import type * as badges from "../badges.js";
import type * as cache from "../cache.js";
import type * as callTokens from "../callTokens.js";
import type * as calls from "../calls.js";
import type * as catalog from "../catalog.js";
import type * as cdn from "../cdn.js";
import type * as cdnInternal from "../cdnInternal.js";
import type * as cdnMigration from "../cdnMigration.js";
import type * as channelCalls from "../channelCalls.js";
import type * as channelCategories from "../channelCategories.js";
import type * as channelMessages from "../channelMessages.js";
import type * as channels from "../channels.js";
import type * as clans from "../clans.js";
import type * as communities from "../communities.js";
import type * as communityEmojis from "../communityEmojis.js";
import type * as communityTemplates from "../communityTemplates.js";
import type * as communityWidgets from "../communityWidgets.js";
import type * as connectedAccounts from "../connectedAccounts.js";
import type * as conversations from "../conversations.js";
import type * as creatorCommunities from "../creatorCommunities.js";
import type * as creators from "../creators.js";
import type * as creatorsDb from "../creatorsDb.js";
import type * as crons from "../crons.js";
import type * as events from "../events.js";
import type * as extensions from "../extensions.js";
import type * as finance from "../finance.js";
import type * as forums from "../forums.js";
import type * as friends from "../friends.js";
import type * as gameServers from "../gameServers.js";
import type * as http from "../http.js";
import type * as lib_activities from "../lib/activities.js";
import type * as lib_birthday from "../lib/birthday.js";
import type * as lib_callReconciliation from "../lib/callReconciliation.js";
import type * as lib_communityKinds from "../lib/communityKinds.js";
import type * as lib_communitySetup from "../lib/communitySetup.js";
import type * as lib_cosmeticLayers from "../lib/cosmeticLayers.js";
import type * as lib_creationSpecs from "../lib/creationSpecs.js";
import type * as lib_entitlements from "../lib/entitlements.js";
import type * as lib_extensionManifest from "../lib/extensionManifest.js";
import type * as lib_gameHistory from "../lib/gameHistory.js";
import type * as lib_liveKitAdmin from "../lib/liveKitAdmin.js";
import type * as lib_liveKitWebhook from "../lib/liveKitWebhook.js";
import type * as lib_loungeStickers from "../lib/loungeStickers.js";
import type * as lib_mentions from "../lib/mentions.js";
import type * as lib_moderation from "../lib/moderation.js";
import type * as lib_modrinth from "../lib/modrinth.js";
import type * as lib_notificationPolicy from "../lib/notificationPolicy.js";
import type * as lib_panelClient from "../lib/panelClient.js";
import type * as lib_platforms from "../lib/platforms.js";
import type * as lib_profileCosmetics from "../lib/profileCosmetics.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_richEmbeds from "../lib/richEmbeds.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_serverProfile from "../lib/serverProfile.js";
import type * as lib_staff from "../lib/staff.js";
import type * as lib_staffPermissions from "../lib/staffPermissions.js";
import type * as lib_surfaces from "../lib/surfaces.js";
import type * as lib_uploadTicket from "../lib/uploadTicket.js";
import type * as linkPreviews from "../linkPreviews.js";
import type * as lounge from "../lounge.js";
import type * as maintenance from "../maintenance.js";
import type * as marketplace from "../marketplace.js";
import type * as messages from "../messages.js";
import type * as notificationSettings from "../notificationSettings.js";
import type * as notifications from "../notifications.js";
import type * as operations from "../operations.js";
import type * as payments from "../payments.js";
import type * as permissions from "../permissions.js";
import type * as presence from "../presence.js";
import type * as priority from "../priority.js";
import type * as profileImages from "../profileImages.js";
import type * as profileWidgets from "../profileWidgets.js";
import type * as push from "../push.js";
import type * as redisCloud from "../redisCloud.js";
import type * as reports from "../reports.js";
import type * as roles from "../roles.js";
import type * as search from "../search.js";
import type * as serverProfiles from "../serverProfiles.js";
import type * as sidebar from "../sidebar.js";
import type * as soundboard from "../soundboard.js";
import type * as staff from "../staff.js";
import type * as store from "../store.js";
import type * as support from "../support.js";
import type * as systemAccount from "../systemAccount.js";
import type * as systemMessages from "../systemMessages.js";
import type * as typing from "../typing.js";
import type * as uploadLimits from "../uploadLimits.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ama: typeof ama;
  badges: typeof badges;
  cache: typeof cache;
  callTokens: typeof callTokens;
  calls: typeof calls;
  catalog: typeof catalog;
  cdn: typeof cdn;
  cdnInternal: typeof cdnInternal;
  cdnMigration: typeof cdnMigration;
  channelCalls: typeof channelCalls;
  channelCategories: typeof channelCategories;
  channelMessages: typeof channelMessages;
  channels: typeof channels;
  clans: typeof clans;
  communities: typeof communities;
  communityEmojis: typeof communityEmojis;
  communityTemplates: typeof communityTemplates;
  communityWidgets: typeof communityWidgets;
  connectedAccounts: typeof connectedAccounts;
  conversations: typeof conversations;
  creatorCommunities: typeof creatorCommunities;
  creators: typeof creators;
  creatorsDb: typeof creatorsDb;
  crons: typeof crons;
  events: typeof events;
  extensions: typeof extensions;
  finance: typeof finance;
  forums: typeof forums;
  friends: typeof friends;
  gameServers: typeof gameServers;
  http: typeof http;
  "lib/activities": typeof lib_activities;
  "lib/birthday": typeof lib_birthday;
  "lib/callReconciliation": typeof lib_callReconciliation;
  "lib/communityKinds": typeof lib_communityKinds;
  "lib/communitySetup": typeof lib_communitySetup;
  "lib/cosmeticLayers": typeof lib_cosmeticLayers;
  "lib/creationSpecs": typeof lib_creationSpecs;
  "lib/entitlements": typeof lib_entitlements;
  "lib/extensionManifest": typeof lib_extensionManifest;
  "lib/gameHistory": typeof lib_gameHistory;
  "lib/liveKitAdmin": typeof lib_liveKitAdmin;
  "lib/liveKitWebhook": typeof lib_liveKitWebhook;
  "lib/loungeStickers": typeof lib_loungeStickers;
  "lib/mentions": typeof lib_mentions;
  "lib/moderation": typeof lib_moderation;
  "lib/modrinth": typeof lib_modrinth;
  "lib/notificationPolicy": typeof lib_notificationPolicy;
  "lib/panelClient": typeof lib_panelClient;
  "lib/platforms": typeof lib_platforms;
  "lib/profileCosmetics": typeof lib_profileCosmetics;
  "lib/r2": typeof lib_r2;
  "lib/richEmbeds": typeof lib_richEmbeds;
  "lib/secrets": typeof lib_secrets;
  "lib/serverProfile": typeof lib_serverProfile;
  "lib/staff": typeof lib_staff;
  "lib/staffPermissions": typeof lib_staffPermissions;
  "lib/surfaces": typeof lib_surfaces;
  "lib/uploadTicket": typeof lib_uploadTicket;
  linkPreviews: typeof linkPreviews;
  lounge: typeof lounge;
  maintenance: typeof maintenance;
  marketplace: typeof marketplace;
  messages: typeof messages;
  notificationSettings: typeof notificationSettings;
  notifications: typeof notifications;
  operations: typeof operations;
  payments: typeof payments;
  permissions: typeof permissions;
  presence: typeof presence;
  priority: typeof priority;
  profileImages: typeof profileImages;
  profileWidgets: typeof profileWidgets;
  push: typeof push;
  redisCloud: typeof redisCloud;
  reports: typeof reports;
  roles: typeof roles;
  search: typeof search;
  serverProfiles: typeof serverProfiles;
  sidebar: typeof sidebar;
  soundboard: typeof soundboard;
  staff: typeof staff;
  store: typeof store;
  support: typeof support;
  systemAccount: typeof systemAccount;
  systemMessages: typeof systemMessages;
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
