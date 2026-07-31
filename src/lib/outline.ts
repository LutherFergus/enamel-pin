import { init as initPotrace, potrace } from 'esm-potrace-wasm'
import type { RemoveBgOptions } from './background'
import type { Rgb } from './types'

export type OutlineSettings = {
  /**
   * Ink threshold / detail 0–100.
   * Lower = only the darkest metal walls (cleaner).
   * Higher = includes lighter hatches / thinner strokes.
   */
  sensitivity: number
  /** Extra stroke thicken in pixels (0–6). Prefer 0–1 for clean Vectorizer-style die-lines. */
  thickness: number
  /** Invert: white strokes on transparent instead of black. */
  invert: boolean
  /** Max working dimension for outline raster. */
  maxDim: number
}

export const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  sensitivity: 42,
  thickness: 0,
  invert: false,
  maxDim: 1600,
}

let potraceReady: Promise<void> | null = null

function ensurePotrace(): Promise<void> {
  if (!potraceReady) potraceReady = initPotrace()
  return potraceReady
}

export type OutlineResult = {
  pngBlob: Blob
  pngUrl: string
  /** Transparent background — no backdrop rect, only ink paths. */
  svg: string
  svgBlob: Blob
  svgUrl: string
  widthPx: number
  heightPx: number
  /** Potrace path count in the outline SVG. */
  pathCount: number
}

function drawScaled(
  source: HTMLImageElement | ImageBitmap,
  maxDim: number,
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; w: number; h: number } {
  const srcW = 'naturalWidth' in source ? source.naturalWidth : source.width
  const srcH = 'naturalHeight' in source ? source.naturalHeight : source.height
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // No smoothing — anti-aliased greys fill thin white islands when thresholded.
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(source, 0, 0, w, h)
  return { canvas, ctx, w, h }
}

/**
 * Soft-enamel die-line outline as transparent PNG + transparent SVG.
 * SVG has no background rectangle — only ink geometry on clear.
 */
export async function extractOutlinePng(
  source: HTMLImageElement | ImageBitmap,
  settings: OutlineSettings,
  background: RemoveBgOptions = { enabled: true },
): Promise<OutlineResult> {
  const { canvas, ctx, w, h } = drawScaled(source, settings.maxDim)
  const imageData = ctx.getImageData(0, 0, w, h)

  // Outline uses a gentler knockout than the vector path. Aggressive near-white
  // flood + halo cleanup eats anti-aliased edges and the ink mask then
  // re-thickens every stroke. Flat studio backdrops still clear cleanly.
  if (background.enabled !== false) {
    knockOutFlatBackdrop(imageData)
  }

  const { mask: rawMask, lineArt } = extractInkMask(imageData, settings.sensitivity)
  let mask = rawMask

  // Drop tiny speck components (noise left of silhouettes, texture grit)
  const minSpeck = lineArt
    ? Math.max(4, Math.round(w * h * 0.000008))
    : Math.max(12, Math.round(w * h * 0.00004))
  mask = removeSmallComponents(mask, w, h, minSpeck)

  if (lineArt) {
    // Vectorizer-style B&W: never fill white islands (polka dots, spokes, face).
    mask = removeIsolatedInk(mask, w, h)
  } else {
    // Color pin art often has large black enamel fills. Hollow those into
    // metal-wall strokes so Outline is a die-line plate, not a flooded silhouette.
    // Keep walls thin — thickness slider is the only intentional fatten.
    mask = toStrokeWalls(mask, w, h, 1)
    mask = majorityClean(mask, w, h)
    mask = removeSmallComponents(mask, w, h, Math.max(10, Math.round(w * h * 0.00003)))
  }

  const thickness = Math.max(0, Math.min(6, Math.round(settings.thickness)))
  if (thickness > 0) {
    mask = dilate(mask, w, h, thickness)
  }

  // Soft enamel outline plate is always pure black (or white if inverted).
  const stroke: Rgb = settings.invert
    ? { r: 255, g: 255, b: 255 }
    : { r: 0, g: 0, b: 0 }

  const out = ctx.createImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (mask[i]) {
      out.data[o] = stroke.r
      out.data[o + 1] = stroke.g
      out.data[o + 2] = stroke.b
      out.data[o + 3] = 255
    } else {
      out.data[o] = 0
      out.data[o + 1] = 0
      out.data[o + 2] = 0
      out.data[o + 3] = 0
    }
  }

  ctx.clearRect(0, 0, w, h)
  ctx.putImageData(out, 0, 0)

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode outline PNG'))),
      'image/png',
    )
  })

  const svg = await maskToTransparentSvg(out, w, h, stroke)
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const pathCount = (svg.match(/<path\b/gi) || []).length

  return {
    pngBlob,
    pngUrl: URL.createObjectURL(pngBlob),
    svg,
    svgBlob,
    svgUrl: URL.createObjectURL(svgBlob),
    widthPx: w,
    heightPx: h,
    pathCount,
  }
}

