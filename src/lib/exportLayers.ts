import type { DualOutputResult } from './pipeline'

export type LayerExportFormat = 'psd' | 'tiff'

export type LayerExportInput = {
  sourceUrl: string | null
  result: DualOutputResult
  /** Max edge length for rasterized layers (default 2000). */
  maxDim?: number
}

type NamedCanvas = {
  name: string
  canvas: HTMLCanvasElement
}

/**
 * Rasterize each preview tab onto the same canvas size, then pack as:
 *  - PSD → real Photoshop layers (recommended)
 *  - TIFF → multipage TIFF (one page per tab; not Adobe layer TIFF)
 */
export async function exportTabLayers(
  input: LayerExportInput,
  format: LayerExportFormat,
): Promise<Blob> {
  const layers = await buildTabCanvases(input)
  if (!layers.length) {
    throw new Error('Nothing to export yet — process artwork first')
  }

  if (format === 'psd') return blobFromPsd(layers)
  return blobFromMultipageTiff(layers)
}

async function buildTabCanvases(input: LayerExportInput): Promise<NamedCanvas[]> {
  const { sourceUrl, result } = input
  const maxDim = Math.max(256, Math.min(4000, input.maxDim ?? 2000))
  const w = result.outline.widthPx
  const h = result.outline.heightPx
  const scale = Math.min(1, maxDim / Math.max(w, h))
  const tw = Math.max(1, Math.round(w * scale))
  const th = Math.max(1, Math.round(h * scale))

  const layers: NamedCanvas[] = []

  if (sourceUrl) {
    layers.push({
      name: 'Original',
      canvas: await rasterizeUrlToCanvas(sourceUrl, tw, th),
    })
  }

  if (!result.vectorPending && result.vector.palette.length > 0) {
    layers.push({
      name: 'Vector',
      canvas: await rasterizeSvgToCanvas(result.vector.svg, tw, th),
    })
  }

  layers.push({
    name: 'Outline',
    canvas: await rasterizeSvgToCanvas(result.outline.svg, tw, th),
  })

  if (!result.vectorPending && result.vector.palette.length > 0) {
    layers.push({
      name: 'Proof',
      canvas: await rasterizeSvgToCanvas(result.proof.svg, tw, th),
    })
  }

  if (result.final) {
    layers.push({
      name: 'Final',
      canvas: await rasterizeSvgToCanvas(result.final.svg, tw, th),
    })
  }

  return layers
}

async function blobFromPsd(layers: NamedCanvas[]): Promise<Blob> {
  const { writePsd } = await import('ag-psd')
  const width = layers[0].canvas.width
  const height = layers[0].canvas.height

  // Composite preview (topmost non-empty wins via normal alpha).
  const composite = document.createElement('canvas')
  composite.width = width
  composite.height = height
  const ctx = composite.getContext('2d')!
  for (const layer of layers) {
    ctx.drawImage(layer.canvas, 0, 0)
  }

  // PSD children: bottom → top (Original under Vector under Outline …).
  const buffer = writePsd(
    {
      width,
      height,
      canvas: composite,
      children: layers.map((layer) => ({
        name: layer.name,
        canvas: layer.canvas,
        opacity: 1,
        blendMode: 'normal' as const,
      })),
    },
    { generateThumbnail: true, noBackground: true },
  )

  return new Blob([buffer], { type: 'image/vnd.adobe.photoshop' })
}

/** Uncompressed RGBA multipage TIFF — one IFD / page per tab. */
function blobFromMultipageTiff(layers: NamedCanvas[]): Blob {
  const width = layers[0].canvas.width
  const height = layers[0].canvas.height
  const pages = layers.map((layer) => {
    const ctx = layer.canvas.getContext('2d', { willReadFrequently: true })!
    return {
      name: layer.name,
      rgba: ctx.getImageData(0, 0, width, height).data,
    }
  })
  const bytes = encodeMultipageRgbaTiff(width, height, pages)
  return new Blob([bytes], { type: 'image/tiff' })
}

async function rasterizeSvgToCanvas(
  svg: string,
  w: number,
  h: number,
): Promise<HTMLCanvasElement> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    return await rasterizeUrlToCanvas(url, w, h)
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function rasterizeUrlToCanvas(
  url: string,
  w: number,
  h: number,
): Promise<HTMLCanvasElement> {
  const img = await loadImage(url)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, w, h)
  // Contain-fit source (may differ aspect from outline dims) centered.
  const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight)
  const dw = Math.max(1, Math.round(img.naturalWidth * scale))
  const dh = Math.max(1, Math.round(img.naturalHeight * scale))
  const dx = Math.round((w - dw) / 2)
  const dy = Math.round((h - dh) / 2)
  ctx.drawImage(img, dx, dy, dw, dh)
  return canvas
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to rasterize layer'))
    img.src = url
  })
}

