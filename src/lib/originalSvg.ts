/**
 * Wrap the source raster in a downloadable SVG (Original tab export).
 * Sketchbook / browsers open this as a single-layer image document.
 */
export async function sourceImageToSvg(
  sourceUrl: string,
  maxDim = 2000,
): Promise<Blob> {
  const img = await loadImage(sourceUrl)
  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  if (!srcW || !srcH) throw new Error('Original image has no dimensions')

  const scale = Math.min(1, maxDim / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  const dataUrl = canvas.toDataURL('image/png')

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
    `<image width="${w}" height="${h}" href="${dataUrl}" xlink:href="${dataUrl}"/>`,
    `</svg>`,
  ].join('')

  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load original image'))
    img.src = url
  })
}