/**
 * Morphological gradient: keep dark pixels that sit on the edge of a dark
 * region. Solid black enamel → hollow wall; already-thin strokes → kept.
 */
function toStrokeWalls(
  dark: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  const eroded = erode(dark, w, h, Math.max(1, radius))
  const out = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (dark[i] && !eroded[i]) out[i] = 255
  }
  return out
}

/**
 * Gentle studio-backdrop clear for outline only.
 * Only floods clearly flat light/dark corners — does not eat AA stroke edges.
 */
function knockOutFlatBackdrop(imageData: ImageData): void {
  const { data, width, height } = imageData
  const samples: Array<{ r: number; g: number; b: number }> = []
  const pts: Array<[number, number]> = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
    [width >> 1, 2],
    [width >> 1, height - 3],
  ]
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const o = (y * width + x) * 4
    if (data[o + 3] < 16) continue
    samples.push({ r: data[o], g: data[o + 1], b: data[o + 2] })
  }
  if (samples.length < 2) return

  const avg = {
    r: Math.round(samples.reduce((s, c) => s + c.r, 0) / samples.length),
    g: Math.round(samples.reduce((s, c) => s + c.g, 0) / samples.length),
    b: Math.round(samples.reduce((s, c) => s + c.b, 0) / samples.length),
  }
  const isLight = avg.r > 230 && avg.g > 230 && avg.b > 230
  const isDark = avg.r < 28 && avg.g < 28 && avg.b < 28
  if (!isLight && !isDark) return

  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  const isBackdrop = (o: number) => {
    if (data[o + 3] < 16) return true
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    if (isLight) {
      return r > 220 && g > 220 && b > 220
    }
    return r < 40 && g < 40 && b < 40
  }
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = y * width + x
    if (visited[i]) return
    if (!isBackdrop(i * 4)) return
    visited[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }
  while (stack.length) {
    const i = stack.pop()!
    data[i * 4 + 3] = 0
    const x = i % width
    const y = (i / width) | 0
    push(x - 1, y)
    push(x + 1, y)
    push(x, y - 1)
    push(x, y + 1)
  }
}

/**
 * Potrace the ink mask into smooth cubic Bezier paths on a fully transparent SVG.
 * Tuned toward Vectorizer.AI-style die-lines: no backdrop rect, fill #000000.
 *
 * Note: pathonly mode omits Potrace's y-flip/scale transform, so we keep the full SVG
 * and restyle it (fill + dimensions) instead of rebuilding path coordinates.
 */
async function maskToTransparentSvg(
  imageData: ImageData,
  w: number,
  h: number,
  ink: Rgb,
): Promise<string> {
  await ensurePotrace()

  // Supersample fattens 1px strokes via nearest-neighbor — skip it so thin
  // Vectorizer-style walls and white islands stay faithful.
  const tw = w
  const th = h
  const bw = new ImageData(tw, th)

  for (let i = 0; i < w * h; i++) {
    const si = i * 4
    const di = i * 4
    const on = imageData.data[si + 3] >= 128
    const v = on ? 0 : 255
    bw.data[di] = v
    bw.data[di + 1] = v
    bw.data[di + 2] = v
    bw.data[di + 3] = 255
  }

  const inkHex = `#${[ink.r, ink.g, ink.b]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`

  // Keep turdsize low so fine black details survive; white holes are topology.
  const turdsize = Math.max(2, Math.round(tw * th * 0.000004))
  const traced = await potrace(bw, {
    turdsize,
    turnpolicy: 4,
    alphamax: 0.88,
    opticurve: 1,
    opttolerance: 0.2,
    pathonly: false,
    extractcolors: false,
  })

  return restylePotraceSvg(String(traced), w, h, tw, th, inkHex)
}

function restylePotraceSvg(
  svg: string,
  w: number,
  h: number,
  tw: number,
  th: number,
  inkHex: string,
): string {
  let s = svg
    .replace(/<\?xml[^>]*>/i, '')
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<rect\b[^>]*\/?>/gi, '')
    .replace(/\sfill="[^"]*"/gi, ` fill="${inkHex}"`)
    .replace(/\sfill='[^']*'/gi, ` fill="${inkHex}"`)
    .trim()

  s = s.replace(/<svg\b[^>]*>/i, () => {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tw} ${th}" width="${w}" height="${h}" shape-rendering="geometricPrecision">`,
      `<!-- Transparent enamel die-line outline · Potrace · no background -->`,
    ].join('\n')
  })

  // Keep Potrace's translate/scale group; tag it for clarity.
  s = s.replace(/<g\b([^>]*)>/i, (_m, attrs: string) => {
    const cleaned = String(attrs)
      .replace(/\bid="[^"]*"/i, '')
      .replace(/\sfill="[^"]*"/i, '')
    return `<g id="outline"${cleaned} fill="${inkHex}">`
  })

  return s
}

