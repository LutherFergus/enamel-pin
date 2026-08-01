import { init as initPotrace, potrace } from 'esm-potrace-wasm'
import ImageTracer from 'imagetracerjs'
import type { PaletteColor, Rgb } from './types'
import { rgbToHex } from './types'

export type TraceOptions = {
  /** UI smoothness 0–5 → curve tolerance + supersample. */
  smoothness: number
  widthPx: number
  heightPx: number
  /** Scales ImageTracer pathomit; lower keeps small islands (from detail retention). */
  pathomitScale?: number
}

type Seg = {
  type: string
  x1: number
  y1: number
  x2: number
  y2: number
  x3?: number
  y3?: number
}

type TracerPath = {
  isholepath?: boolean
  segments: Seg[]
  holechildren?: number[]
}

let potraceReady: Promise<void> | null = null

function ensurePotrace(): Promise<void> {
  if (!potraceReady) potraceReady = initPotrace()
  return potraceReady
}

/**
 * True vectorization: flat color regions → smooth quadratic/cubic-like
 * spline paths (resolution-independent). Not a PNG wrapped in <path>.
 *
 * Pipeline:
 *  1. Render posterized RGBA from labels
 *  2. Nearest-neighbor supersample (kills stair geometry for the tracer)
 *  3. ImageTracer with aggressive line/spline fit tolerances
 *  4. Scale path coords back to original size
 */
