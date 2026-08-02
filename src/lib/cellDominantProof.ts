/**
 * Proof = vector fills flattened into Gestalt-closed outline cells.
 *
 * Combine the vector plate with the black die-line. Where the outline is
 * incomplete (e.g. whiskers crossing gray fur), close walls along strong
 * color / lightness edges, then fill every enclosed cell with its dominant
 * enamel color. Stack the completed outline on top.
 */

import type { OutlineResult } from './outline'
import { composeProofSvg, type ProofSvg } from './proofSvg'
import { overlapAdjacentFills } from './labelSmooth'
import { labelsToCrispSvg } from './traceSvg'
import type { PaletteColor, Rgb } from './types'
import { colorDistance, rgbToHex } from './types'

export type DominantCellProofOptions = {
  smoothness?: number
  maxDim?: number
  palette?: PaletteColor[]
}

const CLEAR_ALPHA = 96

/**
 * Build Proof SVG: one dominant fill per (Gestalt-closed) outline cell + walls.
 */
export async function buildDominantCellProof(
  vectorSvg: string,
  outline: OutlineResult,
  opts: DominantCellProofOptions = {},
): Promise<ProofSvg> {
  const maxDim = Math.max(1000, Math.min(2000, opts.maxDim ?? 1652))
  const [{ data, w, h }, inkNative] = await Promise.all([
    rasterizeSvg(vectorSvg, maxDim),
    loadInkMaskFromOutline(outline),
  ])

  let ink =
    inkNative.w === w && inkNative.h === h
      ? inkNative.mask
      : scaleMaskNearest(inkNative.mask, inkNative.w, inkNative.h, w, h)

  // Seal tiny outline nicks so cells don’t leak into each other.
  ink = closeMask(ink, w, h, 1.2)

  const palette = (opts.palette ?? []).filter((c) => c.enabled !== false)
  // Sample against a clear mask first — Gestalt walls come next.
  const emptyInk = new Uint8Array(w * h)
  const { labels: sampled, fillRgb, metaByIndex } = sampleVectorToLabels(
    data,
    emptyInk,
    w,
    h,
    palette,
  )

  // Gestalt closure: complete broken die-lines along strong fill edges
  // (white whiskers | gray fur) and bridge nearby ink endpoints.
  const walls = gestaltCompleteWalls(ink, data, sampled, w, h)

  // Exterior stays clear; each interior closed cell → one dominant color.
  let labels = floodCellsWithDominant(sampled, walls, data, w, h)

  // Grow enamel slightly under metal so Proof doesn’t show hairline gaps.
  labels = overlapAdjacentFills(labels, w, h, { minVotes: 1 })
  labels = trapFillsUnderInk(labels, walls, w, h, 3)

  const smoothness = Math.max(0, Math.min(5, opts.smoothness ?? 3))
  const { svg: fillSvg } = await labelsToCrispSvg(labels, fillRgb, metaByIndex, {
    widthPx: w,
    heightPx: h,
    smoothness,
    seamDilate: 2,
    seamStroke: 1.2,
    skipMajorityClean: true,
  })

  // Proof outline includes Gestalt-completed walls so metal matches the fills.
  const closedOutlineSvg = await inkMaskToOutlineSvg(walls, w, h, smoothness)
  return composeProofSvg(fillSvg, closedOutlineSvg)
}

/**
 * Complete incomplete outline walls using Gestalt-style closure:
 *  1) wall every strong color / lightness abutment in the vector
 *  2) bridge short gaps between existing ink endpoints
 */
