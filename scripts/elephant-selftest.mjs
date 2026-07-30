/**
 * Elephant workflow self-test: start from Org / BG-removed / plates,
 * compare outline+vector to gold-standard IMG_4810 / IMG_4811.
 */
import { chromium } from 'playwright-core'
import { createServer } from 'http'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'

const OUT = '/opt/cursor/artifacts/elephant'
mkdirSync(OUT, { recursive: true })
const CHROME =
  '/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell'

function serve(path, type = 'image/png') {
  return new Promise((resolve) => {
    const data = readFileSync(path)
    const s = createServer((_q, r) => {
      r.writeHead(200, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*' })
      r.end(data)
    })
    s.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${s.address().port}/`, close: () => s.close() }),
    )
  })
}

const files = {
  org: await serve('/tmp/elephant/01-org.jpeg', 'image/jpeg'),
  bg: await serve('/tmp/elephant/02-bg-removed.jpeg', 'image/jpeg'),
  outline: await serve('/tmp/elephant/03-outline.png'),
  colors: await serve('/tmp/elephant/04-colors.png'),
}

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-web-security'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('console', (m) => {
  if (m.type() === 'error') console.log('PAGEERR', m.text())
})
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })

const report = await page.evaluate(async (urls) => {
  const load = (url) =>
    new Promise((res, rej) => {
      const i = new Image()
      i.crossOrigin = 'anonymous'
      i.onload = () => res(i)
      i.onerror = () => rej(new Error(url))
      i.src = url
    })

  const { extractOutlinePng } = await import('/src/lib/outline.ts')
  const { vectorizeColors, DEFAULT_COLOR_VECTOR_SETTINGS } = await import(
    '/src/lib/colorVectorize.ts'
  )
  const { analyzeLineArt } = await import('/src/lib/lineArt.ts')
  const { DEFAULT_OUTLINE_SETTINGS } = await import('/src/lib/outline.ts')

  function toData(img, maxDim = 800) {
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    return { canvas: c, ctx, data: ctx.getImageData(0, 0, w, h), w, h }
  }

  function inkMaskFromRgba(data, w, h) {
    const m = new Uint8Array(w * h)
    for (let i = 0; i < w * h; i++) {
      const o = i * 4
      if (data[o + 3] < 128) continue
      const y = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]
      if (y < 80) m[i] = 1
    }
    return m
  }

  function rasterizeSvg(svg, w, h) {
    return new Promise(async (resolve) => {
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      const img = await load(url)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      ctx.clearRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(ctx.getImageData(0, 0, w, h))
    })
  }

  function compareInk(a, b, w, h) {
    let tp = 0,
      fp = 0,
      fn = 0,
      aN = 0,
      bN = 0
    for (let i = 0; i < w * h; i++) {
      const aa = a[i] ? 1 : 0
      const bb = b[i] ? 1 : 0
      aN += aa
      bN += bb
      if (aa && bb) tp++
      else if (aa && !bb) fp++
      else if (!aa && bb) fn++
    }
    const iou = tp / (tp + fp + fn || 1)
    const prec = tp / (tp + fp || 1)
    const rec = tp / (tp + fn || 1)
    return { iou, prec, rec, aN, bN, coverA: aN / (w * h), coverB: bN / (w * h) }
  }

  function paletteSummary(svg) {
    const fills = [...new Set([...svg.matchAll(/fill="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1]))]
    const nonBlack = fills.filter((h) => {
      const r = parseInt(h.slice(1, 3), 16)
      const g = parseInt(h.slice(3, 5), 16)
      const b = parseInt(h.slice(5, 7), 16)
      return 0.299 * r + 0.587 * g + 0.114 * b >= 40
    })
    return { fills, nonBlack, n: fills.length }
  }

  const orgImg = await load(urls.org)
  const bgImg = await load(urls.bg)
  const outlineRef = await load(urls.outline)
  const colorsRef = await load(urls.colors)

  // Probe line-art flags
  const probes = {}
  for (const [name, img] of [
    ['org', orgImg],
    ['bg', bgImg],
    ['outline', outlineRef],
    ['colors', colorsRef],
  ]) {
    const { data, w, h } = toData(img, 600)
    probes[name] = { ...analyzeLineArt(data), w: img.naturalWidth, h: img.naturalHeight }
  }

  const refOutline = toData(outlineRef, 1000)
  const refInk = inkMaskFromRgba(refOutline.data.data, refOutline.w, refOutline.h)

  const outlineSettingsList = [
    { sensitivity: 60, thickness: 1, invert: false, maxDim: 1400 },
    { sensitivity: 70, thickness: 1, invert: false, maxDim: 2000 },
    { sensitivity: 70, thickness: 2, invert: false, maxDim: 2000 },
    { sensitivity: 75, thickness: 2, invert: false, maxDim: 1600 },
    { sensitivity: 85, thickness: 2, invert: false, maxDim: 2000 },
    { sensitivity: 90, thickness: 3, invert: false, maxDim: 2000 },
    { ...DEFAULT_OUTLINE_SETTINGS },
  ]

  const results = { probes, fromOrg: [], fromBg: [], fromOutlinePlate: [], fromColorsPlate: [] }

  async function scoreOutline(sourceImg, settings, tag) {
    const o = await extractOutlinePng(sourceImg, settings)
    // rasterize at ref size for compare
    const ras = await rasterizeSvg(o.svg, refOutline.w, refOutline.h)
    const ink = inkMaskFromRgba(ras.data, refOutline.w, refOutline.h)
    const cmp = compareInk(ink, refInk, refOutline.w, refOutline.h)
    return {
      tag,
      settings,
      pathCount: o.pathCount,
      ...cmp,
      svgBytes: o.svg.length,
    }
  }

  for (const s of outlineSettingsList) {
    results.fromOrg.push(await scoreOutline(orgImg, s, 'org'))
    results.fromBg.push(await scoreOutline(bgImg, s, 'bg'))
  }
  // Perfect-ish: outline plate itself
  results.fromOutlinePlate.push(
    await scoreOutline(outlineRef, {
      sensitivity: 85,
      thickness: 1,
      invert: false,
      maxDim: 2000,
    }, 'outline-plate'),
  )

  // Color vector from colors plate + from bg
  const colorSettings = [
    { colorCount: 12, minRegionRatio: 0.0002, smoothness: 3, maxDim: 1200, snapToPms: true },
    { colorCount: 14, minRegionRatio: 0.0001, smoothness: 3, maxDim: 1600, snapToPms: true },
    { colorCount: 16, minRegionRatio: 0.00008, smoothness: 2, maxDim: 2000, snapToPms: false },
    { colorCount: 12, minRegionRatio: 0.00015, smoothness: 3, maxDim: 2000, snapToPms: true },
  ]
  for (const s of colorSettings) {
    const vColors = await vectorizeColors(colorsRef, s)
    const vBg = await vectorizeColors(bgImg, s)
    const vOrg = await vectorizeColors(orgImg, s)
    results.fromColorsPlate.push({
      settings: s,
      colors: paletteSummary(vColors.svg),
      paths: vColors.regionCount,
    })
    results.fromBg.push({
      kind: 'vector',
      settings: s,
      bg: paletteSummary(vBg.svg),
      org: paletteSummary(vOrg.svg),
      pathsBg: vBg.regionCount,
      pathsOrg: vOrg.regionCount,
    })
  }

  // Analyze gold metal in org
  const orgData = toData(orgImg, 800)
  let gold = 0,
    dark = 0,
    opaque = 0
  const d = orgData.data.data
  for (let i = 0; i < orgData.w * orgData.h; i++) {
    const o = i * 4
    opaque++
    const r = d[o],
      g = d[o + 1],
      b = d[o + 2]
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    if (y < 70) dark++
    // gold/bronze metal
    if (r > 140 && g > 90 && b < 120 && r > b + 40 && g > b + 20) gold++
  }

  results.metalStats = {
    goldRatio: gold / opaque,
    darkRatio: dark / opaque,
    gold,
    dark,
  }

  // Pick best outline settings by IoU from bg
  const bestBg = [...results.fromBg]
    .filter((r) => r.iou != null)
    .sort((a, b) => b.iou - a.iou)[0]
  const bestOrg = [...results.fromOrg].sort((a, b) => b.iou - a.iou)[0]

  results.best = { bestBg, bestOrg, plate: results.fromOutlinePlate[0] }

  // Generate visual QA with best-ish settings for bg
  const bestSettings = bestBg?.settings || outlineSettingsList[2]
  const oBg = await extractOutlinePng(bgImg, bestSettings)
  const oOrg = await extractOutlinePng(orgImg, bestSettings)
  const vBg = await vectorizeColors(bgImg, {
    colorCount: 14,
    minRegionRatio: 0.0001,
    smoothness: 3,
    maxDim: 1600,
    snapToPms: true,
  })

  async function svgToPngDataUrl(svg, w, h) {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const img = await load(url)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    URL.revokeObjectURL(url)
    return c.toDataURL('image/png')
  }

  return {
    ...results,
    visuals: {
      outlineFromBg: await svgToPngDataUrl(oBg.svg, oBg.widthPx, oBg.heightPx),
      outlineFromOrg: await svgToPngDataUrl(oOrg.svg, oOrg.widthPx, oOrg.heightPx),
      vectorFromBg: await svgToPngDataUrl(vBg.svg, vBg.widthPx, vBg.heightPx),
      bestSettings,
      vectorPalette: vBg.palette.map((p) => ({ hex: p.hex, pms: p.pmsCode })),
    },
  }
}, {
  org: files.org.url,
  bg: files.bg.url,
  outline: files.outline.url,
  colors: files.colors.url,
})

function saveDataUrl(path, dataUrl) {
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'))
}

saveDataUrl(`${OUT}/selftest-outline-from-bg.png`, report.visuals.outlineFromBg)
saveDataUrl(`${OUT}/selftest-outline-from-org.png`, report.visuals.outlineFromOrg)
saveDataUrl(`${OUT}/selftest-vector-from-bg.png`, report.visuals.vectorFromBg)

const summary = {
  probes: report.probes,
  metalStats: report.metalStats,
  best: report.best,
  fromOrg: report.fromOrg,
  fromBgOutline: report.fromBg.filter((r) => r.iou != null),
  fromOutlinePlate: report.fromOutlinePlate,
  fromColorsPlate: report.fromColorsPlate,
  vectorFromBgSamples: report.fromBg.filter((r) => r.kind === 'vector'),
  bestSettings: report.visuals.bestSettings,
  vectorPalette: report.visuals.vectorPalette,
}
writeFileSync(`${OUT}/selftest-report.json`, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))

await browser.close()
for (const s of Object.values(files)) s.close()
