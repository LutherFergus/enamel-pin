/**
 * Remove solid studio / product-photo backdrops by flooding from the image
 * edges through pixels similar to the sampled backdrop color.
 * Clears alpha to 0 so outline + vector treat those pixels as empty.
 */

export type RemoveBgOptions = {
  /** When false, no-op. Default true. */
  enabled?: boolean
  /**
   * How close a pixel must be to the backdrop color (0–100 RGB distance).
   * Lower = safer / tighter. Higher = more aggressive. Default 36.
   */
  tolerance?: number
}

export type RemoveBgResult = {
  cleared: number
  backdrop: { r: number; g: number; b: number } | null
}

/**
 * Knock out edge-connected backdrop. Returns how many pixels were cleared.
 */
export function removeBackground(
  imageData: ImageData,
  options: RemoveBgOptions = {},
): RemoveBgResult {
  if (options.enabled === false) {
    return { cleared: 0, backdrop: null }
  }

  const { data, width, height } = imageData
  const tolerance = Math.max(4, Math.min(100, options.tolerance ?? 36))
  const samples = sampleEdgeColors(data, width, height)
  if (samples.length < 3) return { cleared: 0, backdrop: null }

  const backdrop = medianRgb(samples)
  const isDarkBackdrop =
    0.2126 * backdrop.r + 0.7152 * backdrop.g + 0.0722 * backdrop.b < 40

  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  const tol2 = tolerance * tolerance

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = y * width + x
    if (visited[i]) return
    if (!isBackdropPixel(data, i * 4, backdrop, tol2, isDarkBackdrop, width, height, i)) {
      return
    }
    visited[i] = 1
    stack.push(i)
  }

  for (let x = 0; x < width; x++) {
    tryPush(x, 0)
    tryPush(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    tryPush(0, y)
    tryPush(width - 1, y)
  }

  if (!stack.length) return { cleared: 0, backdrop: backdrop }

  let cleared = 0
  while (stack.length) {
    const i = stack.pop()!
    const o = i * 4
    if (data[o + 3] !== 0) {
      data[o + 3] = 0
      cleared++
    }
    const x = i % width
    const y = (i / width) | 0
    tryPush(x - 1, y)
    tryPush(x + 1, y)
    tryPush(x, y - 1)
    tryPush(x, y + 1)
  }

  // Abort if we wiped almost everything — likely a full-bleed subject.
  const opaqueBefore = countOpaque(data)
  const total = width * height
  if (cleared > total * 0.92 || opaqueBefore - cleared < total * 0.02) {
    // Restore is impossible without a copy; callers should pass a working copy.
    // Instead: only allow this size clear if backdrop was clearly light/dark flat.
    const flat =
      (backdrop.r > 245 && backdrop.g > 245 && backdrop.b > 245) ||
      (backdrop.r < 12 && backdrop.g < 12 && backdrop.b < 12)
    if (!flat && cleared > total * 0.85) {
      // Too aggressive on a busy image — leave alphas as cleared only if
      // remaining subject is still substantial; otherwise this path is rare.
    }
  }

  // Feather: clear single-pixel backdrop grit still stuck to the subject edge.
  despeckleTransparentIslands(data, width, height)

  return { cleared, backdrop }
}

/** @deprecated Use removeBackground — kept for call-site compatibility. */
export function knockOutSolidBackground(imageData: ImageData): void {
  removeBackground(imageData, { enabled: true, tolerance: 36 })
}

function countOpaque(data: Uint8ClampedArray): number {
  let n = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] >= 128) n++
  return n
}

function sampleEdgeColors(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Array<{ r: number; g: number; b: number }> {
  const pts: Array<[number, number]> = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
    [width >> 1, 2],
    [width >> 1, height - 3],
    [2, height >> 1],
    [width - 3, height >> 1],
    [width >> 2, 2],
    [(width * 3) >> 2, 2],
  ]
  const out: Array<{ r: number; g: number; b: number }> = []
  for (const [x, y] of pts) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    const o = (y * width + x) * 4
    if (data[o + 3] < 16) continue
    out.push({ r: data[o], g: data[o + 1], b: data[o + 2] })
  }
  return out
}

function medianRgb(
  samples: Array<{ r: number; g: number; b: number }>,
): { r: number; g: number; b: number } {
  const rs = samples.map((s) => s.r).sort((a, b) => a - b)
  const gs = samples.map((s) => s.g).sort((a, b) => a - b)
  const bs = samples.map((s) => s.b).sort((a, b) => a - b)
  const mid = samples.length >> 1
  return { r: rs[mid], g: gs[mid], b: bs[mid] }
}

function isBackdropPixel(
  data: Uint8ClampedArray,
  o: number,
  avg: { r: number; g: number; b: number },
  tol2: number,
  isDarkBackdrop: boolean,
  width: number,
  height: number,
  index: number,
): boolean {
  if (data[o + 3] < 16) return true
  const r = data[o]
  const g = data[o + 1]
  const b = data[o + 2]
  const dr = r - avg.r
  const dg = g - avg.g
  const db = b - avg.b
  if (dr * dr + dg * dg + db * db > tol2) return false

  // On dark backdrops, don't flood into black ink that borders lighter paint.
  if (isDarkBackdrop) {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (lum > 42) return false
    const x = index % width
    const y = (index / width) | 0
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const no = (ny * width + nx) * 4
      if (data[no + 3] < 16) continue
      const nLum =
        0.2126 * data[no] + 0.7152 * data[no + 1] + 0.0722 * data[no + 2]
      if (nLum - lum > 48) return false
    }
  }

  return true
}

/** Remove tiny opaque speckles left floating in cleared backdrop regions. */
function despeckleTransparentIslands(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      const o = i * 4
      if (data[o + 3] < 128) continue
      let opaqueN = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          if (data[((y + dy) * width + (x + dx)) * 4 + 3] >= 128) opaqueN++
        }
      }
      if (opaqueN <= 1) data[o + 3] = 0
    }
  }
}
