/**
 * Final / Clean up: keep the Proof’s color layout, then complete incomplete
 * shapes inside the outline.
 *
 * Do NOT flatten each outline cell to one dominant color — that erased flames,
 * stripes, and other intentional multi-fill regions.
 *
 * Outline gaps: don’t flood through breaks. Look at how much of each color is
 * already in that local area and complete the shape with that color.
 */

import type { OutlineResult } from './outline'
import { composeProofSvg, type ProofSvg } from './proofSvg'
import {
  dropSpeckIslands,
  overlapAdjacentFills,
  smoothLabelBoundaries,
} from './labelSmooth'
import { labelsToCrispSvg } from './traceSvg'
import type { PaletteColor, Rgb } from './types'
import { colorDistance, rgbToHex } from './types'

export type CleanupProofOptions = {
  smoothness: number
  pathomitScale?: number
  /** Working raster max dimension. */
  maxDim?: number
  /** Palette to snap sampled pixels to (enabled fills). */
  palette?: PaletteColor[]
}

export type CleanupProofResult = {
  proof: ProofSvg
  vectorSvg: string
  vectorBlob: Blob
  cellsFixed: number
  cellCount: number
}

/** Pixels at or below this alpha count as clear background. */
const CLEAR_ALPHA = 96

/**
 * Rasterize the proof, preserve multi-color fills, complete incomplete shapes
 * from local color evidence, re-trace like the vector plate, stack outline.
 */
export async function cleanupProofDominantCells(
  proof: ProofSvg,
  outline: OutlineResult,
  opts: CleanupProofOptions,
): Promise<CleanupProofResult> {
  // Match vector working size so Final doesn’t undersample Proof fills.
  const maxDim = Math.max(1000, Math.min(2000, opts.maxDim ?? 1652))
  const [{ data, w, h }, inkNative] = await Promise.all([
    rasterizeSvg(proof.svg, maxDim),
    loadInkMaskFromOutline(outline),
  ])

  let ink =
    inkNative.w === w && inkNative.h === h
      ? inkNative.mask
      : scaleMaskNearest(inkNative.mask, inkNative.w, inkNative.h, w, h)

  // Tiny nick seal only — do not close intentional openings.
  ink = closeMask(ink, w, h, 1.0)

  const palette = (opts.palette ?? []).filter((c) => c.enabled !== false)
  const { labels: snapped, fillRgb, metaByIndex, labeledPixels } =
    snapProofToLabels(data, ink, w, h, palette)

  let cellLabels = snapped

  // Complete incomplete shapes from local color amount (handles outline gaps).
  const completed = completeShapesFromLocalColor(cellLabels, data, ink, w, h)
  cellLabels = completed.labels
  const cellsFixed = completed.regionsCompleted

  // Remaining interior clear pockets → local majority neighbor.
  cellLabels = fillEnclosedTransparent(cellLabels, data, ink, w, h)

  // Light cleanup only — preserve flame / stripe multi-color.
  cellLabels = smoothLabelBoundaries(cellLabels, w, h, 1)
  cellLabels = dropSpeckIslands(
    cellLabels,
    w,
    h,
    Math.max(6, Math.round(w * h * 0.000012)),
    fillRgb,
  )
  cellLabels = fillEnclosedTransparent(cellLabels, data, ink, w, h)

  // Seal color-to-color abutments, then grow enamel under metal walls so the
  // stacked outline doesn’t leave magenta/clear hairlines (Final gaps).
  cellLabels = overlapAdjacentFills(cellLabels, w, h, { minVotes: 1 })
  cellLabels = trapFillsUnderInk(cellLabels, ink, w, h, 3)
  cellLabels = fillEnclosedTransparent(cellLabels, data, ink, w, h)

  // Absolute-cubic Potrace with extra trap: dilate + matching stroke.
  const smoothness = Math.max(0, Math.min(5, opts.smoothness ?? 3))
  const { svg: fillSvg, pathCount } = await labelsToCrispSvg(
    cellLabels,
    fillRgb,
    metaByIndex,
    {
      widthPx: w,
      heightPx: h,
      smoothness,
      seamDilate: 3,
      seamStroke: 1.6,
      skipMajorityClean: true,
    },
  )

  const nextProof = composeProofSvg(fillSvg, outline.svg)
  const vectorBlob = new Blob([fillSvg], { type: 'image/svg+xml;charset=utf-8' })

  return {
    proof: nextProof,
    vectorSvg: fillSvg,
    vectorBlob,
    cellsFixed,
    cellCount: Math.max(pathCount, labeledPixels > 0 ? 1 : 0),
  }
}

