import pmsData from '../data/pms-enamel.json'
import type { Rgb } from './types'
import { rgbToHex } from './types'

export type PmsColor = {
  /** e.g. "185 C" or "Black C" */
  code: string
  /** Display name e.g. "PMS 185 C" */
  name: string
  r: number
  g: number
  b: number
  hex: string
  lab: { L: number; a: number; b: number }
}

type CompactRow = [string, number, number, number, number, number, number]

const rows = pmsData.colors as CompactRow[]

let cached: PmsColor[] | null = null

/** Soft-enamel pin PMS chart (~150 Solid Coated fills). */
export function getPmsChart(): PmsColor[] {
  if (cached) return cached
  cached = rows.map(([code, r, g, b, L, a, B]) => ({
    code,
    name: `PMS ${code}`,
    r,
    g,
    b,
    hex: rgbToHex({ r, g, b }),
    lab: { L, a, b: B },
  }))
  return cached
}

export function getPmsBookNote(): string {
  return pmsData.note
}

export function getPmsChartSize(): number {
  return rows.length
}

/** sRGB 0–255 → CIE Lab (D65). */
export function rgbToLab({ r, g, b }: Rgb): { L: number; a: number; b: number } {
  let R = r / 255
  let G = g / 255
  let Bl = b / 255
  R = R > 0.04045 ? ((R + 0.055) / 1.055) ** 2.4 : R / 12.92
  G = G > 0.04045 ? ((G + 0.055) / 1.055) ** 2.4 : G / 12.92
  Bl = Bl > 0.04045 ? ((Bl + 0.055) / 1.055) ** 2.4 : Bl / 12.92

  let x = (R * 0.4124 + G * 0.3576 + Bl * 0.1805) / 0.95047
  let y = (R * 0.2126 + G * 0.7152 + Bl * 0.0722) / 1.0
  let z = (R * 0.0193 + G * 0.1192 + Bl * 0.9505) / 1.08883

  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  x = f(x)
  y = f(y)
  z = f(z)

  return {
    L: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z),
  }
}

/** CIE76 ΔE — good enough for nearest PMS lookup. */
export function deltaE76(
  a: { L: number; a: number; b: number },
  b: { L: number; a: number; b: number },
): number {
  const dL = a.L - b.L
  const da = a.a - b.a
  const db = a.b - b.b
  return Math.sqrt(dL * dL + da * da + db * db)
}

export type PmsMatch = {
  pms: PmsColor
  deltaE: number
}

/** Find nearest PMS Solid Coated color for an RGB sample. */
export function nearestPms(rgb: Rgb, chart = getPmsChart()): PmsMatch {
  const lab = rgbToLab(rgb)
  let best = chart[0]
  let bestDe = Infinity
  for (const c of chart) {
    const de = deltaE76(lab, c.lab)
    if (de < bestDe) {
      bestDe = de
      best = c
    }
  }
  return { pms: best, deltaE: bestDe }
}

/**
 * Snap palette RGB → PMS.
 * When `areas` is provided, majority colors are assigned first so primary
 * fills keep their true nearest swatch. If uniqueness would force a large
 * ΔE jump, keep the vivid source RGB (still report nearest PMS metadata).
 */
export function snapPaletteToPms(
  palette: Rgb[],
  opts: {
    unique?: boolean
    areas?: number[]
    maxDeltaE?: number
    /** When > 0, near-matches may reuse an already-assigned PMS code. */
    shareWithinDeltaE?: number
  } = {},
): Array<{ rgb: Rgb; match: PmsMatch }> {
  const unique = opts.unique ?? true
  const maxDeltaE = opts.maxDeltaE ?? 22
  const shareWithin = Math.max(0, opts.shareWithinDeltaE ?? 0)
  const chart = getPmsChart()
  const used = new Set<string>()
  const out: Array<{ rgb: Rgb; match: PmsMatch } | null> = Array.from(
    { length: palette.length },
    () => null,
  )

  const order = palette.map((_, i) => i)
  if (opts.areas && opts.areas.length === palette.length) {
    order.sort((a, b) => (opts.areas![b] ?? 0) - (opts.areas![a] ?? 0))
  }

  for (const index of order) {
    const color = palette[index]
    const lab = rgbToLab(color)
    const ranked = chart
      .map((pms) => ({ pms, deltaE: deltaE76(lab, pms.lab) }))
      .sort((a, b) => a.deltaE - b.deltaE)

    let chosen = ranked[0]
    if (unique) {
      // Share the true nearest swatch when it's already used and close enough.
      if (
        shareWithin > 0 &&
        used.has(ranked[0].pms.code) &&
        ranked[0].deltaE <= shareWithin
      ) {
        chosen = ranked[0]
      } else {
        const free = ranked.find((m) => !used.has(m.pms.code))
        if (free) {
          // Don't mute a vivid primary just to satisfy uniqueness.
          if (free.deltaE <= maxDeltaE || free.deltaE <= ranked[0].deltaE + 6) {
            chosen = free
          } else {
            // Keep source RGB; metadata still points at true nearest PMS.
            chosen = ranked[0]
          }
        }
      }
    }

    used.add(chosen.pms.code)

    const srcChroma =
      Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b)
    const pmsChroma =
      Math.max(chosen.pms.r, chosen.pms.g, chosen.pms.b) -
      Math.min(chosen.pms.r, chosen.pms.g, chosen.pms.b)
    // Never mute skin/accent hues into a flat gray PMS swatch.
    const wouldMuteAccent = srcChroma >= 40 && pmsChroma < srcChroma * 0.55
    const useSource = chosen.deltaE > maxDeltaE || wouldMuteAccent

    out[index] = {
      rgb: useSource
        ? { r: color.r, g: color.g, b: color.b }
        : { r: chosen.pms.r, g: chosen.pms.g, b: chosen.pms.b },
      match: chosen,
    }
  }

  return out.map((entry, i) => {
    if (entry) return entry
    const match = nearestPms(palette[i], chart)
    return {
      rgb: { r: match.pms.r, g: match.pms.g, b: match.pms.b },
      match,
    }
  })
}

export function findPmsByCode(code: string): PmsColor | undefined {
  const normalized = code
    .trim()
    .replace(/^pms\s+/i, '')
    .replace(/^pantone\s+/i, '')
    .toUpperCase()
  return getPmsChart().find(
    (c) =>
      c.code.toUpperCase() === normalized ||
      c.code.toUpperCase().replace(/\s+/g, '') === normalized.replace(/\s+/g, ''),
  )
}

export function searchPms(query: string, limit = 160): PmsColor[] {
  const q = query.trim().toLowerCase()
  const chart = getPmsChart()
  if (!q) return chart.slice(0, limit)
  const hits: PmsColor[] = []
  for (const c of chart) {
    if (
      c.code.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.hex.toLowerCase().includes(q)
    ) {
      hits.push(c)
      if (hits.length >= limit) break
    }
  }
  return hits
}
