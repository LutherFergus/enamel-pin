import {
  applyPaletteMerges,
  DEFAULT_COLOR_VECTOR_SETTINGS,
  detailRetentionParams,
  vectorizeColors,
  type ColorVectorResult,
  type ColorVectorSettings,
  type PmsOverrides,
} from './colorVectorize'
import {
  DEFAULT_OUTLINE_SETTINGS,
  extractOutlinePng,
  type OutlineResult,
  type OutlineSettings,
} from './outline'
import { composeProofSvg, revokeProof, type ProofSvg } from './proofSvg'

export type DualOutputSettings = {
  /** Knock out solid studio/product backdrops before outline + vector. */
  removeBackground: boolean
  /** Backdrop match strength 8–80 (higher = more aggressive). */
  backgroundTolerance: number
  outline: OutlineSettings
  vector: ColorVectorSettings
}

export const DEFAULT_DUAL_SETTINGS: DualOutputSettings = {
  removeBackground: true,
  backgroundTolerance: 42,
  outline: { ...DEFAULT_OUTLINE_SETTINGS },
  vector: { ...DEFAULT_COLOR_VECTOR_SETTINGS },
}

export type DualOutputResult = {
  outline: OutlineResult
  vector: ColorVectorResult
  proof: ProofSvg
}

export async function createDualOutputs(
  source: HTMLImageElement | ImageBitmap,
  settings: DualOutputSettings,
  merges: Array<[number, number]> = [],
  overrides: PmsOverrides = {},
): Promise<DualOutputResult> {
  const background = {
    enabled: settings.removeBackground,
    tolerance: settings.backgroundTolerance,
  }
  const [outline, vector] = await Promise.all([
    // Outline keeps its own gentle knockout (era when color count hit 32).
    extractOutlinePng(source, settings.outline),
    vectorizeColors(source, settings.vector, merges, overrides, background),
  ])
  return {
    outline,
    vector,
    proof: composeProofSvg(vector.svg, outline.svg),
  }
}

export async function remergeVector(
  previous: DualOutputResult,
  merges: Array<[number, number]>,
  smoothness: number,
  snapToPms: boolean,
  overrides: PmsOverrides = {},
  detailRetention = DEFAULT_COLOR_VECTOR_SETTINGS.detailRetention,
  pmsTolerance = DEFAULT_COLOR_VECTOR_SETTINGS.pmsTolerance,
): Promise<DualOutputResult> {
  const { pathomitScale } = detailRetentionParams(detailRetention)
  const vector = await applyPaletteMerges(
    previous.vector.state,
    merges,
    smoothness,
    snapToPms,
    overrides,
    pathomitScale,
    pmsTolerance,
  )
  revokeProof(previous.proof)
  return {
    outline: previous.outline,
    vector,
    proof: composeProofSvg(vector.svg, previous.outline.svg),
  }
}

export function revokeDualUrls(result: DualOutputResult | null) {
  if (!result) return
  URL.revokeObjectURL(result.outline.pngUrl)
  URL.revokeObjectURL(result.outline.svgUrl)
  URL.revokeObjectURL(result.vector.svgUrl)
  revokeProof(result.proof)
}
