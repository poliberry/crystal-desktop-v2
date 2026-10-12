import {
  balanceColumns,
  chunk,
  isAcceptableAttachmentSource,
  isKlipyMediaUrl,
  isKlipyStickerAttachment,
  isValidKlipySlug,
  klipyAttachment,
  mergeKlipyPages,
  normalizeKlipyItem,
  normalizeKlipyPage,
} from "../../convex/lib/klipy";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };
const eq = (n: string, got: unknown, want: unknown) => ok(n, JSON.stringify(got) === JSON.stringify(want), { got, want });

const media = (name: string, w: number, h: number, size = 1000) => ({ url: `https://static.klipy.com/ii/abc/14/af/${name}`, width: w, height: h, size });
const sized = (slug: string, extra: Record<string, unknown> = {}) => ({
  id: 1,
  slug,
  title: "Hello",
  file: {
    hd: { gif: media("hd.gif", 498, 498, 4_000_000), webp: media("hd.webp", 498, 498), mp4: media("hd.mp4", 498, 498) },
    md: { gif: media("md.gif", 498, 498, 3_700_000), webp: media("md.webp", 498, 498, 643_490), mp4: media("md.mp4", 498, 498) },
    sm: { gif: media("sm.gif", 220, 220), webp: media("sm.webp", 220, 220, 80_118), mp4: media("sm.mp4", 320, 320) },
    xs: { gif: media("xs.gif", 90, 90), webp: media("xs.webp", 90, 90) },
  },
  type: "gif",
  ...extra,
});

// ---- Where media may come from -------------------------------------------------------------------------------------------
ok("static.klipy.com is KLIPY's", isKlipyMediaUrl("https://static.klipy.com/ii/x/y.gif"));
ok("static1 and static2 are too", isKlipyMediaUrl("https://static1.klipy.com/a.webp") && isKlipyMediaUrl("https://static2.klipy.com/a.webp"));
ok("the .co mirror is too", isKlipyMediaUrl("https://static.klipy.co/ii/x.webp"));
ok("plain http is not", !isKlipyMediaUrl("http://static.klipy.com/a.gif"));
ok("another site is not", !isKlipyMediaUrl("https://evil.test/a.gif"));
ok("a lookalike host is not", !isKlipyMediaUrl("https://static.klipy.com.evil.test/a.gif") && !isKlipyMediaUrl("https://evilstatic.klipy.com/a.gif"));
ok("an address with credentials is not", !isKlipyMediaUrl("https://static.klipy.com@evil.test/a.gif"));
ok("klipy.com itself is a page, not media", !isKlipyMediaUrl("https://klipy.com/gifs/hello"));
ok("junk is not", !isKlipyMediaUrl("not a url") && !isKlipyMediaUrl("") && !isKlipyMediaUrl(null) && !isKlipyMediaUrl(undefined));
ok("a javascript: address is not", !isKlipyMediaUrl("javascript:alert(1)"));

// ---- Slugs ---------------------------------------------------------------------------------------------------------------
ok("a normal slug", isValidKlipySlug("hello-hi-662") && isValidKlipySlug("they-love-me-spider-man"));
ok("a comma would split the items list", !isValidKlipySlug("a,b"));
ok("whitespace, slashes and queries are refused", !isValidKlipySlug("a b") && !isValidKlipySlug("a/b") && !isValidKlipySlug("a?b") && !isValidKlipySlug("a#b"));
ok("empty, huge and non-strings are refused", !isValidKlipySlug("") && !isValidKlipySlug("x".repeat(201)) && !isValidKlipySlug(5) && !isValidKlipySlug(null));

