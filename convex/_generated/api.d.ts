/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountDeletion from "../accountDeletion.js";
import type * as ama from "../ama.js";
import type * as auth from "../auth.js";
import type * as authFlow from "../authFlow.js";
import type * as authInternal from "../authInternal.js";
import type * as badges from "../badges.js";
import type * as blocks from "../blocks.js";
import type * as botDelivery from "../botDelivery.js";
import type * as botEvents from "../botEvents.js";
import type * as botHttp from "../botHttp.js";
import type * as botOps from "../botOps.js";
import type * as botVoice from "../botVoice.js";
import type * as bots from "../bots.js";
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
import type * as clerkMigration from "../clerkMigration.js";
import type * as communities from "../communities.js";
import type * as communityEmojis from "../communityEmojis.js";
import type * as communityTemplates from "../communityTemplates.js";
import type * as communityWidgets from "../communityWidgets.js";
import type * as connectedAccounts from "../connectedAccounts.js";
import type * as conversations from "../conversations.js";
import type * as cosmeticCollection from "../cosmeticCollection.js";
import type * as creationFiles from "../creationFiles.js";
import type * as creatorCommunities from "../creatorCommunities.js";
import type * as creators from "../creators.js";
import type * as creatorsDb from "../creatorsDb.js";
import type * as crons from "../crons.js";
import type * as dataExport from "../dataExport.js";
import type * as discordInspiredPublish from "../discordInspiredPublish.js";
import type * as e2eeKeys from "../e2eeKeys.js";
import type * as e2eeMigrate from "../e2eeMigrate.js";
import type * as e2eeOnboard from "../e2eeOnboard.js";
import type * as e2eeOnboardActions from "../e2eeOnboardActions.js";
import type * as effectLibraryPublish from "../effectLibraryPublish.js";
import type * as events from "../events.js";
import type * as extensions from "../extensions.js";
import type * as files from "../files.js";
import type * as finance from "../finance.js";
import type * as forums from "../forums.js";
import type * as friends from "../friends.js";
import type * as gameServers from "../gameServers.js";
import type * as guests from "../guests.js";
import type * as http from "../http.js";
import type * as klipy from "../klipy.js";
import type * as lib_abilities from "../lib/abilities.js";
import type * as lib_accountWipe from "../lib/accountWipe.js";
import type * as lib_accounts from "../lib/accounts.js";
import type * as lib_activities from "../lib/activities.js";
import type * as lib_authPolicy from "../lib/authPolicy.js";
import type * as lib_birthday from "../lib/birthday.js";
import type * as lib_blocking from "../lib/blocking.js";
import type * as lib_botAccess from "../lib/botAccess.js";
import type * as lib_botAuth from "../lib/botAuth.js";
import type * as lib_botEvents from "../lib/botEvents.js";
import type * as lib_botProfile from "../lib/botProfile.js";
import type * as lib_botRoutes from "../lib/botRoutes.js";
import type * as lib_callReconciliation from "../lib/callReconciliation.js";
import type * as lib_communityKinds from "../lib/communityKinds.js";
import type * as lib_communitySetup from "../lib/communitySetup.js";
import type * as lib_companion from "../lib/companion.js";
import type * as lib_components from "../lib/components.js";
import type * as lib_cosmeticCollection from "../lib/cosmeticCollection.js";
import type * as lib_cosmeticLayers from "../lib/cosmeticLayers.js";
import type * as lib_creationRules from "../lib/creationRules.js";
import type * as lib_creationSpecs from "../lib/creationSpecs.js";
import type * as lib_e2eeCrypto from "../lib/e2eeCrypto.js";
import type * as lib_e2eeEnforce from "../lib/e2eeEnforce.js";
import type * as lib_e2eeEscrow from "../lib/e2eeEscrow.js";
import type * as lib_e2eePure from "../lib/e2eePure.js";
import type * as lib_effectLibrary from "../lib/effectLibrary.js";
import type * as lib_embeds from "../lib/embeds.js";
import type * as lib_entitlements from "../lib/entitlements.js";
import type * as lib_extensionManifest from "../lib/extensionManifest.js";
import type * as lib_files from "../lib/files.js";
import type * as lib_gameHistory from "../lib/gameHistory.js";
import type * as lib_geode from "../lib/geode.js";
import type * as lib_guests from "../lib/guests.js";
import type * as lib_identity from "../lib/identity.js";
import type * as lib_ip from "../lib/ip.js";
import type * as lib_ipBans from "../lib/ipBans.js";
import type * as lib_klipy from "../lib/klipy.js";
import type * as lib_listingUpdate from "../lib/listingUpdate.js";
import type * as lib_liveKitAdmin from "../lib/liveKitAdmin.js";
import type * as lib_liveKitWebhook from "../lib/liveKitWebhook.js";
import type * as lib_loungeStickers from "../lib/loungeStickers.js";
import type * as lib_mail from "../lib/mail.js";
import type * as lib_mediaType from "../lib/mediaType.js";
import type * as lib_mentions from "../lib/mentions.js";
import type * as lib_messageCacheKeys from "../lib/messageCacheKeys.js";
import type * as lib_moderation from "../lib/moderation.js";
import type * as lib_modrinth from "../lib/modrinth.js";
import type * as lib_motion from "../lib/motion.js";
import type * as lib_motionAddress from "../lib/motionAddress.js";
import type * as lib_mutuals from "../lib/mutuals.js";
import type * as lib_notificationPolicy from "../lib/notificationPolicy.js";
import type * as lib_oauthLinks from "../lib/oauthLinks.js";
import type * as lib_panelClient from "../lib/panelClient.js";
import type * as lib_passwordHash from "../lib/passwordHash.js";
import type * as lib_platforms from "../lib/platforms.js";
import type * as lib_profileCosmetics from "../lib/profileCosmetics.js";
import type * as lib_r2 from "../lib/r2.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_richEmbeds from "../lib/richEmbeds.js";
import type * as lib_secondFactor from "../lib/secondFactor.js";
import type * as lib_secrets from "../lib/secrets.js";
import type * as lib_serverProfile from "../lib/serverProfile.js";
import type * as lib_sessions from "../lib/sessions.js";
import type * as lib_signInStep from "../lib/signInStep.js";
import type * as lib_skuDelete from "../lib/skuDelete.js";
import type * as lib_staff from "../lib/staff.js";
import type * as lib_staffPermissions from "../lib/staffPermissions.js";
import type * as lib_stepUp from "../lib/stepUp.js";
import type * as lib_studioDocs from "../lib/studioDocs.js";
import type * as lib_studioDocsStore from "../lib/studioDocsStore.js";
import type * as lib_surfaces from "../lib/surfaces.js";
import type * as lib_twoFactor from "../lib/twoFactor.js";
import type * as lib_uploadTicket from "../lib/uploadTicket.js";
import type * as lib_webauthn from "../lib/webauthn.js";
import type * as linkPreviews from "../linkPreviews.js";
import type * as lounge from "../lounge.js";
import type * as maintenance from "../maintenance.js";
import type * as marketingDemo from "../marketingDemo.js";
import type * as marketplace from "../marketplace.js";
import type * as messages from "../messages.js";
import type * as motion from "../motion.js";
import type * as notificationSettings from "../notificationSettings.js";
import type * as notifications from "../notifications.js";
import type * as operations from "../operations.js";
import type * as passkeyData from "../passkeyData.js";
import type * as passkeys from "../passkeys.js";
import type * as payments from "../payments.js";
import type * as permissions from "../permissions.js";
import type * as platformSettings from "../platformSettings.js";
import type * as presence from "../presence.js";
import type * as priority from "../priority.js";
import type * as profileImages from "../profileImages.js";
import type * as profileWidgets from "../profileWidgets.js";
import type * as publicStats from "../publicStats.js";
import type * as push from "../push.js";
import type * as redisCloud from "../redisCloud.js";
import type * as reports from "../reports.js";
import type * as roles from "../roles.js";
import type * as savedMessages from "../savedMessages.js";
import type * as search from "../search.js";
import type * as serverProfiles from "../serverProfiles.js";
import type * as sidebar from "../sidebar.js";
import type * as soundboard from "../soundboard.js";
import type * as staff from "../staff.js";
import type * as store from "../store.js";
import type * as studioDocs from "../studioDocs.js";
import type * as support from "../support.js";
import type * as systemAccount from "../systemAccount.js";
import type * as systemMessages from "../systemMessages.js";
import type * as twoFactor from "../twoFactor.js";
import type * as typing from "../typing.js";
import type * as uploadLimits from "../uploadLimits.js";
import type * as users from "../users.js";
import type * as webPush from "../webPush.js";
import type * as webPushNode from "../webPushNode.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountDeletion: typeof accountDeletion;
  ama: typeof ama;
  auth: typeof auth;
  authFlow: typeof authFlow;
  authInternal: typeof authInternal;
  badges: typeof badges;
  blocks: typeof blocks;
  botDelivery: typeof botDelivery;
  botEvents: typeof botEvents;
  botHttp: typeof botHttp;
  botOps: typeof botOps;
  botVoice: typeof botVoice;
  bots: typeof bots;
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
  clerkMigration: typeof clerkMigration;
  communities: typeof communities;
  communityEmojis: typeof communityEmojis;
  communityTemplates: typeof communityTemplates;
  communityWidgets: typeof communityWidgets;
  connectedAccounts: typeof connectedAccounts;
  conversations: typeof conversations;
  cosmeticCollection: typeof cosmeticCollection;
  creationFiles: typeof creationFiles;
  creatorCommunities: typeof creatorCommunities;
  creators: typeof creators;
  creatorsDb: typeof creatorsDb;
  crons: typeof crons;
  dataExport: typeof dataExport;
  discordInspiredPublish: typeof discordInspiredPublish;
  e2eeKeys: typeof e2eeKeys;
  e2eeMigrate: typeof e2eeMigrate;
  e2eeOnboard: typeof e2eeOnboard;
  e2eeOnboardActions: typeof e2eeOnboardActions;
  effectLibraryPublish: typeof effectLibraryPublish;
  events: typeof events;
  extensions: typeof extensions;
  files: typeof files;
  finance: typeof finance;
  forums: typeof forums;
  friends: typeof friends;
  gameServers: typeof gameServers;
  guests: typeof guests;
  http: typeof http;
  klipy: typeof klipy;
  "lib/abilities": typeof lib_abilities;
  "lib/accountWipe": typeof lib_accountWipe;
  "lib/accounts": typeof lib_accounts;
  "lib/activities": typeof lib_activities;
  "lib/authPolicy": typeof lib_authPolicy;
  "lib/birthday": typeof lib_birthday;
  "lib/blocking": typeof lib_blocking;
  "lib/botAccess": typeof lib_botAccess;
  "lib/botAuth": typeof lib_botAuth;
  "lib/botEvents": typeof lib_botEvents;
  "lib/botProfile": typeof lib_botProfile;
  "lib/botRoutes": typeof lib_botRoutes;
  "lib/callReconciliation": typeof lib_callReconciliation;
  "lib/communityKinds": typeof lib_communityKinds;
  "lib/communitySetup": typeof lib_communitySetup;
  "lib/companion": typeof lib_companion;
  "lib/components": typeof lib_components;
  "lib/cosmeticCollection": typeof lib_cosmeticCollection;
  "lib/cosmeticLayers": typeof lib_cosmeticLayers;
  "lib/creationRules": typeof lib_creationRules;
  "lib/creationSpecs": typeof lib_creationSpecs;
  "lib/e2eeCrypto": typeof lib_e2eeCrypto;
  "lib/e2eeEnforce": typeof lib_e2eeEnforce;
  "lib/e2eeEscrow": typeof lib_e2eeEscrow;
  "lib/e2eePure": typeof lib_e2eePure;
  "lib/effectLibrary": typeof lib_effectLibrary;
  "lib/embeds": typeof lib_embeds;
  "lib/entitlements": typeof lib_entitlements;
  "lib/extensionManifest": typeof lib_extensionManifest;
  "lib/files": typeof lib_files;
  "lib/gameHistory": typeof lib_gameHistory;
  "lib/geode": typeof lib_geode;
  "lib/guests": typeof lib_guests;
  "lib/identity": typeof lib_identity;
  "lib/ip": typeof lib_ip;
  "lib/ipBans": typeof lib_ipBans;
  "lib/klipy": typeof lib_klipy;
  "lib/listingUpdate": typeof lib_listingUpdate;
  "lib/liveKitAdmin": typeof lib_liveKitAdmin;
  "lib/liveKitWebhook": typeof lib_liveKitWebhook;
  "lib/loungeStickers": typeof lib_loungeStickers;
  "lib/mail": typeof lib_mail;
  "lib/mediaType": typeof lib_mediaType;
  "lib/mentions": typeof lib_mentions;
  "lib/messageCacheKeys": typeof lib_messageCacheKeys;
  "lib/moderation": typeof lib_moderation;
  "lib/modrinth": typeof lib_modrinth;
  "lib/motion": typeof lib_motion;
  "lib/motionAddress": typeof lib_motionAddress;
  "lib/mutuals": typeof lib_mutuals;
  "lib/notificationPolicy": typeof lib_notificationPolicy;
  "lib/oauthLinks": typeof lib_oauthLinks;
  "lib/panelClient": typeof lib_panelClient;
  "lib/passwordHash": typeof lib_passwordHash;
  "lib/platforms": typeof lib_platforms;
  "lib/profileCosmetics": typeof lib_profileCosmetics;
  "lib/r2": typeof lib_r2;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/richEmbeds": typeof lib_richEmbeds;
  "lib/secondFactor": typeof lib_secondFactor;
  "lib/secrets": typeof lib_secrets;
  "lib/serverProfile": typeof lib_serverProfile;
  "lib/sessions": typeof lib_sessions;
  "lib/signInStep": typeof lib_signInStep;
  "lib/skuDelete": typeof lib_skuDelete;
  "lib/staff": typeof lib_staff;
  "lib/staffPermissions": typeof lib_staffPermissions;
  "lib/stepUp": typeof lib_stepUp;
  "lib/studioDocs": typeof lib_studioDocs;
  "lib/studioDocsStore": typeof lib_studioDocsStore;
  "lib/surfaces": typeof lib_surfaces;
  "lib/twoFactor": typeof lib_twoFactor;
  "lib/uploadTicket": typeof lib_uploadTicket;
  "lib/webauthn": typeof lib_webauthn;
  linkPreviews: typeof linkPreviews;
  lounge: typeof lounge;
  maintenance: typeof maintenance;
  marketingDemo: typeof marketingDemo;
  marketplace: typeof marketplace;
  messages: typeof messages;
  motion: typeof motion;
  notificationSettings: typeof notificationSettings;
  notifications: typeof notifications;
  operations: typeof operations;
  passkeyData: typeof passkeyData;
  passkeys: typeof passkeys;
  payments: typeof payments;
  permissions: typeof permissions;
  platformSettings: typeof platformSettings;
  presence: typeof presence;
  priority: typeof priority;
  profileImages: typeof profileImages;
  profileWidgets: typeof profileWidgets;
  publicStats: typeof publicStats;
  push: typeof push;
  redisCloud: typeof redisCloud;
  reports: typeof reports;
  roles: typeof roles;
  savedMessages: typeof savedMessages;
  search: typeof search;
  serverProfiles: typeof serverProfiles;
  sidebar: typeof sidebar;
  soundboard: typeof soundboard;
  staff: typeof staff;
  store: typeof store;
  studioDocs: typeof studioDocs;
  support: typeof support;
  systemAccount: typeof systemAccount;
  systemMessages: typeof systemMessages;
  twoFactor: typeof twoFactor;
  typing: typeof typing;
  uploadLimits: typeof uploadLimits;
  users: typeof users;
  webPush: typeof webPush;
  webPushNode: typeof webPushNode;
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
