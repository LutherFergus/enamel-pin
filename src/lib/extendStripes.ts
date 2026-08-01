/**
 * Extend truncated stripe / band fills (e.g. reflective jacket tape) through
 * surrounding dark enamel until they meet the silhouette edge.
 *
 * Vector often leaves yellow bands stopping short of the jacket outline with a
 * dark gap — complete those bands without flooding into flames / other colors.
 */

type Rgb = { r: number; g: number; b: number }

function lum(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

function chroma(c: Rgb): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
}

function isStripeColor(c: Rgb): boolean {
  const L = lum(c)
  const ch = chroma(c)
  // Reflective tape / cream / yellow accents — bright, not near-black, not deep red.
  if (L < 140) return false
  if (ch < 18 && L < 200) return false
  // Prefer warm yellows / creams (R+G strong); allow pale neutrals for cream tape.
  if (ch >= 28 && c.b > c.r + 20 && c.b > c.g + 20) return false // skip blue accents
  if (ch >= 50 && c.r > c.g + 40 && c.g < 90) return false // skip deep reds
  return true
}

function isDarkBase(c: Rgb): boolean {
  const L = lum(c)
  const ch = chroma(c)
  // Jacket / gear body — dark, low-mid chroma (not flame orange).
  if (L > 70) return false
  if (ch >= 45 && L > 28) return false
  return true
}

/**
 * Grow stripe-like fills through adjacent dark base pixels along the band axis
 * until the dark silhouette ends (edge of jacket / limb).
 */
export function extendStripeFillsToEdge(
  labels: Uint16Array,
  palette: Rgb[],
  width: number,
  height: number,
): Uint16Array {
  const n = width * height
  const out = new Uint16Array(labels)

  const stripeIdx = new Set<number>()
  const darkIdx = new Set<number>()
  for (let c = 0; c < palette.length; c++) {
    if (isStripeColor(palette[c])) stripeIdx.add(c)
    if (isDarkBase(palette[c])) darkIdx.add(c)
  }
  if (!stripeIdx.size || !darkIdx.size) return out

  const seen = new Uint8Array(n)
  for (let seed = 0; seed < n; seed++) {
    const color = out[seed]
    if (seen[seed] || color === 0xffff || !stripeIdx.has(color)) continue

    // Collect connected stripe component.
    const stack = [seed]
    seen[seed] = 1
    const comp: number[] = []
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    while (stack.length) {
      const i = stack.pop()!
      comp.push(i)
      const x = i % width
      const y = (i / width) | 0
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const ni = ny * width + nx
        if (seen[ni] || out[ni] !== color) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }

    const bw = maxX - minX + 1
    const bh = maxY - minY + 1
    // Band-like: elongated or thin strip; skip big fills (tanks, banners).
    const area = comp.length
    if (area < 8 || area > Math.round(n * 0.04)) continue
    const thin =
      Math.min(bw, bh) <= Math.max(14, Math.round(Math.max(bw, bh) * 0.45))
    const elongated = Math.max(bw, bh) >= Math.min(bw, bh) * 1.6
    if (!thin && !elongated) continue

    const horizontal = bw >= bh
    // Max grow: enough to close typical dark gaps at stripe ends.
    const maxGrow = Math.max(
      6,
      Math.min(48, Math.round((horizontal ? bw : bh) * 0.55) + 8),
    )

    if (horizontal) {
      // Per row that has stripe pixels: extend left/right through dark.
      const rows = new Map<number, { min: number; max: number }>()
      for (const i of comp) {
        const x = i % width
        const y = (i / width) | 0
        const r = rows.get(y)
        if (!r) rows.set(y, { min: x, max: x })
        else {
          if (x < r.min) r.min = x
          if (x > r.max) r.max = x
        }
      }
      for (const [y, span] of rows) {
        growAlongRow(out, width, height, y, span.min, span.max, color, darkIdx, maxGrow)
      }
    } else {
      const cols = new Map<number, { min: number; max: number }>()
      for (const i of comp) {
        const x = i % width
        const y = (i / width) | 0
        const c = cols.get(x)
        if (!c) cols.set(x, { min: y, max: y })
        else {
          if (y < c.min) c.min = y
          if (y > c.max) c.max = y
        }
      }
      for (const [x, span] of cols) {
        growAlongCol(out, width, height, x, span.min, span.max, color, darkIdx, maxGrow)
      }
    }
  }

  return out
}

function growAlongRow(
  labels: Uint16Array,
  w: number,
  h: number,
  y: number,
  minX: number,
  maxX: number,
  stripe: number,
  darkIdx: Set<number>,
  maxGrow: number,
) {
  // Left
  for (let step = 1; step <= maxGrow; step++) {
    const x = minX - step
    if (x < 0) break
    const i = y * w + x
    const v = labels[i]
    if (v === stripe) continue
    if (v === 0xffff || !darkIdx.has(v)) break
    // Only grow while still "inside" the dark body — stop at silhouette:
    // dark pixel whose outer neighbor is not dark/stripe (edge of jacket).
    labels[i] = stripe
    if (isSilhouetteEdge(labels, w, h, x, y, darkIdx, stripe)) break
  }
  // Right
  for (let step = 1; step <= maxGrow; step++) {
    const x = maxX + step
    if (x >= w) break
    const i = y * w + x
    const v = labels[i]
    if (v === stripe) continue
    if (v === 0xffff || !darkIdx.has(v)) break
    labels[i] = stripe
    if (isSilhouetteEdge(labels, w, h, x, y, darkIdx, stripe)) break
  }
}

function growAlongCol(
  labels: Uint16Array,
  w: number,
  h: number,
  x: number,
  minY: number,
  maxY: number,
  stripe: number,
  darkIdx: Set<number>,
  maxGrow: number,
) {
  for (let step = 1; step <= maxGrow; step++) {
    const y = minY - step
    if (y < 0) break
    const i = y * w + x
    const v = labels[i]
    if (v === stripe) continue
    if (v === 0xffff || !darkIdx.has(v)) break
    labels[i] = stripe
    if (isSilhouetteEdge(labels, w, h, x, y, darkIdx, stripe)) break
  }
  for (let step = 1; step <= maxGrow; step++) {
    const y = maxY + step
    if (y >= h) break
    const i = y * w + x
    const v = labels[i]
    if (v === stripe) continue
    if (v === 0xffff || !darkIdx.has(v)) break
    labels[i] = stripe
    if (isSilhouetteEdge(labels, w, h, x, y, darkIdx, stripe)) break
  }
}

/** True when this dark/stripe pixel sits on the outer edge of the dark body. */
function isSilhouetteEdge(
  labels: Uint16Array,
  w: number,
  h: number,
  x: number,
  y: number,
  darkIdx: Set<number>,
  stripe: number,
): boolean {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= w || ny >= h) return true
    const v = labels[ny * w + nx]
    if (v === 0xffff) return true
    if (v !== stripe && !darkIdx.has(v)) return true
  }
  return false
}
