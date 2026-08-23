/**
 * Cropping an animated image without flattening it to one frame.
 *
 * The crop editor renders its result with `drawImage` into a canvas, which is
 * exactly one frame — so when adjusting and cropping arrived, animated avatars
 * and banners quietly became stills. This module is the animated path: decode
 * every frame of the source with `ImageDecoder`, apply the same crop to each,
 * and re-assemble them into an animated WebP.
 *
 * Why animated WebP and not "keep the original and crop with CSS": the crop
 * has to end up in the *file*. `imageUrl` is read by a few dozen places — call
 * tiles, message rows, the tray, notifications — and threading a crop rectangle
 * through all of them so each could re-apply it is a far bigger change than
 * encoding the crop once, here.
 *
 * Why the muxing is hand-rolled: the browser will happily *decode* animation
 * and happily encode a *still* WebP, but there's no API for encoding an
 * animated one. An animated WebP, though, is little more than a RIFF container
 * holding one still WebP bitstream per frame — so each frame goes through
 * `convertToBlob`, and `muxAnimatedWebp` wraps the bitstreams it produces.
 * See https://developers.google.com/speed/webp/docs/riff_container.
 */

/** Frames past this are dropped (evenly, keeping the animation's real speed —
 * see `frameStride`). A 512px avatar is ~15-30 KB per frame, so an unbounded
 * frame count is how you get a 40 MB avatar. */
const MAX_FRAMES = 150;

/** Per-frame encoder quality. Lower than the still path's 0.92 because this
 * multiplies by the frame count. */
const FRAME_QUALITY = 0.8;

/** Frames with no duration (or an implausibly short one) get this, matching
 * what browsers do with the same GIFs. */
const DEFAULT_FRAME_MS = 100;
const MIN_FRAME_MS = 20;

/** Refuse to produce an avatar/banner bigger than this. */
export const MAX_ANIMATED_BYTES = 8 * 1024 * 1024;

// --- WebCodecs -------------------------------------------------------------
// `ImageDecoder` isn't in TypeScript's DOM library yet, and only the handful of
// members used here are worth describing.

interface DecodedFrame {
  /** Frame duration in *microseconds*, or null if the format doesn't say. */
  readonly duration: number | null;
  close(): void;
}

interface ImageTrack {
  readonly animated: boolean;
  readonly frameCount: number;
}

interface ImageTrackListLike {
  /** Resolves once the container's tracks have been parsed. `selectedTrack` is
   * null until it does — including after `completed` resolves. */
  readonly ready: Promise<void>;
  readonly selectedTrack: ImageTrack | null;
}

interface ImageDecoderLike {
  readonly completed: Promise<void>;
  readonly tracks: ImageTrackListLike;
  decode(options?: { frameIndex?: number }): Promise<{ image: DecodedFrame }>;
  close(): void;
}

interface ImageDecoderConstructor {
  new (init: { data: ArrayBuffer | ArrayBufferView; type: string }): ImageDecoderLike;
  isTypeSupported(type: string): Promise<boolean>;
}

function imageDecoderConstructor(): ImageDecoderConstructor | undefined {
  return (globalThis as { ImageDecoder?: ImageDecoderConstructor }).ImageDecoder;
}

// --- Probing ---------------------------------------------------------------

export interface AnimatedSource {
  /** The source bytes, fetched once so the crop doesn't re-download them. */
  data: ArrayBuffer;
  /** MIME type the decoder was created with. */
  type: string;
  /** Frames in the source, before any dropping. */
  frameCount: number;
}

/**
 * The container's real type, for a blob that arrived without one.
 *
 * A `File` from a picker has a type; a blob fetched back from storage only has
 * whatever content type it was uploaded with, which for an old upload may be
 * nothing at all. The magic bytes are unambiguous, so read those instead of
 * trusting a filename.
 */
function sniffImageType(bytes: Uint8Array): string | null {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + length));

  if (bytes.length >= 6 && ascii(0, 4) === "GIF8") return "image/gif";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    return "image/webp";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(1, 3) === "PNG"
  ) {
    // An APNG is a PNG with an `acTL` chunk before the first frame. Chromium
    // only reports multiple frames when asked for image/apng, so the
    // distinction matters.
    const head = ascii(8, Math.min(bytes.length - 8, 4096));
    return head.includes("acTL") ? "image/apng" : "image/png";
  }
  return null;
}

async function toArrayBuffer(source: File | string): Promise<{ data: ArrayBuffer; type: string }> {
  if (typeof source !== "string") {
    return { data: await source.arrayBuffer(), type: source.type };
  }
  const response = await fetch(source);
  if (!response.ok) throw new Error("Couldn't re-read that image.");
  const blob = await response.blob();
  return { data: await blob.arrayBuffer(), type: blob.type };
}

