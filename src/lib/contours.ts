/**
 * Convert a quantized label map into closed SVG path rings.
 * Uses horizontal run-length encoding + vertical rectangle merge —
 * reliable for enamel fills (no fragile border-following).
 */

export type Point = { x: number; y: number }

type Rect = { x: number; y: number; w: number; h: number }

function rectsToPath(rects: Rect[]): Point[] {
  // Emit each rect as its own closed ring; caller joins with multiple subpaths.
  // For SVG we return a sentinel empty list when using multi-subpath helper.
  void rects
  return []
}

/** Build SVG path `d` with one subpath per merged rectangle. */
export function rectsToSvgD(rects: Rect[]): string {
  const parts: string[] = []
  for (const r of rects) {
    const x = r.x
    const y = r.y
    const x2 = r.x + r.w
    const y2 = r.y + r.h
    parts.push(`M ${x} ${y} L ${x2} ${y} L ${x2} ${y2} L ${x} ${y2} Z`)
  }
  return parts.join(' ')
}

/**
 * Scanline RLE → vertically merged rectangles per color index.
 */
export function extractColorContours(
  labels: Uint16Array,
  width: number,
  height: number,
): Map<number, Point[][]> {
  // Kept for API compatibility: returns rectangle corners as 4-point rings.
  const rectsByColor = extractColorRects(labels, width, height)
  const out = new Map<number, Point[][]>()
  for (const [color, rects] of rectsByColor) {
    out.set(
      color,
      rects.map((r) => [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
        { x: r.x, y: r.y + r.h },
      ]),
    )
  }
  return out
}

export function extractColorRects(
  labels: Uint16Array,
  width: number,
  height: number,
): Map<number, Rect[]> {
  const active = new Map<number, Rect[]>() // color → open rects on previous row
  const finished = new Map<number, Rect[]>()

  const pushFinished = (color: number, rect: Rect) => {
    const list = finished.get(color) ?? []
    list.push(rect)
    finished.set(color, list)
  }

  for (let y = 0; y < height; y++) {
    const rowRuns = new Map<number, Array<{ x: number; w: number }>>()

    let x = 0
    while (x < width) {
      const color = labels[y * width + x]
      if (color === 0xffff) {
        x++
        continue
      }
      const start = x
      x++
      while (x < width && labels[y * width + x] === color) x++
      const runs = rowRuns.get(color) ?? []
      runs.push({ x: start, w: x - start })
      rowRuns.set(color, runs)
    }

    // Colors that had open rects but no runs this row → close them.
    for (const [color, opens] of [...active.entries()]) {
      if (!rowRuns.has(color)) {
        for (const r of opens) pushFinished(color, r)
        active.delete(color)
      }
    }

    for (const [color, runs] of rowRuns) {
      const prev = active.get(color) ?? []
      const nextOpen: Rect[] = []
      const usedPrev = new Uint8Array(prev.length)

      for (const run of runs) {
        let merged = false
        for (let i = 0; i < prev.length; i++) {
          if (usedPrev[i]) continue
          const r = prev[i]
          if (r.x === run.x && r.w === run.w && r.y + r.h === y) {
            r.h += 1
            nextOpen.push(r)
            usedPrev[i] = 1
            merged = true
            break
          }
        }
        if (!merged) {
          nextOpen.push({ x: run.x, y, w: run.w, h: 1 })
        }
      }

      for (let i = 0; i < prev.length; i++) {
        if (!usedPrev[i]) pushFinished(color, prev[i])
      }
      active.set(color, nextOpen)
    }
  }

  for (const [color, opens] of active) {
    for (const r of opens) pushFinished(color, r)
  }

  return finished
}

/** Ramer–Douglas–Peucker simplification. */
export function simplifyPath(points: Point[], epsilon: number): Point[] {
  if (points.length < 3 || epsilon <= 0) return points

  const first = points[0]
  const last = points[points.length - 1]
  let maxDist = 0
  let index = 0

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last)
    if (d > maxDist) {
      maxDist = d
      index = i
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyPath(points.slice(0, index + 1), epsilon)
    const right = simplifyPath(points.slice(index), epsilon)
    return left.slice(0, -1).concat(right)
  }
  return [first, last]
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) {
    return Math.hypot(p.x - a.x, p.y - a.y)
  }
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

/** Chaikin corner-cutting for softer enamel-friendly curves. */
export function smoothPath(points: Point[], iterations: number): Point[] {
  let pts = points
  const iters = Math.min(2, Math.max(0, Math.round(iterations)))
  for (let iter = 0; iter < iters; iter++) {
    if (pts.length < 3) break
    const next: Point[] = []
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % n]
      next.push({
        x: 0.75 * a.x + 0.25 * b.x,
        y: 0.75 * a.y + 0.25 * b.y,
      })
      next.push({
        x: 0.25 * a.x + 0.75 * b.x,
        y: 0.25 * a.y + 0.75 * b.y,
      })
    }
    pts = next
  }
  return pts
}

export function pathToSvgD(points: Point[], closed = true): string {
  if (points.length === 0) return ''
  // Rectangle rings: skip Chaikin-smoothed nonsense — emit crisp corners.
  if (points.length === 4) {
    const [a, b, c, d] = points
    return `M ${fmt(a.x)} ${fmt(a.y)} L ${fmt(b.x)} ${fmt(b.y)} L ${fmt(c.x)} ${fmt(c.y)} L ${fmt(d.x)} ${fmt(d.y)} Z`
  }
  const [first, ...rest] = points
  let d = `M ${fmt(first.x)} ${fmt(first.y)}`
  for (const p of rest) {
    d += ` L ${fmt(p.x)} ${fmt(p.y)}`
  }
  if (closed) d += ' Z'
  return d
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}

// silence unused in case tree-shaken differently
void rectsToPath
void rectsToSvgD
