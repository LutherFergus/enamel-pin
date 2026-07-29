import { useMemo, useState } from 'react'
import { getPmsBookNote, searchPms, type PmsColor } from '../lib/pms'

type Props = {
  open: boolean
  title?: string
  onClose: () => void
  onPick: (color: PmsColor) => void
}

export function PmsChartModal({ open, title, onClose, onPick }: Props) {
  const [query, setQuery] = useState('')
  const results = useMemo(() => searchPms(query), [query])

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-label={title ?? 'PMS Solid Coated chart'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{title ?? 'PMS Solid Coated'}</h2>
            <p className="hint">{getPmsBookNote()}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="field">
          <label htmlFor="pms-search">
            <span>Search PMS</span>
          </label>
          <input
            id="pms-search"
            type="search"
            placeholder="e.g. 185, Black, #E4002B"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="pms-grid">
          {results.map((c) => (
            <button
              key={c.code}
              type="button"
              className="pms-swatch"
              title={`${c.name} · ${c.hex}`}
              onClick={() => {
                onPick(c)
                onClose()
              }}
            >
              <span className="pms-chip" style={{ background: c.hex }} />
              <span className="pms-label">
                <strong>{c.code}</strong>
                <em>{c.hex}</em>
              </span>
            </button>
          ))}
          {results.length === 0 && (
            <p className="status">No PMS matches for “{query}”.</p>
          )}
        </div>
      </div>
    </div>
  )
}
