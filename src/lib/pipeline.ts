import {
  applyPaletteMerges,
  DEFAULT_COLOR_VECTOR_SETTINGS,
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
  proof: ProofSvg
}

export async function createDualOutputs(
  source: HTMLImageElement | ImageBitmap,
  settings: DualOutputSettings,
  merges: Array<[number, number]> = [],
  overrides: PmsOverrides = {},
): Promise<DualOutputResult> {
  const [outline, vector] = await Promise.all([
    extractOutlinePng(source, settings.outline),
    vectorizeColors(source, settings.vector, merges, overrides),
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
): Promise<DualOutputResult> {
  const vector = await applyPaletteMerges(
    previous.vector.state,
    merges,
    smoothness,
    snapToPms,
    overrides,
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