function gestaltCompleteWalls(
  ink: Uint8Array,
  data: Uint8ClampedArray,
  sampled: Uint16Array,
  w: number,
  h: number,
): Uint8Array {
  const walls = new Uint8Array(ink)

  // 1) Color / lightness edges as virtual metal (white|gray whiskers, etc.).
  // Prefer strong edges — not every similar orange shade — so outline cells
  // still flatten soft multi-fills after the walls are closed.
  const minDist2 = 55 * 55
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const o = i * 4
      if (data[o + 3] <= CLEAR_ALPHA) continue
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= w || ny >= h) continue
        const ni = ny * w + nx
        const no = ni * 4
        if (data[no + 3] <= CLEAR_ALPHA) continue

        const dr = data[o] - data[no]
        const dg = data[o + 1] - data[no + 1]
        const db = data[o + 2] - data[no + 2]
        const dist2 = dr * dr + dg * dg + db * db
        if (dist2 < minDist2) continue

        const La = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]
        const Lb = 0.2126 * data[no] + 0.7152 * data[no + 1] + 0.0722 * data[no + 2]
        const chA =
          Math.max(data[o], data[o + 1], data[o + 2]) -
          Math.min(data[o], data[o + 1], data[o + 2])
        const chB =
          Math.max(data[no], data[no + 1], data[no + 2]) -
          Math.min(data[no], data[no + 1], data[no + 2])
        const lumGap = Math.abs(La - Lb)

        // Soft AA only: dull neighbors with similar lightness.
        if (chA < 12 && chB < 12 && lumGap < 40) continue

        // Gestalt: wall high-contrast fill edges, especially neutral ladders
        // (white whisker | gray fur | black) and vivid color abutments.
        const neutralLadder =
          chA < 36 && chB < 36 && lumGap >= 40
        const chromaticEdge = (chA >= 28 || chB >= 28) && dist2 >= minDist2
        const labelBreak =
          sampled[i] !== 0xffff &&
          sampled[ni] !== 0xffff &&
          sampled[i] !== sampled[ni] &&
          (lumGap >= 35 || dist2 >= 80 * 80)

        if (!neutralLadder && !chromaticEdge && !labelBreak) continue
        walls[i] = 255
        walls[ni] = 255
      }
    }
  }

  // 2) Bridge short broken outline strokes (endpoint → endpoint).
  bridgeInkGaps(walls, w, h, 10)

  // Keep walls slightly thicker so thin whisker cells stay sealed.
  return dilateMask(walls, w, h, 0.7)
}

/** Connect nearby ink endpoints with a short Bresenham stroke. */
function bridgeInkGaps(ink: Uint8Array, w: number, h: number, maxGap: number) {
  const endpoints: Array<{ x: number; y: number }> = []
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!ink[i]) continue
      let n = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (ink[(y + dy) * w + (x + dx)]) n++
        }
      }
      // Tip / break: 1–2 ink neighbors in the 8-ring.
      if (n > 0 && n <= 2) endpoints.push({ x, y })
    }
  }

  const maxGap2 = maxGap * maxGap
  const used = new Uint8Array(endpoints.length)
  for (let a = 0; a < endpoints.length; a++) {
    if (used[a]) continue
    let best = -1
    let bestD = Infinity
    const pa = endpoints[a]
    for (let b = a + 1; b < endpoints.length; b++) {
      if (used[b]) continue
      const pb = endpoints[b]
      const dx = pa.x - pb.x
      const dy = pa.y - pb.y
      const d2 = dx * dx + dy * dy
      if (d2 < 4 || d2 > maxGap2) continue
      if (d2 < bestD) {
        bestD = d2
        best = b
      }
    }
    if (best < 0) continue
    used[a] = 1
    used[best] = 1
    drawInkLine(ink, w, h, pa.x, pa.y, endpoints[best].x, endpoints[best].y)
  }
}

function drawInkLine(
  ink: Uint8Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  let x = x0
  let y = y0
  const dx = Math.abs(x1 - x0)
  const dy = Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1
  const sy = y0 < y1 ? 1 : -1
  let err = dx - dy
  for (;;) {
    if (x >= 0 && y >= 0 && x < w && y < h) ink[y * w + x] = 255
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) {
      err -= dy
      x += sx
    }
    if (e2 < dx) {
      err += dx
      y += sy
    }
  }
}

