import { REPO, type ChannelDefinition } from "./channels";

/**
 * Looking up a channel's newest published release. Shared by the auto-updater (which only needs the tag) and by the
 * installer (which needs the assets as well), so there is one definition of "newest release for this channel".
 *
 * Deliberately free of `electron` imports: the installer's tests run it in plain Node.
 */

export interface ReleaseAsset {
  name: string;
  /** Bytes. */
  size: number;
  url: string;
}

export interface ReleaseInfo {
  tag: string;
  /** The tag without the channel's prefix: `1.2.3`. */
  version: string;
  assets: ReleaseAsset[];
}

/**
 * Where releases are listed. `CRYSTAL_RELEASES_URL` replaces it — a local server standing in for GitHub's releases API, for
 * trying the installer without a real release — but only in a run from source (`process.defaultApp` is set when Electron is
 * started as `electron <script>` and never in a packaged app). In a shipped build an environment variable must not be able
 * to point the installer at a different server: the hashes it checks come from the same place as the files.
 */
export const releasesUrl = (): string => {
  const override = process.env.CRYSTAL_RELEASES_URL;
  if (override && (process as NodeJS.Process & { defaultApp?: boolean }).defaultApp) return override;
  return `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/releases?per_page=50`;
};

interface GithubRelease {
  tag_name?: string;
  draft?: boolean;
  assets?: { name?: string; size?: number; browser_download_url?: string }[];
}

/**
 * Newest published release for a channel, or null if it has never released.
 *
 * The releases API returns them newest-first, so the first tag carrying the channel's prefix is the one. Drafts are
 * skipped — their assets aren't downloadable — and so is any tag belonging to another channel, which is what keeps a
 * Canary install off PTB's builds. `v` is Stable's prefix and a prefix of nothing else, but the side channels' prefixes
 * are distinct words, so a plain prefix test is enough.
 */
export async function newestRelease(channel: ChannelDefinition, fetchImpl: typeof fetch = fetch): Promise<ReleaseInfo | null> {
  const response = await fetchImpl(releasesUrl(), { headers: { Accept: "application/vnd.github+json", "User-Agent": "crystal-desktop" } });
  if (!response.ok) throw new Error(`GitHub releases API returned ${response.status}.`);
  const releases = (await response.json()) as GithubRelease[];
  for (const release of releases) {
    const tag = release.tag_name;
    if (release.draft || typeof tag !== "string" || !tag.startsWith(channel.tagPrefix)) continue;
    const assets: ReleaseAsset[] = [];
    for (const a of release.assets ?? []) {
      if (typeof a.name === "string" && typeof a.browser_download_url === "string") assets.push({ name: a.name, size: Number(a.size) || 0, url: a.browser_download_url });
    }
    return { tag, version: tag.slice(channel.tagPrefix.length), assets };
  }
  return null;
}
