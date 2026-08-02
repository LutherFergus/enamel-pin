import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { AiGenerate } from './components/AiGenerate'
import { DualControls } from './components/DualControls'
import { Dropzone } from './components/Dropzone'
import { PaletteMerge } from './components/PaletteMerge'
import { PmsChartModal } from './components/PmsChartModal'
import { Preview, type PreviewTab } from './components/Preview'
import { SaveScreenshotButton } from './components/SaveScreenshotButton'
import { generateAiImage, type PinheadsTheme } from './lib/aiGenerate'
import { type PmsOverrides } from './lib/colorVectorize'
import { exportTabLayers } from './lib/exportLayers'
import { sourceImageToSvg } from './lib/originalSvg'
import {
  createDualOutputs,
  DEFAULT_DUAL_SETTINGS,
  remergeVector,
  revokeDualUrls,
  type DualOutputResult,
  type DualOutputSettings,
} from './lib/pipeline'
import { getPmsChartSize } from './lib/pms'
import type { MatchReferences } from './lib/matchOverlay'
import {
  forgetRememberedSettings,
  initialSettings,
  loadRememberedSettings,
  rememberSettings,
} from './lib/rememberSettings'
import { loadImageFromFile } from './lib/vectorize'

type SourceMode = 'upload' | 'ai'

function formatSavedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

