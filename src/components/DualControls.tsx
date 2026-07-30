import type { DualOutputSettings } from '../lib/pipeline'

type Props = {
  settings: DualOutputSettings
  onChange: (next: DualOutputSettings) => void
  disabled?: boolean
}

export function DualControls({ settings, onChange, disabled }: Props) {
  const patchOutline = (partial: Partial<DualOutputSettings['outline']>) => {
    onChange({ ...settings, outline: { ...settings.outline, ...partial } })
  }
  const patchVector = (partial: Partial<DualOutputSettings['vector']>) => {
    onChange({ ...settings, vector: { ...settings.vector, ...partial } })
  }

  return (
    <div>
      <h2>Vector outline (SVG)</h2>
      <div className="field">
        <label>
          <span>Detail</span>
          <span className="value">{settings.outline.sensitivity}</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.outline.sensitivity}
          disabled={disabled}
          onChange={(e) => patchOutline({ sensitivity: Number(e.target.value) })}
        />
      </div>
      <p className="hint">
        Line art keeps the ink itself (no double outlines). Color art strokes flat-fill
        boundaries. Lower Detail = cleaner / fewer lines. Changes update the preview live.
      </p>
      <div className="field">
        <label>
          <span>Stroke thickness</span>
          <span className="value">{settings.outline.thickness}px</span>
        </label>
        <input
          type="range"
          min={1}
          max={6}
          step={1}
          value={settings.outline.thickness}
          disabled={disabled}
          onChange={(e) => patchOutline({ thickness: Number(e.target.value) })}
        />
      </div>
      <p className="hint">
        Default 1px. Thickens clean strokes only — never adds edge-detection noise.
      </p>

      <h2>Color vector (SVG)</h2>
      <div className="field">
        <label>
          <span>Color count</span>
          <span className="value">{settings.vector.colorCount}</span>
        </label>
        <input
          type="range"
          min={2}
          max={16}
          step={1}
          value={settings.vector.colorCount}
          disabled={disabled}
          onChange={(e) => patchVector({ colorCount: Number(e.target.value) })}
        />
      </div>
      <p className="hint">
        Like Vectorizer.AI — flatten to N colors, then merge swatches or reassign PMS below.
      </p>

      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.vector.snapToPms}
          disabled={disabled}
          onChange={(e) => patchVector({ snapToPms: e.target.checked })}
        />
        <span>Snap fills to PMS Solid Coated</span>
      </label>
      <p className="hint">
        Maps each fill to the nearest Pantone code used for soft enamel pin matching.
      </p>
      <div className="field">
        <label>
          <span>Smoothness</span>
          <span className="value">{settings.vector.smoothness}</span>
        </label>
        <input
          type="range"
          min={0}
          max={5}
          step={1}
          value={settings.vector.smoothness}
          disabled={disabled}
          onChange={(e) => patchVector({ smoothness: Number(e.target.value) })}
        />
      </div>
      <div className="field">
        <label>
          <span>Detail cleanup</span>
          <span className="value">
            {(settings.vector.minRegionRatio * 10000).toFixed(1)}
          </span>
        </label>
        <input
          type="range"
          min={1}
          max={20}
          step={1}
          value={Math.round(settings.vector.minRegionRatio * 10000)}
          disabled={disabled}
          onChange={(e) =>
            patchVector({ minRegionRatio: Number(e.target.value) / 10000 })
          }
        />
      </div>
      <p className="hint">Higher cleanup merges tiny speckles before tracing.</p>
    </div>
  )
}
