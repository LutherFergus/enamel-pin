# Mosaic Image Creator

Turn uploaded or AI-generated artwork into soft enamel pin–ready assets:

1. **Stroke outline PNG** — line art only, transparent background
2. **Color vector SVG** — flat-color vectorization with adjustable color count, palette merging, and a curated **~150-color PMS Solid Coated** chart for enamel fills

## Features

- Upload PNG / JPG / WebP (or generate from a text prompt)
- Dual output on every run
- Color count slider + click-to-merge swatches
- Snap fills to an enamel-pin PMS chart; click any swatch to reassign from the chart
- Outline sensitivity and stroke thickness controls
- Download both assets independently (SVG includes PMS codes)

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

## PMS chart

[`src/data/pms-enamel.json`](src/data/pms-enamel.json) holds ~150 Pantone Solid Coated approximations commonly used for soft enamel pin fills (process colors, neutrals, reds/pinks, blues, greens, pastels, earth tones). Digital RGB/LAB only — always verify against a physical PMS book before production.
