"use client";

import { useEffect, useState, useTransition } from "react";
import { CreatorForm } from "@/components/CreatorForm";
import { Gallery } from "@/components/Gallery";
import { ResultPanel } from "@/components/ResultPanel";
import {
  addToGallery,
  clearGallery,
  loadGallery,
  removeFromGallery,
  toImageDataUrl,
  toPngDataUrl,
} from "@/lib/gallery";
import type {
  ColorCount,
  GalleryItem,
  GenerateResponse,
} from "@/lib/types";

export function MosaicApp() {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [current, setCurrent] = useState<GalleryItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const loaded = loadGallery();
    setItems(loaded);
    if (loaded[0]) setCurrent(loaded[0]);
  }, []);

  async function handleGenerate(input: {
    prompt: string;
    colorCount: ColorCount;
    imageDataUrl?: string;
  }) {
    setError(null);
    setBusy(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      const payload = (await response.json()) as GenerateResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Generation failed.");
      }

      const rawDataUrl = toImageDataUrl(
        payload.imageBase64,
        payload.mimeType,
      );
      const imageDataUrl = await toPngDataUrl(rawDataUrl);

      startTransition(() => {
        const next = addToGallery({
          prompt: input.prompt,
          colorCount: payload.colorCount,
          imageDataUrl,
        });
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
      <header className="hero">
        <div className="hero-atmosphere" aria-hidden="true" />
        <div className="hero-inner">
          <p className="brand">Mosaic</p>
          <h1 className="hero-title">Image Creator</h1>
          <p className="hero-lede">
            Turn a prompt — and an optional photo — into a clean vector mosaic
            blanket design with 2–5 AI-chosen colors.
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
              Grok Imagine builds flat, tile-ready patterns for yarn blankets.
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
            const next = removeFromGallery(id);
            setItems(next);
            setCurrent((prev) => {
              if (!prev || prev.id !== id) return prev;
              return next[0] ?? null;
            });
          }}
          onClear={() => {
            clearGallery();
            setItems([]);
            setCurrent(null);
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
