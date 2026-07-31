import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, type Connect, type Plugin, type PreviewServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

const SCREENSHOT_DIR = '/workspace/review-screenshots'

function readBody(req: Connect.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function attachScreenshotApi(middlewares: Connect.Server) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })

  // Serve local review screenshots for benches / QA (dev + preview).
  middlewares.use((req, res, next) => {
    const pathname = req.url?.split('?')[0] || ''
    if (!pathname.startsWith('/review-screenshots/') || req.method !== 'GET') {
      next()
      return
    }
    const rel = decodeURIComponent(pathname.replace(/^\/review-screenshots\//, ''))
    if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
      res.statusCode = 400
      res.end('bad path')
      return
    }
    const filePath = path.join(SCREENSHOT_DIR, rel)
    if (!filePath.startsWith(SCREENSHOT_DIR) || !fs.existsSync(filePath)) {
      res.statusCode = 404
      res.end('not found')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    const type =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : 'image/png'
    res.statusCode = 200
    res.setHeader('Content-Type', type)
    res.setHeader('Cache-Control', 'no-store')
    fs.createReadStream(filePath).pipe(res)
  })

  middlewares.use(async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/screenshot' || req.method !== 'POST') {
      next()
      return
    }

    try {
      const raw = await readBody(req)
      const json = JSON.parse(raw.toString('utf8')) as {
        dataUrl?: string
        label?: string
      }
      if (!json.dataUrl?.startsWith('data:image/')) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Expected dataUrl image' }))
        return
      }

      const match = json.dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/)
      if (!match) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Unsupported image dataUrl' }))
        return
      }

      const ext = match[1] === 'jpeg' ? 'jpg' : 'png'
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const safeLabel = (json.label || 'ui')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
      const filename = `${stamp}-${safeLabel || 'ui'}.${ext}`
      const filePath = path.join(SCREENSHOT_DIR, filename)
      fs.writeFileSync(filePath, Buffer.from(match[2], 'base64'))

      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          ok: true,
          filename,
          path: filePath,
        }),
      )
    } catch (err) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : 'Screenshot save failed',
        }),
      )
    }
  })
}

/**
 * Dev image proxy with multi-upstream fallback.
 * Free hosts rate-limit and hang; trying a few endpoints cuts batch failures.
 */
function imageGenProxy(): Plugin {
  return {
    name: 'image-gen-proxy',
    configureServer(server: ViteDevServer) {
      attachScreenshotApi(server.middlewares)
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/image-gen/')) {
          next()
          return
        }

        try {
          const incoming = new URL(req.url, 'http://localhost')
          const promptPath = incoming.pathname.replace(/^\/api\/image-gen\//, '')
          const decoded = decodeURIComponent(promptPath)
          const width = incoming.searchParams.get('width') || '512'
          const height = incoming.searchParams.get('height') || '512'
          const seed = incoming.searchParams.get('seed') || '0'
          const q = `width=${width}&height=${height}&seed=${seed}&nologo=true`

          const encoded = encodeURIComponent(decoded)
          const targets = [
            `https://image.pollinations.ai/prompt/${encoded}?${q}`,
            `https://image.pollinations.ai/prompt/${encoded}?${q}&model=flux`,
            `https://image.pollinations.ai/prompt/${encoded}?${q}&model=turbo`,
          ]

          let lastErr = 'no upstream tried'
          for (const target of targets) {
            try {
              const upstream = await fetch(target, {
                headers: {
                  Accept: 'image/*,*/*',
                  'User-Agent': 'pin-proof-studio/0.2',
                },
                signal: AbortSignal.timeout(90_000),
              })

              if (!upstream.ok) {
                lastErr = `HTTP ${upstream.status} from ${new URL(target).host}`
                await new Promise((r) => setTimeout(r, 400))
                continue
              }

              const buf = Buffer.from(await upstream.arrayBuffer())
              if (buf.length < 800) {
                lastErr = `tiny body from ${new URL(target).host}`
                continue
              }

              const contentType = upstream.headers.get('content-type') || 'image/jpeg'
              if (contentType.includes('text/html')) {
                lastErr = `html body from ${new URL(target).host}`
                continue
              }

              res.statusCode = 200
              res.setHeader('Content-Type', contentType)
              res.setHeader('Cache-Control', 'no-store')
              res.setHeader('X-Image-Upstream', new URL(target).host)
              res.end(buf)
              return
            } catch (err) {
              lastErr = err instanceof Error ? err.message : 'upstream error'
              await new Promise((r) => setTimeout(r, 300))
            }
          }

          res.statusCode = 502
          res.setHeader('Content-Type', 'text/plain')
          res.end(`Image proxy failed after fallbacks: ${lastErr}`)
        } catch (err) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'text/plain')
          res.end(
            err instanceof Error
              ? `Image proxy failed: ${err.message}`
              : 'Image proxy failed',
          )
        }
      })
    },
    configurePreviewServer(server: PreviewServer) {
      attachScreenshotApi(server.middlewares)
    },
  }
}

export default defineConfig({
  // GitHub Pages project site: https://lutherfergus.github.io/mosaic-image-creator/
  base: process.env.GITHUB_PAGES === '1' ? '/mosaic-image-creator/' : '/',
  plugins: [react(), imageGenProxy()],
  optimizeDeps: {
    exclude: ['esm-potrace-wasm'],
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
})
