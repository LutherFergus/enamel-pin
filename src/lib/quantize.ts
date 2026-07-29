import type { Rgb } from './types'
import { colorDistance } from './types'

type Bucket = {
  pixels: Rgb[]
  rMin: number
  rMax: number
  gMin: number
  gMax: number
  bMin: number
  bMax: number
}

function makeBucket(pixels: Rgb[]): Bucket {
  let rMin = 255
  let rMax = 0
  let gMin = 255
  let gMax = 0
  let bMin = 255
  let bMax = 0
  for (const p of pixels) {
    if (p.r < rMin) rMin = p.r
    if (p.r > rMax) rMax = p.r
    if (p.g < gMin) gMin = p.g
    if (p.g > gMax) gMax = p.g
    if (p.b < bMin) bMin = p.b
    if (p.b > bMax) bMax = p.b
  }
  return { pixels, rMin, rMax, gMin, gMax, bMin, bMax }
}

function channelRange(bucket: Bucket): { channel: 'r' | 'g' | 'b'; range: number } {
  const r = bucket.rMax - bucket.rMin
  const g = bucket.gMax - bucket.gMin
  const b = bucket.bMax - bucket.bMin
  if (r >= g && r >= b) return { channel: 'r', range: r }
  if (g >= r && g >= b) return { channel: 'g', range: g }
  return { channel: 'b', range: b }
}

function averageColor(pixels: Rgb[]): Rgb {
  if (pixels.length === 0) return { r: 0, g: 0, b: 0 }
  let r = 0
  let g = 0
  let b = 0
  for (const p of pixels) {
    r += p.r
    g += p.g
    b += p.b
  }
  const n = pixels.length
  return {
    r: Math.round(r / n),
    g: Math.round(g / n),
    b: Math.round(b / n),
  }
}

function splitBucket(bucket: Bucket): [Bucket, Bucket] {
  const { channel } = channelRange(bucket)
  const sorted = [...bucket.pixels].sort((a, b) => a[channel] - b[channel])
  const mid = Math.floor(sorted.length / 2)
  return [makeBucket(sorted.slice(0, mid)), makeBucket(sorted.slice(mid))]
}

/** Median-cut palette extraction. */
export function extractPalette(
  imageData: ImageData,
  colorCount: number,
  sampleStep = 2,
): Rgb[] {
  const { data, width, height } = imageData
  const pixels: Rgb[] = []
  for (let y = 0; y < height; y += sampleStep) {
    for (let x = 0; x < width; x += sampleStep) {
      const i = (y * width + x) * 4
      const a = data[i + 3]
      if (a < 128) continue
      pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] })
    }
  }
  if (pixels.length === 0) {
    return Array.from({ length: colorCount }, () => ({ r: 200, g: 200, b: 200 }))
  }

  const target = Math.max(2, Math.min(colorCount, 32))
  let buckets: Bucket[] = [makeBucket(pixels)]

  while (buckets.length < target) {
    let bestIdx = 0
    let bestRange = -1
    for (let i = 0; i < buckets.length; i++) {
      const { range } = channelRange(buckets[i])
      if (range > bestRange && buckets[i].pixels.length >= 2) {
        bestRange = range
        bestIdx = i
      }
    }
    if (bestRange <= 0) break
    const [left, right] = splitBucket(buckets[bestIdx])
    buckets.splice(bestIdx, 1, left, right)
  }

  return buckets.map((b) => averageColor(b.pixels))
}

export function quantizeImage(imageData: ImageData, palette: Rgb[]): Uint16Array {
  const { data, width, height } = imageData
  const labels = new Uint16Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const o = i * 4
    if (data[o + 3] < 128) {
      labels[i] = 0xffff
      continue
    }
    const pixel = { r: data[o], g: data[o + 1], b: data[o + 2] }
    let best = 0
    let bestDist = Infinity
    for (let c = 0; c < palette.length; c++) {
      const d = colorDistance(pixel, palette[c])
      if (d < bestDist) {
        bestDist = d
        best = c
      }
    }
    labels[i] = best
  }
  return labels
}

/** Majority-vote cleanup to reduce speckles before region merge. */
export function denoiseLabels(
  labels: Uint16Array,
  width: number,
  height: number,
  passes = 1,
): Uint16Array {
  let current = labels
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint16Array(current)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        if (current[i] === 0xffff) continue
        const counts = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = current[(y + dy) * width + (x + dx)]
            if (v === 0xffff) continue
            counts.set(v, (counts.get(v) ?? 0) + 1)
          }
        }
        let best = current[i]
        let bestCount = -1
        for (const [label, count] of counts) {
          if (count > bestCount) {
            bestCount = count
            best = label
          }
        }
        next[i] = best
      }
    }
    current = next
  }
  return current
}
