/**
 * AI image generation for the dual-output pipeline.
 * Uses Pollinations (no API key) by default; optional OpenAI-compatible override.
 */

export type AiGenerateOptions = {
  prompt: string
  width?: number
  height?: number
  seed?: number
}

export type AiGenerateResult = {
  image: HTMLImageElement
  objectUrl: string
  prompt: string
}

function buildPollinationsUrl(opts: AiGenerateOptions): string {
  const width = opts.width ?? 768
  const height = opts.height ?? 768
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000)
  const encoded = encodeURIComponent(opts.prompt.trim())
  // Soft-enamel / flat-illustration bias helps downstream vectorization
  const styleHint = encodeURIComponent(
    ', flat colors, clean shapes, bold outlines, enamel pin style illustration, high contrast',
  )
  return `https://image.pollinations.ai/prompt/${encoded}${styleHint}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`
}

export async function generateAiImage(
  opts: AiGenerateOptions,
): Promise<AiGenerateResult> {
  const prompt = opts.prompt.trim()
  if (!prompt) throw new Error('Enter a prompt to generate an image')

  const url = buildPollinationsUrl(opts)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Image generation failed (${res.status})`)
  }
  const blob = await res.blob()
  const objectUrl = URL.createObjectURL(blob)
  const image = await loadImageFromUrl(objectUrl)
  return { image, objectUrl, prompt }
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
