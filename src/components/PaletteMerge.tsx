import { useState } from 'react'
import type { PaletteColor } from '../lib/types'
import { PmsChartModal } from './PmsChartModal'

type Props = {
  palette: PaletteColor[]
  merges: Array<[number, number]>
  onChangeMerges: (merges: Array<[number, number]>) => void
  onOverridePms: (paletteIndex: number, pmsCode: string) => void
  disabled?: boolean
}

/**
 * Merge colors and assign Pantone Solid Coated (PMS) codes per fill.
 */
export function PaletteMerge({
  palette,
  merges,
  onChangeMerges,
  onOverridePms,
  disabled,
}: Props) {
  const [selected, setSelected] = useState<number | null>(null)
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [mode, setMode] = useState<'merge' | 'pms'>('pms')

  const find = (i: number): number => {
    let cur = i
    for (let n = 0; n < merges.length + 2; n++) {
      const pair = merges.find(([a, b]) => a === cur || b === cur)
      if (!pair) break
      const other = pair[0] === cur ? pair[1] : pair[0]
      const next = Math.min(cur, other)
      if (next === cur) break
      cur = next
    }
    return cur
  }

  const onSwatch = (index: number) => {
    if (disabled) return
    if (mode === 'pms') {
      setPickerFor(index)
      return
    }
    if (selected == null) {
      setSelected(index)
      return
    }
    if (selected === index) {
      setSelected(null)
      return
    }
    onChangeMerges([...merges, [selected, index]])
    setSelected(null)
  }

  return (
    <div className="palette-merge">
      <div className="palette-merge-head">
        <h2>Palette / PMS</h2>
        <div className="tabs tiny-tabs" role="tablist">
          <button
            type="button"
            className={`tab ${mode === 'pms' ? 'active' : ''}`}
            onClick={() => {
              setMode('pms')
              setSelected(null)
            }}
          >
            PMS
          </button>
          <button
            type="button"
            className={`tab ${mode === 'merge' ? 'active' : ''}`}
            onClick={() => setMode('merge')}
          >
            Merge
          </button>
        </div>
      </div>

      <p className="hint">
        {mode === 'pms'
          ? 'Click a swatch to pick a Pantone Solid Coated color from the chart.'
          : selected == null
            ? 'Click one swatch, then another to combine them.'
            : 'Click a second swatch to merge into the first.'}
      </p>

      <div className="palette-list">
        {palette.map((c) => (
          <button
            key={c.index}
            type="button"
            className={`palette-row ${selected === c.index ? 'selected' : ''}`}
            disabled={disabled}
            onClick={() => onSwatch(c.index)}
            title={
              mode === 'pms'
                ? `Assign PMS for ${c.hex}`
                : `${c.hex} — click to merge`
            }
          >
            <span className="swatch" style={{ background: c.hex }} />
            <span className="palette-row-text">
              <strong>{c.pmsName ?? c.hex}</strong>
              <em>
                {c.hex}
                {c.pmsDeltaE != null && mode === 'pms' ? ` · ΔE ${c.pmsDeltaE}` : ''}
              </em>
            </span>
          </button>
        ))}
      </div>

      {mode === 'merge' && merges.length > 0 && (
        <div className="palette-merge-foot">
          <p className="status">
            {merges.length} merge{merges.length === 1 ? '' : 's'} · effective{' '}
            {new Set(palette.map((c) => find(c.index))).size} colors
          </p>
          <button
            type="button"
            className="linkish"
            disabled={disabled}
            onClick={() => {
              onChangeMerges([])
              setSelected(null)
            }}
          >
            Reset merges
          </button>
        </div>
      )}

      <PmsChartModal
        open={pickerFor != null}
        title={
          pickerFor != null
            ? `Assign PMS · slot ${pickerFor + 1}`
            : 'PMS Solid Coated'
        }
        onClose={() => setPickerFor(null)}
        onPick={(color) => {
          if (pickerFor == null) return
          onOverridePms(pickerFor, color.code)
        }}
      />
    </div>
  )
}
