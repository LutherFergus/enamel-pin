/**
 * Bake Potrace's integer + transform paths into imaengine-style absolute
 * cubic coordinates in art pixel space (no group transform).
 */

type Pt = { x: number; y: number }

export type BakeTransform = {
  /** Potrace translate Y (usually bitmap height in its unit space). */
  translateY: number
  /** Potrace uniform scale (usually 0.1). */
  scale: number
  /** Supersample factor used when building the bitmap for Potrace. */
  superScale: number
}

/** Parse `translate(0,H) scale(S,-S)` from a Potrace group. */
export function parsePotraceTransform(attrs: string): BakeTransform | null {
  const tr = attrs.match(
    /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)\s*scale\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i,
  )
  if (!tr) return null
  return {
    translateY: Number(tr[2]),
    scale: Math.abs(Number(tr[3])),
    superScale: 1,
  }
}

function mapPoint(p: Pt, t: BakeTransform): Pt {
  // Potrace: (x,y) → (x*s, translateY + y*(-s)) in supersampled px
  // then ÷ superScale → art px
  const sx = p.x * t.scale
  const sy = t.translateY + p.y * -t.scale
  return { x: sx / t.superScale, y: sy / t.superScale }
}

function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000
  if (Object.is(r, -0)) return '0'
  return String(r)
}

/**
 * Convert a Potrace path `d` (relative/absolute mix, integer coords) into
 * absolute M/L/C commands in art pixel space.
 */
export function bakePotracePathD(d: string, t: BakeTransform): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g)
  if (!tokens?.length) return ''

  let i = 0
  let cmd = ''
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0
  const out: string[] = []

  const nextNum = (): number => {
    const v = Number(tokens[i++])
    return Number.isFinite(v) ? v : 0
  }

  while (i < tokens.length) {
    const tok = tokens[i]
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok
      i++
    } else if (!cmd) {
      break
    }

    switch (cmd) {
      case 'M': {
        cx = nextNum()
        cy = nextNum()
        startX = cx
        startY = cy
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`M${fmt(p.x)},${fmt(p.y)}`)
        cmd = 'L'
        break
      }
      case 'm': {
        cx += nextNum()
        cy += nextNum()
        startX = cx
        startY = cy
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`M${fmt(p.x)},${fmt(p.y)}`)
        cmd = 'l'
        break
      }
      case 'L': {
        cx = nextNum()
        cy = nextNum()
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`L${fmt(p.x)},${fmt(p.y)}`)
        break
      }
      case 'l': {
        cx += nextNum()
        cy += nextNum()
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`L${fmt(p.x)},${fmt(p.y)}`)
        break
      }
      case 'H': {
        cx = nextNum()
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`L${fmt(p.x)},${fmt(p.y)}`)
        break
      }
      case 'h': {
        cx += nextNum()
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`L${fmt(p.x)},${fmt(p.y)}`)
        break
      }
      case 'V': {
        cy = nextNum()
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`L${fmt(p.x)},${fmt(p.y)}`)
        break
      }
      case 'v': {
        cy += nextNum()
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`L${fmt(p.x)},${fmt(p.y)}`)
        break
      }
      case 'C': {
        const x1 = nextNum()
        const y1 = nextNum()
        const x2 = nextNum()
        const y2 = nextNum()
        cx = nextNum()
        cy = nextNum()
        const p1 = mapPoint({ x: x1, y: y1 }, t)
        const p2 = mapPoint({ x: x2, y: y2 }, t)
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(
          `C${fmt(p1.x)},${fmt(p1.y)} ${fmt(p2.x)},${fmt(p2.y)} ${fmt(p.x)},${fmt(p.y)}`,
        )
        break
      }
      case 'c': {
        const x1 = cx + nextNum()
        const y1 = cy + nextNum()
        const x2 = cx + nextNum()
        const y2 = cy + nextNum()
        cx += nextNum()
        cy += nextNum()
        const p1 = mapPoint({ x: x1, y: y1 }, t)
        const p2 = mapPoint({ x: x2, y: y2 }, t)
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(
          `C${fmt(p1.x)},${fmt(p1.y)} ${fmt(p2.x)},${fmt(p2.y)} ${fmt(p.x)},${fmt(p.y)}`,
        )
        break
      }
      case 'Z':
      case 'z': {
        out.push('Z')
        cx = startX
        cy = startY
        break
      }
      default:
        // Unsupported command — stop rather than emit garbage.
        return out.join('')
    }
  }

  return out.join('')
}

