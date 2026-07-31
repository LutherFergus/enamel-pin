import { detailRetentionParams } from './colorVectorize'
import {
  DEFAULT_DUAL_SETTINGS,
  type DualOutputSettings,
} from './pipeline'

/** Invert detailRetentionParams minRegionRatio → 0–100 retention. */
function retentionFromMinRegionRatio(minRegionRatio: number): number {
  const lo = 0.00005
  const hi = 0.0022
  const clamped = Math.max(lo, Math.min(hi, minRegionRatio))
  const t = (hi - clamped) / (hi - lo)
  return Math.round(Math.max(0, Math.min(100, t * 100)))
}

const STORAGE_KEY = 'enamel-pin-creator.settings.v2'

export type RememberedSettings = {
  savedAt: string
  settings: DualOutputSettings
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** Merge stored settings onto defaults so older saves stay valid. */
export function sanitizeSettings(raw: unknown): DualOutputSettings {
  const base = structuredClone(DEFAULT_DUAL_SETTINGS)
  if (!raw || typeof raw !== 'object') return base
  const o = raw as Partial<DualOutputSettings>

  if (typeof o.removeBackground === 'boolean') {
    base.removeBackground = o.removeBackground
  }
  if (isFiniteNumber(o.backgroundTolerance)) {
    base.backgroundTolerance = Math.max(8, Math.min(80, Math.round(o.backgroundTolerance)))
  }

  if (o.outline && typeof o.outline === 'object') {
    if (isFiniteNumber(o.outline.sensitivity)) {
      base.outline.sensitivity = Math.max(0, Math.min(100, o.outline.sensitivity))
    }
    if (isFiniteNumber(o.outline.thickness)) {
      base.outline.thickness = Math.max(0, Math.min(6, Math.round(o.outline.thickness)))
    }
    if (typeof o.outline.invert === 'boolean') {
      base.outline.invert = o.outline.invert
    }
    if (isFiniteNumber(o.outline.maxDim)) {
      base.outline.maxDim = Math.max(200, Math.min(2000, o.outline.maxDim))
    }
  }

  if (o.vector && typeof o.vector === 'object') {
    if (isFiniteNumber(o.vector.colorCount)) {
      base.vector.colorCount = Math.max(4, Math.min(32, Math.round(o.vector.colorCount)))
    }
    if (isFiniteNumber(o.vector.detailRetention)) {
      base.vector.detailRetention = Math.max(
        0,
        Math.min(100, Math.round(o.vector.detailRetention)),
      )
    } else if (isFiniteNumber(o.vector.minRegionRatio)) {
      // Migrate older "Detail cleanup" saves → retention slider.
      base.vector.detailRetention = retentionFromMinRegionRatio(
        o.vector.minRegionRatio,
      )
    }
    // Keep deprecated field synced for any leftover readers.
    base.vector.minRegionRatio = detailRetentionParams(
      base.vector.detailRetention,
    ).minRegionRatio
    if (isFiniteNumber(o.vector.smoothness)) {
      base.vector.smoothness = Math.max(0, Math.min(5, Math.round(o.vector.smoothness)))
    }
    if (isFiniteNumber(o.vector.maxDim)) {
      base.vector.maxDim = Math.max(200, Math.min(2000, o.vector.maxDim))
    }
    if (typeof o.vector.snapToPms === 'boolean') {
      base.vector.snapToPms = o.vector.snapToPms
    }
    if (isFiniteNumber(o.vector.pmsTolerance)) {
      base.vector.pmsTolerance = Math.max(
        0,
        Math.min(30, Math.round(o.vector.pmsTolerance)),
      )
    }
  }

  return base
}

export function loadRememberedSettings(): RememberedSettings | null {
  try {
    const raw =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem('enamel-pin-creator.settings.v1')
    if (!raw) return null
    const parsed = JSON.parse(raw) as { savedAt?: string; settings?: unknown }
    const remembered: RememberedSettings = {
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date().toISOString(),
      settings: sanitizeSettings(parsed.settings),
    }
    // Migrate v1 → v2 so auto-save continues on the new key.
    if (!localStorage.getItem(STORAGE_KEY)) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remembered))
    }
    return remembered
  } catch {
    return null
  }
}

export function rememberSettings(settings: DualOutputSettings): RememberedSettings {
  const payload: RememberedSettings = {
    savedAt: new Date().toISOString(),
    settings: sanitizeSettings(settings),
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  return payload
}

export function forgetRememberedSettings(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export function initialSettings(): DualOutputSettings {
  return loadRememberedSettings()?.settings ?? structuredClone(DEFAULT_DUAL_SETTINGS)
}
