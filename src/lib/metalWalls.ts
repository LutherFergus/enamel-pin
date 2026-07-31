import { countLabelUsage } from './quantize'

/**
 * Soft-enamel metal walls between adjacent color fills.
 * Wall width targets manufacturable gaps (default 0.3 mm on the pin).
 */

export type MetalWallOptions = {
  /** Full wall thickness in working pixels (e.g. 0.3mm mapped to canvas). */
  wallPx: number
  /**
   * Minimum region area (px²) on BOTH sides of a boundary before a wall is drawn.
   * Smaller shading flecks fold into the neighbor during cell proof instead.
   */
  minRegionAreaPx: number
}

/**
 * Raster mask of color-adjacency metal walls.
 * Marks pixels along label boundaries where both regions are large enough
 * for a manufacturable gap, then dilates to `wallPx` thickness.
 */
export function buildColorAdjacencyWallMask(
  labels: Uint16Array,
  width: number,
  height: number,
  options: MetalWallOptions,
): Uint8Array {
  const wallPx = Math.max(0.5, options.wallPx)
  const minArea = Math.max(4, Math.round(options.minRegionAreaPx))
  const colorCount = maxLabel(labels) + 1
  const areas = countLabelUsage(labels, Math.max(colorCount, 1))

  const edge = new Uint8Array(width * height)

  // Horizontal adjacencies → paint the shared vertical edge
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x
      const a = labels[i]
      const b = labels[i + 1]
      if (a === 0xffff || b === 0xffff || a === b) continue
      if ((areas[a] ?? 0) < minArea || (areas[b] ?? 0) < minArea) continue
      edge[i] = 255
      edge[i + 1] = 255
    }
  }

  // Vertical adjacencies → paint the shared horizontal edge
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const a = labels[i]
      const b = labels[i + width]
      if (a === 0xffff || b === 0xffff || a === b) continue
      if ((areas[a] ?? 0) < minArea || (areas[b] ?? 0) < minArea) continue
      edge[i] = 255
      edge[i + width] = 255
    }
  }

  const radius = Math.max(0.5, wallPx / 2)
  return dilateMask(edge, width, height, radius)
}

function maxLabel(labels: Uint16Array): number {
  let m = 0
  for (let i = 0; i < labels.length; i++) {
    const v = labels[i]
    if (v !== 0xffff && v > m) m = v
  }
  return m
}

function dilateMask(
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number,
): Uint8Array {
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

/** Nearest-neighbor resize of a label map to a new canvas size. */
export function scaleLabelsNearest(
  labels: Uint16Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint16Array {
  if (srcW === dstW && srcH === dstH) return labels
  const out = new Uint16Array(dstW * dstH)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * srcH / dstH))
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * srcW / dstW))
      out[y * dstW + x] = labels[sy * srcW + sx]
    }
  }
  return out
}

/** Nearest-neighbor resize of a binary mask. */
export function scaleMaskNearest(
  mask: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8Array {
  if (srcW === dstW && srcH === dstH) return mask
  const out = new Uint8Array(dstW * dstH)
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y + 0.5) * srcH / dstH))
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x + 0.5) * srcW / dstW))
      out[y * dstW + x] = mask[sy * srcW + sx]
    }
  }
  return out
}
