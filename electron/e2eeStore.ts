import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { app, ipcMain, safeStorage } from "electron";

/**
 * Where the end-to-end encryption identity key lives on this computer (docs/E2EE.md, "Key hierarchy").
 *
 * The renderer hands over a small JSON string (public and private key); it is encrypted with the
 * operating system's keystore through `safeStorage` (Keychain, DPAPI, libsecret/kwallet) and written
 * under userData, one file per account. The page never learns where, and a copy of the file is useless
 * on another machine or another OS account.
 *
 * When there is no keystore to lean on, nothing is written: a key saved in plain text would give the
 * appearance of protection and none of it. The renderer is told (`set` answers `false`) and keeps the
 * key in memory for the session; the person then enters their recovery key on the next launch.
 */

/** A PKCS8 P-256 key and the public key in base64url, with the JSON around them, is about 400 bytes. */
const MAX_VALUE = 8192;

let warned = false;

function usable(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  // Linux without a secret service falls back to a fixed password: that is plain text with extra steps.
  if (process.platform === "linux") {
    const backend = (safeStorage as unknown as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.();
    if (backend === "basic_text") return false;
  }
  return true;
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn(
    "[e2ee] The operating system keystore is not available (safeStorage), so the encryption key is not saved on this computer. " +
      "The recovery key will be asked for on every launch.",
  );
}

/** The account id is the page's to choose, so it only ever names a file through a hash. */
function fileFor(userId: string): string {
  const name = createHash("sha256").update(userId).digest("hex").slice(0, 32);
  return path.join(app.getPath("userData"), "e2ee", `${name}.bin`);
}

const isId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 256;

export function registerE2eeStore(): void {
  ipcMain.handle("e2ee:store:available", () => {
    const ok = usable();
    if (!ok) warnOnce();
    return ok;
  });

  ipcMain.handle("e2ee:store:get", (_event, userId: unknown): string | null => {
    if (!isId(userId) || !usable()) return null;
    try {
      return safeStorage.decryptString(fs.readFileSync(fileFor(userId)));
    } catch {
      // Not saved yet, or saved under a keystore that has since changed. Either way: ask for the recovery key.
      return null;
    }
  });

  ipcMain.handle("e2ee:store:set", (_event, userId: unknown, value: unknown): boolean => {
    if (!isId(userId) || typeof value !== "string" || value.length === 0 || value.length > MAX_VALUE) return false;
    if (!usable()) {
      warnOnce();
      return false;
    }
    const file = fileFor(userId);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    // Written aside and renamed: a crash halfway must not leave a truncated file that replaces a good key.
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, safeStorage.encryptString(value), { mode: 0o600 });
    fs.renameSync(tmp, file);
    return true;
  });

  ipcMain.handle("e2ee:store:clear", (_event, userId: unknown): void => {
    if (!isId(userId)) return;
    fs.rmSync(fileFor(userId), { force: true });
  });
}
