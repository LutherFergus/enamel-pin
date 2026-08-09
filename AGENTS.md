# AGENTS.md

## Cursor Cloud specific instructions

Enamel Pin Creator is a **client-side-only** Vite + React + TypeScript single-page app. There is no backend, database, or auth. All image processing (outline PNG + color vector SVG) runs in the browser.

### Related app in this repo

`mosaic-image-creator/` is a separate **Next.js** Grok Imagine generator (mosaic-blanket-ready vector art) merged from the Mosaic Image Creator agent (`cursor/mosaic-image-creator-v1-ba02`).

- Dev: `cd mosaic-image-creator && npm install && npm run dev` (port `3000`)
- Requires an xAI API key in the browser UI (or `XAI_API_KEY` env)
- Includes mosaic-brain prompt engine, preview-prompt UI, gallery, Netlify config

### Services

Single service for enamel — the Vite dev server.

- Dev: `npm run dev` (serves on `http://localhost:5173/`)
- Build (also runs `tsc -b` typecheck): `npm run build`
- Preview a production build: `npm run preview`
- There is no lint script and no test suite configured. `npm run build` is the closest thing to a static check (TypeScript project references).

### Notes / gotchas

- The enamel "AI generate" tab currently calls the public Pollinations API (`image.pollinations.ai`) directly from the browser with no API key. It requires outbound internet access; if egress is blocked it will fail. The **Upload** path is fully offline and is the reliable way to exercise the core pipeline.
- Core flow to smoke-test: upload a PNG/JPG/WebP → the app produces a Vector (SVG) and Outline (PNG) preview and enables the download buttons.
