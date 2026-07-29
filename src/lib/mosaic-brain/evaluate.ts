import {
  FORBIDDEN_VISUALS,
  MOSAIC_BLANKET_FACTS,
  POSSIBLE_VISUALS,
  backgroundMotifsForSubject,
  detectThemeFamily,
} from "./knowledge";
import type {
  AspectRatio,
  BackgroundMode,
  BorderComplexity,
  BorderMode,
  ColorCount,
  DetailLevel,
} from "@/lib/types";

export type DesignEvaluationInput = {
  subject: string;
  colorCount: ColorCount;
  aspectRatio: AspectRatio;
  detailLevel: DetailLevel;
  borderMode: BorderMode;
  borderComplexity: BorderComplexity;
  backgroundMode: BackgroundMode;
  hasReferenceImage: boolean;
};

export type DesignPreference = "ideal" | "ok" | "risky";

export type DesignEvaluation = {
  preference: DesignPreference;
  /** Soft tips for the UI (never hard-block generation). */
  notes: string[];
  /** Always-on directives injected into the Imagine prompt. */
  directives: string[];
  themeFamily: ReturnType<typeof detectThemeFamily>;
  backgroundMotifs: string[];
};

function scorePreference(flags: {
  colorCount: ColorCount;
  detailLevel: DetailLevel;
  borderMode: BorderMode;
  borderComplexity: BorderComplexity;
  backgroundMode: BackgroundMode;
}): DesignPreference {
  let risk = 0;

  if (flags.colorCount >= 5) risk += 1;
  if (flags.colorCount >= 4 && flags.detailLevel === "detailed") risk += 1;
  if (flags.detailLevel === "detailed" && flags.backgroundMode === "themed") {
    risk += 1;
  }
  if (
    flags.borderMode === "border" &&
    flags.borderComplexity === "complex" &&
    flags.detailLevel === "detailed"
  ) {
    risk += 1;
  }
  if (
    flags.borderMode === "border" &&
    flags.borderComplexity === "complex" &&
    flags.backgroundMode === "themed"
  ) {
    risk += 1;
  }

  if (risk >= 3) return "risky";
  if (risk >= 1) return "ok";
  return "ideal";
}

/**
 * Mosaic blanket design brain: checks options against what yarn charts can
 * actually carry, then emits prompt directives that keep every generation
 * inside that envelope.
 */
export function evaluateMosaicDesign(
  input: DesignEvaluationInput,
): DesignEvaluation {
  const subject = input.subject.trim() || "subject";
  const themeFamily = detectThemeFamily(subject);
  const backgroundMotifs = backgroundMotifsForSubject(subject);
  const notes: string[] = [];
  const directives: string[] = [];

  directives.push(MOSAIC_BLANKET_FACTS.medium);
  directives.push(
    `This image must remain chartable as a mosaic blanket / graphghan: ${MOSAIC_BLANKET_FACTS.hardLimits.join(" ")}`,
  );
  directives.push(
    `Prefer what works in yarn: ${POSSIBLE_VISUALS.join("; ")}.`,
  );
  directives.push(
    `Never include: ${FORBIDDEN_VISUALS.join("; ")}.`,
  );
  directives.push(
    "Bias toward SIMPLE. Extra ornaments must earn their place as large, high-contrast shapes — otherwise omit them.",
  );
  directives.push(
    "Think like a chart designer: closed silhouettes, thick joins, clear color separations, and generous negative space.",
  );

  if (input.colorCount === 2) {
    notes.push("2 colors = strongest mosaic contrast and easiest yarn work.");
    directives.push(
      "With 2 colors, maximize graphic silhouette impact and avoid mid-tone illusions.",
    );
  } else if (input.colorCount >= 4) {
    notes.push(
      "More colors add yarn changes — keep shapes fewer and larger so the chart stays clean.",
    );
    directives.push(
      `Using ${input.colorCount} flat colors: assign each to large regions only. Do not use extra colors for tiny accents.`,
    );
  }

  if (input.detailLevel === "detailed") {
    notes.push(
      "Detailed still means a few big supporting shapes — not finer linework.",
    );
  } else {
    notes.push("Simple detail is usually best for stitch translation.");
  }

  if (input.borderMode === "border") {
    if (input.borderComplexity === "complex") {
      notes.push(
        "Complex borders should stay chunky. Tiny repeating icons will not survive stitches.",
      );
    } else {
      notes.push(
        "Simple borders: thick band or a few oversized corners — not mini motif chains.",
      );
    }
  }

  if (input.backgroundMode === "themed") {
    notes.push(
      "Themed backgrounds use only a few large motifs tied to the subject.",
    );
    directives.push(
      `Background mode: THEMED for theme family "${themeFamily}". Add only these kinds of large supporting shapes: ${backgroundMotifs.join("; ")}.`,
    );
    directives.push(
      "Background shapes must sit clearly behind/around the subject, stay fewer than the subject’s visual weight, and never become a busy landscape.",
    );
  } else {
    directives.push(
      "Background mode: NONE. Leave a clean solid field behind the main subject. Do not invent scenery, props, or environmental filler.",
    );
  }

  if (input.hasReferenceImage) {
    notes.push(
      "Photos get simplified to silhouettes — small photo details will be dropped.",
    );
    directives.push(
      "Reference photo constraint: extract only large silhouette information. Drop freckles, fabric weave, eyelashes, and other stitch-scale impossibilities.",
    );
  }

  if (
    input.detailLevel === "detailed" &&
    input.backgroundMode === "themed" &&
    input.borderMode === "border"
  ) {
    notes.push(
      "Detailed + themed background + border is a lot — the engine will still force large shapes, but simpler settings usually look better in yarn.",
    );
  }

  const preference = scorePreference(input);

  return {
    preference,
    notes,
    directives,
    themeFamily,
    backgroundMotifs,
  };
}
