import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Controls } from './components/Controls'
import { Dropzone } from './components/Dropzone'
import { Preview } from './components/Preview'
import { DEFAULT_SETTINGS, type EnamelSettings, type VectorizeResult } from './lib/types'
import { loadImageFromFile, prepareImage, vectorizeToSvg } from './lib/vectorize'

type ViewMode = 'result' | 'source'

export default function App() {
  const [settings, setSettings] = useState<EnamelSettings>(DEFAULT_SETTINGS)
  const [sourceFile, setSourceFile] = useState<File | null>(null)
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)
  const [result, setResult] = useState<VectorizeResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('result')
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    }
  }, [sourceUrl])

  const runVectorize = useCallback(
    async (image: HTMLImageElement, nextSettings: EnamelSettings) => {
      setBusy(true)
      setError(null)
      try {
        // Yield so the UI can paint the busy state
        await new Promise((r) => setTimeout(r, 16))
        const prepared = prepareImage(image, nextSettings)
        const next = vectorizeToSvg(prepared, nextSettings)
        startTransition(() => {
          setResult(next)
          setViewMode('result')
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Vectorization failed')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const onFile = useCallback(
    async (file: File) => {
      setError(null)
      try {
        const img = await loadImageFromFile(file)
        const url = URL.createObjectURL(file)
        setSourceFile(file)
        setSourceUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev)
          return url
        })
        setSourceImage(img)
        await runVectorize(img, settings)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load image')
      }
    },
    [runVectorize, settings],
  )

  const onSettingsChange = useCallback((next: EnamelSettings) => {
    setSettings(next)
  }, [])

  const onApply = useCallback(() => {
    if (!sourceImage) return
    void runVectorize(sourceImage, settings)
  }, [runVectorize, settings, sourceImage])

  const onDownload = useCallback(() => {
    if (!result) return
    const blob = new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = sourceFile?.name?.replace(/\.[^.]+$/, '') ?? 'enamel-pin'
    a.href = url
    a.download = `${base}-enamel.svg`
    a.click()
    URL.revokeObjectURL(url)
  }, [result, sourceFile])

  const statusText = useMemo(() => {
    if (busy || isPending) return 'Tracing enamel fills and metal walls…'
    if (error) return error
    if (!result) return 'Upload artwork to begin'
    return `${result.palette.length} colors · ${result.regionCount} fills · ${result.widthMm.toFixed(1)}×${result.heightMm.toFixed(1)} mm`
  }, [busy, error, isPending, result])

  return (
    <div className="app">
      <header className="hero">
        <h1 className="brand">Enamel Pin Vectorizer</h1>
        <p className="lede">
          Turn artwork into soft-enamel-ready SVG: flat color fills, minimum fill sizes,
          and thin metal outlines wherever colors meet.
        </p>
      </header>

      <div className="layout">
        <aside className="panel">
          <h2>Artwork</h2>
          <Dropzone onFile={onFile} disabled={busy} />

          <h2>Pin settings</h2>
          <Controls
            settings={settings}
            onChange={onSettingsChange}
            disabled={busy}
          />

          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onApply}
              disabled={!sourceImage || busy}
            >
              {busy ? 'Vectorizing…' : 'Vectorize'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onDownload}
              disabled={!result || busy}
            >
              Download SVG
            </button>
          </div>
        </aside>

        <section className="panel preview-panel">
          <div className="meta-bar">
            <div className="tabs" role="tablist" aria-label="Preview mode">
              <button
                type="button"
                className={`tab ${viewMode === 'result' ? 'active' : ''}`}
                onClick={() => setViewMode('result')}
                disabled={!result}
              >
                Enamel SVG
              </button>
              <button
                type="button"
                className={`tab ${viewMode === 'source' ? 'active' : ''}`}
                onClick={() => setViewMode('source')}
                disabled={!sourceUrl}
              >
                Source
              </button>
            </div>
            <p className={`status ${error ? 'error' : ''}`}>{statusText}</p>
          </div>

          <Preview
            viewMode={viewMode}
            sourceUrl={sourceUrl}
            result={result}
            busy={busy || isPending}
          />

          {result && (
            <div className="palette" aria-label="Enamel palette">
              {result.palette.map((c) => (
                <span
                  key={c.index}
                  className="swatch"
                  title={c.hex}
                  style={{ background: c.hex }}
                />
              ))}
              <span
                className="swatch"
                title="Metal outline"
                style={{ background: settings.outlineColor }}
              />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
