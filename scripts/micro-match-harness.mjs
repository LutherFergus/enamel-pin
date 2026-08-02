/**
 * Micro-match harness: bake existing Potrace outlines + run Chrome Potrace on
 * reference rasters, then pixel-diff against imaengine Firefighter refs.
 *
 * Usage: node scripts/micro-match-harness.mjs
 */
import { createServer } from 'http'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { fileURLToPath } from 'url'
import { Resvg } from '@resvg/resvg-js'
import { createCanvas, loadImage } from 'canvas'
import puppeteer from 'puppeteer-core'

const ROOT = join(fileURLToPath(import.meta.url), '../..')
const OUT = join(ROOT, 'review-screenshots/ref-match')
const UPLOADS = '/home/ubuntu/.cursor/projects/workspace/uploads'
mkdirSync(OUT, { recursive: true })

// --- bake helpers (mirror src/lib/potraceBake.ts) ---
function parsePotraceTransform(attrs) {
  const tr = attrs.match(
    /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)\s*scale\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i,
  )
  if (!tr) return null
  return { translateY: Number(tr[2]), scale: Math.abs(Number(tr[3])), superScale: 1 }
}

function mapPoint(p, t) {
  return {
    x: (p.x * t.scale) / t.superScale,
    y: (t.translateY + p.y * -t.scale) / t.superScale,
  }
}
function fmt(n) {
  const r = Math.round(n * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

function bakePotracePathD(d, t) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g)
  if (!tokens?.length) return ''
  let i = 0
  let cmd = ''
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0
  const out = []
  const nextNum = () => {
    const v = Number(tokens[i++])
    return Number.isFinite(v) ? v : 0
  }
  while (i < tokens.length) {
    const tok = tokens[i]
    if (/^[a-zA-Z]$/.test(tok)) {
      cmd = tok
      i++
    } else if (!cmd) break
    switch (cmd) {
      case 'M': {
        cx = nextNum()
        cy = nextNum()
        startX = cx
        startY = cy
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`M${fmt(p.x)},${fmt(p.y)}`)
        cmd = 'L'
        break
      }
      case 'm': {
        cx += nextNum()
        cy += nextNum()
        startX = cx
        startY = cy
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`M${fmt(p.x)},${fmt(p.y)}`)
        cmd = 'l'
        break
      }
      case 'L':
      case 'l': {
        if (cmd === 'L') {
          cx = nextNum()
          cy = nextNum()
        } else {
          cx += nextNum()
          cy += nextNum()
        }
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`L${fmt(p.x)},${fmt(p.y)}`)
        break
      }
      case 'H':
      case 'h': {
        cx = cmd === 'H' ? nextNum() : cx + nextNum()
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`L${fmt(p.x)},${fmt(p.y)}`)
        break
      }
      case 'V':
      case 'v': {
        cy = cmd === 'V' ? nextNum() : cy + nextNum()
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(`L${fmt(p.x)},${fmt(p.y)}`)
        break
      }
      case 'C': {
        const x1 = nextNum()
        const y1 = nextNum()
        const x2 = nextNum()
        const y2 = nextNum()
        cx = nextNum()
        cy = nextNum()
        const p1 = mapPoint({ x: x1, y: y1 }, t)
        const p2 = mapPoint({ x: x2, y: y2 }, t)
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(
          `C${fmt(p1.x)},${fmt(p1.y)} ${fmt(p2.x)},${fmt(p2.y)} ${fmt(p.x)},${fmt(p.y)}`,
        )
        break
      }
      case 'c': {
        const x1 = cx + nextNum()
        const y1 = cy + nextNum()
        const x2 = cx + nextNum()
        const y2 = cy + nextNum()
        cx += nextNum()
        cy += nextNum()
        const p1 = mapPoint({ x: x1, y: y1 }, t)
        const p2 = mapPoint({ x: x2, y: y2 }, t)
        const p = mapPoint({ x: cx, y: cy }, t)
        out.push(
          `C${fmt(p1.x)},${fmt(p1.y)} ${fmt(p2.x)},${fmt(p2.y)} ${fmt(p.x)},${fmt(p.y)}`,
        )
        break
      }
      case 'Z':
      case 'z': {
        out.push('Z')
        cx = startX
        cy = startY
        break
      }
      default:
        return out.join('')
    }
  }
  return out.join('')
}