export function labelsToSmoothSvg(
  labels: Uint16Array,
  fillRgb: Rgb[],
  metaByIndex: Map<number, PaletteColor>,
  opts: TraceOptions,
): { svg: string; pathCount: number } {
  const { widthPx: w, heightPx: h, smoothness } = opts
  const t = Math.max(0, Math.min(5, smoothness)) / 5
  const pathomitScale = Math.max(0.25, Math.min(1.75, opts.pathomitScale ?? 1))

  // Always ≥2× supersample so zoomed edges aren't 1px stairs; 3× at high smooth.
  const superScale = smoothness >= 3 ? 3 : 2

  const flat = renderFlat(labels, fillRgb, w, h)
  const imgd = nearestNeighborScale(flat, w, h, superScale)

  const pal = [
    ...fillRgb.map((c) => ({ r: c.r, g: c.g, b: c.b, a: 255 })),
    { r: 0, g: 0, b: 0, a: 0 },
  ]

  // Micro curve fit: slightly higher tolerances → longer arcs, fewer dogbones.
  const ltres = 1.8 + t * 7.2
  const qtres = 1.8 + t * 7.2
  const pathomit = Math.max(
    2,
    Math.round((8 + t * 28) * superScale * pathomitScale),
  )
  const blurradius = t >= 0.25 ? Math.min(3, 1 + Math.round(t * 2)) : 0

  const traced = ImageTracer.imagedataToTracedata(imgd, {
    pal,
    colorsampling: 0,
    colorquantcycles: blurradius > 0 ? 2 : 1,
    numberofcolors: pal.length,
    layering: 0,
    ltres,
    qtres,
    pathomit,
    rightangleenhance: false,
    linefilter: true,
    strokewidth: 0,
    // Raw tracedata stays in supersampled px; we scale in segmentPath.
    scale: 1,
    // Finer control-point quantization — less micro-stair on zoom.
    roundcoords: 3,
    viewbox: true,
    desc: false,
    blurradius,
    blurdelta: 128,
    lcpr: 0,
    qcpr: 0,
  })

  const coordScale = 1 / superScale
  // Hairline seam killer: matching stroke under each fill (~1 CSS px at art size).
  const seamStroke = Math.max(0.9, 1.15 + t * 0.6)

  const legend = [...metaByIndex.values()]
    .map(
      (c) =>
        `  ${c.pmsName ?? c.hex} → ${c.hex}${
          c.pmsDeltaE != null ? ` (ΔE ${c.pmsDeltaE})` : ''
        }`,
    )
    .join('\n')

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="geometricPrecision">`,
    `<!-- vectorized enamel fills · PMS Solid Coated\n${legend}\n-->`,
    '<g id="fills">',
  ]

  type PendingPath = { d: string; fill: string; pmsAttr: string; area: number }
  const pending: PendingPath[] = []

  const layers = traced.layers as TracerPath[][]
  const palette = traced.palette as Array<{ r: number; g: number; b: number; a: number }>

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]
    const pc = palette[li]
    if (!pc || pc.a < 128) continue

    const fill = rgbToHex({ r: pc.r, g: pc.g, b: pc.b })
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
      if (!smp.segments?.length || smp.segments.length < 3) continue

      const segs = scaleSegs(promoteCollinearToCurves(smp.segments), coordScale)
      let d = segmentPath(segs)
      let area = approxPathArea(segs)

      if (smp.holechildren?.length) {
        for (const hi of smp.holechildren) {
          const hole = layer[hi]
          if (!hole?.segments?.length) continue
          const hSegs = scaleSegs(promoteCollinearToCurves(hole.segments), coordScale)
          d += ' ' + segmentPath(hSegs, true)
          area = Math.max(0, area - approxPathArea(hSegs))
        }
      }

      pending.push({ d, fill, pmsAttr, area })
    }
  }

  // Large fills underneath, detail on top — seams get covered by overlap strokes.
  pending.sort((a, b) => b.area - a.area)

  for (const p of pending) {
    parts.push(
      `<path fill="${p.fill}" fill-rule="evenodd" stroke="${p.fill}" stroke-width="${seamStroke.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"${p.pmsAttr} d="${p.d}" />`,
    )
  }

  parts.push('</g></svg>')
  return { svg: parts.join('\n'), pathCount: pending.length }
}

/**
 * Potrace each flat color into smooth cubic Beziers — used for Final / Clean up
 * so enamel edges read as crisp curves instead of ImageTracer stair-waves.
 */
export async function labelsToCrispSvg(
  labels: Uint16Array,
  fillRgb: Rgb[],
  metaByIndex: Map<number, PaletteColor>,
  opts: { widthPx: number; heightPx: number },
): Promise<{ svg: string; pathCount: number }> {
  await ensurePotrace()
  const { widthPx: w, heightPx: h } = opts
  const n = w * h

  const used = new Set<number>()
  for (let i = 0; i < n; i++) {
    const v = labels[i]
    if (v !== 0xffff && v < fillRgb.length) used.add(v)
  }

  const legend = [...metaByIndex.values()]
    .map(
      (c) =>
        `  ${c.pmsName ?? c.hex} → ${c.hex}${
          c.pmsDeltaE != null ? ` (ΔE ${c.pmsDeltaE})` : ''
        }`,
    )
    .join('\n')

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" shape-rendering="geometricPrecision">`,
    `<!-- crisp enamel fills · Potrace curves · PMS Solid Coated\n${legend}\n-->`,
    '<g id="fills">',
  ]

  type Pending = { markup: string; area: number }
  const pending: Pending[] = []
  const turdsize = Math.max(4, Math.round(w * h * 0.000012))

  for (const idx of [...used].sort((a, b) => a - b)) {
    const c = fillRgb[idx]
    if (!c) continue
    const fill = rgbToHex(c)
    const meta = metaByIndex.get(idx)
    const pmsAttr = meta?.pmsCode ? ` data-pms="${meta.pmsCode}"` : ''

    // 2× supersample so Potrace fits curves to sub-pixel stairs.
    const scale = 2
    const tw = w * scale
    const th = h * scale
    const bw = new ImageData(tw, th)
    for (let y = 0; y < th; y++) {
      const sy = (y / scale) | 0
      for (let x = 0; x < tw; x++) {
        const sx = (x / scale) | 0
        const on = labels[sy * w + sx] === idx
        const o = (y * tw + x) * 4
        const v = on ? 0 : 255
        bw.data[o] = v
        bw.data[o + 1] = v
        bw.data[o + 2] = v
        bw.data[o + 3] = 255
      }
    }

    const traced = await potrace(bw, {
      turdsize: Math.max(4, turdsize * scale * scale),
      turnpolicy: 4,
      alphamax: 0.88,
      opticurve: 1,
      opttolerance: 0.52,
      pathonly: false,
      extractcolors: false,
    })

    const inner = extractPotraceColorGroup(String(traced), fill, pmsAttr)
    if (!inner.markup) continue

    // Outer scale maps 2× Potrace space back into the art viewBox.
    pending.push({
      markup: `<g transform="scale(${1 / scale})">${inner.markup}</g>`,
      area: inner.area / (scale * scale),
    })
  }

  pending.sort((a, b) => b.area - a.area)
  for (const p of pending) parts.push(p.markup)

  parts.push('</g></svg>')
  return { svg: parts.join('\n'), pathCount: pending.length }
}

