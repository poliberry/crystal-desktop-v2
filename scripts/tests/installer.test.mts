import { CHANNELS, appIdentity } from "../../electron/channels";
import { releasesUrl } from "../../electron/releases";
import { AUR_TOOLS, COMPONENTS, appleScriptString, aurSnapshotUrl, chooseAur, componentDir, defaultBase, desktopEntry, digestMatches, formatBytes, installBundleScript, isArchLike, launchTarget, metadataName, needsAdmin, nsisArgs, parseMetadata, pickInstaller, productNameFor, removeBundleScript, safeFileName, shellQuote, unsupportedReason } from "../../electron/installer/core";
import { debName, pkgbuild } from "../make-pkgbuild.mjs";
import { spawnSync } from "node:child_process";

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

// ---- Arch Linux: which machines install from the AUR ------------------------------------------------------------------
const ARCH = 'NAME="Arch Linux"\nID=arch\nBUILD_ID=rolling\n';
const MANJARO = 'NAME="Manjaro Linux"\nID=manjaro\nID_LIKE=arch\n';
const CACHY = 'ID=cachyos\nID_LIKE="arch"\n';
const UBUNTU = 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n';
ok("Arch is Arch", isArchLike(ARCH));
ok("Manjaro names arch in ID_LIKE", isArchLike(MANJARO));
ok("a quoted ID_LIKE still counts", isArchLike(CACHY));
ok("ID_LIKE can list several families", isArchLike("ID=foo\nID_LIKE=\"debian arch\"\n"));
ok("Ubuntu is not Arch", !isArchLike(UBUNTU));
ok("a distro merely named like it is not Arch", !isArchLike("ID=archaic\nNAME=\"Arch-ish\"\n"));
ok("an empty file is not Arch", !isArchLike(""));
ok("a NAME of Arch doesn't count without the ID", !isArchLike('NAME="Arch Linux"\nID=something\n'));

const everything = () => true;
const stable = CHANNELS.stable;
const aurOk = { platform: "linux" as const, arch: "x64", osRelease: ARCH, channel: stable, have: everything };
eq("Arch, Stable, tools present: AUR", chooseAur(aurOk), { use: true, missing: [] });
eq("not Linux: no", chooseAur({ ...aurOk, platform: "darwin" }).use, false);
eq("not Arch: no", chooseAur({ ...aurOk, osRelease: UBUNTU }).use, false);
eq("Intel only: arm64 gets the AppImage path", chooseAur({ ...aurOk, arch: "arm64" }).use, false);
eq("only Stable is in the AUR (Canary)", chooseAur({ ...aurOk, channel: CHANNELS.canary }).use, false);
eq("only Stable is in the AUR (PTB)", chooseAur({ ...aurOk, channel: CHANNELS.ptb }).use, false);
eq("forced to the AppImage", chooseAur({ ...aurOk, forced: "appimage" }).use, false);
const noFakeroot = chooseAur({ ...aurOk, have: (c) => c !== "fakeroot" && c !== "pkexec" });
eq("a missing tool falls back, and says which", [noFakeroot.use, noFakeroot.missing], [false, ["fakeroot", "pkexec"]]);
ok("every tool it needs is checked", AUR_TOOLS.every((t) => chooseAur({ ...aurOk, have: (c) => c !== t }).missing.includes(t)));
eq("the recipe comes from the AUR's snapshot", aurSnapshotUrl("crystal-desktop-bin"), "https://aur.archlinux.org/cgit/aur.git/snapshot/crystal-desktop-bin.tar.gz");
eq("a package name can't alter the path", aurSnapshotUrl("a/../b"), "https://aur.archlinux.org/cgit/aur.git/snapshot/a%2F..%2Fb.tar.gz");

// The names are the one thing the workflow, the installer and the app all have to agree on.
const crystalId = appIdentity(stable, "crystal");
const studioId = appIdentity(stable, "studio");
eq("Crystal's AUR package", [crystalId.aurPackage, crystalId.aurBinary], ["crystal-desktop-bin", "crystal-desktop"]);
eq("Studio's AUR package", [studioId.aurPackage, studioId.aurBinary], ["crystal-studio-bin", "crystal-studio"]);
ok("no command is called `crystal` (Arch's own package owns /usr/bin/crystal)", ![crystalId, studioId].some((i) => i.aurBinary === "crystal"));
ok("no side channel has an AUR package", (["ptb", "canary", "development"] as const).every((c) => appIdentity(CHANNELS[c], "crystal").aurPackage === null && appIdentity(CHANNELS[c], "studio").aurPackage === null));
ok("side channels' commands can't clash with Stable's", (["ptb", "canary", "development"] as const).every((c) => ![appIdentity(CHANNELS[c], "crystal").aurBinary, appIdentity(CHANNELS[c], "studio").aurBinary].some((b) => b === crystalId.aurBinary || b === studioId.aurBinary)));

