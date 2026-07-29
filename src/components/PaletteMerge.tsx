import { useState } from 'react'
import type { PaletteColor } from '../lib/types'

type Props = {
  palette: PaletteColor[]
  merges: Array<[number, number]>
  onChangeMerges: (merges: Array<[number, number]>) => void
  disabled?: boolean
}

/**
 * Click two swatches to merge them into one color (lowers effective color count).
 */
export function PaletteMerge({ palette, merges, onChangeMerges, disabled }: Props) {
  const [selected, setSelected] = useState<number | null>(null)

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
        <h2>Merge colors</h2>
        {merges.length > 0 && (
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
        )}
      </div>
      <p className="hint">
        {selected == null
          ? 'Click one swatch, then another to combine them.'
          : 'Click a second swatch to merge into the first.'}
      </p>
      <div className="palette">
        {palette.map((c) => (
          <button
            key={c.index}
            type="button"
            className={`swatch swatch-btn ${selected === c.index ? 'selected' : ''}`}
            title={`${c.hex} — click to merge`}
            style={{ background: c.hex }}
            disabled={disabled}
            onClick={() => onSwatch(c.index)}
          />
        ))}
      </div>
      {merges.length > 0 && (
        <p className="status">
          {merges.length} merge{merges.length === 1 ? '' : 's'} applied · effective{' '}
          {new Set(palette.map((c) => find(c.index))).size} colors
        </p>
      )}
    </div>
  )
}
