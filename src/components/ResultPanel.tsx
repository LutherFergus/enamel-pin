"use client";

import type { GalleryItem } from "@/lib/types";
import { downloadPng } from "@/lib/gallery";

type ResultPanelProps = {
  item: GalleryItem | null;
  busy: boolean;
  error: string | null;
};

function settingsLabel(item: GalleryItem): string {
  const border =
    item.borderMode === "border"
      ? `border · ${item.borderComplexity}`
      : "no border";
  return `${item.aspectRatio} · ${item.detailLevel} · ${border} · ${item.colorCount} colors`;
}

export function ResultPanel({ item, busy, error }: ResultPanelProps) {
  return (
    <section className="result-panel" aria-live="polite">
      <div className="section-head">
        <h2>Preview</h2>
        <p>Download a PNG for graphing or sharing.</p>
      </div>

      <div className="preview-stage">
        {busy ? (
          <div className="preview-empty">
            <span className="pulse-dot" aria-hidden="true" />
            Generating a crisp vector design…
          </div>
        ) : item ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="preview-image"
              src={item.imageDataUrl}
              alt={`Design: ${item.prompt}`}
            />
            <div className="preview-meta">
              <p className="preview-prompt">{item.prompt}</p>
              <p className="preview-colors">{settingsLabel(item)}</p>
              <button
                type="button"
                className="secondary-btn"
                onClick={() =>
                  downloadPng(
                    item.imageDataUrl,
                    `mosaic-${item.aspectRatio.replace(":", "x")}-${item.id.slice(0, 8)}.png`,
                  )
                }
              >
                Download PNG
              </button>
            </div>
          </>
        ) : (
          <div className="preview-empty">
            Your design will appear here — crisp, flat, and mosaic-ready.
          </div>
        )}
      </div>

      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}
