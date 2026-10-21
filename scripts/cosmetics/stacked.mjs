/**
 * "Stacked alpha" copies of transparent cosmetic videos, for Android (see the top of scripts/cosmetics/render-entry.ts):
 * plain H.264, twice the height, the colour premultiplied by alpha in the top half and the alpha as grey in the bottom.
 *
 * `makeStacked` builds one from a VP9-with-alpha WebM (for remakes rendered before the renderer wrote them itself);
 * `checkStacked` decodes one back and compares it with its WebM, so a broken file is never published.
 */
import { spawnSync } from "node:child_process";

// Well above where a difference can be seen; the copy is a lossy re-encode, so it is never exact.
const GOOD_PSNR = 32;

/** Build `out` from `webm`, keyframes at the start and at `loopFrom`, `fps` as in the WebM. */
export function makeStacked(ffmpeg, webm, out, { fps, loopFrom }) {
  const res = spawnSync(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y",
    // libvpx's decoder: ffmpeg's own VP9 decoder ignores the alpha channel.
    "-c:v", "libvpx-vp9", "-i", webm,
    "-filter_complex", "[0:v]format=rgba,split[c][m];[c]premultiply=inplace=1,format=rgb24[cc];[m]alphaextract,format=rgb24[mm];[cc][mm]vstack,format=yuv420p[out]",
    "-map", "[out]", "-an",
    "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-preset", "slow", "-crf", "16",
    "-g", String(fps * 2), "-force_key_frames", `0,${loopFrom}`,
    "-tag:v", "avc1", "-movflags", "+faststart",
    out,
  ], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`Couldn't make ${out}: ${res.stderr}`);
}

const probe = (file) => {
  const res = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,profile,width,height,pix_fmt:format=duration", "-of", "json", file], { encoding: "utf8" });
  const info = JSON.parse(res.stdout || "{}");
  return { stream: info.streams?.[0] ?? {}, duration: Number(info.format?.duration) };
};

const psnr = (ffmpeg, webm, stacked, filter) => {
  const res = spawnSync(ffmpeg, ["-hide_banner", "-c:v", "libvpx-vp9", "-i", webm, "-i", stacked, "-filter_complex", filter, "-f", "null", "-"], { encoding: "utf8" });
  const m = /PSNR .*average:([0-9.]+|inf)/.exec(res.stderr ?? "");
  return m ? (m[1] === "inf" ? Infinity : Number(m[1])) : NaN;
};

/** What is wrong with `stacked` as a copy of `webm` (`width × height`, `duration` seconds), if anything. */
export function checkStacked(ffmpeg, webm, stacked, { width, height, duration }) {
  const problems = [];
  const { stream, duration: length } = probe(stacked);
  if (!(stream.codec_name === "h264" && stream.pix_fmt === "yuv420p" && stream.width === width && stream.height === height * 2 && Math.abs(length - duration) < 0.2)) {
    problems.push(`the stacked MP4 is not ${width}×${height * 2} H.264 4:2:0 lasting ${duration}s`);
    return problems;
  }
  const alpha = psnr(ffmpeg, webm, stacked, `[0:v]format=rgba,alphaextract,format=gray[a];[1:v]crop=${width}:${height}:0:${height},format=gray[b];[a][b]psnr`);
  const colour = psnr(ffmpeg, webm, stacked, `[0:v]format=rgba,premultiply=inplace=1,format=rgb24[a];[1:v]crop=${width}:${height}:0:0,format=rgb24[b];[a][b]psnr`);
  if (!(alpha >= GOOD_PSNR)) problems.push(`the stacked MP4's alpha doesn't match the WebM's (PSNR ${alpha.toFixed(1)} dB)`);
  if (!(colour >= GOOD_PSNR)) problems.push(`the stacked MP4's colour doesn't match the WebM's (PSNR ${colour.toFixed(1)} dB)`);
  return problems;
}
