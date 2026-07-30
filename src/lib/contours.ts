/**
 * Pixel-edge contour tracing for quantized label maps / ink masks.
 * Returns closed rings as point lists in pixel-corner space.
 */

export type Point = { x: number; y: number }

function inBounds(x: number, y: number, w: number, h: number): boolean {
  return x >= 0 && y >= 0 && x < w && y < h
}

function isForeground(
  labels: Uint16Array,
  width: number,
  height: number,
  x: number,
  y: number,
  colorIndex: number,
): boolean {
  if (!inBounds(x, y, width, height)) return false
  return labels[y * width + x] === colorIndex
}

/**
 * Extract contours for each color's connected components.
 * Returns Map<colorIndex, components> where each component is
 * Point[][] = [outerRing, ...holes] for even-odd SVG fills.
 */
export function extractColorContours(
  labels: Uint16Array,
  width: number,
  height: number,
  minArea = 24,
): Map<number, Point[][][]> {
  const contoursByColor = new Map<number, Point[][][]>()
  const visited = new Uint8Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const color = labels[i]
      if (color === 0xffff || visited[i]) continue

      const stack = [i]
      visited[i] = 1
      const component: number[] = []
      while (stack.length) {
        const cur = stack.pop()!
        component.push(cur)
        const cx = cur % width
        const cy = (cur / width) | 0
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = cx + dx
          const ny = cy + dy
          if (!inBounds(nx, ny, width, height)) continue
          const ni = ny * width + nx
          if (visited[ni] || labels[ni] !== color) continue
          visited[ni] = 1
          stack.push(ni)
        }
      }

      if (component.length < minArea) continue

      const rings = ringsFromComponent(component, labels, width, height, color)
      if (!rings.length) continue

      const list = contoursByColor.get(color) ?? []
      list.push(rings)
      contoursByColor.set(color, list)
    }
  }

  return contoursByColor
}

/**
 * Build all closed rings (outer + holes) by chaining unit edges around ink/fill.
 */
function ringsFromComponent(
  component: number[],
  labels: Uint16Array,
  width: number,
  height: number,
  color: number,
): Point[][] {
  const outs = new Map<string, string[]>()
  const addEdge = (x1: number, y1: number, x2: number, y2: number) => {
    const a = `${x1},${y1}`
    const b = `${x2},${y2}`
    const list = outs.get(a)
    if (list) list.push(b)
    else outs.set(a, [b])
  }

  for (const p of component) {
    const x = p % width
    const y = (p / width) | 0
    if (!isForeground(labels, width, height, x, y - 1, color)) addEdge(x, y, x + 1, y)
    if (!isForeground(labels, width, height, x + 1, y, color)) addEdge(x + 1, y, x + 1, y + 1)
    if (!isForeground(labels, width, height, x, y + 1, color)) addEdge(x + 1, y + 1, x, y + 1)
    if (!isForeground(labels, width, height, x - 1, y, color)) addEdge(x, y + 1, x, y)
  }

  if (outs.size === 0) return []

  const unused = new Map<string, string[]>()
  for (const [k, v] of outs) unused.set(k, [...v])

  const rings: Point[][] = []
  while (unused.size) {
    const start = unused.keys().next().value as string
    const ring: Point[] = []
    let cur = start
    let guard = 0
    const maxGuard = width * height * 4

    while (guard++ < maxGuard) {
      const [sx, sy] = cur.split(',').map(Number)
      ring.push({ x: sx, y: sy })
      const nexts = unused.get(cur)
      if (!nexts || nexts.length === 0) {
        unused.delete(cur)
        break
      }
      const next = nexts.pop()!
      if (nexts.length === 0) unused.delete(cur)
      cur = next
      if (cur === start) break
    }

    if (ring.length >= 4) rings.push(ring)
  }

  rings.sort((a, b) => b.length - a.length)
  return rings
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
  for (let iter = 0; iter < iterations; iter++) {
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
  const [first, ...rest] = points
  let d = `M ${fmt(first.x)} ${fmt(first.y)}`
  for (const p of rest) {
    d += ` L ${fmt(p.x)} ${fmt(p.y)}`
  }
  if (closed) d += ' Z'
  return d
}

/** Drop consecutive duplicates and collapse pure collinear runs. */
export function collapseCollinear(points: Point[], closed = true): Point[] {
  if (points.length < 3) return points
  const pts: Point[] = []
  for (const p of points) {
    const prev = pts[pts.length - 1]
    if (prev && prev.x === p.x && prev.y === p.y) continue
    pts.push(p)
  }
  if (pts.length < 3) return pts

  const out: Point[] = []
  const n = pts.length
  const at = (i: number) => pts[((i % n) + n) % n]
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(pts[i])
      continue
    }
    const a = at(i - 1)
    const b = at(i)
    const c = at(i + 1)
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)
    // Keep corners and direction changes; drop near-collinear midpoints.
    if (Math.abs(cross) > 0.35 || dot < 0) out.push(b)
  }
  return out.length >= 3 ? out : pts
}

function turnAngle(a: Point, b: Point, c: Point): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const bcx = c.x - b.x
  const bcy = c.y - b.y
  const lab = Math.hypot(abx, aby) || 1
  const lbc = Math.hypot(bcx, bcy) || 1
  const dot = (abx * bcx + aby * bcy) / (lab * lbc)
  return Math.acos(Math.max(-1, Math.min(1, dot)))
}