/**
 * Whether this source is actually animated, and the bytes to crop if it is.
 *
 * Returns null — rather than throwing — for a still image, an unsupported
 * container, or a browser without `ImageDecoder`: every one of those means
 * "take the ordinary single-frame path", which is a valid answer and not an
 * error the user needs to see.
 */
export async function probeAnimation(source: File | string): Promise<AnimatedSource | null> {
  const ImageDecoder = imageDecoderConstructor();
  if (!ImageDecoder) return null;

  const { data, type } = await toArrayBuffer(source);
  const resolvedType = sniffImageType(new Uint8Array(data)) ?? type;
  if (!resolvedType || !(await ImageDecoder.isTypeSupported(resolvedType))) return null;

  const decoder = new ImageDecoder({ data, type: resolvedType });
  try {
    // Both waits are needed: `tracks.ready` is what populates `selectedTrack`,
    // and `completed` is what makes its frame count final.
    await decoder.tracks.ready;
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated || track.frameCount <= 1) return null;
    return { data, type: resolvedType, frameCount: track.frameCount };
  } catch {
    // A container this browser can name but not parse. Still images are the
    // safe fallback.
    return null;
  } finally {
    decoder.close();
  }
}

/** Keep every nth frame, so a long animation loses frames evenly instead of
 * being truncated halfway through. */
function frameStride(frameCount: number): number {
  return Math.ceil(frameCount / MAX_FRAMES);
}

// --- RIFF writing ----------------------------------------------------------

function fourCC(tag: string): Uint8Array {
  return new Uint8Array([tag.charCodeAt(0), tag.charCodeAt(1), tag.charCodeAt(2), tag.charCodeAt(3)]);
}

function uint32LE(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]);
}

function uint24LE(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
}

/** A RIFF chunk: fourCC, little-endian payload size, payload, and a pad byte
 * when that size is odd. */
function chunk(tag: string, payload: Uint8Array): Uint8Array[] {
  const parts = [fourCC(tag), uint32LE(payload.length), payload];
  if (payload.length % 2 === 1) parts.push(new Uint8Array(1));
  return parts;
}

// Returning the buffer-backed form (rather than the `ArrayBufferLike` default)
// keeps the result usable as a `BlobPart` without a cast.
function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** One frame's compressed bitstream, pulled out of a still WebP. */
interface FrameBitstream {
  /** The `ALPH` (when present) and `VP8 `/`VP8L` chunks, verbatim. */
  chunks: Uint8Array;
  hasAlpha: boolean;
}

/**
 * Take a still WebP apart far enough to reuse its bitstream.
 *
 * `convertToBlob` gives back a complete file: a simple `RIFF/WEBP/VP8 ` for an
 * opaque frame, or the extended form (`VP8X`, `ALPH`, `VP8 `) when there's
 * transparency. An animation frame wants exactly the image chunks out of that,
 * with the file's own header and `VP8X` dropped — the animation has its own.
 */
