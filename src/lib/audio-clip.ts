/**
 * Turning an arbitrary audio file into a soundboard clip: decode it, take the
 * slice the user selected, apply their gain, and hand back a WAV.
 *
 * The trim is baked into the uploaded bytes rather than stored as offsets
 * alongside the original. A clip is played by four different things — the
 * soundboard grid, the settings preview, the join-sound resolver, and every
 * other client in the call that receives the LiveKit packet — and "start at
 * 1.2s, stop at 3.8s, at 60% volume" would have to be plumbed through all of
 * them and kept in step. What gets stored is what gets played.
 *
 * WAV rather than a compressed format because the platform gives us no
 * encoder: `MediaRecorder` can produce WebM/Opus but only in real time, so a
 * 6-second clip would take 6 seconds to write. WAV is a header and the samples
 * we already have. At the 8-second ceiling that's ~1.4 MB stereo — well inside
 * the upload limit.
 */

/** Longest clip the soundboard accepts, mirroring `MAX_SOUND_MS` in
 * convex/soundboard.ts. The trimmer uses it to cap the selection. */
export const MAX_CLIP_MS = 8_000;

/** 16-bit PCM: the sample format every decoder understands. */
const BYTES_PER_SAMPLE = 2;

/**
 * Decode a file to raw samples.
 *
 * The `AudioContext` is closed afterwards. Browsers cap how many can exist at
 * once, and picking a dozen files in a row would otherwise exhaust that quota
 * and start throwing on a page that had done nothing wrong.
 */
export async function decodeAudioFile(file: Blob): Promise<AudioBuffer> {
  const bytes = await file.arrayBuffer();
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(bytes);
  } finally {
    void context.close().catch(() => {});
  }
}

/**
 * Per-column peaks for drawing a waveform, as `[min, max]` pairs in -1…1.
 *
 * Both extremes rather than an average magnitude: an average flattens a
 * waveform into a smooth blob, where min/max keeps the shape that makes a clip
 * recognisable — which is the whole point of showing it.
 *
 * Channels are averaged, so a stereo file draws as one trace instead of the
 * left channel standing in for both.
 */
export function computePeaks(buffer: AudioBuffer, columns: number): [number, number][] {
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i)
  );
  const perColumn = buffer.length / columns;
  const peaks: [number, number][] = [];

  for (let column = 0; column < columns; column++) {
    const start = Math.floor(column * perColumn);
    const end = Math.min(buffer.length, Math.floor((column + 1) * perColumn));
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i++) {
      let sum = 0;
      for (const channel of channels) sum += channel[i]!;
      const sample = sum / channels.length;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    peaks.push([min, max]);
  }
  return peaks;
}

/**
 * Cut `[startSec, endSec)` out of a decoded buffer, scaled by `gain`, as a
 * 16-bit WAV.
 *
 * Samples are clamped before quantising: a gain above 1 on an already-loud
 * clip overflows the 16-bit range, and letting that wrap turns a loud sound
 * into a burst of noise.
 */
export function encodeClipToWav(
  buffer: AudioBuffer,
  startSec: number,
  endSec: number,
  gain = 1
): Blob {
  const { sampleRate, numberOfChannels } = buffer;
  const startFrame = Math.max(0, Math.floor(startSec * sampleRate));
  const endFrame = Math.min(buffer.length, Math.ceil(endSec * sampleRate));
  const frames = Math.max(0, endFrame - startFrame);

  const dataBytes = frames * numberOfChannels * BYTES_PER_SAMPLE;
  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numberOfChannels * BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, numberOfChannels * BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * BYTES_PER_SAMPLE, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);

  const channels = Array.from({ length: numberOfChannels }, (_, i) => buffer.getChannelData(i));
  let offset = 44;
  for (let frame = startFrame; frame < endFrame; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame]! * gain));
      // Asymmetric because two's complement has one more negative value than
      // positive: -1 maps to -32768, +1 to 32767.
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return new Blob([output], { type: "audio/wav" });
}

/** `4.44s` — the length readout under the trimmer's play button. */
export function formatClipLength(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}
