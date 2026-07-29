import type { EnamelSettings } from '../lib/types'

type Props = {
  settings: EnamelSettings
  onChange: (next: EnamelSettings) => void
  disabled?: boolean
}

export function Controls({ settings, onChange, disabled }: Props) {
  const patch = (partial: Partial<EnamelSettings>) => {
    onChange({ ...settings, ...partial })
  }

  return (
    <div>
      <div className="field">
        <label>
          <span>Color count</span>
          <span className="value">{settings.colorCount}</span>
        </label>
        <input
          type="range"
          min={2}
          max={12}
          step={1}
          value={settings.colorCount}
          disabled={disabled}
          onChange={(e) => patch({ colorCount: Number(e.target.value) })}
        />
      </div>
      <p className="hint">Enamel fill colors. Metal outlines are separate.</p>

      <div className="field-row">
        <div className="field">
          <label>
            <span>Pin width</span>
            <span className="value">{settings.pinWidthMm} mm</span>
          </label>
          <input
            type="number"
            min={10}
            max={100}
            step={0.5}
            value={settings.pinWidthMm}
            disabled={disabled}
            onChange={(e) => patch({ pinWidthMm: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>
            <span>Pin height</span>
            <span className="value">
              {settings.pinHeightMm == null ? 'auto' : `${settings.pinHeightMm} mm`}
            </span>
          </label>
          <input
            type="number"
            min={10}
            max={100}
            step={0.5}
            placeholder="Auto"
            value={settings.pinHeightMm ?? ''}
            disabled={disabled}
            onChange={(e) => {
              const v = e.target.value
              patch({ pinHeightMm: v === '' ? null : Number(v) })
            }}
          />
        </div>
      </div>

      <div className="field">
        <label>
          <span>Min fill size</span>
          <span className="value">{settings.minFillMm.toFixed(2)} mm</span>
        </label>
        <input
          type="range"
          min={0.3}
          max={2}
          step={0.05}
          value={settings.minFillMm}
          disabled={disabled}
          onChange={(e) => patch({ minFillMm: Number(e.target.value) })}
        />
      </div>
      <p className="hint">Smaller regions merge into neighbors — keeps enamel pourable.</p>

      <div className="field">
        <label>
          <span>Metal wall width</span>
          <span className="value">{settings.metalWallMm.toFixed(2)} mm</span>
        </label>
        <input
          type="range"
          min={0.15}
          max={0.8}
          step={0.05}
          value={settings.metalWallMm}
          disabled={disabled}
          onChange={(e) => patch({ metalWallMm: Number(e.target.value) })}
        />
      </div>
      <p className="hint">Thin black outlines drawn where enamel colors meet.</p>

      <div className="field-row">
        <div className="field">
          <label>
            <span>Smoothness</span>
            <span className="value">{settings.smoothness}</span>
          </label>
          <input
            type="range"
            min={0}
            max={5}
            step={1}
            value={settings.smoothness}
            disabled={disabled}
            onChange={(e) => patch({ smoothness: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label>
            <span>Outline color</span>
          </label>
          <input
            type="color"
            value={settings.outlineColor}
            disabled={disabled}
            onChange={(e) => patch({ outlineColor: e.target.value })}
          />
        </div>
      </div>

      <div className="field">
        <label>
          <span>Working DPI</span>
          <span className="value">{settings.dpi}</span>
        </label>
        <input
          type="range"
          min={150}
          max={400}
          step={50}
          value={settings.dpi}
          disabled={disabled}
          onChange={(e) => patch({ dpi: Number(e.target.value) })}
        />
      </div>
      <p className="hint">Used to convert millimeters into pixels for area and wall checks.</p>
    </div>
  )
}
