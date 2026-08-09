export type ColorCount = 2 | 3 | 4 | 5;

export type AspectRatio =
  | "1:1"
  | "4:3"
  | "3:4"
  | "3:2"
  | "2:3"
  | "16:9"
  | "9:16"
  | "2:1"
  | "1:2";

export type Orientation = "square" | "landscape" | "portrait";

export type DetailLevel = "simple" | "detailed";

export type BorderMode = "none" | "tiled" | "corners";

export type CornerStyle = "thin" | "thick" | "artistic";

export type BackgroundMode = "none" | "themed";

export interface GenerateOptions {
  prompt: string;
  colorCount: ColorCount;
  aspectRatio: AspectRatio;
  detailLevel: DetailLevel;
  borderMode: BorderMode;
  cornerStyle: CornerStyle;
  backgroundMode: BackgroundMode;
  imageDataUrl?: string;
}

export interface GenerateResponse {
  imageBase64: string;
  mimeType: string;
  promptUsed: string;
  colorCount: ColorCount;
  aspectRatio: AspectRatio;
  detailLevel: DetailLevel;
  borderMode: BorderMode;
  cornerStyle: CornerStyle;
  backgroundMode: BackgroundMode;
}

export interface GalleryItem {
  id: string;
  prompt: string;
  colorCount: ColorCount;
  aspectRatio: AspectRatio;
  detailLevel: DetailLevel;
  borderMode: BorderMode;
  cornerStyle: CornerStyle;
  backgroundMode: BackgroundMode;
  imageDataUrl: string;
  createdAt: string;
}

export const GALLERY_STORAGE_KEY = "mosaic-gallery-v1";
export const GALLERY_MAX_ITEMS = 50;
export const DEFAULT_COLOR_COUNT: ColorCount = 2;
export const COLOR_COUNT_OPTIONS: ColorCount[] = [2, 3, 4, 5];

export const DEFAULT_ASPECT_RATIO: AspectRatio = "1:1";
export const DEFAULT_ORIENTATION: Orientation = "square";
export const DEFAULT_DETAIL_LEVEL: DetailLevel = "simple";
export const DEFAULT_BORDER_MODE: BorderMode = "none";
export const DEFAULT_CORNER_STYLE: CornerStyle = "thin";
export const DEFAULT_BACKGROUND_MODE: BackgroundMode = "none";

export const ASPECT_RATIO_OPTIONS: AspectRatio[] = [
  "1:1",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "2:1",
  "1:2",
];

export const BORDER_MODE_OPTIONS: { value: BorderMode; label: string }[] = [
  { value: "none", label: "No border" },
  { value: "tiled", label: "Tiled" },
  { value: "corners", label: "Corners" },
];

export const CORNER_STYLE_OPTIONS: { value: CornerStyle; label: string }[] = [
  { value: "thin", label: "Thin" },
  { value: "thick", label: "Thick" },
  { value: "artistic", label: "Artistic" },
];

export const ORIENTATION_OPTIONS: {
  value: Orientation;
  label: string;
}[] = [
  { value: "square", label: "Square" },
  { value: "landscape", label: "Landscape" },
  { value: "portrait", label: "Portrait" },
];

export const PROPORTION_OPTIONS: Record<
  Orientation,
  { value: AspectRatio; label: string }[]
> = {
  square: [{ value: "1:1", label: "1:1" }],
  landscape: [
    { value: "4:3", label: "4:3" },
    { value: "3:2", label: "3:2" },
    { value: "16:9", label: "16:9" },
    { value: "2:1", label: "2:1" },
  ],
  portrait: [
    { value: "3:4", label: "3:4" },
    { value: "2:3", label: "2:3" },
    { value: "9:16", label: "9:16" },
    { value: "1:2", label: "1:2" },
  ],
};

export function orientationForAspect(ratio: AspectRatio): Orientation {
  if (ratio === "1:1") return "square";
  if (ratio === "4:3" || ratio === "3:2" || ratio === "16:9" || ratio === "2:1") {
    return "landscape";
  }
  return "portrait";
}

export function defaultAspectForOrientation(
  orientation: Orientation,
): AspectRatio {
  return PROPORTION_OPTIONS[orientation][0].value;
}
