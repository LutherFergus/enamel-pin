import { isSkinTone, skinScore } from './background'
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

/** Leftover studio white after imperfect knockout — don't spend a palette slot. */
function isLeftoverBackdrop(c: Rgb): boolean {
  return luminance(c) >= 248 && chroma(c) <= 12 && !isSkinTone(c)
}

/** Mid-to-vivid accents — enamel fills, not near-black metal. */
function isAccent(c: Rgb): boolean {
  const L = luminance(c)
  if (L < 28 || L > 245) return false
  return chroma(c) >= 32 || skinScore(c) > 0.12
}

/** Peak preference for mid-chroma / vivid enamel over gray ladders. */
function chromaBoost(ch01: number): number {
  // Mild at low chroma, strong through mid-vibrant (0.2–0.55), still up for brights.
  const mid = Math.exp(-Math.pow((ch01 - 0.38) / 0.22, 2))
  return 1.8 * ch01 + 7.5 * ch01 * ch01 + 4.2 * mid
}

type HistBin = {
  r: number
  g: number
  b: number
  n: number
  /** Subject-aware importance (not raw majority). */
  score: number
  chroma: number
  skin: number
}

/**
 * Subject-aware palette extraction for enamel fills.
 *
 * Learned from Vectorizer.AI / VectorQ motorcycle pin-up refs:
 *   black + light + 1–2 metal grays + bright accent + dark accent shade
 *   + skin + warm brown — even when accents/skin are minority area.
 *
 * Neutrals are capped so gray ladders cannot steal slots from subject color.
 */
