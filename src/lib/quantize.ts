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

/** Leftover studio white after imperfect knockout — unused; exterior clear is
 * edge-flood only so interior whites (apron/foam) stay enamel fills. */
function isNearPaperWhite(c: Rgb): boolean {
  return luminance(c) >= 242 && chroma(c) <= 14 && !isSkinTone(c)
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
 * Neutrals are capped so endless gray ladders can’t steal every slot —
 * but dominant mid-grays (fur highlights, metal, skull shading) are reserved.
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
      const ch = chroma(pixel) / 255
      const lum = luminance(pixel)
      // Drawn black outline ink is metal, not an enamel fill.
      if (enamelFillsOnly && lum <= 32 && chroma(pixel) < 34) continue
      if (!enamelFillsOnly && lum <= 28 && chroma(pixel) < 26) {
        // Still counted via extremes path; skip accent weighting.
      }
      const skin = skinScore(pixel)
      const dist = Math.hypot(x - cx, y - cy) / maxDist
      // Center/subject bias + mid-vibrant chroma peak (prefer enamel over gray).
      // Boost near-white fills so apron/foam/diamonds keep a palette slot.
      // Mid-gray fur / metal also needs weight — otherwise oranges steal every slot.
      const whiteBoost = isNearPaperWhite(pixel) ? 2.8 : 0
      const grayBoost = isMetalGray(pixel) ? 2.4 : 0
      const spatial = 0.55 + 0.45 * (1 - dist)
      const importance =
        spatial * (1 + chromaBoost(ch) + 5.5 * skin + whiteBoost + grayBoost)

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

  const grayAreaFrac =
    bins.filter((b) => isMetalGray(b)).reduce((s, b) => s + b.n, 0) / totalN
  // More room for neutrals when mid-gray is a real subject color (cat fur, etc.).
  const neutralCap = Math.max(
    1,
    Math.ceil(target * (grayAreaFrac >= 0.04 ? 0.42 : 0.28)),
  )
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
  if (!enamelFillsOnly && darkN / totalN > 0.004) {
    ensureExtreme(bins, selected, target, true, () => {
      neutralCount++
    })
  }
  if (lightN / totalN > 0.002) {
    ensureExtreme(bins, selected, target, false, () => {
      neutralCount++
    })
    // Prefer a true paper white seed when near-white is present.
    if (!selected.some((s) => luminance(s) > 245 && chroma(s) < 16)) {
      const paper = bins
        .filter((b) => luminance(b) > 240 && chroma(b) < 18)
        .sort((a, b) => b.n - a.n)[0]
      if (paper && selected.length < target) {
        selected.push({
          r: Math.max(paper.r, 250),
          g: Math.max(paper.g, 250),
          b: Math.max(paper.b, 250),
          n: paper.n,
          score: paper.score,
          chroma: chroma({ r: 252, g: 252, b: 252 }),
          skin: 0,
        })
        neutralCount++
      }
    }
  }

  // 1b) Force best skin/flesh bin if present (minority area, high subject value).
  ensureSkin(bins, selected, target)

  // 1c) Reserve dominant mid-grays before orange shade ladders fill every slot.
  const grayAdded = ensureMetalGrays(bins, selected, target, totalN)
  neutralCount += grayAdded

  // 2) Subject accents + skin BEFORE majority neutrals (~55% of slots).
  const accentSlots = Math.max(3, Math.round(target * 0.55))
  const accentMinDist = flatArt ? 44 : 34
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
    tryAdd(bin, accentMinDist)
  }

  // 3) Shade companions for accents (dark red under bright red, etc.).
  // Flat clipart is already flat enamel — skip shade ladders (they become
  // duplicate reds / muddy browns vs the original).
  if (!flatArt) {
    for (const bin of bins) {
      if (selected.length >= target) break
      if (bin.chroma < 32) continue
      const related = selected.some((s) => {
        if (s.chroma < 32) return false
        const hueDist =
          Math.abs(s.r - bin.r) + Math.abs(s.g - bin.g) + Math.abs(s.b - bin.b)
        const lumGap = Math.abs(luminance(s) - luminance(bin))
        return hueDist < 160 && lumGap > 25 && lumGap < 120
      })
      if (!related) continue
      tryAdd(bin, 38)
    }
  }

  // 4) Remaining — chromatic bins first, then neutrals under cap.
  for (const bin of bins) {
    if (selected.length >= target) break
    if (isNeutral(bin) && bin.skin < 0.08) continue
    tryAdd(bin, flatArt ? 40 : 30)
  }
  for (const bin of bins) {
    if (selected.length >= target) break
    tryAdd(bin, flatArt ? 36 : 28)
  }

  // Fill if accent-first left gaps (rare).
  for (const bin of bins) {
    if (selected.length >= target) break
    tryAdd(bin, flatArt ? 32 : 24)
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

/** Mid-luminance neutrals used as enamel fills (fur highlights, metal, skull). */
function isMetalGray(c: Rgb): boolean {
  const L = luminance(c)
  const ch = chroma(c)
  return ch < 28 && L >= 48 && L <= 200
}

/**
 * Guarantee 1–2 mid-gray slots when gray covers meaningful subject area.
 * Returns how many neutrals were added (for the neutral cap counter).
 */
function ensureMetalGrays(
  bins: HistBin[],
  selected: Array<Rgb & { n: number; score: number; chroma: number; skin: number }>,
  target: number,
  totalN: number,
): number {
  const minArea = Math.max(24, Math.round(totalN * 0.012))
  const grayBins = bins
    .filter((b) => isMetalGray(b) && b.n >= minArea)
    .sort((a, b) => b.n - a.n || b.score - a.score)

  if (!grayBins.length) return 0

  const grayArea = grayBins.reduce((s, b) => s + b.n, 0)
  if (grayArea / totalN < 0.02) return 0

  const want = grayArea / totalN >= 0.08 ? 2 : 1
  const picks: HistBin[] = []
  for (const bin of grayBins) {
    if (picks.length >= want) break
    // Distinct lightness bands (light gray vs dark gray).
    if (picks.some((p) => Math.abs(luminance(p) - luminance(bin)) < 32)) continue
    // Already have a close gray in the palette.
    if (selected.some((s) => isMetalGray(s) && dist2(s, bin) < 34 * 34)) continue
    // Must sit clearly away from black / white extremes already selected.
    if (
      selected.some((s) => {
        const L = luminance(s)
        if (L < 40 && luminance(bin) - L < 28) return true
        if (L > 220 && L - luminance(bin) < 28) return true
        return dist2(s, bin) < 30 * 30
      })
    ) {
      continue
    }
    picks.push(bin)
  }

  let added = 0
  for (const best of picks) {
    if (selected.some((s) => dist2(s, best) < 34 * 34)) continue

    const entry = {
      r: best.r,
      g: best.g,
      b: best.b,
      n: best.n,
      score: best.score,
      chroma: best.chroma,
      skin: best.skin,
    }

    if (selected.length < target) {
      selected.push(entry)
      added++
      continue
    }

    // Replace weakest chromatic duplicate / low-value shade to make room.
    let worst = -1
    let worstScore = Infinity
    for (let i = 0; i < selected.length; i++) {
      const s = selected[i]
      if (s.skin > 0.1) continue
      const L = luminance(s)
      if (L < 35 || L > 230) continue // keep black/white
      if (isMetalGray(s)) continue
      // Prefer evicting near-duplicate chromatic shades over unique accents.
      const twin = selected.some(
        (o, j) =>
          j !== i &&
          o.chroma >= 32 &&
          s.chroma >= 32 &&
          dist2(o, s) < 55 * 55,
      )
      const score = s.score - (twin ? 0.05 : 0)
      if (score < worstScore) {
        worstScore = score
        worst = i
      }
    }
    if (worst >= 0) {
      selected[worst] = entry
      added++
    }
  }

  return added
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
    // Never treat opaque near-white as empty — interior whites are enamel.
    // Exterior paper is already alpha=0 from removeBackground when enabled.
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