async function loadInkMaskFromOutline(
  outline: OutlineResult,
): Promise<{ mask: Uint8Array; w: number; h: number }> {
  const bmp = await createImageBitmap(outline.pngBlob)
  const w = bmp.width
  const h = bmp.height
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0)
  bmp.close?.()
  const data = ctx.getImageData(0, 0, w, h).data
  const mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    // Outline PNG is transparent non-ink; opaque = metal wall.
    if (data[i * 4 + 3] > 40) mask[i] = 255
  }
  return { mask, w, h }
}

function scaleMaskNearest(
  src: Uint8Array,
  sw: number,
  sh: number,
  tw: number,
  th: number,
): Uint8Array {
  const out = new Uint8Array(tw * th)
  for (let y = 0; y < th; y++) {
    const sy = Math.min(sh - 1, Math.round((y * (sh - 1)) / Math.max(1, th - 1)))
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(sw - 1, Math.round((x * (sw - 1)) / Math.max(1, tw - 1)))
      out[y * tw + x] = src[sy * sw + sx]
    }
  }
  return out
}

async function rasterizeSvg(
  svg: string,
  maxDim: number,
): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const vb = parseViewBoxSize(svg)
  const scale = Math.min(1, maxDim / Math.max(vb.w, vb.h))
  const w = Math.max(32, Math.round(vb.w * scale))
  const h = Math.max(32, Math.round(vb.h * scale))

  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    return { data: imageData.data, w, h }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function parseViewBoxSize(svg: string): { w: number; h: number } {
  const m = svg.match(/viewBox\s*=\s*"([^"]+)"/i)
  if (m) {
    const parts = m[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n) && n >= 0)) {
      return { w: Math.max(1, parts[2]), h: Math.max(1, parts[3]) }
    }
  }
  const wm = svg.match(/\bwidth="([\d.]+)"/i)
  const hm = svg.match(/\bheight="([\d.]+)"/i)
  const w = wm ? Number(wm[1]) : 1000
  const h = hm ? Number(hm[1]) : 1000
  return {
    w: Number.isFinite(w) && w > 0 ? w : 1000,
    h: Number.isFinite(h) && h > 0 ? h : 1000,
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to rasterize proof SVG'))
    img.src = url
  })
}

/**
 * Snap each opaque proof pixel to the nearest palette color.
 * Preserves multi-color regions (flames, stripes) — no cell flattening.
 */
function snapProofToLabels(
  data: Uint8ClampedArray,
  ink: Uint8Array,
  w: number,
  h: number,
  palette: PaletteColor[],
): {
  labels: Uint16Array
  fillRgb: Rgb[]
  metaByIndex: Map<number, PaletteColor>
  labeledPixels: number
} {
  const n = w * h
  const labels = new Uint16Array(n)
  for (let i = 0; i < n; i++) labels[i] = 0xffff

  const metaByIndex = new Map<number, PaletteColor>()
  const usePalette = palette.length > 0

  let nextDiscover = 0
  const discoverKey = new Map<string, number>()
  const colors: Rgb[] = usePalette
    ? []
    : []

  const maxIdx = usePalette ? Math.max(...palette.map((c) => c.index), 0) : 0
  const fillRgb: Rgb[] = usePalette
    ? Array.from({ length: maxIdx + 1 }, () => ({ r: 0, g: 0, b: 0 }))
    : colors

  if (usePalette) {
    for (const c of palette) {
      fillRgb[c.index] = { r: c.r, g: c.g, b: c.b }
      metaByIndex.set(c.index, c)
    }
  }

  const snap = (r: number, g: number, b: number): number => {
    if (usePalette) {
      let best = palette[0].index
      let bestD = Infinity
      for (const c of palette) {
        const d = colorDistance({ r, g, b }, c)
        if (d < bestD) {
          bestD = d
          best = c.index
        }
      }
      return best
    }
    const qr = (r / 10) | 0
    const qg = (g / 10) | 0
    const qb = (b / 10) | 0
    const key = `${qr},${qg},${qb}`
    let idx = discoverKey.get(key)
    if (idx == null) {
      idx = nextDiscover++
      discoverKey.set(key, idx)
      const rgb = {
        r: Math.min(255, qr * 10 + 5),
        g: Math.min(255, qg * 10 + 5),
        b: Math.min(255, qb * 10 + 5),
      }
      colors[idx] = rgb
      fillRgb[idx] = rgb
      metaByIndex.set(idx, { ...rgb, hex: rgbToHex(rgb), index: idx })
    }
    return idx
  }

  let labeledPixels = 0
  for (let i = 0; i < n; i++) {
    if (ink[i]) continue
    const o = i * 4
    if (data[o + 3] <= CLEAR_ALPHA) continue
    labels[i] = snap(data[o], data[o + 1], data[o + 2])
    labeledPixels++
  }

  return {
    labels,
    fillRgb: usePalette ? fillRgb : colors,
    metaByIndex,
    labeledPixels,
  }
}

