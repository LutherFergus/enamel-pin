import {
  collapseCollinear,
  destairPath,
  extractColorContours,
  ringsToSvgD,
  simplifyPath,
  type Point,
} from './contours'
import {
  analyzeLineArt,
  extractEnamelMetalMask,
  extractInkMask,
  inkPreserved,
} from './lineArt'
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
  /** Max working dimension for outline. */
  maxDim: number
}

export const DEFAULT_OUTLINE_SETTINGS: OutlineSettings = {
  /** Tuned on elephant BG→outline plate (black hatch + gold-dam edges). */
  sensitivity: 70,
  /** 1px keeps hatch channels open — matches plate airiness better than 2–3. */
  thickness: 1,
  invert: false,
  /** Match elephant production plates (2000×2000). */
  maxDim: 2000,
}

export type OutlineResult = {
  /** Smooth vector die-lines (primary). */
  svg: string
  svgBlob: Blob
  svgUrl: string
  /** Raster preview / fallback download. */
  pngBlob: Blob
  pngUrl: string
  widthPx: number
  heightPx: number
  pathCount: number
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
  ctx.imageSmoothingEnabled = smooth
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return { canvas, ctx, w, h }
}

function processOutlineContour(points: Point[], scale: number): Point[] {
  // Points are in upsampled space — destair + moderate RDP, then scale down
  // so SVG coords are fractional (true sub-pixel curves, not lattice stairs).
  let pts = destairPath(points, true)
  const epsilon = Math.min(3.2, Math.max(1.4, points.length / 220))
  pts = simplifyPath(pts, epsilon)
  pts = collapseCollinear(pts, true)
  pts = simplifyPath(pts, Math.max(1.0, epsilon * 0.7))
  if (scale === 1) return pts
  return pts.map((p) => ({ x: p.x / scale, y: p.y / scale }))
}

/**
 * Soften binary mask stairs before contouring.
 * Box-blur + re-threshold rounds orthogonal jaggies into diagonal-ish edges
 * so cubic SVG paths can look smooth instead of pixel-staired.
 */
function softenMaskStairs(mask: Uint8Array, w: number, h: number, passes = 2): Uint8Array {
  let cur = mask
  for (let pass = 0; pass < passes; pass++) {
    const acc = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0
        let wt = 0
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            const ny = y + dy
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const wgt = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1
            sum += (cur[ny * w + nx] ? 1 : 0) * wgt
            wt += wgt
          }
        }
        acc[y * w + x] = sum / wt
      }
    }
    const next = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) next[i] = acc[i] >= 0.45 ? 255 : 0
    cur = next
  }
  return cur
}

/** Bilinear upsample of a binary mask — edges become soft diagonals at higher res. */
function upsampleMask(
  mask: Uint8Array,
  w: number,
  h: number,
  factor: number,
): { mask: Uint8Array; w: number; h: number } {
  if (factor <= 1) return { mask, w, h }
  const nw = w * factor
  const nh = h * factor
  const out = new Uint8Array(nw * nh)
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const fx = x / factor
      const fy = y / factor
      const x0 = Math.min(w - 1, Math.floor(fx))
      const y0 = Math.min(h - 1, Math.floor(fy))
      const x1 = Math.min(w - 1, x0 + 1)
      const y1 = Math.min(h - 1, y0 + 1)
      const tx = fx - x0
      const ty = fy - y0
      const v00 = mask[y0 * w + x0] ? 1 : 0
      const v10 = mask[y0 * w + x1] ? 1 : 0
      const v01 = mask[y1 * w + x0] ? 1 : 0
      const v11 = mask[y1 * w + x1] ? 1 : 0
      const v =
        v00 * (1 - tx) * (1 - ty) +
        v10 * tx * (1 - ty) +
        v01 * (1 - tx) * ty +
        v11 * tx * ty
      out[y * nw + x] = v >= 0.5 ? 255 : 0
    }
  }
  return { mask: out, w: nw, h: nh }
}

