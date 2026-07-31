import { removeBackground, type RemoveBgOptions } from './background'
import { dropSpeckIslands, overlapAdjacentFills, smoothLabelBoundaries } from './labelSmooth'
import {
  deltaE76,
  findPmsByCode,
  nearestPms,
  rgbToLab,
  snapPaletteToPms,
} from './pms'
import { countLabelUsage, denoiseLabels, extractPalette, quantizeImage } from './quantize'
import { labelRegions, mergeSmallRegions } from './regions'
import { labelsToSmoothSvg } from './traceSvg'
import type { PaletteColor, Rgb } from './types'
import { colorDistance, rgbToHex } from './types'

export type ColorVectorSettings = {
  colorCount: number
  /**
   * Detail retention 0–100.
   * Higher keeps small shapes, polka dots, engine fins; lower merges speckles.
   */
  detailRetention: number
  /** @deprecated Derived from detailRetention when absent in older saves. */
  minRegionRatio: number
  smoothness: number
  maxDim: number
  /** Snap fills to nearest Pantone Solid Coated (PMS) colors. */
  snapToPms: boolean
  /**
   * CIE76 ΔE tolerance for combining near-matching fills (0–30).
   * Higher collapses near-blacks / near-reds into one PMS enamel flat.
   */
  pmsTolerance: number
}

export const DEFAULT_COLOR_VECTOR_SETTINGS: ColorVectorSettings = {
  colorCount: 12,
  detailRetention: 100,
  // Kept in sync with detailRetentionParams(100) for older readers.
  minRegionRatio: 0.00005,
  smoothness: 1,
  maxDim: 1000,
  snapToPms: true,
  pmsTolerance: 10,
}

/** Map detail retention slider → cleanup / trace knobs. */
export function detailRetentionParams(detailRetention: number) {
  const t = Math.max(0, Math.min(100, detailRetention)) / 100
  // High retention → tiny min regions; low → aggressive merge.
  const minRegionRatio = 0.0022 * (1 - t) + 0.00005 * t
  const denoisePasses = t >= 0.75 ? 1 : t >= 0.4 ? 2 : 3
  const boundaryPasses = t >= 0.7 ? 1 : t >= 0.4 ? 2 : 3
  const speckScale = 0.35 + (1 - t) * 0.85
  // Tracer pathomit: lower keeps small islands (polka dots, fins).
  const pathomitScale = 1.35 - t * 0.95
  return { minRegionRatio, denoisePasses, boundaryPasses, speckScale, pathomitScale, t }
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
  ctx.drawImage(source, 0, 0, w, h)
  return ctx.getImageData(0, 0, w, h)
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

/**
 * Combine palette slots whose colors are close in Lab (ΔE ≤ tolerance),
 * or that share the same nearest PMS when snapping is on.
 * Minority areas fold into majority so you don't get six near-blacks.
 */
export function autoMergeCloseColors(
  palette: Rgb[],
  areas: number[],
  tolerance: number,
  snapToPms: boolean,
): Array<[number, number]> {
  const n = palette.length
  if (n < 2 || tolerance <= 0) return []

  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (i: number): number => {
    let x = i
    while (parent[x] !== x) x = parent[x]
    return x
  }
  const union = (a: number, b: number) => {
    let ra = find(a)
    let rb = find(b)
    if (ra === rb) return
    // Keep the larger-area color as the merge root.
    const areaA = areas[ra] ?? 0
    const areaB = areas[rb] ?? 0
    if (areaB > areaA) {
      const tmp = ra
      ra = rb
      rb = tmp
    }
    parent[rb] = ra
  }

  const labs = palette.map((c) => rgbToLab(c))
  const nearest = snapToPms ? palette.map((c) => nearestPms(c)) : null
  // Same nearest PMS merges a bit more eagerly than raw Lab pairs.
  const samePmsGate = Math.max(tolerance, 6)

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (deltaE76(labs[i], labs[j]) <= tolerance) {
        union(i, j)
        continue
      }
      if (
        nearest &&
        nearest[i].pms.code === nearest[j].pms.code &&
        nearest[i].deltaE <= samePmsGate &&
        nearest[j].deltaE <= samePmsGate
      ) {
        union(i, j)
      }
    }
  }

  const merges: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const root = find(i)
    if (root !== i) merges.push([i, root])
  }
  return merges
}

