import { collapseCollinear, destairPath, extractColorContours, ringsToSvgD, simplifyPath } from './contours'
import type { Point } from './contours'
import { analyzeLineArt, extractInkMask, remapMetalToBlack } from './lineArt'
import { findPmsByCode, nearestPms, snapPaletteToPms } from './pms'
import { denoiseLabels, extractPalette, quantizeImage } from './quantize'
import { labelRegions, mergeSmallRegions } from './regions'
import type { PaletteColor, Rgb } from './types'
import { colorDistance, rgbToHex } from './types'

export type ColorVectorSettings = {
  colorCount: number
  /** Relative min region size as fraction of image area (0.00005–0.01). */
  minRegionRatio: number
  smoothness: number
  maxDim: number
  /** Snap fills to nearest Pantone Solid Coated (PMS) colors. */
  snapToPms: boolean
}

export const DEFAULT_COLOR_VECTOR_SETTINGS: ColorVectorSettings = {
  colorCount: 14,
  minRegionRatio: 0.0001,
  smoothness: 3,
  maxDim: 2000,
  snapToPms: true,
}

/** Manual per-slot PMS overrides: palette index → PMS code like "185 C". */
export type PmsOverrides = Record<number, string>

export type ColorVectorState = {
  widthPx: number
  heightPx: number
  labels: Uint16Array
  /** Pre-PMS quantized palette (after merges averaged). */
  palette: Rgb[]
  mergeMap: number[]
}

export type ColorVectorResult = {
  svg: string
  svgBlob: Blob
  svgUrl: string
  widthPx: number
  heightPx: number
  palette: PaletteColor[]
  regionCount: number
  state: ColorVectorState
}

function scaleToCanvas(
  source: HTMLImageElement | ImageBitmap,
  maxDim: number,
  smooth = true,
): ImageData {
  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
  const w = Math.max(32, Math.round(srcW * scale))
  const h = Math.max(32, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = smooth
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
}

function knockOutNearWhite(imageData: ImageData) {
  const { data } = imageData
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 16) continue
    if (data[i] >= 235 && data[i + 1] >= 235 && data[i + 2] >= 235) {
      data[i + 3] = 0
    }
  }
}