function maskToSvg(
  mask: Uint8Array,
  w: number,
  h: number,
  invert: boolean,
): { svg: string; pathCount: number } {
  // 3× upsample → soften → contour → scale coords back. Yields sub-pixel
  // Bézier paths instead of tracing the 1px raster lattice.
  const factor = 3
  const up = upsampleMask(mask, w, h, factor)
  const soft = softenMaskStairs(up.mask, up.w, up.h, 3)
  const labels = new Uint16Array(up.w * up.h)
  for (let i = 0; i < up.w * up.h; i++) labels[i] = soft[i] ? 0 : 0xffff
  const minArea = Math.max(8, Math.round((up.w * up.h) / 180000))
  const contours = extractColorContours(labels, up.w, up.h, minArea)
  const fill = invert ? '#ffffff' : '#120e0c'
  const parts: string[] = [
    // Explicit transparent canvas — no backdrop <rect>, so paper/holes stay see-through.
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="background:transparent">`,
    '<g id="outline">',
  ]
  let pathCount = 0
  for (const components of contours.values()) {
    for (const rings of components) {
      const processed = rings
        .map((ring) => processOutlineContour(ring, factor))
        .filter((ring) => ring.length >= 3)
      if (!processed.length) continue
      // High corner angle → nearly all cubic; only knife-sharp bends stay L.
      const d = ringsToSvgD(processed, true, 105)
      if (!d) continue
      // fill-rule on each path so holes stay transparent in Illustrator/Figma/browsers.
      parts.push(
        `<path fill="${fill}" fill-rule="evenodd" fill-opacity="1" stroke="none" d="${d}" />`,
      )
      pathCount++
    }
  }
  parts.push('</g></svg>')
  return { svg: parts.join('\n'), pathCount }
}

async function maskToOutlineResult(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  mask: Uint8Array,
  w: number,
  h: number,
  invert: boolean,
): Promise<OutlineResult> {
  const { svg, pathCount } = maskToSvg(mask, w, h, invert)
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const svgUrl = URL.createObjectURL(svgBlob)

  // Raster PNG from the same mask (download fallback / quick thumb).
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

  const pngBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => {
      if (!b) reject(new Error('Failed to encode outline PNG'))
      else resolve(b)
    }, 'image/png')
  })

  return {
    svg,
    svgBlob,
    svgUrl,
    pngBlob,
    pngUrl: URL.createObjectURL(pngBlob),
    widthPx: w,
    heightPx: h,
    pathCount,
  }
}

/**
 * Outline (vector SVG + PNG):
 * - Line art → keep the ink itself (no boundary-around-strokes noise)
 * - Enamel pin mocks → black hatch + gold-dam edges (not filled gold)
 *   (never color-boundary hollow double lines)
 * Paths are cubic-smoothed — not pixel stairs.
 */
export async function extractOutlinePng(
  source: HTMLImageElement | ImageBitmap,
  settings: OutlineSettings,
): Promise<OutlineResult> {
  const probe = drawScaled(source, settings.maxDim, false)
  const probeData = probe.ctx.getImageData(0, 0, probe.w, probe.h)
  const analysis = analyzeLineArt(probeData)
  knockOutLightBackground(probeData)
  knockOutNearBlackBackdrop(probeData)
  probe.ctx.putImageData(probeData, 0, 0)

  if (analysis.isLineArt) {
    // No morph-close — dense hatching must stay as open stroke channels.
    const ink = extractInkMask(probeData, settings.sensitivity, 'none')
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

  // Painted enamel mock: black hatch + gold-dam edges (not filled gold blobs).
  const metal = extractEnamelMetalMask(probeData, settings.sensitivity)
  let mask = inkPreserved(metal.mask, metal.width, metal.height, settings.thickness)
  // Drop isolated freckles from textured photo bg leftovers.
  const minStroke = Math.max(24, Math.round(Math.min(probe.w, probe.h) * 0.01))
  mask = keepLargeComponents(mask, probe.w, probe.h, minStroke)
  // Org studio shots leave grain on the frame — drop ink that only touches the border.
  mask = removeBorderTouchingComponents(
    mask,
    probe.w,
    probe.h,
    Math.round(probe.w * probe.h * 0.004),
  )

  return maskToOutlineResult(
    probe.canvas,
    probe.ctx,
    mask,
    probe.w,
    probe.h,
    settings.invert,
  )
}

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
    if (data[o] >= 235 && data[o + 1] >= 235 && data[o + 2] >= 235) {
      data[o + 3] = 0
    }
  }
}

function knockOutNearBlackBackdrop(imageData: ImageData) {
  const { data, width, height } = imageData
  const corners = [
    0,
    (width - 1) * 4,
    (height - 1) * width * 4,
    ((height - 1) * width + width - 1) * 4,
  ]
  // Org pin mocks sit on dark textured studio gray (~30–55), not pure black.
  // Transparent corners (already-matted art) must NOT count as dark backdrop.
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

  // Flood from the frame through low-chroma dark studio pixels only.
  // Blanket threshold eats elephant shadows; flood keeps the subject.
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

/**
 * Drop ink components that touch the image border and are smaller than
 * `maxPixels`. Removes studio-bg freckles without eating the centered subject
 * (elephant / pin art rarely touches the frame).
 */
function removeBorderTouchingComponents(
  mask: Uint8Array,
  w: number,
  h: number,
  maxPixels: number,
): Uint8Array {
  const seen = new Uint8Array(w * h)
  const out = new Uint8Array(mask)
  const stack: number[] = []

  for (let start = 0; start < w * h; start++) {
    if (!out[start] || seen[start]) continue

    stack.length = 0
    stack.push(start)
    seen[start] = 1
    const component: number[] = []
    let touchesBorder = false

    while (stack.length) {
      const i = stack.pop()!
      component.push(i)
      const x = i % w
      const y = (i / w) | 0
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesBorder = true
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const ni = ny * w + nx
          if (!out[ni] || seen[ni]) continue
          seen[ni] = 1
          stack.push(ni)
        }
      }
    }

    if (touchesBorder && component.length <= maxPixels) {
      for (const i of component) out[i] = 0
    }
  }

  return out
}
