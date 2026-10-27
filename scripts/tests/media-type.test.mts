import { attachmentKind, effectiveFileType, typeForUpload } from "../../convex/lib/mediaType";

let f = 0, p = 0;
const ok = (n: string, c: boolean, d?: unknown) => { c ? p++ : (f++, console.log("FAIL", n, JSON.stringify(d))); };

// The reported bug: files stored with no useful type must still be sound and video.
for (const [name, type, kind] of [
  ["voice.wav", "application/octet-stream", "audio"],
  ["voice.WAV", "", "audio"],
  ["clip.mov", "application/octet-stream", "video"],
  ["clip.MOV", "", "video"],
  ["song.m4a", "", "audio"],
  ["take.mkv", "", "video"],
  ["photo.jpeg", "", "image"],
  ["a.bin", "application/octet-stream", "file"],
  ["tone.aiff", "", "file"],
  ["tone.caf", "application/octet-stream", "file"],
  ["old.avi", "", "file"],
  ["notes", "", "file"],
  ["archive.zip", "application/zip", "file"],
  // A real type is trusted over the extension.
  ["voice.wav", "audio/x-wav", "audio"],
  ["clip.mov", "video/quicktime", "video"],
  ["renamed.wav", "image/png", "image"],
  ["weird.mov", "application/pdf", "file"],
] as const) {
  ok(`${name} (${type || "no type"}) → ${kind}`, attachmentKind(type, name) === kind, attachmentKind(type, name));
}

ok(".wav gets audio/wav", effectiveFileType("", "x.wav") === "audio/wav");
ok(".mov gets video/quicktime", effectiveFileType("application/octet-stream", "x.mov") === "video/quicktime");
ok("a known type is kept as given (lower-cased)", effectiveFileType("Audio/X-WAV", "x.wav") === "audio/x-wav");
ok("an unknown extension stays octet-stream", effectiveFileType("", "x.xyz") === "application/octet-stream");
ok("null and undefined are handled", effectiveFileType(null, "a.mp4") === "video/mp4" && effectiveFileType(undefined, "a") === "application/octet-stream");
ok("typeForUpload repairs a picked file", typeForUpload({ type: "", name: "Recording 1.wav" }) === "audio/wav");

console.log(f ? `${f} FAILED (${p} passed)` : `ALL PASSED (${p})`);
process.exit(f ? 1 : 0);
