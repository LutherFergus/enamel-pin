/**
 * Clean quantized label maps so vector tracing sees drawn shapes,
 * not single-pixel stair-steps from the raster.
 */

/** Majority filter that only changes boundary pixels (preserves fill interiors). */
export function smoothLabelBoundaries(
  labels: Uint16Array,
  width: number,
  height: number,
  passes = 2,
): Uint16Array {
  let current = labels
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint16Array(current)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        const self = current[i]
        if (self === 0xffff) continue

        // Only touch pixels that already sit on a color boundary.
        let boundary = false
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const n = current[(y + dy) * width + (x + dx)]
          if (n !== self) {
            boundary = true
            break
          }
        }
        if (!boundary) continue

        const counts = new Map<number, number>()
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const v = current[(y + dy) * width + (x + dx)]
            if (v === 0xffff) continue
            counts.set(v, (counts.get(v) ?? 0) + 1)
          }
        }
        let best = self
        let bestCount = -1
        for (const [label, count] of counts) {
          if (count > bestCount) {
            bestCount = count
            best = label
          }
        }
        // Require a clear majority so accents don't get eaten.
        if (best !== self && bestCount >= 5) next[i] = best
      }
    }
    current = next
  }
  return current
}

/**
 * Drop tiny islands that become speck paths in the SVG.
 * Transparent (0xffff) is never reassigned.
 */
export function dropSpeckIslands(
  labels: Uint16Array,
  width: number,
  height: number,
  minArea: number,
): Uint16Array {
  const seen = new Uint8Array(width * height)
  const out = new Uint16Array(labels)

  for (let i = 0; i < width * height; i++) {
    if (seen[i] || labels[i] === 0xffff) continue
    const color = labels[i]
    const stack = [i]
    seen[i] = 1
    const comp: number[] = []
    const borderVotes = new Map<number, number>()

    while (stack.length) {
      const cur = stack.pop()!
      comp.push(cur)
      const x = cur % width
      const y = (cur / width) | 0
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
        const v = labels[ni]
        if (v === color) {
          if (!seen[ni]) {
            seen[ni] = 1
            stack.push(ni)
          }
        } else if (v !== 0xffff) {
          borderVotes.set(v, (borderVotes.get(v) ?? 0) + 1)
        }
      }
    }

    if (comp.length >= minArea) continue

    let replace = 0xffff
    let best = -1
    for (const [label, votes] of borderVotes) {
      if (votes > best) {
        best = votes
        replace = label
      }
    }
    for (const p of comp) out[p] = replace
  }

  return out
}

/**
 * Grow each opaque region 1px into neighboring opaque colors.
 * Creates intentional overlap so traced fills share an edge (no hairline gaps).
 * Does not expand into transparency (keeps silhouette clean).
 */
export function overlapAdjacentFills(
  labels: Uint16Array,
  width: number,
  height: number,
  opts: { minVotes?: number } = {},
): Uint16Array {
  const minVotes = Math.max(1, opts.minVotes ?? 2)
  const out = new Uint16Array(labels)
  const claims = new Map<number, Map<number, number>>() // pixel → color → votes

  const vote = (i: number, color: number) => {
    let m = claims.get(i)
    if (!m) {
      m = new Map()
      claims.set(i, m)
    }
    m.set(color, (m.get(color) ?? 0) + 1)
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const v = labels[i]
      if (v === 0xffff) continue
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
        const n = labels[ni]
        if (n === 0xffff || n === v) continue
        vote(ni, v)
      }
    }
  }

  for (const [i, votes] of claims) {
    // Keep existing color unless a neighbor strongly claims this pixel.
    const current = labels[i]
    let best = current
    let bestCount = votes.get(current) ?? 0
    for (const [color, count] of votes) {
      if (count > bestCount) {
        bestCount = count
        best = color
      }
    }
    if (best !== current && bestCount >= minVotes) out[i] = best
  }

  return out
}
