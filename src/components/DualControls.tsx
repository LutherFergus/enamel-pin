import type { DualOutputSettings } from '../lib/pipeline'
import { detailRetentionParams } from '../lib/colorVectorize'

type Props = {
  settings: DualOutputSettings
  onChange: (next: DualOutputSettings) => void
  disabled?: boolean
  savedLabel?: string | null
  onResetDefaults?: () => void
}

function roundInt(n: number) {
  return Math.round(n)
}

function formatPx(n: number) {
  const v = Math.round(n * 100) / 100
  return Number.isInteger(v) ? `${v}` : String(v)
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
            <span className="value">{roundInt(settings.backgroundTolerance)}</span>
          </label>
          <input
            type="range"
            min={8}
            max={80}
            step="any"
            value={settings.backgroundTolerance}
            disabled={disabled}
            onChange={(e) =>
              patchRoot({ backgroundTolerance: roundInt(Number(e.target.value)) })
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
          <span className="value">{roundInt(settings.outline.sensitivity)}</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step="any"
          value={settings.outline.sensitivity}
          disabled={disabled}
          onChange={(e) =>
            patchOutline({ sensitivity: roundInt(Number(e.target.value)) })
          }
        />
      </div>
      <p className="hint">
        Extracts dark metal walls / ink and silhouette edges. Higher keeps thinner
        hatches without flooding gaps. Reprocess to apply.
      </p>
      <div className="field">
        <label>
          <span>Stroke thickness</span>
          <span className="value">{formatPx(settings.outline.thickness)}px</span>
        </label>
        <input
          type="range"
          min={0.1}
          max={6}
          step="any"
          value={settings.outline.thickness}
          disabled={disabled}
          onChange={(e) => {
            const thickness =
              Math.round(Math.max(0.1, Math.min(6, Number(e.target.value))) * 100) / 100
            patchOutline({ thickness })
          }}
        />
      </div>
      <p className="hint">
        Relative to a fixed working size so weight stays consistent across photos.
        0.1px is the finest hairline. Reprocess to apply.
      </p>

      <h2>Color vector (SVG)</h2>
      <div className="field">
        <label>
          <span>Color count</span>
          <span className="value">{roundInt(settings.vector.colorCount)}</span>
        </label>
        <input
          type="range"
          min={4}
          max={32}
          step="any"
          value={settings.vector.colorCount}
          disabled={disabled}
          onChange={(e) =>
            patchVector({ colorCount: roundInt(Number(e.target.value)) })
          }
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
          <span className="value">ΔE {roundInt(settings.vector.pmsTolerance)}</span>
        </label>
        <input
          type="range"
          min={0}
          max={30}
          step="any"
          value={settings.vector.pmsTolerance}
          disabled={disabled}
          onChange={(e) =>
            patchVector({ pmsTolerance: roundInt(Number(e.target.value)) })
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
          <span className="value">{roundInt(settings.vector.smoothness)}</span>
        </label>
        <input
          type="range"
          min={0}
          max={5}
          step="any"
          value={settings.vector.smoothness}
          disabled={disabled}
          onChange={(e) =>
            patchVector({ smoothness: roundInt(Number(e.target.value)) })
          }
        />
      </div>
      <p className="hint">
        Higher = true vector curves (supersampled spline fit). This is what
        “vectorize” means — geometry, not traced pixels.
      </p>
      <div className="field">
        <label>
          <span>Detail retention</span>
          <span className="value">{roundInt(settings.vector.detailRetention)}</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step="any"
          value={settings.vector.detailRetention}
          disabled={disabled}
          onChange={(e) => {
            const detailRetention = roundInt(Number(e.target.value))
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