/** Drop solid black / dark studio backdrops (common on finished pin mockups). */
function knockOutNearBlackBackdrop(imageData: ImageData) {
  const { data, width, height } = imageData
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ]
  let darkCorners = 0
  let opaqueCorners = 0
  let cornerY = 0
  for (const o of corners) {
    if (data[o + 3] < 16) continue
    opaqueCorners++
    const y = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
    cornerY += y
    if (y < 70) darkCorners++
  }
  if (opaqueCorners < 2 || darkCorners < 2) return
  const avgCornerY = cornerY / opaqueCorners
  const thresh = Math.min(85, Math.max(28, avgCornerY + 28))

  const n = width * height
  const cand = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (data[o + 3] < 16) continue
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (y < thresh && chroma < 40) cand[i] = 1
  }

  const seen = new Uint8Array(n)
  const stack: number[] = []
  const pushBorder = (i: number) => {
    if (!cand[i] || seen[i]) return
    seen[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < width; x++) {
    pushBorder(x)
    pushBorder((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    pushBorder(y * width)
    pushBorder(y * width + width - 1)
  }

  while (stack.length) {
    const i = stack.pop()!
    data[i * 4 + 3] = 0
    const x = i % width
    const y = (i / width) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const ni = ny * width + nx
        if (!cand[ni] || seen[ni]) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }
  }
}

function processContour(points: Point[], smoothness: number, scale = 1): Point[] {
  // Flatten pixel stairs, keep sharp enamel corners. Bézier conversion happens
  // at SVG emit time — Chaikin is avoided (it blobs star points / box corners).
  let pts = destairPath(points, true)
  if (smoothness <= 0) {
    pts = collapseCollinear(pts, true)
    return scale === 1 ? pts : pts.map((p) => ({ x: p.x / scale, y: p.y / scale }))
  }
  // Higher smoothness → longer curve spans (less lattice wiggle).
  const epsilon = (0.9 + Math.min(5, smoothness) * 0.35) * Math.max(1, scale * 0.55)
  pts = simplifyPath(pts, epsilon)
  pts = collapseCollinear(pts, true)
  if (scale !== 1) pts = pts.map((p) => ({ x: p.x / scale, y: p.y / scale }))
  return pts
}

/**
 * Contour each color via binary bilinear upsample + soften so cubic paths
 * get sub-pixel edges (nearest-neighbor label upsampling does NOT remove stairs).
 */
function extractSmoothColorContours(
  labels: Uint16Array,
  width: number,
  height: number,
  minArea: number,
  smoothness: number,
): Map<number, Point[][][]> {
  const factor = smoothness > 0 ? 2 : 1
  const colors = new Set<number>()
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0xffff) colors.add(labels[i])
  }

  const out = new Map<number, Point[][][]>()
  for (const color of colors) {
    const mask = new Uint8Array(width * height)
    let count = 0
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === color) {
        mask[i] = 255
        count++
      }
    }
    if (count < minArea) continue

    let workMask = mask
    let ww = width
    let wh = height
    if (factor > 1) {
      const nw = width * factor
      const nh = height * factor
      const up = new Uint8Array(nw * nh)
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          const fx = x / factor
          const fy = y / factor
          const x0 = Math.min(width - 1, Math.floor(fx))
          const y0 = Math.min(height - 1, Math.floor(fy))
          const x1 = Math.min(width - 1, x0 + 1)
          const y1 = Math.min(height - 1, y0 + 1)
          const tx = fx - x0
          const ty = fy - y0
          const v00 = mask[y0 * width + x0] ? 1 : 0
          const v10 = mask[y0 * width + x1] ? 1 : 0
          const v01 = mask[y1 * width + x0] ? 1 : 0
          const v11 = mask[y1 * width + x1] ? 1 : 0
          const v =
            v00 * (1 - tx) * (1 - ty) +
            v10 * tx * (1 - ty) +
            v01 * (1 - tx) * ty +
            v11 * tx * ty
          up[y * nw + x] = v >= 0.5 ? 255 : 0
        }
      }
      // Soften stairs at high res
      let cur = up
      for (let pass = 0; pass < 2; pass++) {
        const acc = new Float32Array(nw * nh)
        for (let y = 0; y < nh; y++) {
          for (let x = 0; x < nw; x++) {
            let sum = 0
            let wt = 0
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                const nx = x + dx
                const ny = y + dy
                if (nx < 0 || ny < 0 || nx >= nw || ny >= nh) continue
                const wgt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1
                sum += (cur[ny * nw + nx] ? 1 : 0) * wgt
                wt += wgt
              }
            }
            acc[y * nw + x] = sum / wt
          }
        }
        const next = new Uint8Array(nw * nh)
        for (let i = 0; i < nw * nh; i++) next[i] = acc[i] >= 0.45 ? 255 : 0
        cur = next
      }
      workMask = cur
      ww = nw
      wh = nh
    }

    const lab = new Uint16Array(ww * wh)
    for (let i = 0; i < ww * wh; i++) lab[i] = workMask[i] ? 0 : 0xffff
    const raw = extractColorContours(
      lab,
      ww,
      wh,
      Math.max(4, minArea * factor * factor),
    )
    const components = raw.get(0) ?? []
    if (!components.length) continue
    out.set(
      color,
      components.map((rings) =>
        rings
          .map((ring) => processContour(ring, smoothness, factor))
          .filter((ring) => ring.length >= 3),
      ),
    )
  }
  return out
}

function applyMergeMap(labels: Uint16Array, mergeMap: number[]): Uint16Array {
  const out = new Uint16Array(labels.length)
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i]
    out[i] = v === 0xffff ? 0xffff : mergeMap[v] ?? v
  }
  return out
}

function buildMergeMap(colorCount: number, merges: Array<[number, number]>): number[] {
  const map = Array.from({ length: colorCount }, (_, i) => i)
  const find = (i: number): number => {
    let x = i
    while (map[x] !== x) x = map[x]
    return x
  }
  for (const [a, b] of merges) {
    if (a < 0 || b < 0 || a >= colorCount || b >= colorCount) continue
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) map[ra] = rb
  }
  for (let i = 0; i < colorCount; i++) map[i] = find(i)
  return map
}

