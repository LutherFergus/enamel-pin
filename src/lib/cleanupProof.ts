/**
 * Clean up a proof SVG: inside each outline cell, if more than one fill color
 * is present, flood the whole cell with the dominant color.
 *
 * Exterior is ONLY transparent background (alpha), never enamel fills. That way
 * gaps in the outer silhouette don't let "outside" flood through the face and
 * wipe skin/dress colors during Clean up.
 */

import type { OutlineResult } from './outline'
import { composeProofSvg, type ProofSvg } from './proofSvg'
import { labelsToSmoothSvg } from './traceSvg'
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

const MIN_COLOR_SHARE = 0.04 // ignore speck colors under 4% of a cell
/** Pixels at or below this alpha count as clear background. */
const CLEAR_ALPHA = 96

/**
 * Rasterize the proof, unify multi-color outline cells to their dominant fill,
 * re-trace fills, and stack the existing outline back on top.
 *
 * Ink walls come from the outline PNG (true die-lines). Dark enamel fills like
 * navy hair are NOT treated as metal.
 */
export async function cleanupProofDominantCells(
  proof: ProofSvg,
  outline: OutlineResult,
  opts: CleanupProofOptions,
): Promise<CleanupProofResult> {
  const maxDim = Math.max(400, Math.min(1600, opts.maxDim ?? 1200))
  const [{ data, w, h }, inkNative] = await Promise.all([
    rasterizeSvg(proof.svg, maxDim),
    loadInkMaskFromOutline(outline),
  ])

  let ink =
    inkNative.w === w && inkNative.h === h
      ? inkNative.mask
      : scaleMaskNearest(inkNative.mask, inkNative.w, inkNative.h, w, h)

  // Light morphological close — seals tiny silhouette nicks without filling
  // intentional polka holes (those stay open if gap > ~2px).
  ink = closeMask(ink, w, h, 1.25)

  const palette = (opts.palette ?? []).filter((c) => c.enabled !== false)
  const { cellLabels, fillRgb, metaByIndex, cellsFixed, cellCount } =
    floodDominantInCells(data, ink, w, h, palette)

  const { svg: fillSvg } = labelsToSmoothSvg(cellLabels, fillRgb, metaByIndex, {
    smoothness: opts.smoothness,
    widthPx: w,
    heightPx: h,
    pathomitScale: opts.pathomitScale ?? 1,
  })

  const nextProof = composeProofSvg(fillSvg, outline.svg)
  const vectorBlob = new Blob([fillSvg], { type: 'image/svg+xml;charset=utf-8' })

  return {
    proof: nextProof,
    vectorSvg: fillSvg,
    vectorBlob,
    cellsFixed,
    cellCount,
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
    mask[i] = data[i * 4 + 3] >= 128 ? 255 : 0
  }
  return { mask, w, h }
}

function scaleMaskNearest(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  const out = new Uint8Array(dstW * dstH)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / dstH))
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / dstW))
      out[y * dstW + x] = mask[sy * srcW + sx]
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
    // Keep transparency — exterior flood must walk clear pixels only, not a
    // white paper fill that would look like skin/background merged.
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