// ---- A GIF ---------------------------------------------------------------------------------------------------------------
const gif = normalizeKlipyItem("gif", sized("hello-hi-662", { blur_preview: "data:image/jpeg;base64,/9j/4AAQ" }))!;
eq("the grid shows the small animated WebP", gif.preview, { url: "https://static.klipy.com/ii/abc/14/af/sm.webp", width: 220, height: 220 });
eq("a message carries the medium WebP", gif.send, { url: "https://static.klipy.com/ii/abc/14/af/md.webp", fileName: "hello-hi-662.webp", fileType: "image/webp", fileSize: 643_490 });
eq("the title is kept", gif.title, "Hello");
eq("a tiny blur preview is kept", gif.blur, "data:image/jpeg;base64,/9j/4AAQ");
ok("a blur preview that is not a data image is dropped", normalizeKlipyItem("gif", sized("a", { blur_preview: "https://evil.test/x.jpg" }))!.blur === undefined);
ok("a blur preview with markup in it is dropped", normalizeKlipyItem("gif", sized("a", { blur_preview: 'data:image/jpeg;base64,AAA");background:url(//evil' }))!.blur === undefined);

const noWebp = sized("old");
delete (noWebp.file.md as Record<string, unknown>).webp;
eq("without a WebP it falls back to the GIF", normalizeKlipyItem("gif", noWebp)!.send.fileType, "image/gif");

const offSite = sized("bad");
(offSite.file.md.webp as { url: string }).url = "https://evil.test/x.webp";
eq("a file on another host is skipped, the next one used", normalizeKlipyItem("gif", offSite)!.send.url, "https://static.klipy.com/ii/abc/14/af/md.gif");

const onlyOffSite = { slug: "x", title: "x", file: { md: { webp: { url: "https://evil.test/x.webp", width: 1, height: 1, size: 1 } } } };
eq("an item with nothing on KLIPY's hosts is dropped", normalizeKlipyItem("gif", onlyOffSite), null);
eq("an item with no sizes is dropped", normalizeKlipyItem("gif", sized("z", { file: {} })), null);
eq("an item with a bad slug is dropped", normalizeKlipyItem("gif", sized("a,b")), null);
eq("a non-object is dropped", normalizeKlipyItem("gif", "nope"), null);
const zero = sized("zero");
(zero.file.sm.webp as { width: number }).width = 0;
eq("a file with no width is not used for the grid", normalizeKlipyItem("gif", zero)!.preview.url, "https://static.klipy.com/ii/abc/14/af/sm.gif");

// ---- A sticker -----------------------------------------------------------------------------------------------------------
const sticker = normalizeKlipyItem("sticker", sized("grrr-rawr-sticker", { type: "sticker" }))!;
eq("a sticker's file name says so", sticker.send.fileName, "sticker-grrr-rawr-sticker.webp");
ok("and it is recognised as one", isKlipyStickerAttachment(sticker.send.fileName, sticker.send.url));
ok("a GIF is not", !isKlipyStickerAttachment(gif.send.fileName, gif.send.url));
ok("a file someone named sticker-… elsewhere is not", !isKlipyStickerAttachment("sticker-x.png", "https://evil.test/x.png"));

// ---- A clip --------------------------------------------------------------------------------------------------------------
const clipRaw = {
  url: "https://klipy.com/clips/they-love-me-spider-man",
  title: "They love me - Spider-man",
  slug: "they-love-me-spider-man",
  file: {
    mp4: "https://static.klipy.com/ii/d0/06/8b/QO60JGjF.mp4",
    gif: "https://static.klipy.com/ii/d0/06/8b/adW975M3.gif",
    webp: "https://static.klipy.com/ii/d0/06/8b/TyGnppPI.webp",
  },
  file_meta: { mp4: { width: 1280, height: 592 }, gif: { width: 320, height: 148 }, webp: { width: 320, height: 148 } },
  type: "clip",
};
const clip = normalizeKlipyItem("clip", clipRaw)!;
eq("a clip shows its animated WebP in the grid", clip.preview, { url: "https://static.klipy.com/ii/d0/06/8b/TyGnppPI.webp", width: 320, height: 148 });
eq("and sends the MP4", clip.send, { url: "https://static.klipy.com/ii/d0/06/8b/QO60JGjF.mp4", fileName: "they-love-me-spider-man.mp4", fileType: "video/mp4", fileSize: 0 });
const noMp4 = { ...clipRaw, file: { gif: clipRaw.file.gif, webp: clipRaw.file.webp } };
eq("a clip with no MP4 sends the WebP", normalizeKlipyItem("clip", noMp4)!.send.fileType, "image/webp");
eq("a clip with no sizes is dropped", normalizeKlipyItem("clip", { ...clipRaw, file_meta: {} }), null);
eq("a clip file on another host is not used", normalizeKlipyItem("clip", { ...clipRaw, file: { ...clipRaw.file, mp4: "https://evil.test/a.mp4" } })!.send.fileType, "image/webp");

