/**
 * AI image generation for the dual-output pipeline.
 * Defaults to Pinheads Pins style (attitude-first + patriotism pillar).
 */

import pinheadsStyle from '../data/pinheads-style.json'

export type PinheadsTheme =
  | 'attitude'
  | 'patriotism'
  | 'scally'
  | 'horror'
  | 'animals'
  | 'holiday'
  | 'sports'

export type AiGenerateOptions = {
  prompt: string
  width?: number
  height?: number
  seed?: number
  /** Extra Pinheads theme emphasis beyond the attitude through-line. */
  themes?: PinheadsTheme[]
}

export type AiGenerateResult = {
  image: HTMLImageElement
  objectUrl: string
  prompt: string
  finalPrompt: string
}

export const PINHEADS_THEMES: Array<{ id: PinheadsTheme; label: string }> = [
  { id: 'attitude', label: 'Attitude' },
  { id: 'patriotism', label: 'Patriotism' },
  { id: 'scally', label: 'Scally / Hooligan' },
  { id: 'horror', label: 'Horror' },
  { id: 'animals', label: 'Attitude animals' },
  { id: 'holiday', label: 'Holiday' },
  { id: 'sports', label: 'Sports' },
]

const THEME_HINTS: Record<PinheadsTheme, string> = {
  attitude:
    'tough humorous swagger, rebellious attitude, don’t-mess-with-me energy',
  patriotism:
    'patriotic Americana, red white and blue, military/historical icons with attitude',
  scally: 'scally cap hooligan culture, Irish/Boston swagger, flat caps',
  horror: 'horror character with attitude, macabre humor, spooky but bold enamel shapes',
  animals: 'anthropomorphic animal mascot with tough guy attitude and a swagger prop',
  holiday: 'holiday character twisted with Pinheads attitude, not cute cutesy',
  sports: 'sports swagger mascot, bold athletic iconography for enamel pin',
}

export function getPinheadsStyleBias(): string {
  return pinheadsStyle.promptBias
}

export function getPinheadsCatalogStats() {
  return pinheadsStyle.stats
}

export function buildPinheadsPrompt(
  userPrompt: string,
  themes: PinheadsTheme[] = ['attitude', 'patriotism'],
): string {
  const unique = [...new Set(themes.length ? themes : (['attitude'] as PinheadsTheme[]))]
  if (!unique.includes('attitude')) unique.unshift('attitude')
  const themeText = unique.map((t) => THEME_HINTS[t]).join('; ')
  return [
    userPrompt.trim(),
    getPinheadsStyleBias(),
    `themes: ${themeText}`,
    'single enamel pin design, clean silhouette, manufacture-ready color blocks',
  ]
    .filter(Boolean)
    .join(', ')
}

function buildPollinationsUrl(finalPrompt: string, opts: AiGenerateOptions): string {
  const width = opts.width ?? 768
  const height = opts.height ?? 768
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000)
  const encoded = encodeURIComponent(finalPrompt)
  return `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`
}

export async function generateAiImage(
  opts: AiGenerateOptions,
): Promise<AiGenerateResult> {
  const prompt = opts.prompt.trim()
  if (!prompt) throw new Error('Enter a prompt to generate an image')

  const themes = opts.themes ?? ['attitude', 'patriotism']
  const finalPrompt = buildPinheadsPrompt(prompt, themes)
  const url = buildPollinationsUrl(finalPrompt, opts)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Image generation failed (${res.status})`)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const image = await loadImageFromUrl(objectUrl)
  return { image, objectUrl, prompt, finalPrompt }
}

export function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode generated image'))
    img.src = url
  })
}
