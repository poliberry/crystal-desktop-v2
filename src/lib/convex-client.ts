import { ConvexReactClient } from "convex/react";

import { AUTH_ERROR, errorCode } from "@/lib/auth-errors";
import { requestPrompt, type PromptKind } from "@/lib/step-up";

/**
 * The app's Convex client, with one addition: when the server turns a call away because it needs a
 * second step, the person is asked for it and the call is run again.
 *
 * The server is what enforces this (see convex/lib/stepUp.ts); this is only what makes it bearable.
 * Without it every administrative button would have to know how to ask for a code, and a button
 * that forgot would just show "Error". With it they all work the same way: click, enter the code
 * once, and the thing you clicked happens. Asking again doesn't happen for a few minutes, because
 * the server remembers the code against the session.
 *
 * Only mutations and actions are wrapped. A query can't be paused and retried, and the ones that
 * hold administrative data return "locked" states the screens show for themselves.
 */
export function createConvexClient(url: string): ConvexReactClient {
  const client = new ConvexReactClient(url);

  const promptFor = (error: unknown): PromptKind | null => {
    switch (errorCode(error)) {
      case AUTH_ERROR.stepUpRequired:
        return { kind: "code" };
      case AUTH_ERROR.passwordRequired:
        return { kind: "password" };
      case AUTH_ERROR.twoFactorRequired: {
        const scope = (error as { data?: { scope?: string } }).data?.scope;
        return { kind: "enroll", scope: scope === "server" ? "server" : "platform" };
      }
      default:
        return null;
    }
  };

  const guard =
    <Args extends unknown[], Result>(run: (...args: Args) => Promise<Result>) =>
    async (...args: Args): Promise<Result> => {
      try {
        return await run(...args);
      } catch (error) {
        const prompt = promptFor(error);
        if (!prompt) throw error;
        const verified = await requestPrompt(prompt);
        // "Enroll" can't be answered here: the person has to go and set it up, then try again.
        if (verified && prompt.kind !== "enroll") return run(...args);
        throw error;
      }
    };

  const mutation = client.mutation.bind(client);
  const action = client.action.bind(client);
  (client as unknown as { mutation: unknown }).mutation = guard(mutation as (...a: unknown[]) => Promise<unknown>);
  (client as unknown as { action: unknown }).action = guard(action as (...a: unknown[]) => Promise<unknown>);
  return client;
}
