import { useEffect, useState } from 'react'
import type { DualOutputResult } from '../lib/pipeline'

export type PreviewTab = 'source' | 'vector' | 'outline' | 'proof'

type Props = {
  viewMode: PreviewTab
  sourceUrl: string | null
  result: DualOutputResult | null
  busy: boolean
}

export function Preview({ viewMode, sourceUrl, result, busy }: Props) {
  const [vectorUrl, setVectorUrl] = useState<string | null>(null)
  const [proofUrl, setProofUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!result) {
      setVectorUrl(null)
      setProofUrl(null)
      return
    }
    setVectorUrl(result.vector.svgUrl)
    setProofUrl(result.proof.svgUrl)
  }, [result])

  if (!sourceUrl && !result) {
    return (
      <div className="preview-stage">
        <div className="empty-state">
          <h3>Upload or generate</h3>
          <p>
            You’ll get transparent outline SVG/PNG die-lines, a flat-color
            vector SVG, and a combined Proof SVG (vector + outline).
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="preview-stage checker" aria-busy={busy}>
      {viewMode === 'source' && sourceUrl ? (
        <img src={sourceUrl} alt="Original artwork" />
      ) : viewMode === 'vector' && vectorUrl ? (
        <img src={vectorUrl} alt="Color-quantized vector preview" />
      ) : viewMode === 'outline' && result ? (
        <img
          src={result.outline.svgUrl}
          alt="Stroke outline SVG on transparent background"
        />
      ) : viewMode === 'proof' && proofUrl ? (
        <img src={proofUrl} alt="Proof SVG — vector fills with outline die-lines" />
      ) : (
        <div className="empty-state">
          <h3>Processing</h3>
          <p>Building outline, vector, and proof outputs…</p>
        </div>
      )}
    </div>
  )
}