function bakeOutlineFromPotraceSvg(svg, artW, artH, superScale = 1) {
  const gMatch = svg.match(/<g\b([^>]*)>/i)
  const transform = gMatch ? parsePotraceTransform(gMatch[1]) : null
  const ds = [...svg.matchAll(/\bd="([^"]*)"/gi)].map((m) => m[1])
  if (!ds.length || !transform) throw new Error('no potrace paths')
  const t = { ...transform, superScale }
  // If viewBox is supersampled and transform uses art height, detect scale.
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
  let ss = superScale
  if (vb) {
    const vbH = Number(vb[2])
    if (vbH === artH * 2) ss = 2
    else if (vbH === artH * 3) ss = 3
    else if (Math.abs(transform.translateY - artH) < 1) ss = 1
    else if (Math.abs(transform.translateY - artH * 2) < 1) ss = 2
    else if (Math.abs(transform.translateY - artH * 3) < 1) ss = 3
  }
  t.superScale = ss
  const compound = ds.map((d) => bakePotracePathD(d, t)).filter(Boolean).join('')
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${artW} ${artH}" width="${artW}" height="${artH}">`,
    `<g id="outline" fill="#000000">`,
    `<path fill="#000000" d="${compound}" />`,
    `</g></svg>`,
  ].join('\n')
}

function rasterSvg(svgText, size, bg = 'white') {
  const r = new Resvg(Buffer.from(svgText), {
    fitTo: { mode: 'width', value: size },
    background: bg,
  })
  return r.render().asPng()
}

function pixelDiff(pngA, pngB, label) {
  // Load via canvas
  return Promise.all([loadImage(pngA), loadImage(pngB)]).then(([a, b]) => {
    const w = Math.min(a.width, b.width)
    const h = Math.min(a.height, b.height)
    const ca = createCanvas(w, h)
    const cb = createCanvas(w, h)
    const xa = ca.getContext('2d')
    const xb = cb.getContext('2d')
    xa.drawImage(a, 0, 0, w, h)
    xb.drawImage(b, 0, 0, w, h)
    const da = xa.getImageData(0, 0, w, h).data
    const db = xb.getImageData(0, 0, w, h).data
    let diff = 0
    let inkA = 0
    let inkB = 0
    const diffCanvas = createCanvas(w, h)
    const dx = diffCanvas.getContext('2d')
    const out = dx.createImageData(w, h)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      const la = 0.2126 * da[o] + 0.7152 * da[o + 1] + 0.0722 * da[o + 2]
      const lb = 0.2126 * db[o] + 0.7152 * db[o + 1] + 0.0722 * db[o + 2]
      if (la < 128) inkA++
      if (lb < 128) inkB++
      const d = Math.abs(la - lb)
      if (d > 24) {
        diff++
        out.data[o] = 220
        out.data[o + 1] = 40
        out.data[o + 2] = 40
        out.data[o + 3] = 255
      } else {
        out.data[o] = da[o]
        out.data[o + 1] = da[o + 1]
        out.data[o + 2] = da[o + 2]
        out.data[o + 3] = 80
      }
    }
    dx.putImageData(out, 0, 0)
    const pct = (100 * diff) / (w * h)
    writeFileSync(join(OUT, `${label}-diff.png`), diffCanvas.toBuffer('image/png'))
    return { label, w, h, diff, pct, inkA, inkB }
  })
}

function zoomCrop(pngBuf, cx, cy, size, scale, outPath) {
  return loadImage(pngBuf).then((img) => {
    const sw = Math.round(size / scale)
    const sx = Math.max(0, Math.min(img.width - sw, Math.round(cx - sw / 2)))
    const sy = Math.max(0, Math.min(img.height - sw, Math.round(cy - sw / 2)))
    const c = createCanvas(size, size)
    const ctx = c.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img, sx, sy, sw, sw, 0, 0, size, size)
    writeFileSync(outPath, c.toBuffer('image/png'))
  })
}

async function startStaticServer() {
  const mime = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.html': 'text/html',
  }
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0])
    let path = join(ROOT, url === '/' ? 'scripts/micro-match-page.html' : url.slice(1))
    if (!existsSync(path)) {
      res.writeHead(404)
      res.end('missing')
      return
    }
    const body = readFileSync(path)
    res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' })
    res.end(body)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  return { server, port }
}