/**
 * Grow existing fills into nearby clear interior pixels when local color
 * evidence says that shape should continue — even if the outline has a gap.
 *
 * For each unlabeled interior pixel, vote labeled neighbors in a small radius.
 * If one color owns enough of the local color mass, assign it (complete shape).
 */
function completeShapesFromLocalColor(
  labels: Uint16Array,
  data: Uint8ClampedArray,
  ink: Uint8Array,
  w: number,
  h: number,
): { labels: Uint16Array; regionsCompleted: number } {
  const n = w * h
  let out = new Uint16Array(labels)
  const exterior = markExteriorInteriorAware(data, ink, out, w, h)

  let regionsCompleted = 0
  const radius = 3
  // Require a clear majority of local color so multi-color zones (flames) stay.
  const majority = 0.58
  const minVotes = 4

  for (let pass = 0; pass < 4; pass++) {
    const next = new Uint16Array(out)
    let changed = 0
    for (let i = 0; i < n; i++) {
      if (out[i] !== 0xffff || ink[i] || exterior[i]) continue
      // Only complete into clear / unlabeled proof pixels.
      if (data[i * 4 + 3] > CLEAR_ALPHA && out[i] !== 0xffff) continue

      const x0 = i % w
      const y0 = (i / w) | 0
      const hist = new Map<number, number>()
      let total = 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue
          const x = x0 + dx
          const y = y0 + dy
          if (x < 0 || y < 0 || x >= w || y >= h) continue
          const ni = y * w + x
          if (ink[ni] || exterior[ni]) continue
          const lab = out[ni]
          if (lab === 0xffff) continue
          hist.set(lab, (hist.get(lab) ?? 0) + 1)
          total++
        }
      }
      if (total < minVotes) continue
      let best = 0xffff
      let bestN = 0
      for (const [lab, c] of hist) {
        if (c > bestN) {
          bestN = c
          best = lab
        }
      }
      if (best === 0xffff || bestN / total < majority) continue
      next[i] = best
      changed++
    }
    out = next
    if (changed === 0) break
    regionsCompleted += changed
  }

  return { labels: out, regionsCompleted }
}

/**
 * Grow enamel labels into outline ink pixels (and clear fringe next to ink)
 * so fills trap under the black die-line when Proof stacks outline on top.
 */
function trapFillsUnderInk(
  labels: Uint16Array,
  ink: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint16Array {
  const r = Math.max(1, Math.round(radius))
  const out = new Uint16Array(labels)
  const n = w * h

  // Pass 1: clear fringe touching ink → nearest fill.
  for (let i = 0; i < n; i++) {
    if (ink[i] || out[i] !== 0xffff) continue
    const x = i % w
    const y = (i / w) | 0
    let touchesInk = false
    for (let dy = -1; dy <= 1 && !touchesInk; dy++) {
      for (let dx = -1; dx <= 1 && !touchesInk; dx++) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        if (ink[ny * w + nx]) touchesInk = true
      }
    }
    if (!touchesInk) continue
    const fill = nearestFillLabel(out, ink, x, y, w, h, r)
    if (fill !== 0xffff) out[i] = fill
  }

  // Pass 2: ink pixels themselves get neighbor enamel (under-metal trap).
  for (let i = 0; i < n; i++) {
    if (!ink[i]) continue
    const x = i % w
    const y = (i / w) | 0
    const fill = nearestFillLabel(out, ink, x, y, w, h, r)
    if (fill !== 0xffff) out[i] = fill
  }

  return out
}

function nearestFillLabel(
  labels: Uint16Array,
  ink: Uint8Array,
  x0: number,
  y0: number,
  w: number,
  h: number,
  radius: number,
): number {
  const hist = new Map<number, number>()
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = x0 + dx
      const y = y0 + dy
      if (x < 0 || y < 0 || x >= w || y >= h) continue
      const i = y * w + x
      if (ink[i]) continue
      const lab = labels[i]
      if (lab === 0xffff) continue
      // Prefer closer neighbors.
      const dist = Math.abs(dx) + Math.abs(dy)
      const weight = Math.max(1, radius + 1 - dist)
      hist.set(lab, (hist.get(lab) ?? 0) + weight)
    }
  }
  let best = 0xffff
  let bestN = 0
  for (const [lab, n] of hist) {
    if (n > bestN) {
      bestN = n
      best = lab
    }
  }
  return best
}

/**
 * Fill transparent pockets that sit inside the subject with the dominant
 * neighboring enamel color. Seals silhouette gaps first so "holes" connected
 * to the outside through a broken outline still count as interior.
 */
