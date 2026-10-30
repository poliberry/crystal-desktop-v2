import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sweep stale presence", { seconds: 20 }, internal.presence.sweepStale);
crons.interval("reconcile call participants", { seconds: 30 }, internal.lib.callReconciliation.reconcile);

crons.interval("keep voice grants in step with permissions", { minutes: 1 }, internal.voiceSync.resync, {});

crons.interval("wipe expired guest accounts", { minutes: 15 }, internal.guests.sweepExpired);
crons.interval("clear out stale sign-in records", { hours: 1 }, internal.guests.sweepLimits);

crons.interval("update creator feeds", { minutes: 10 }, internal.creatorCommunities.syncAll);
crons.interval("re-check creator memberships", { hours: 6 }, internal.creatorCommunities.resyncMemberships);
crons.interval("count people for the landing page", { minutes: 5 }, internal.publicStats.refresh);
crons.interval("prune community audit logs", { hours: 24 }, internal.communityAudit.prune);
crons.interval("credit voice time to community insights", { minutes: 5 }, internal.communityInsights.tickVoice);
crons.interval("sweep community insights", { hours: 24 }, internal.communityInsights.sweep);
crons.interval("finish E2EE escrow onboarding", { minutes: 5 }, internal.e2eeOnboard.dropCompletedEscrows);

export default crons;
