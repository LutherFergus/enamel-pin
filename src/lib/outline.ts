import type { Rgb } from './types'

export type OutlineSettings = {
  /** Edge sensitivity 0–100 (higher = more lines). */
  sensitivity: number
  /** Stroke thickness in pixels (1–6). */
  thickness: number
  /** Invert: white strokes on transparent instead of black. */
  invert: boolean
  /** Max working dimension for outline raster. */
  maxDim: number
}

export const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  sensitivity: 42,
  thickness: 2,
  invert: false,
  maxDim: 1024,
}

export type OutlineResult = {
  pngBlob: Blob
  pngUrl: string
  widthPx: number
  heightPx: number
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
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
  ctx.drawImage(source, 0, 0, w, h)
  return { canvas, ctx, w, h }
}

/**
 * Extract a stroke / line-art outline as a transparent PNG.
 * Uses Sobel edges with optional dilation for stroke weight.
 */
export async function extractOutlinePng(
  source: HTMLImageElement | ImageBitmap,
  settings: OutlineSettings,
): Promise<OutlineResult> {
  const { canvas, ctx, w, h } = drawScaled(source, settings.maxDim)
  const src = ctx.getImageData(0, 0, w, h)
  const gray = new Float32Array(w * h)
  const alpha = new Uint8Array(w * h)

  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    alpha[i] = src.data[o + 3]
    gray[i] = alpha[i] < 16 ? 255 : luma(src.data[o], src.data[o + 1], src.data[o + 2])
  }

  // Light blur to reduce noise
  const blurred = boxBlurGray(gray, w, h, 1)

  const mag = new Float32Array(w * h)
  let maxMag = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (alpha[i] < 16) {
        mag[i] = 0
        continue
      }
      const gx =
        -blurred[i - w - 1] +
        blurred[i - w + 1] -
        2 * blurred[i - 1] +
        2 * blurred[i + 1] -
        blurred[i + w - 1] +
        blurred[i + w + 1]
      const gy =
        -blurred[i - w - 1] -
        2 * blurred[i - w] -
        blurred[i - w + 1] +
        blurred[i + w - 1] +
        2 * blurred[i + w] +
        blurred[i + w + 1]
      const m = Math.hypot(gx, gy)
      mag[i] = m
      if (m > maxMag) maxMag = m
    }
  }

  // Sensitivity: lower threshold keeps more edges
  const t = 1 - settings.sensitivity / 100
  const high = maxMag * (0.12 + t * 0.45)
  const low = high * 0.4

  const edge = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) {
    if (mag[i] >= high) edge[i] = 2
    else if (mag[i] >= low) edge[i] = 1
  }

  // Hysteresis
  const stack: number[] = []
  for (let i = 0; i < w * h; i++) if (edge[i] === 2) stack.push(i)
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i / w) | 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (edge[ni] === 1) {
          edge[ni] = 2
          stack.push(ni)
        }
      }
    }
  }

  let mask = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) mask[i] = edge[i] === 2 ? 255 : 0

  // Also reinforce color-boundary strokes for poster-like art
  const boundary = colorBoundaryMask(src.data, w, h, 28)
  for (let i = 0; i < w * h; i++) {
    if (boundary[i]) mask[i] = 255
  }

  const thickness = Math.max(1, Math.min(6, Math.round(settings.thickness)))
  if (thickness > 1) {
    mask = dilate(mask, w, h, thickness - 1)
  }

  const out = ctx.createImageData(w, h)
  const stroke: Rgb = settings.invert
    ? { r: 255, g: 255, b: 255 }
    : { r: 20, g: 18, b: 16 }

  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (mask[i] && alpha[i] >= 16) {
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

function boxBlurGray(
  src: Float32Array,
  w: number,
  h: number,
  radius: number,
): Float32Array {
  if (radius <= 0) return src
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const span = radius * 2 + 1

  for (let y = 0; y < h; y++) {
    let sum = 0
    for (let x = -radius; x <= radius; x++) {
      const cx = Math.min(w - 1, Math.max(0, x))
      sum += src[y * w + cx]
    }
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = sum / span
      const leave = Math.min(w - 1, Math.max(0, x - radius))
      const enter = Math.min(w - 1, Math.max(0, x + radius + 1))
      sum += src[y * w + enter] - src[y * w + leave]
    }
  }

  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -radius; y <= radius; y++) {
      const cy = Math.min(h - 1, Math.max(0, y))
      sum += tmp[cy * w + x]
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / span
      const leave = Math.min(h - 1, Math.max(0, y - radius))
      const enter = Math.min(h - 1, Math.max(0, y + radius + 1))
      sum += tmp[enter * w + x] - tmp[leave * w + x]
    }
  }
  return out
}

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(mask)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius) continue
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

/** Mark pixels that sit on a strong local color discontinuity. */
function colorBoundaryMask(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  threshold: number,
): Uint8Array {
  const out = new Uint8Array(w * h)
  const dist = (i: number, j: number) => {
    const dr = data[i] - data[j]
    const dg = data[i + 1] - data[j + 1]
    const db = data[i + 2] - data[j + 2]
    return Math.sqrt(dr * dr + dg * dg + db * db)
  }
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4
      if (data[i + 3] < 16) continue
      const right = i + 4
      const down = i + w * 4
      if (data[right + 3] >= 16 && dist(i, right) >= threshold) {
        out[y * w + x] = 1
        out[y * w + x + 1] = 1
      }
      if (data[down + 3] >= 16 && dist(i, down) >= threshold) {
        out[y * w + x] = 1
        out[(y + 1) * w + x] = 1
      }
    }
  }
  return out
}
