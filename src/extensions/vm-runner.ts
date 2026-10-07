import { newQuickJSWASMModule, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime, type QuickJSWASMModule } from "quickjs-emscripten";
import variant from "@jitl/quickjs-singlefile-browser-release-sync";

import { OPS, type Budget, type FaultReason, type FromWorker } from "@/extensions/protocol";
import { SDK_PRELUDE } from "@/extensions/sdk-prelude";

/**
 * One extension's JavaScript engine, and every limit on it.
 *
 * This file knows nothing about workers: it is given a function to send messages and
 * returns functions to receive them, which is what lets it be tested on its own. The
 * Worker (`worker.ts`) is a few lines that connect it to `postMessage`.
 *
 * What is in the engine: the language, and the `crystal` SDK. Not `window`, not
 * `fetch`, not timers, not anything of the page's — the engine has no way to name
 * them, so there is nothing to block. What limits it: a memory ceiling, a deadline on
 * every entry into its code (an interrupt the engine itself checks, so a loop can't
 * ignore it), a share of the processor over a window, a ceiling on messages per
 * second, and a ceiling on the size of any one message. Going over any of them
 * stops it for good; it is not given another go.
 */

const MAX_MESSAGE = 256 * 1024;
const MAX_STACK = 512 * 1024;
const MAX_MESSAGES_PER_SEC = 120;
const UI_MIN_INTERVAL_MS = 100;

let modulePromise: Promise<QuickJSWASMModule> | null = null;
const loadQuickJS = () => (modulePromise ??= newQuickJSWASMModule(variant));

export interface Runner {
  dispatch(name: string, data: unknown, seq: number): void;
  reply(id: number, ok: boolean, value: string | undefined): void;
  dispose(): void;
}

