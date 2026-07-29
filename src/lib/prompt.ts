import type { ColorCount } from "./types";

export function buildMosaicPrompt(
  userPrompt: string,
  colorCount: ColorCount,
  hasReferenceImage: boolean,
): string {
  const subject = userPrompt.trim();
  const colorLine =
    colorCount === 2
      ? "Use exactly 2 flat solid colors total (plus optional pure white negative space only if needed)."
      : `Use exactly ${colorCount} flat solid colors total. Choose a cohesive ${colorCount}-color palette.`;

  const referenceLine = hasReferenceImage
    ? "Use the reference photo only for subject, pose, and silhouette. Redraw it as a crisp vector illustration — not a photo, not a filter over the photo."
    : "Invent an original illustration from the description.";

  return [
    "Create a crisp, high-resolution vector illustration.",
    "This artwork will later be turned into a mosaic blanket, so keep shapes clear, bold, and easy to read — but do NOT make the image look like a mosaic, pixels, tiles, beads, cross-stitch, graphghan, Lego, or low-resolution pixel art.",
    "Style: clean flat vector art, razor-sharp edges, smooth curves, solid color fills only. No gradients, no textures, no grain, no noise, no shadows, no 3D, no photorealism, no blur.",
    "Composition: centered subject, simple solid background, high contrast, ample negative space. Sharp and print-ready.",
    "Strictly forbidden: pixelation, mosaic grid, square tiles, dithering, chunky blocks, 8-bit / 16-bit looks.",
    colorLine,
    referenceLine,
    `Subject: ${subject}`,
  ].join(" ");
}
