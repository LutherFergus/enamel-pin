import type {
  AspectRatio,
  BorderComplexity,
  BorderMode,
  ColorCount,
  DetailLevel,
} from "./types";

export type PromptBuildInput = {
  userPrompt: string;
  colorCount: ColorCount;
  aspectRatio: AspectRatio;
  detailLevel: DetailLevel;
  borderMode: BorderMode;
  borderComplexity: BorderComplexity;
  hasReferenceImage: boolean;
};

function colorInstruction(colorCount: ColorCount): string {
  if (colorCount === 2) {
    return "Palette: exactly 2 flat solid colors total (pure white negative space allowed only if needed for clarity).";
  }
  return `Palette: exactly ${colorCount} flat solid colors total. Choose a cohesive, high-contrast ${colorCount}-color palette.`;
}

function detailInstruction(detailLevel: DetailLevel): string {
  if (detailLevel === "simple") {
    return [
      "Detail level: SIMPLE.",
      "Use a minimal composition with one clear focal subject, large readable shapes, and very little secondary ornament.",
      "Prefer silhouette clarity over busy detail. Leave generous negative space.",
    ].join(" ");
  }

  return [
    "Detail level: DETAILED.",
    "Develop a richer scene around the subject with supporting elements, patterns, and refined shapes.",
    "Stay flat and vector-clean — more content, not more realism, texture, or shading.",
  ].join(" ");
}

function borderInstruction(
  borderMode: BorderMode,
  borderComplexity: BorderComplexity,
): string {
  if (borderMode === "none") {
    return [
      "Border: NONE.",
      "No frame, no decorative edge band, no vignette.",
      "Subject sits on a clean solid background with open margins.",
    ].join(" ");
  }

  if (borderComplexity === "simple") {
    return [
      "Border: YES — SIMPLE.",
      "Add a clean decorative border/frame around the artwork.",
      "Keep the border restrained: a clear band or frame with light, repeating ornament only.",
      "Do not let border artwork overpower the central subject.",
    ].join(" ");
  }

  return [
    "Border: YES — COMPLEX.",
    "Add a richly decorated border that fills the outer margin with extensive ornamental artwork.",
    "The border should feel intentional and abundant (motifs, flourishes, repeating patterns) while remaining flat vector art.",
    "Keep the center subject readable; put the complexity into the border region.",
  ].join(" ");
}

/**
 * Expands a short user subject into a full Imagine prompt.
 * Users should only need a few words; house style carries the quality bar.
 */
export function buildMosaicPrompt(input: PromptBuildInput): string {
  const subject = input.userPrompt.trim();

  const referenceLine = input.hasReferenceImage
    ? "Reference image provided: use it only for subject identity, pose, and silhouette. Redraw as crisp vector art — not a photo, not a filtered photo."
    : "No reference image. Invent an original illustration from the subject words.";

  return [
    "You are generating finished artwork for Mosaic Image Creator.",
    "Output goal: a crisp, high-resolution flat vector illustration that can later be used to plan a mosaic project.",
    "The user prompt may be only a few words. Treat those words as the SUBJECT, then complete a polished illustration without asking for more detail.",
    `Subject: ${subject}`,
    `Canvas aspect ratio: ${input.aspectRatio}. Compose intentionally for this frame.`,
    "House style: clean flat vector art; razor-sharp edges; smooth curves; solid color fills only.",
    "No gradients, textures, grain, noise, shadows, glow, 3D, photorealism, blur, or watercolor.",
    "Do NOT make the image look like a mosaic, pixels, tiles, beads, cross-stitch, graphghan, Lego, embroidery chart, or 8-bit/16-bit pixel art.",
    "Keep shapes bold, high-contrast, and easy to read at a glance. Print-ready clarity.",
    colorInstruction(input.colorCount),
    detailInstruction(input.detailLevel),
    borderInstruction(input.borderMode, input.borderComplexity),
    referenceLine,
    "Deliver one cohesive finished illustration.",
  ].join(" ");
}