export async function createRunner(
  boot: { source: string; manifest: { name: string; version: string; capabilities: string[]; network: string[] }; granted: string[]; budget: Budget },
  send: (m: FromWorker) => void,
): Promise<Runner> {
  const QuickJS = await loadQuickJS();
  const rt: QuickJSRuntime = QuickJS.newRuntime();
  rt.setMemoryLimit(boot.budget.memoryBytes);
  rt.setMaxStackSize(MAX_STACK);

  let deadline = Infinity;
  rt.setInterruptHandler(() => Date.now() > deadline);

  const ctx: QuickJSContext = rt.newContext();
  let dead = false;
  let nextCall = 1;

  // --- accounting ------------------------------------------------------------------------
  const spent: { at: number; ms: number }[] = [];
  let messageTimes: number[] = [];
  let lastUi = 0;
  let pendingUi: string | null = null;
  let uiTimer: ReturnType<typeof setTimeout> | null = null;

  const fault = (reason: FaultReason, detail: string) => {
    if (dead) return;
    dead = true;
    if (uiTimer) clearTimeout(uiTimer);
    send({ t: "fault", reason, detail: detail.slice(0, 300) });
  };

  const checkFlood = (): boolean => {
    const now = Date.now();
    messageTimes = messageTimes.filter((t) => now - t < 1000);
    messageTimes.push(now);
    if (messageTimes.length > MAX_MESSAGES_PER_SEC) {
      fault("flood", `More than ${MAX_MESSAGES_PER_SEC} messages in a second.`);
      return false;
    }
    return true;
  };

  /** Run something inside the engine under a deadline, then let its promises settle. */
  const enter = (ms: number, what: string, fn: () => void) => {
    if (dead) return;
    const start = Date.now();
    deadline = start + ms;
    try {
      fn();
      // Promise callbacks are part of the same turn, so they are under the same deadline.
      for (let i = 0; i < 1000 && !dead; i++) {
        const r = rt.executePendingJobs();
        if (r.error) {
          const err = ctx.dump(r.error) as { message?: string };
          r.error.dispose();
          interpret(err?.message ?? "error", what);
          break;
        }
        if (r.value === 0) break;
      }
    } finally {
      deadline = Infinity;
      const took = Date.now() - start;
      spent.push({ at: start, ms: took });
      const cutoff = Date.now() - boot.budget.windowMs;
      while (spent.length && spent[0].at < cutoff) spent.shift();
      const total = spent.reduce((n, s) => n + s.ms, 0);
      if (!dead && total / boot.budget.windowMs > boot.budget.cpuShare) fault("cpu", `${total} ms of processor in ${boot.budget.windowMs / 1000} s.`);
    }
  };

  /** What an error from the engine means: a limit being hit, or just a mistake in the code. */
  const interpret = (message: string, what: string) => {
    if (/interrupted/i.test(message)) fault("timeout", `${what} ran for too long and was stopped.`);
    else if (/out of memory/i.test(message)) fault("memory", `${what} used more memory than it is allowed.`);
    else if (/stack overflow|too much recursion/i.test(message)) fault("crash", `${what} recursed too deeply.`);
    else send({ t: "log", level: "error", text: `${what}: ${message}`.slice(0, 500) });
  };

  const text = (h: QuickJSHandle): string => ctx.getString(h);

  // --- the two doors out ---------------------------------------------------------------------
  const sendFn = ctx.newFunction("__send", (opH, argH) => {
    if (dead || !checkFlood()) return;
    const op = text(opH);
    const arg = argH ? text(argH) : "";
    if (arg.length > MAX_MESSAGE) return fault("oversize", `A message to the host was ${(arg.length / 1024).toFixed(0)} KB.`);
    try {
      if (op === "ui") {
        const now = Date.now();
        const flush = (json: string) => {
          lastUi = Date.now();
          try {
            send({ t: "ui", tree: JSON.parse(json) });
          } catch {
            send({ t: "log", level: "error", text: "crystal.ui.render was given something that isn't JSON." });
          }
        };
        if (now - lastUi >= UI_MIN_INTERVAL_MS) flush(arg);
        else {
          // Only the latest picture matters: a burst of renders collapses into one.
          pendingUi = arg;
          if (!uiTimer) {
            uiTimer = setTimeout(() => {
              uiTimer = null;
              if (pendingUi !== null && !dead) flush(pendingUi);
              pendingUi = null;
            }, UI_MIN_INTERVAL_MS - (now - lastUi));
          }
        }
      } else if (op === "log") {
        const [level, line] = JSON.parse(arg) as [string, string];
        send({ t: "log", level: (["log", "info", "warn", "error"].includes(level) ? level : "log") as "log", text: String(line).slice(0, 1000) });
      }
    } catch {
      /* a malformed message is ignored; it costs the extension its own message budget */
    }
  });
  ctx.setProp(ctx.global, "__send", sendFn);
  sendFn.dispose();

  const callFn = ctx.newFunction("__call", (opH, argH) => {
    const id = nextCall++;
    if (dead || !checkFlood()) return ctx.newNumber(id);
    const op = text(opH);
    const arg = argH ? text(argH) : "null";
    if (arg.length > MAX_MESSAGE) {
      fault("oversize", `A request to the host was ${(arg.length / 1024).toFixed(0)} KB.`);
      return ctx.newNumber(id);
    }
    if (!(OPS as readonly string[]).includes(op)) {
      // Not something the host does. Answered with an error rather than passed along.
      setTimeout(() => runnerReply(id, false, `“${op}” isn't something an extension can do.`), 0);
      return ctx.newNumber(id);
    }
    try {
      send({ t: "call", id, op, args: JSON.parse(arg) });
    } catch {
      setTimeout(() => runnerReply(id, false, "That request wasn't valid JSON."), 0);
    }
    return ctx.newNumber(id);
  });
  ctx.setProp(ctx.global, "__call", callFn);
  callFn.dispose();

  const manifestH = ctx.newString(JSON.stringify({ name: boot.manifest.name, version: boot.manifest.version, capabilities: boot.manifest.capabilities, network: boot.manifest.network }));
  ctx.setProp(ctx.global, "__manifest", manifestH);
  manifestH.dispose();

  // --- start it --------------------------------------------------------------------------------
  const run = (code: string, name: string, ms: number) =>
    enter(ms, name, () => {
      const r = ctx.evalCode(code, name);
      if (r.error) {
        const err = ctx.dump(r.error) as { message?: string; name?: string };
        r.error.dispose();
        const msg = err?.message ?? "error";
        if (/interrupted|out of memory|stack overflow/i.test(msg)) interpret(msg, name);
        else fault("boot", `${err?.name ?? "Error"}: ${msg}`);
      } else r.value.dispose();
    });

  run(SDK_PRELUDE, "sdk.js", 200);
  // The SDK reads its manifest once; after that the global is no longer needed by anything.
  if (!dead) run(boot.source, "extension.js", boot.budget.bootMs);
  if (!dead) {
    // Hide the host doors from the extension's own code from here on.
    const hide = ctx.evalCode("(function(){var s=__send,c=__call;Object.defineProperty(globalThis,'__send',{value:s,enumerable:false});Object.defineProperty(globalThis,'__call',{value:c,enumerable:false});})()");
    if (hide.error) hide.error.dispose();
    else hide.value.dispose();
  }

  const runnerReply = (id: number, ok: boolean, value: string | undefined) => {
    if (dead) return;
    enter(boot.budget.eventMs, "A reply", () => {
      const fnH = ctx.getProp(ctx.global, "__resolve");
      const idH = ctx.newNumber(id);
      const okH = ctx.newNumber(ok ? 1 : 0);
      const valH = value === undefined ? ctx.undefined : ctx.newString(value);
      const r = ctx.callFunction(fnH, ctx.undefined, idH, okH, valH);
      if (r.error) {
        const err = ctx.dump(r.error) as { message?: string };
        r.error.dispose();
        interpret(err?.message ?? "error", "A reply");
      } else r.value.dispose();
      idH.dispose();
      okH.dispose();
      if (value !== undefined) valH.dispose();
      fnH.dispose();
    });
  };

  return {
    dispatch(name, data, seq) {
      if (dead) return;
      const start = Date.now();
      enter(boot.budget.eventMs, `The “${name}” handler`, () => {
        const fnH = ctx.getProp(ctx.global, "__dispatch");
        const nameH = ctx.newString(name);
        const dataH = data === undefined ? ctx.undefined : ctx.newString(JSON.stringify(data));
        const r = ctx.callFunction(fnH, ctx.undefined, nameH, dataH);
        if (r.error) {
          const err = ctx.dump(r.error) as { message?: string };
          r.error.dispose();
          interpret(err?.message ?? "error", `The “${name}” handler`);
        } else r.value.dispose();
        nameH.dispose();
        if (data !== undefined) dataH.dispose();
        fnH.dispose();
      });
      if (!dead) send({ t: "idle", seq, ms: Date.now() - start });
    },
    reply: runnerReply,
    dispose() {
      dead = true;
      if (uiTimer) clearTimeout(uiTimer);
      try {
        ctx.dispose();
        rt.dispose();
      } catch {
        /* already gone */
      }
    },
  };
}
