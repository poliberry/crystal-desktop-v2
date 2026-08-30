"use client";

import { useStaticFrame } from "@/hooks/use-static-frame";
import {
  layerKind,
  layerObjectFit,
  type CosmeticLayer,
} from "@/lib/cosmetic-layers";

/**
 * What one layer looks like, inside the box its geometry has already decided.
 *
 * The one renderer for all three kinds, shared by everything that draws a
 * layer: the profile frame, the avatar decoration, and the canvas you arrange
 * them on. That last one is the reason it has to be shared — an editor whose
 * preview is a second implementation of the renderer is an editor that lies,
 * and the previous version drew frames with `object-fit: contain` where the
 * card used `fill`, which is exactly how it lied.
 *
 * Geometry is not this component's business. It fills whatever box it is put
 * in; `layerStyle` decides where that box is.
 */
export function LayerContent({
  layer,
  /** A stored url to the picture to draw for it. Identity for a frame, where a
   * url is a url; the decoration editor passes the one that also knows how to
   * draw a preset key. */
  resolveSrc = (url) => url,
  /** Hold animation on its first frame — a member list is fifty avatars, and
   * fifty looping GIFs is a room full of moving parts nobody asked to look
   * at. See `useStaticFrame`. */
  frozen = false,
  className,
}: {
  layer: CosmeticLayer;
  resolveSrc?: (url: string) => string;
  frozen?: boolean;
  className?: string;
}) {
  const kind = layerKind(layer);
  const src = resolveSrc(layer.url);
  // Called unconditionally, because hooks are: a text layer resolves an empty
  // url, which the hook is happy to do nothing with.
  const poster = useStaticFrame(kind === "image" ? src : "", frozen);

  if (kind === "text") {
    return (
      <div
        className={className}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent:
            layer.align === "left" ? "flex-start" : layer.align === "right" ? "flex-end" : "center",
          width: "100%",
          height: "100%",
          color: layer.color ?? "#ffffff",
          // Every size in this model is a percentage of the target box's
          // width, and `cqw` is exactly that — so type scales with the card
          // rather than staying one pixel size on a thumbnail.
          fontSize: `${layer.fontSize ?? 7.5}cqw`,
          fontWeight: layer.fontWeight ?? 700,
          fontStyle: layer.italic ? "italic" : undefined,
          lineHeight: 1.15,
          textAlign: layer.align ?? "center",
          whiteSpace: "pre-wrap",
          // The outline goes round the letters rather than the box. `paint-order`
          // is what puts it *behind* them; without it a heavy stroke eats the
          // glyph from the outside in.
          WebkitTextStrokeColor: layer.strokeColor,
          WebkitTextStrokeWidth: layer.strokeColor ? `${layer.strokeWidth ?? 0}cqw` : undefined,
          paintOrder: "stroke fill",
        }}
      >
        {layer.text}
      </div>
    );
  }

  if (kind === "shape") {
    return (
      <div
        className={className}
        style={{
          width: "100%",
          height: "100%",
          background: layer.color ?? "#ffffff",
          // A percentage radius on a non-square box gives an ellipse in each
          // corner rather than a circle, which is what `50%` being a circle
          // depends on — so the ellipse case says so outright.
          borderRadius:
            layer.shape === "ellipse" ? "50%" : layer.radius ? `${layer.radius}cqw` : undefined,
          border: layer.strokeColor
            ? `${layer.strokeWidth ?? 0}cqw solid ${layer.strokeColor}`
            : undefined,
          boxSizing: "border-box",
        }}
      />
    );
  }

  return (
    <img
      src={poster ?? src}
      alt=""
      draggable={false}
      className={className}
      style={{ width: "100%", height: "100%", objectFit: layerObjectFit(layer) }}
    />
  );
}