function averageMergedPalette(palette: Rgb[], labels: Uint16Array, mergeMap: number[]): Rgb[] {
  const sums = palette.map(() => ({ r: 0, g: 0, b: 0, n: 0 }))
  for (let i = 0; i < palette.length; i++) {
    const t = mergeMap[i]
    sums[t].r += palette[i].r
    sums[t].g += palette[i].g
    sums[t].b += palette[i].b
    sums[t].n += 1
  }
  const pix = palette.map(() => ({ r: 0, g: 0, b: 0, n: 0 }))
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i]
    if (v === 0xffff) continue
    const t = mergeMap[v]
    pix[t].r += palette[v].r
    pix[t].g += palette[v].g
    pix[t].b += palette[v].b
    pix[t].n += 1
  }
  return palette.map((_, i) => {
    if (pix[i].n > 0) {
      return {
        r: Math.round(pix[i].r / pix[i].n),
        g: Math.round(pix[i].g / pix[i].n),
        b: Math.round(pix[i].b / pix[i].n),
      }
    }
    if (sums[i].n > 0) {
      return {
        r: Math.round(sums[i].r / sums[i].n),
        g: Math.round(sums[i].g / sums[i].n),
        b: Math.round(sums[i].b / sums[i].n),
      }
    }
    return palette[i]
  })
}

function resolvePaletteColors(
  basePalette: Rgb[],
  usedIndices: number[],
  snapToPms: boolean,
  overrides: PmsOverrides,
): { fillRgb: Rgb[]; meta: PaletteColor[] } {
  const fillRgb = basePalette.map((c) => ({ ...c }))
  const meta: PaletteColor[] = basePalette.map((c, index) => ({
    ...c,
    hex: rgbToHex(c),
    index,
  }))

  if (snapToPms) {
    const snapped = snapPaletteToPms(basePalette, { unique: true })
    for (let i = 0; i < basePalette.length; i++) {
      fillRgb[i] = snapped[i].rgb
      meta[i] = {
        ...snapped[i].rgb,
        hex: snapped[i].match.pms.hex,
        index: i,
        pmsCode: snapped[i].match.pms.code,
        pmsName: snapped[i].match.pms.name,
        pmsDeltaE: Math.round(snapped[i].match.deltaE * 10) / 10,
      }
    }
  } else {
    for (let i = 0; i < basePalette.length; i++) {
      const match = nearestPms(basePalette[i])
      meta[i] = {
        ...basePalette[i],
        hex: rgbToHex(basePalette[i]),
        index: i,
        pmsCode: match.pms.code,
        pmsName: match.pms.name,
        pmsDeltaE: Math.round(match.deltaE * 10) / 10,
      }
    }
  }

  for (const [key, code] of Object.entries(overrides)) {
    const index = Number(key)
    if (!Number.isFinite(index) || index < 0 || index >= basePalette.length) continue
    const pms = findPmsByCode(code)
    if (!pms) continue
    fillRgb[index] = { r: pms.r, g: pms.g, b: pms.b }
    meta[index] = {
      r: pms.r,
      g: pms.g,
      b: pms.b,
      hex: pms.hex,
      index,
      pmsCode: pms.code,
      pmsName: pms.name,
      pmsDeltaE: 0,
    }
  }

  // Only return used colors in meta list order
  const usedMeta = usedIndices
    .filter((i) => i >= 0 && i < meta.length)
    .sort((a, b) => a - b)
    .map((i) => meta[i])

  return { fillRgb, meta: usedMeta }
}

