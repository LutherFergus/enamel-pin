/**
 * Knock out solid product-photo backdrops so they don't steal majority
 * palette slots or invent outline noise.
 */
export function knockOutSolidBackground(imageData: ImageData): void {
  const { data, width, height } = imageData
  const samples = sampleCorners(data, width, height)
  if (samples.length < 2) return

  const avg = {
    r: Math.round(samples.reduce((s, c) => s + c.r, 0) / samples.length),
    g: Math.round(samples.reduce((s, c) => s + c.g, 0) / samples.length),
    b: Math.round(samples.reduce((s, c) => s + c.b, 0) / samples.length),
  }

  const isLight = avg.r > 230 && avg.g > 230 && avg.b > 230
  const isDark = avg.r < 28 && avg.g < 28 && avg.b < 28
  if (!isLight && !isDark) return

  // Flood from edges through pixels similar to the backdrop.
  const visited = new Uint8Array(width * height)
  const stack: number[] = []
  const pushEdge = (x: number, y: number) => {
    const i = y * width + x
    if (visited[i]) return
    if (!isBackdrop(data, i * 4, avg, isLight)) return
    visited[i] = 1
    stack.push(i)
  }

  for (let x = 0; x < width; x++) {
    pushEdge(x, 0)
    pushEdge(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    pushEdge(0, y)
    pushEdge(width - 1, y)
  }

  while (stack.length) {
    const i = stack.pop()!
    const o = i * 4
    data[o + 3] = 0
    const x = i % width
    const y = (i / width) | 0
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const ni = ny * width + nx
      if (visited[ni]) continue
      if (!isBackdrop(data, ni * 4, avg, isLight)) continue
      visited[ni] = 1
      stack.push(ni)
    }
  }
}

function sampleCorners(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Array<{ r: number; g: number; b: number }> {
  const pts = [
    [2, 2],
    [width - 3, 2],
    [2, height - 3],
    [width - 3, height - 3],
    [width >> 1, 2],
    [2, height >> 1],
  ]
  const out: Array<{ r: number; g: number; b: number }> = []
  for (const [x, y] of pts) {
    const o = (y * width + x) * 4
    if (data[o + 3] < 16) continue
    out.push({ r: data[o], g: data[o + 1], b: data[o + 2] })
  }
  return out
}

function isBackdrop(
  data: Uint8ClampedArray,
  o: number,
  avg: { r: number; g: number; b: number },
  isLight: boolean,
): boolean {
  if (data[o + 3] < 16) return true
  const r = data[o]
  const g = data[o + 1]
  const b = data[o + 2]
  if (isLight) {
    return r >= 238 && g >= 238 && b >= 238
  }
  // Dark backdrop: near-black flat fields only. Skip pixels next to much
  // lighter neighbors so black metal walls / ink don't get flood-eaten.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  if (lum > 36) return false
  const dr = r - avg.r
  const dg = g - avg.g
  const db = b - avg.b
  if (dr * dr + dg * dg + db * db >= 40 * 40) return false
  return true
}
