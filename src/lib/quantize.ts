import type { Rgb } from './types'
import { colorDistance } from './types'

const BIN = 24 // 24^3 histogram — fine enough for enamel fill slots

function chroma(c: Rgb): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
}

function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

function dist2(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r
  const dg = a.g - b.g
  const db = a.b - b.b
  return dr * dr + dg * dg + db * db
}

type HistBin = {
  r: number
  g: number
  b: number
  n: number
  /** Weighted score favoring population, then chroma accents. */
  score: number
}

/**
 * Majority-first palette extraction for enamel fills.
 *
 * Slot budget (approx):
 *   ~55% primary   — highest pixel-count colors
 *   ~25% secondary — next distinct population peaks
 *   ~20% tertiary  — high-chroma accent / detail colors
 *
 * Colors that dominate the image always win slots first.
 */
export function extractPalette(
  imageData: ImageData,
  colorCount: number,
  sampleStep = 1,
): Rgb[] {
  const target = Math.max(2, Math.min(colorCount, 32))
  const { data, width, height } = imageData

  const counts = new Float64Array(BIN * BIN * BIN)
  const sumR = new Float64Array(BIN * BIN * BIN)
  const sumG = new Float64Array(BIN * BIN * BIN)
  const sumB = new Float64Array(BIN * BIN * BIN)

  let total = 0
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const br = Math.min(BIN - 1, (r * BIN) >> 8)
      const bg = Math.min(BIN - 1, (g * BIN) >> 8)
      const bb = Math.min(BIN - 1, (b * BIN) >> 8)
      const idx = (br * BIN + bg) * BIN + bb
      counts[idx] += 1
      sumR[idx] += r
      sumG[idx] += g
      sumB[idx] += b
      total += 1
    }
  }

  if (total === 0) {
    return Array.from({ length: target }, () => ({ r: 200, g: 200, b: 200 }))
  }

  const bins: HistBin[] = []
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i]
    if (n < 1) continue
    const c: Rgb = {
      r: Math.round(sumR[i] / n),
      g: Math.round(sumG[i] / n),
      b: Math.round(sumB[i] / n),
    }
    // Population is primary; chroma boost keeps detail reds/golds/etc alive.
    const pop = n / total
    const ch = chroma(c) / 255
    const score = pop * 1.0 + ch * ch * 0.18
    bins.push({ ...c, n, score })
  }

  bins.sort((a, b) => b.score - a.score)

  const primarySlots = Math.max(2, Math.round(target * 0.55))
  const secondarySlots = Math.max(1, Math.round(target * 0.25))
  // Remaining slots (~20%) reserved for tertiary accent pass below.

  const selected: Array<Rgb & { n: number }> = []

  const tryAdd = (bin: HistBin, minDist: number): boolean => {
    for (const s of selected) {
      if (dist2(bin, s) < minDist * minDist) return false
    }
    selected.push({ r: bin.r, g: bin.g, b: bin.b, n: bin.n })
    return true
  }

  // Primary: strongest population peaks, looser separation.
  for (const bin of bins) {
    if (selected.length >= primarySlots) break
    tryAdd(bin, 28)
  }

  // Secondary: next distinct peaks.
  for (const bin of bins) {
    if (selected.length >= primarySlots + secondarySlots) break
    tryAdd(bin, 36)
  }

  // Tertiary: prefer saturated accents / detail colors not yet represented.
  const accents = [...bins].sort((a, b) => {
    const ca = chroma(a) * Math.log2(2 + a.n)
    const cb = chroma(b) * Math.log2(2 + b.n)
    return cb - ca
  })
  for (const bin of accents) {
    if (selected.length >= target) break
    if (chroma(bin) < 28 && luminance(bin) > 40 && luminance(bin) < 220) continue
    tryAdd(bin, 42)
  }

  // Fill remaining from population list if accents didn't fill.
  for (const bin of bins) {
    if (selected.length >= target) break
    tryAdd(bin, 32)
  }

  // Always keep a near-black and near-white if present in image and slots allow.
  ensureExtreme(bins, selected, target, true)
  ensureExtreme(bins, selected, target, false)

  // Order by majority (pixel count) so PMS snap prioritizes dominant fills.
  selected.sort((a, b) => b.n - a.n)

  // Refine centers with one pass of weighted means from original pixels.
  return refinePalette(
    imageData,
    selected.map(({ r, g, b }) => ({ r, g, b })),
    sampleStep,
  )
}

