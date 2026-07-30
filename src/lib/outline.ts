import { knockOutSolidBackground } from './background'
import type { Rgb } from './types'

export type OutlineSettings = {
  /**
   * Ink threshold / detail 0–100.
   * Lower = only the darkest metal walls (cleaner).
   * Higher = includes lighter hatches / thinner strokes.
   */
  sensitivity: number
  /** Extra stroke thicken in pixels (0–6). Prefer 1–2 for clean die-lines. */
  thickness: number
  /** Invert: white strokes on transparent instead of black. */
  invert: boolean
  /** Max working dimension for outline raster. */
  maxDim: number
}

export const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  sensitivity: 42,
  thickness: 1,
  invert: false,
  maxDim: 1100,
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
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return { canvas, ctx, w, h }
}

/**
 * Soft-enamel die-line outline.
 *
 * Prefer extracting the existing dark ink / metal walls from pin art
 * (clean, REF-like) instead of inventing fuzzy photo edges or flooded
 * color-boundary blobs.
 */
export async function extractOutlinePng(
  source: HTMLImageElement | ImageBitmap,
  settings: OutlineSettings,
): Promise<OutlineResult> {
  const { canvas, ctx, w, h } = drawScaled(source, settings.maxDim)
  const imageData = ctx.getImageData(0, 0, w, h)

  knockOutSolidBackground(imageData)

  let mask = extractInkMask(imageData, settings.sensitivity)

  // Drop tiny speck components (noise left of silhouettes, texture grit)
  mask = removeSmallComponents(mask, w, h, Math.max(12, Math.round(w * h * 0.00004)))

  // Light cleanup — do NOT erode+dilate hard (that floods thin die-lines)
  mask = majorityClean(mask, w, h)

  const thickness = Math.max(0, Math.min(6, Math.round(settings.thickness)))
  if (thickness > 0) {
    mask = dilate(mask, w, h, thickness)
  }

  const out = ctx.createImageData(w, h)
  const stroke: Rgb = settings.invert
    ? { r: 255, g: 255, b: 255 }
    : { r: 12, g: 10, b: 9 }

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

/**
 * Build an ink/metal-wall mask from dark stroke pixels.
 * Sensitivity maps to luminance threshold + local-contrast gate.
 */
function extractInkMask(imageData: ImageData, sensitivity: number): Uint8Array {
  const { data, width, height } = imageData
  const n = width * height
  const lum = new Float32Array(n)
  let opaque = 0
  let darkish = 0

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
  }

  // Line-art vs color pin art: line art is mostly dark+light with little mid chroma.
  const lineArtBias = opaque > 0 && darkish / opaque > 0.12

  // Higher sensitivity → include lighter greys / thinner hatches
  const t = Math.max(0, Math.min(100, sensitivity)) / 100
  const inkCeil = lineArtBias ? 48 + t * 90 : 28 + t * 55
  const contrastMin = lineArtBias ? 10 + (1 - t) * 18 : 14 + (1 - t) * 22

  const mask = new Uint8Array(n)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const o = i * 4
      if (data[o + 3] < 128) continue

      const L = lum[i]
      if (L > inkCeil + 40) continue

      // Local contrast: ink sits next to lighter fills
      let maxN = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const v = lum[(y + dy) * width + (x + dx)]
          if (v > maxN) maxN = v
        }
      }
      const contrast = maxN - L

      // Near-black always counts as metal wall on pin art
      const nearBlack = L <= inkCeil * 0.55 && chromaAt(data, o) < 35
      const darkEdge = L <= inkCeil && contrast >= contrastMin
      const strongInk = L <= 22

      if (nearBlack || darkEdge || strongInk) mask[i] = 255
    }
  }

  // Also keep outer silhouette ring of the subject (die edge)
  addSilhouetteRing(mask, data, width, height)

  return mask
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