/** Recolor Potrace paths; keep the native y-flip transform untouched. */
function extractPotraceColorGroup(
  svg: string,
  fill: string,
  pmsAttr: string,
): { markup: string; area: number } {
  const s = svg
    .replace(/<\?xml[^>]*>/i, '')
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<rect\b[^>]*\/?>/gi, '')
    .trim()

  const gMatch =
    s.match(/<g\b([^>]*)>([\s\S]*)<\/g>\s*<\/svg>/i) ||
    s.match(/<g\b([^>]*)>([\s\S]*)<\/g>/i)
  if (!gMatch) return { markup: '', area: 0 }

  const gAttrs = gMatch[1]
  const body = gMatch[2]
  const transform = gAttrs.match(/transform="([^"]*)"/i)?.[1]

  const paths = [...body.matchAll(/<path\b[^>]*\/?>/gi)].map((m) => m[0])
  if (!paths.length) return { markup: '', area: 0 }

  const seam = 2.4 // in supersampled px; halved by outer scale(0.5)
  const restyled = paths
    .map((p) => {
      const open = p
        .replace(/\sfill="[^"]*"/gi, '')
        .replace(/\sstroke="[^"]*"/gi, '')
        .replace(/\sfill-rule="[^"]*"/gi, '')
        .replace(/\s?\/?>$/, '')
      return `${open} fill="${fill}" fill-rule="evenodd" stroke="${fill}" stroke-width="${seam.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"${pmsAttr} />`
    })
    .join('\n')

  let area = 0
  for (const m of body.matchAll(/\bd="([^"]*)"/gi)) {
    const nums = m[1].match(/-?\d+\.?\d*/g)
    if (!nums || nums.length < 4) continue
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) {
      xs.push(Number(nums[i]))
      ys.push(Number(nums[i + 1]))
    }
    if (!xs.length) continue
    area +=
      Math.max(0, Math.max(...xs) - Math.min(...xs)) *
      Math.max(0, Math.max(...ys) - Math.min(...ys))
  }

  const transformAttr = transform ? ` transform="${transform}"` : ''
  return {
    markup: `<g${transformAttr} fill="${fill}">${restyled}</g>`,
    area: area || paths.length,
  }
}

function renderFlat(
  labels: Uint16Array,
  fillRgb: Rgb[],
  w: number,
  h: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    const v = labels[i]
    if (v === 0xffff || v >= fillRgb.length) {
      data[o + 3] = 0
      continue
    }
    const c = fillRgb[v]
    data[o] = c.r
    data[o + 1] = c.g
    data[o + 2] = c.b
    data[o + 3] = 255
  }
  return { width: w, height: h, data }
}

function nearestNeighborScale(
  src: { width: number; height: number; data: Uint8ClampedArray },
  w: number,
  h: number,
  scale: number,
): { width: number; height: number; data: Uint8ClampedArray } {
  const tw = w * scale
  const th = h * scale
  const data = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < th; y++) {
    const sy = (y / scale) | 0
    for (let x = 0; x < tw; x++) {
      const sx = (x / scale) | 0
      const si = (sy * w + sx) * 4
      const di = (y * tw + x) * 4
      data[di] = src.data[si]
      data[di + 1] = src.data[si + 1]
      data[di + 2] = src.data[si + 2]
      data[di + 3] = src.data[si + 3]
    }
  }
  return { width: tw, height: th, data }
}

