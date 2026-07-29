import { denoiseLabels, extractPalette, quantizeImage } from './quantize'
import { mergeSmallRegions } from './regions'
import type { Rgb } from './types'

export type OutlineSettings = {
  /**
   * Detail level 0–100.
   * Lower = fewer flat colors = cleaner enamel die-lines.
   * Higher = more internal strokes.
   */
  sensitivity: number
  /** Stroke thickness in pixels (1–8). */
  thickness: number
  /** Invert: white strokes on transparent instead of black. */
  invert: boolean
  /** Max working dimension for outline raster. */
  maxDim: number
}

export const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  sensitivity: 28,
  thickness: 3,
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
  // Slight blur while scaling reduces generative-art grit before posterize
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return { canvas, ctx, w, h }
}

function colorCountFromSensitivity(sensitivity: number): number {
  // 0 → 3 colors, 50 → 6, 100 → 10
  return Math.max(3, Math.min(10, Math.round(3 + (sensitivity / 100) * 7)))
}

function minRegionRatioFromSensitivity(sensitivity: number): number {
  // Lower sensitivity → more aggressive speck cleanup
  const t = 1 - sensitivity / 100
  return 0.0008 + t * 0.004
}

/**
 * Enamel-pin die-line outline: posterize to flat colors, then stroke only
 * where colors meet (+ outer silhouette). Avoids noisy photographic edges.
 */
export async function extractOutlinePng(
  source: HTMLImageElement | ImageBitmap,
  settings: OutlineSettings,
): Promise<OutlineResult> {
  const { canvas, ctx, w, h } = drawScaled(source, settings.maxDim)
  const imageData = ctx.getImageData(0, 0, w, h)

  // Knock out near-white / checker-ish backgrounds so outer silhouette is clean
  knockOutLightBackground(imageData)

  const colors = colorCountFromSensitivity(settings.sensitivity)
  const palette = extractPalette(imageData, colors, 2)
  let labels = quantizeImage(imageData, palette)
  labels = denoiseLabels(labels, w, h, 3)

  const minArea = Math.max(24, Math.round(w * h * minRegionRatioFromSensitivity(settings.sensitivity)))
  labels = mergeSmallRegions(labels, w, h, minArea)
  labels = denoiseLabels(labels, w, h, 1)

  let mask = boundaryMask(labels, w, h)

  // Remove isolated speck strokes
  mask = erode(mask, w, h, 1)
  mask = dilate(mask, w, h, 1)

  const thickness = Math.max(1, Math.min(8, Math.round(settings.thickness)))
  if (thickness > 1) {
    mask = dilate(mask, w, h, thickness - 1)
  }

  const out = ctx.createImageData(w, h)
  const stroke: Rgb = settings.invert
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

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode outline PNG'))),
      'image/png',
    )
  })

  return {
    pngBlob,
    pngUrl: URL.createObjectURL(pngBlob),
    widthPx: w,
    heightPx: h,
  }
}

/** Treat very light / empty pixels as transparent so outlines hug the pin. */
function knockOutLightBackground(imageData: ImageData) {
  const { data, width, height } = imageData
  // Sample corners to detect light backdrop
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

/** Stroke pixels where a label meets a different label or empty space. */
function boundaryMask(labels: Uint16Array, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = labels[i]
      if (v === 0xffff) continue

      let edge = false
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
        edge = true
      } else {
        const right = labels[i + 1]
        const down = labels[i + w]
        const left = labels[i - 1]
        const up = labels[i - w]
        if (
          right !== v ||
          down !== v ||
          left !== v ||
          up !== v ||
          right === 0xffff ||
          down === 0xffff ||
          left === 0xffff ||
          up === 0xffff
        ) {
          edge = true
        }
      }
      if (edge) mask[i] = 255
    }
  }
  return mask
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
