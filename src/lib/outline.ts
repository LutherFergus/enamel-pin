import { init as initPotrace, potrace } from 'esm-potrace-wasm'
import {
  fillTransparentWithWhite,
  removeBackground,
  type RemoveBgOptions,
} from './background'
import { bakeOutlineSvg } from './potraceBake'
import type { Rgb } from './types'

export type OutlineSettings = {
  /**
   * Ink threshold / detail 0–100.
   * Lower = only the darkest metal walls (cleaner).
   * Higher = includes lighter hatches / thinner strokes.
   */
  sensitivity: number
  /** Extra stroke thicken in pixels (0.1–6, decimal). Prefer ~0.1–1 for clean Vectorizer-style die-lines. */
  thickness: number
  /** Invert: white strokes on transparent instead of black. */
  invert: boolean
  /** Max working dimension for outline raster. */
  maxDim: number
}

export const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  sensitivity: 48,
  thickness: 0.8,
  invert: false,
  // Match imaengine Vector Q outline working size (~1800).
  maxDim: 1800,
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
  // Always fit to maxDim (upscale small sources) so thickness is resolution-stable.
  const scale = maxDim / Math.max(srcW, srcH)
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
 *
 * When background removal is on:
 *   1. Knock out the studio backdrop
 *   2. Fill cleared pixels with opaque white
 *   3. Extract the ink mask against that white paper
 *   4. Emit outline with white removed (transparent non-ink)
 *
 * Line-art path matches the detail-black / imaengine polka reference:
 * preserve fills+holes, light speck cleanup, Potrace without supersample.
 */