type TiffPage = { name: string; rgba: Uint8ClampedArray }

/**
 * Minimal big-endian multipage TIFF (uncompressed RGBA).
 * Photoshop opens page 1 only; Photopea / Affinity / Preview cycle pages.
 * For real editable layers, use PSD.
 */
function encodeMultipageRgbaTiff(
  width: number,
  height: number,
  pages: TiffPage[],
): Uint8Array {
  if (!pages.length) throw new Error('No TIFF pages')

  const stripBytes = width * height * 4
  // Header (8) + IFDs + strip payloads.
  // Each IFD: 2 + 14*12 + 4 = 174, plus inline ASCII name padded.
  const ifdStride = 256
  const headerSize = 8
  const ifdBlock = pages.length * ifdStride
  const dataStart = headerSize + ifdBlock

  const total = dataStart + pages.length * stripBytes
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)

  // MM + magic + first IFD offset
  out[0] = 0x4d
  out[1] = 0x4d
  view.setUint16(2, 42)
  view.setUint32(4, headerSize)

  for (let i = 0; i < pages.length; i++) {
    const ifdOffset = headerSize + i * ifdStride
    const stripOffset = dataStart + i * stripBytes
    const page = pages[i]
    out.set(page.rgba, stripOffset)

    const nameBytes = encodeAsciiTag(page.name)
    // Place ASCII after the IFD entry block inside the stride.
    const nameOffset = ifdOffset + 180
    out.set(nameBytes, nameOffset)

    let p = ifdOffset
    view.setUint16(p, 14) // tag count
    p += 2

    p = writeIfdEntry(view, p, 256, 3, 1, width) // ImageWidth SHORT
    p = writeIfdEntry(view, p, 257, 3, 1, height) // ImageLength
    // BitsPerSample: 4 SHORTs → pointer
    const bpsOffset = ifdOffset + 200
    view.setUint16(bpsOffset, 8)
    view.setUint16(bpsOffset + 2, 8)
    view.setUint16(bpsOffset + 4, 8)
    view.setUint16(bpsOffset + 6, 8)
    p = writeIfdEntry(view, p, 258, 3, 4, bpsOffset)
    p = writeIfdEntry(view, p, 259, 3, 1, 1) // Compression none
    p = writeIfdEntry(view, p, 262, 3, 1, 2) // Photometric RGB
    p = writeIfdEntry(view, p, 273, 4, 1, stripOffset) // StripOffsets LONG
    p = writeIfdEntry(view, p, 277, 3, 1, 4) // SamplesPerPixel
    p = writeIfdEntry(view, p, 278, 3, 1, height) // RowsPerStrip
    p = writeIfdEntry(view, p, 279, 4, 1, stripBytes) // StripByteCounts
    p = writeIfdEntry(view, p, 282, 5, 1, ifdOffset + 210) // XResolution
    p = writeIfdEntry(view, p, 283, 5, 1, ifdOffset + 218) // YResolution
    p = writeIfdEntry(view, p, 296, 3, 1, 2) // ResolutionUnit inch
    p = writeIfdEntry(view, p, 338, 3, 1, 1) // ExtraSamples associated alpha
    // PageName
    p = writeIfdEntry(view, p, 285, 2, nameBytes.length, nameOffset)

    // Rational 72/1
    view.setUint32(ifdOffset + 210, 72)
    view.setUint32(ifdOffset + 214, 1)
    view.setUint32(ifdOffset + 218, 72)
    view.setUint32(ifdOffset + 222, 1)

    const nextIfd = i + 1 < pages.length ? headerSize + (i + 1) * ifdStride : 0
    view.setUint32(p, nextIfd)
  }

  return out
}

function writeIfdEntry(
  view: DataView,
  offset: number,
  tag: number,
  type: number,
  count: number,
  valueOrOffset: number,
): number {
  view.setUint16(offset, tag)
  view.setUint16(offset + 2, type)
  view.setUint32(offset + 4, count)
  if (type === 3 && count === 1) {
    // SHORT inline in first 2 bytes of value field
    view.setUint16(offset + 8, valueOrOffset)
    view.setUint16(offset + 10, 0)
  } else {
    view.setUint32(offset + 8, valueOrOffset)
  }
  return offset + 12
}

function encodeAsciiTag(text: string): Uint8Array {
  const clean = (text || 'Layer').slice(0, 48)
  const bytes = new Uint8Array(clean.length + 1)
  for (let i = 0; i < clean.length; i++) bytes[i] = clean.charCodeAt(i) & 0xff
  bytes[clean.length] = 0
  return bytes
}