// ---- The PKGBUILD the release workflow publishes -----------------------------------------------------------------------
const SUM = "ab".repeat(32);
const pc = pkgbuild({ app: "crystal", version: "1.2.3", sha256: SUM });
const ps = pkgbuild({ app: "studio", version: "1.2.3", sha256: SUM });
ok("Crystal's recipe is for its package", pc.includes("pkgname=crystal-desktop-bin\n") && pc.includes("pkgver=1.2.3\n"));
ok("Studio's recipe is for its package", ps.includes("pkgname=crystal-studio-bin\n"));
ok("the checksum is the one given", pc.includes(`sha256sums=('${SUM}')`));
ok("it downloads the release's .deb by tag and name", pc.includes("/releases/download/v${pkgver}/Crystal-${pkgver}.deb") && ps.includes("/releases/download/v${pkgver}/Crystal-Studio-${pkgver}.deb"));
ok("the file it fetches is the file the release names", debName("crystal", "1.2.3") === "Crystal-1.2.3.deb" && debName("studio", "1.2.3") === "Crystal-Studio-1.2.3.deb");
ok("it links the command from the package's own names", pc.includes("/usr/bin/crystal-desktop") && ps.includes("/usr/bin/crystal-studio\""));
ok("it never installs a command called crystal", !/usr\/bin\/crystal"/.test(pc) && !/usr\/bin\/crystal"/.test(ps));
ok("no placeholder is left in it", !/@[A-Z0-9]+@/.test(pc + ps));
for (const [name, text] of [["Crystal", pc], ["Studio", ps]] as const) {
  const r = spawnSync("bash", ["-n"], { input: text, encoding: "utf8" });
  ok(`${name}'s PKGBUILD is valid bash`, r.status === 0, r.stderr);
}
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
ok("not a release version", throws(() => pkgbuild({ app: "crystal", version: "1.2", sha256: SUM })));
ok("a version can't carry shell", throws(() => pkgbuild({ app: "crystal", version: "1.2.3; rm -rf /", sha256: SUM })));
ok("not a checksum", throws(() => pkgbuild({ app: "crystal", version: "1.2.3", sha256: "xyz" })));
ok("a checksum can't carry shell", throws(() => pkgbuild({ app: "crystal", version: "1.2.3", sha256: "$(id)".padEnd(64, "a") })));
ok("an unknown app", throws(() => pkgbuild({ app: "other", version: "1.2.3", sha256: SUM })));
ok("a template asking for something unknown fails", throws(() => pkgbuild({ app: "crystal", version: "1.2.3", sha256: SUM, template: "x=@NOPE@" })));

// ---- Running things as root on a Mac: what reaches `rm -rf` -----------------------------------------------------------
eq("shell quoting survives a quote", shellQuote("it's"), `'it'\\''s'`);
eq("AppleScript quoting escapes quotes and backslashes", appleScriptString('a"b\\c'), '"a\\"b\\\\c"');
ok("EACCES needs an administrator", needsAdmin("EACCES: permission denied, rmdir '/Applications/Crystal.app'"));
ok("the ENOTEMPTY from the bug report does too", needsAdmin("ENOTEMPTY: directory not empty, rmdir '/var/folders/x/crystal-installer-k/extract-crystal/Crystal.app/Contents/Resources'"));
ok("running out of disk does not", !needsAdmin("ENOSPC: no space left on device"));
ok("it will remove an installed app", removeBundleScript("/Applications/Crystal.app").includes("rm -rf '/Applications/Crystal.app'"));
for (const bad of ["/", "/Applications", "Applications/Crystal.app", "/Applications/Crystal", "/Applications/../Crystal.app", "/Crystal.app", ""]) {
  ok(`it refuses to run as root on "${bad}"`, throws(() => removeBundleScript(bad)));
}
ok("an install replaces, copies, then hands the app back to the person", (() => { const t = installBundleScript("/tmp/x/Crystal.app", "/Applications/Crystal.app", { uid: 501, gid: 20 }); return t.indexOf("rm -rf") < t.indexOf("ditto") && t.indexOf("ditto") < t.indexOf("chown -R 501:20"); })());

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
