import { extractColorContours, pathToSvgD, simplifyPath, smoothPath } from './contours'
import type { Point } from './contours'
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
}

export const DEFAULT_COLOR_VECTOR_SETTINGS: ColorVectorSettings = {
  colorCount: 8,
  minRegionRatio: 0.0004,
  smoothness: 2,
  maxDim: 900,
}

export type ColorVectorState = {
  widthPx: number
  heightPx: number
  /** Working quantized labels (0xffff = transparent). */
  labels: Uint16Array
  /** Active palette colors (index matches label values that remain in use). */
  palette: Rgb[]
  /** Optional user merges: source palette index → target palette index. */
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

function processContour(points: Point[], smoothness: number): Point[] {
  const epsilon = 0.55 + (5 - Math.min(5, smoothness)) * 0.12
  let pts = simplifyPath(points, epsilon)
  if (smoothness > 0) {
    pts = smoothPath(pts, smoothness)
    pts = simplifyPath(pts, Math.max(0.25, epsilon * 0.5))
  }
  return pts
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
  // Weight by original palette presence after remap: use palette colors themselves
  for (let i = 0; i < palette.length; i++) {
    const t = mergeMap[i]
    sums[t].r += palette[i].r
    sums[t].g += palette[i].g
    sums[t].b += palette[i].b
    sums[t].n += 1
  }
  // Also weight by pixel frequency for better visual average
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

function stateToSvg(
  labels: Uint16Array,
  palette: Rgb[],
  widthPx: number,
  heightPx: number,
  smoothness: number,
): { svg: string; palette: PaletteColor[]; regionCount: number } {
  const contoursByColor = extractColorContours(labels, widthPx, heightPx)
  const { regions } = labelRegions(labels, widthPx, heightPx)
  const used = new Set<number>()
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}">`,
    '<g id="fills">',
  ]

  for (const [colorIndex, contours] of contoursByColor) {
    used.add(colorIndex)
    const fill = rgbToHex(palette[colorIndex])
    for (const contour of contours) {
      const pts = processContour(contour, smoothness)
      const d = pathToSvgD(pts)
      if (!d) continue
      parts.push(`<path fill="${fill}" stroke="none" d="${d}" />`)
    }
  }
  parts.push('</g></svg>')

  const paletteOut: PaletteColor[] = [...used]
    .sort((a, b) => a - b)
    .map((index) => ({ ...palette[index], hex: rgbToHex(palette[index]), index }))

  return {
    svg: parts.join('\n'),
    palette: paletteOut,
    regionCount: regions.length,
  }
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

/**
 * Vectorizer.AI-style flat color vectorization.
 */
export async function vectorizeColors(
  source: HTMLImageElement | ImageBitmap,
  settings: ColorVectorSettings,
  merges: Array<[number, number]> = [],
): Promise<ColorVectorResult> {
  const imageData = scaleToCanvas(source, settings.maxDim)
  const { width, height } = imageData
  const palette = extractPalette(imageData, settings.colorCount)
  let labels = quantizeImage(imageData, palette)
  labels = denoiseLabels(labels, width, height, 2)

  const minArea = Math.max(
    8,
    Math.round(width * height * settings.minRegionRatio),
  )
  labels = mergeSmallRegions(labels, width, height, minArea)

  const mergeMap = buildMergeMap(palette.length, merges)
  const mergedLabels = applyMergeMap(labels, mergeMap)
  const mergedPalette = averageMergedPalette(palette, labels, mergeMap)

  const { svg, palette: paletteOut, regionCount } = stateToSvg(
    mergedLabels,
    mergedPalette,
    width,
    height,
    settings.smoothness,
  )

  return packResult(svg, width, height, paletteOut, regionCount, {
    widthPx: width,
    heightPx: height,
    labels,
    palette,
    mergeMap,
  })
}

/**
 * Re-run SVG assembly after palette merges without re-quantizing.
 */
export async function applyPaletteMerges(
  state: ColorVectorState,
  merges: Array<[number, number]>,
  smoothness: number,
): Promise<ColorVectorResult> {
  const mergeMap = buildMergeMap(state.palette.length, merges)
  const mergedLabels = applyMergeMap(state.labels, mergeMap)
  const mergedPalette = averageMergedPalette(state.palette, state.labels, mergeMap)
  const { svg, palette, regionCount } = stateToSvg(
    mergedLabels,
    mergedPalette,
    state.widthPx,
    state.heightPx,
    smoothness,
  )
  return packResult(svg, state.widthPx, state.heightPx, palette, regionCount, {
    ...state,
    mergeMap,
  })
}

/**
 * Suggest nearest-color pairs to help users lower the color count.
 */
export function suggestMerges(palette: PaletteColor[]): Array<[number, number, number]> {
  const pairs: Array<[number, number, number]> = []
  for (let i = 0; i < palette.length; i++) {
    for (let j = i + 1; j < palette.length; j++) {
      pairs.push([palette[i].index, palette[j].index, colorDistance(palette[i], palette[j])])
    }
  }
  return pairs.sort((a, b) => a[2] - b[2])
}
