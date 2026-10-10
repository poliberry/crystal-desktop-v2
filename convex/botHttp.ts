import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import type { OpResult } from "./botOps";
import { parseAuthorization, sha256Hex } from "./lib/botAuth";
import { matchRoute } from "./lib/botRoutes";

/**
 * The Bot API over HTTP, under `/bot/v1/`. Every request carries `Authorization: Bot <token>`.
 *
 * This file only turns an HTTP request into one operation and the answer back into HTTP; routing
 * is `lib/botRoutes.ts` and every decision about what a bot may do is in `botOps.ts`, made from the
 * database on each request. Errors are JSON with a status that means what it says: 401 no/invalid
 * token, 403 not allowed, 404 no such thing (or not visible to the bot), 409 clash, 429 slow down.
 */

const MAX_BODY = 256 * 1024;
const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

const respond = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
const problem = (status: number, message: string, extra: Record<string, string> = {}) => respond(status, { error: { status, message } }, status === 429 ? { "retry-after": "30", ...extra } : extra);

export const handle = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/bot\/v1/, "") || "/";
  const method = request.method.toUpperCase();

  const auth = parseAuthorization(request.headers.get("authorization"));
  if (!auth) return problem(401, "Send your bot's token as `Authorization: Bot <token>`.");

  const found = matchRoute(method, path);
  if (!found) return problem(404, "There's no such endpoint.");
  if ("methodNotAllowed" in found) return problem(405, `Use ${found.methodNotAllowed.join(" or ")} for this endpoint.`, { allow: found.methodNotAllowed.join(", ") });
  const { route, params } = found.matched;

  let body: unknown = {};
  if (method !== "GET") {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return problem(413, "That request is too large.");
    if (raw.trim()) {
      try {
        body = JSON.parse(raw);
      } catch {
        return problem(400, "The body isn't valid JSON.");
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) return problem(400, "The body has to be a JSON object.");
    }
  }
  const query = Object.fromEntries([...url.searchParams.entries()].slice(0, 20).map(([k, v]) => [k.slice(0, 40), v.slice(0, 200)]));

  try {
    const hash = await sha256Hex(auth.token);
    const args = { prefix: auth.prefix, hash, params };
    let result: OpResult;
    if (route.op === "events.poll") {
      // Not an ordinary operation: it waits, so it is a loop here rather than one mutation, and it
      // doesn't use up the bot's request allowance (a bot asks about once every 25 seconds, always).
      const wait = Math.min(25, Math.max(0, Number(query.wait) || 0));
      const after = query.after !== undefined && Number.isFinite(Number(query.after)) ? Number(query.after) : undefined;
      const who = { prefix: args.prefix, hash: args.hash };
      const first = await ctx.runMutation(internal.botEvents.poll, { ...who, after });
      if (!first.ok) return problem(first.status, first.message);
      if (first.mode === "webhook" || first.events.length > 0 || wait === 0) return respond(200, { mode: first.mode, events: first.events, cursor: first.cursor });
      const until = Date.now() + wait * 1000;
      let cursor = first.cursor;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1000));
        const more = await ctx.runQuery(internal.botEvents.peek, { ...who, after: cursor });
        cursor = more.cursor;
        if (more.events.length > 0) return respond(200, { mode: "poll", events: more.events, cursor });
      }
      return respond(200, { mode: "poll", events: [], cursor });
    }
    if (route.op === "voice.join") result = await ctx.runAction(internal.botVoice.join, args);
    else if (route.op === "voice.leave") result = await ctx.runAction(internal.botVoice.leave, args);
    else result = await ctx.runMutation(internal.botOps.execute, { ...args, op: route.op, body, query });
    return result.ok ? respond(result.status, result.data) : problem(result.status, result.message);
  } catch (e) {
    // Many requests from one bot at once all touch its request counter; the ones that lose the race
    // are over its limit in spirit, so they are told to slow down rather than that we failed.
    if (e instanceof Error && /changed while this mutation was being run/i.test(e.message)) return problem(429, "Slow down: too many requests at once.");
    console.error("[bot api] unexpected error:", e);
    return problem(500, "Something went wrong on our side.");
  }
});
