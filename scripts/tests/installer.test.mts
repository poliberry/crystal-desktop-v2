import { CHANNELS, appIdentity } from "../../electron/channels";
import { releasesUrl } from "../../electron/releases";
import { COMPONENTS, componentDir, defaultBase, desktopEntry, digestMatches, formatBytes, launchTarget, metadataName, nsisArgs, parseMetadata, pickInstaller, productNameFor, safeFileName, unsupportedReason } from "../../electron/installer/core";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });

// Which metadata file lists an app's installers on each platform. These names are what electron-builder writes: `latest*`
// for Crystal, and `studio*` because Studio's feed channel is "studio" (scripts/electron-builder-config.cjs).
eq("crystal win", metadataName("crystal", "win32"), "latest.yml");
eq("crystal mac", metadataName("crystal", "darwin"), "latest-mac.yml");
eq("crystal linux", metadataName("crystal", "linux"), "latest-linux.yml");
eq("studio win", metadataName("studio", "win32"), "studio.yml");
eq("studio mac", metadataName("studio", "darwin"), "studio-mac.yml");
eq("studio linux", metadataName("studio", "linux"), "studio-linux.yml");
eq("studio feed channel agrees", appIdentity(CHANNELS.stable, "studio").feedChannel, "studio");

// A real electron-builder metadata file.
const yml = `version: 1.2.3
files:
  - url: Crystal-1.2.3.zip
    sha512: aGVsbG8=
    size: 100
  - url: Crystal-1.2.3.dmg
    sha512: d29ybGQ=
    size: 200
    blockMapSize: 5
path: Crystal-1.2.3.zip
sha512: aGVsbG8=
releaseDate: '2026-10-09T00:00:00.000Z'
`;
const files = parseMetadata(yml);
eq("parses both files", files.map((x) => x.url), ["Crystal-1.2.3.zip", "Crystal-1.2.3.dmg"]);
eq("keeps size and hash", [files[0].size, files[0].sha512], [100, "aGVsbG8="]);
eq("mac takes the zip, not the dmg", pickInstaller(files, "darwin")?.url, "Crystal-1.2.3.zip");
eq("no installer for another platform", pickInstaller(files, "win32"), null);
eq("windows takes the setup exe", pickInstaller(parseMetadata("files:\n  - url: Crystal-Setup-1.2.3.exe\n    sha512: x\n    size: 1\n"), "win32")?.url, "Crystal-Setup-1.2.3.exe");
eq("linux takes the AppImage", pickInstaller(parseMetadata("files:\n  - url: Crystal-1.2.3.AppImage\n    sha512: x\n    size: 1\n"), "linux")?.url, "Crystal-1.2.3.AppImage");
eq("a url-encoded name still matches", pickInstaller(parseMetadata("files:\n  - url: Crystal%20Studio-1.zip\n    sha512: x\n    size: 1\n"), "darwin")?.url, "Crystal%20Studio-1.zip");
let threw = "";
try { parseMetadata("not: [yaml"); } catch (e) { threw = (e as Error).message; }
eq("garbage metadata is refused, plainly", threw, "The release's file list couldn't be read.");
eq("missing files key is no files", parseMetadata("version: 1\n"), []);
eq("entries without a hash are dropped", parseMetadata("files:\n  - url: a.zip\n"), []);

