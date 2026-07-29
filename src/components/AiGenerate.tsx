import { useState } from 'react'

type Props = {
  onGenerate: (prompt: string) => void
  disabled?: boolean
}

const EXAMPLES = [
  'cute fox enamel pin, flat colors, bold black outlines',
  'retro coffee cup mascot, limited palette, sticker art',
  'mountain landscape badge, simple shapes, high contrast',
]

export function AiGenerate({ onGenerate, disabled }: Props) {
  const [prompt, setPrompt] = useState(EXAMPLES[0])

  return (
    <div className="ai-generate">
      <h2>Generate with AI</h2>
      <p className="hint">
        Creates an illustration, then automatically builds the stroke PNG and color SVG.
      </p>
      <div className="field">
        <label htmlFor="ai-prompt">
          <span>Prompt</span>
        </label>
        <textarea
          id="ai-prompt"
          rows={3}
          value={prompt}
          disabled={disabled}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the pin or illustration…"
        />
      </div>
      <div className="example-row">
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => setPrompt(ex)}
          >
            {ex.split(',')[0]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled || !prompt.trim()}
        onClick={() => onGenerate(prompt.trim())}
      >
        {disabled ? 'Generating…' : 'Generate & process'}
      </button>
    </div>
  )
}
