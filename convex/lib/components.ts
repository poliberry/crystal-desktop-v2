/**
 * Buttons on a bot's message, as Discord's message components: rows of up to five, up to five rows.
 * A button either carries a `customId` that comes back to the bot as an event when someone presses
 * it, or a link that opens in the browser. Rebuilt field by field from whatever the bot sent, like
 * `embeds.ts`: nothing here is stored as it arrived.
 */

export const COMPONENT_LIMITS = { rows: 5, buttonsPerRow: 5, label: 80, customId: 100, url: 2000 } as const;

export type ButtonStyle = "primary" | "secondary" | "success" | "danger" | "link";
export interface Button {
  customId?: string;
  label: string;
  style: ButtonStyle;
  url?: string;
  emoji?: string;
  disabled?: boolean;
}
export interface ActionRow {
  buttons: Button[];
}

const STYLES: readonly ButtonStyle[] = ["primary", "secondary", "success", "danger", "link"];
// eslint-disable-next-line no-control-regex
const BAD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u202a-\u202e\u2066-\u2069]/g;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validateComponents(input: unknown): ActionRow[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw new Error("Components have to be a list of rows.");
  if (input.length > COMPONENT_LIMITS.rows) throw new Error(`A message can have up to ${COMPONENT_LIMITS.rows} rows of buttons.`);
  const ids = new Set<string>();
  return input.map((row, i) => {
    if (!isObj(row) || !Array.isArray(row.buttons)) throw new Error(`Row ${i + 1} needs a list of buttons.`);
    if (row.buttons.length < 1 || row.buttons.length > COMPONENT_LIMITS.buttonsPerRow) throw new Error(`Row ${i + 1} holds 1 to ${COMPONENT_LIMITS.buttonsPerRow} buttons.`);
    return {
      buttons: row.buttons.map((b, j): Button => {
        const where = `Button ${j + 1} in row ${i + 1}`;
        if (!isObj(b)) throw new Error(`${where} isn't an object.`);
        const style = (b.style ?? "secondary") as ButtonStyle;
        if (!STYLES.includes(style)) throw new Error(`${where} has an unknown style.`);
        const label = typeof b.label === "string" ? b.label.replace(BAD, "").trim() : "";
        const emoji = typeof b.emoji === "string" ? b.emoji.replace(BAD, "").trim().slice(0, 64) : "";
        if (!label && !emoji) throw new Error(`${where} needs a label or an emoji.`);
        if (label.length > COMPONENT_LIMITS.label) throw new Error(`${where}'s label is up to ${COMPONENT_LIMITS.label} characters.`);
        const out: Button = { label, style };
        if (emoji) out.emoji = emoji;
        if (b.disabled === true) out.disabled = true;
        if (style === "link") {
          if (typeof b.url !== "string" || b.url.length > COMPONENT_LIMITS.url) throw new Error(`${where} needs an address.`);
          let u: URL;
          try {
            u = new URL(b.url.trim());
          } catch {
            throw new Error(`${where}'s address isn't valid.`);
          }
          if (u.protocol !== "https:" || u.username || u.password) throw new Error(`${where}'s address has to be https.`);
          if (b.customId !== undefined) throw new Error(`${where} is a link, so it can't also have a customId.`);
          out.url = u.href;
        } else {
          if (typeof b.customId !== "string" || !/^[\w .:/#@-]{1,100}$/.test(b.customId)) throw new Error(`${where} needs a customId of up to ${COMPONENT_LIMITS.customId} letters, numbers or . : / - _ # @.`);
          if (b.url !== undefined) throw new Error(`${where} isn't a link, so it can't have an address.`);
          if (ids.has(b.customId)) throw new Error(`Two buttons share the customId “${b.customId}”.`);
          ids.add(b.customId);
          out.customId = b.customId;
        }
        return out;
      }),
    };
  });
}
