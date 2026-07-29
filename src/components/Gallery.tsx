"use client";

import type { GalleryItem } from "@/lib/types";
import { downloadPng } from "@/lib/gallery";
import { GALLERY_MAX_ITEMS } from "@/lib/types";

type GalleryProps = {
  items: GalleryItem[];
  onSelect: (item: GalleryItem) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
};

export function Gallery({ items, onSelect, onRemove, onClear }: GalleryProps) {
  return (
    <section className="gallery" id="gallery">
      <div className="section-head gallery-head">
        <div>
          <h2>Browser gallery</h2>
          <p>
            Saved on this device only — capped at {GALLERY_MAX_ITEMS} designs.
          </p>
        </div>
        {items.length > 0 ? (
          <button type="button" className="text-btn" onClick={onClear}>
            Clear all
          </button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="gallery-empty">
          Generated mosaics land here so you can revisit and re-download them.
        </p>
      ) : (
        <ul className="gallery-grid">
          {items.map((item) => (
            <li key={item.id} className="gallery-item">
              <button
                type="button"
                className="gallery-thumb-btn"
                onClick={() => onSelect(item)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageDataUrl}
                  alt=""
                  className="gallery-thumb"
                />
                <span className="gallery-caption">
                  <span className="gallery-caption-prompt">{item.prompt}</span>
                  <span className="gallery-caption-meta">
                    {item.aspectRatio} · {item.detailLevel} ·{" "}
                    {item.backgroundMode === "themed" ? "bg" : "no bg"} ·{" "}
                    {item.colorCount} colors ·{" "}
                    {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </span>
              </button>
              <div className="gallery-actions">
                <button
                  type="button"
                  className="text-btn"
                  onClick={() =>
                    downloadPng(
                      item.imageDataUrl,
                      `mosaic-${item.colorCount}c-${item.id.slice(0, 8)}.png`,
                    )
                  }
                >
                  PNG
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => onRemove(item.id)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