/** Extract all path `d` attributes from a Potrace SVG string. */
export function extractPotracePathDs(svg: string): {
  ds: string[]
  transform: BakeTransform | null
} {
  const gMatch = svg.match(/<g\b([^>]*)>/i)
  const transform = gMatch ? parsePotraceTransform(gMatch[1]) : null
  const ds = [...svg.matchAll(/\bd="([^"]*)"/gi)].map((m) => m[1])
  return { ds, transform }
}

/**
 * Restyle a Potrace SVG into a single absolute-cubic compound path
 * (imaengine outline style).
 */
export function bakeOutlineSvg(
  traced: string,
  artW: number,
  artH: number,
  superScale: number,
  inkHex: string,
): string {
  const { ds, transform } = extractPotracePathDs(traced)
  if (!ds.length || !transform) {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${artW} ${artH}" width="${artW}" height="${artH}" shape-rendering="geometricPrecision">`,
      `<!-- Transparent enamel die-line outline · baked cubics · no background -->`,
      `<g id="outline" fill="${inkHex}">`,
      `</g></svg>`,
    ].join('\n')
  }

  const t: BakeTransform = { ...transform, superScale }
  const baked = ds.map((d) => bakePotracePathD(d, t)).filter(Boolean)
  const compound = baked.join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${artW} ${artH}" width="${artW}" height="${artH}" shape-rendering="geometricPrecision">`,
    `<!-- Transparent enamel die-line outline · absolute cubics · no background -->`,
    `<g id="outline" fill="${inkHex}">`,
    `<path fill="${inkHex}" d="${compound}" />`,
    `</g></svg>`,
  ].join('\n')
}

/**
 * Bake one Potrace color layer into absolute-cubic path markups.
 * Optional matching stroke traps hairline seams (Final plate).
 */
export function bakeColorPaths(
  traced: string,
  superScale: number,
  fill: string,
  pmsAttr: string,
  seamStroke = 0,
): { markup: string; area: number; pathCount: number } {
  const { ds, transform } = extractPotracePathDs(traced)
  if (!ds.length || !transform) return { markup: '', area: 0, pathCount: 0 }

  const t: BakeTransform = { ...transform, superScale }
  const parts: string[] = []
  let area = 0
  const strokeAttrs =
    seamStroke > 0
      ? ` stroke="${fill}" stroke-width="${seamStroke.toFixed(2)}" stroke-linejoin="round" stroke-linecap="round" paint-order="stroke fill"`
      : ''

  for (const d of ds) {
    const baked = bakePotracePathD(d, t)
    if (!baked) continue
    parts.push(
      `<path fill="${fill}" fill-rule="evenodd"${strokeAttrs}${pmsAttr} d="${baked}" />`,
    )
    // Rough bbox area from absolute coords for z-order.
    const nums = baked.match(/-?\d+\.?\d*/g)?.map(Number) ?? []
    const xs: number[] = []
    const ys: number[] = []
    for (let i = 0; i + 1 < nums.length; i += 2) {
      xs.push(nums[i])
      ys.push(nums[i + 1])
    }
    if (xs.length) {
      area +=
        Math.max(0, Math.max(...xs) - Math.min(...xs)) *
        Math.max(0, Math.max(...ys) - Math.min(...ys))
    }
  }

  return {
    markup: parts.join('\n'),
    area: area || parts.length,
    pathCount: parts.length,
  }
}
