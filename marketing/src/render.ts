/**
 * Renders the marketing pieces from the HTML sources in this folder.
 *
 *   bun marketing/src/render.ts stills 4.5 9.6 ...   PNG previews of the ad at those times
 *   bun marketing/src/render.ts video                the 30s ad (needs ffmpeg), with the music
 *   bun marketing/src/render.ts twitter              the Twitter images
 *
 * Uses Microsoft Edge (installed on this Mac) through playwright-core; set CHROME_PATH to use another
 * Chromium.
 */
import { chromium } from "playwright-core";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const here = import.meta.dir;
const root = join(here, "..");
const browserPath = process.env.CHROME_PATH ?? "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
const [mode, ...rest] = process.argv.slice(2);
const FPS = 30;
const DURATION = 30;

const browser = await chromium.launch({ executablePath: browserPath, headless: true });

async function openAd() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`file://${join(here, "ad.html")}`);
  await page.evaluate(() => (window as unknown as { ready: Promise<boolean> }).ready);
  return page;
}

if (mode === "stills") {
  const page = await openAd();
  const dir = join(root, "video", "stills");
  mkdirSync(dir, { recursive: true });
  for (const time of rest.map(Number)) {
    await page.evaluate((x) => (window as unknown as { render: (t: number) => void }).render(x), time);
    await page.screenshot({ path: join(dir, `t${time.toFixed(2)}.png`) });
  }
  console.log("stills in", dir);
}

if (mode === "video") {
  const page = await openAd();
  const frames = join(root, "video", ".frames");
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const total = FPS * DURATION;
  for (let i = 0; i < total; i++) {
    await page.evaluate((x) => (window as unknown as { render: (t: number) => void }).render(x), i / FPS);
    await page.screenshot({ path: join(frames, `${String(i).padStart(4, "0")}.png`) });
    if (i % 90 === 0) console.log(`frame ${i}/${total}`);
  }
  const music = join(root, "video", "greenhouse-music.wav");
  if (!existsSync(music)) throw new Error("Run music.py first.");
  const out = join(root, "video", "crystal-ad-1080p.mp4");
  // H.264 High, yuv420p (plays everywhere, including X/Twitter), AAC 192k, music normalised to -14 LUFS.
  const r = spawnSync("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-framerate", String(FPS), "-i", join(frames, "%04d.png"),
    "-i", music,
    "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-profile:v", "high", "-movflags", "+faststart",
    "-af", "loudnorm=I=-14:TP=-1:LRA=9",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-shortest", out,
  ], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed");
  rmSync(frames, { recursive: true, force: true });
  console.log("wrote", out);
}

if (mode === "twitter") {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`file://${join(here, "twitter.html")}`);
  await page.evaluate(() => (window as unknown as { ready: Promise<boolean> }).ready);
  const cards = await page.$$eval("[data-card]", (els) => els.map((el) => el.getAttribute("data-card")!));
  for (const name of cards) {
    const card = page.locator(`[data-card="${name}"]`);
    await card.screenshot({ path: join(root, "twitter", `${name}.png`) });
  }
  console.log("twitter cards:", cards.join(", "));
}

await browser.close();
