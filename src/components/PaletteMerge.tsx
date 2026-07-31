import { useState } from 'react'
import type { PaletteColor } from '../lib/types'
import { PmsChartModal } from './PmsChartModal'

type Props = {
  palette: PaletteColor[]
  merges: Array<[number, number]>
  onChangeMerges: (merges: Array<[number, number]>) => void
  onOverridePms: (paletteIndex: number, pmsCode: string) => void
  /** Palette indices that are turned off. */
  disabledColors: number[]
  onChangeDisabledColors: (indices: number[]) => void
  disabled?: boolean
}

/**
 * Merge colors, toggle fills on/off, and assign Pantone Solid Coated (PMS) codes.
 * Collapsed by default to keep the settings column compact.
 */
export function PaletteMerge({
  palette,
  merges,
  onChangeMerges,
  onOverridePms,
  disabledColors,
  onChangeDisabledColors,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [mode, setMode] = useState<'merge' | 'pms'>('pms')

  const disabledSet = new Set(disabledColors)
  const onCount = palette.filter((c) => !disabledSet.has(c.index)).length

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
    if (disabledSet.has(index)) return
    if (mode === 'pms') {
      setPickerFor(index)
      return
    }
    if (selected == null) {
      setSelected(index)
    } else if (selected === index) {
      setSelected(null)
    } else {
      onChangeMerges([...merges, [selected, index]])
      setSelected(null)
    }
  }

  const onToggle = (index: number, currentlyOn: boolean) => {
    if (disabled) return
    if (currentlyOn && onCount <= 1) return
    if (currentlyOn) {
      onChangeDisabledColors([...disabledColors, index])
    } else {
      onChangeDisabledColors(disabledColors.filter((i) => i !== index))
    }
    if (selected === index) setSelected(null)
  }

  const effectiveColors = new Set(
    palette.filter((c) => !disabledSet.has(c.index)).map((c) => find(c.index)),
  ).size

  return (
    <div className={`palette-merge${open ? ' is-open' : ' is-collapsed'}`}>
      <button
        type="button"
        className="palette-merge-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <h2>Palette / PMS</h2>
        <span className="palette-merge-summary">
          {onCount}/{palette.length} on
          {merges.length > 0 ? ` · ${effectiveColors} after merge` : ''}
          <span className="palette-merge-chevron" aria-hidden>
            {open ? '▾' : '▸'}
          </span>
        </span>
      </button>

      {open && (
        <>
          <div className="palette-merge-head">
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
            Toggle a swatch off to fold its shapes into the nearest on color.
            {mode === 'pms'
              ? ' Click a swatch to pick a Pantone Solid Coated color.'
              : selected == null
                ? ' Click one on swatch, then another to combine them.'
                : ' Click a second on swatch to merge into the first.'}
          </p>

          <div className="palette-list">
            {palette.map((c) => {
              const isOn = !disabledSet.has(c.index)
              const lastOn = isOn && onCount <= 1
              return (
                <div
                  key={c.index}
                  className={`palette-row${selected === c.index ? ' selected' : ''}${
                    isOn ? '' : ' is-off'
                  }`}
                >
                  <button
                    type="button"
                    className={`palette-onoff${isOn ? ' is-on' : ''}`}
                    disabled={disabled || lastOn}
                    aria-pressed={isOn}
                    aria-label={
                      isOn
                        ? `Turn off ${c.pmsName ?? c.hex}`
                        : `Turn on ${c.pmsName ?? c.hex}`
                    }
                    title={
                      lastOn
                        ? 'At least one color must stay on'
                        : isOn
                          ? 'Turn off — shapes go to nearest on color'
                          : 'Turn on'
                    }
                    onClick={() => onToggle(c.index, isOn)}
                  >
                    {isOn ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    className="palette-row-main"
                    disabled={disabled || !isOn}
                    onClick={() => onSwatch(c.index)}
                    title={
                      !isOn
                        ? 'Turn on to edit'
                        : mode === 'pms'
                          ? `Assign PMS for ${c.hex}`
                          : `${c.hex} — click to merge`
                    }
                  >
                    <span className="swatch" style={{ background: c.hex }} />
                    <span className="palette-row-text">
                      <strong>{c.pmsName ?? c.hex}</strong>
                      <em>
                        {c.hex}
                        {c.pmsDeltaE != null && mode === 'pms'
                          ? ` · ΔE ${c.pmsDeltaE}`
                          : ''}
                        {!isOn ? ' · off' : ''}
                      </em>
                    </span>
                  </button>
                </div>
              )
            })}
          </div>

          {mode === 'merge' && merges.length > 0 && (
            <div className="palette-merge-foot">
              <p className="status">
                {merges.length} merge{merges.length === 1 ? '' : 's'} · effective{' '}
                {effectiveColors} colors
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

          {disabledColors.length > 0 && (
            <div className="palette-merge-foot">
              <p className="status">
                {disabledColors.length} color{disabledColors.length === 1 ? '' : 's'}{' '}
                off
              </p>
              <button
                type="button"
                className="linkish"
                disabled={disabled}
                onClick={() => onChangeDisabledColors([])}
              >
                Turn all on
              </button>
            </div>
          )}
        </>
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
