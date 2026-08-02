import { isSkinTone } from './background'
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

function isNeutral(c: Rgb): boolean {
  return chroma(c) < 28
}

/** Mid-luminance neutrals used as enamel fills (fur highlights, metal, skull). */
function isMetalGray(c: Rgb): boolean {
  const L = luminance(c)
  const ch = chroma(c)
  return ch < 28 && L >= 48 && L <= 200
}

type HistBin = {
  r: number
  g: number
  b: number
  n: number
}

/**
 * Palette from subject pixel percentages after background removal.
 *
 * Opaque pixels only (alpha already cleared outside the subject). Colors are
 * ranked by area share; similar bins merge via a minimum RGB distance so the
 * top N slots match Vectorizer.AI-style dominant-color control.
 */
export function extractPalette(
  imageData: ImageData,
  colorCount: number,
  sampleStep = 1,
  flatArt = false,
  /** Kept for call-site compat; exterior knockout is handled in removeBackground. */
  _clearBackdrop = true,
  /** When true, skip black ink — outline plate owns metal walls. */
  enamelFillsOnly = false,
): Rgb[] {
  const target = Math.max(2, Math.min(colorCount, 32))
  const { data, width, height } = imageData

  const counts = new Float64Array(BIN * BIN * BIN)
  const sumR = new Float64Array(BIN * BIN * BIN)
  const sumG = new Float64Array(BIN * BIN * BIN)
  const sumB = new Float64Array(BIN * BIN * BIN)

  let totalN = 0
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const lum = luminance({ r, g, b })
      const ch = chroma({ r, g, b })
      // Drawn black outline ink is metal, not an enamel fill.
      if (enamelFillsOnly && lum <= 32 && ch < 34) continue

      const br = Math.min(BIN - 1, (r * BIN) >> 8)
      const bg = Math.min(BIN - 1, (g * BIN) >> 8)
      const bb = Math.min(BIN - 1, (b * BIN) >> 8)
      const idx = (br * BIN + bg) * BIN + bb
      counts[idx] += 1
      sumR[idx] += r
      sumG[idx] += g
      sumB[idx] += b
      totalN += 1
    }
  }

  if (totalN === 0) {
    return Array.from({ length: target }, () => ({ r: 200, g: 200, b: 200 }))
  }

  const bins: HistBin[] = []
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i]
    if (n < 1) continue
    bins.push({
      r: Math.round(sumR[i] / n),
      g: Math.round(sumG[i] / n),
      b: Math.round(sumB[i] / n),
      n,
    })
  }

  // Largest subject areas first.
  bins.sort((a, b) => b.n - a.n)

  const minDist = flatArt ? 38 : 28
  const selected: Array<Rgb & { n: number }> = []

  const tryAdd = (bin: HistBin, gap: number): boolean => {
    for (const s of selected) {
      if (dist2(bin, s) < gap * gap) return false
    }
    selected.push({ r: bin.r, g: bin.g, b: bin.b, n: bin.n })
    return true
  }

  // Seed true black / white when they own meaningful subject area.
  const darkShare =
    bins.filter((b) => luminance(b) < 28).reduce((s, b) => s + b.n, 0) / totalN
  const lightShare =
    bins
      .filter((b) => luminance(b) > 232 && chroma(b) < 22)
      .reduce((s, b) => s + b.n, 0) / totalN

  if (!enamelFillsOnly && darkShare > 0.004) {
    const black = bins.find((b) => luminance(b) < 28)
    if (black) tryAdd(black, minDist)
  }
  if (lightShare > 0.002) {
    const white = bins.find((b) => luminance(b) > 232 && chroma(b) < 22)
    if (white) tryAdd(white, minDist)
  }

  for (const bin of bins) {
    if (selected.length >= target) break
    tryAdd(bin, minDist)
  }
  // Relax distance if we still have empty slots.
  if (selected.length < target) {
    for (const bin of bins) {
      if (selected.length >= target) break
      tryAdd(bin, Math.max(16, minDist - 10))
    }
  }

  const refined = refinePalette(
    imageData,
    selected.map(({ r, g, b }) => ({ r, g, b })),
    sampleStep,
  )

  // Keep display order = area share (largest first) using pre-refine counts.
  const order = selected
    .map((s, i) => ({ i, n: s.n }))
    .sort((a, b) => b.n - a.n)
  return order.map((o) => refined[o.i])
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
        // Slight bias: keep chromatic pixels from collapsing into neutrals.
        const neutralPenalty =
          isNeutral(palette[c]) && chroma(pixel) > 36 ? 28 * 28 : 0
        const dullPenalty =
          chroma(palette[c]) < 30 && chroma(pixel) >= 50 ? 22 * 22 : 0
        const dd = d + neutralPenalty + dullPenalty
        if (dd < bestD) {
          bestD = dd
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
    const next = {
      r: Math.round(sums[i].r / sums[i].n),
      g: Math.round(sums[i].g / sums[i].n),
      b: Math.round(sums[i].b / sums[i].n),
    }
    // Freeze vivid seeds — don't let area-weighted refine mute them.
    if (chroma(c) >= 55 && chroma(next) < chroma(c) * 0.72) {
      return c
    }
    return next
  })
}