function fillEnclosedTransparent(
  labels: Uint16Array,
  data: Uint8ClampedArray,
  ink: Uint8Array,
  w: number,
  h: number,
): Uint16Array {
  const n = w * h
  const out = new Uint16Array(labels)
  const exterior = markExteriorInteriorAware(data, ink, out, w, h)

  const seen = new Uint8Array(n)
  const stack: number[] = []
  for (let seed = 0; seed < n; seed++) {
    if (out[seed] !== 0xffff || ink[seed] || exterior[seed] || seen[seed]) {
      continue
    }

    const hole: number[] = []
    stack.length = 0
    stack.push(seed)
    seen[seed] = 1

    while (stack.length) {
      const i = stack.pop()!
      hole.push(i)
      const x = i % w
      const y = (i / w) | 0
      for (const ni of [
        x > 0 ? i - 1 : -1,
        x + 1 < w ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y + 1 < h ? i + w : -1,
      ]) {
        if (ni < 0) continue
        if (seen[ni] || ink[ni] || exterior[ni]) continue
        if (out[ni] !== 0xffff) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }

    const fill = dominantNeighborLabel(out, ink, hole, w, h)
    if (fill === 0xffff) continue
    for (const i of hole) out[i] = fill
  }

  return out
}

/** Majority labeled neighbor around a hole; searches outward if only ink borders it. */
function dominantNeighborLabel(
  labels: Uint16Array,
  ink: Uint8Array,
  hole: number[],
  w: number,
  h: number,
): number {
  const holeSet = new Set(hole)
  const hist = new Map<number, number>()

  const tallyAround = (radius: number) => {
    hist.clear()
    for (const i of hole) {
      const x0 = i % w
      const y0 = (i / w) | 0
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx === 0 && dy === 0) continue
          const x = x0 + dx
          const y = y0 + dy
          if (x < 0 || y < 0 || x >= w || y >= h) continue
          const ni = y * w + x
          if (holeSet.has(ni) || ink[ni]) continue
          const lab = labels[ni]
          if (lab === 0xffff) continue
          hist.set(lab, (hist.get(lab) ?? 0) + 1)
        }
      }
    }
  }

  for (const radius of [1, 2, 4, 8, 14]) {
    tallyAround(radius)
    if (hist.size === 0) continue
    let best = 0xffff
    let bestN = 0
    for (const [lab, n] of hist) {
      if (n > bestN) {
        bestN = n
        best = lab
      }
    }
    if (best !== 0xffff) return best
  }
  return 0xffff
}

/**
 * Exterior = clear pixels reachable from the frame, with subject morph-closed
 * so small outline gaps don’t classify interior clear as outside.
 */
function markExteriorInteriorAware(
  data: Uint8ClampedArray,
  ink: Uint8Array,
  labels: Uint16Array,
  w: number,
  h: number,
): Uint8Array {
  const n = w * h
  const subject = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (ink[i] || labels[i] !== 0xffff || data[i * 4 + 3] > CLEAR_ALPHA) {
      subject[i] = 255
    }
  }
  const sealed = closeMask(subject, w, h, 5)

  const exterior = new Uint8Array(n)
  const stack: number[] = []
  const push = (i: number) => {
    if (i < 0 || i >= n) return
    if (sealed[i] || exterior[i]) return
    exterior[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < w; x++) {
    push(x)
    push((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    push(y * w)
    push(y * w + (w - 1))
  }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i / w) | 0
    if (x > 0) push(i - 1)
    if (x + 1 < w) push(i + 1)
    if (y > 0) push(i - w)
    if (y + 1 < h) push(i + w)
  }
  return exterior
}

/** Dilate then erode — closes gaps up to ~2×radius pixels. */
function closeMask(
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  return erodeMask(dilateMask(mask, w, h, radius), w, h, radius)
}

function dilateMask(
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  if (radius < 0.05) return mask
  const out = new Uint8Array(mask)
  const rCeil = Math.max(1, Math.ceil(radius))
  const r2 = radius * radius
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let dy = -rCeil; dy <= rCeil; dy++) {
        for (let dx = -rCeil; dx <= rCeil; dx++) {
          if (dx * dx + dy * dy > r2) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          out[ny * w + nx] = 255
        }
      }
    }
  }
  return out
}

function erodeMask(
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  if (radius < 0.05) return mask
  const out = new Uint8Array(w * h)
  const rCeil = Math.max(1, Math.ceil(radius))
  const r2 = radius * radius
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      let keep = true
      for (let dy = -rCeil; dy <= rCeil && keep; dy++) {
        for (let dx = -rCeil; dx <= rCeil; dx++) {
          if (dx * dx + dy * dy > r2) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) {
            keep = false
            break
          }
        }
      }
      if (keep) out[y * w + x] = 255
    }
  }
  return out
}