export function extractPalette(
  imageData: ImageData,
  colorCount: number,
  sampleStep = 1,
): Rgb[] {
  const target = Math.max(2, Math.min(colorCount, 32))
  const { data, width, height } = imageData

  // Opaque centroid → spatial subject bias (edges/background weigh less).
  let sx = 0
  let sy = 0
  let sn = 0
  for (let y = 0; y < height; y += Math.max(2, sampleStep * 2)) {
    for (let x = 0; x < width; x += Math.max(2, sampleStep * 2)) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      sx += x
      sy += y
      sn++
    }
  }
  const cx = sn > 0 ? sx / sn : width / 2
  const cy = sn > 0 ? sy / sn : height / 2
  const maxDist = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) || 1

  const counts = new Float64Array(BIN * BIN * BIN)
  const sumR = new Float64Array(BIN * BIN * BIN)
  const sumG = new Float64Array(BIN * BIN * BIN)
  const sumB = new Float64Array(BIN * BIN * BIN)
  const weightSum = new Float64Array(BIN * BIN * BIN)

  let totalW = 0
  let totalN = 0
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const pixel = { r, g, b }
      if (isLeftoverBackdrop(pixel)) continue
      const ch = chroma(pixel) / 255
      const lum = luminance(pixel)
      // Drawn black outline ink is metal, not an enamel fill — don't let it
      // inflate dark muddy bins that steal slots from real colors.
      if (lum <= 28 && chroma(pixel) < 26) continue
      const skin = skinScore(pixel)
      const dist = Math.hypot(x - cx, y - cy) / maxDist
      // Center/subject bias + mid-vibrant chroma peak (prefer enamel over gray).
      const spatial = 0.55 + 0.45 * (1 - dist)
      const importance = spatial * (1 + chromaBoost(ch) + 5.5 * skin)

      const br = Math.min(BIN - 1, (r * BIN) >> 8)
      const bg = Math.min(BIN - 1, (g * BIN) >> 8)
      const bb = Math.min(BIN - 1, (b * BIN) >> 8)
      const idx = (br * BIN + bg) * BIN + bb
      counts[idx] += 1
      sumR[idx] += r
      sumG[idx] += g
      sumB[idx] += b
      weightSum[idx] += importance
      totalW += importance
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
    const c: Rgb = {
      r: Math.round(sumR[i] / n),
      g: Math.round(sumG[i] / n),
      b: Math.round(sumB[i] / n),
    }
    const ch = chroma(c)
    const skin = skinScore(c)
    const score = weightSum[i] / totalW
    bins.push({ ...c, n, score, chroma: ch, skin })
  }

  bins.sort((a, b) => b.score - a.score)

  const selected: Array<Rgb & { n: number; score: number; chroma: number; skin: number }> =
    []

  const neutralCap = Math.max(1, Math.ceil(target * 0.28))
  let neutralCount = 0

  const tryAdd = (bin: HistBin, minDist: number): boolean => {
    for (const s of selected) {
      if (dist2(bin, s) < minDist * minDist) return false
    }
    const neutral = isNeutral(bin)
    if (neutral && neutralCount >= neutralCap) return false
    selected.push({
      r: bin.r,
      g: bin.g,
      b: bin.b,
      n: bin.n,
      score: bin.score,
      chroma: bin.chroma,
      skin: bin.skin,
    })
    if (neutral) neutralCount++
    return true
  }

  // 1) Structural extremes first — only when they cover meaningful area.
  const darkN = bins
    .filter((b) => luminance(b) < 28)
    .reduce((s, b) => s + b.n, 0)
  const lightN = bins
    .filter((b) => luminance(b) > 232 && chroma(b) < 22)
    .reduce((s, b) => s + b.n, 0)
  if (darkN / totalN > 0.004) {
    ensureExtreme(bins, selected, target, true, () => {
      neutralCount++
    })
  }
  if (lightN / totalN > 0.004) {
    ensureExtreme(bins, selected, target, false, () => {
      neutralCount++
    })
  }

  // 1b) Force best skin/flesh bin if present (minority area, high subject value).
  ensureSkin(bins, selected, target)

  // 2) Subject accents + skin BEFORE majority neutrals (~55% of slots).
  const accentSlots = Math.max(3, Math.round(target * 0.55))
  const accents = [...bins].sort((a, b) => {
    const La = luminance(a)
    const Lb = luminance(b)
    const midA = 1 - Math.abs(La - 140) / 180
    const midB = 1 - Math.abs(Lb - 140) / 180
    const sa =
      (a.chroma / 255) * 3.4 +
      midA * 0.9 +
      a.skin * 3.5 +
      Math.log2(2 + a.n) * 0.12
    const sb =
      (b.chroma / 255) * 3.4 +
      midB * 0.9 +
      b.skin * 3.5 +
      Math.log2(2 + b.n) * 0.12
    return sb - sa
  })
  for (const bin of accents) {
    if (selected.length >= Math.min(target, 2 + accentSlots)) break
    if (!isAccent(bin) && bin.skin < 0.1) continue
    tryAdd(bin, 34)
  }

  // 3) Shade companions for accents (dark red under bright red, etc.).
  for (const bin of bins) {
    if (selected.length >= target) break
    if (bin.chroma < 32) continue
    // Prefer darker/lighter sibling of an already-selected accent hue family.
    const related = selected.some((s) => {
      if (s.chroma < 32) return false
      const hueDist =
        Math.abs(s.r - bin.r) + Math.abs(s.g - bin.g) + Math.abs(s.b - bin.b)
      const lumGap = Math.abs(luminance(s) - luminance(bin))
      return hueDist < 160 && lumGap > 25 && lumGap < 120
    })
    if (!related) continue
    tryAdd(bin, 32)
  }

  // 4) Remaining — chromatic bins first, then neutrals under cap.
  for (const bin of bins) {
    if (selected.length >= target) break
    if (isNeutral(bin) && bin.skin < 0.08) continue
    tryAdd(bin, 30)
  }
  for (const bin of bins) {
    if (selected.length >= target) break
    tryAdd(bin, 28)
  }

  // Fill if accent-first left gaps (rare).
  for (const bin of bins) {
    if (selected.length >= target) break
    tryAdd(bin, 24)
  }

  // Order: importance score first so PMS snap / UI show subject colors early,
  // with population as tie-breaker.
  selected.sort((a, b) => b.score - a.score || b.n - a.n)

  return refinePalette(
    imageData,
    selected.map(({ r, g, b }) => ({ r, g, b })),
    sampleStep,
  )
}

