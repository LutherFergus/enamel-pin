import { useCallback, useState } from 'react'
import { toPng } from 'html-to-image'

type Props = {
  targetSelector?: string
  label?: string
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
    try {
      const node = document.querySelector(targetSelector)
      if (!(node instanceof HTMLElement)) {
        throw new Error(`Nothing to capture (${targetSelector})`)
      }

      const dataUrl = await toPng(node, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#f3efe6',
      })

      const res = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, label }),
      })
      const payload = (await res.json()) as { ok?: boolean; filename?: string; error?: string }
      if (!res.ok || !payload.ok) {
        throw new Error(payload.error || `Save failed (${res.status})`)
      }
      setStatus(`Saved ${payload.filename}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Screenshot failed')
    } finally {
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
