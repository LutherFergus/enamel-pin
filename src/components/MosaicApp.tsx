"use client";

import { useEffect, useState, useTransition } from "react";
import { ApiKeyGate } from "@/components/ApiKeyGate";
import { CreatorForm } from "@/components/CreatorForm";
import { Gallery } from "@/components/Gallery";
import { ResultPanel } from "@/components/ResultPanel";
import {
  clearApiKey,
  loadApiKey,
  maskApiKey,
  saveApiKey,
} from "@/lib/apiKey";
import {
  addToGallery,
  clearGallery,
  loadGallery,
  removeFromGallery,
  toImageDataUrl,
  toPngDataUrl,
} from "@/lib/gallery";
import type {
  GalleryItem,
  GenerateOptions,
  GenerateResponse,
} from "@/lib/types";

export function MosaicApp() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [current, setCurrent] = useState<GalleryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [keyReady, setKeyReady] = useState(false);
  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [editingKey, setEditingKey] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const loaded = await loadGallery();
      if (cancelled) return;
      setItems(loaded);
      if (loaded[0]) setCurrent(loaded[0]);

      const storedKey = loadApiKey();
      setApiKey(storedKey);
      setKeyReady(true);
      setKeyModalOpen(!storedKey);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSaveKey(key: string) {
    saveApiKey(key);
    setApiKey(key);
    setKeyModalOpen(false);
    setEditingKey(false);
    setError(null);
  }

  function handleClearKey() {
    clearApiKey();
    setApiKey("");
    setEditingKey(false);
    setKeyModalOpen(true);
  }

  async function handleGenerate(input: GenerateOptions) {
    setError(null);

    const key = apiKey.trim() || loadApiKey();
    if (!key) {
      setKeyModalOpen(true);
      setError("Add your xAI API key to generate mosaics.");
      return;
    }

    setBusy(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-xai-api-key": key,
        },
        body: JSON.stringify(input),
      });

      const payload = (await response.json()) as GenerateResponse & {
        error?: string;
      };

      if (!response.ok) {
        if (response.status === 401) {
          setKeyModalOpen(true);
        }
        throw new Error(payload.error || "Generation failed.");
      }

      const rawDataUrl = toImageDataUrl(
        payload.imageBase64,
        payload.mimeType,
      );
      const imageDataUrl = await toPngDataUrl(rawDataUrl);
      const next = await addToGallery({
        prompt: input.prompt,
        colorCount: payload.colorCount,
        aspectRatio: payload.aspectRatio,
        detailLevel: payload.detailLevel,
        borderMode: payload.borderMode,
        cornerStyle: payload.cornerStyle,
        backgroundMode: payload.backgroundMode,
        imageDataUrl,
      });

      startTransition(() => {
        setItems(next);
        setCurrent(next[0] ?? null);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <ApiKeyGate
        open={keyReady && keyModalOpen}
        initialKey={apiKey}
        allowDismiss={editingKey && Boolean(apiKey)}
        onSave={handleSaveKey}
        onClose={() => {
          setKeyModalOpen(false);
          setEditingKey(false);
        }}
      />

      <header className="hero">
        <div className="hero-atmosphere" aria-hidden="true" />
        <div className="hero-inner">
          <div className="hero-top">
            <p className="brand">Mosaic</p>
            {keyReady ? (
              <div className="key-chip">
                {apiKey ? (
                  <>
                    <span>Key {maskApiKey(apiKey)}</span>
                    <button
                      type="button"
                      className="text-btn key-chip-btn"
                      onClick={() => {
                        setEditingKey(true);
                        setKeyModalOpen(true);
                      }}
                    >
                      Change
                    </button>
                    <button
                      type="button"
                      className="text-btn key-chip-btn"
                      onClick={handleClearKey}
                    >
                      Clear
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="text-btn key-chip-btn"
                    onClick={() => setKeyModalOpen(true)}
                  >
                    Add API key
                  </button>
                )}
              </div>
            ) : null}
          </div>
          <h1 className="hero-title">Image Creator</h1>
          <p className="hero-lede">
            Turn a few words — and an optional photo — into mosaic-blanket-ready
            vector art with stitch-safe colors, borders, and backgrounds.
          </p>
          <div className="hero-cta">
            <a className="primary-btn" href="#create">
              Start designing
            </a>
            <a className="ghost-btn" href="#gallery">
              Open gallery
            </a>
          </div>
        </div>
      </header>

      <main className="main">
        <section className="create" id="create">
          <div className="section-head">
            <h2>Design</h2>
            <p>
              A mosaic brain keeps every design chartable for yarn blankets.
              Simple usually wins.
            </p>
          </div>
          <div className="create-grid">
            <CreatorForm busy={busy || pending} onGenerate={handleGenerate} />
            <ResultPanel item={current} busy={busy} error={error} />
          </div>
        </section>

        <Gallery
          items={items}
          onSelect={setCurrent}
          onRemove={(id) => {
            void (async () => {
              const next = await removeFromGallery(id);
              setItems(next);
              setCurrent((prev) => {
                if (!prev || prev.id !== id) return prev;
                return next[0] ?? null;
              });
            })();
          }}
          onClear={() => {
            void (async () => {
              await clearGallery();
              setItems([]);
              setCurrent(null);
            })();
          }}
        />
      </main>

      <footer className="site-footer">
        <p>
          Mosaic Image Creator v1 · Powered by Grok Imagine · Gallery stays in
          your browser
        </p>
      </footer>
    </div>
  );
}