export default function App() {
  const rememberedBoot = loadRememberedSettings()
  const [settings, setSettings] = useState<DualOutputSettings>(
    () => initialSettings(),
  )
  const [savedLabel, setSavedLabel] = useState<string | null>(
    rememberedBoot ? formatSavedAt(rememberedBoot.savedAt) : null,
  )
  const [sourceMode, setSourceMode] = useState<SourceMode>('upload')
  const [sourceName, setSourceName] = useState('artwork')
  const [sourceUrl, setSourceUrl] = useState<string | null>(null)
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(null)
  const [result, setResult] = useState<DualOutputResult | null>(null)
  const [merges, setMerges] = useState<Array<[number, number]>>([])
  const [pmsOverrides, setPmsOverrides] = useState<PmsOverrides>({})
  const [disabledColors, setDisabledColors] = useState<number[]>([])
  const [chartOpen, setChartOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<PreviewTab>('source')
  const [isPending, startTransition] = useTransition()
  const [busy, setBusy] = useState(false)
  const [matchRefs, setMatchRefs] = useState<MatchReferences>({
    outlineUrl: null,
    outlineName: null,
    vectorUrl: null,
    vectorName: null,
  })

  useEffect(() => {
    return () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl)
      revokeDualUrls(result)
      if (matchRefs.outlineUrl) URL.revokeObjectURL(matchRefs.outlineUrl)
      if (matchRefs.vectorUrl) URL.revokeObjectURL(matchRefs.vectorUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- unmount cleanup only
  }, [])

  const onMatchOutlineFile = useCallback((file: File | null) => {
    setMatchRefs((prev) => {
      if (prev.outlineUrl) URL.revokeObjectURL(prev.outlineUrl)
      if (!file) {
        return { ...prev, outlineUrl: null, outlineName: null }
      }
      return {
        ...prev,
        outlineUrl: URL.createObjectURL(file),
        outlineName: file.name,
      }
    })
    // Auto-enable overlay when a reference is dropped.
    if (file) {
      setSettings((s) => {
        const next = { ...s, match: { ...s.match, enabled: true } }
        const saved = rememberSettings(next)
        setSavedLabel(formatSavedAt(saved.savedAt))
        return next
      })
      setViewMode('outline')
    }
  }, [])

  const onMatchVectorFile = useCallback((file: File | null) => {
    setMatchRefs((prev) => {
      if (prev.vectorUrl) URL.revokeObjectURL(prev.vectorUrl)
      if (!file) {
        return { ...prev, vectorUrl: null, vectorName: null }
      }
      return {
        ...prev,
        vectorUrl: URL.createObjectURL(file),
        vectorName: file.name,
      }
    })
    if (file) {
      setSettings((s) => {
        const next = { ...s, match: { ...s.match, enabled: true } }
        const saved = rememberSettings(next)
        setSavedLabel(formatSavedAt(saved.savedAt))
        return next
      })
      setViewMode('vector')
    }
  }, [])

  const onSettingsChange = useCallback((next: DualOutputSettings) => {
    setSettings(next)
    const saved = rememberSettings(next)
    setSavedLabel(formatSavedAt(saved.savedAt))
  }, [])

  const refreshVector = useCallback(
    async (
      nextMerges: Array<[number, number]>,
      nextOverrides: PmsOverrides,
      nextDisabled: number[] = disabledColors,
      nextSettings: DualOutputSettings = settings,
    ) => {
      if (!result) return
      setBusy(true)
      setError(null)
      try {
        const next = await remergeVector(
          result,
          nextMerges,
          nextSettings.vector.smoothness,
          nextSettings.vector.snapToPms,
          nextOverrides,
          nextSettings.vector.detailRetention,
          nextSettings.vector.pmsTolerance,
          nextDisabled,
        )
        startTransition(() => {
          setResult((prev) => {
            if (!prev) return prev
            // remergeVector already revoked previous proof; revoke old vector URL
            URL.revokeObjectURL(prev.vector.svgUrl)
            return next
          })
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Palette update failed')
      } finally {
        setBusy(false)
      }
    },
    [disabledColors, result, settings],
  )

  const runPipeline = useCallback(
    async (
      image: HTMLImageElement,
      nextSettings: DualOutputSettings,
      nextMerges: Array<[number, number]>,
      nextOverrides: PmsOverrides,
      opts: { preserveView?: boolean } = {},
      nextDisabled: number[] = [],
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
          (partial) => {
            // Outline is ready — show it while color vector still runs.
            startTransition(() => {
              setResult((prev) => {
                revokeDualUrls(prev)
                return partial
              })
              if (!opts.preserveView) {
                setViewMode('outline')
              }
            })
          },
          nextDisabled,
        )
        startTransition(() => {
          setResult((prev) => {
            // `next` reuses the same outline object/URLs from `partial`.
            // Placeholder vector/proof were already revoked inside createDualOutputs.
            if (prev && prev.outline.svgUrl === next.outline.svgUrl) {
              return next
            }
            revokeDualUrls(prev)
            return next
          })
          if (!opts.preserveView) {
            setViewMode('proof')
          }
        })
      } catch (err) {
        // Keep any outline that already landed; surface the vector failure.
        setError(
          err instanceof Error ? err.message : 'Processing failed',
        )
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
    setDisabledColors([])
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
    setDisabledColors([])
    void runPipeline(sourceImage, settings, [], {}, { preserveView: true }, [])
  }, [runPipeline, settings, sourceImage])

  const onMergesChange = useCallback(
    async (nextMerges: Array<[number, number]>) => {
      setMerges(nextMerges)
      await refreshVector(nextMerges, pmsOverrides, disabledColors)
    },
    [disabledColors, pmsOverrides, refreshVector],
  )

  const onOverridePms = useCallback(
    async (paletteIndex: number, pmsCode: string) => {
      const next = { ...pmsOverrides, [paletteIndex]: pmsCode }
      setPmsOverrides(next)
      await refreshVector(merges, next, disabledColors)
    },
    [disabledColors, merges, pmsOverrides, refreshVector],
  )

  const onDisabledColorsChange = useCallback(
    async (nextDisabled: number[]) => {
      setDisabledColors(nextDisabled)
      await refreshVector(merges, pmsOverrides, nextDisabled)
    },
    [merges, pmsOverrides, refreshVector],
  )

  const onResetDefaults = useCallback(() => {
    forgetRememberedSettings()
    const defaults = structuredClone(DEFAULT_DUAL_SETTINGS)
    setSettings(defaults)
    const saved = rememberSettings(defaults)
    setSavedLabel(formatSavedAt(saved.savedAt))
  }, [])

  const downloadOutline = useCallback(() => {
    if (!result) return
    downloadBlob(result.outline.pngBlob, `${sourceName}-outline.png`)
  }, [result, sourceName])

  const downloadOutlineSvg = useCallback(() => {
    if (!result) return
    downloadBlob(result.outline.svgBlob, `${sourceName}-outline.svg`)
  }, [result, sourceName])

  const downloadVector = useCallback(() => {
    if (!result) return
    downloadBlob(result.vector.svgBlob, `${sourceName}-vector.svg`)
  }, [result, sourceName])

  const [originalSvgBusy, setOriginalSvgBusy] = useState(false)
  const downloadOriginalSvg = useCallback(async () => {
    if (!sourceUrl) return
    setOriginalSvgBusy(true)
    setError(null)
    try {
      const blob = await sourceImageToSvg(sourceUrl, 2000)
      downloadBlob(blob, `${sourceName}-original.svg`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Original SVG export failed')
    } finally {
      setOriginalSvgBusy(false)
    }
  }, [sourceName, sourceUrl])

  const downloadProof = useCallback(() => {
    if (!result) return
    downloadBlob(result.proof.svgBlob, `${sourceName}-proof.svg`)
  }, [result, sourceName])

  const [layerExportBusy, setLayerExportBusy] = useState(false)

  const downloadLayers = useCallback(
    async (format: 'psd' | 'tiff') => {
      if (!result || result.vectorPending) return
      setLayerExportBusy(true)
      setError(null)
      try {
        const blob = await exportTabLayers({ sourceUrl, result, maxDim: 2000 }, format)
        const ext = format === 'psd' ? 'psd' : 'tiff'
        downloadBlob(blob, `${sourceName}-layers.${ext}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Layer export failed')
      } finally {
        setLayerExportBusy(false)
      }
    },
    [result, sourceName, sourceUrl],
  )

  const statusText = useMemo(() => {
    if (error) return error
    if (busy || isPending) {
      if (result?.outline && result.vectorPending) {
        return `Outline ready · ${result.outline.pathCount} paths — building color vector…`
      }
      return 'Working…'
    }
    if (!result) return 'Upload an image or generate one with AI'
    const matchOn = settings.match.enabled
    const matchHint =
      matchOn &&
      ((viewMode === 'outline' && matchRefs.outlineUrl) ||
        (viewMode === 'vector' && matchRefs.vectorUrl) ||
        (viewMode === 'proof' && (matchRefs.outlineUrl || matchRefs.vectorUrl)))
        ? ' · overlay match on'
        : ''
    if (viewMode === 'source') return 'Original artwork'
    if (viewMode === 'outline') {
      return `Outline SVG · ${result.outline.widthPx}×${result.outline.heightPx} · ${result.outline.pathCount} paths · #000000${matchHint}`
    }
    if (result.vectorPending || result.vector.palette.length === 0) {
      return `Outline ready · color vector still running or unavailable`
    }
    if (viewMode === 'proof') {
      const pmsCount = result.vector.palette.filter((c) => c.pmsCode).length
      return `Proof SVG · vector (${result.vector.palette.length} fills / ${pmsCount} PMS) + outline (${result.outline.pathCount} paths)${matchHint}`
    }
    const pmsCount = result.vector.palette.filter((c) => c.pmsCode).length
    return `Vector SVG · ${result.vector.palette.length} fills · ${pmsCount} PMS · ${result.vector.regionCount} shapes${matchHint}`
  }, [
    busy,
    error,
    isPending,
    matchRefs.outlineUrl,
    matchRefs.vectorUrl,
    result,
    settings.match.enabled,
    viewMode,
  ])

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-top">
          <h1 className="brand">Enamel Pin Creator</h1>
          <SaveScreenshotButton />
        </div>
        <p className="lede">
          Upload or generate artwork for soft enamel pins, then get transparent outline
          SVG/PNG die-lines, a flat-color vector SVG, and a combined Proof SVG.
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
            onChange={onSettingsChange}
            disabled={busy}
            savedLabel={savedLabel}
            onResetDefaults={onResetDefaults}
            matchRefs={matchRefs}
            onMatchOutlineFile={onMatchOutlineFile}
            onMatchVectorFile={onMatchVectorFile}
          />

          <button
            type="button"
            className="btn btn-secondary chart-btn"
            onClick={() => setChartOpen(true)}
          >
            Browse PMS chart ({getPmsChartSize()})
          </button>

          {result && result.vector.palette.length > 0 && (
            <PaletteMerge
              palette={result.vector.palette}
              merges={merges}
              onChangeMerges={onMergesChange}
              onOverridePms={onOverridePms}
              disabledColors={disabledColors}
              onChangeDisabledColors={onDisabledColorsChange}
              disabled={busy}
            />
          )}

          <div className="actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void downloadOriginalSvg()}
              disabled={!sourceUrl || busy || originalSvgBusy}
            >
              {originalSvgBusy ? 'Exporting original…' : 'Download original SVG'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadVector}
              disabled={!result || busy || !!result.vectorPending || result.vector.palette.length === 0}
            >
              Download vector SVG
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadOutlineSvg}
              disabled={!result}
            >
              Download outline SVG
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadOutline}
              disabled={!result}
            >
              Download outline PNG
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={downloadProof}
              disabled={!result || busy || !!result.vectorPending || result.vector.palette.length === 0}
            >
              Download proof SVG
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void downloadLayers('psd')}
              disabled={
                !result ||
                busy ||
                layerExportBusy ||
                !!result.vectorPending ||
                result.vector.palette.length === 0
              }
            >
              {layerExportBusy ? 'Exporting layers…' : 'Download for Sketchbook (PSD)'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void downloadLayers('tiff')}
              disabled={
                !result ||
                busy ||
                layerExportBusy ||
                !!result.vectorPending ||
                result.vector.palette.length === 0
              }
            >
              Download multipage TIFF
            </button>
            <p className="hint">
              For Sketchbook: use the PSD — File → Open. Layers bottom → top:
              Outline, Vector, Original. Multipage TIFF is not Sketchbook’s
              native layered TIFF and usually won’t keep layers there.
            </p>
          </div>
        </aside>

        <section className="panel preview-panel">
          <div className="meta-bar">
            <div className="meta-bar-top">
              <div className="tabs" role="tablist" aria-label="Preview mode">
                <button
                  type="button"
                  className={`tab ${viewMode === 'source' ? 'active' : ''}`}
                  onClick={() => setViewMode('source')}
                  disabled={!sourceUrl}
                >
                  Original
                </button>
                <button
                  type="button"
                  className={`tab ${viewMode === 'vector' ? 'active' : ''}`}
                  onClick={() => setViewMode('vector')}
                  disabled={!result || !!result.vectorPending || result.vector.palette.length === 0}
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
                  className={`tab ${viewMode === 'proof' ? 'active' : ''}`}
                  onClick={() => setViewMode('proof')}
                  disabled={!result || !!result.vectorPending || result.vector.palette.length === 0}
                >
                  Proof
                </button>
              </div>
              <div className="preview-actions">
                <button
                  type="button"
                  className="btn btn-primary reprocess-btn"
                  onClick={onApply}
                  disabled={!sourceImage || busy}
                >
                  {busy ? 'Processing…' : 'Reprocess'}
                </button>
              </div>
            </div>
            <p className={`status ${error ? 'error' : ''}`}>{statusText}</p>
          </div>

          <Preview
            viewMode={viewMode}
            sourceUrl={sourceUrl}
            result={result}
            busy={busy || isPending}
            match={settings.match}
            matchRefs={matchRefs}
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
