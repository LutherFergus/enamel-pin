/**
 * After quantization: keep solid black enamel (bodice, backdrop) but clear
 * thin black linework so the outline plate owns metal walls.
 *
 * Punching ALL near-black made faceless vectors; keeping ALL black turned
 * ink strokes into fat fills that ate faces/hair. Thickness test fixes both.
 */
export function punchThinBlackInk(
  labels: Uint16Array,
  palette: Array<{ r: number; g: number; b: number }>,
  width: number,
  height: number,
): Uint16Array {
  const blackIdx = new Set<number>()
  for (let c = 0; c < palette.length; c++) {
    const p = palette[c]
    const L = 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b
    const ch = Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b)
    if (L <= 42 && ch < 36) blackIdx.add(c)
  }
  if (!blackIdx.size) return labels

  const n = width * height
  const out = new Uint16Array(labels)
  const seen = new Uint8Array(n)
  // Regions larger than this are solid enamel even if somewhat thin in places.
  const solidMin = Math.max(180, Math.round(n * 0.00035))

  for (let i = 0; i < n; i++) {
    if (seen[i] || !blackIdx.has(labels[i])) continue
    const stack = [i]
    seen[i] = 1
    const comp: number[] = []
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
        if (seen[ni] || !blackIdx.has(labels[ni])) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }

    if (comp.length >= solidMin) continue

    // Stroke-like if one erosion removes most of the component.
    const inComp = new Uint8Array(n)
    for (const p of comp) inComp[p] = 1
    let core = 0
    for (const p of comp) {
      const x = p % width
      const y = (p / width) | 0
      let interior = true
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const nx = x + dx
        const ny = y + dy
        if (
          nx < 0 ||
          ny < 0 ||
          nx >= width ||
          ny >= height ||
          !inComp[ny * width + nx]
        ) {
          interior = false
          break
        }
      }
      if (interior) core++
    }
    // Thin ink: little/no morphological core relative to area.
    if (core <= Math.max(4, comp.length * 0.18)) {
      for (const p of comp) out[p] = 0xffff
    }
  }

  return out
}
