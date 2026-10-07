import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sweep stale presence", { seconds: 20 }, internal.presence.sweepStale);
crons.interval("reconcile call participants", { seconds: 30 }, internal.lib.callReconciliation.reconcile);

crons.interval("update creator feeds", { minutes: 10 }, internal.creatorCommunities.syncAll);
crons.interval("re-check creator memberships", { hours: 6 }, internal.creatorCommunities.resyncMemberships);

export default crons;
