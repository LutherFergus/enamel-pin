import { composeCellProof } from './cellProof'
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
  buildColorAdjacencyWallMask,
  scaleLabelsNearest,
} from './metalWalls'
import {
  DEFAULT_OUTLINE_SETTINGS,
  enhanceOutlineWithWalls,
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
  /**
   * Target metal-wall gap between adjacent enamel fills (mm on the pin).
   * Regions too small for this gap do not get a separating wall.
   */
  metalWallMm: number
  /** Assumed finished pin width used to map mm → outline pixels. */
  pinWidthMm: number
  outline: OutlineSettings
  vector: ColorVectorSettings
}

export const DEFAULT_DUAL_SETTINGS: DualOutputSettings = {
  removeBackground: true,
  backgroundTolerance: 50,
  metalWallMm: 0.3,
  pinWidthMm: 38,
  outline: { ...DEFAULT_OUTLINE_SETTINGS },
  vector: { ...DEFAULT_COLOR_VECTOR_SETTINGS },
}

export type DualOutputResult = {
  /** Die-line outline (includes color-adjacency metal walls when finalized). */
  outline: OutlineResult
  /**
   * Ink-only outline before color walls — kept so palette toggles can
   * re-finalize without stacking walls forever.
   */
  inkOutline: OutlineResult
  vector: ColorVectorResult
  proof: ProofSvg
  /** True until color vector finishes (outline may already be usable). */
  vectorPending?: boolean
  /** True while fitting fills into outline cells for the final proof. */
  proofPending?: boolean
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
    workingLabels: new Uint16Array(0),
    fillRgb: [],
  }
}

/**
 * After vector: add ≥ metalWallMm color walls onto the ink outline, then flood
 * each outline cell with its dominant vector color for the final proof.
 */
async function finalizeWithCellProof(
  inkOutline: OutlineResult,
  vector: ColorVectorResult,
  settings: DualOutputSettings,
): Promise<{ outline: OutlineResult; vector: ColorVectorResult; proof: ProofSvg }> {
  const pinW = Math.max(8, settings.pinWidthMm)
  const wallMm = Math.max(0.15, Math.min(1.2, settings.metalWallMm))
  const pxPerMm = inkOutline.widthPx / pinW
  const wallPx = wallMm * pxPerMm
  // Both sides of a wall must be large enough to leave enamel after the gap.
  const minRegionAreaPx = Math.max(24, Math.round((wallPx * 1.5) ** 2))

  const labels = scaleLabelsNearest(
    vector.workingLabels,
    vector.widthPx,
    vector.heightPx,
    inkOutline.widthPx,
    inkOutline.heightPx,
  )

  const walls = buildColorAdjacencyWallMask(
    labels,
    inkOutline.widthPx,
    inkOutline.heightPx,
    { wallPx, minRegionAreaPx },
  )

  const enhanced = await enhanceOutlineWithWalls(
    inkOutline,
    walls,
    inkOutline.widthPx,
    inkOutline.heightPx,
    settings.outline.invert,
  )

  const { pathomitScale } = detailRetentionParams(settings.vector.detailRetention)
  const cell = await composeCellProof(enhanced, vector, {
    smoothness: settings.vector.smoothness,
    pathomitScale,
  })

  URL.revokeObjectURL(vector.svgUrl)
  const nextVector: ColorVectorResult = {
    ...vector,
    svg: cell.vectorSvg,
    svgBlob: cell.vectorBlob,
    svgUrl: URL.createObjectURL(cell.vectorBlob),
    widthPx: enhanced.widthPx,
    heightPx: enhanced.heightPx,
    regionCount: cell.cellCount,
  }

  return {
    outline: enhanced,
    vector: nextVector,
    proof: cell.proof,
  }
}

export async function createDualOutputs(
  source: HTMLImageElement | ImageBitmap,
  settings: DualOutputSettings,
  merges: Array<[number, number]> = [],
  overrides: PmsOverrides = {},
  onOutlineReady?: (partial: DualOutputResult) => void,
  disabledColors: number[] = [],
): Promise<DualOutputResult> {
  const background = {
    enabled: settings.removeBackground,
    tolerance: settings.backgroundTolerance,
  }

  await yieldToUi()
  const inkOutline = await extractOutlinePng(source, settings.outline, background)
  await yieldToUi()

  const pendingVector = placeholderVector(inkOutline.widthPx, inkOutline.heightPx)
  const partial: DualOutputResult = {
    outline: inkOutline,
    inkOutline,
    vector: pendingVector,
    proof: composeProofSvg(pendingVector.svg, inkOutline.svg),
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
      disabledColors,
    )
    URL.revokeObjectURL(pendingVector.svgUrl)
    revokeProof(partial.proof)

    onOutlineReady?.({
      outline: inkOutline,
      inkOutline,
      vector,
      proof: composeProofSvg(vector.svg, inkOutline.svg),
      vectorPending: false,
      proofPending: true,
    })

    await yieldToUi()
    const finalized = await finalizeWithCellProof(inkOutline, vector, settings)

    return {
      outline: finalized.outline,
      inkOutline,
      vector: finalized.vector,
      proof: finalized.proof,
      vectorPending: false,
      proofPending: false,
    }
  } catch (err) {
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
  disabledColors: number[] = [],
  settings: DualOutputSettings = DEFAULT_DUAL_SETTINGS,
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
    disabledColors,
  )

  const baseSettings: DualOutputSettings = {
    ...settings,
    vector: {
      ...settings.vector,
      smoothness,
      snapToPms,
      detailRetention,
      pmsTolerance,
    },
  }

  const ink = previous.inkOutline ?? previous.outline
  revokeProof(previous.proof)

  const finalized = await finalizeWithCellProof(ink, vector, baseSettings)

  if (previous.outline.svgUrl !== ink.svgUrl) {
    URL.revokeObjectURL(previous.outline.pngUrl)
    URL.revokeObjectURL(previous.outline.svgUrl)
  }
  URL.revokeObjectURL(previous.vector.svgUrl)
  URL.revokeObjectURL(vector.svgUrl)

  return {
    outline: finalized.outline,
    inkOutline: ink,
    vector: finalized.vector,
    proof: finalized.proof,
    vectorPending: false,
    proofPending: false,
  }
}

export function revokeDualUrls(result: DualOutputResult | null) {
  if (!result) return
  URL.revokeObjectURL(result.outline.pngUrl)
  URL.revokeObjectURL(result.outline.svgUrl)
  if (
    result.inkOutline &&
    result.inkOutline.svgUrl !== result.outline.svgUrl
  ) {
    URL.revokeObjectURL(result.inkOutline.pngUrl)
    URL.revokeObjectURL(result.inkOutline.svgUrl)
  }
  URL.revokeObjectURL(result.vector.svgUrl)
  revokeProof(result.proof)
}
