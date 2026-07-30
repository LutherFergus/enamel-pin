/**
 * Headless QA: outline SVG + color vector against elephant fixtures.
 * Usage: node scripts/qa-elephant.mjs  (vite must be on :5173)
 */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { createServer } from 'http'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = '/opt/cursor/artifacts/elephant'
mkdirSync(outDir, { recursive: true })

function serveFile(path, type) {
  return new Promise((resolve) => {
    const data = readFileSync(path)
    const server = createServer((_req, res) => {
      res.writeHead(200, {
        'Content-Type': type,
        'Access-Control-Allow-Origin': '*',
      })
      res.end(data)
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => server.close() })
    })
  })
}

const outlineServe = await serveFile('/tmp/elephant/03-outline.png', 'image/png')
const colorsServe = await serveFile('/tmp/elephant/04-colors.png', 'image/png')

const browser = await chromium.launch({
  executablePath:
    process.env.PLAYWRIGHT_CHROMIUM ||
    '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-web-security'],
})

const page = await browser.newPage()
page.on('console', (msg) => console.log('PAGE:', msg.text()))
page.on('pageerror', (err) => console.error('PAGEERR:', err.message))

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })

const result = await page.evaluate(
  async ({ outlineUrl, colorsUrl }) => {
    const loadImg = (url) =>
      new Promise((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => resolve(img)
        img.onerror = () => reject(new Error('img fail ' + url))
        img.src = url
      })

    const { extractOutlinePng } = await import('/src/lib/outline.ts')
    const { vectorizeColors } = await import('/src/lib/colorVectorize.ts')
    const { analyzeLineArt } = await import('/src/lib/lineArt.ts')

    const outlineImg = await loadImg(outlineUrl)
    const colorsImg = await loadImg(colorsUrl)

    // Probe line-art detection on colors (must be false)
    const c = document.createElement('canvas')
    c.width = Math.min(800, colorsImg.naturalWidth)
    c.height = Math.round(
      (colorsImg.naturalHeight / colorsImg.naturalWidth) * c.width,
    )
    const ctx = c.getContext('2d')
    ctx.drawImage(colorsImg, 0, 0, c.width, c.height)
    const colorsAnalysis = analyzeLineArt(ctx.getImageData(0, 0, c.width, c.height))

    const o = document.createElement('canvas')
    o.width = Math.min(800, outlineImg.naturalWidth)
    o.height = Math.round(
      (outlineImg.naturalHeight / outlineImg.naturalWidth) * o.width,
    )
    const octx = o.getContext('2d')
    octx.drawImage(outlineImg, 0, 0, o.width, o.height)
    const outlineAnalysis = analyzeLineArt(octx.getImageData(0, 0, o.width, o.height))

    const outline = await extractOutlinePng(outlineImg, {
      sensitivity: 60,
      thickness: 1,
      invert: false,
      maxDim: 1400,
    })

    const vector = await vectorizeColors(colorsImg, {
      colorCount: 12,
      minRegionRatio: 0.0002,
      smoothness: 3,
      maxDim: 1200,
      snapToPms: true,
    })

    // Rasterize SVGs for visual QA
    async function rasterizeSvg(svg, w, h) {
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const img = await loadImg(url)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const g = canvas.getContext('2d')
      g.fillStyle = '#ffffff'
      g.fillRect(0, 0, w, h)
      g.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      return canvas.toDataURL('image/png')
    }

    // Count distinct non-near-black fills in vector SVG
    const fills = [...vector.svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1])
    const uniqueFills = [...new Set(fills)]
    const nonBlack = uniqueFills.filter((hex) => {
      const r = parseInt(hex.slice(1, 3), 16)
      const g = parseInt(hex.slice(3, 5), 16)
      const b = parseInt(hex.slice(5, 7), 16)
      return 0.299 * r + 0.587 * g + 0.114 * b >= 40
    })

    // Curve command ratio in outline SVG
    const cCount = (outline.svg.match(/ C /g) || []).length
    const lCount = (outline.svg.match(/ L /g) || []).length

    const outlinePng = await rasterizeSvg(outline.svg, outline.widthPx, outline.heightPx)
    const vectorPng = await rasterizeSvg(vector.svg, vector.widthPx, vector.heightPx)

    return {
      outlineAnalysis,
      colorsAnalysis,
      outlinePaths: outline.pathCount,
      outlineBytes: outline.svg.length,
      curveCmds: cCount,
      lineCmds: lCount,
      vectorPaths: vector.regionCount,
      palette: vector.palette.map((p) => ({
        hex: p.hex,
        pms: p.pmsCode,
        n: p.pixelCount,
      })),
      uniqueFills,
      nonBlackFills: nonBlack,
      outlinePng,
      vectorPng,
      outlineSvg: outline.svg,
      vectorSvg: vector.svg,
    }
  },
  { outlineUrl: outlineServe.url, colorsUrl: colorsServe.url },
)

function dataUrlToBuf(dataUrl) {
  const b64 = dataUrl.split(',')[1]
  return Buffer.from(b64, 'base64')
}

writeFileSync(join(outDir, 'qa-outline.svg'), result.outlineSvg)
writeFileSync(join(outDir, 'qa-vector.svg'), result.vectorSvg)
writeFileSync(join(outDir, 'qa-outline.png'), dataUrlToBuf(result.outlinePng))
writeFileSync(join(outDir, 'qa-vector.png'), dataUrlToBuf(result.vectorPng))

console.log(
  JSON.stringify(
    {
      outlineIsLineArt: result.outlineAnalysis.isLineArt,
      colorsIsLineArt: result.colorsAnalysis.isLineArt,
      outlinePaths: result.outlinePaths,
      curveCmds: result.curveCmds,
      lineCmds: result.lineCmds,
      vectorPaths: result.vectorPaths,
      uniqueFills: result.uniqueFills,
      nonBlackFills: result.nonBlackFills,
      palette: result.palette,
    },
    null,
    2,
  ),
)

await browser.close()
outlineServe.close()
colorsServe.close()
