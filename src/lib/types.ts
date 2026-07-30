export type Rgb = { r: number; g: number; b: number }

export type EnamelSettings = {
  /** Number of enamel fill colors (metal outline is separate). */
  colorCount: number
  /** Finished pin width in millimeters. */
  pinWidthMm: number
  /** Finished pin height in millimeters. Null = keep image aspect. */
  pinHeightMm: number | null
  /** Working resolution used for mm → px conversion. */
  dpi: number
  /** Minimum enamel fill feature size in mm (small regions get merged). */
  minFillMm: number
  /** Metal wall / outline stroke width in mm. */
  metalWallMm: number
  /** Outline color (soft enamel metal lines). */
  outlineColor: string
  /** Smooth contours before export (0–8). */
  smoothness: number
}

export type PaletteColor = Rgb & {
  hex: string
  index: number
  /** Nearest / assigned Pantone Solid Coated code, e.g. "185 C". */
  pmsCode?: string
  /** Display label e.g. "PMS 185 C". */
  pmsName?: string
  /** ΔE distance from the pre-snap RGB sample to the PMS swatch. */
  pmsDeltaE?: number
}

export type VectorizeResult = {
  svg: string
  widthPx: number
  heightPx: number
  widthMm: number
  heightMm: number
  palette: PaletteColor[]
  regionCount: number
}

export const DEFAULT_SETTINGS: EnamelSettings = {
  colorCount: 6,
  pinWidthMm: 38,
  pinHeightMm: null,
  dpi: 300,
  minFillMm: 0.6,
  metalWallMm: 0.25,
  outlineColor: '#1a1a1a',
  smoothness: 2,
}

export function mmToPx(mm: number, dpi: number): number {
  return (mm / 25.4) * dpi
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

export function hexToRgb(hex: string): Rgb {
  const cleaned = hex.replace('#', '')
  const full =
    cleaned.length === 3
      ? cleaned
          .split('')
          .map((c) => c + c)
          .join('')
      : cleaned
  const n = Number.parseInt(full, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}
