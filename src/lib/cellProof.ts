/**
 * Final enamel proof: flood each closed outline cell and fill it with the
 * dominant vector color sampled inside that cell. Clips spill past die-lines.
 */

import type { ColorVectorResult } from './colorVectorize'
import { scaleLabelsNearest } from './metalWalls'
import type { OutlineResult } from './outline'
import { loadOutlineInkMask } from './outline'
import { composeProofSvg, type ProofSvg } from './proofSvg'
import { labelsToSmoothSvg } from './traceSvg'
import type { PaletteColor, Rgb } from './types'

export type CellProofOptions = {
  smoothness: number
  pathomitScale?: number
}

export type CellProofResult = {
  proof: ProofSvg
  /** Cell-constrained fill SVG (same geometry as proof fills, no outline). */
  vectorSvg: string
  vectorBlob: Blob
  cellCount: number
}

/**
 * For every interior outline cell, pick the majority working-label color and
 * flood the whole cell. Trace fills, then stack the outline on top.
 */
export async function composeCellProof(
  outline: OutlineResult,
  vector: ColorVectorResult,
  opts: CellProofOptions,
): Promise<CellProofResult> {
  const { mask: ink, w, h } = await loadOutlineInkMask(outline)
  const labels = scaleLabelsNearest(
    vector.workingLabels,
    vector.widthPx,
    vector.heightPx,
    w,
    h,
  )

  const { cellLabels, cellCount } = floodCellsWithDominantColor(ink, labels, w, h)
  const fills = ensureFillRgb(vector)

  const metaByIndex = new Map<number, PaletteColor>()
  for (const c of vector.palette) {
    if (c.enabled === false) continue
    metaByIndex.set(c.index, c)
  }

  const { svg: fillSvg, pathCount } = labelsToSmoothSvg(
    cellLabels,
    fills,
    metaByIndex,
    {
      smoothness: opts.smoothness,
      widthPx: w,
      heightPx: h,
      pathomitScale: opts.pathomitScale ?? 1,
    },
  )

  const proof = composeProofSvg(fillSvg, outline.svg)
  const vectorBlob = new Blob([fillSvg], { type: 'image/svg+xml;charset=utf-8' })

  return {
    proof,
    vectorSvg: fillSvg,
    vectorBlob,
    cellCount: Math.max(cellCount, pathCount),
  }
}

function ensureFillRgb(vector: ColorVectorResult): Rgb[] {
  let maxIdx = vector.fillRgb.length - 1
  for (const c of vector.palette) {
    if (c.index > maxIdx) maxIdx = c.index
  }
  const fills: Rgb[] = Array.from({ length: Math.max(0, maxIdx) + 1 }, (_, i) => {
    return vector.fillRgb[i] ?? { r: 0, g: 0, b: 0 }
  })
  for (const c of vector.palette) {
    fills[c.index] = { r: c.r, g: c.g, b: c.b }
  }
  return fills
}

/**
 * Mark exterior (non-ink connected to the frame), then flood each interior
 * pocket and assign the majority vector label inside it.
 */
function floodCellsWithDominantColor(
  ink: Uint8Array,
  labels: Uint16Array,
  w: number,
  h: number,
): { cellLabels: Uint16Array; cellCount: number } {
  const n = w * h
  const exterior = new Uint8Array(n)
  const stack: number[] = []

  const tryPushExterior = (i: number) => {
    if (i < 0 || i >= n) return
    if (ink[i] || exterior[i]) return
    exterior[i] = 1
    stack.push(i)
  }

  for (let x = 0; x < w; x++) {
    tryPushExterior(x)
    tryPushExterior((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    tryPushExterior(y * w)
    tryPushExterior(y * w + (w - 1))
  }

  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i / w) | 0
    if (x > 0) tryPushExterior(i - 1)
    if (x + 1 < w) tryPushExterior(i + 1)
    if (y > 0) tryPushExterior(i - w)
    if (y + 1 < h) tryPushExterior(i + w)
  }

  const cellLabels = new Uint16Array(n)
  for (let i = 0; i < n; i++) cellLabels[i] = 0xffff

  const seen = new Uint8Array(n)
  let cellCount = 0

  for (let seed = 0; seed < n; seed++) {
    if (ink[seed] || exterior[seed] || seen[seed]) continue

    const cell: number[] = []
    const hist = new Map<number, number>()
    stack.length = 0
    stack.push(seed)
    seen[seed] = 1

    while (stack.length) {
      const i = stack.pop()!
      cell.push(i)
      const lab = labels[i]
      if (lab !== 0xffff) {
        hist.set(lab, (hist.get(lab) ?? 0) + 1)
      }
      const x = i % w
      const y = (i / w) | 0
      const neighbors = [
        x > 0 ? i - 1 : -1,
        x + 1 < w ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y + 1 < h ? i + w : -1,
      ]
      for (const ni of neighbors) {
        if (ni < 0) continue
        if (ink[ni] || exterior[ni] || seen[ni]) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }

    let best = 0xffff
    let bestN = 0
    for (const [lab, count] of hist) {
      if (count > bestN) {
        bestN = count
        best = lab
      }
    }
    if (best === 0xffff || bestN === 0) continue

    cellCount++
    for (const i of cell) cellLabels[i] = best
  }

  return { cellLabels, cellCount }
}