function approxPathArea(segments: Seg[]): number {
  if (!segments.length) return 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of segments) {
    for (const [x, y] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
      [s.x3 ?? s.x2, s.y3 ?? s.y2],
    ] as const) {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  return Math.max(0, maxX - minX) * Math.max(0, maxY - minY)
}

function scaleSegs(segments: Seg[], s: number): Seg[] {
  if (s === 1) return segments
  return segments.map((seg) => ({
    type: seg.type,
    x1: seg.x1 * s,
    y1: seg.y1 * s,
    x2: seg.x2 * s,
    y2: seg.y2 * s,
    ...(seg.x3 != null && seg.y3 != null
      ? { x3: seg.x3 * s, y3: seg.y3 * s }
      : {}),
  }))
}

/**
 * Turn zig-zag L L L stair segments into quadratic curves through midpoints.
 * This is the visible difference between "traced pixels" and "drawn vectors".
 */
function promoteCollinearToCurves(segments: Seg[]): Seg[] {
  if (segments.length < 3) return segments
  const out: Seg[] = []
  let i = 0
  while (i < segments.length) {
    const s = segments[i]
    // Already a curve — keep
    if (s.x3 != null) {
      out.push(s)
      i++
      continue
    }

    // Gather a run of short line segments
    const run: Seg[] = [s]
    let j = i + 1
    while (j < segments.length && segments[j].x3 == null) {
      run.push(segments[j])
      j++
      if (run.length >= 12) break
    }

    if (run.length >= 3) {
      // Fit successive Q curves through every other point
      let x0 = run[0].x1
      let y0 = run[0].y1
      for (let k = 0; k < run.length; ) {
        if (k + 2 < run.length) {
          const mid = run[k]
          const end = run[k + 1]
          const end2 = run[k + 2]
          out.push({
            type: 'Q',
            x1: x0,
            y1: y0,
            x2: mid.x2,
            y2: mid.y2,
            x3: end2.x2,
            y3: end2.y2,
          })
          x0 = end2.x2
          y0 = end2.y2
          k += 3
          void end
        } else if (k + 1 < run.length) {
          const mid = run[k]
          const end = run[k + 1]
          out.push({
            type: 'Q',
            x1: x0,
            y1: y0,
            x2: mid.x2,
            y2: mid.y2,
            x3: end.x2,
            y3: end.y2,
          })
          x0 = end.x2
          y0 = end.y2
          k += 2
        } else {
          out.push({
            type: 'L',
            x1: x0,
            y1: y0,
            x2: run[k].x2,
            y2: run[k].y2,
          })
          k++
        }
      }
      i = j
      continue
    }

    out.push(s)
    i++
  }
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function segmentPath(segments: Seg[], reverse = false): string {
  if (!segments.length) return ''

  if (!reverse) {
    let d = `M ${round2(segments[0].x1)} ${round2(segments[0].y1)}`
    for (const s of segments) {
      if (s.x3 != null && s.y3 != null) {
        d += ` Q ${round2(s.x2)} ${round2(s.y2)} ${round2(s.x3)} ${round2(s.y3)}`
      } else {
        d += ` L ${round2(s.x2)} ${round2(s.y2)}`
      }
    }
    return d + ' Z'
  }

  const last = segments[segments.length - 1]
  const startX = last.x3 != null ? last.x3 : last.x2
  const startY = last.y3 != null ? last.y3 : last.y2
  let d = `M ${round2(startX)} ${round2(startY)}`
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i]
    if (s.x3 != null && s.y3 != null) {
      d += ` Q ${round2(s.x2)} ${round2(s.y2)} ${round2(s.x1)} ${round2(s.y1)}`
    } else {
      d += ` L ${round2(s.x1)} ${round2(s.y1)}`
    }
  }
  return d + ' Z'
}
