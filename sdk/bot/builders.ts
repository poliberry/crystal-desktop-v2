import { CrystalError } from "./errors";
import type { APIActionRow, APIButton, APIEmbed, ButtonStyle } from "./types";

/**
 * Builders for the rich parts of a message, with chainable setters, as discord.js's.
 * Crystal re-checks everything on its side (sizes, https-only addresses…), so these are for
 * convenience and early errors, not for trust.
 */

const colourOf = (c: number | string): number => {
  if (typeof c === "number") return c;
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (!m) throw new CrystalError(`“${c}” isn't a colour. Use a number like 0xff8800 or a string like "#ff8800".`);
  return parseInt(m[1], 16);
};

/** A rich card for a message: chain the setters, then pass it in `embeds`. */
export class EmbedBuilder {
  /** The embed so far, as plain data. */
  readonly data: APIEmbed;
  constructor(data: APIEmbed = {}) {
    this.data = structuredClone(data);
  }
  /** The heading. `null` removes it. */
  setTitle(title: string | null): this {
    return this.set("title", title ?? undefined);
  }
  /** The body text. `null` removes it. */
  setDescription(description: string | null): this {
    return this.set("description", description ?? undefined);
  }
  /** Makes the title a link. https only. */
  setURL(url: string | null): this {
    return this.set("url", url ?? undefined);
  }
  /** The colour of the card's edge: a number like `0xff8800` or a string like `"#ff8800"`. */
  setColor(color: number | string | null): this {
    return this.set("color", color === null ? undefined : colourOf(color));
  }
  /** A time shown in the footer. Defaults to now. */
  setTimestamp(when: Date | number | string = Date.now()): this {
    return this.set("timestamp", when instanceof Date ? when.getTime() : when);
  }
  /** A small line above the title. */
  setAuthor(author: { name: string; url?: string; iconUrl?: string } | null): this {
    return this.set("author", author ?? undefined);
  }
  /** A small line under the card. */
  setFooter(footer: { text: string; iconUrl?: string } | null): this {
    return this.set("footer", footer ?? undefined);
  }
  /** A large picture under the text. https only. */
  setImage(url: string | null): this {
    return this.set("image", url ? { url } : undefined);
  }
  /** A small picture in the corner. https only. */
  setThumbnail(url: string | null): this {
    return this.set("thumbnail", url ? { url } : undefined);
  }
  /** Add name and value pairs after the ones already there. `inline` ones sit side by side. */
  addFields(...fields: { name: string; value: string; inline?: boolean }[]): this {
    this.data.fields = [...(this.data.fields ?? []), ...fields];
    return this;
  }
  /** Replace all the fields. */
  setFields(...fields: { name: string; value: string; inline?: boolean }[]): this {
    this.data.fields = fields;
    return this;
  }
  /** A copy of the embed as plain data, which is what is sent. */
  toJSON(): APIEmbed {
    return structuredClone(this.data);
  }
  private set<K extends keyof APIEmbed>(key: K, value: APIEmbed[K] | undefined): this {
    if (value === undefined) delete this.data[key];
    else this.data[key] = value;
    return this;
  }
}

/** A button for a message. Put up to five in an `ActionRowBuilder`. */
export class ButtonBuilder {
  /** The button so far, as plain data. */
  readonly data: APIButton = { style: "secondary" };
  constructor(data: APIButton = {}) {
    Object.assign(this.data, data);
  }
  /** What comes back to you in `interactionCreate` when it is pressed. Not for link buttons. */
  setCustomId(id: string): this {
    this.data.customId = id;
    return this;
  }
  /** The text on the button. */
  setLabel(label: string): this {
    this.data.label = label;
    return this;
  }
  /** An emoji shown beside the label. */
  setEmoji(emoji: string): this {
    this.data.emoji = emoji;
    return this;
  }
  /** How it looks: `primary`, `secondary`, `success`, `danger` or `link`. */
  setStyle(style: ButtonStyle): this {
    this.data.style = style;
    return this;
  }
  /** Makes it a link button that opens in the browser (and so has no customId). https only. */
  setURL(url: string): this {
    this.data.url = url;
    this.data.style = "link";
    delete this.data.customId;
    return this;
  }
  /** Show it but don't let it be pressed. */
  setDisabled(disabled = true): this {
    this.data.disabled = disabled;
    return this;
  }
  /** A copy of the button as plain data. */
  toJSON(): APIButton {
    return { ...this.data };
  }
}

/** A row of up to five buttons. */
export class ActionRowBuilder {
  /** The buttons in the row. */
  readonly buttons: ButtonBuilder[] = [];
  constructor(...buttons: ButtonBuilder[]) {
    this.buttons.push(...buttons);
  }
  /** Add buttons to the row. */
  addComponents(...buttons: ButtonBuilder[]): this {
    this.buttons.push(...buttons);
    return this;
  }
  /** The row as plain data, which is what is sent. */
  toJSON(): APIActionRow {
    return { buttons: this.buttons.map((b) => b.toJSON()) };
  }
}

type Jsonable<T> = T | { toJSON(): T };
export const toJSON = <T>(v: Jsonable<T>): T => (v && typeof (v as { toJSON?: unknown }).toJSON === "function" ? (v as { toJSON(): T }).toJSON() : (v as T));
