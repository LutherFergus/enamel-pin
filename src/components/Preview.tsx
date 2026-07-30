import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import type { DualOutputResult } from '../lib/pipeline'

export type PreviewTab = 'source' | 'outline' | 'vector'

type Props = {
  viewMode: PreviewTab
  sourceUrl: string | null
  result: DualOutputResult | null
  busy: boolean
}

const MIN_SCALE = 1
const MAX_SCALE = 6

export function Preview({ viewMode, sourceUrl, result, busy }: Props) {
  const [vectorUrl, setVectorUrl] = useState<string | null>(null)
  const [outlineUrl, setOutlineUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!result) {
      setVectorUrl(null)
      setOutlineUrl(null)
      return
    }
    setVectorUrl(result.vector.svgUrl)
    setOutlineUrl(result.outline.svgUrl)
  }, [result])

  if (!sourceUrl && !result) {
    return (
      <div className="preview-stage">
        <div className="empty-state">
          <h3>Upload or generate</h3>
          <p>
            You’ll get two assets: a smooth vector outline SVG, and a flat-color
            vector SVG you can reduce by merging palette colors.
          </p>
        </div>
      </div>
    )
  }

  let content: ReactNode = (
    <div className="empty-state">
      <h3>Processing</h3>
      <p>Building outline and vector outputs…</p>
    </div>
  )

  if (viewMode === 'source' && sourceUrl) {
    content = <img src={sourceUrl} alt="Source artwork" draggable={false} />
  } else if (viewMode === 'outline' && outlineUrl) {
    content = (
      <img
        src={outlineUrl}
        alt="Smooth vector outline"
        draggable={false}
      />
    )
  } else if (viewMode === 'vector' && vectorUrl) {
    content = (
      <img src={vectorUrl} alt="Color-quantized vector preview" draggable={false} />
    )
  }

  return (
    <ZoomableStage busy={busy} resetKey={`${viewMode}:${sourceUrl}:${vectorUrl}:${outlineUrl}`}>
      {content}
    </ZoomableStage>
  )
}

type ZoomProps = {
  children: ReactNode
  busy: boolean
  resetKey: string
}

type Pt = { x: number; y: number }

function ZoomableStage({ children, busy, resetKey }: ZoomProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState<Pt>({ x: 0, y: 0 })

  const pointers = useRef(new Map<number, Pt>())
  const pinchStart = useRef<{ dist: number; scale: number; mid: Pt; offset: Pt } | null>(
    null,
  )
  const panStart = useRef<{ origin: Pt; offset: Pt } | null>(null)

  const resetView = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const clampOffset = useCallback((next: Pt, nextScale: number): Pt => {
    const el = viewportRef.current
    if (!el) return next
    const { clientWidth: w, clientHeight: h } = el
    const maxX = (w * (nextScale - 1)) / 2 + w * 0.25
    const maxY = (h * (nextScale - 1)) / 2 + h * 0.25
    return {
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    }
  }, [])

  useEffect(() => {
    resetView()
  }, [resetKey, resetView])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
      setScale((prev) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor))
        if (next === prev) return prev
        const rect = el.getBoundingClientRect()
        const cx = e.clientX - rect.left - rect.width / 2
        const cy = e.clientY - rect.top - rect.height / 2
        const ratio = next / prev
        setOffset((off) =>
          clampOffset(
            {
              x: cx - (cx - off.x) * ratio,
              y: cy - (cy - off.y) * ratio,
            },
            next,
          ),
        )
        return next
      })
    }
    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [clampOffset])

  const zoomAt = useCallback(
    (factor: number, center?: Pt) => {
      setScale((prev) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor))
        if (next === prev) return prev
        if (center && viewportRef.current) {
          const rect = viewportRef.current.getBoundingClientRect()
          const cx = center.x - rect.left - rect.width / 2
          const cy = center.y - rect.top - rect.height / 2
          const ratio = next / prev
          setOffset((off) =>
            clampOffset(
              {
                x: cx - (cx - off.x) * ratio,
                y: cy - (cy - off.y) * ratio,
              },
              next,
            ),
          )
        } else if (next === MIN_SCALE) {
          setOffset({ x: 0, y: 0 })
        }
        return next
      })
    },
    [clampOffset],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 1) {
      panStart.current = {
        origin: { x: e.clientX, y: e.clientY },
        offset: { ...offset },
      }
      pinchStart.current = null
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchStart.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        offset: { ...offset },
      }
      panStart.current = null
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      const nextScale = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, pinchStart.current.scale * (dist / pinchStart.current.dist)),
      )
      const ratio = nextScale / pinchStart.current.scale
      const el = viewportRef.current
      if (el) {
        const rect = el.getBoundingClientRect()
        const cx = pinchStart.current.mid.x - rect.left - rect.width / 2
        const cy = pinchStart.current.mid.y - rect.top - rect.height / 2
        const base = pinchStart.current.offset
        setScale(nextScale)
        setOffset(
          clampOffset(
            {
              x: cx - (cx - base.x) * ratio + (mid.x - pinchStart.current.mid.x),
              y: cy - (cy - base.y) * ratio + (mid.y - pinchStart.current.mid.y),
            },
            nextScale,
          ),
        )
      }
      return
    }

    if (pointers.current.size === 1 && panStart.current && scale > 1) {
      const dx = e.clientX - panStart.current.origin.x
      const dy = e.clientY - panStart.current.origin.y
      setOffset(
        clampOffset(
          {
            x: panStart.current.offset.x + dx,
            y: panStart.current.offset.y + dy,
          },
          scale,
        ),
      )
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    if (pointers.current.size < 2) pinchStart.current = null
    if (pointers.current.size === 0) panStart.current = null
    if (pointers.current.size === 1) {
      const [pt] = pointers.current.values()
      const [id] = pointers.current.keys()
      panStart.current = {
        origin: { ...pt },
        offset: { ...offset },
      }
      // keep capture on remaining pointer — already captured
      void id
    }
  }

  const onDoubleClick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (scale > 1.05) resetView()
    else zoomAt(2.2, { x: e.clientX, y: e.clientY })
  }

  return (
    <div className="preview-stage checker" aria-busy={busy}>
      <div
        ref={viewportRef}
        className={`preview-zoom-viewport${scale > 1 ? ' is-zoomed' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <div
          className="preview-zoom-layer"
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
          }}
        >
          {children}
        </div>
      </div>

      <div className="preview-zoom-controls" role="group" aria-label="Preview zoom">
        <button
          type="button"
          className="zoom-btn"
          aria-label="Zoom out"
          disabled={scale <= MIN_SCALE}
          onClick={() => zoomAt(1 / 1.35)}
        >
          −
        </button>
        <button
          type="button"
          className="zoom-btn zoom-fit"
          aria-label="Fit image"
          onClick={resetView}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          className="zoom-btn"
          aria-label="Zoom in"
          disabled={scale >= MAX_SCALE}
          onClick={() => zoomAt(1.35)}
        >
          +
        </button>
      </div>
    </div>
  )
}
