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
  backgroundTolerance: 50,
  outline: { ...DEFAULT_OUTLINE_SETTINGS },
  vector: { ...DEFAULT_COLOR_VECTOR_SETTINGS },
}

export type DualOutputResult = {
  outline: OutlineResult
  vector: ColorVectorResult
  proof: ProofSvg
  /** True until color vector finishes (outline may already be usable). */
  vectorPending?: boolean
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => setTimeout(resolve, 0))
  })
}

/** Empty vector placeholder so the UI can show outline before color finishes. */
function placeholderVector(widthPx: number, heightPx: number): ColorVectorResult {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}"></svg>`
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  return {
    svg,
    svgBlob,
    svgUrl: URL.createObjectURL(svgBlob),
    widthPx,
    heightPx,
    palette: [],
    regionCount: 0,
    state: {
      widthPx,
      heightPx,
      labels: new Uint16Array(0),
      palette: [],
      mergeMap: [],
    },
  }
}

export async function createDualOutputs(
  source: HTMLImageElement | ImageBitmap,
  settings: DualOutputSettings,
  merges: Array<[number, number]> = [],
  overrides: PmsOverrides = {},
  onOutlineReady?: (partial: DualOutputResult) => void,
): Promise<DualOutputResult> {
  const background = {
    enabled: settings.removeBackground,
    tolerance: settings.backgroundTolerance,
  }

  // Outline first — don't wait on the heavy color pass (detail 100 can hang phones).
  // Outline prep: remove bg → fill white → trace → transparent non-ink again.
  await yieldToUi()
  const outline = await extractOutlinePng(source, settings.outline, background)
  await yieldToUi()

  const pendingVector = placeholderVector(outline.widthPx, outline.heightPx)
  const partial: DualOutputResult = {
    outline,
    vector: pendingVector,
    proof: composeProofSvg(pendingVector.svg, outline.svg),
    vectorPending: true,
  }
  onOutlineReady?.(partial)

  try {
    await yieldToUi()
    const vector = await vectorizeColors(
      source,
      settings.vector,
      merges,
      overrides,
      background,
    )
    // Drop placeholder URLs.
    URL.revokeObjectURL(pendingVector.svgUrl)
    revokeProof(partial.proof)

    return {
      outline,
      vector,
      proof: composeProofSvg(vector.svg, outline.svg),
      vectorPending: false,
    }
  } catch (err) {
    // Keep outline usable even if color vector fails / OOMs.
    throw err
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
  if (previous.vectorPending || previous.vector.palette.length === 0) {
    return previous
  }
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
    vectorPending: false,
  }
}

export function revokeDualUrls(result: DualOutputResult | null) {
  if (!result) return
  URL.revokeObjectURL(result.outline.pngUrl)
  URL.revokeObjectURL(result.outline.svgUrl)
  URL.revokeObjectURL(result.vector.svgUrl)
  revokeProof(result.proof)
}