/**
 * Build an ink/metal-wall mask from dark stroke pixels.
 * Sensitivity maps to luminance threshold + local-contrast gate.
 */
function extractInkMask(
  imageData: ImageData,
  sensitivity: number,
): { mask: Uint8Array; lineArt: boolean } {
  const { data, width, height } = imageData
  const n = width * height
  const lum = new Float32Array(n)
  let opaque = 0
  let darkish = 0
  let lightish = 0
  let chromaSum = 0

  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (data[o + 3] < 128) {
      lum[i] = 255
      continue
    }
    opaque++
    const y = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]
    lum[i] = y
    if (y < 70) darkish++
    if (y > 200) lightish++
    chromaSum += chromaAt(data, o)
  }

  const avgChroma = opaque > 0 ? chromaSum / opaque : 0
  // Line art: bimodal dark+light, low chroma (B&W / near-B&W strokes).
  // Color pins with black enamel fills must NOT take this path (they'd flood).
  const lineArt =
    opaque > 0 &&
    avgChroma < 28 &&
    darkish / opaque > 0.08 &&
    (darkish + lightish) / opaque > 0.82

  const t = Math.max(0, Math.min(100, sensitivity)) / 100
  // Keep line-art ceil tight so anti-aliased stroke edges don't become solid ink
  // (that was fattening every wall vs Vectorizer / our earlier thin die-lines).
  const inkCeil = lineArt ? 32 + t * 48 : 28 + t * 55
  const contrastMin = lineArt ? 10 + (1 - t) * 18 : 14 + (1 - t) * 22

  const mask = new Uint8Array(n)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const o = i * 4
      if (data[o + 3] < 128) continue

      const L = lum[i]
      if (L > inkCeil + 40) continue

      let maxN = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const v = lum[(y + dy) * width + (x + dx)]
          if (v > maxN) maxN = v
        }
      }
      const contrast = maxN - L

      const nearBlack = L <= inkCeil * 0.55 && chromaAt(data, o) < 35
      const darkEdge = L <= inkCeil && contrast >= contrastMin
      const strongInk = L <= 22
      // Line art: only true dark ink — not mid-gray AA halos around strokes.
      const lineInk = lineArt && L <= Math.min(inkCeil, 48) && chromaAt(data, o) < 28

      if (nearBlack || darkEdge || strongInk || lineInk) mask[i] = 255
    }
  }

  // Outer die edge for product photos; skip on line art (would fatten every stroke).
  if (!lineArt) {
    addSilhouetteRing(mask, data, width, height)
  }

  return { mask, lineArt }
}

function chromaAt(data: Uint8ClampedArray, o: number): number {
  return Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2])
}

function addSilhouetteRing(
  mask: Uint8Array,
  data: Uint8ClampedArray,
  w: number,
  h: number,
) {
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const o = i * 4
      if (data[o + 3] < 128) continue
      let border = false
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const no = ((y + dy) * w + (x + dx)) * 4
        if (data[no + 3] < 128) {
          border = true
          break
        }
      }
      if (border) mask[i] = 255
    }
  }
}

function removeSmallComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  minArea: number,
): Uint8Array {
  const seen = new Uint8Array(w * h)
  const out = new Uint8Array(mask)
  const stack: number[] = []

  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue
    stack.length = 0
    stack.push(i)
    seen[i] = 1
    const comp: number[] = []
    while (stack.length) {
      const cur = stack.pop()!
      comp.push(cur)
      const x = cur % w
      const y = (cur / w) | 0
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (seen[ni] || !mask[ni]) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }
    if (comp.length < minArea) {
      for (const p of comp) out[p] = 0
    }
  }
  return out
}

function majorityClean(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      let on = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[(y + dy) * w + (x + dx)]) on++
        }
      }
      // Remove isolated 1-px grit; keep real strokes
      if (mask[i] && on <= 2) out[i] = 0
      else if (!mask[i] && on >= 7) out[i] = 255
    }
  }
  return out
}

/** Drop speck ink only — never fill white holes (polka dots, spokes, face gaps). */
function removeIsolatedInk(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (!mask[i]) continue
      let on = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[(y + dy) * w + (x + dx)]) on++
        }
      }
      if (on <= 2) out[i] = 0
    }
  }
  return out
}

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask
  const out = new Uint8Array(mask)
  const r2 = radius * radius
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
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

function erode(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask
  const out = new Uint8Array(w * h)
  for (let y = radius; y < h - radius; y++) {
    for (let x = radius; x < w - radius; x++) {
      if (!mask[y * w + x]) continue
      let keep = true
      for (let dy = -radius; dy <= radius && keep; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
          if (!mask[(y + dy) * w + (x + dx)]) {
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
