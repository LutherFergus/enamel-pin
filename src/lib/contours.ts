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

/** Join outer + hole rings into one evenodd path `d`. */
export function ringsToSvgD(rings: Point[][]): string {
  return rings
    .map((ring) => pathToSvgD(ring, true))
    .filter(Boolean)
    .join(' ')
}

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}
