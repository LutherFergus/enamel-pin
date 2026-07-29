import { extractColorContours, pathToSvgD, simplifyPath, smoothPath } from './contours'
import type { Point } from './contours'
import { denoiseLabels, extractPalette, quantizeImage } from './quantize'
import { labelRegions, mergeSmallRegions } from './regions'
import type { EnamelSettings, PaletteColor, Rgb, VectorizeResult } from './types'
import { mmToPx, rgbToHex } from './types'

export type PreparedImage = {
  imageData: ImageData
  widthPx: number
  heightPx: number
  widthMm: number
  heightMm: number
}

/**
 * Scale source image to pin dimensions at the working DPI.
 */
export function prepareImage(
  source: HTMLImageElement | ImageBitmap,
  settings: EnamelSettings,
): PreparedImage {
  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height
  const aspect = srcW / srcH

  const widthMm = settings.pinWidthMm
  const heightMm = settings.pinHeightMm ?? widthMm / aspect
  let widthPx = Math.max(32, Math.round(mmToPx(widthMm, settings.dpi)))
  let heightPx = Math.max(32, Math.round(mmToPx(heightMm, settings.dpi)))

  // Cap working resolution for browser performance
  const maxDim = 1200
  if (widthPx > maxDim || heightPx > maxDim) {
    const scale = maxDim / Math.max(widthPx, heightPx)
    widthPx = Math.max(32, Math.round(widthPx * scale))
    heightPx = Math.max(32, Math.round(heightPx * scale))
  }

  const canvas = document.createElement('canvas')
  canvas.width = widthPx
  canvas.height = heightPx
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, widthPx, heightPx)
  ctx.drawImage(source, 0, 0, widthPx, heightPx)

  return {
    imageData: ctx.getImageData(0, 0, widthPx, heightPx),
    widthPx,
    heightPx,
    widthMm,
    heightMm,
  }
}

/**
 * Build metal-wall segments wherever two different enamel colors touch.
 * Returns polylines along the shared edges (pixel grid midpoints).
 */
export function extractMetalOutlines(
  labels: Uint16Array,
  width: number,
  height: number,
): Point[][] {
  const segments: Point[][] = []
  const seen = new Set<string>()

  const addSeg = (a: Point, b: Point) => {
    const key =
      a.x < b.x || (a.x === b.x && a.y <= b.y)
        ? `${a.x},${a.y}|${b.x},${b.y}`
        : `${b.x},${b.y}|${a.x},${a.y}`
    if (seen.has(key)) return
    seen.add(key)
    segments.push([a, b])
  }

  // Horizontal adjacencies → vertical wall segments between pixels
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const a = labels[y * width + x]
      const b = labels[y * width + x + 1]
      if (a === 0xffff || b === 0xffff) continue
      if (a === b) continue
      addSeg({ x: x + 1, y }, { x: x + 1, y: y + 1 })
    }
  }

  // Vertical adjacencies → horizontal wall segments
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const a = labels[y * width + x]
      const b = labels[(y + 1) * width + x]
      if (a === 0xffff || b === 0xffff) continue
      if (a === b) continue
      addSeg({ x, y: y + 1 }, { x: x + 1, y: y + 1 })
    }
  }

  return joinSegments(segments)
}

function joinSegments(segments: Point[][]): Point[][] {
  if (segments.length === 0) return []

  type Key = string
  const keyOf = (p: Point): Key => `${p.x},${p.y}`

  const adj = new Map<Key, Point[]>()
  for (const [a, b] of segments) {
    if (!adj.has(keyOf(a))) adj.set(keyOf(a), [])
    if (!adj.has(keyOf(b))) adj.set(keyOf(b), [])
    adj.get(keyOf(a))!.push(b)
    adj.get(keyOf(b))!.push(a)
  }

  const used = new Set<string>()
  const edgeKey = (a: Point, b: Point) =>
    a.x < b.x || (a.x === b.x && a.y <= b.y)
      ? `${a.x},${a.y}|${b.x},${b.y}`
      : `${b.x},${b.y}|${a.x},${a.y}`

  const polylines: Point[][] = []

  for (const [a, b] of segments) {
    const ek = edgeKey(a, b)
    if (used.has(ek)) continue

    // Grow a polyline from this edge
    const line: Point[] = [a, b]
    used.add(ek)

    // Extend forward from b
    let head = b
    for (;;) {
      const neighbors = adj.get(keyOf(head)) ?? []
      let next: Point | null = null
      for (const n of neighbors) {
        const k = edgeKey(head, n)
        if (!used.has(k)) {
          next = n
          used.add(k)
          break
        }
      }
      if (!next) break
      line.push(next)
      head = next
    }

    // Extend backward from a
    let tail = a
    for (;;) {
      const neighbors = adj.get(keyOf(tail)) ?? []
      let prev: Point | null = null
      for (const n of neighbors) {
        const k = edgeKey(tail, n)
        if (!used.has(k)) {
          prev = n
          used.add(k)
          break
        }
      }
      if (!prev) break
      line.unshift(prev)
      tail = prev
    }

    if (line.length >= 2) polylines.push(line)
  }

  return polylines
}