export async function extractOutlinePng(
  source: HTMLImageElement | ImageBitmap,
  settings: OutlineSettings,
  background: RemoveBgOptions = { enabled: true, tolerance: 42 },
): Promise<OutlineResult> {
  const { canvas, ctx, w, h } = drawScaled(source, settings.maxDim)
  const imageData = ctx.getImageData(0, 0, w, h)

  if (background.enabled !== false) {
    removeBackground(imageData, background)
    fillTransparentWithWhite(imageData)
  } else {
    // Remove-background OFF: preserve paper. Composite any existing alpha
    // holes onto white so the outline sees opaque source, not checkerboard.
    fillTransparentWithWhite(imageData)
  }

  const { mask: rawMask, lineArt, avgChroma, inkedCartoon } = extractInkMask(
    imageData,
    settings.sensitivity,
  )
  let mask = rawMask

  // Pure B&W bitmaps are already clean die-lines — skip speck stripping so
  // every polka hole / micro stroke from the source reaches Potrace.
  const pureBinary = isPureBinaryBitmap(imageData)
  // Color illustrations (navy hair, red dress) often still pass the lineArt
  // bimodal test because of large white areas — force wall extraction whenever
  // there's meaningful chroma so solid fills become outer die-lines.
  // Exception: pre-inked cartoons already have black strokes — don't hollow.
  const treatAsColorArt = (!lineArt || avgChroma >= 14) && !inkedCartoon

  if (!pureBinary) {
    const minSpeck = lineArt || inkedCartoon
      ? Math.max(3, Math.round(w * h * 0.000004))
      : Math.max(14, Math.round(w * h * 0.00004))
    mask = removeSmallComponents(mask, w, h, minSpeck)
  }

  if (lineArt || inkedCartoon) {
    // Drawn black strokes (B&W refs OR color cartoons with ink lines):
    // keep fills/holes as-traced — do not hollow or silhouette-fatten.
    if (!pureBinary) {
      mask = removeIsolatedInk(mask, w, h, inkedCartoon ? 2 : 1)
    }
    if (inkedCartoon) {
      mask = majorityClean(mask, w, h)
      mask = removeSmallComponents(mask, w, h, Math.max(6, Math.round(w * h * 0.000012)))
    }
  } else {
    // Flat color / product art without drawn ink: hollow solid dark fills
    // into metal walls (hair, deep reds, black enamel blocks).
    mask = toStrokeWallsPreserveHoles(mask, w, h, 2)
    mask = dilate(mask, w, h, 1)
    mask = majorityClean(mask, w, h)
    mask = removeIsolatedInk(mask, w, h, 2)
    mask = removeSmallComponents(mask, w, h, Math.max(10, Math.round(w * h * 0.00003)))
  }

  // Sources are normalized to maxDim above, so thickness in px is already
  // resolution-stable.
  const thickness = Math.max(0.1, Math.min(6, settings.thickness))
  if (thickness >= 0.15) {
    mask = dilate(mask, w, h, thickness)
  } else if (treatAsColorArt) {
    mask = dilate(mask, w, h, 1)
  }

  if (treatAsColorArt) {
    // Light cleanup only — avoid morph-open that eats thin cartoon strokes.
    mask = majorityClean(mask, w, h)
    mask = removeSmallComponents(mask, w, h, Math.max(8, Math.round(w * h * 0.00002)))
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
 * Like toStrokeWalls, but force a 1px ring around every internal white island
 * (polka dots, face gaps) so small holes aren't erased by erosion.
 */
function toStrokeWallsPreserveHoles(
  dark: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
  const walls = toStrokeWalls(dark, w, h, radius)
  const out = new Uint8Array(walls)
  const seen = new Uint8Array(w * h)
  const stack: number[] = []

  for (let i = 0; i < w * h; i++) {
    // Only consider white pixels that are fully inside (not edge-connected to frame).
    if (dark[i] || seen[i]) continue
    stack.length = 0
    stack.push(i)
    seen[i] = 1
    const hole: number[] = []
    let touchesFrame = false
    while (stack.length) {
      const cur = stack.pop()!
      hole.push(cur)
      const x = cur % w
      const y = (cur / w) | 0
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesFrame = true
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          touchesFrame = true
          continue
        }
        const ni = ny * w + nx
        if (seen[ni] || dark[ni]) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }
    if (touchesFrame) continue
    // Internal white island (polka): paint a 1px ink ring on its border.
    for (const cur of hole) {
      const x = cur % w
      const y = (cur / w) | 0
      for (const [nx, ny] of [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
        [x - 1, y - 1],
        [x + 1, y - 1],
        [x - 1, y + 1],
        [x + 1, y + 1],
      ] as const) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (dark[ni]) out[ni] = 255
      }
    }
  }
  return out
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

  // Native-resolution Potrace (no supersample): micro zooms match imaengine
  // Vector Q — 2–3× NN supersample + high opttolerance produced stair L runs.
  // Bake translate/scale(0.1) into absolute C so the SVG has no transform group.
  const bw = new ImageData(w, h)
  for (let i = 0; i < w * h; i++) {
    const on = imageData.data[i * 4 + 3] >= 128
    const o = i * 4
    const v = on ? 0 : 255
    bw.data[o] = v
    bw.data[o + 1] = v
    bw.data[o + 2] = v
    bw.data[o + 3] = 255
  }

  const inkHex = `#${[ink.r, ink.g, ink.b]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`

  // Near-default Potrace curve fit — measured closest to Firefighter_outline ref.
  const turdsize = Math.max(2, Math.round(w * h * 0.000002))
  const traced = await potrace(bw, {
    turdsize,
    turnpolicy: 4,
    alphamax: 1.0,
    opticurve: 1,
    opttolerance: 0.2,
    pathonly: false,
    extractcolors: false,
  })

  return bakeOutlineSvg(String(traced), w, h, 1, inkHex)
}

/**
 * Build an ink/metal-wall mask from dark stroke pixels.
 * Sensitivity maps to luminance threshold + local-contrast gate.
 * Line-art thresholds match detail-black (imaengine polka / thin-outline ref).
 *
 * `inkedCartoon`: color art that already has drawn black outlines — extract
 * those strokes only (no mid-tone walls / chromatic-fill flooding).
 */
