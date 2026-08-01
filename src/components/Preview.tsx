import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type {
  MatchOverlaySettings,
  MatchReferences,
} from '../lib/matchOverlay'
import type { DualOutputResult } from '../lib/pipeline'

export type PreviewTab = 'source' | 'vector' | 'outline' | 'proof' | 'final'

type Props = {
  viewMode: PreviewTab
  sourceUrl: string | null
  result: DualOutputResult | null
  busy: boolean
  match?: MatchOverlaySettings
  matchRefs?: MatchReferences
}

function MatchStack({
  oursUrl,
  oursAlt,
  refUrl,
  match,
}: {
  oursUrl: string
  oursAlt: string
  refUrl: string
  match: MatchOverlaySettings
}) {
  const scale = match.scalePct / 100
  const refStyle: CSSProperties = {
    opacity: match.refOpacity / 100,
    transform: `translate(${match.offsetX}%, ${match.offsetY}%) scale(${scale})`,
  }
  return (
    <div
      className={`match-stack${match.difference ? ' match-stack-diff' : ''}`}
    >
      <img
        className="match-ours"
        src={oursUrl}
        alt={oursAlt}
        draggable={false}
        style={{ opacity: match.oursOpacity / 100 }}
      />
      <img
        className="match-ref"
        src={refUrl}
        alt="Your reference SVG overlay"
        draggable={false}
        style={refStyle}
      />
    </div>
  )
}

const MIN_SCALE = 1
const MAX_SCALE = 6

type Transform = { scale: number; x: number; y: number }

const IDENTITY: Transform = { scale: 1, x: 0, y: 0 }

function clampScale(s: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function midpoint(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/**
 * Pinch / wheel zoom + pan for the artwork preview (iOS Safari + desktop).
 * Resets when the active tab or media URL changes.
 */
function ZoomViewport({
  resetKey,
  busy,
  children,
}: {
  resetKey: string
  busy: boolean
  children: ReactNode
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<Transform>(IDENTITY)
  const transformRef = useRef(transform)
  transformRef.current = transform

  const pointers = useRef(
    new Map<number, { x: number; y: number }>(),
  )
  const pinchStart = useRef<{
    distance: number
    scale: number
    mid: { x: number; y: number }
    origin: Transform
  } | null>(null)
  const panStart = useRef<{
    x: number
    y: number
    origin: Transform
  } | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null)

  useEffect(() => {
    setTransform(IDENTITY)
    pointers.current.clear()
    pinchStart.current = null
    panStart.current = null
  }, [resetKey])

  // Non-passive wheel so trackpad pinch / ctrl+scroll can zoom without scrolling the page.
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left - rect.width / 2
      const my = e.clientY - rect.top - rect.height / 2
      const factor = Math.exp(-e.deltaY * 0.01)
      setTransform((t) => {
        const nextScale = clampScale(t.scale * factor)
        const ratio = nextScale / t.scale
        return {
          scale: nextScale,
          x: mx - (mx - t.x) * ratio,
          y: my - (my - t.y) * ratio,
        }
      })
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const el = viewportRef.current
    if (!el) return
    el.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = {
        distance: Math.max(1, distance(a, b)),
        scale: transformRef.current.scale,
        mid: midpoint(a, b),
        origin: { ...transformRef.current },
      }
      panStart.current = null
    } else if (pointers.current.size === 1) {
      panStart.current = {
        x: e.clientX,
        y: e.clientY,
        origin: { ...transformRef.current },
      }
      pinchStart.current = null

      // Double-tap toggle zoom (iOS-friendly).
      const now = performance.now()
      const prev = lastTap.current
      if (
        prev &&
        now - prev.t < 280 &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 28
      ) {
        lastTap.current = null
        const rect = el.getBoundingClientRect()
        const cx = e.clientX - rect.left - rect.width / 2
        const cy = e.clientY - rect.top - rect.height / 2
        setTransform((t) => {
          if (t.scale > 1.05) return IDENTITY
          const scale = 2.5
          return {
            scale,
            x: -cx * (scale - 1),
            y: -cy * (scale - 1),
          }
        })
        panStart.current = null
      } else {
        lastTap.current = { t: now, x: e.clientX, y: e.clientY }
      }
    }
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size >= 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.max(1, distance(a, b))
      const mid = midpoint(a, b)
      const start = pinchStart.current
      const nextScale = clampScale(start.scale * (dist / start.distance))
      // Keep the pinch midpoint stable in viewport space.
      const el = viewportRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const lx = start.mid.x - rect.left - rect.width / 2
      const ly = start.mid.y - rect.top - rect.height / 2
      const nx = mid.x - rect.left - rect.width / 2
      const ny = mid.y - rect.top - rect.height / 2
      setTransform({
        scale: nextScale,
        x: nx - (lx - start.origin.x) * (nextScale / start.origin.scale),
        y: ny - (ly - start.origin.y) * (nextScale / start.origin.scale),
      })
      return
    }

    if (
      pointers.current.size === 1 &&
      panStart.current &&
      transformRef.current.scale > 1.01
    ) {
      const start = panStart.current
      setTransform({
        scale: start.origin.scale,
        x: start.origin.x + (e.clientX - start.x),
        y: start.origin.y + (e.clientY - start.y),
      })
    }
  }, [])

  const endPointer = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchStart.current = null
    if (pointers.current.size === 0) panStart.current = null
    if (pointers.current.size === 1) {
      const only = [...pointers.current.values()][0]
      panStart.current = {
        x: only.x,
        y: only.y,
        origin: { ...transformRef.current },
      }
    }
    try {
      viewportRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }, [])

  const zoomed = transform.scale > 1.02

  return (
    <div
      ref={viewportRef}
      className={`preview-stage checker${zoomed ? ' is-zoomed' : ''}`}
      aria-busy={busy}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
    >
      <div
        className="preview-zoom-layer"
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        }}
      >
        {children}
      </div>
      {zoomed && (
        <button
          type="button"
          className="preview-zoom-reset"
          onClick={() => setTransform(IDENTITY)}
        >
          Reset zoom
        </button>
      )}
    </div>
  )
}