async function chromePotraceOutline(port, pngPath, artSize) {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-gpu', '--headless=new'],
  })
  try {
    const page = await browser.newPage()
    page.on('console', (m) => console.log('PAGE', m.type(), m.text()))
    page.on('pageerror', (e) => console.error('PAGEERR', e.message))
    const pngB64 = readFileSync(pngPath).toString('base64')
    await page.goto(`http://127.0.0.1:${port}/scripts/micro-match-page.html`, {
      waitUntil: 'networkidle0',
      timeout: 60000,
    })
    const svg = await page.evaluate(
      async ({ pngB64, artSize }) => {
        await window.__ready
        return window.__traceOutline(pngB64, artSize)
      },
      { pngB64, artSize },
    )
    return svg
  } finally {
    await browser.close()
  }
}

async function main() {
  const refOutline = readFileSync(join(UPLOADS, 'Firefighter_outline_bbb3.svg'), 'utf8')
  const refVector = readFileSync(join(UPLOADS, 'Firefighter_vector_bf15.svg'), 'utf8')
  const ourOldOutline = readFileSync(
    join(UPLOADS, 'att.sYR1fIEzxWfxeYihu0cnmen-s5HgRQ8ldCTTNutKDs8.png-outline_2_3884.svg'),
    'utf8',
  )

  // 1) Bake old outline into absolute cubics and compare structure
  const bakedOld = bakeOutlineFromPotraceSvg(ourOldOutline, 1600, 1600, 1)
  writeFileSync(join(OUT, 'baked-old-outline.svg'), bakedOld)
  console.log(
    'baked old:',
    'paths',
    (bakedOld.match(/<path/g) || []).length,
    'C',
    (bakedOld.match(/C/g) || []).length,
    'c',
    (bakedOld.match(/(?<![A-Za-z])c(?![A-Za-z])/g) || []).length,
  )

  const refOutlinePng = rasterSvg(refOutline, 1800, '#ffffff')
  writeFileSync(join(OUT, 'ref-outline-full.png'), refOutlinePng)
  const bakedOldPng = rasterSvg(bakedOld, 1800, '#ffffff')
  writeFileSync(join(OUT, 'baked-old-outline.png'), bakedOldPng)
  console.log(await pixelDiff(bakedOldPng, refOutlinePng, 'baked-old-vs-ref-outline'))

  // 2) Chrome Potrace on ref outline raster (oracle: re-trace should ≈ ref)
  const { server, port } = await startStaticServer()
  console.log('static server', port)
  try {
    // Use ref outline raster as ink mask source
    writeFileSync(join(OUT, 'source-outline-ink.png'), refOutlinePng)
    const traced = await chromePotraceOutline(port, join(OUT, 'source-outline-ink.png'), 1800)
    writeFileSync(join(OUT, 'chrome-retraced-outline.svg'), traced)
    console.log(
      'chrome retrace:',
      'bytes',
      traced.length,
      'paths',
      (traced.match(/<path/g) || []).length,
      'C',
      (traced.match(/C/g) || []).length,
      'transform',
      traced.includes('transform='),
    )
    const retracePng = rasterSvg(traced, 1800, '#ffffff')
    writeFileSync(join(OUT, 'chrome-retraced-outline.png'), retracePng)
    const stats = await pixelDiff(retracePng, refOutlinePng, 'retrace-vs-ref-outline')
    console.log(stats)

    // Zooms at known hard spots (helmet / text / flame)
    await zoomCrop(refOutlinePng, 900, 500, 400, 4, join(OUT, 'zoom-ref-helmet.png'))
    await zoomCrop(retracePng, 900, 500, 400, 4, join(OUT, 'zoom-ours-helmet.png'))
    await zoomCrop(refOutlinePng, 900, 1100, 400, 4, join(OUT, 'zoom-ref-text.png'))
    await zoomCrop(retracePng, 900, 1100, 400, 4, join(OUT, 'zoom-ours-text.png'))

    const refVectorPng = rasterSvg(refVector, 1652, '#ffffff')
    writeFileSync(join(OUT, 'ref-vector-full.png'), refVectorPng)
  } finally {
    server.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
