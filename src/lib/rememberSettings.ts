import {
  DEFAULT_DUAL_SETTINGS,
  type DualOutputSettings,
} from './pipeline'

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
    if (isFiniteNumber(o.vector.minRegionRatio)) {
      base.vector.minRegionRatio = Math.max(0.00005, Math.min(0.01, o.vector.minRegionRatio))
    }
    if (isFiniteNumber(o.vector.smoothness)) {
      base.vector.smoothness = Math.max(0, Math.min(5, Math.round(o.vector.smoothness)))
    }
    if (isFiniteNumber(o.vector.maxDim)) {
      base.vector.maxDim = Math.max(200, Math.min(2000, o.vector.maxDim))
    }
    if (typeof o.vector.snapToPms === 'boolean') {
      base.vector.snapToPms = o.vector.snapToPms
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