function combineMerges(
  colorCount: number,
  autoMerges: Array<[number, number]>,
  userMerges: Array<[number, number]>,
): Array<[number, number]> {
  // Auto first so user merges still win via later union-find links.
  return [...autoMerges, ...userMerges].filter(
    ([a, b]) =>
      a !== b &&
      a >= 0 &&
      b >= 0 &&
      a < colorCount &&
      b < colorCount,
  )
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
  areas?: number[],
  pmsTolerance = 0,
): { fillRgb: Rgb[]; meta: PaletteColor[] } {
  const fillRgb = basePalette.map((c) => ({ ...c }))
  const meta: PaletteColor[] = basePalette.map((c, index) => ({
    ...c,
    hex: rgbToHex(c),
    index,
  }))

  if (snapToPms) {
    const snapped = snapPaletteToPms(basePalette, {
      // When tolerance > 0, allow near-matches to share one PMS code.
      unique: pmsTolerance <= 0,
      areas,
      maxDeltaE: Math.max(20, pmsTolerance + 8),
      shareWithinDeltaE: pmsTolerance,
    })
    for (let i = 0; i < basePalette.length; i++) {
      fillRgb[i] = snapped[i].rgb
      meta[i] = {
        ...snapped[i].rgb,
        hex: rgbToHex(snapped[i].rgb),
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
  pathomitScale = 1,
): { svg: string; regionCount: number } {
  const { regions } = labelRegions(labels, widthPx, heightPx)
  const { svg, pathCount } = labelsToSmoothSvg(labels, fillRgb, metaByIndex, {
    smoothness,
    widthPx,
    heightPx,
    pathomitScale,
  })
  return { svg, regionCount: Math.max(regions.length, pathCount) }
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
  pathomitScale = 1,
  pmsTolerance = 0,
): Promise<ColorVectorResult> {
  const used = new Set<number>()
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== 0xffff) used.add(labels[i])
  }
  const usedIndices = [...used]
  const areas = countLabelUsage(labels, basePalette.length)
  const { fillRgb, meta } = resolvePaletteColors(
    basePalette,
    usedIndices,
    snapToPms,
    overrides,
    areas,
    pmsTolerance,
  )
  const metaByIndex = new Map(meta.map((c) => [c.index, c]))
  const { svg, regionCount } = stateToSvg(
    labels,
    fillRgb,
    metaByIndex,
    widthPx,
    heightPx,
    smoothness,
    pathomitScale,
  )
  return packResult(svg, widthPx, heightPx, meta, regionCount, state)
}

/**
 * Vectorizer.AI-style flat color vectorization with optional PMS snapping.
 */
export async function vectorizeColors(
  source: HTMLImageElement | ImageBitmap,
  settings: ColorVectorSettings,
  merges: Array<[number, number]> = [],
  overrides: PmsOverrides = {},
  background: RemoveBgOptions = { enabled: true },
): Promise<ColorVectorResult> {
  const imageData = scaleToCanvas(source, settings.maxDim)
  // Product-photo backdrops must not become the "primary" palette color.
  removeBackground(imageData, background)
  const { width, height } = imageData
  const detail = detailRetentionParams(settings.detailRetention)
  const palette = extractPalette(imageData, settings.colorCount)
  let labels = quantizeImage(imageData, palette)
  labels = denoiseLabels(labels, width, height, detail.denoisePasses)

  const minArea = Math.max(
    8,
    Math.round(width * height * detail.minRegionRatio),
  )
  labels = mergeSmallRegions(labels, width, height, minArea)
  // Round off pixel stairs on region boundaries before spline fitting.
  labels = smoothLabelBoundaries(labels, width, height, detail.boundaryPasses)
  labels = dropSpeckIslands(
    labels,
    width,
    height,
    Math.max(12, Math.round(minArea * detail.speckScale)),
  )
  if (detail.boundaryPasses > 1) {
    labels = smoothLabelBoundaries(labels, width, height, 1)
  }
  // Overlap abutting fills so vector paths seal (no checkerboard hairlines).
  labels = overlapAdjacentFills(labels, width, height)

  const areas = countLabelUsage(labels, palette.length)
  const autoMerges = autoMergeCloseColors(
    palette,
    areas,
    settings.pmsTolerance,
    settings.snapToPms,
  )
  const allMerges = combineMerges(palette.length, autoMerges, merges)
  const mergeMap = buildMergeMap(palette.length, allMerges)
  const mergedLabels = applyMergeMap(labels, mergeMap)
  const mergedPalette = averageMergedPalette(palette, labels, mergeMap)

  return assemble(
    mergedLabels,
    mergedPalette,
    width,
    height,
    settings.smoothness,
    settings.snapToPms,
    overrides,
    {
      widthPx: width,
      heightPx: height,
      labels,
      palette,
      mergeMap,
    },
    detail.pathomitScale,
    settings.pmsTolerance,
  )
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
  pathomitScale = 1,
  pmsTolerance = DEFAULT_COLOR_VECTOR_SETTINGS.pmsTolerance,
): Promise<ColorVectorResult> {
  const areas = countLabelUsage(state.labels, state.palette.length)
  const autoMerges = autoMergeCloseColors(
    state.palette,
    areas,
    pmsTolerance,
    snapToPms,
  )
  const allMerges = combineMerges(state.palette.length, autoMerges, merges)
  const mergeMap = buildMergeMap(state.palette.length, allMerges)
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
    pathomitScale,
    pmsTolerance,
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