async function inkMaskToOutlineSvg(
  ink: Uint8Array,
  w: number,
  h: number,
  smoothness: number,
): Promise<string> {
  const labels = new Uint16Array(w * h)
  labels.fill(0xffff)
  for (let i = 0; i < w * h; i++) {
    if (ink[i]) labels[i] = 0
  }
  const fillRgb: Rgb[] = [{ r: 0, g: 0, b: 0 }]
  const metaByIndex = new Map<number, PaletteColor>([
    [0, { r: 0, g: 0, b: 0, hex: '#000000', index: 0, pmsName: 'Outline' }],
  ])
  const { svg } = await labelsToCrispSvg(labels, fillRgb, metaByIndex, {
    widthPx: w,
    heightPx: h,
    smoothness,
    seamDilate: 0,
    seamStroke: 0,
    skipMajorityClean: true,
  })
  return svg
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
    return { data: ctx.getImageData(0, 0, w, h).data, w, h }
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
    img.onerror = () => reject(new Error('Failed to rasterize vector for proof'))
    img.src = url
  })
}

function sampleVectorToLabels(
  data: Uint8ClampedArray,
  ink: Uint8Array,
  w: number,
  h: number,
  palette: PaletteColor[],
): {
  labels: Uint16Array
  fillRgb: Rgb[]
  metaByIndex: Map<number, PaletteColor>
} {
  const n = w * h
  const labels = new Uint16Array(n)
  for (let i = 0; i < n; i++) labels[i] = 0xffff

  const metaByIndex = new Map<number, PaletteColor>()
  const usePalette = palette.length > 0
  const discoverKey = new Map<string, number>()
  let nextDiscover = 0
  const colors: Rgb[] = []

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
    const qr = (r / 12) | 0
    const qg = (g / 12) | 0
    const qb = (b / 12) | 0
    const key = `${qr},${qg},${qb}`
    let idx = discoverKey.get(key)
    if (idx == null) {
      idx = nextDiscover++
      discoverKey.set(key, idx)
      const rgb = {
        r: Math.min(255, qr * 12 + 6),
        g: Math.min(255, qg * 12 + 6),
        b: Math.min(255, qb * 12 + 6),
      }
      colors[idx] = rgb
      fillRgb[idx] = rgb
      metaByIndex.set(idx, { ...rgb, hex: rgbToHex(rgb), index: idx })
    }
    return idx
  }

  for (let i = 0; i < n; i++) {
    if (ink[i]) continue
    const o = i * 4
    if (data[o + 3] <= CLEAR_ALPHA) continue
    labels[i] = snap(data[o], data[o + 1], data[o + 2])
  }

  return {
    labels,
    fillRgb: usePalette ? fillRgb : colors,
    metaByIndex,
  }
}

/**
 * For each connected non-ink interior region, paint every pixel with the
 * majority sampled label from that cell.
 */
function floodCellsWithDominant(
  sampled: Uint16Array,
  ink: Uint8Array,
  data: Uint8ClampedArray,
  w: number,
  h: number,
): Uint16Array {
  const n = w * h
  const exterior = markExterior(ink, data, w, h)
  const out = new Uint16Array(n)
  out.fill(0xffff)
  const seen = new Uint8Array(n)
  const stack: number[] = []

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
      const lab = sampled[i]
      if (lab !== 0xffff) hist.set(lab, (hist.get(lab) ?? 0) + 1)

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
        seen[ni] = 1
        stack.push(ni)
      }
    }

    let best = 0xffff
    let bestN = 0
    for (const [lab, c] of hist) {
      if (c > bestN) {
        bestN = c
        best = lab
      }
    }
    if (best === 0xffff) continue
    for (const i of cell) out[i] = best
  }

  return out
}

/** Clear / non-ink pixels reachable from the image border = outside the pin. */
function markExterior(
  ink: Uint8Array,
  data: Uint8ClampedArray,
  w: number,
  h: number,
): Uint8Array {
  const n = w * h
  // Treat solid subject (ink or opaque vector) as a barrier after a light close
  // so small outline gaps don’t open the interior to the outside flood.
  const subject = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (ink[i] || data[i * 4 + 3] > CLEAR_ALPHA) subject[i] = 255
  }
  const sealed = closeMask(subject, w, h, 4)

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
      const dist = Math.abs(dx) + Math.abs(dy)
      const weight = Math.max(1, radius + 1 - dist)
      hist.set(lab, (hist.get(lab) ?? 0) + weight)
    }
  }
  let best = 0xffff
  let bestN = 0
  for (const [lab, c] of hist) {
    if (c > bestN) {
      bestN = c
      best = lab
    }
  }
  return best
}

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
