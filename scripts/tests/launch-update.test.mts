import { downloadStatus, INSTALL_RETRY_AFTER_MS, parseAttempt, shouldAutoInstall } from "../../electron/launchUpdate";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, d === undefined ? "" : JSON.stringify(d))); };

const now = 1_800_000_000_000;
ok("no version, nothing to install", !shouldAutoInstall(null, null, now));
ok("a new version with no history installs", shouldAutoInstall("1.2.3", null, now));
ok("a different version than the last attempt installs", shouldAutoInstall("1.2.4", { version: "1.2.3", at: now - 1000 }, now));
ok("the same version just tried is left alone", !shouldAutoInstall("1.2.3", { version: "1.2.3", at: now - 1000 }, now));
ok("the same version is tried again after the cooldown", shouldAutoInstall("1.2.3", { version: "1.2.3", at: now - INSTALL_RETRY_AFTER_MS }, now));

ok("parseAttempt reads a good record", JSON.stringify(parseAttempt('{"version":"1.0.0","at":5}')) === '{"version":"1.0.0","at":5}');
ok("parseAttempt rejects junk", parseAttempt("not json") === null && parseAttempt('{"version":1}') === null && parseAttempt("null") === null);

ok("status with a percent", downloadStatus("1.2.3", 40) === "Downloading v1.2.3 — 40%");
ok("status without a percent", downloadStatus(null, null) === "Downloading update…");

console.log(f ? `\n${f} FAILED, ${p} passed` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
