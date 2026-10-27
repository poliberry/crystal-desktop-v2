/**
 * Prism Launcher can import a modpack from a link: `prismlauncher://import?url=…`
 * hands it the address of a `.mrpack` or `.zip` and it creates the instance.
 *
 * Crystal can't tell whether Prism is installed, so this is offered next to a
 * plain download rather than instead of it: if nothing handles the link, the
 * button does nothing and the download is still there.
 */
export function prismImportUrl(fileUrl: string): string {
  return `prismlauncher://import?url=${encodeURIComponent(fileUrl)}`;
}