function extractInkMask(
  imageData: ImageData,
  sensitivity: number,
): {
  mask: Uint8Array
  lineArt: boolean
  avgChroma: number
  inkedCartoon: boolean
} {
  const { data, width, height } = imageData
  const n = width * height
  const lum = new Float32Array(n)
  let opaque = 0
  let darkish = 0
  let lightish = 0
  let chromaSum = 0
  let inkStroke = 0

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
    const ch = chromaAt(data, o)
    chromaSum += ch
    // Pre-drawn cartoon ink: dark + low chroma (not navy/red enamel fills).
    if (y <= 42 && ch < 28) inkStroke++
  }

  const avgChroma = opaque > 0 ? chromaSum / opaque : 0
  // Line art: bimodal dark+light, low chroma (B&W / near-B&W strokes).
  const lineArt =
    opaque > 0 &&
    avgChroma < 28 &&
    darkish / opaque > 0.08 &&
    (darkish + lightish) / opaque > 0.82

  // Color cartoon with existing black linework (Oktoberfest-style, etc.).
  const inkedCartoon =
    !lineArt &&
    opaque > 0 &&
    avgChroma >= 18 &&
    inkStroke / opaque >= 0.035 &&
    inkStroke / Math.max(1, darkish) >= 0.45

  const t = Math.max(0, Math.min(100, sensitivity)) / 100
  const inkCeil = lineArt
    ? 55 + t * 100
    : inkedCartoon
      ? 26 + t * 40
      : 28 + t * 52
  const contrastMin = lineArt
    ? 6 + (1 - t) * 14
    : inkedCartoon
      ? 10 + (1 - t) * 16
      : 14 + (1 - t) * 20

  let midGray = 0
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 128) continue
    const L = lum[i]
    if (L >= 40 && L <= 215) midGray++
  }
  const pureBinary = lineArt && opaque > 0 && midGray / opaque < 0.002
  const photoLike =
    !lineArt && !inkedCartoon && opaque > 0 && midGray / opaque > 0.28

  const mask = new Uint8Array(n)
  if (pureBinary) {
    const binCeil = 40 + t * 80
    for (let i = 0; i < n; i++) {
      if (data[i * 4 + 3] < 128) continue
      if (lum[i] <= binCeil) mask[i] = 255
    }
  } else {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        const o = i * 4
        if (data[o + 3] < 128) continue

        const L = lum[i]
        if (L > inkCeil + (inkedCartoon ? 20 : 36)) continue

        let maxN = L
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue
            const v = lum[(y + dy) * width + (x + dx)]
            if (v > maxN) maxN = v
          }
        }
        const contrast = maxN - L
        const ch = chromaAt(data, o)

        const nearBlack = L <= inkCeil * 0.55 && ch < (inkedCartoon ? 30 : 32)
        const darkEdge = L <= inkCeil && contrast >= contrastMin
        const strongInk = L <= 18
        const lineInk = lineArt && L <= inkCeil && ch < 40

        // Pre-inked cartoons: ONLY real black strokes — never mid-tones /
        // chromatic fills (those become speckled walls when hollowed).
        if (inkedCartoon) {
          if (nearBlack || strongInk || (darkEdge && ch < 36)) mask[i] = 255
          continue
        }

        const midEdge =
          !photoLike && L <= inkCeil + 18 && contrast >= contrastMin + 12
        // Navy hair / deep reds — only when not already ink-lined art.
        const darkChromaticFill =
          L <= 45 + t * 40 &&
          ch >= 18 &&
          (!photoLike || contrast >= contrastMin * 0.5 || L <= 26)

        if (
          nearBlack ||
          darkEdge ||
          midEdge ||
          strongInk ||
          lineInk ||
          darkChromaticFill
        ) {
          mask[i] = 255
        }
      }
    }
  }

  // Outer die edge only for flat color / product photos — never on drawn ink
  // (fattening every hatch) or pre-inked cartoons (jagged outer blob).
  if (!lineArt && !inkedCartoon) {
    addSilhouetteRing(mask, data, lum, width, height)
    if (!photoLike) {
      addDarkOnLightContours(mask, data, lum, width, height, 50 + t * 40)
    }
  }

  // Color|color abutments (e.g. Bavarian white|blue lozenges) need metal walls
  // even when no black stroke was drawn. Skip B&W line art and photo-like art.
  if (!lineArt && !photoLike) {
    addColorBoundaryContours(mask, data, width, height, 70)
  }

  return { mask, lineArt, avgChroma, inkedCartoon }
}

function chromaAt(data: Uint8ClampedArray, o: number): number {
  return Math.max(data[o], data[o + 1], data[o + 2]) - Math.min(data[o], data[o + 1], data[o + 2])
}

