import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval("sweep stale presence", { seconds: 20 }, internal.presence.sweepStale);

export default crons;
