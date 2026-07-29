import {
  applyPaletteMerges,
  DEFAULT_COLOR_VECTOR_SETTINGS,
  vectorizeColors,
  type ColorVectorResult,
  type ColorVectorSettings,
} from './colorVectorize'
import {
  DEFAULT_OUTLINE_SETTINGS,
  extractOutlinePng,
  type OutlineResult,
  type OutlineSettings,
} from './outline'

export type DualOutputSettings = {
  outline: OutlineSettings
  vector: ColorVectorSettings
}

export const DEFAULT_DUAL_SETTINGS: DualOutputSettings = {
  outline: { ...DEFAULT_OUTLINE_SETTINGS },
  vector: { ...DEFAULT_COLOR_VECTOR_SETTINGS },
}

export type DualOutputResult = {
  outline: OutlineResult
  vector: ColorVectorResult
}

/**
 * Always produce both assets from a source image:
 * 1) stroke outline PNG (transparent)
 * 2) flat-color vector SVG
 */
export async function createDualOutputs(
  source: HTMLImageElement | ImageBitmap,
  settings: DualOutputSettings,
  merges: Array<[number, number]> = [],
): Promise<DualOutputResult> {
  const [outline, vector] = await Promise.all([
    extractOutlinePng(source, settings.outline),
    vectorizeColors(source, settings.vector, merges),
  ])
  return { outline, vector }
}

export async function remergeVector(
  previous: ColorVectorResult,
  merges: Array<[number, number]>,
  smoothness: number,
): Promise<ColorVectorResult> {
  return applyPaletteMerges(previous.state, merges, smoothness)
}

export function revokeDualUrls(result: DualOutputResult | null) {
  if (!result) return
  URL.revokeObjectURL(result.outline.pngUrl)
  URL.revokeObjectURL(result.vector.svgUrl)
}