export function Preview({
  viewMode,
  sourceUrl,
  result,
  busy,
  match,
  matchRefs,
}: Props) {
  const [vectorUrl, setVectorUrl] = useState<string | null>(null)
  const [proofUrl, setProofUrl] = useState<string | null>(null)
  const [finalUrl, setFinalUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!result) {
      setVectorUrl(null)
      setProofUrl(null)
      setFinalUrl(null)
      return
    }
    setVectorUrl(result.vector.svgUrl)
    setProofUrl(result.proof.svgUrl)
    setFinalUrl(result.final?.svgUrl ?? null)
  }, [result])

  if (!sourceUrl && !result) {
    return (
      <div className="preview-stage">
        <div className="empty-state">
          <h3>Upload or generate</h3>
          <p>
            You’ll get transparent outline SVG/PNG die-lines, a flat-color
            vector SVG, and a combined Proof SVG (vector + outline). Use Clean
            up for a Final SVG with one dominant color per outline cell. Under
            Settings → Match my SVG, overlay your reference Outline/Vector to
            line up edges.
          </p>
        </div>
      </div>
    )
  }

  const overlayOn = !!match?.enabled
  const outlineRef = matchRefs?.outlineUrl ?? null
  const vectorRef = matchRefs?.vectorUrl ?? null

  let media: ReactNode = (
    <div className="empty-state">
      <h3>Processing</h3>
      <p>Building outline, vector, and proof outputs…</p>
    </div>
  )
  let mediaKey = `${viewMode}:empty`

  if (viewMode === 'source' && sourceUrl) {
    media = <img src={sourceUrl} alt="Original artwork" draggable={false} />
    mediaKey = `source:${sourceUrl}`
  } else if (viewMode === 'vector' && vectorUrl) {
    if (overlayOn && match && vectorRef) {
      media = (
        <MatchStack
          oursUrl={vectorUrl}
          oursAlt="Color-quantized vector preview"
          refUrl={vectorRef}
          match={match}
        />
      )
      // Keep key stable across nudge/opacity so zoom doesn’t reset.
      mediaKey = `vector-match:${vectorUrl}:${vectorRef}`
    } else {
      media = (
        <img
          src={vectorUrl}
          alt="Color-quantized vector preview"
          draggable={false}
        />
      )
      mediaKey = `vector:${vectorUrl}`
    }
  } else if (viewMode === 'outline' && result) {
    if (overlayOn && match && outlineRef) {
      media = (
        <MatchStack
          oursUrl={result.outline.svgUrl}
          oursAlt="Stroke outline SVG on transparent background"
          refUrl={outlineRef}
          match={match}
        />
      )
      mediaKey = `outline-match:${result.outline.svgUrl}:${outlineRef}`
    } else {
      media = (
        <img
          src={result.outline.svgUrl}
          alt="Stroke outline SVG on transparent background"
          draggable={false}
        />
      )
      mediaKey = `outline:${result.outline.svgUrl}`
    }
  } else if (viewMode === 'proof' && proofUrl) {
    // Prefer outline ref on Proof (die-line match); fall back to vector ref.
    const proofRef = outlineRef ?? vectorRef
    if (overlayOn && match && proofRef) {
      media = (
        <MatchStack
          oursUrl={proofUrl}
          oursAlt="Proof SVG — vector fills with outline die-lines"
          refUrl={proofRef}
          match={match}
        />
      )
      mediaKey = `proof-match:${proofUrl}:${proofRef}`
    } else {
      media = (
        <img
          src={proofUrl}
          alt="Proof SVG — vector fills with outline die-lines"
          draggable={false}
        />
      )
      mediaKey = `proof:${proofUrl}`
    }
  } else if (viewMode === 'final' && finalUrl) {
    media = (
      <img
        src={finalUrl}
        alt="Final SVG — dominant color per outline cell"
        draggable={false}
      />
    )
    mediaKey = `final:${finalUrl}`
  } else if (viewMode === 'final') {
    media = (
      <div className="empty-state">
        <h3>Final</h3>
        <p>
          Run <strong>Clean up</strong> to complete incomplete fills inside the
          outline (keeps Proof colors — doesn’t flatten cells). The result appears here.
        </p>
      </div>
    )
    mediaKey = 'final:empty'
  }

  return (
    <ZoomViewport resetKey={mediaKey} busy={busy || false}>
      {media}
    </ZoomViewport>
  )
}