// Where things go.
eq("win default", defaultBase("win32", { LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" }, "C:\\Users\\a", false), "C:\\Users\\a\\AppData\\Local\\Programs");
eq("win default without the variable", defaultBase("win32", {}, "C:\\Users\\a", false), "C:\\Users\\a\\AppData\\Local\\Programs");
eq("mac default is /Applications when writable", defaultBase("darwin", {}, "/Users/a", true), "/Applications");
eq("mac falls back to ~/Applications", defaultBase("darwin", {}, "/Users/a", false), "/Users/a/Applications");
eq("linux default", defaultBase("linux", {}, "/home/a", true), "/home/a/Applications");
eq("win folder per app", componentDir("win32", "D:\\Apps", "Crystal Studio"), "D:\\Apps\\Crystal Studio");
eq("posix folder per app", componentDir("linux", "/opt/apps", "Crystal"), "/opt/apps/Crystal");
eq("launch win", launchTarget("win32", "D:\\Apps", "Crystal", "Crystal"), "D:\\Apps\\Crystal\\Crystal.exe");
eq("launch mac", launchTarget("darwin", "/Applications", "Crystal Studio", "Crystal-Studio"), "/Applications/Crystal Studio.app");
eq("launch linux", launchTarget("linux", "/home/a/Applications", "Crystal", "Crystal"), "/home/a/Applications/Crystal.AppImage");

// NSIS: silent, and /D last and unquoted.
eq("nsis args", nsisArgs("C:\\Program Files\\Crystal Studio"), ["/S", "/D=C:\\Program Files\\Crystal Studio"]);
ok("/D is the last argument", nsisArgs("x").at(-1)!.startsWith("/D="));

// Names on other channels.
eq("stable names", COMPONENTS.map((c) => productNameFor(CHANNELS.stable, c.kind)), ["Crystal", "Crystal Studio"]);
eq("canary names", COMPONENTS.map((c) => productNameFor(CHANNELS.canary, c.kind)), ["Crystal Canary", "Crystal Studio Canary"]);

// Platform support.
eq("apple silicon is fine", unsupportedReason("darwin", "arm64"), null);
ok("intel mac is refused, with a reason", /Apple Silicon/.test(unsupportedReason("darwin", "x64") ?? ""));
eq("windows x64", unsupportedReason("win32", "x64"), null);
ok("32-bit windows refused", unsupportedReason("win32", "ia32") !== null);

// Integrity.
ok("equal digests match", digestMatches("abc=", "abc="));
ok("different digests do not", !digestMatches("abc=", "abd="));
ok("different lengths do not", !digestMatches("abc=", "abc"));
ok("empty never matches a real one", !digestMatches("", "abc="));

// A file name from a release can't escape the download folder.
eq("plain name kept", safeFileName("Crystal-1.zip"), "Crystal-1.zip");
eq("path stripped", safeFileName("../../etc/passwd"), "passwd");
eq("backslash path stripped", safeFileName("..\\..\\evil.exe"), "evil.exe");
eq("device characters replaced", safeFileName('a:b*c?.zip'), "a_b_c_.zip");
eq("leading dots replaced", safeFileName("..hidden"), "_hidden");
eq("empty becomes a name", safeFileName(""), "download");

// Sizes.
eq("bytes", formatBytes(512), "512 B");
eq("megabytes", formatBytes(88 * 1024 * 1024), "88 MB");
eq("fractional gigabytes", formatBytes(1.5 * 1024 ** 3), "1.5 GB");
eq("unknown size", formatBytes(0), "—");

// The Linux launcher.
const entry = desktopEntry({ name: "Crystal Studio", comment: "Create", exec: "/home/a/My Apps/Crystal-Studio.AppImage", icon: "crystal-studio", scheme: "crystal-studio", wmClass: "Crystal Studio" });
ok("entry quotes a path with a space", entry.includes('Exec="/home/a/My Apps/Crystal-Studio.AppImage" %U'));
ok("entry registers the scheme", entry.includes("MimeType=x-scheme-handler/crystal-studio;"));
ok("entry is a launcher", entry.startsWith("[Desktop Entry]\nType=Application\n"));
ok("quotes and dollars in a path are escaped", desktopEntry({ name: "n", comment: "c", exec: '/a/"b"$c', icon: "i", scheme: "s", wmClass: "w" }).includes('Exec="/a/\\"b\\"\\$c" %U'));

// The release server can only be redirected in a run from source. In a shipped installer the hashes it checks come from
// the same place as the files, so an environment variable must never be able to point it somewhere else.
const proc = process as NodeJS.Process & { defaultApp?: boolean };
const GITHUB = "https://api.github.com/repos/poliberry/crystal-desktop-v2/releases?per_page=50";
const savedUrl = process.env.CRYSTAL_RELEASES_URL;
const savedDefault = proc.defaultApp;
delete process.env.CRYSTAL_RELEASES_URL;
proc.defaultApp = true;
eq("no override: GitHub", releasesUrl(), GITHUB);
process.env.CRYSTAL_RELEASES_URL = "http://localhost:4555/releases";
eq("run from source: the override is honoured", releasesUrl(), "http://localhost:4555/releases");
proc.defaultApp = undefined;
eq("shipped build: the override is ignored", releasesUrl(), GITHUB);
proc.defaultApp = false;
eq("defaultApp false is the same as shipped", releasesUrl(), GITHUB);
if (savedUrl === undefined) delete process.env.CRYSTAL_RELEASES_URL; else process.env.CRYSTAL_RELEASES_URL = savedUrl;
proc.defaultApp = savedDefault;

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
