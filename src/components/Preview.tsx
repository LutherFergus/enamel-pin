import { useEffect, useState } from 'react'
import type { VectorizeResult } from '../lib/types'

type Props = {
  viewMode: 'result' | 'source'
  sourceUrl: string | null
  result: VectorizeResult | null
  busy: boolean
}

export function Preview({ viewMode, sourceUrl, result, busy }: Props) {
  const [svgUrl, setSvgUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!result) {
      setSvgUrl(null)
      return
    }
    const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    setSvgUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [result])

  if (!sourceUrl && !result) {
    return (
      <div className="preview-stage">
        <div className="empty-state">
          <h3>Ready for artwork</h3>
          <p>Upload a design. We’ll posterize it, merge tiny fills, and cut metal lines between colors.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="preview-stage" aria-busy={busy}>
      {viewMode === 'source' && sourceUrl ? (
        <img src={sourceUrl} alt="Source artwork" />
      ) : svgUrl ? (
        <img src={svgUrl} alt="Vectorized enamel pin preview" />
      ) : (
        <div className="empty-state">
          <h3>Processing</h3>
          <p>Building enamel fills…</p>
        </div>
      )}
    </div>
  )
}
