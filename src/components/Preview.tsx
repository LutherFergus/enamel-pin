import { useEffect, useState } from 'react'
import type { DualOutputResult } from '../lib/pipeline'

export type PreviewTab = 'source' | 'outline' | 'vector'

type Props = {
  viewMode: PreviewTab
  sourceUrl: string | null
  result: DualOutputResult | null
  busy: boolean
}

export function Preview({ viewMode, sourceUrl, result, busy }: Props) {
  const [vectorUrl, setVectorUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!result) {
      setVectorUrl(null)
      return
    }
    setVectorUrl(result.vector.svgUrl)
  }, [result])

  if (!sourceUrl && !result) {
    return (
      <div className="preview-stage">
        <div className="empty-state">
          <h3>Upload or generate</h3>
          <p>
            You’ll get two assets: a transparent stroke-outline PNG, and a flat-color
            vector SVG you can reduce by merging palette colors.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="preview-stage checker" aria-busy={busy}>
      {viewMode === 'source' && sourceUrl ? (
        <img src={sourceUrl} alt="Source artwork" />
      ) : viewMode === 'outline' && result ? (
        <img src={result.outline.pngUrl} alt="Stroke outline on transparent background" />
      ) : viewMode === 'vector' && vectorUrl ? (
        <img src={vectorUrl} alt="Color-quantized vector preview" />
      ) : (
        <div className="empty-state">
          <h3>Processing</h3>
          <p>Building outline and vector outputs…</p>
        </div>
      )}
    </div>
  )
}