/**
 * Collapse raster stair-steps (unit orthognal zigzags) into diagonals.
 * Keeps real long edges / sharp enamel corners intact.
 */
export function destairPath(points: Point[], closed = true): Point[] {
  if (points.length < 4) return points
  const pts: Point[] = []
  for (const p of points) {
    const prev = pts[pts.length - 1]
    if (prev && prev.x === p.x && prev.y === p.y) continue
    pts.push(p)
  }
  if (pts.length < 4) return pts

  const n = pts.length
  const keep = new Array<boolean>(n).fill(true)
  const at = (i: number) => pts[((i % n) + n) % n]

  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue
    const a = at(i - 1)
    const b = at(i)
    const c = at(i + 1)
    const dIn = Math.hypot(b.x - a.x, b.y - a.y)
    const dOut = Math.hypot(c.x - b.x, c.y - b.y)
    // Any axis-aligned ~90° stair with a ≤2px riser (tread may be longer).
    if (Math.min(dIn, dOut) > 2.05) continue
    const axisIn = Math.abs(b.x - a.x) < 0.01 || Math.abs(b.y - a.y) < 0.01
    const axisOut = Math.abs(c.x - b.x) < 0.01 || Math.abs(c.y - b.y) < 0.01
    if (!axisIn || !axisOut) continue
    const turn = turnAngle(a, b, c)
    if (Math.abs(turn - Math.PI / 2) < 0.4) keep[i] = false
  }

  const out = pts.filter((_, i) => keep[i])
  return out.length >= 3 ? out : pts
}

/**
 * Corner-preserving cubic Bézier path that visits EVERY vertex.
 * Uses Catmull–Rom→cubic conversion (low tension) so curves follow the
 * contour instead of leaping chord-to-chord across skipped midpoints.
 * Sharp enamel corners stay as hard line joins.
 */
export function pathToSmoothSvgD(
  points: Point[],
  closed = true,
  cornerAngleDeg = 52,
): string {
  if (points.length === 0) return ''
  let pts = destairPath(points, closed)
  pts = collapseCollinear(pts, closed)
  if (pts.length < 3) return pathToSvgD(pts, closed)

  const n = pts.length
  const cornerThresh = (cornerAngleDeg * Math.PI) / 180
  const isCorner = new Array<boolean>(n).fill(false)
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      isCorner[i] = true
      continue
    }
    const a = pts[(i - 1 + n) % n]
    const b = pts[i]
    const c = pts[(i + 1) % n]
    const turn = turnAngle(a, b, c)
    if (turn <= cornerThresh) continue
    const lenIn = Math.hypot(b.x - a.x, b.y - a.y)
    const lenOut = Math.hypot(c.x - b.x, c.y - b.y)
    const axisIn = Math.abs(b.x - a.x) < 0.01 || Math.abs(b.y - a.y) < 0.01
    const axisOut = Math.abs(c.x - b.x) < 0.01 || Math.abs(c.y - b.y) < 0.01
    // Axis-aligned ~90° with a short riser (≤2px) = raster stair on a diagonal —
    // never a hard enamel corner. Let Catmull–Rom curve through it.
    if (
      axisIn &&
      axisOut &&
      Math.abs(turn - Math.PI / 2) < 0.45 &&
      Math.min(lenIn, lenOut) <= 2.05
    ) {
      continue
    }
    isCorner[i] = true
  }

  // Tension < 1 softens handles; /6 is classic CR — smoother than /8 on destaired paths.
  const tension = 1 / 6

  const at = (i: number) => pts[((i % n) + n) % n]
  let d = `M ${fmt(pts[0].x)} ${fmt(pts[0].y)}`
  const segCount = closed ? n : n - 1

  for (let i = 0; i < segCount; i++) {
    const p0 = at(i - 1)
    const p1 = at(i)
    const p2 = at(i + 1)
    const p3 = at(i + 2)

    // Hard corner at either endpoint → straight segment (preserve stars / box).
    if (isCorner[i % n] || isCorner[(i + 1) % n]) {
      d += ` L ${fmt(p2.x)} ${fmt(p2.y)}`
      continue
    }

    const c1 = {
      x: p1.x + (p2.x - p0.x) * tension,
      y: p1.y + (p2.y - p0.y) * tension,
    }
    const c2 = {
      x: p2.x - (p3.x - p1.x) * tension,
      y: p2.y - (p3.y - p1.y) * tension,
    }
    d += ` C ${fmt(c1.x)} ${fmt(c1.y)} ${fmt(c2.x)} ${fmt(c2.y)} ${fmt(p2.x)} ${fmt(p2.y)}`
  }

  if (closed) d += ' Z'
  return d
}

/** Join outer + hole rings into one evenodd path `d`. */
export function ringsToSvgD(
  rings: Point[][],
  smooth = false,
  cornerAngleDeg = 52,
): string {
  return rings
    .map((ring) =>
      smooth ? pathToSmoothSvgD(ring, true, cornerAngleDeg) : pathToSvgD(ring, true),
    )
    .filter(Boolean)
    .join(' ')
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}
