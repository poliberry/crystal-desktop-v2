// Run: bun scripts/tests/stickers.test.mts
import { PERMISSIONS as P } from "../../convex/permissions";
import { bitsHas, bitsOr } from "../../convex/lib/permissionBits";
import * as S from "../../convex/lib/stickersPure";

let fails = 0, passes = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? passes++ : fails++; if (!c) console.log("FAIL", n, JSON.stringify(d)); };

// ---- names
ok("lowercases and trims", S.sanitiseStickerName("  Happy_Cat ") === "happy_cat");
ok("odd characters become underscores", S.sanitiseStickerName("hi there!") === "hi_there_");
ok("one character refused", S.stickerNameError("a") !== null);
ok("two characters accepted", S.stickerNameError("ab") === null);
ok("32 characters accepted", S.stickerNameError("a".repeat(32)) === null);
ok("33 characters refused", S.stickerNameError("a".repeat(33)) !== null);
ok("empty refused", S.stickerNameError(S.sanitiseStickerName("   ")) !== null);

// ---- pictures
for (const t of ["image/png", "image/webp", "image/gif", "image/apng", "IMAGE/PNG", "image/png; charset=binary"]) ok(`content type ok: ${t}`, S.isStickerContentType(t), t);
for (const t of ["image/svg+xml", "text/html", "video/mp4", "image/jpeg", ""]) ok(`content type refused: ${t || "(empty)"}`, !S.isStickerContentType(t), t);
ok("key: png", S.isStickerKey("emoji/abc/1-cat.png"));
ok("key: webp url with query", S.isStickerKey("https://cdn.example/emoji/abc/cat.WEBP?x=1"));
ok("key: svg refused", !S.isStickerKey("emoji/abc/cat.svg"));
ok("key: no extension refused", !S.isStickerKey("emoji/abc/cat"));
ok("limit is thirty", S.MAX_STICKER_SLOTS === 30);

// ---- who may remove (high flags must go through the bits helpers)
ok("create expressions sits above bit 30 or is at least testable", bitsHas(bitsOr(0, P.CREATE_EXPRESSIONS), P.CREATE_EXPRESSIONS));
ok("use external stickers is a high flag and not a low-bit alias", P.USE_EXTERNAL_STICKERS > 2 ** 31 && !bitsHas(P.MANAGE_EMOJIS, P.USE_EXTERNAL_STICKERS));
const may = S.mayRemoveSticker;
ok("manager removes anyone's", may({ canManageEmojis: true, canCreateExpressions: false, isUploader: false }));
ok("uploader with create expressions removes own", may({ canManageEmojis: false, canCreateExpressions: true, isUploader: true }));
ok("creator cannot remove someone else's", !may({ canManageEmojis: false, canCreateExpressions: true, isUploader: false }));
ok("uploader who lost create expressions cannot remove own", !may({ canManageEmojis: false, canCreateExpressions: false, isUploader: true }));
ok("nobody-special cannot", !may({ canManageEmojis: false, canCreateExpressions: false, isUploader: false }));

console.log(fails ? `${fails} FAILED, ${passes} passed` : `ALL PASSED (${passes})`);
process.exit(fails ? 1 : 0);
