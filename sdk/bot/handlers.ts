import type { Client, ClientEvents } from "./client";
import { CrystalError } from "./errors";
import type { ButtonInteraction, CommandInteraction } from "./structures";

/**
 * Handlers in their own files.
 *
 * A bot that does a lot is easier to read as one small file per thing it does — `src/events/ready.ts`,
 * `src/commands/ping.ts`, `src/buttons/thanks.ts` — than as one long `index.ts`. Each file exports a handler made
 * with `defineEvent`, `defineCommand` or `defineButton`, and `client.loadHandlers()` finds them and wires them up.
 * It is nothing but a convenience: the same handlers could be written with `client.on`, `client.command`
 * and `client.button`, and the two styles can be mixed.
 */

/** The names of the folders `loadHandlers` looks in, under the folder you give it. */
export const HANDLER_FOLDERS = { events: "events", commands: "commands", buttons: "buttons" } as const;

/** A listener for one of the client's events, as a file exports it. */
export interface EventHandler<K extends keyof ClientEvents = keyof ClientEvents> {
  /** Which event, by name: `Events.MessageCreate` or `"messageCreate"`. */
  name: K;
  /** Handle it only the first time it happens. Default false. */
  once?: boolean;
  /** Called with what the event carries, then the client: `(message, client) => …`. */
  run: (...args: [...ClientEvents[K], client: Client]) => unknown;
}

/** A slash command, as a file exports it. */
export interface CommandHandler {
  /** The name people type after the `/`: lower-case letters, digits, `-` and `_`, up to 32. */
  name: string;
  /** Shown in the list when someone types `/`. Up to 100 characters. */
  description: string;
  /** Called when the command is used. */
  run: (interaction: CommandInteraction, client: Client) => unknown;
}

/** A button's handler, as a file exports it. */
export interface ButtonHandler {
  /** The `customId` the button was given with `setCustomId`. */
  customId: string;
  /** Called when the button is pressed. */
  run: (interaction: ButtonInteraction, client: Client) => unknown;
}

/** Declare an event handler. Put it in the file's default export. Fully typed from the event's name. */
export function defineEvent<K extends keyof ClientEvents>(handler: EventHandler<K>): EventHandler<K> {
  return handler;
}
/** Declare a slash command. Put it in the file's default export. */
export function defineCommand(handler: CommandHandler): CommandHandler {
  return handler;
}
/** Declare a button handler. Put it in the file's default export. */
export function defineButton(handler: ButtonHandler): ButtonHandler {
  return handler;
}

/** What `loadHandlers` found. */
export interface LoadedHandlers {
  /** The event handlers that were wired up. */
  events: EventHandler[];
  /** The slash commands that were wired up. */
  commands: CommandHandler[];
  /** The button handlers that were wired up. */
  buttons: ButtonHandler[];
  /** Every file that was loaded, relative to the folder, for a startup message. */
  files: string[];
}

const COMMAND_NAME = /^[a-z0-9_-]{1,32}$/;
/** A file the loader skips: not code, a type file, a test, or marked as not a handler with a leading `_` or `.`. */
export function isHandlerFile(name: string): boolean {
  if (name.startsWith("_") || name.startsWith(".")) return false;
  if (/\.d\.[cm]?ts$/.test(name) || /\.(test|spec)\.[cm]?[jt]s$/.test(name)) return false;
  return /\.(?:[cm]?[jt]s)$/.test(name);
}

const where = (file: string) => `“${file}”`;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** An event handler as a file exports it, checked; throws a plain sentence naming the file if it isn't one. */
export function checkEvent(value: unknown, file: string, known: readonly string[]): EventHandler {
  if (!isObj(value)) throw new CrystalError(`${where(file)} should export an event handler as its default export: export default defineEvent({ name, run }).`);
  if (typeof value.name !== "string" || !known.includes(value.name)) throw new CrystalError(`${where(file)}: “${String(value.name)}” isn't an event. Use one of: ${known.join(", ")}.`);
  if (typeof value.run !== "function") throw new CrystalError(`${where(file)}: an event handler needs a run function.`);
  if (value.once !== undefined && typeof value.once !== "boolean") throw new CrystalError(`${where(file)}: once must be true or false.`);
  return value as unknown as EventHandler;
}

export function checkCommand(value: unknown, file: string): CommandHandler {
  if (!isObj(value)) throw new CrystalError(`${where(file)} should export a command as its default export: export default defineCommand({ name, description, run }).`);
  if (typeof value.name !== "string" || !COMMAND_NAME.test(value.name)) throw new CrystalError(`${where(file)}: a command's name is 1–32 lower-case letters, digits, - or _ (got “${String(value.name)}”).`);
  if (typeof value.description !== "string" || value.description.trim().length === 0 || value.description.length > 100) throw new CrystalError(`${where(file)}: a command needs a description of 1–100 characters.`);
  if (typeof value.run !== "function") throw new CrystalError(`${where(file)}: a command needs a run function.`);
  return value as unknown as CommandHandler;
}

export function checkButton(value: unknown, file: string): ButtonHandler {
  if (!isObj(value)) throw new CrystalError(`${where(file)} should export a button handler as its default export: export default defineButton({ customId, run }).`);
  if (typeof value.customId !== "string" || value.customId.length === 0 || value.customId.length > 100) throw new CrystalError(`${where(file)}: a button handler needs a customId of 1–100 characters.`);
  if (typeof value.run !== "function") throw new CrystalError(`${where(file)}: a button handler needs a run function.`);
  return value as unknown as ButtonHandler;
}

/** Two handlers that would answer the same thing: an error naming both files, rather than one silently winning. */
export function findDuplicate<T>(items: { value: T; file: string }[], keyOf: (v: T) => string): { key: string; a: string; b: string } | null {
  const seen = new Map<string, string>();
  for (const { value, file } of items) {
    const key = keyOf(value);
    const first = seen.get(key);
    if (first) return { key, a: first, b: file };
    seen.set(key, file);
  }
  return null;
}

/** Every handler file under `dir/<folder>`, depth-first and sorted, so loading order never depends on the disk. */
export async function listHandlerFiles(dir: string, folder: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    let entries: { name: string; isDirectory(): boolean; isFile(): boolean }[];
    try {
      entries = (await readdir(join(dir, rel), { withFileTypes: true })) as typeof entries;
    } catch {
      return; // a folder that isn't there is simply empty
    }
    for (const e of [...entries].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0))) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      if (e.isDirectory()) await walk(`${rel}/${e.name}`);
      else if (e.isFile() && isHandlerFile(e.name)) out.push(`${rel}/${e.name}`);
    }
  };
  await walk(folder);
  return out;
}

/** Import one file and return its default export. A file that throws while loading is reported with its name. */
export async function importDefault(dir: string, rel: string): Promise<unknown> {
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  try {
    const mod = (await import(pathToFileURL(join(dir, rel)).href)) as { default?: unknown };
    return mod.default;
  } catch (e) {
    throw new CrystalError(`${where(rel)} couldn't be loaded: ${(e as Error).message}`);
  }
}
