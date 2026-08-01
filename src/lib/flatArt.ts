import type { Rgb } from './types'

function chroma(c: Rgb): number {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)
}

function lum(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

/**
 * Flat digital illustrations (clipart / enamel mockups) have few dominant
 * colors and little soft shading. Detect so we can flatten harder.
 */
export function isFlatDigitalArt(imageData: ImageData, sampleStep = 2): boolean {
  const { data, width, height } = imageData
  const counts = new Map<number, number>()
  let opaque = 0
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      opaque++
      // Coarse bucket (~32 levels) — AA fringe collapses into neighbors.
      const key =
        ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  if (opaque < 200) return false
  const ranked = [...counts.values()].sort((a, b) => b - a)
  const top = ranked.slice(0, 14).reduce((s, n) => s + n, 0)
  const top8 = ranked.slice(0, 8).reduce((s, n) => s + n, 0)
  // Few buckets cover most pixels → flat art (Oktoberfest-style clipart).
  return top / opaque >= 0.78 || top8 / opaque >= 0.7
}

/**
 * Rewrite anti-aliased fringe between black outlines and flat fills.
 * Muddy brown/gray AA pixels become the majority neighbor fill (or black).
 */
export function scrubAntiAliasFringe(imageData: ImageData): void {
  const { data, width, height } = imageData
  const out = new Uint8ClampedArray(data)

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 128) continue
      const pixel = { r: data[i], g: data[i + 1], b: data[i + 2] }
      const L = lum(pixel)
      const ch = chroma(pixel)

      // Soft midtones / muddy blends next to ink — not solid fills.
      const muddy =
        (L > 28 && L < 210 && ch < 48) ||
        (L > 40 && L < 180 && ch >= 20 && ch < 55 && L / (ch + 1) > 2.2)
      if (!muddy) continue

      let nearBlack = false
      let nearFlat = false
      const votes = new Map<string, { c: Rgb; n: number }>()

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const ni = ((y + dy) * width + (x + dx)) * 4
          if (data[ni + 3] < 128) continue
          const n = { r: data[ni], g: data[ni + 1], b: data[ni + 2] }
          const nL = lum(n)
          const nCh = chroma(n)
          if (nL <= 28 && nCh < 32) {
            nearBlack = true
            const key = 'k'
            const cur = votes.get(key) ?? { c: { r: 0, g: 0, b: 0 }, n: 0 }
            cur.n++
            votes.set(key, cur)
            continue
          }
          // Strong flat fill neighbor.
          if (nCh >= 40 || nL >= 230 || (nCh < 18 && nL >= 200)) {
            nearFlat = true
            const key = `${n.r >> 3},${n.g >> 3},${n.b >> 3}`
            const cur = votes.get(key) ?? { c: n, n: 0 }
            cur.n++
            cur.c = {
              r: Math.round((cur.c.r * (cur.n - 1) + n.r) / cur.n),
              g: Math.round((cur.c.g * (cur.n - 1) + n.g) / cur.n),
              b: Math.round((cur.c.b * (cur.n - 1) + n.b) / cur.n),
            }
            votes.set(key, cur)
          }
        }
      }

      if (!nearBlack && !nearFlat) continue
      if (votes.size === 0) continue

      let best: Rgb | null = null
      let bestN = -1
      for (const v of votes.values()) {
        if (v.n > bestN) {
          bestN = v.n
          best = v.c
        }
      }
      if (!best || bestN < 2) continue
      out[i] = best.r
      out[i + 1] = best.g
      out[i + 2] = best.b
    }
  }

  data.set(out)
}
