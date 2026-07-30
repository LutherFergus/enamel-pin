import ImageTracer from 'imagetracerjs'
import type { PaletteColor, Rgb } from './types'
import { rgbToHex } from './types'

export type TraceOptions = {
  /** UI smoothness 0–5 → spline tolerance. */
  smoothness: number
  widthPx: number
  heightPx: number
}

/**
 * Build a flat posterized ImageData from our label map + fill palette
 * (transparent where label is 0xffff), then run ImageTracer for
 * Vectorizer.AI-style quadratic spline paths instead of pixel stairs.
 */
export function labelsToSmoothSvg(
  labels: Uint16Array,
  fillRgb: Rgb[],
  metaByIndex: Map<number, PaletteColor>,
  opts: TraceOptions,
): { svg: string; pathCount: number } {
  const { widthPx: w, heightPx: h, smoothness } = opts
  const imgd = {
    width: w,
    height: h,
    data: new Uint8ClampedArray(w * h * 4),
  }

  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    const v = labels[i]
    if (v === 0xffff || v >= fillRgb.length) {
      imgd.data[o] = 0
      imgd.data[o + 1] = 0
      imgd.data[o + 2] = 0
      imgd.data[o + 3] = 0
      continue
    }
    const c = fillRgb[v]
    imgd.data[o] = c.r
    imgd.data[o + 1] = c.g
    imgd.data[o + 2] = c.b
    imgd.data[o + 3] = 255
  }

  const pal = [
    ...fillRgb.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 })),
    { r: 0, g: 0, b: 0, a: 0 },
  ]

  // Higher thresholds → stair-steps collapse into smooth arcs (Vectorizer look).
  const t = Math.max(0, Math.min(5, smoothness)) / 5
  const ltres = 0.8 + t * 3.2
  const qtres = 0.8 + t * 3.2
  const pathomit = Math.round(6 + t * 14)

  const traced = ImageTracer.imagedataToTracedata(imgd, {
    pal,
    colorsampling: 0,
    colorquantcycles: 1,
    numberofcolors: pal.length,
    layering: 0,
    ltres,
    qtres,
    pathomit,
    rightangleenhance: false,
    linefilter: true,
    strokewidth: 0,
    scale: 1,
    roundcoords: 1,
    viewbox: true,
    desc: false,
    blurradius: 0,
    lcpr: 0,
    qcpr: 0,
  })

  const legend = [...metaByIndex.values()]
    .map(
      (c) =>
        `  ${c.pmsName ?? c.hex} → ${c.hex}${
          c.pmsDeltaE != null ? ` (ΔE ${c.pmsDeltaE})` : ''
        }`,
    )
    .join('\n')

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `<!-- PMS Solid Coated palette\n${legend}\n-->`,
    '<g id="fills">',
  ]

  let pathCount = 0
  const layers = traced.layers as Array<
    Array<{
      isholepath?: boolean
      segments: Array<{
        type: string
        x1: number
        y1: number
        x2: number
        y2: number
        x3?: number
        y3?: number
      }>
      holechildren?: number[]
    }>
  >
  const palette = traced.palette as Array<{ r: number; g: number; b: number; a: number }>

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]
    const pc = palette[li]
    if (!pc || pc.a < 128) continue

    const fill = rgbToHex({ r: pc.r, g: pc.g, b: pc.b })
    // Match back to our PMS meta by nearest fillRgb index
    let bestIdx = -1
    let bestD = Infinity
    for (let i = 0; i < fillRgb.length; i++) {
      const d =
        (fillRgb[i].r - pc.r) ** 2 +
        (fillRgb[i].g - pc.g) ** 2 +
        (fillRgb[i].b - pc.b) ** 2
      if (d < bestD) {
        bestD = d
        bestIdx = i
      }
    }
    const meta = bestIdx >= 0 ? metaByIndex.get(bestIdx) : undefined
    const pmsAttr = meta?.pmsCode ? ` data-pms="${meta.pmsCode}"` : ''

    for (let pi = 0; pi < layer.length; pi++) {
      const smp = layer[pi]
      if (smp.isholepath) continue
      if (!smp.segments?.length) continue
      if (smp.segments.length < 3) continue

      let d = segmentPath(smp.segments)

      // Append hole children as evenodd subpaths
      if (smp.holechildren?.length) {
        for (const hi of smp.holechildren) {
          const hole = layer[hi]
          if (!hole?.segments?.length) continue
          d += ' ' + segmentPath(hole.segments, true)
        }
      }

      parts.push(
        `<path fill="${fill}" fill-rule="evenodd" stroke="none"${pmsAttr} d="${d}" />`,
      )
      pathCount++
    }
  }

  parts.push('</g></svg>')
  return { svg: parts.join('\n'), pathCount }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function segmentPath(
  segments: Array<{
    type: string
    x1: number
    y1: number
    x2: number
    y2: number
    x3?: number
    y3?: number
  }>,
  reverse = false,
): string {
  if (!segments.length) return ''

  if (!reverse) {
    let d = `M ${round1(segments[0].x1)} ${round1(segments[0].y1)}`
    for (const s of segments) {
      if (s.x3 != null && s.y3 != null) {
        d += ` Q ${round1(s.x2)} ${round1(s.y2)} ${round1(s.x3)} ${round1(s.y3)}`
      } else {
        d += ` L ${round1(s.x2)} ${round1(s.y2)}`
      }
    }
    return d + ' Z'
  }

  // Reverse winding for holes
  const last = segments[segments.length - 1]
  const startX = last.x3 != null ? last.x3 : last.x2
  const startY = last.y3 != null ? last.y3 : last.y2
  let d = `M ${round1(startX)} ${round1(startY)}`
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i]
    if (s.x3 != null && s.y3 != null) {
      d += ` Q ${round1(s.x2)} ${round1(s.y2)} ${round1(s.x1)} ${round1(s.y1)}`
    } else {
      d += ` L ${round1(s.x1)} ${round1(s.y1)}`
    }
  }
  return d + ' Z'
}
