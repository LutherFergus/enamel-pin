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
      "One clear focal subject, large bold silhouettes, almost no secondary ornament.",
      "Prefer big readable shapes and generous negative space. No tiny linework.",
    ].join(" ");
  }

  return [
    "Detail level: DETAILED.",
    "A richer scene with a few supporting large shapes around the subject.",
    "Still stitch-scale: every added element must be big and bold — more content, not finer detail, not tiny patterns.",
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

  const mosaicBorderRules = [
    "Critical border rule for mosaic blankets: stitches cannot capture tiny icons.",
    "Use only a few LARGE motifs in the border — big enough to read from across a room.",
    "Forbidden in borders: dense repeating mini-icons, tiny horseshoes/stars/dots, fine filigree, thin hatching, crowded chains of small ornaments.",
    "Prefer thick solid bands, oversized corner motifs, or a small number of large spaced motifs (roughly 4–12 total around the whole frame, not dozens).",
  ].join(" ");

  if (borderComplexity === "simple") {
    return [
      "Border: YES — SIMPLE.",
      "Add a restrained frame: a thick solid border band and/or a handful of oversized corner accents.",
      "Keep ornament extremely limited — think 4 large corner motifs max, or a plain double-line frame with wide empty margin.",
      "Do not fill the border with a repeating mini pattern.",
      mosaicBorderRules,
      "Center subject stays dominant; border stays quiet and bold.",
    ].join(" ");
  }

  return [
    "Border: YES — COMPLEX.",
    "Add a fuller decorative border that occupies the outer margin with intentional large ornament.",
    "Complexity means bigger motif variety and stronger border presence — NOT smaller or denser icons.",
    "Use large repeating blocks, oversized scrolls, chunky botanical shapes, or bold geometric panels with clear spacing.",
    "Still only a modest count of motifs; each motif should be chunky and stitch-readable.",
    mosaicBorderRules,
    "Keep the center subject readable; put abundance into large border shapes, not fine detail.",
  ].join(" ");
}

/**
 * Expands a short user subject into a full Imagine prompt.
 * Users should only need a few words; house style carries the quality bar.
 */
export function buildMosaicPrompt(input: PromptBuildInput): string {
  const subject = input.userPrompt.trim();

  const referenceLine = input.hasReferenceImage
    ? "Reference image provided: use it only for subject identity, pose, and silhouette. Redraw as crisp vector art — not a photo, not a filtered photo. Simplify small photo details into large flat shapes."
    : "No reference image. Invent an original illustration from the subject words.";

  return [
    "You are generating finished artwork for Mosaic Image Creator.",
    "Output goal: a crisp flat vector illustration designed to be translated later into a mosaic blanket / yarn chart.",
    "Stitch-scale constraint: every shape must stay large, chunky, and high-contrast. Tiny details will be lost in stitches — do not draw them.",
    "The user prompt may be only a few words. Treat those words as the SUBJECT, then complete a polished illustration without asking for more detail.",
    `Subject: ${subject}`,
    `Canvas aspect ratio: ${input.aspectRatio}. Compose intentionally for this frame.`,
    "House style: clean flat vector art; razor-sharp edges; smooth curves; solid color fills only.",
    "No gradients, textures, grain, noise, shadows, glow, 3D, photorealism, blur, or watercolor.",
    "Do NOT make the image look like a mosaic, pixels, tiles, beads, cross-stitch, graphghan, Lego, embroidery chart, or 8-bit/16-bit pixel art.",
    "Keep shapes bold and easy to read at a glance. Prefer fewer larger forms over many small ones.",
    colorInstruction(input.colorCount),
    detailInstruction(input.detailLevel),
    borderInstruction(input.borderMode, input.borderComplexity),
    referenceLine,
    "Deliver one cohesive finished illustration.",
  ].join(" ");
}
