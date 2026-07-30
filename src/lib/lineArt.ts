/**
 * Line-art detection and ink extraction.
 * For B&W illustrations, we must keep the ink itself — NOT trace boundaries
 * around every stroke (that doubles lines into jagged noise).
 */

export type InkMask = {
  mask: Uint8Array
  width: number
  height: number
  isLineArt: boolean
  darkRatio: number
  midRatio: number
}

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * Heuristic: mostly dark ink + light paper, few mid-tones → line art.
 */
export function analyzeLineArt(imageData: ImageData): {
  isLineArt: boolean
  darkRatio: number
  midRatio: number
  lightRatio: number
} {
  const { data, width, height } = imageData
  let dark = 0
  let mid = 0
  let light = 0
  let opaque = 0
  let lowChroma = 0

  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    // Knocked-out / transparent backdrop still counts as paper — otherwise
    // lightRatio collapses after knockOut* and we mis-route to color boundaries
    // (which double-traces every stroke into hollow jagged lines).
    if (data[o + 3] < 16) {
      light++
      opaque++
      lowChroma++
      continue
    }
    opaque++
    const r = data[o]
    const g = data[o + 1]
    const b = data[o + 2]
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    if (chroma < 28) lowChroma++
    const y = luma(r, g, b)
    // Near-white paper / near-black ink (ignore slight anti-alias as mid)
    if (y < 90) dark++
    else if (y > 210) light++
    else mid++
  }

  if (opaque < 64) {
    return { isLineArt: false, darkRatio: 0, midRatio: 0, lightRatio: 0 }
  }

  const darkRatio = dark / opaque
  const midRatio = mid / opaque
  const lightRatio = light / opaque
  const lowChromaRatio = lowChroma / opaque

  // Classic ink drawing: near-grayscale paper + ink, little continuous tone.
  // Must reject flat-color enamel art (high chroma) even when it has light bg.
  // darkRatio can be tiny on sparse line art (thin strokes on large canvas).
  const isLineArt =
    lowChromaRatio > 0.88 &&
    midRatio < 0.25 &&
    darkRatio > 0.008 &&
    lightRatio > 0.35 &&
    darkRatio + lightRatio > 0.75

  return { isLineArt, darkRatio, midRatio, lightRatio }
}

/**
 * Build a clean binary ink mask from a (likely) line-art image.
 * `sensitivity` 0–100: lower → only darker ink; higher → keep lighter gray strokes.
 */
export function extractInkMask(
  imageData: ImageData,
  sensitivity = 50,
): InkMask {
  const { data, width, height } = imageData
  const analysis = analyzeLineArt(imageData)
  // Threshold: sensitivity 0 → ~55, 50 → ~140, 100 → ~190
  const threshold = 55 + (sensitivity / 100) * 135

  let mask = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (data[o + 3] < 16) continue
    const y = luma(data[o], data[o + 1], data[o + 2])
    if (y <= threshold) mask[i] = 255
  }

  // Close 1px gaps in strokes, then drop only true freckles (keep hair/lace).
  mask = dilate(mask, width, height, 1)
  mask = erode(mask, width, height, 1)
  mask = removeSmallComponents(
    mask,
    width,
    height,
    Math.max(3, Math.round((width * height) / 200000)),
  )

  return {
    mask,
    width,
    height,
    isLineArt: analysis.isLineArt,
    darkRatio: analysis.darkRatio,
    midRatio: analysis.midRatio,
  }
}

/**
 * Adjust ink stroke weight toward a target thickness (px).
 * Uses skeleton → dilate so weight is even (enamel-friendly), while keeping topology.
 */
export function inkToStrokeWeight(
  mask: Uint8Array,
  width: number,
  height: number,
  thickness: number,
): Uint8Array {
  const t = Math.max(1, Math.min(8, Math.round(thickness)))
  // Skeletonize then dilate to exact weight for clean uniform die-lines when requested.
  // For thickness 2 (default), this yields crisp ~2px strokes without double-outlines.
  let sk = skeletonize(mask, width, height)
  if (t <= 1) return sk
  return dilate(sk, width, height, t - 1)
}

/** Keep original ink shapes (variable weight) with light cleanup only. */
export function inkPreserved(
  mask: Uint8Array,
  width: number,
  height: number,
  thickness: number,
): Uint8Array {
  const t = Math.max(1, Math.min(8, Math.round(thickness)))
  if (t <= 1) return erode(mask, width, height, 0) // copy semantics via dilate 0
  // Slight thicken without skeletonizing — preserves PROST! fat outlines etc.
  return dilate(mask, width, height, t - 1)
}

export function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask)
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

export function erode(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask)
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

function removeSmallComponents(
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
    const comp: number[] = []
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
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
    if (comp.length >= minPixels) {
      for (const i of comp) out[i] = 255
    }
  }
  return out
}

/**
 * Zhang–Suen-ish iterative thinning to 1px centerlines.
 */
function skeletonize(mask: Uint8Array, w: number, h: number): Uint8Array {
  let img = new Uint8Array(mask)
  // Cap iterations for performance
  for (let iter = 0; iter < 64; iter++) {
    const remove1: number[] = []
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!img[i]) continue
        const p = neighbors(img, w, x, y)
        const bp = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7]
        if (bp < 2 || bp > 6) continue
        const a = transitions(p)
        if (a !== 1) continue
        if (p[0] * p[2] * p[4] !== 0) continue
        if (p[2] * p[4] * p[6] !== 0) continue
        remove1.push(i)
      }
    }
    for (const i of remove1) img[i] = 0

    const remove2: number[] = []
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        if (!img[i]) continue
        const p = neighbors(img, w, x, y)
        const bp = p[0] + p[1] + p[2] + p[3] + p[4] + p[5] + p[6] + p[7]
        if (bp < 2 || bp > 6) continue
        const a = transitions(p)
        if (a !== 1) continue
        if (p[0] * p[2] * p[6] !== 0) continue
        if (p[0] * p[4] * p[6] !== 0) continue
        remove2.push(i)
      }
    }
    for (const i of remove2) img[i] = 0
    if (remove1.length === 0 && remove2.length === 0) break
  }
  return img
}

function neighbors(img: Uint8Array, w: number, x: number, y: number): number[] {
  // p2 p3 p4 / p9 p1 p5 / p8 p7 p6  → return [p2,p3,p4,p5,p6,p7,p8,p9] as 0/1
  const at = (xx: number, yy: number) => (img[yy * w + xx] ? 1 : 0)
  return [
    at(x, y - 1),
    at(x + 1, y - 1),
    at(x + 1, y),
    at(x + 1, y + 1),
    at(x, y + 1),
    at(x - 1, y + 1),
    at(x - 1, y),
    at(x - 1, y - 1),
  ]
}

function transitions(p: number[]): number {
  let a = 0
  for (let i = 0; i < 8; i++) {
    if (p[i] === 0 && p[(i + 1) % 8] === 1) a++
  }
  return a
}
