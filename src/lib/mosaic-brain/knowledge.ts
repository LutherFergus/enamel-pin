/**
 * Mosaic Blanket Knowledge Base
 *
 * Domain rules for designs that must later translate into yarn/mosaic blankets
 * (graphghan / tapestry / C2C / mosaic crochet charts). Every stitch or block
 * is one solid color — fine detail is lost. Simple is usually better.
 */

export const MOSAIC_BLANKET_FACTS = {
  medium:
    "Mosaic blankets and graphghans are built from a grid where each stitch/block is one solid yarn color. Curves become stairsteps; tiny marks vanish.",
  techniques: [
    "Graphghan / tapestry / intarsia: colored squares on a chart; more colors mean more yarn changes.",
    "C2C (corner-to-corner): each tile is a block — needs thicker lines and less detail than single-crochet graphs.",
    "Overlay/inset mosaic crochet: usually two high-contrast colors; bold geometric graphics excel; painterly detail fails.",
  ],
  hardLimits: [
    "No gradients, shading, antialiasing, textures, or photorealism — yarn cannot render them.",
    "No thin linework, eyelashes, tiny text, dense icon borders, or hairline ornament.",
    "No pixel-art / bead / Lego look in the *source image*; we output crisp vector art that will be charted later.",
    "Every shape must stay large enough to survive reduction to roughly 80–150 blocks across a throw.",
  ],
  softPreferences: [
    "Fewer colors are easier and usually clearer — 2 colors is the sweet spot for classic mosaic contrast.",
    "One dominant silhouette beats a crowded scene.",
    "Generous negative space helps charts stay readable.",
    "Closed chunky shapes beat open thin outlines.",
    "Borders and backgrounds should use a handful of oversized motifs, never dozens of mini repeats.",
  ],
} as const;

/** Patterns we always forbid in generated artwork. */
export const FORBIDDEN_VISUALS = [
  "photorealism",
  "gradients",
  "soft shadows",
  "glow effects",
  "film grain / texture fills",
  "watercolor washes",
  "tiny repeating border icons",
  "dense filigree",
  "small facial features (pupils, nostrils, teeth grids)",
  "readable small text or logos",
  "busy photographic backgrounds",
  "pixel mosaic / 8-bit / bead grid appearance",
] as const;

/** Patterns that translate well into stitch charts. */
export const POSSIBLE_VISUALS = [
  "bold silhouettes",
  "large geometric blocks",
  "chunky botanical shapes",
  "simple animal profiles",
  "thick frames and oversized corner motifs",
  "1–3 large thematic background shapes",
  "high-contrast flat color fields",
  "clear negative space",
] as const;

export type ThemeFamily =
  | "animal"
  | "nature"
  | "ocean"
  | "sky"
  | "space"
  | "home"
  | "holiday"
  | "vehicle"
  | "people"
  | "abstract";

type ThemeRule = {
  family: ThemeFamily;
  keywords: string[];
  /** Large stitch-safe background motifs tied to the subject. */
  backgroundMotifs: string[];
};

export const THEME_RULES: ThemeRule[] = [
  {
    family: "animal",
    keywords: [
      "fox",
      "horse",
      "dog",
      "cat",
      "bird",
      "owl",
      "bear",
      "deer",
      "wolf",
      "bunny",
      "rabbit",
      "lion",
      "tiger",
      "elephant",
      "whale",
      "fish",
      "dragon",
      "unicorn",
      "pet",
      "animal",
    ],
    backgroundMotifs: [
      "one oversized moon or sun disk",
      "a few large tree or hill silhouettes",
      "a simple horizon band",
    ],
  },
  {
    family: "ocean",
    keywords: [
      "ocean",
      "sea",
      "wave",
      "beach",
      "shark",
      "dolphin",
      "mermaid",
      "boat",
      "sail",
      "lighthouse",
      "anchor",
    ],
    backgroundMotifs: [
      "2–3 large wave bands",
      "one big sun disk",
      "a simple shoreline shape",
    ],
  },
  {
    family: "sky",
    keywords: ["cloud", "sky", "rainbow", "storm", "kite", "balloon"],
    backgroundMotifs: [
      "2–3 oversized cloud silhouettes",
      "one large sun or moon",
      "a simple ground strip",
    ],
  },
  {
    family: "space",
    keywords: [
      "space",
      "planet",
      "rocket",
      "astronaut",
      "galaxy",
      "star",
      "alien",
      "moon",
    ],
    backgroundMotifs: [
      "one large planet disk",
      "3–5 oversized stars only (never a dense starfield)",
      "a simple crescent moon",
    ],
  },
  {
    family: "nature",
    keywords: [
      "tree",
      "flower",
      "forest",
      "mountain",
      "garden",
      "leaf",
      "cactus",
      "farm",
      "barn",
    ],
    backgroundMotifs: [
      "large mountain or hill blocks",
      "2–3 oversized leaf or bloom shapes",
      "a simple ground/sky split",
    ],
  },
  {
    family: "home",
    keywords: [
      "house",
      "home",
      "cabin",
      "coffee",
      "mug",
      "book",
      "hearth",
      "kitchen",
    ],
    backgroundMotifs: [
      "a large window or doorway silhouette",
      "one oversized plant shape",
      "a simple shelf or ground band",
    ],
  },
  {
    family: "holiday",
    keywords: [
      "christmas",
      "halloween",
      "easter",
      "valentine",
      "heart",
      "snowman",
      "pumpkin",
      "santa",
      "tree ornament",
    ],
    backgroundMotifs: [
      "2–4 oversized holiday icons max",
      "a simple snowbank or ground band",
      "one large moon or sun",
    ],
  },
  {
    family: "vehicle",
    keywords: [
      "truck",
      "car",
      "train",
      "plane",
      "bike",
      "tractor",
      "firetruck",
      "bus",
    ],
    backgroundMotifs: [
      "a simple road or track band",
      "2–3 large cloud or hill shapes",
      "one oversized sun",
    ],
  },
  {
    family: "people",
    keywords: [
      "person",
      "girl",
      "boy",
      "baby",
      "family",
      "portrait",
      "face",
      "couple",
    ],
    backgroundMotifs: [
      "a simple solid field or gentle horizon",
      "one oversized plant or window shape",
      "avoid crowded scenery behind faces",
    ],
  },
  {
    family: "abstract",
    keywords: [],
    backgroundMotifs: [
      "a simple two-tone horizon",
      "one large geometric disk or arc",
      "2–3 oversized abstract blocks behind the subject",
    ],
  },
];

export function detectThemeFamily(subject: string): ThemeFamily {
  const text = subject.toLowerCase();
  for (const rule of THEME_RULES) {
    if (rule.family === "abstract") continue;
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.family;
    }
  }
  return "abstract";
}

export function backgroundMotifsForSubject(subject: string): string[] {
  const family = detectThemeFamily(subject);
  const rule =
    THEME_RULES.find((item) => item.family === family) ??
    THEME_RULES[THEME_RULES.length - 1];
  return [...rule.backgroundMotifs];
}
