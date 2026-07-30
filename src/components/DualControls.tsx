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
      <h2>Stroke outline (PNG)</h2>
      <div className="field">
        <label>
          <span>Outline detail</span>
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
        Extracts existing dark metal walls / ink. Lower = only strongest die-lines. Higher =
        includes thinner hatches.
      </p>
      <div className="field">
        <label>
          <span>Stroke thickness</span>
          <span className="value">{settings.outline.thickness}px</span>
        </label>
        <input
          type="range"
          min={0}
          max={6}
          step={1}
          value={settings.outline.thickness}
          disabled={disabled}
          onChange={(e) => patchOutline({ thickness: Number(e.target.value) })}
        />
      </div>
      <p className="hint">
        Transparent PNG of ink die-lines only — not fuzzy photo edges or flooded fills.
      </p>

      <h2>Color vector (SVG)</h2>
      <div className="field">
        <label>
          <span>Color count</span>
          <span className="value">{settings.vector.colorCount}</span>
        </label>
        <input
          type="range"
          min={4}
          max={18}
          step={1}
          value={settings.vector.colorCount}
          disabled={disabled}
          onChange={(e) => patchVector({ colorCount: Number(e.target.value) })}
        />
      </div>
      <p className="hint">
        Majority colors first (primary → secondary → tertiary accents). Keeps vivid detail
        colors instead of averaging them into muted midtones.
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
      <p className="hint">
        Higher = smoother Vectorizer-style curves (less pixel stair-step). Lower = tighter to
        the quantized edge.
      </p>
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