function floodDominantInCells(
  data: Uint8ClampedArray,
  ink: Uint8Array,
  w: number,
  h: number,
  palette: PaletteColor[],
): {
  cellLabels: Uint16Array
  fillRgb: Rgb[]
  metaByIndex: Map<number, PaletteColor>
  cellsFixed: number
  cellCount: number
} {
  const n = w * h
  // Exterior = clear background only. Opaque fills (skin, red dress) block the
  // flood even when the silhouette outline has gaps.
  const exterior = markExteriorThroughClear(data, ink, w, h)

  const metaByIndex = new Map<number, PaletteColor>()
  for (const c of palette) metaByIndex.set(c.index, c)

  const usePaletteIndices = palette.length > 0
  let nextDiscover = 0
  const discoverKey = new Map<string, number>()
  const colors: Rgb[] = palette.map((c) => ({ r: c.r, g: c.g, b: c.b }))

  const snap = (r: number, g: number, b: number): number => {
    if (usePaletteIndices) {
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
    const qr = (r / 12) | 0
    const qg = (g / 12) | 0
    const qb = (b / 12) | 0
    const key = `${qr},${qg},${qb}`
    let idx = discoverKey.get(key)
    if (idx == null) {
      idx = nextDiscover++
      discoverKey.set(key, idx)
      colors[idx] = {
        r: Math.min(255, qr * 12 + 6),
        g: Math.min(255, qg * 12 + 6),
        b: Math.min(255, qb * 12 + 6),
      }
      metaByIndex.set(idx, {
        ...colors[idx],
        hex: rgbToHex(colors[idx]),
        index: idx,
      })
    }
    return idx
  }

  const maxFillIndex = usePaletteIndices
    ? Math.max(...palette.map((c) => c.index), 0)
    : 0
  const fillRgb: Rgb[] = usePaletteIndices
    ? Array.from({ length: maxFillIndex + 1 }, () => ({ r: 0, g: 0, b: 0 }))
    : colors
  if (usePaletteIndices) {
    for (const c of palette) {
      fillRgb[c.index] = { r: c.r, g: c.g, b: c.b }
    }
  }

  const cellLabels = new Uint16Array(n)
  for (let i = 0; i < n; i++) cellLabels[i] = 0xffff

  const seen = new Uint8Array(n)
  const stack: number[] = []
  let cellsFixed = 0
  let cellCount = 0

  for (let seed = 0; seed < n; seed++) {
    if (ink[seed] || exterior[seed] || seen[seed]) continue

    const cell: number[] = []
    const hist = new Map<number, number>()
    stack.length = 0
    stack.push(seed)
    seen[seed] = 1

    while (stack.length) {
      const i = stack.pop()!
      cell.push(i)
      const o = i * 4
      // Sample opaque enamel inside the cell (including dark navy).
      if (data[o + 3] > CLEAR_ALPHA && !ink[i]) {
        const lab = snap(data[o], data[o + 1], data[o + 2])
        hist.set(lab, (hist.get(lab) ?? 0) + 1)
      }
      const x = i % w
      const yy = (i / w) | 0
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x + 1 < w ? i + 1 : -1,
        yy > 0 ? i - w : -1,
        yy + 1 < h ? i + w : -1,
      ]
      for (const ni of neighbors) {
        if (ni < 0) continue
        if (ink[ni] || exterior[ni] || seen[ni]) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }

    const total = [...hist.values()].reduce((a, b) => a + b, 0)
    if (total === 0) continue

    const significant: Array<[number, number]> = []
    for (const [lab, count] of hist) {
      if (count / total >= MIN_COLOR_SHARE) significant.push([lab, count])
    }
    if (significant.length === 0) continue

    significant.sort((a, b) => b[1] - a[1])
    const dominant = significant[0][0]
    // Only rewrite when the cell actually mixes colors.
    if (significant.length > 1) {
      cellsFixed++
      for (const i of cell) cellLabels[i] = dominant
    } else {
      // Keep the single color; still label so the cell is traced.
      for (const i of cell) cellLabels[i] = dominant
    }

    cellCount++
  }

  return {
    cellLabels,
    fillRgb: usePaletteIndices ? fillRgb : colors,
    metaByIndex,
    cellsFixed,
    cellCount,
  }
}

/**
 * Mark background connected to the frame through CLEAR pixels only.
 * Opaque fills stop the flood — silhouette gaps no longer erase the face.
 */
function markExteriorThroughClear(
  data: Uint8ClampedArray,
  ink: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  const n = w * h
  const exterior = new Uint8Array(n)
  const stack: number[] = []

  const isClear = (i: number) => data[i * 4 + 3] <= CLEAR_ALPHA

  const push = (i: number) => {
    if (i < 0 || i >= n) return
    if (ink[i] || exterior[i]) return
    if (!isClear(i)) return
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