// ---- A page --------------------------------------------------------------------------------------------------------------
const page = normalizeKlipyPage("gif", { result: true, data: { data: [sized("a"), sized("b"), { junk: true }, sized("c")], current_page: 1, per_page: 24, has_next: true } });
eq("a page keeps KLIPY's order and skips what it can't show", page.items.map((i) => i.slug), ["a", "b", "c"]);
eq("and says there is more", page.hasNext, true);
eq("the last page says there is not", normalizeKlipyPage("gif", { result: true, data: { data: [sized("a")], has_next: false } }).hasNext, false);
eq("a missing has_next is no more", normalizeKlipyPage("gif", { data: { data: [sized("a")] } }).hasNext, false);
eq("an items response with the array directly under data is read", normalizeKlipyPage("gif", { result: true, data: [sized("a")] }).items.length, 1);
eq("garbage is an empty page", normalizeKlipyPage("gif", null), { items: [], hasNext: false });
eq("so is an error body", normalizeKlipyPage("gif", { result: false, errors: { message: ["nope"] } }), { items: [], hasNext: false });

// ---- Merging pages -------------------------------------------------------------------------------------------------------
const [a, b, c] = ["a", "b", "c"].map((s) => normalizeKlipyItem("gif", sized(s))!);
eq("a repeated result is not shown twice, and the order stands", mergeKlipyPages([a, b], [b, c]).map((i) => i.slug), ["a", "b", "c"]);
eq("the same slug as a different kind is a different item", mergeKlipyPages([a], [normalizeKlipyItem("sticker", sized("a"))!]).length, 2);

// ---- What a message carries ----------------------------------------------------------------------------------------------
eq("an attachment is a link to KLIPY's own file", klipyAttachment(gif), { cdnUrl: gif.send.url, fileName: "hello-hi-662.webp", fileType: "image/webp", fileSize: 643_490 });
ok("and that link is KLIPY's", isKlipyMediaUrl(klipyAttachment(clip).cdnUrl));

// ---- Which attachments a message accepts ---------------------------------------------------------------------------------
ok("an upload is accepted", isAcceptableAttachmentSource({ storageId: "s" }) && isAcceptableAttachmentSource({ cdnKey: "k", cdnUrl: "https://cdn.test/k" }));
ok("a bare KLIPY address is accepted", isAcceptableAttachmentSource({ cdnUrl: gif.send.url }));
ok("a bare address anywhere else is not", !isAcceptableAttachmentSource({ cdnUrl: "https://evil.test/a.gif" }));
ok("nothing at all is not", !isAcceptableAttachmentSource({}));

// ---- Layout --------------------------------------------------------------------------------------------------------------
const tall = { r: 2 }, wide = { r: 0.5 };
const cols = balanceColumns([tall, wide, wide, wide], 2, (i) => i.r);
eq("a tall item fills a column while short ones stack in the other", cols.map((c) => c.length), [1, 3]);
const before = balanceColumns([wide, tall, wide], 2, (i) => i.r);
const after = balanceColumns([wide, tall, wide, tall, wide], 2, (i) => i.r);
ok("the earlier items keep their columns", before.every((col, ci) => col.every((item, k) => after[ci]![k] === item)));
eq("an item with no usable shape counts as square", balanceColumns([{ r: NaN }, { r: 0 }, { r: -1 }], 2, (i) => i.r).map((c) => c.length), [2, 1]);
eq("one column is a list", balanceColumns([1, 2, 3], 1, () => 1), [[1, 2, 3]]);
eq("no columns is one", balanceColumns([1, 2], 0, () => 1), [[1, 2]]);

eq("chunking", chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
eq("chunking nothing", chunk([], 3), []);

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