function stateToSvg(
  labels: Uint16Array,
  fillRgb: Rgb[],
  metaByIndex: Map<number, PaletteColor>,
  widthPx: number,
  heightPx: number,
  smoothness: number,
  minArea: number,
): { svg: string; regionCount: number } {
  const contoursByColor = extractSmoothColorContours(
    labels,
    widthPx,
    heightPx,
    minArea,
    smoothness,
  )
  const { regions } = labelRegions(labels, widthPx, heightPx)

  const legend = [...metaByIndex.values()]
    .map(
      (c) =>
        `  ${c.pmsName ?? c.hex} → ${c.hex}${
          c.pmsDeltaE != null ? ` (ΔE ${c.pmsDeltaE})` : ''
        }`,
    )
    .join('\n')

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}">`,
    `<!-- PMS Solid Coated palette\n${legend}\n-->`,
    '<g id="fills">',
  ]

  let drawn = 0
  for (const [colorIndex, components] of contoursByColor) {
    const fill = rgbToHex(fillRgb[colorIndex])
    const meta = metaByIndex.get(colorIndex)
    const pmsAttr = meta?.pmsCode ? ` data-pms="${meta.pmsCode}"` : ''
    for (const rings of components) {
      const processed = rings.filter((ring) => ring.length >= 3)
      if (!processed.length) continue
      const d = ringsToSvgD(processed, smoothness > 0, 55)
      if (!d) continue
      parts.push(
        `<path fill="${fill}" fill-rule="evenodd" stroke="none"${pmsAttr} d="${d}" />`,
      )
      drawn++
    }
  }
  parts.push('</g></svg>')

  return { svg: parts.join('\n'), regionCount: drawn || regions.length }
}

async function packResult(
  svg: string,
  widthPx: number,
  heightPx: number,
  palette: PaletteColor[],
  regionCount: number,
  state: ColorVectorState,
): Promise<ColorVectorResult> {
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  return {
    svg,
    svgBlob,
    svgUrl: URL.createObjectURL(svgBlob),
    widthPx,
    heightPx,
    palette,
    regionCount,
    state,
  }
}

function assemble(
  labels: Uint16Array,
  basePalette: Rgb[],
  widthPx: number,
  heightPx: number,
  smoothness: number,
  snapToPms: boolean,
  overrides: PmsOverrides,
  state: ColorVectorState,
  minArea = 24,
): Promise<ColorVectorResult> {
  const used = new Set<number>()
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0xffff) used.add(labels[i])
  }
  const usedIndices = [...used]
  const { fillRgb, meta } = resolvePaletteColors(
    basePalette,
    usedIndices,
    snapToPms,
    overrides,
  )
  const metaByIndex = new Map(meta.map((c) => [c.index, c]))
  const { svg, regionCount } = stateToSvg(
    labels,
    fillRgb,
    metaByIndex,
    widthPx,
    heightPx,
    smoothness,
    minArea,
  )
  return packResult(svg, widthPx, heightPx, meta, regionCount, state)
}

/**
 * Vectorizer.AI-style flat color vectorization with optional PMS snapping.
 * Line art is handled as black ink fills (never boundary-traced into double lines).
 */
export async function vectorizeColors(
  source: HTMLImageElement | ImageBitmap,
  settings: ColorVectorSettings,
  merges: Array<[number, number]> = [],
  overrides: PmsOverrides = {},
): Promise<ColorVectorResult> {
  // Crisp nearest-neighbor first — needed for line-art detection + ink extraction.
  const imageData = scaleToCanvas(source, settings.maxDim, false)
  const analysis = analyzeLineArt(imageData)
  knockOutNearWhite(imageData)
  const { width, height } = imageData

  if (analysis.isLineArt) {
    // Map ink → palette index 0 (black), paper → transparent.
    // Do NOT boundary-trace strokes (that yields hollow double lines).
    const ink = extractInkMask(imageData, 70, 'none')
    const labels = new Uint16Array(width * height)
    for (let i = 0; i < width * height; i++) {
      labels[i] = ink.mask[i] ? 0 : 0xffff
    }
    const palette: Rgb[] = [{ r: 20, g: 18, b: 16 }]
    // Keep tiny stroke fragments (hair, lace); color-art minRegionRatio is too aggressive.
    const minArea = Math.max(4, Math.round(width * height * 0.00002))
    const mergeMap = buildMergeMap(1, merges)
    return assemble(
      labels,
      palette,
      width,
      height,
      2, // cubic Bézier ink paths (no Chaikin) — no-pixel SVG
      false, // keep pure black ink — don't snap line art to random PMS
      overrides,
      {
        widthPx: width,
        heightPx: height,
        labels,
        palette,
        mergeMap,
      },
      minArea,
    )
  }

  const colorData = scaleToCanvas(source, settings.maxDim, false)
  knockOutNearWhite(colorData)
  knockOutNearBlackBackdrop(colorData)
  // Gold/bronze dams → black metal slot (matches finished pin look).
  remapMetalToBlack(colorData)
  const cw = colorData.width
  const ch = colorData.height
  // Higher fidelity for enamel cel art: keep thin black die-lines & highlights.
  const colorCount = Math.max(2, Math.min(32, settings.colorCount))
  const palette = extractPalette(colorData, colorCount, 1)
  // Merge soft shade cousins FIRST, then pin a dedicated ink-black slot.
  // (Doing black first made near-duplicate merge collapse browns/purples into pure black.)
  mergeNearDuplicateColors(palette, 22)
  ensureBlackSlot(palette, colorData)
  let labels = quantizeImage(colorData, palette)
  labels = denoiseLabels(labels, cw, ch, 2)

  const minArea = Math.max(
    8,
    Math.round(cw * ch * Math.max(0.00005, settings.minRegionRatio)),
  )
  labels = mergeSmallRegions(labels, cw, ch, minArea)
  labels = denoiseLabels(labels, cw, ch, 1)

  const mergeMap = buildMergeMap(palette.length, merges)
  const mergedLabels = applyMergeMap(labels, mergeMap)
  const mergedPalette = averageMergedPalette(palette, labels, mergeMap)

  return assemble(
    mergedLabels,
    mergedPalette,
    cw,
    ch,
    Math.max(0, settings.smoothness),
    settings.snapToPms,
    overrides,
    {
      widthPx: cw,
      heightPx: ch,
      labels,
      palette,
      mergeMap,
    },
    minArea,
  )
}

