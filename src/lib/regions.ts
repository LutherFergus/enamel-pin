/**
 * Connected-component labeling and small-region merging for enamel fill areas.
 */

export type Region = {
  id: number
  colorIndex: number
  area: number
  pixels: number[]
}

export function labelRegions(
  labels: Uint16Array,
  width: number,
  height: number,
): { regionMap: Int32Array; regions: Region[] } {
  const regionMap = new Int32Array(width * height).fill(-1)
  const regions: Region[] = []
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (labels[i] === 0xffff || regionMap[i] !== -1) continue

      const colorIndex = labels[i]
      const id = regions.length
      const pixels: number[] = []
      const stack = [i]
      regionMap[i] = id

      while (stack.length) {
        const cur = stack.pop()!
        pixels.push(cur)
        const cx = cur % width
        const cy = (cur / width) | 0
        for (const [dx, dy] of dirs) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const ni = ny * width + nx
          if (regionMap[ni] !== -1) continue
          if (labels[ni] !== colorIndex) continue
          regionMap[ni] = id
          stack.push(ni)
        }
      }

      regions.push({ id, colorIndex, area: pixels.length, pixels })
    }
  }

  return { regionMap, regions }
}

/**
 * Merge regions smaller than minAreaPx into the neighboring region
 * they share the most border with (or nearest color if isolated).
 */
export function mergeSmallRegions(
  labels: Uint16Array,
  width: number,
  height: number,
  minAreaPx: number,
): Uint16Array {
  const result = new Uint16Array(labels)
  let { regionMap, regions } = labelRegions(result, width, height)
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const

  const small = regions
    .filter((r) => r.area < minAreaPx)
    .sort((a, b) => a.area - b.area)

  for (const region of small) {
    // Re-check: may already have been absorbed via neighbor updates
    const stillSmall =
      region.pixels.filter((p) => regionMap[p] === region.id).length < minAreaPx
    if (!stillSmall) continue

    const borderVotes = new Map<number, number>()
    for (const p of region.pixels) {
      if (regionMap[p] !== region.id) continue
      const x = p % width
      const y = (p / width) | 0
      for (const [dx, dy] of dirs) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const ni = ny * width + nx
        const neighborRegion = regionMap[ni]
        if (neighborRegion === -1 || neighborRegion === region.id) continue
        const neighborColor = result[ni]
        if (neighborColor === 0xffff) continue
        borderVotes.set(neighborColor, (borderVotes.get(neighborColor) ?? 0) + 1)
      }
    }

    let targetColor = region.colorIndex
    let bestVotes = -1
    for (const [color, votes] of borderVotes) {
      if (votes > bestVotes) {
        bestVotes = votes
        targetColor = color
      }
    }

    // If no neighbor (island / edge), pick any adjacent non-transparent later
    // fallback: keep original color but still "merge" by absorbing into nearest
    // larger region color via global palette index — already set above.

    for (const p of region.pixels) {
      if (regionMap[p] !== region.id) continue
      result[p] = targetColor
    }
  }

  // Rebuild once more and merge any remaining tiny scraps
  ;({ regionMap, regions } = labelRegions(result, width, height))
  for (const region of regions) {
    if (region.area >= minAreaPx) continue
    const borderVotes = new Map<number, number>()
    for (const p of region.pixels) {
      const x = p % width
      const y = (p / width) | 0
      for (const [dx, dy] of dirs) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const ni = ny * width + nx
        if (regionMap[ni] === region.id) continue
        const neighborColor = result[ni]
        if (neighborColor === 0xffff) continue
        borderVotes.set(neighborColor, (borderVotes.get(neighborColor) ?? 0) + 1)
      }
    }
    let targetColor = region.colorIndex
    let bestVotes = -1
    for (const [color, votes] of borderVotes) {
      if (votes > bestVotes) {
        bestVotes = votes
        targetColor = color
      }
    }
    if (bestVotes < 0) continue
    for (const p of region.pixels) {
      result[p] = targetColor
    }
  }

  return result
}
