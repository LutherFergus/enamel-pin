/**
 * Stack fill SVG + black outline die-lines into one Proof SVG.
 * Used after cell-dominant fills are built (or as a lightweight placeholder).
 */

export type ProofSvg = {
  svg: string
  svgBlob: Blob
  svgUrl: string
}

type SvgBox = {
  vbX: number
  vbY: number
  vbW: number
  vbH: number
  inner: string
}

function parseViewBox(svg: string): { x: number; y: number; w: number; h: number } {
  const m = svg.match(/viewBox\s*=\s*"([^"]+)"/i)
  if (m) {
    const parts = m[1]
      .trim()
      .split(/[\s,]+/)
      .map(Number)
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] }
    }
  }
  const w = Number((svg.match(/\bwidth="([\d.]+)"/i) || [])[1])
  const h = Number((svg.match(/\bheight="([\d.]+)"/i) || [])[1])
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { x: 0, y: 0, w, h }
  }
  return { x: 0, y: 0, w: 1000, h: 1000 }
}

function extractInner(svg: string): string {
  const cleaned = svg
    .replace(/<\?xml[^>]*>/gi, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
  const open = cleaned.match(/<svg\b[^>]*>/i)
  if (!open || open.index == null) return cleaned
  const start = open.index + open[0].length
  const close = cleaned.lastIndexOf('</svg>')
  if (close < start) return cleaned.slice(start)
  return cleaned.slice(start, close).trim()
}

function parseSvg(svg: string): SvgBox {
  const vb = parseViewBox(svg)
  return {
    vbX: vb.x,
    vbY: vb.y,
    vbW: vb.w,
    vbH: vb.h,
    inner: extractInner(svg),
  }
}

/**
 * Build a single downloadable Proof SVG: vector fills + outline walls.
 * Scales layers into a shared viewBox when outline/vector sizes differ.
 */
export function composeProofSvg(vectorSvg: string, outlineSvg: string): ProofSvg {
  const vector = parseSvg(vectorSvg)
  const outline = parseSvg(outlineSvg)

  // Prefer vector canvas as the proof frame (color plate size).
  const vbW = vector.vbW || outline.vbW
  const vbH = vector.vbH || outline.vbH

  const ox = vbW / (outline.vbW || vbW)
  const oy = vbH / (outline.vbH || vbH)
  const outlineNeedsScale =
    Math.abs(ox - 1) > 0.001 ||
    Math.abs(oy - 1) > 0.001 ||
    outline.vbX !== 0 ||
    outline.vbY !== 0

  const outlineLayer = outlineNeedsScale
    ? `<g id="proof-outline" transform="translate(${-outline.vbX * ox} ${-outline.vbY * oy}) scale(${ox} ${oy})">${outline.inner}</g>`
    : `<g id="proof-outline">${outline.inner}</g>`

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" width="${vbW}" height="${vbH}" shape-rendering="geometricPrecision">`,
    `<!-- Pin proof · color vector fills + #000000 outline die-lines -->`,
    `<g id="proof-vector">${vector.inner}</g>`,
    outlineLayer,
    `</svg>`,
  ].join('\n')

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  return {
    svg,
    svgBlob,
    svgUrl: URL.createObjectURL(svgBlob),
  }
}

export function revokeProof(proof: ProofSvg | null | undefined) {
  if (proof?.svgUrl) URL.revokeObjectURL(proof.svgUrl)
}
