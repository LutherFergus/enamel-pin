import type { DualOutputSettings } from '../lib/pipeline'
import { detailRetentionParams } from '../lib/colorVectorize'

type Props = {
  settings: DualOutputSettings
  onChange: (next: DualOutputSettings) => void
  disabled?: boolean
  savedLabel?: string | null
  onResetDefaults?: () => void
}

export function DualControls({
  settings,
  onChange,
  disabled,
  savedLabel = null,
  onResetDefaults,
}: Props) {
  const patchOutline = (partial: Partial<DualOutputSettings['outline']>) => {
    onChange({ ...settings, outline: { ...settings.outline, ...partial } })
  }
  const patchVector = (partial: Partial<DualOutputSettings['vector']>) => {
    onChange({ ...settings, vector: { ...settings.vector, ...partial } })
  }
  const patchRoot = (partial: Partial<DualOutputSettings>) => {
    onChange({ ...settings, ...partial })
  }

  return (
    <div>
      <div className="remember-bar">
        <h2 className="remember-heading">Settings</h2>
        <div className="remember-actions">
          <button
            type="button"
            className="btn btn-secondary remember-btn"
            onClick={onResetDefaults}
            disabled={disabled || !onResetDefaults}
          >
            Reset defaults
          </button>
        </div>
      </div>
      <p className="hint remember-status saved">
        Auto-saves on this device
        {savedLabel ? ` · last change ${savedLabel}` : ''}. Reloads restore your
        latest sliders.
      </p>

      <h2>Background</h2>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.removeBackground}
          disabled={disabled}
          onChange={(e) => patchRoot({ removeBackground: e.target.checked })}
        />
        <span>Remove background</span>
      </label>
      <p className="hint">
        Clears solid studio backdrops without touching skin tones. Hit Reprocess
        after changing.
      </p>
      {settings.removeBackground && (
        <div className="field">
          <label>
            <span>Background tolerance</span>
            <span className="value">{settings.backgroundTolerance}</span>
          </label>
          <input
            type="range"
            min={8}
            max={80}
            step={1}
            value={settings.backgroundTolerance}
            disabled={disabled}
            onChange={(e) =>
              patchRoot({ backgroundTolerance: Number(e.target.value) })
            }
          />
        </div>
      )}
      {settings.removeBackground && (
        <p className="hint">
          Higher = more aggressive knockout. Skin tones are always protected.
        </p>
      )}

      <h2>Stroke outline (SVG + PNG)</h2>
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
        0 keeps thin Vectorizer-style die-lines. Higher fattens metal walls after
        tracing. Transparent plate — strokes only, not flooded black fills.
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
          max={32}
          step={1}
          value={settings.vector.colorCount}
          disabled={disabled}
          onChange={(e) => patchVector({ colorCount: Number(e.target.value) })}
        />
      </div>
      <p className="hint">
        Subject-aware colors (skin, reds, accents) before majority grays — matching
        Vectorizer/VectorQ priority, up to 32 fills.
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
          <span>PMS match tolerance</span>
          <span className="value">ΔE {settings.vector.pmsTolerance}</span>
        </label>
        <input
          type="range"
          min={0}
          max={30}
          step={1}
          value={settings.vector.pmsTolerance}
          disabled={disabled}
          onChange={(e) =>
            patchVector({ pmsTolerance: Number(e.target.value) })
          }
        />
      </div>
      <p className="hint">
        Higher combines near-matching fills (e.g. six near-blacks → one Black).
        0 keeps every quantized shade distinct. Reprocess to apply.
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
        Higher = true vector curves (supersampled spline fit). This is what
        “vectorize” means — geometry, not traced pixels.
      </p>
      <div className="field">
        <label>
          <span>Detail retention</span>
          <span className="value">{settings.vector.detailRetention}</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.vector.detailRetention}
          disabled={disabled}
          onChange={(e) => {
            const detailRetention = Number(e.target.value)
            const { minRegionRatio } = detailRetentionParams(detailRetention)
            patchVector({ detailRetention, minRegionRatio })
          }}
        />
      </div>
      <p className="hint">
        Higher keeps small shapes (dots, fins, linework). Lower merges speckles
        into larger flats. Reprocess to apply.
      </p>
    </div>
  )
}
