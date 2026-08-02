/**
 * Live overlay so you can drop your reference Outline/Vector SVG and nudge
 * ours until edges line up under zoom.
 */

export type MatchOverlaySettings = {
  /** Show reference SVG on top of ours (Outline / Vector / Proof tabs). */
  enabled: boolean
  /** Opacity of our generated plate 0–100. */
  oursOpacity: number
  /** Opacity of your uploaded reference 0–100. */
  refOpacity: number
  /** Nudge reference horizontally (−50…50 % of frame). */
  offsetX: number
  /** Nudge reference vertically (−50…50 % of frame). */
  offsetY: number
  /** Scale reference relative to ours (50–150 %). */
  scalePct: number
  /**
   * Difference blend: mismatches flash bright; perfect overlap goes dark.
   * Ours stays solid; your reference uses mix-blend-mode: difference.
   */
  difference: boolean
}

export const DEFAULT_MATCH_OVERLAY: MatchOverlaySettings = {
  enabled: false,
  oursOpacity: 100,
  refOpacity: 55,
  offsetX: 0,
  offsetY: 0,
  scalePct: 100,
  difference: true,
}

export type MatchReferences = {
  outlineUrl: string | null
  outlineName: string | null
  vectorUrl: string | null
  vectorName: string | null
}
