/** A size for people: `88 MB`, `1.5 GB`, and a dash when it isn't known. Free of imports so the wizard's page can use it. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  const text = v >= 100 || u === 0 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
  return `${text} ${units[u]}`;
}
