# Mosaic Image Creator

Turn uploaded or AI-generated artwork into two production-friendly assets:

1. **Stroke outline PNG** — line art only, transparent background  
2. **Color vector SVG** — flat-color vectorization with adjustable color count and palette merging (Vectorizer.AI–style)

## Features

- Upload PNG / JPG / WebP (or generate from a text prompt)
- Dual output on every run
- Color count slider + click-to-merge swatches to lower the palette further
- Outline sensitivity and stroke thickness controls
- Download both assets independently

## Develop

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Soft enamel pin tooling

The repo also includes enamel-oriented helpers under `src/lib/` (metal walls, mm/DPI fill constraints) used by earlier pin-focused experiments. The main UI ships the dual-output pipeline above.
