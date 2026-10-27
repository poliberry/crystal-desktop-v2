/**
 * POST a blob to a Convex storage upload URL and hand back its storage id.
 *
 * The same three lines were inlined at every upload site; cropping doubled
 * that (a crop and its original are two uploads for one action), so it lives
 * here instead. Callers cast the id to `Id<"_storage">` — this module has no
 * business importing the generated data model.
 */
export async function uploadToStorage(uploadUrl: string, data: Blob): Promise<string> {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": data.type || "application/octet-stream" },
    body: data,
  });
  if (!response.ok) throw new Error("Upload failed.");
  const { storageId } = (await response.json()) as { storageId: string };
  return storageId;
}
