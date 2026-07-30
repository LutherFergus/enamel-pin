import {
  analyzeLineArt,
  extractInkMask,
  inkPreserved,
  dilate as dilateMask,
} from './lineArt'
import { denoiseLabels, extractPalette, quantizeImage } from './quantize'
import { mergeSmallRegions } from './regions'
import type { Rgb } from './types'

export type OutlineSettings = {
  /**
   * Detail 0–100.
   * Color art: how many flat fills before stroking boundaries.
   * Line art: ink threshold (higher keeps lighter gray strokes).
   */
  sensitivity: number
  /** Stroke thickness in pixels (default 2). */
  thickness: number
  /** Invert: white strokes on transparent instead of black. */
  invert: boolean
  /** Max working dimension for outline raster. */
  maxDim: number
}

export const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  sensitivity: 35,
  thickness: 2,
  invert: false,
  maxDim: 900,
}

export type OutlineResult = {
  pngBlob: Blob
  pngUrl: string
  widthPx: number
  heightPx: number
}

function drawScaled(
  source: HTMLImageElement | ImageBitmap,
  maxDim: number,
  smooth: boolean,
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
  // Line art: nearest-neighbor keeps strokes crisp. Color art: smooth then posterize.
  ctx.imageSmoothingEnabled = smooth
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return { canvas, ctx, w, h }
}

function colorCountFromSensitivity(sensitivity: number): number {
  return Math.max(3, Math.min(10, Math.round(3 + (sensitivity / 100) * 7)))
}

function minRegionRatioFromSensitivity(sensitivity: number): number {
  const t = 1 - sensitivity / 100
  return 0.0012 + t * 0.006
}

function maskToOutlineResult(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  mask: Uint8Array,
  w: number,
  h: number,
  invert: boolean,
): Promise<OutlineResult> {
  const out = ctx.createImageData(w, h)
  const stroke: Rgb = invert
    ? { r: 255, g: 255, b: 255 }
    : { r: 18, g: 16, b: 14 }

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

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) {
          reject(new Error('Failed to encode outline PNG'))
          return
        }
        resolve({
          pngBlob: b,
          pngUrl: URL.createObjectURL(b),
          widthPx: w,
          heightPx: h,
        })
      },
      'image/png',
    )
  })
}

/**
 * Outline PNG:
 * - Line art → keep the ink itself (no boundary-around-strokes noise)
 * - Color art → posterize → single-pixel die-lines between fills
 */
export async function extractOutlinePng(
  source: HTMLImageElement | ImageBitmap,
  settings: OutlineSettings,
): Promise<OutlineResult> {
  // Probe at working size with smoothing off first for line-art detection
  const probe = drawScaled(source, settings.maxDim, false)
  const probeData = probe.ctx.getImageData(0, 0, probe.w, probe.h)
  // Detect BEFORE knocking out paper (transparent-as-light also covers post-knockout).
  const analysis = analyzeLineArt(probeData)
  knockOutLightBackground(probeData)
  probe.ctx.putImageData(probeData, 0, 0)

  if (analysis.isLineArt) {
    const ink = extractInkMask(probeData, settings.sensitivity)
    const mask = inkPreserved(ink.mask, ink.width, ink.height, settings.thickness)
    return maskToOutlineResult(
      probe.canvas,
      probe.ctx,
      mask,
      probe.w,
      probe.h,
      settings.invert,
    )
  }

  // Color / enamel artwork path
  const { canvas, ctx, w, h } = drawScaled(source, settings.maxDim, true)
  const imageData = ctx.getImageData(0, 0, w, h)
  knockOutLightBackground(imageData)

  // Also clear solid black mockup backdrops so the outer die-line hugs the pin.
  {
    const { data, width, height } = imageData
    const corners = [0, (width - 1) * 4, (height - 1) * width * 4, ((height - 1) * width + width - 1) * 4]
    let blackCorners = 0
    for (const o of corners) {
      if (data[o + 3] < 16) continue
      if (data[o] < 18 && data[o + 1] < 18 && data[o + 2] < 18) blackCorners++
    }
    if (blackCorners >= 2) {
      for (let i = 0; i < width * height; i++) {
        const o = i * 4
        if (data[o + 3] < 16) continue
        if (data[o] < 14 && data[o + 1] < 14 && data[o + 2] < 14) data[o + 3] = 0
      }
    }
  }

  const colors = colorCountFromSensitivity(settings.sensitivity)
  const palette = extractPalette(imageData, colors, 2)
  let labels = quantizeImage(imageData, palette)
  labels = denoiseLabels(labels, w, h, 4)
  const minArea = Math.max(48, Math.round(w * h * minRegionRatioFromSensitivity(settings.sensitivity)))
  labels = mergeSmallRegions(labels, w, h, minArea)
  labels = denoiseLabels(labels, w, h, 2)

  let mask = singlePixelBoundaryMask(labels, w, h)
  const minStroke = Math.max(18, Math.round(Math.min(w, h) * 0.02))
  mask = keepLargeComponents(mask, w, h, minStroke)

  const thickness = Math.max(1, Math.min(6, Math.round(settings.thickness)))
  if (thickness > 1) {
    mask = dilateMask(mask, w, h, thickness - 1)
  }

  return maskToOutlineResult(canvas, ctx, mask, w, h, settings.invert)
}

/** Treat very light backdrop as transparent so the outer die-line hugs the pin. */
function knockOutLightBackground(imageData: ImageData) {
  const { data, width, height } = imageData
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ]
  let lightCorners = 0
  for (const o of corners) {
    if (data[o + 3] < 16) {
      lightCorners++
      continue
    }
    if (data[o] > 230 && data[o + 1] > 230 && data[o + 2] > 230) lightCorners++
  }
  if (lightCorners < 2) return

  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (data[o + 3] < 16) continue
    if (data[o] >= 245 && data[o + 1] >= 245 && data[o + 2] >= 245) {
      data[o + 3] = 0
    }
  }
}

/**
 * True single-pixel die-lines.
 * - Opaque↔opaque: mark only on the left/top side of the seam (right/down check)
 *   so we never double-stroke.
 * - Opaque↔empty: also mark left/top silhouette edges (otherwise those sides vanish).
 */
function singlePixelBoundaryMask(labels: Uint16Array, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = labels[i]
      if (v === 0xffff) continue

      const right = x + 1 < w ? labels[i + 1] : 0xffff
      const down = y + 1 < h ? labels[i + w] : 0xffff
      const left = x > 0 ? labels[i - 1] : 0xffff
      const up = y > 0 ? labels[i - w] : 0xffff

      if (right !== v || down !== v) {
        mask[i] = 255
        continue
      }
      if (left === 0xffff || up === 0xffff) {
        mask[i] = 255
      }
    }
  }
  return mask
}

/** Keep only stroke components with enough pixels (drops freckle noise). */
function keepLargeComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  minPixels: number,
): Uint8Array {
  const seen = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  const stack: number[] = []

  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue

    stack.length = 0
    stack.push(start)
    seen[start] = 1
    const component: number[] = []

    while (stack.length) {
      const i = stack.pop()!
      component.push(i)
      const x = i % w
      const y = (i / w) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = ny * w + nx
          if (!mask[ni] || seen[ni]) continue
          seen[ni] = 1
          stack.push(ni)
        }
      }
    }

    if (component.length >= minPixels) {
      for (const i of component) out[i] = 255
    }
  }

  return out
}
