import { useMemo, useState } from 'react'
import {
  PINHEADS_THEMES,
  getPinheadsCatalogStats,
  type PinheadsTheme,
} from '../lib/aiGenerate'

type Props = {
  onGenerate: (prompt: string, themes: PinheadsTheme[]) => void
  disabled?: boolean
}

const EXAMPLES = [
  { prompt: 'bitter old fart skull in a scally flat cap, cigar, scowl', themes: ['attitude', 'scally'] as PinheadsTheme[] },
  { prompt: 'minuteman skeleton with musket, patriotic 250 anniversary pin', themes: ['attitude', 'patriotism'] as PinheadsTheme[] },
  { prompt: 'angry mallard duck with shotgun shell in beak, tough guy stare', themes: ['attitude', 'animals'] as PinheadsTheme[] },
]

export function AiGenerate({ onGenerate, disabled }: Props) {
  const [prompt, setPrompt] = useState(EXAMPLES[1].prompt)
  const [themes, setThemes] = useState<PinheadsTheme[]>(['attitude', 'patriotism'])
  const stats = useMemo(() => getPinheadsCatalogStats(), [])

  const toggleTheme = (id: PinheadsTheme) => {
    setThemes((prev) => {
      if (id === 'attitude') return prev.includes('attitude') ? prev : ['attitude', ...prev]
      if (prev.includes(id)) {
        const next = prev.filter((t) => t !== id)
        return next.includes('attitude') ? next : ['attitude', ...next]
      }
      return [...prev, id]
    })
  }

  return (
    <div className="ai-generate">
      <h2>Generate with AI</h2>
      <p className="hint">
        Pinheads style locked in: <strong>attitude</strong> through-line, with patriotism as a
        major pillar. Learned from {stats.products} shop products ({stats.soldOut} sold out
        included) · {stats.images} images.
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
          placeholder="Describe the pin…"
        />
      </div>

      <div className="theme-grid" aria-label="Pinheads themes">
        {PINHEADS_THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`chip ${themes.includes(t.id) ? 'chip-on' : ''}`}
            disabled={disabled || t.id === 'attitude'}
            onClick={() => toggleTheme(t.id)}
            title={t.id === 'attitude' ? 'Attitude is always on' : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="example-row">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.prompt}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => {
              setPrompt(ex.prompt)
              setThemes(ex.themes)
            }}
          >
            {ex.prompt.split(',')[0]}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={disabled || !prompt.trim()}
        onClick={() => onGenerate(prompt.trim(), themes)}
      >
        {disabled ? 'Generating…' : 'Generate & process'}
      </button>
    </div>
  )
}