function ensureSkin(
  bins: HistBin[],
  selected: Array<Rgb & { n: number; score: number; chroma: number; skin: number }>,
  target: number,
) {
  const skinBins = bins
    .filter((b) => b.skin > 0.12 && b.n >= 8)
    .sort((a, b) => b.skin * Math.log2(2 + b.n) - a.skin * Math.log2(2 + a.n))
  if (!skinBins.length) return
  const best = skinBins[0]
  if (selected.some((s) => dist2(s, best) < 40 * 40)) return

  const push = () => {
    selected.push({
      r: best.r,
      g: best.g,
      b: best.b,
      n: best.n,
      score: best.score,
      chroma: best.chroma,
      skin: best.skin,
    })
  }

  if (selected.length < target) {
    push()
    return
  }
  // Replace weakest non-accent neutral to make room for skin.
  let worst = -1
  let worstScore = Infinity
  for (let i = 0; i < selected.length; i++) {
    const s = selected[i]
    if (s.skin > 0.1 || s.chroma >= 45) continue
    const lum = luminance(s)
    if (lum < 30 || lum > 235) continue // keep black/white
    if (s.score < worstScore) {
      worstScore = s.score
      worst = i
    }
  }
  if (worst >= 0) {
    selected[worst] = {
      r: best.r,
      g: best.g,
      b: best.b,
      n: best.n,
      score: best.score,
      chroma: best.chroma,
      skin: best.skin,
    }
  }
}

function ensureExtreme(
  bins: HistBin[],
  selected: Array<Rgb & { n: number; score: number; chroma: number; skin: number }>,
  target: number,
  wantBlack: boolean,
  onAdd?: () => void,
) {
  const extreme = bins.find((b) =>
    wantBlack
      ? luminance(b) < 28 && b.n > 0
      : luminance(b) > 232 && chroma(b) < 22 && b.n > 0,
  )
  if (!extreme) return
  if (selected.some((s) => dist2(s, extreme) < 35 * 35)) return
  if (selected.length >= target) {
    // Replace weakest neutral midtone.
    let worst = -1
    let worstScore = Infinity
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i]
      if (!isNeutral(s)) continue
      const lum = luminance(s)
      if (lum < 40 || lum > 220) continue
      if (s.score < worstScore) {
        worstScore = s.score
        worst = i
      }
    }
    if (worst >= 0) {
      selected[worst] = {
        r: extreme.r,
        g: extreme.g,
        b: extreme.b,
        n: extreme.n,
        score: extreme.score,
        chroma: extreme.chroma,
        skin: extreme.skin,
      }
    }
    return
  }
  selected.push({
    r: extreme.r,
    g: extreme.g,
    b: extreme.b,
    n: extreme.n,
    score: extreme.score,
    chroma: extreme.chroma,
    skin: extreme.skin,
  })
  onAdd?.()
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
        // Keep mid-vibrant pixels from collapsing into darker majority slots.
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

export function quantizeImage(imageData: ImageData, palette: Rgb[]): Uint16Array {
  const { data, width, height } = imageData
  const labels = new Uint16Array(width * height)
  // Darkest low-chroma slot = metal wall / outline ink.
  let blackIdx = 0
  let blackLum = Infinity
  for (let c = 0; c < palette.length; c++) {
    const L = luminance(palette[c])
    if (chroma(palette[c]) < 40 && L < blackLum) {
      blackLum = L
      blackIdx = c
    }
  }
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (data[o + 3] < 128) {
      labels[i] = 0xffff
      continue
    }
    const pixel = { r: data[o], g: data[o + 1], b: data[o + 2] }
    if (isLeftoverBackdrop(pixel)) {
      labels[i] = 0xffff
      continue
    }
    // Snap drawn outline ink straight to metal black — stops navy/brown fringes.
    if (luminance(pixel) <= 26 && chroma(pixel) < 30 && blackLum < 40) {
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
