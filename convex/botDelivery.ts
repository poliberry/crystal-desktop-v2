import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { audit } from "./lib/botAccess";
import { BOT_DELIVERY, signEvent } from "./lib/botAuth";
import { newEvent } from "./lib/botEvents";
import { assertPanelUrl } from "./lib/panelClient";
import { decryptSecret } from "./lib/secrets";

/**
 * Delivering events to a bot's endpoint: one signed POST, a short timeout, no redirects followed,
 * and a handful of retries with growing gaps. Responses are never read, only their status, so a
 * bot can't use its reply to feed anything back in.
 *
 * An endpoint that keeps failing is switched off rather than called forever: after
 * `DISABLE_AFTER` events in a row have failed completely, delivery stops until its author turns
 * it back on.
 */

const TIMEOUT_MS = BOT_DELIVERY.timeoutMs;
const BACKOFF_MS: readonly number[] = BOT_DELIVERY.backoffMs;
const DISABLE_AFTER = BOT_DELIVERY.disableAfter;

export const prepare = internalQuery({
  args: { botId: v.id("bots") },
  handler: async (ctx, { botId }) => {
    const bot = await ctx.db.get(botId);
    if (!bot) return null;
    return { endpointUrl: bot.endpointUrl, signingSecret: bot.signingSecret, ok: !bot.suspendedAt && !bot.eventsDisabledAt };
  },
});

export const record = internalMutation({
  args: { botId: v.id("bots"), ok: v.boolean(), status: v.optional(v.number()), error: v.optional(v.string()), final: v.boolean() },
  handler: async (ctx, { botId, ok, status, error, final }) => {
    const bot = await ctx.db.get(botId);
    if (!bot) return;
    const patch: Record<string, unknown> = { lastDelivery: { at: Date.now(), ok, status, error: error?.slice(0, 200) } };
    if (ok) patch.consecutiveFailures = 0;
    else if (final) {
      const failures = bot.consecutiveFailures + 1;
      patch.consecutiveFailures = failures;
      if (failures >= DISABLE_AFTER && !bot.eventsDisabledAt) {
        patch.eventsDisabledAt = Date.now();
        await audit(ctx, { botId, action: "events.disabled", ok: false, detail: `${failures} events in a row couldn't be delivered.` });
      }
    }
    await ctx.db.patch(botId, patch);
  },
});

async function post(url: string, secret: string, event: { type: string; id: string }): Promise<{ ok: boolean; status?: number; error?: string }> {
  // Checked again at delivery: an address that was fine when it was saved may not be now.
  try {
    assertPanelUrl(url);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "That address isn't allowed." };
  }
  const body = JSON.stringify(event);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "Crystal-Bot/1.0 (+https://usecrystal.app)",
        "x-crystal-signature": await signEvent(secret, body),
        "x-crystal-event": event.type,
        "x-crystal-delivery": event.id,
      },
      body,
    });
    // Drain nothing: the reply isn't read.
    void res.body?.cancel().catch(() => undefined);
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status, error: "The endpoint redirected, which isn't followed." };
    return { ok: false, status: res.status, error: `The endpoint answered ${res.status}.` };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "AbortError" ? "The endpoint took too long to answer." : "Couldn't reach the endpoint." };
  } finally {
    clearTimeout(timer);
  }
}

export const deliver = internalAction({
  args: { botId: v.id("bots"), event: v.any(), attempt: v.number(), maxAttempts: v.number() },
  handler: async (ctx, { botId, event, attempt, maxAttempts }) => {
    const target = await ctx.runQuery(internal.botDelivery.prepare, { botId });
    if (!target || !target.ok || !target.endpointUrl) return;
    const result = await post(target.endpointUrl, await decryptSecret(target.signingSecret), event as { type: string; id: string });
    const last = result.ok || attempt + 1 >= maxAttempts;
    await ctx.runMutation(internal.botDelivery.record, { botId, ok: result.ok, status: result.status, error: result.error, final: last && !result.ok });
    if (!result.ok && !last) {
      await ctx.scheduler.runAfter(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)], internal.botDelivery.deliver, { botId, event, attempt: attempt + 1, maxAttempts });
    }
  },
});

/** The author's "send a test event": one ping, no retries, and the answer. */
export const ping = internalAction({
  args: { botId: v.id("bots") },
  handler: async (ctx, { botId }): Promise<{ ok: boolean; status?: number; error?: string; ms: number }> => {
    const target = await ctx.runQuery(internal.botDelivery.prepare, { botId });
    if (!target?.endpointUrl) return { ok: false, error: "Set the bot's endpoint address first.", ms: 0 };
    const started = Date.now();
    const result = await post(target.endpointUrl, await decryptSecret(target.signingSecret), newEvent("ping", { botId: botId as Id<"bots"> }));
    await ctx.runMutation(internal.botDelivery.record, { botId, ok: result.ok, status: result.status, error: result.error, final: false });
    return { ...result, ms: Date.now() - started };
  },
});
