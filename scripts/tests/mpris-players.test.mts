import {
  classifyProcess,
  isBrowserPlayback,
  parseBusctlPid,
  parseBusctlString,
  parseInstancePid,
  pickDisplayName,
  processExecutableName,
} from "../../electron/mprisPlayers";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

const OWN_PID = 4000;
const ownExeKeys = ["crystal", "crystalptb", "crystalcanary", "crystaldevelopment"];
const verdict = (pid: number, identity: { exe?: string; argv0?: string }) =>
  classifyProcess({ pid, ownPid: OWN_PID, identity, ownExeKeys });

// The bug: Chromium registers every Chromium-based process as `chromium.instance<PID>`, so the name
// alone can't separate Chrome from an Electron YouTube Music client. The name still looks like a
// browser, which is why the process has to be consulted.
ok("a chromium.instance name looks like a browser", isBrowserPlayback("chromium.instance12345"));
ok("spotify does not", !isBrowserPlayback("spotify"));

// What the process says.
ok("Electron YouTube Music client is allowed", verdict(100, { exe: "/opt/YouTube Music/youtube-music" }) === "allow");
ok("an unpackaged electron host is allowed", verdict(100, { exe: "/usr/lib/electron/electron" }) === "allow");
ok("Google Chrome is a browser", verdict(101, { exe: "/opt/google/chrome/chrome" }) === "browser");
ok("Brave is a browser", verdict(102, { exe: "/opt/brave.com/brave/brave" }) === "browser");
ok("Firefox is a browser", verdict(103, { exe: "/usr/lib/firefox/firefox" }) === "browser");
ok("Edge is a browser", verdict(104, { exe: "/opt/microsoft/msedge/msedge" }) === "browser");
ok("Chromium is a browser", verdict(105, { exe: "/usr/lib/chromium/chromium" }) === "browser");
ok("a replaced binary still reads as a browser", verdict(106, { exe: "/opt/google/chrome/chrome (deleted)" }) === "browser");
ok("argv[0] also catches a browser behind a generic exe", verdict(107, { exe: "/usr/bin/wrapper", argv0: "/usr/bin/vivaldi-stable" }) === "browser");

// Us.
ok("our own pid is ours, whatever the exe", verdict(OWN_PID, { exe: "/usr/lib/electron/electron" }) === "own");
ok("a packaged Crystal executable is ours", verdict(5000, { exe: "/opt/Crystal Canary/Crystal Canary" }) === "own");
ok("Crystal Studio is ours too", verdict(5001, { exe: "/opt/Crystal Studio/crystal-studio" }) === "own");
ok("an AppImage of Crystal is ours", verdict(5002, { exe: "/tmp/.mount_abc/Crystal-PTB" }) === "own");

// Can't tell → never allowed through.
ok("no readable exe or argv is unknown", verdict(200, {}) === "unknown");
ok("a Flatpak proxy says nothing about the app", verdict(201, { exe: "/usr/bin/xdg-dbus-proxy" }) === "unknown");
ok("neither does bwrap", verdict(202, { exe: "/usr/bin/bwrap" }) === "unknown");

// A non-dumpable process hides /proc/<pid>/exe but not its cmdline.
ok("argv[0] stands in when exe is unreadable", verdict(300, { argv0: "/opt/YouTube Music/youtube-music" }) === "allow");
ok("…and still catches a browser", verdict(301, { argv0: "/opt/google/chrome/chrome" }) === "browser");
ok("executable name prefers exe", processExecutableName({ exe: "/a/real", argv0: "/b/other" }) === "real");
ok("executable name falls back to argv[0]", processExecutableName({ argv0: "/b/other" }) === "other");
ok("no identity, no name", processExecutableName({}) === undefined);

// Pids from the two places they come from.
ok("chromium instance pid", parseInstancePid("chromium.instance12345") === 12345);
ok("firefox instance pid", parseInstancePid("firefox.instance_4242_7") === 4242);
ok("no instance suffix, no pid", parseInstancePid("spotify") === undefined);
ok("busctl pid", parseBusctlPid("u 8123\n") === 8123);
ok("busctl garbage", parseBusctlPid("Failed to call method") === undefined);
ok("busctl zero is not a pid", parseBusctlPid("u 0") === undefined);

// Naming the player. `Identity` for an Electron client is often just the framework's name.
ok("busctl string", parseBusctlString('s "YouTube Music"\n') === "YouTube Music");
ok("busctl string with escapes", parseBusctlString('s "a \\"b\\""') === 'a "b"');
ok("busctl non-string", parseBusctlString("u 5") === undefined);
ok("busctl empty string", parseBusctlString('s ""') === undefined);
ok("a real identity wins", pickDisplayName(["YouTube Music", "youtube-music", "youtube-music"]) === "YouTube Music");
ok("the framework's name is skipped", pickDisplayName(["Chromium", "chromium", "youtube-music"]) === "youtube-music");
ok("electron is skipped", pickDisplayName(["Electron", undefined, "pear-desktop"]) === "pear-desktop");
ok("nothing usable gives nothing", pickDisplayName(["Chromium", undefined, ""]) === undefined);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