/** True when opaque pixels are almost entirely near-black or near-white (no AA gray). */
function isPureBinaryBitmap(imageData: ImageData): boolean {
  const { data, width, height } = imageData
  const n = width * height
  let opaque = 0
  let mid = 0
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (data[o + 3] < 128) continue
    opaque++
    const y = 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]
    if (y >= 40 && y <= 215) mid++
  }
  return opaque > 0 && mid / opaque < 0.002
}

function addSilhouetteRing(
  mask: Uint8Array,
  data: Uint8ClampedArray,
  lum: Float32Array,
  w: number,
  h: number,
) {
  // Build a cleaned subject mask first so AA fringe / bg-removal nicks don't
  // become a jagged outer die-line.
  const subject = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (data[o + 3] < 128) continue
    if (lum[i] > 230) continue
    subject[i] = 255
  }
  const closed = morphClose(subject, w, h, 2)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (!closed[i]) continue
      let border = false
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) {
          border = true
          break
        }
        if (!closed[ny * w + nx]) {
          border = true
          break
        }
      }
      if (border) mask[i] = 255
    }
  }
}

/**
 * Paint metal walls wherever two opaque fill colors abut (white|blue diamonds,
 * red|yellow stripes, etc.). Needed for inked cartoons that only drew outer
 * black strokes and left flat color regions sharing an edge.
 */
function addColorBoundaryContours(
  mask: Uint8Array,
  data: Uint8ClampedArray,
  w: number,
  h: number,
  minRgbDist: number,
) {
  const minDist2 = minRgbDist * minRgbDist
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const o = i * 4
      if (data[o + 3] < 128) continue
      const ch = chromaAt(data, o)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx >= w || ny >= h) continue
        const ni = ny * w + nx
        const no = ni * 4
        if (data[no + 3] < 128) continue
        const dr = data[o] - data[no]
        const dg = data[o + 1] - data[no + 1]
        const db = data[o + 2] - data[no + 2]
        if (dr * dr + dg * dg + db * db < minDist2) continue
        // Ignore soft gray AA; require a real chromatic fill on at least one side.
        if (ch < 12 && chromaAt(data, no) < 12) continue
        mask[i] = 255
        mask[ni] = 255
      }
    }
  }
}

/**
 * Trace the outer edge of dark fills (navy hair, deep shadows) where they meet
 * lighter neighbors — closes silhouette gaps the ink-only path misses.
 */
function addDarkOnLightContours(
  mask: Uint8Array,
  data: Uint8ClampedArray,
  lum: Float32Array,
  w: number,
  h: number,
  darkCeil: number,
) {
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const o = i * 4
      if (data[o + 3] < 128) continue
      if (lum[i] > darkCeil) continue
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ] as const) {
        const ni = (y + dy) * w + (x + dx)
        const no = ni * 4
        const lightNeighbor =
          data[no + 3] < 128 ||
          lum[ni] >= 200 ||
          lum[ni] - lum[i] >= 45
        if (lightNeighbor) {
          mask[i] = 255
          break
        }
      }
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

/** Drop speck ink only — never fill white holes (polka dots, spokes, face gaps). */
function removeIsolatedInk(
  mask: Uint8Array,
  w: number,
  h: number,
  /** Drop ink whose 3×3 on-count is <= this (self included). 1 = lone pixels; 2 = pairs. */
  maxOn = 2,
): Uint8Array {
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
      if (on <= maxOn) out[i] = 0
    }
  }
  return out
}

/** 3×3 majority vote — kills single-pixel jaggies without shifting stroke center. */
function majorityClean(mask: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(mask)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      let on = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (mask[(y + dy) * w + (x + dx)]) on++
        }
      }
      out[y * w + x] = on >= 5 ? 255 : 0
    }
  }
  return out
}

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
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

function erode(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const r = Math.max(1, Math.round(radius))
  if (r <= 0) return mask
  const out = new Uint8Array(w * h)
  for (let y = r; y < h - r; y++) {
    for (let x = r; x < w - r; x++) {
      if (!mask[y * w + x]) continue
      let keep = true
      for (let dy = -r; dy <= r && keep; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue
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

/** Dilate then erode — seals hairline gaps / nicks. */
function morphClose(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  return erode(dilate(mask, w, h, radius), w, h, radius)
}