function ensureBlackSlot(palette: Rgb[], imageData: ImageData) {
  const { data } = imageData
  let blackPx = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue
    if (data[i] < 40 && data[i + 1] < 40 && data[i + 2] < 40) blackPx++
  }
  if (blackPx < 64) return
  let darkest = 0
  let darkestY = Infinity
  for (let i = 0; i < palette.length; i++) {
    const y = 0.299 * palette[i].r + 0.587 * palette[i].g + 0.114 * palette[i].b
    if (y < darkestY) {
      darkestY = y
      darkest = i
    }
  }
  palette[darkest] = { r: 12, g: 10, b: 10 }
}

/** Collapse near-identical enamel flats (kills hat grain / soft-shade speckles). */
function mergeNearDuplicateColors(palette: Rgb[], maxDist: number) {
  for (let i = 0; i < palette.length; i++) {
    const yi = 0.299 * palette[i].r + 0.587 * palette[i].g + 0.114 * palette[i].b
    // Never merge into/from near-black — that wipes the whole pin to ink.
    if (yi < 40) continue
    for (let j = i + 1; j < palette.length; j++) {
      const yj = 0.299 * palette[j].r + 0.587 * palette[j].g + 0.114 * palette[j].b
      if (yj < 40) continue
      if (colorDistance(palette[i], palette[j]) <= maxDist) {
        palette[j] = { ...palette[i] }
      }
    }
  }
}

/**
 * Re-run SVG assembly after palette merges / PMS overrides without re-quantizing.
 */
export async function applyPaletteMerges(
  state: ColorVectorState,
  merges: Array<[number, number]>,
  smoothness: number,
  snapToPms: boolean,
  overrides: PmsOverrides = {},
): Promise<ColorVectorResult> {
  const mergeMap = buildMergeMap(state.palette.length, merges)
  const mergedLabels = applyMergeMap(state.labels, mergeMap)
  const mergedPalette = averageMergedPalette(state.palette, state.labels, mergeMap)
  return assemble(
    mergedLabels,
    mergedPalette,
    state.widthPx,
    state.heightPx,
    smoothness,
    snapToPms,
    overrides,
    { ...state, mergeMap },
  )
}

export function suggestMerges(palette: PaletteColor[]): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = []
  for (let i = 0; i < palette.length; i++) {
    for (let j = i + 1; j < palette.length; j++) {
      pairs.push([palette[i].index, palette[j].index, colorDistance(palette[i], palette[j])])
    }
  }
  return pairs.sort((a, b) => a[2] - b[2])
}
