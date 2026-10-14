/**
 * End-to-end encryption primitives (src/lib/e2ee/crypto.ts). Also checks that the copies the server
 * and the bot SDK carry are byte-identical, and that a fixed set of vectors still opens, so a change
 * to the wire format cannot go unnoticed.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decryptMessage,
  encryptMessage,
  fingerprintOf,
  formatRecoverySecret,
  fromB64u,
  generateIdentity,
  generateRecoverySecret,
  generateRoomKey,
  makeBackup,
  openBackup,
  parseRecoverySecret,
  toB64u,
  unwrapRoomKey,
  wrapRoomKey,
  type MessageContext,
} from "../../src/lib/e2ee/crypto.ts";
import { VECTORS } from "./e2ee.vectors.mts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let passed = 0;
const failures: string[] = [];
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failures.push(`${name}: ${(e as Error).message}`);
  }
}
function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
async function rejects(p: Promise<unknown>, msg: string) {
  try {
    await p;
  } catch {
    return;
  }
  throw new Error(msg);
}

const ctx: MessageContext = { scope: "conversation", targetId: "conv1", keyId: "key1", authorId: "user1" };

await test("base64url round-trips", () => {
  for (const n of [0, 1, 2, 3, 31, 32, 33, 255]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37) & 255);
    const text = toB64u(bytes);
    assert(!/[+/=]/.test(text), "not url safe");
    assert(toB64u(fromB64u(text)) === text, `length ${n}`);
  }
});

await test("a wrapped room key opens only with the right identity", async () => {
  const alice = await generateIdentity();
  const bob = await generateIdentity();
  const roomKey = generateRoomKey();
  const wrapped = await wrapRoomKey(roomKey, alice.publicKey);
  assert(wrapped.startsWith("w1."), "tag");
  const opened = await unwrapRoomKey(wrapped, alice.privateKey, alice.publicKey);
  assert(toB64u(opened) === toB64u(roomKey), "round trip");
  await rejects(unwrapRoomKey(wrapped, bob.privateKey, bob.publicKey), "bob must not open alice's wrap");
});

await test("two wraps of one key differ", async () => {
  const alice = await generateIdentity();
  const roomKey = generateRoomKey();
  assert((await wrapRoomKey(roomKey, alice.publicKey)) !== (await wrapRoomKey(roomKey, alice.publicKey)), "ephemeral");
});

await test("a message round-trips, with embeds", async () => {
  const roomKey = generateRoomKey();
  const sealed = await encryptMessage(roomKey, { text: "héllo 👋", embeds: [{ title: "t" }] }, ctx);
  assert(sealed.keyId === "key1", "keyId");
  assert(!sealed.ct.includes("llo"), "plaintext leaked");
  const back = await decryptMessage(roomKey, sealed, ctx);
  assert(back.text === "héllo 👋" && (back.embeds as { title: string }[])[0].title === "t", "content");
});

await test("a ciphertext is bound to its room, key and author", async () => {
  const roomKey = generateRoomKey();
  const sealed = await encryptMessage(roomKey, { text: "secret" }, ctx);
  for (const wrong of [
    { ...ctx, targetId: "conv2" },
    { ...ctx, keyId: "key2" },
    { ...ctx, authorId: "user2" },
    { ...ctx, scope: "channel" as const },
  ]) {
    await rejects(decryptMessage(roomKey, sealed, wrong), `opened under ${JSON.stringify(wrong)}`);
  }
  await rejects(decryptMessage(generateRoomKey(), sealed, ctx), "wrong key");
});

await test("a flipped bit is caught", async () => {
  const roomKey = generateRoomKey();
  const sealed = await encryptMessage(roomKey, { text: "secret" }, ctx);
  const ct = fromB64u(sealed.ct);
  ct[0] ^= 1;
  await rejects(decryptMessage(roomKey, { ...sealed, ct: toB64u(ct) }, ctx), "tamper accepted");
});

await test("the recovery backup opens with its secret and not another", async () => {
  const id = await generateIdentity();
  const secret = generateRecoverySecret();
  const backup = await makeBackup(id.privateKey, secret);
  assert((await openBackup(backup, secret)) === id.privateKey, "round trip");
  await rejects(openBackup(backup, generateRecoverySecret()), "wrong secret opened it");
});

await test("a recovery secret survives being written down", () => {
  const secret = generateRecoverySecret();
  const text = formatRecoverySecret(secret);
  assert(/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/.test(text), `shape ${text}`);
  assert(toB64u(parseRecoverySecret(text.toLowerCase().replace(/-/g, " "))) === toB64u(secret), "round trip");
  let threw = false;
  try {
    parseRecoverySecret("ABCD-EFGH");
  } catch {
    threw = true;
  }
  assert(threw, "short secret accepted");
});

await test("fingerprints are stable and differ per key", async () => {
  const a = await generateIdentity();
  const b = await generateIdentity();
  assert((await fingerprintOf(a.publicKey)) === a.fingerprint, "stable");
  assert(a.fingerprint !== b.fingerprint, "distinct");
  assert(/^([0-9a-f]{4} ){7}[0-9a-f]{4}$/.test(a.fingerprint), "shape");
});

await test("fixed vectors still open", async () => {
  const roomKey = await unwrapRoomKey(VECTORS.wrapped, VECTORS.privateKey, VECTORS.publicKey);
  assert(toB64u(roomKey) === VECTORS.roomKey, "wrapped key");
  const back = await decryptMessage(roomKey, VECTORS.envelope, VECTORS.context);
  assert(back.text === VECTORS.text, "message");
  assert((await openBackup(VECTORS.backup, fromB64u(VECTORS.recoverySecret))) === VECTORS.privateKey, "backup");
  assert((await fingerprintOf(VECTORS.publicKey)) === VECTORS.fingerprint, "fingerprint");
});

await test("the server and SDK copies match the client file", () => {
  const source = readFileSync(join(root, "src/lib/e2ee/crypto.ts"), "utf8");
  for (const copy of ["convex/lib/e2eeCrypto.ts", "sdk/bot/e2ee-crypto.ts"]) {
    const path = join(root, copy);
    if (!existsSync(path)) throw new Error(`${copy} is missing`);
    assert(readFileSync(path, "utf8") === source, `${copy} differs from src/lib/e2ee/crypto.ts`);
  }
});

console.log(failures.length ? failures.map((f) => `FAIL ${f}`).join("\n") : `ALL PASSED (${passed})`);
process.exit(failures.length ? 1 : 0);
