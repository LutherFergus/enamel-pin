import { useMemo, useState, type CSSProperties } from 'react'
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

function formatPercent(p: number | undefined): string {
  if (p == null || !Number.isFinite(p)) return '—'
  if (p > 0 && p < 0.1) return '<0.1%'
  if (p < 10) return `${p.toFixed(1)}%`
  return `${Math.round(p)}%`
}

function bubbleSizePx(percent: number | undefined, maxPercent: number): number {
  const p = Math.max(0, percent ?? 0)
  const norm = maxPercent > 0 ? p / maxPercent : 0
  // Vectorizer-style: dominant colors read larger; tiny fills stay tappable.
  return Math.round(34 + Math.sqrt(norm) * 38)
}

function contrastInk(hex: string): string {
  const cleaned = hex.replace('#', '')
  if (cleaned.length < 6) return '#1c1915'
  const r = Number.parseInt(cleaned.slice(0, 2), 16)
  const g = Number.parseInt(cleaned.slice(2, 4), 16)
  const b = Number.parseInt(cleaned.slice(4, 6), 16)
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return L > 160 ? '#1c1915' : '#fffdf8'
}

/**
 * Vectorizer.AI-style color bubbles sized by subject area %, with PMS / merge.
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
  const [selected, setSelected] = useState<number | null>(null)
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  const [mode, setMode] = useState<'edit' | 'merge' | 'pms'>('edit')

  const disabledSet = new Set(disabledColors)
  const onCount = palette.filter((c) => !disabledSet.has(c.index)).length

  const maxPercent = useMemo(
    () => Math.max(1, ...palette.map((c) => c.areaPercent ?? 0)),
    [palette],
  )

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

  const onBubble = (index: number) => {
    if (disabled) return
    const isOn = !disabledSet.has(index)

    if (mode === 'edit') {
      // Click toggles the fill on/off (Vectorizer-style remove color).
      if (isOn && onCount <= 1) return
      if (isOn) onChangeDisabledColors([...disabledColors, index])
      else onChangeDisabledColors(disabledColors.filter((i) => i !== index))
      if (selected === index) setSelected(null)
      return
    }

    if (!isOn) return

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

  const effectiveColors = new Set(
    palette.filter((c) => !disabledSet.has(c.index)).map((c) => find(c.index)),
  ).size

  const hint =
    mode === 'edit'
      ? 'Bubbles sized by subject area after background removal. Click to turn a color off/on.'
      : mode === 'pms'
        ? 'Click a bubble to assign a Pantone Solid Coated color.'
        : selected == null
          ? 'Click one on bubble, then another to merge them.'
          : 'Click a second bubble to merge into the first.'

  return (
    <div className="palette-merge">
      <div className="palette-merge-head">
        <h2>Palette</h2>
        <div className="tabs tiny-tabs" role="tablist" aria-label="Palette mode">
          <button
            type="button"
            className={`tab ${mode === 'edit' ? 'active' : ''}`}
            onClick={() => {
              setMode('edit')
              setSelected(null)
            }}
          >
            Edit
          </button>
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

      <p className="hint">{hint}</p>

      <div className="palette-bubbles" role="list">
        {palette.map((c) => {
          const isOn = !disabledSet.has(c.index)
          const size = bubbleSizePx(c.areaPercent, maxPercent)
          const ink = contrastInk(c.hex)
          const lastOn = isOn && onCount <= 1 && mode === 'edit'
          return (
            <button
              key={c.index}
              type="button"
              role="listitem"
              className={`palette-bubble${selected === c.index ? ' selected' : ''}${
                isOn ? '' : ' is-off'
              }`}
              style={
                {
                  '--bubble-size': `${size}px`,
                  '--bubble-fill': c.hex,
                  '--bubble-ink': ink,
                } as CSSProperties
              }
              disabled={disabled || lastOn || (mode !== 'edit' && !isOn)}
              aria-pressed={mode === 'edit' ? isOn : undefined}
              aria-label={`${c.pmsName ?? c.hex}, ${formatPercent(c.areaPercent)}${
                isOn ? '' : ', off'
              }`}
              title={
                lastOn
                  ? 'At least one color must stay on'
                  : [
                      c.pmsName ?? c.hex,
                      formatPercent(c.areaPercent),
                      c.hex,
                      !isOn ? 'off' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
              }
              onClick={() => onBubble(c.index)}
            >
              <span className="palette-bubble-disk" aria-hidden />
              <span className="palette-bubble-pct">{formatPercent(c.areaPercent)}</span>
              {!isOn && <span className="palette-bubble-x" aria-hidden />}
            </button>
          )
        })}
      </div>

      <div className="palette-bubble-legend">
        <span>
          {onCount}/{palette.length} on
          {merges.length > 0 ? ` · ${effectiveColors} after merge` : ''}
        </span>
        {(merges.length > 0 || disabledColors.length > 0) && (
          <span className="palette-bubble-actions">
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
            {disabledColors.length > 0 && (
              <button
                type="button"
                className="linkish"
                disabled={disabled}
                onClick={() => onChangeDisabledColors([])}
              >
                Turn all on
              </button>
            )}
          </span>
        )}
      </div>

      <ul className="palette-bubble-details">
        {palette.map((c) => {
          const isOn = !disabledSet.has(c.index)
          return (
            <li key={c.index} className={isOn ? undefined : 'is-off'}>
              <span className="palette-detail-swatch" style={{ background: c.hex }} />
              <span className="palette-detail-text">
                <strong>{formatPercent(c.areaPercent)}</strong>
                <em>
                  {c.pmsName ?? c.hex}
                  {c.pmsDeltaE != null ? ` · ΔE ${c.pmsDeltaE}` : ''}
                  {!isOn ? ' · off' : ''}
                </em>
              </span>
            </li>
          )
        })}
      </ul>

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
