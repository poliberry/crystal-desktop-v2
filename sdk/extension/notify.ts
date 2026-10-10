/** Show a short notice inside Crystal (up to 200 characters, five a minute). Needs the "Show notices" power. */
export async function notify(text: string): Promise<void> {
  await crystal.notify(text);
}
