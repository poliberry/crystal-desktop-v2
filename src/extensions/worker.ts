/// <reference lib="webworker" />
import type { FromWorker, ToWorker } from "@/extensions/protocol";
import { createRunner, type Runner } from "@/extensions/vm-runner";

/**
 * The Worker an extension runs in: a few lines joining the engine (`vm-runner.ts`) to
 * `postMessage`. It has no access to the page, the account or the network of its own —
 * a Worker has no DOM — and the engine inside it has no access to the Worker either.
 */

const scope = self as unknown as DedicatedWorkerGlobalScope;
let runner: Runner | null = null;
let faulted = false;

const post = (m: FromWorker) => {
  if (m.t === "fault") faulted = true;
  scope.postMessage(m);
};

scope.onmessage = async (event: MessageEvent<ToWorker>) => {
  const m = event.data;
  switch (m.t) {
    case "boot":
      try {
        runner = await createRunner(m.boot, post);
        if (!faulted) post({ t: "ready" });
      } catch (e) {
        post({ t: "fault", reason: "boot", detail: e instanceof Error ? e.message : "The engine couldn't start." });
      }
      break;
    case "event":
      runner?.dispatch(m.name, m.data, m.seq);
      break;
    case "reply":
      runner?.reply(m.id, m.ok, m.value);
      break;
    case "kill":
      runner?.dispose();
      scope.close();
      break;
  }
};