function ensureExtreme(
  bins: HistBin[],
  selected: Array<Rgb & { n: number }>,
  target: number,
  wantBlack: boolean,
) {
  const extreme = bins.find((b) =>
    wantBlack
      ? luminance(b) < 28 && b.n > 0
      : luminance(b) > 235 && chroma(b) < 20 && b.n > 0,
  )
  if (!extreme) return
  if (selected.some((s) => dist2(s, extreme) < 35 * 35)) return
  if (selected.length < target) {
    selected.push({ r: extreme.r, g: extreme.g, b: extreme.b, n: extreme.n })
    return
  }
  // Replace the least-populated low-chroma midtone if needed.
  let worst = -1
  let worstN = Infinity
  for (let i = 0; i < selected.length; i++) {
    const s = selected[i]
    if (chroma(s) > 40) continue
    const lum = luminance(s)
    if (lum < 40 || lum > 220) continue
    if (s.n < worstN) {
      worstN = s.n
      worst = i
    }
  }
  if (worst >= 0 && extreme.n >= worstN) {
    selected[worst] = { r: extreme.r, g: extreme.g, b: extreme.b, n: extreme.n }
  }
}

function refinePalette(imageData: ImageData, palette: Rgb[], sampleStep: number): Rgb[] {
  const { data, width, height } = imageData
  const sums = palette.map(() => ({ r: 0, g: 0, b: 0, n: 0 }))

  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      const pixel = { r: data[i], g: data[i + 1], b: data[i + 2] }
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < palette.length; c++) {
        const d = dist2(pixel, palette[c])
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      sums[best].r += pixel.r
      sums[best].g += pixel.g
      sums[best].b += pixel.b
      sums[best].n += 1
    }
  }

  return palette.map((c, i) => {
    if (sums[i].n === 0) return c
    return {
      r: Math.round(sums[i].r / sums[i].n),
      g: Math.round(sums[i].g / sums[i].n),
      b: Math.round(sums[i].b / sums[i].n),
    }
  })
}

export function quantizeImage(imageData: ImageData, palette: Rgb[]): Uint16Array {
  const { data, width, height } = imageData
  const labels = new Uint16Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (data[o + 3] < 128) {
      labels[i] = 0xffff
      continue
    }
    const pixel = { r: data[o], g: data[o + 1], b: data[o + 2] }
    let best = 0
    let bestDist = Infinity
    for (let c = 0; c < palette.length; c++) {
      const d = colorDistance(pixel, palette[c])
      if (d < bestDist) {
        bestDist = d
        best = c
      }
    }
    labels[i] = best
  }
  return labels
}

/** Pixel counts per palette index (skips transparent 0xffff). */
export function countLabelUsage(labels: Uint16Array, colorCount: number): number[] {
  const counts = Array.from({ length: colorCount }, () => 0)
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i]
    if (v !== 0xffff && v < colorCount) counts[v]++
  }
  return counts
}

/** Majority-vote cleanup to reduce speckles before region merge. */
export function denoiseLabels(
  labels: Uint16Array,
  width: number,
  height: number,
  passes = 1,
): Uint16Array {
  let current = labels
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint16Array(current)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        if (current[i] === 0xffff) continue
        const counts = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = current[(y + dy) * width + (x + dx)]
            if (v === 0xffff) continue
            counts.set(v, (counts.get(v) ?? 0) + 1)
          }
        }
        let best = current[i]
        let bestCount = -1
        for (const [label, count] of counts) {
          if (count > bestCount) {
            bestCount = count
            best = label
          }
        }
        next[i] = best
      }
    }
    current = next
  }
  return current
}
