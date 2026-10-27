import { BOT_DELIVERY, BOT_LIMITS, BOT_MESSAGE, BOT_PERMISSIONS, BOT_RATE as RATE, BOT_SCOPES, BOT_SCOPE_INFO } from "../../../convex/lib/botAuth";
import { COMPONENT_LIMITS } from "../../../convex/lib/components";
import { EMBED_LIMITS } from "../../../convex/lib/embeds";
import { ROUTES, type Route } from "../../../convex/lib/botRoutes";
import { CAPABILITIES, CAPABILITY_INFO, EXTENSION_HTTP, EXTENSION_LIMITS } from "../../../convex/lib/extensionManifest";
import { DEFAULT_BUDGET, HOST_LIMITS } from "@/extensions/protocol";
import { UI_LIMITS } from "@/extensions/ui-schema";

/**
 * The numbers and tables in the guides, read from the code that enforces them.
 *
 * A guide writes `{{bot-permissions}}` where a table belongs and this fills it in when the page is
 * shown, so the permission list, the routes, the limits and the sandbox's budget are never typed
 * into prose a second time — and so can't go stale when one of them changes.
 */

const mb = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;
const secs = (ms: number) => `${ms / 1000} second${ms === 1000 ? "" : "s"}`;
const cell = (s: string) => s.replace(/\|/g, "\\|");
const table = (head: string[], rows: string[][]) => [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n");

const ROUTE_GROUPS: { title: string; match: (r: Route) => boolean }[] = [
  { title: "The bot itself", match: (r) => /^\/(me|commands|presence|uploads)\b/.test(r.path) || r.path.startsWith("/users/") },
  { title: "Communities, members and moderation", match: (r) => r.path.startsWith("/communities/") },
  { title: "Roles", match: (r) => r.path.startsWith("/roles/") },
  { title: "Channels and voice", match: (r) => r.path.startsWith("/channels/") && !/\/(messages|pins|typing)\b/.test(r.path) },
  { title: "Messages, reactions and pins", match: (r) => r.path.startsWith("/channels/") && /\/(messages|pins|typing)\b/.test(r.path) },
];

export const FACTS: Record<string, () => string> = {
  "bot-permissions": () =>
    table(
      ["Permission", "What it lets the bot do", "Care"],
      BOT_PERMISSIONS.map((p) => [`**${p.label}**`, p.description, p.risk === "high" ? "High" : p.risk === "medium" ? "Medium" : "Low"]),
    ),

  "bot-scopes": () => table(["Access", "What it lets the bot do"], BOT_SCOPES.map((s) => [`**${BOT_SCOPE_INFO[s].label}** (\`${s}\`)`, BOT_SCOPE_INFO[s].description])),

  "bot-routes": () => {
    const left = new Set(ROUTES);
    const out: string[] = [];
    for (const g of ROUTE_GROUPS) {
      const rows = ROUTES.filter((r) => left.has(r) && g.match(r));
      rows.forEach((r) => left.delete(r));
      if (rows.length) out.push(`### ${g.title}`, table(["Method", "Path", "What it does"], rows.map((r) => [`\`${r.method}\``, `\`${r.path}\``, r.summary])));
    }
    // Anything a new route adds that no group claims still appears.
    if (left.size) out.push("### Other", table(["Method", "Path", "What it does"], [...left].map((r) => [`\`${r.method}\``, `\`${r.path}\``, r.summary])));
    return out.join("\n\n");
  },

  "bot-limits": () =>
    [
      `- A bot can make **${RATE.requestsPerMinute} requests a minute**, of which **${RATE.sendsPerMinute}** can be messages. Over that, Crystal answers \`429\` with a \`Retry-After\` header; the SDK waits and tries again for you.`,
      `- A message holds up to **${BOT_MESSAGE.content.toLocaleString()} characters**, up to **${BOT_MESSAGE.files} files** of up to **${mb(BOT_MESSAGE.fileBytes)}** each, up to **${EMBED_LIMITS.embeds} embeds** and up to **${COMPONENT_LIMITS.rows} rows** of **${COMPONENT_LIMITS.buttonsPerRow} buttons**.`,
      `- Across all the embeds on one message there can be **${EMBED_LIMITS.total.toLocaleString()} characters**. One embed has a title up to ${EMBED_LIMITS.title}, a description up to ${EMBED_LIMITS.description.toLocaleString()} and up to ${EMBED_LIMITS.fields} fields (name up to ${EMBED_LIMITS.fieldName}, value up to ${EMBED_LIMITS.fieldValue.toLocaleString()}).`,
      `- A button's label is up to ${COMPONENT_LIMITS.label} characters and its \`customId\` up to ${COMPONENT_LIMITS.customId}.`,
      `- A person can make up to **${BOT_LIMITS.botsPerUser} bots**, a community can have up to **${BOT_LIMITS.botsPerCommunity}**, and a bot can have up to **${BOT_LIMITS.commands} slash commands**.`,
      `- Events are delivered with a **${secs(BOT_DELIVERY.timeoutMs)}** limit. A failed delivery is tried again after ${BOT_DELIVERY.backoffMs.map((m) => (m >= 60_000 ? `${m / 60_000} min` : `${m / 1000} s`)).join(", ")}; if **${BOT_DELIVERY.disableAfter} events in a row** can't be delivered at all, delivery is switched off until you turn it back on.`,
    ].join("\n"),

  "extension-powers": () => table(["Power", "In the project settings", "What it lets the extension do", "Care"], CAPABILITIES.map((c) => [`\`${c}\``, CAPABILITY_INFO[c].label, CAPABILITY_INFO[c].description, CAPABILITY_INFO[c].risk === "medium" ? "Medium" : "Low"])),

  "extension-limits": () =>
    [
      `- **Memory:** ${mb(DEFAULT_BUDGET.memoryBytes)}. **Starting up:** ${DEFAULT_BUDGET.bootMs} ms. **Each event handler:** ${DEFAULT_BUDGET.eventMs} ms. Over any ${secs(DEFAULT_BUDGET.windowMs)}, it may use at most ${DEFAULT_BUDGET.cpuShare * 100}% of the processor. Go over and Crystal stops the extension and says why.`,
      `- **Code:** ${kb(EXTENSION_LIMITS.source)} once built. **Storage:** ${EXTENSION_LIMITS.storageKeys} keys, ${kb(EXTENSION_LIMITS.storageValue)} a value, ${kb(EXTENSION_LIMITS.storageTotal)} in all.`,
      `- **Requests to Crystal:** up to ${HOST_LIMITS.callsPerSecond} a second. **Redraws of the panel:** ${HOST_LIMITS.redrawsPerSecond} a second (the next replaces one that's skipped). **Notices:** ${HOST_LIMITS.noticesPerMinute} a minute.`,
      `- **Timers:** ${HOST_LIMITS.activeTimers} at once; a timeout is at least ${HOST_LIMITS.minTimeoutMs} ms and an interval at least ${secs(HOST_LIMITS.minIntervalMs)}.`,
      `- **A panel** can have ${UI_LIMITS.nodes} nodes, ${UI_LIMITS.depth} levels deep; text up to ${UI_LIMITS.text.toLocaleString()} characters, labels up to ${UI_LIMITS.label}, lists up to ${UI_LIMITS.items} items.`,
      `- **Sites it may talk to:** up to ${EXTENSION_LIMITS.origins}.`,
    ].join("\n"),

  "extension-http": () =>
    [
      `- **Methods:** ${EXTENSION_HTTP.methods.join(", ")}. \`GET\` and \`DELETE\` have no body; a body is up to ${kb(EXTENSION_HTTP.maxRequestBytes)}.`,
      `- **Headers you can set:** ${EXTENSION_HTTP.headers.map((h) => `\`${h}\``).join(", ")}. Cookies are never sent.`,
      `- **Speed:** up to ${EXTENSION_HTTP.perMinute} requests a minute, each given ${secs(EXTENSION_HTTP.timeoutMs)} to answer.`,
      `- **Redirects** are followed up to ${EXTENSION_HTTP.maxRedirects} times, and only while they stay on your list of sites.`,
      `- **A response** over ${kb(EXTENSION_HTTP.maxResponseBytes)} is refused ("The response was too large"), not cut short.`,
    ].join("\n"),
};

/** The page with every `{{name}}` filled in. An unknown name is left visible so it gets noticed rather than silently dropped. */
export function expand(body: string): string {
  return body.replace(/\{\{([a-z-]+)\}\}/g, (whole, name: string) => FACTS[name]?.() ?? whole);
}

/** The names a page may use, for the tests and the Admin Console's help. */
export const FACT_NAMES = Object.keys(FACTS);
