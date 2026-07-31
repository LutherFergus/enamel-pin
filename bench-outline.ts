/**
 * Browser bench: load Vectorizer ref PNG → extractOutlinePng → save SVG + metrics.
 * Served by Vite at /bench-outline.html
 */
import { DEFAULT_OUTLINE_SETTINGS, extractOutlinePng } from './src/lib/outline'

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  await img.decode()
  return img
}

async function main() {
  const status = document.getElementById('status')!
  const preview = document.getElementById('preview') as HTMLImageElement
  const meta = document.getElementById('meta')!

  try {
    status.textContent = 'Loading Vectorizer ref…'
    const img = await loadImage('/review-screenshots/vectorizer-ref-IMG_3769.png')
    status.textContent = 'Tracing outline with Potrace…'

    const result = await extractOutlinePng(img, {
      ...DEFAULT_OUTLINE_SETTINGS,
      sensitivity: 48,
      thickness: 0,
      maxDim: 1024,
    })

    preview.src = result.svgUrl
    const pathCount = (result.svg.match(/<path\b/g) || []).length
    const hasCurves = /[CcQq]/.test(result.svg)
    const hasBgRect = /<rect\b/i.test(result.svg)
    const fillMatch = result.svg.match(/fill="(#[0-9a-fA-F]{3,8})"/)
    const info = {
      widthPx: result.widthPx,
      heightPx: result.heightPx,
      svgBytes: result.svg.length,
      pathCount,
      hasCurves,
      hasBgRect,
      fill: fillMatch?.[1] ?? null,
      head: result.svg.slice(0, 280),
    }
    meta.textContent = JSON.stringify(info, null, 2)
    ;(window as unknown as { __outlineBench: unknown }).__outlineBench = {
      ...info,
      svg: result.svg,
    }
    status.textContent = 'Done'
  } catch (err) {
    status.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`
    console.error(err)
  }
}

main()
