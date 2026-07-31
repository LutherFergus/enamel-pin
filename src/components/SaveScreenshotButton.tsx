import { useCallback, useState } from 'react'
import { toPng } from 'html-to-image'

type Props = {
  targetSelector?: string
  label?: string
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Blob URLs break when html-to-image appends ?cacheBust — inline them first. */
async function inlineBlobImages(root: HTMLElement): Promise<() => void> {
  const imgs = [...root.querySelectorAll('img')].filter((img) =>
    (img.currentSrc || img.src || '').startsWith('blob:'),
  )
  const restorers: Array<() => void> = []

  await Promise.all(
    imgs.map(async (img) => {
      const original = img.src
      try {
        const res = await fetch(original)
        const blob = await res.blob()
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
          reader.readAsDataURL(blob)
        })
        img.src = dataUrl
        restorers.push(() => {
          img.src = original
        })
      } catch {
        // Leave as-is; capture may still work without this image.
      }
    }),
  )

  return () => {
    for (const restore of restorers) restore()
  }
}

export function SaveScreenshotButton({
  targetSelector = '.app',
  label = 'page',
}: Props) {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onSave = useCallback(async () => {
    setBusy(true)
    setStatus(null)
    let restore: (() => void) | null = null
    try {
      const node = document.querySelector(targetSelector)
      if (!(node instanceof HTMLElement)) {
        throw new Error(`Nothing to capture (${targetSelector})`)
      }

      restore = await inlineBlobImages(node)

      // skipFonts: Google Fonts CSS is cross-origin (cssRules throws).
      // cacheBust:false: busting appends ?ts to blob: URLs and 404s them.
      const dataUrl = await toPng(node, {
        cacheBust: false,
        pixelRatio: Math.min(2, window.devicePixelRatio || 1),
        backgroundColor: '#f3efe6',
        skipFonts: true,
        filter: (el) => {
          if (!(el instanceof Element)) return true
          if (el.tagName === 'LINK') {
            const href = el.getAttribute('href') || ''
            if (/fonts\.googleapis|fonts\.gstatic/i.test(href)) return false
          }
          return true
        },
      })

      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const safeLabel = label.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40) || 'page'
      const filename = `${stamp}-${safeLabel}.png`

      try {
        const res = await fetch('/api/screenshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dataUrl, label }),
        })
        const text = await res.text()
        let payload: { ok?: boolean; filename?: string; error?: string } = {}
        try {
          payload = JSON.parse(text) as typeof payload
        } catch {
          throw new Error(text.slice(0, 120) || `Save failed (${res.status})`)
        }
        if (!res.ok || !payload.ok) {
          throw new Error(payload.error || `Save failed (${res.status})`)
        }
        setStatus(`Saved ${payload.filename}`)
      } catch (apiErr) {
        downloadDataUrl(dataUrl, filename)
        const reason = apiErr instanceof Error ? apiErr.message : 'API unreachable'
        setStatus(`Downloaded ${filename} (server save failed: ${reason})`)
      }
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : err && typeof err === 'object' && 'type' in err
              ? 'Capture failed (asset load). Try again after images finish loading.'
              : 'Screenshot failed'
      setStatus(msg)
    } finally {
      restore?.()
      setBusy(false)
    }
  }, [label, targetSelector])

  return (
    <div className="screenshot-actions">
      <button
        type="button"
        className="save-shot-btn"
        onClick={() => void onSave()}
        disabled={busy}
      >
        {busy ? 'Saving…' : 'Save screenshot'}
      </button>
      {status && <span className="save-shot-status">{status}</span>}
    </div>
  )
}
