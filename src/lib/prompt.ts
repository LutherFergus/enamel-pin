import type { ColorCount } from "./types";

export function buildMosaicPrompt(
  userPrompt: string,
  colorCount: ColorCount,
  hasReferenceImage: boolean,
): string {
  const subject = userPrompt.trim();
  const colorLine =
    colorCount === 2
      ? "Use exactly 2 flat colors total (plus optional pure white negative space only if needed)."
      : `Use exactly ${colorCount} flat colors total. The AI must choose a cohesive ${colorCount}-color palette.`;

  const referenceLine = hasReferenceImage
    ? "Interpret the reference photo as the subject and silhouette for a mosaic blanket pattern. Simplify forms into blocky shapes suitable for crochet or knit graphghans. Do not reproduce photographic detail."
    : "Design an original mosaic blanket pattern from the description.";

  return [
    "Create a clean vector mosaic blanket design for yarn craft (crochet/knit graphghan).",
    "Style: flat vector illustration, crisp hard edges, solid color fills only, no gradients, no textures, no shadows, no 3D, no photorealism.",
    "Composition: centered motif on a clear grid of square mosaic tiles / pixels. High contrast. Readable at blanket scale.",
    "Background: simple solid field or sparse tiled ground — keep the motif dominant.",
    colorLine,
    referenceLine,
    `Subject: ${subject}`,
  ].join(" ");
}