export function quantizeImage(
  imageData: ImageData,
  palette: Rgb[],
  opts: { clearBackdrop?: boolean; enamelFillsOnly?: boolean } = {},
): Uint16Array {
  const enamelFillsOnly = opts.enamelFillsOnly === true
  const { data, width, height } = imageData
  const labels = new Uint16Array(width * height)
  // Darkest low-chroma slot = metal wall / outline ink.
  let blackIdx = 0
  let blackLum = Infinity
  let whiteIdx = -1
  let whiteLum = -1
  for (let c = 0; c < palette.length; c++) {
    const L = luminance(palette[c])
    const ch = chroma(palette[c])
    if (ch < 40 && L < blackLum) {
      blackLum = L
      blackIdx = c
    }
    if (ch < 22 && L > whiteLum) {
      whiteLum = L
      whiteIdx = c
    }
  }
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (data[o + 3] < 128) {
      labels[i] = 0xffff
      continue
    }
    const pixel = { r: data[o], g: data[o + 1], b: data[o + 2] }
    // Pre-inked cartoons: black linework belongs on the outline plate.
    if (enamelFillsOnly && luminance(pixel) <= 34 && chroma(pixel) < 36) {
      labels[i] = 0xffff
      continue
    }
    // Snap paper/foam/apron whites to the white slot.
    if (
      whiteIdx >= 0 &&
      whiteLum > 230 &&
      luminance(pixel) >= 235 &&
      chroma(pixel) <= 20
    ) {
      labels[i] = whiteIdx
      continue
    }
    // Snap drawn outline ink straight to metal black — stops navy/brown fringes.
    if (
      !enamelFillsOnly &&
      luminance(pixel) <= 32 &&
      chroma(pixel) < 34 &&
      blackLum < 45
    ) {
      labels[i] = blackIdx
      continue
    }
    let best = 0
    let bestDist = Infinity
    for (let c = 0; c < palette.length; c++) {
      let d = colorDistance(pixel, palette[c])
      // Keep reds/skin from snapping into nearby grays.
      if (isNeutral(palette[c]) && (chroma(pixel) > 40 || isSkinTone(pixel))) d += 28
      if (isSkinTone(pixel) && !isSkinTone(palette[c]) && chroma(palette[c]) < 35) d += 35
      // Prefer true white for near-white fills (apron, foam, diamonds).
      if (
        luminance(pixel) > 235 &&
        chroma(pixel) < 20 &&
        luminance(palette[c]) > 235 &&
        chroma(palette[c]) < 25
      ) {
        d -= 18
      }
      // Mid-gray fur / metal must not collapse into near-black metal.
      if (isMetalGray(pixel)) {
        if (isMetalGray(palette[c])) d -= 22
        else if (luminance(palette[c]) < 40 && chroma(palette[c]) < 40) d += 40
      }
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
