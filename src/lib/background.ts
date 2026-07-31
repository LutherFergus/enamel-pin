/**
 * Remove solid studio / product-photo backdrops by flooding from the image
 * edges through near-backdrop pixels.
 *
 * Hard rules:
 *  - Never clear skin / flesh tones
 *  - Never clear chromatic accents when the backdrop is neutral
 *  - Light backdrops clear near-white neutrals by luminance+chroma, not only RGB distance
 */

export type RemoveBgOptions = {
  /** When false, no-op. Default true. */
  enabled?: boolean
  /**
   * How close a pixel must be to the backdrop color (0–100 RGB distance).
   * Lower = safer / tighter. Higher = more aggressive. Default 42.
   */
  tolerance?: number
}

export type RemoveBgResult = {
  cleared: number
  backdrop: { r: number; g: number; b: number } | null
}

export function luminance(c: { r: number; g: number; b: number }): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

export function chroma(c: { r: number; g: number; b: number }): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
}

/**
 * Skin / flesh detector — used by bg removal (must keep) and palette scoring.
 * Matches Vectorizer peach (#f3d1b0) and warm browns (#866254 family).
 */
export function isSkinTone(c: { r: number; g: number; b: number }): boolean {
  const L = luminance(c)
  const ch = chroma(c)
  if (L < 48 || L > 248) return false
  if (ch < 16 || ch > 130) return false
  // Warm flesh: R dominant, B weakest
  if (c.r < c.g + 6) return false
  if (c.b > c.g + 12) return false
  const warm = (c.r - c.b) / 255
  if (warm < 0.07) return false
  // Reject pure reds (dress) — high chroma + low G relative to R
  if (ch > 100 && c.g < c.r * 0.45) return false
  return true
}

export function skinScore(c: { r: number; g: number; b: number }): number {
  if (!isSkinTone(c)) return 0
  const L = luminance(c)
  const ch = chroma(c)
  const warm = (c.r - c.b) / 255
  return warm * (1 - Math.abs(L - 185) / 185) * Math.min(1, ch / 70)
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
  const tolerance = Math.max(4, Math.min(100, options.tolerance ?? 42))
  const samples = sampleEdgeColors(data, width, height)
  if (samples.length < 3) return { cleared: 0, backdrop: null }

  const backdrop = medianRgb(samples)
  const bgLum = luminance(backdrop)
  const bgCh = chroma(backdrop)
  const isDarkBackdrop = bgLum < 40
  const isLightBackdrop = bgLum > 200 && bgCh < 30

  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  const tol2 = tolerance * tolerance

  const tryPush = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    const i = y * width + x
    if (visited[i]) return
    if (
      !isBackdropPixel(
        data,
        i * 4,
        backdrop,
        tol2,
        tolerance,
        isDarkBackdrop,
        isLightBackdrop,
        width,
        height,
        i,
      )
    ) {
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
    // Final skin guard (belt-and-suspenders)
    if (data[o + 3] >= 16 && isSkinTone({ r: data[o], g: data[o + 1], b: data[o + 2] })) {
      continue
    }
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

  // Second pass: clear leftover near-white grit still edge-touching transparency
  // (anti-aliased halo) — still never skin.
  if (isLightBackdrop) {
    cleared += clearNearWhiteHalos(data, width, height, Math.max(236, bgLum - 8))
  }

  despeckleTransparentIslands(data, width, height)

  return { cleared, backdrop }
}

/** @deprecated Use removeBackground — kept for call-site compatibility. */
export function knockOutSolidBackground(imageData: ImageData): void {
  removeBackground(imageData, { enabled: true, tolerance: 42 })
}

/**
 * Paint every non-opaque pixel onto solid white (composites AA edges).
 * Used after bg removal so outline runs against paper white, then the
 * outline plate clears white again (transparent non-ink).
 */
export function fillTransparentWithWhite(imageData: ImageData): number {
  const { data } = imageData
  let filled = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]
    if (a === 255) continue
    if (a === 0) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    } else {
      const t = a / 255
      const inv = 1 - t
      data[i] = Math.round(data[i] * t + 255 * inv)
      data[i + 1] = Math.round(data[i + 1] * t + 255 * inv)
      data[i + 2] = Math.round(data[i + 2] * t + 255 * inv)
      data[i + 3] = 255
    }
    filled++
  }
  return filled
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
    [4, 4],
    [width - 5, 4],
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
  tolerance: number,
  isDarkBackdrop: boolean,
  isLightBackdrop: boolean,
  width: number,
  height: number,
  index: number,
): boolean {
  if (data[o + 3] < 16) return true
  const r = data[o]
  const g = data[o + 1]
  const b = data[o + 2]
  const pixel = { r, g, b }

  // Absolute: never remove skin tones.
  if (isSkinTone(pixel)) return false

  const ch = chroma(pixel)
  const lum = luminance(pixel)
  const bgCh = chroma(avg)
  const bgLum = luminance(avg)

  // Never remove chromatic accents (reds, etc.) off a neutral backdrop.
  if (bgCh < 25 && ch > Math.max(35, bgCh + 22)) return false

  const dr = r - avg.r
  const dg = g - avg.g
  const db = b - avg.b
  const rgbDist2 = dr * dr + dg * dg + db * db

  if (isLightBackdrop) {
    // Near-white / light-gray neutrals only — covers anti-aliased halos better
    // than RGB distance alone (white→#e2e0e7 needs ~49).
    const nearWhiteNeutral = lum >= 232 && ch <= 18
    const nearBackdropNeutral =
      lum >= bgLum - 14 && ch <= 20 && rgbDist2 <= (tolerance * 1.35) ** 2
    if (!(nearWhiteNeutral || nearBackdropNeutral || rgbDist2 <= tol2)) return false
    // Extra: reject anything warm enough to be flesh-adjacent highlight.
    if (r > g + 10 && r > b + 15 && ch > 14) return false
    return true
  }

  if (rgbDist2 > tol2) return false

  if (isDarkBackdrop) {
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
      const nLum = luminance({ r: data[no], g: data[no + 1], b: data[no + 2] })
      if (nLum - lum > 48) return false
      if (isSkinTone({ r: data[no], g: data[no + 1], b: data[no + 2] })) return false
    }
  }

  return true
}

/** Clear near-white pixels that touch already-transparent backdrop (AA halo). */
function clearNearWhiteHalos(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  minLum: number,
): number {
  let cleared = 0
  let changed = true
  let passes = 0
  while (changed && passes < 4) {
    changed = false
    passes++
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const o = (y * width + x) * 4
        if (data[o + 3] < 128) continue
        const pixel = { r: data[o], g: data[o + 1], b: data[o + 2] }
        if (isSkinTone(pixel)) continue
        if (luminance(pixel) < minLum || chroma(pixel) > 18) continue
        let touchesClear = false
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          if (data[((y + dy) * width + (x + dx)) * 4 + 3] < 16) {
            touchesClear = true
            break
          }
        }
        if (!touchesClear) continue
        data[o + 3] = 0
        cleared++
        changed = true
      }
    }
  }
  return cleared
}

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
      // Never despeckle skin away.
      if (isSkinTone({ r: data[o], g: data[o + 1], b: data[o + 2] })) continue
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
