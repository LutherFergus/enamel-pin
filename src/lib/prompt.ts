import { evaluateMosaicDesign } from "@/lib/mosaic-brain";
import type {
  AspectRatio,
  BackgroundMode,
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
  backgroundMode: BackgroundMode;
  hasReferenceImage: boolean;
};

function colorInstruction(colorCount: ColorCount): string {
  const hardCap = [
    `HARD COLOR CAP: the finished image may use exactly ${colorCount} solid flat colors — no more.`,
    "Count every region: subject, outlines, eyes, belly, cheeks, border, background, and ornaments.",
    "Forbidden extras: tints, shades, mid-tones, highlights, lowlights, gray helpers, off-white accents, or a third 'almost the same' green/blue/etc.",
    "If a shape needs separation, flip between the allowed colors or use negative space from those same colors — never invent another color.",
  ].join(" ");

  if (colorCount === 2) {
    return [
      "Palette: EXACTLY 2 yarn colors for the entire canvas (Color A + Color B only).",
      "Pick two high-contrast colors. Every pixel must be Color A or Color B.",
      "Do not add white, cream, yellow-green, light fill, or any third accent unless that third tone is literally one of the two chosen colors.",
      "Classic two-color graphic: dark silhouette shapes on a light field, or light shapes on a dark field — still only those two colors.",
      hardCap,
    ].join(" ");
  }

  return [
    `Palette: EXACTLY ${colorCount} flat solid yarn colors for the entire canvas.`,
    `Choose a cohesive high-contrast ${colorCount}-color set and use only those colors everywhere.`,
    hardCap,
  ].join(" ");
}

function detailInstruction(detailLevel: DetailLevel): string {
  if (detailLevel === "simple") {
    return [
      "Detail level: SIMPLE (preferred for mosaic blankets).",
      "One clear focal subject, large bold silhouettes, almost no secondary ornament.",
      "Prefer big readable shapes and generous negative space. No tiny linework.",
    ].join(" ");
  }

  return [
    "Detail level: DETAILED — still stitch-scale.",
    "A richer scene with only a few supporting LARGE shapes around the subject.",
    "More content does NOT mean finer detail. No tiny patterns, no busy filler.",
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

function backgroundInstruction(
  backgroundMode: BackgroundMode,
  motifs: string[],
): string {
  if (backgroundMode === "none") {
    return [
      "Background: NONE.",
      "Keep only the main subject (plus border if requested) on a clean solid field.",
      "Do not add scenery, props, weather, or thematic filler behind the subject.",
    ].join(" ");
  }

  return [
    "Background: THEMED.",
    "Add a sparse thematic background suggested by the subject — large shapes only.",
    `Allowed background motifs: ${motifs.join("; ")}.`,
    "Use at most 1–3 background elements total. They must be oversized, flat, and quieter than the subject.",
    "No busy landscapes, no tiny distant objects, no textured ground fills.",
  ].join(" ");
}

/**
 * Expands a short user subject into a full Imagine prompt.
 * The mosaic-brain engine always injects stitch-feasibility constraints.
 */
export function buildMosaicPrompt(input: PromptBuildInput): string {
  const subject = input.userPrompt.trim();
  const evaluation = evaluateMosaicDesign({
    subject,
    colorCount: input.colorCount,
    aspectRatio: input.aspectRatio,
    detailLevel: input.detailLevel,
    borderMode: input.borderMode,
    borderComplexity: input.borderComplexity,
    backgroundMode: input.backgroundMode,
    hasReferenceImage: input.hasReferenceImage,
  });

  const referenceLine = input.hasReferenceImage
    ? "Reference image provided: use it only for subject identity, pose, and silhouette. Redraw as crisp vector art — not a photo, not a filtered photo. Simplify small photo details into large flat shapes."
    : "No reference image. Invent an original illustration from the subject words.";

  return [
    "You are generating finished artwork for Mosaic Image Creator.",
    "Exclusive output type: mosaic-blanket-ready flat vector illustration (for later yarn/graphghan charting).",
    "The user prompt may be only a few words. Treat those words as the SUBJECT, then complete a polished illustration without asking for more detail.",
    `Subject: ${subject}`,
    `Canvas aspect ratio: ${input.aspectRatio}. Compose intentionally for this frame.`,
    "House style: clean flat vector art; razor-sharp edges; smooth curves; solid color fills only.",
    "No gradients, textures, grain, noise, shadows, glow, 3D, photorealism, blur, or watercolor.",
    "Do NOT make the image look like a mosaic, pixels, tiles, beads, cross-stitch, graphghan, Lego, embroidery chart, or 8-bit/16-bit pixel art.",
    "Keep shapes bold and easy to read at a glance. Prefer fewer larger forms over many small ones. Simple is usually better.",
    "Color obedience is mandatory: never exceed the requested color count. Extra 'accent' colors are rejected.",
    ...evaluation.directives,
    colorInstruction(input.colorCount),
    detailInstruction(input.detailLevel),
    borderInstruction(input.borderMode, input.borderComplexity),
    backgroundInstruction(input.backgroundMode, evaluation.backgroundMotifs),
    referenceLine,
    "Deliver one cohesive finished illustration that a crocheter could chart into a blanket without losing the idea.",
  ].join(" ");
}

export function getDesignNotes(input: PromptBuildInput) {
  return evaluateMosaicDesign({
    subject: input.userPrompt,
    colorCount: input.colorCount,
    aspectRatio: input.aspectRatio,
    detailLevel: input.detailLevel,
    borderMode: input.borderMode,
    borderComplexity: input.borderComplexity,
    backgroundMode: input.backgroundMode,
    hasReferenceImage: input.hasReferenceImage,
  });
}
