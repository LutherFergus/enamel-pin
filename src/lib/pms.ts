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

/** Snap a palette of RGB colors onto unique nearest PMS swatches when possible. */
export function snapPaletteToPms(
  palette: Rgb[],
  opts: { unique?: boolean } = {},
): Array<{ rgb: Rgb; match: PmsMatch }> {
  const unique = opts.unique ?? true
  const chart = getPmsChart()
  const used = new Set<string>()
  const out: Array<{ rgb: Rgb; match: PmsMatch }> = []

  for (const color of palette) {
    const lab = rgbToLab(color)
    const ranked = chart
      .map((pms) => ({ pms, deltaE: deltaE76(lab, pms.lab) }))
      .sort((a, b) => a.deltaE - b.deltaE)

    let chosen = ranked[0]
    if (unique) {
      const free = ranked.find((m) => !used.has(m.pms.code))
      if (free) chosen = free
    }
    used.add(chosen.pms.code)
    out.push({
      rgb: { r: chosen.pms.r, g: chosen.pms.g, b: chosen.pms.b },
      match: chosen,
    })
  }
  return out
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
