# Enamel Pin Vectorizer

Browser app that turns images into soft-enamel-ready SVGs.

## Features

- Upload artwork (PNG, JPG, WebP)
- Limit enamel fill color count
- Set pin size in millimeters (converted to pixels via DPI)
- Merge regions below a minimum fill size
- Draw thin metal outlines where colors meet (plus outer rim)
- Preview and download SVG

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

## Soft enamel defaults

| Setting | Default | Notes |
| --- | --- | --- |
| Color count | 6 | Flat enamel fills |
| Pin width | 38 mm | ~1.5 in |
| Min fill | 0.6 mm | Tiny regions merge into neighbors |
| Metal wall | 0.25 mm | Outline stroke where colors meet |
| DPI | 300 | Used for mm → px conversion |

Adjust these in the sidebar to match your manufacturer’s specs.
