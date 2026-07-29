import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { AiGenerate } from './components/AiGenerate'
import { DualControls } from './components/DualControls'
import { Dropzone } from './components/Dropzone'
import { PaletteMerge } from './components/PaletteMerge'
import { PmsChartModal } from './components/PmsChartModal'
import { Preview, type PreviewTab } from './components/Preview'
import { generateAiImage, type PinheadsTheme } from './lib/aiGenerate'
import type { PmsOverrides } from './lib/colorVectorize'
import {
  createDualOutputs,
  DEFAULT_DUAL_SETTINGS,
  remergeVector,
  revokeDualUrls,
  type DualOutputResult,
  type DualOutputSettings,
} from './lib/pipeline'
import { getPmsChartSize } from './lib/pms'
import { loadImageFromFile } from './lib/vectorize'

type SourceMode = 'upload' | 'ai'

export default function App() {
  const [settings, setSettings] = useState<DualOutputSettings>(DEFAULT_DUAL_SETTINGS)
  const [sourceMode, setSourceMode] = useState<SourceMode>('upload')
  const [sourceName, setSourceName] = useState('artwork')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)
  const [result, setResult] = useState<DualOutputResult | null>(null)
  const [merges, setMerges] = useState<Array<[number, number]>>([])
  const [pmsOverrides, setPmsOverrides] = useState<PmsOverrides>({})
  const [chartOpen, setChartOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<PreviewTab>('vector')
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
      revokeDualUrls(result)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, [])

  const refreshVector = useCallback(
    async (
      nextMerges: Array<[number, number]>,
      nextOverrides: PmsOverrides,
      nextSettings: DualOutputSettings = settings,
    ) => {
      if (!result) return
      setBusy(true)
      setError(null)
      try {
        const vector = await remergeVector(
          result.vector,
          nextMerges,
          nextSettings.vector.smoothness,
          nextSettings.vector.snapToPms,
          nextOverrides,
        )
        startTransition(() => {
          setResult((prev) => {
            if (!prev) return prev
            URL.revokeObjectURL(prev.vector.svgUrl)
            return { ...prev, vector }
          })
          setViewMode('vector')
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Palette update failed')
      } finally {
        setBusy(false)
      }
    },
    [result, settings],
  )

  const runPipeline = useCallback(
    async (
      image: HTMLImageElement,
      nextSettings: DualOutputSettings,
      nextMerges: Array<[number, number]>,
      nextOverrides: PmsOverrides,
    ) => {
      setBusy(true)
      setError(null)
      try {
        await new Promise((r) => setTimeout(r, 16))
        const next = await createDualOutputs(
          image,
          nextSettings,
          nextMerges,
          nextOverrides,
        )
        startTransition(() => {
          setResult((prev) => {
            revokeDualUrls(prev)
            return next
          })
          setViewMode('vector')
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Processing failed')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const setSource = useCallback((image: HTMLImageElement, url: string, name: string) => {
    setSourceUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return url
    })
    setSourceImage(image)
    setSourceName(name)
    setMerges([])
    setPmsOverrides({})
  }, [])

  const onFile = useCallback(
    async (file: File) => {
      setError(null)
      try {
        const img = await loadImageFromFile(file)
        const url = URL.createObjectURL(file)
        setSource(img, url, file.name.replace(/\.[^.]+$/, '') || 'artwork')
        setSourceMode('upload')
        await runPipeline(img, settings, [], {})
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load image')
      }
    },
    [runPipeline, setSource, settings],
  )

  const onGenerate = useCallback(
    async (prompt: string, themes: PinheadsTheme[]) => {
      setBusy(true)
      setError(null)
      try {
        const gen = await generateAiImage({ prompt, themes })
        setSource(gen.image, gen.objectUrl, slugify(prompt))
        setSourceMode('ai')
        await runPipeline(gen.image, settings, [], {})
      } catch (err) {
        setBusy(false)
        setError(err instanceof Error ? err.message : 'Generation failed')
      }
    },
    [runPipeline, setSource, settings],
  )

  const onApply = useCallback(() => {
    if (!sourceImage) return
    setMerges([])
    setPmsOverrides({})
    void runPipeline(sourceImage, settings, [], {})
  }, [runPipeline, settings, sourceImage])

  const onMergesChange = useCallback(
    async (nextMerges: Array<[number, number]>) => {
      setMerges(nextMerges)
      await refreshVector(nextMerges, pmsOverrides)
    },
    [pmsOverrides, refreshVector],
  )

  const onOverridePms = useCallback(
    async (paletteIndex: number, pmsCode: string) => {
      const next = { ...pmsOverrides, [paletteIndex]: pmsCode }
      setPmsOverrides(next)
      await refreshVector(merges, next)
    },
    [merges, pmsOverrides, refreshVector],
  )

  const downloadOutline = useCallback(() => {
    if (!result) return
    downloadBlob(result.outline.pngBlob, `${sourceName}-outline.png`)
  }, [result, sourceName])

  const downloadVector = useCallback(() => {
    if (!result) return
    downloadBlob(result.vector.svgBlob, `${sourceName}-vector.svg`)
  }, [result, sourceName])

  const statusText = useMemo(() => {
    if (busy || isPending) return 'Building stroke outline and color vector…'
    if (error) return error
    if (!result) return 'Upload an image or generate one with AI'
    const pmsCount = result.vector.palette.filter((c) => c.pmsCode).length
    return `Outline PNG · ${result.vector.palette.length} fills · ${pmsCount} PMS · ${result.vector.regionCount} shapes`
  }, [busy, error, isPending, result])

  return (
    <div className="app">
      <header className="hero">
        <h1 className="brand">Enamel Pin Creator</h1>
        <p className="lede">
          Upload or generate artwork for soft enamel pins, then get two outputs: a transparent
          stroke-outline PNG and a flat-color vector SVG snapped to a pin-ready PMS chart.
        </p>
      </header>

      <div className="layout">
        <aside className="panel">
          <div className="tabs source-tabs" role="tablist" aria-label="Source">
            <button
              type="button"
              className={`tab ${sourceMode === 'upload' ? 'active' : ''}`}
              onClick={() => setSourceMode('upload')}
            >
              Upload
            </button>
            <button
              type="button"
              className={`tab ${sourceMode === 'ai' ? 'active' : ''}`}
              onClick={() => setSourceMode('ai')}
            >
              AI generate
            </button>
          </div>

          {sourceMode === 'upload' ? (
            <>
              <h2>Artwork</h2>
              <Dropzone onFile={onFile} disabled={busy} />
            </>
          ) : (
            <AiGenerate onGenerate={onGenerate} disabled={busy} />
          )}

          <DualControls
            settings={settings}
            onChange={setSettings}
            disabled={busy}
          />

          <button
            type="button"
            className="btn btn-secondary chart-btn"
            onClick={() => setChartOpen(true)}
          >
            Browse PMS chart ({getPmsChartSize()})
          </button>

          {result && (
            <PaletteMerge
              palette={result.vector.palette}
              merges={merges}
              onChangeMerges={onMergesChange}
              onOverridePms={onOverridePms}
              disabled={busy}
            />
          )}

          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onApply}
              disabled={!sourceImage || busy}
            >
              {busy ? 'Processing…' : 'Reprocess'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadOutline}
              disabled={!result || busy}
            >
              Download outline PNG
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadVector}
              disabled={!result || busy}
            >
              Download vector SVG
            </button>
          </div>
        </aside>

        <section className="panel preview-panel">
          <div className="meta-bar">
            <div className="tabs" role="tablist" aria-label="Preview mode">
              <button
                type="button"
                className={`tab ${viewMode === 'vector' ? 'active' : ''}`}
                onClick={() => setViewMode('vector')}
                disabled={!result}
              >
                Vector
              </button>
              <button
                type="button"
                className={`tab ${viewMode === 'outline' ? 'active' : ''}`}
                onClick={() => setViewMode('outline')}
                disabled={!result}
              >
                Outline
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
        </section>
      </div>

      <PmsChartModal
        open={chartOpen}
        title="Enamel pin PMS chart"
        onClose={() => setChartOpen(false)}
        onPick={() => setChartOpen(false)}
      />
    </div>
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'ai-artwork'
  )
}
