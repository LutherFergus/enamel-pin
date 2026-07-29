/**
 * Moore neighborhood contour tracing for quantized label maps.
 * Returns closed rings as point lists in pixel space (pixel centers).
 */

export type Point = { x: number; y: number }

const NEIGHBORS: Point[] = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
]

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
 * Trace outer contour of a connected region starting at a boundary pixel.
 * Uses Moore neighborhood (clockwise).
 */
function traceContour(
  labels: Uint16Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
  colorIndex: number,
  visitedEdge: Uint8Array,
): Point[] | null {
  const startIdx = startY * width + startX
  if (visitedEdge[startIdx]) return null

  const path: Point[] = []
  let x = startX
  let y = startY
  // Entered from the left — start looking from north-west relative to entry
  let dir = 0 // index into NEIGHBORS: facing right initially after finding left border

  // Find initial direction: we were scanning L→R, so backtrack from west
  for (let d = 0; d < 8; d++) {
    const nx = x + NEIGHBORS[d].x
    const ny = y + NEIGHBORS[d].y
    if (!isForeground(labels, width, height, nx, ny, colorIndex)) {
      dir = (d + 1) % 8
      break
    }
  }

  const maxSteps = width * height * 2
  let steps = 0

  do {
    path.push({ x: x + 0.5, y: y + 0.5 })
    visitedEdge[y * width + x] = 1

    // Look for next boundary pixel starting from dir-1 (backtrack one)
    let found = false
    const startDir = (dir + 6) % 8 // turn left relative to previous move
    for (let i = 0; i < 8; i++) {
      const d = (startDir + i) % 8
      const nx = x + NEIGHBORS[d].x
      const ny = y + NEIGHBORS[d].y
      if (isForeground(labels, width, height, nx, ny, colorIndex)) {
        x = nx
        y = ny
        dir = d
        found = true
        break
      }
    }
    if (!found) break
    steps++
  } while ((x !== startX || y !== startY) && steps < maxSteps)

  if (path.length < 3) return null
  return path
}

/**
 * Extract simplified outer contours for each color index present.
 * One contour per connected component (outer only for MVP fills).
 */
export function extractColorContours(
  labels: Uint16Array,
  width: number,
  height: number,
): Map<number, Point[][]> {
  const contoursByColor = new Map<number, Point[][]>()
  const visited = new Uint8Array(width * height)
  const colorVisited = new Map<number, Uint8Array>()

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const color = labels[i]
      if (color === 0xffff || visited[i]) continue

      // Flood to mark connected component, collect boundary starts
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

      // Find leftmost-topmost pixel that has a non-color neighbor (boundary)
      let startX = -1
      let startY = -1
      let best = Infinity
      for (const p of component) {
        const px = p % width
        const py = (p / width) | 0
        const key = py * width + px
        let boundary = false
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          if (!isForeground(labels, width, height, px + dx, py + dy, color)) {
            boundary = true
            break
          }
        }
        if (!boundary) continue
        if (key < best) {
          best = key
          startX = px
          startY = py
        }
      }

      if (startX < 0) continue

      if (!colorVisited.has(color)) {
        colorVisited.set(color, new Uint8Array(width * height))
      }
      const edgeVisited = colorVisited.get(color)!
      const contour = traceContour(
        labels,
        width,
        height,
        startX,
        startY,
        color,
        edgeVisited,
      )
      if (!contour) continue

      const list = contoursByColor.get(color) ?? []
      list.push(contour)
      contoursByColor.set(color, list)
    }
  }

  return contoursByColor
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
    // Treat as closed ring
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

function fmt(n: number): string {
  return (Math.round(n * 100) / 100).toString()
}