function processContour(
  points: Point[],
  smoothness: number,
  simplifyEpsilon: number,
): Point[] {
  let pts = simplifyPath(points, Math.max(0.4, simplifyEpsilon))
  if (smoothness > 0) {
    pts = smoothPath(pts, smoothness)
    pts = simplifyPath(pts, Math.max(0.25, simplifyEpsilon * 0.5))
  }
  return pts
}

export function vectorizeToSvg(
  prepared: PreparedImage,
  settings: EnamelSettings,
): VectorizeResult {
  const { imageData, widthPx, heightPx, widthMm, heightMm } = prepared
  const palette: Rgb[] = extractPalette(imageData, settings.colorCount)
  let labels = quantizeImage(imageData, palette)
  labels = denoiseLabels(labels, widthPx, heightPx, 2)

  const minFillPx = Math.max(4, Math.round(mmToPx(settings.minFillMm, settings.dpi) ** 2))
  // Working canvas may be capped below true DPI — scale min area to canvas px
  const trueWidthPx = mmToPx(widthMm, settings.dpi)
  const scale = widthPx / trueWidthPx
  const scaledMinArea = Math.max(4, Math.round(minFillPx * scale * scale))
  labels = mergeSmallRegions(labels, widthPx, heightPx, scaledMinArea)

  const contoursByColor = extractColorContours(labels, widthPx, heightPx)
  const metalPolylines = extractMetalOutlines(labels, widthPx, heightPx)

  const simplifyEpsilon = 0.6 + (8 - Math.min(8, settings.smoothness)) * 0.15
  const metalWallPx = Math.max(
    0.5,
    mmToPx(settings.metalWallMm, settings.dpi) * scale,
  )

  // Outer pin silhouette: union of all non-transparent pixels
  const outerLabels = new Uint16Array(labels.length)
  for (let i = 0; i < labels.length; i++) {
    outerLabels[i] = labels[i] === 0xffff ? 0xffff : 0
  }
  const outerContours = extractColorContours(outerLabels, widthPx, heightPx)
  const outerPaths = (outerContours.get(0) ?? []).map((c) =>
    processContour(c, settings.smoothness, simplifyEpsilon),
  )

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthMm}mm" height="${heightMm}mm" data-enamel="soft">`,
  )
  parts.push('<g id="enamel-fills">')

  const usedColors = new Set<number>()
  for (const [colorIndex, contours] of contoursByColor) {
    usedColors.add(colorIndex)
    const fill = rgbToHex(palette[colorIndex])
    for (const contour of contours) {
      const pts = processContour(contour, settings.smoothness, simplifyEpsilon)
      const d = pathToSvgD(pts)
      if (!d) continue
      parts.push(`<path fill="${fill}" stroke="none" d="${d}" />`)
    }
  }
  parts.push('</g>')

  parts.push(`<g id="metal-outlines" fill="none" stroke="${settings.outlineColor}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${metalWallPx.toFixed(2)}">`)

  // Color-meeting walls
  for (const line of metalPolylines) {
    const pts = processContour(line, Math.min(2, settings.smoothness), simplifyEpsilon * 0.8)
    if (pts.length < 2) continue
    const d = pathToSvgD(pts, false)
    parts.push(`<path d="${d}" />`)
  }

  // Outer metal rim
  for (const pts of outerPaths) {
    const d = pathToSvgD(pts, true)
    if (!d) continue
    parts.push(`<path d="${d}" />`)
  }
  parts.push('</g>')
  parts.push('</svg>')

  const { regions } = labelRegions(labels, widthPx, heightPx)

  const paletteOut: PaletteColor[] = palette.map((c, index) => ({
    ...c,
    hex: rgbToHex(c),
    index,
  }))

  return {
    svg: parts.join('\n'),
    widthPx,
    heightPx,
    widthMm,
    heightMm,
    palette: paletteOut.filter((c) => usedColors.has(c.index)),
    regionCount: regions.length,
  }
}

export async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}
