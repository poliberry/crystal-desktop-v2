import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sweep stale presence", { seconds: 20 }, internal.presence.sweepStale);
crons.interval("reconcile call participants", { seconds: 30 }, internal.lib.callReconciliation.reconcile);

export default crons;
