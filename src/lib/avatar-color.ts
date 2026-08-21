function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

/**
 * Extracts the most prominent color from an image URL by sampling it at
 * 32×32 and building a hue histogram weighted by saturation × opacity.
 * Returns a dark, tinted hsl() string for use as a card background,
 * or null when the image is too neutral or can't be read.
 */
export function getAvatarColor(imageUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const SIZE = 32;
        const canvas = document.createElement("canvas");
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext("2d");
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const { data } = ctx.getImageData(0, 0, SIZE, SIZE);

        // 36 buckets of 10° each, weighted by saturation × alpha
        const buckets = new Float32Array(36);
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3] / 255;
          if (alpha < 0.5) continue;
          const [h, s] = rgbToHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
          if (s < 0.15) continue;
          buckets[Math.floor(h * 36) % 36] += s * alpha;
        }

        let peak = 0;
        let peakBucket = -1;
        for (let i = 0; i < 36; i++) {
          if (buckets[i] > peak) { peak = buckets[i]; peakBucket = i; }
        }

        if (peakBucket === -1 || peak < 1) { resolve(null); return; }
        const hue = Math.round((peakBucket / 36) * 360);
        resolve(`hsl(${hue}, 40%, 20%)`);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });
}