function extractBitstream(file: Uint8Array): FrameBitstream {
  const ascii = (offset: number, length: number) =>
    String.fromCharCode(...file.subarray(offset, offset + length));
  if (file.length < 16 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WEBP") {
    throw new Error("The browser produced an image this build can't animate.");
  }

  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const collected: Uint8Array[] = [];
  let hasAlpha = false;
  let offset = 12;

  while (offset + 8 <= file.length) {
    const tag = ascii(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const padded = size + (size % 2);
    if (tag === "ALPH" || tag === "VP8 " || tag === "VP8L") {
      // Copied whole (header, payload and pad byte) — an animation frame's
      // payload is these chunks exactly as they appear in a still file.
      collected.push(file.subarray(offset, offset + 8 + padded));
      if (tag === "ALPH") hasAlpha = true;
      // VP8L carries its own alpha rather than a separate ALPH chunk.
      if (tag === "VP8L") hasAlpha = true;
    }
    offset += 8 + padded;
  }

  if (collected.length === 0) {
    throw new Error("The browser produced an image this build can't animate.");
  }
  return { chunks: concat(collected), hasAlpha };
}

interface MuxFrame {
  bitstream: FrameBitstream;
  /** How long this frame is shown, in milliseconds. */
  durationMs: number;
}

/**
 * Assemble frames into an animated WebP.
 *
 * Every frame is full-canvas (the crop renders the whole frame each time), so
 * each `ANMF` sits at 0,0 at canvas size with "do not blend" and no disposal:
 * a frame simply replaces the one before it, which is both the simplest thing
 * to write and the only behaviour that can't accumulate artifacts.
 */
function muxAnimatedWebp(frames: MuxFrame[], width: number, height: number): Blob {
  const hasAlpha = frames.some((frame) => frame.bitstream.hasAlpha);

  // VP8X: flags byte (bit 4 = alpha, bit 1 = animation), 3 reserved bytes,
  // then canvas width and height as "minus one" 24-bit values.
  const vp8x = concat([
    new Uint8Array([(hasAlpha ? 0x10 : 0x00) | 0x02, 0, 0, 0]),
    uint24LE(width - 1),
    uint24LE(height - 1),
  ]);

  // ANIM: background colour as BGRA (transparent), then the loop count —
  // 0 meaning forever, which is what an avatar wants.
  const anim = concat([new Uint8Array([0, 0, 0, 0]), new Uint8Array([0, 0])]);

  const body: Uint8Array[] = [fourCC("WEBP"), ...chunk("VP8X", vp8x), ...chunk("ANIM", anim)];

  for (const frame of frames) {
    const header = concat([
      uint24LE(0), // x, in units of two pixels
      uint24LE(0), // y
      uint24LE(width - 1),
      uint24LE(height - 1),
      uint24LE(frame.durationMs),
      // Reserved (6 bits), blending (1 = do not blend), disposal (0 = none).
      new Uint8Array([0x02]),
    ]);
    body.push(...chunk("ANMF", concat([header, frame.bitstream.chunks])));
  }

  const payload = concat(body);
  return new Blob([concat([fourCC("RIFF"), uint32LE(payload.length), payload])], {
    type: "image/webp",
  });
}

// --- The crop itself -------------------------------------------------------

export interface AnimatedCropRequest {
  /** From `probeAnimation`, so the bytes are only read once. */
  animation: AnimatedSource;
  /** Region of the source to keep, in source pixels — the same rectangle the
   * still path passes to `drawImage`. */
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
}

/**
 * Render every frame of an animated source through the same crop.
 *
 * Frames are decoded, drawn and encoded one at a time rather than all at once:
 * a long GIF at avatar size is tens of megabytes of `VideoFrame`s, and holding
 * them all to save a little wall-clock time is how a renderer gets killed.
 */
export async function renderAnimatedCrop(request: AnimatedCropRequest): Promise<Blob> {
  const ImageDecoder = imageDecoderConstructor();
  if (!ImageDecoder) throw new Error("This build can't crop animated images.");

  const { animation, outputWidth, outputHeight } = request;
  const canvas = new OffscreenCanvas(outputWidth, outputHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't prepare the image.");
  ctx.imageSmoothingQuality = "high";

  const decoder = new ImageDecoder({ data: animation.data, type: animation.type });
  const frames: MuxFrame[] = [];

  try {
    await decoder.tracks.ready;
    await decoder.completed;
    const stride = frameStride(animation.frameCount);

    for (let index = 0; index < animation.frameCount; index += stride) {
      // Dropped frames hand their time to the frame that replaces them, so
      // thinning the animation slows nothing down.
      let durationMs = 0;
      for (let offset = 0; offset < stride && index + offset < animation.frameCount; offset++) {
        const { image } = await decoder.decode({ frameIndex: index + offset });
        durationMs += image.duration ? Math.round(image.duration / 1000) : DEFAULT_FRAME_MS;
        if (offset === 0) {
          // Cleared first: a frame with transparency would otherwise composite
          // onto the previous one still sitting in the canvas.
          ctx.clearRect(0, 0, outputWidth, outputHeight);
          ctx.drawImage(
            image as unknown as CanvasImageSource,
            request.sourceX,
            request.sourceY,
            request.sourceWidth,
            request.sourceHeight,
            0,
            0,
            outputWidth,
            outputHeight
          );
        }
        image.close();
      }

      const encoded = await canvas.convertToBlob({ type: "image/webp", quality: FRAME_QUALITY });
      frames.push({
        bitstream: extractBitstream(new Uint8Array(await encoded.arrayBuffer())),
        durationMs: Math.max(MIN_FRAME_MS, durationMs),
      });
    }
  } finally {
    decoder.close();
  }

  if (frames.length === 0) throw new Error("That animation had no frames to crop.");

  const blob = muxAnimatedWebp(frames, outputWidth, outputHeight);
  if (blob.size > MAX_ANIMATED_BYTES) {
    throw new Error(
      `That animation comes to ${Math.round(blob.size / 1024 / 1024)} MB once cropped. Try a shorter one, or save it as a still image.`
    );
  }
  return blob;
}
