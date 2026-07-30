# AGENTS.md

## Cursor Cloud specific instructions

Enamel Pin Creator is a **client-side-only** Vite + React + TypeScript single-page app. There is no backend, database, or auth. All image processing (outline PNG + color vector SVG) runs in the browser.

### Services

Single service — the Vite dev server.

- Dev: `npm run dev` (serves on `http://localhost:5173/`)
- Build (also runs `tsc -b` typecheck): `npm run build`
- Preview a production build: `npm run preview`
- There is no lint script and no test suite configured. `npm run build` is the closest thing to a static check (TypeScript project references).

### Notes / gotchas

- The "AI generate" tab calls the public Pollinations API (`image.pollinations.ai`) directly from the browser with no API key. It requires outbound internet access; if egress is blocked it will fail. The **Upload** path is fully offline and is the reliable way to exercise the core pipeline.
- Core flow to smoke-test: upload a PNG/JPG/WebP → dual preview updates **live** (~220ms debounce) when settings change — there is no Reprocess button. Downloads: outline SVG + color vector SVG.
- Enamel mock outline path (elephant Org→Outline): extracts **black hatch + morphological edges of gold dams**, not filled gold blobs and not color-cell boundaries. Dark studio backdrops are flood-cleared from the frame (not blanket-thresholded). Defaults: `sensitivity: 70`, `thickness: 1`, `colorCount: 14`, `maxDim: 2000`.
- Line-art uploads stay on the ink-preserve path (one black fill). Color-art remaps gold metal to black before quantize; merge near-duplicates **before** pinning the black slot (otherwise fills collapse to all-black).
- Optional QA: `scripts/elephant-selftest.mjs` / `scripts/qa-elephant.mjs` need Vite on `:5173` plus Playwright Chromium (`npx playwright install chromium` if missing).
