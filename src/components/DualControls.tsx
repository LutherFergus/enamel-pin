import { useRef } from 'react'
import type { DualOutputSettings } from '../lib/pipeline'
import { detailRetentionParams } from '../lib/colorVectorize'
import type { MatchReferences } from '../lib/matchOverlay'

type Props = {
  settings: DualOutputSettings
  onChange: (next: DualOutputSettings) => void
  disabled?: boolean
  savedLabel?: string | null
  onResetDefaults?: () => void
  /** Uploaded reference SVGs for live overlay match. */
  matchRefs?: MatchReferences
  onMatchOutlineFile?: (file: File | null) => void
  onMatchVectorFile?: (file: File | null) => void
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
  matchRefs,
  onMatchOutlineFile,
  onMatchVectorFile,
}: Props) {
  const outlineRefInput = useRef<HTMLInputElement>(null)
  const vectorRefInput = useRef<HTMLInputElement>(null)

  const patchOutline = (partial: Partial<DualOutputSettings['outline']>) => {
    onChange({ ...settings, outline: { ...settings.outline, ...partial } })
  }
  const patchVector = (partial: Partial<DualOutputSettings['vector']>) => {
    onChange({ ...settings, vector: { ...settings.vector, ...partial } })
  }
  const patchMatch = (partial: Partial<DualOutputSettings['match']>) => {
    onChange({ ...settings, match: { ...settings.match, ...partial } })
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
        On: clears paper/studio outside the subject only — interior whites
        (foam, apron, diamonds, eyes) stay. Off: keeps the full paper opaque
        (including source PNG transparency, filled back to white). Hit
        Reprocess after changing.
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
        Extracts dark metal walls / ink, silhouette edges, and color-to-color
        abutments (e.g. white|blue fills). Higher keeps thinner hatches without
        flooding gaps. Reprocess to apply.
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
        Working size is normalized so weight stays consistent across photos.
        0.1px is the finest hairline. Reprocess to apply.
      </p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.outline.invert}
          disabled={disabled}
          onChange={(e) => patchOutline({ invert: e.target.checked })}
        />
        <span>Invert outline (white ink)</span>
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.outline.outlineNeutrals === true}
          disabled={disabled}
          onChange={(e) => patchOutline({ outlineNeutrals: e.target.checked })}
        />
        <span>Outline white / gray fills</span>
      </label>
      <p className="hint">
        Adds metal walls between white, gray, and black enamel (whiskers, fur
        highlights). Can look noisy on soft shading — off by default. Reprocess
        to apply.
      </p>
      <div className="field">
        <label>
          <span>Outline resolution</span>
          <span className="value">{roundInt(settings.outline.maxDim)}px</span>
        </label>
        <input
          type="range"
          min={800}
          max={2000}
          step={50}
          value={settings.outline.maxDim}
          disabled={disabled}
          onChange={(e) =>
            patchOutline({ maxDim: roundInt(Number(e.target.value)) })
          }
        />
      </div>
      <p className="hint">
        Working long-edge for the die-line plate (imaengine refs ≈ 1800). Higher
        = finer curves when zoomed. Reprocess to apply.
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
          <span>Min fill / gap</span>
          <span className="value">{settings.vector.minFillMm.toFixed(2)} mm</span>
        </label>
        <input
          type="range"
          min={0.3}
          max={1.2}
          step={0.05}
          value={settings.vector.minFillMm}
          disabled={disabled}
          onChange={(e) =>
            patchVector({
              minFillMm: Math.round(Number(e.target.value) * 100) / 100,
            })
          }
        />
      </div>
      <p className="hint">
        Soft-enamel floor: color pockets and gaps ≥ this size stay in the vector.
        Default 0.3mm. Reprocess to apply.
      </p>
      <div className="field">
        <label>
          <span>Pin width (scale)</span>
          <span className="value">{roundInt(settings.vector.pinWidthMm)} mm</span>
        </label>
        <input
          type="range"
          min={15}
          max={80}
          step="any"
          value={settings.vector.pinWidthMm}
          disabled={disabled}
          onChange={(e) =>
            patchVector({ pinWidthMm: roundInt(Number(e.target.value)) })
          }
        />
      </div>
      <p className="hint">
        Finished pin long edge — converts mm ↔ working pixels for the min-fill
        rule. Reprocess to apply.
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
        Higher keeps small shapes (dots, fins, linework). Still never drops
        fills ≥ min fill / gap. Reprocess to apply.
      </p>
      <div className="field">
        <label>
          <span>Vector resolution</span>
          <span className="value">{roundInt(settings.vector.maxDim)}px</span>
        </label>
        <input
          type="range"
          min={800}
          max={2000}
          step={50}
          value={settings.vector.maxDim}
          disabled={disabled}
          onChange={(e) =>
            patchVector({ maxDim: roundInt(Number(e.target.value)) })
          }
        />
      </div>
      <p className="hint">
        Working long-edge for color fills (imaengine refs ≈ 1652). Match your
        reference size so overlays line up. Reprocess to apply.
      </p>

      <h2>Match my SVG</h2>
      <p className="hint">
        Drop your reference Outline and/or Vector SVG, then overlay on the
        Outline / Vector / Proof tabs. Nudge until edges cancel (difference
        mode) or sit on top of ours.
      </p>
      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.match.enabled}
          disabled={disabled}
          onChange={(e) => patchMatch({ enabled: e.target.checked })}
        />
        <span>Enable overlay match</span>
      </label>

      <div className="match-upload-row">
        <div className="match-upload">
          <span className="match-upload-label">My outline SVG</span>
          <input
            ref={outlineRefInput}
            type="file"
            accept=".svg,image/svg+xml"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              onMatchOutlineFile?.(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn btn-secondary match-upload-btn"
            disabled={disabled || !onMatchOutlineFile}
            onClick={() => outlineRefInput.current?.click()}
          >
            {matchRefs?.outlineName ? 'Replace…' : 'Upload…'}
          </button>
          {matchRefs?.outlineName && (
            <button
              type="button"
              className="btn btn-secondary match-clear-btn"
              disabled={disabled}
              onClick={() => onMatchOutlineFile?.(null)}
              title="Clear outline reference"
            >
              Clear
            </button>
          )}
          <span className="match-file-name">
            {matchRefs?.outlineName ?? 'None'}
          </span>
        </div>
        <div className="match-upload">
          <span className="match-upload-label">My vector SVG</span>
          <input
            ref={vectorRefInput}
            type="file"
            accept=".svg,image/svg+xml"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null
              onMatchVectorFile?.(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="btn btn-secondary match-upload-btn"
            disabled={disabled || !onMatchVectorFile}
            onClick={() => vectorRefInput.current?.click()}
          >
            {matchRefs?.vectorName ? 'Replace…' : 'Upload…'}
          </button>
          {matchRefs?.vectorName && (
            <button
              type="button"
              className="btn btn-secondary match-clear-btn"
              disabled={disabled}
              onClick={() => onMatchVectorFile?.(null)}
              title="Clear vector reference"
            >
              Clear
            </button>
          )}
          <span className="match-file-name">
            {matchRefs?.vectorName ?? 'None'}
          </span>
        </div>
      </div>

      <label className="check-row">
        <input
          type="checkbox"
          checked={settings.match.difference}
          disabled={disabled || !settings.match.enabled}
          onChange={(e) => patchMatch({ difference: e.target.checked })}
        />
        <span>Difference blend (mismatches flash)</span>
      </label>
      <div className="field">
        <label>
          <span>Ours opacity</span>
          <span className="value">{roundInt(settings.match.oursOpacity)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.match.oursOpacity}
          disabled={disabled || !settings.match.enabled}
          onChange={(e) =>
            patchMatch({ oursOpacity: roundInt(Number(e.target.value)) })
          }
        />
      </div>
      <div className="field">
        <label>
          <span>Mine opacity</span>
          <span className="value">{roundInt(settings.match.refOpacity)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.match.refOpacity}
          disabled={disabled || !settings.match.enabled}
          onChange={(e) =>
            patchMatch({ refOpacity: roundInt(Number(e.target.value)) })
          }
        />
      </div>
      <div className="field">
        <label>
          <span>Nudge X</span>
          <span className="value">{settings.match.offsetX.toFixed(1)}%</span>
        </label>
        <input
          type="range"
          min={-50}
          max={50}
          step={0.1}
          value={settings.match.offsetX}
          disabled={disabled || !settings.match.enabled}
          onChange={(e) =>
            patchMatch({
              offsetX: Math.round(Number(e.target.value) * 10) / 10,
            })
          }
        />
      </div>
      <div className="field">
        <label>
          <span>Nudge Y</span>
          <span className="value">{settings.match.offsetY.toFixed(1)}%</span>
        </label>
        <input
          type="range"
          min={-50}
          max={50}
          step={0.1}
          value={settings.match.offsetY}
          disabled={disabled || !settings.match.enabled}
          onChange={(e) =>
            patchMatch({
              offsetY: Math.round(Number(e.target.value) * 10) / 10,
            })
          }
        />
      </div>
      <div className="field">
        <label>
          <span>Mine scale</span>
          <span className="value">{roundInt(settings.match.scalePct)}%</span>
        </label>
        <input
          type="range"
          min={50}
          max={150}
          step={1}
          value={settings.match.scalePct}
          disabled={disabled || !settings.match.enabled}
          onChange={(e) =>
            patchMatch({ scalePct: roundInt(Number(e.target.value)) })
          }
        />
      </div>
      <p className="hint">
        Tip: set Outline/Vector resolution to match your SVG viewBox, Reprocess,
        then enable overlay and zero the nudges. Perfect match → dark/quiet in
        difference mode.
      </p>
    </div>
  )
}
