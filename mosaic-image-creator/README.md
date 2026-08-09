# Mosaic Image Creator

Next.js app that turns a text prompt (and an optional photo) into **clean vector mosaic blanket designs** using the [Grok Imagine API](https://docs.x.ai/developers/model-capabilities/imagine).

## Features (v1)

- Asks for your **xAI API key** in the browser (saved locally; Change/Clear anytime)
- Short subject prompt — a **mosaic brain** expands it and enforces stitch-feasible rules
- Orientation + proportions (square / landscape / portrait ratios)
- **Simple / Detailed**, **Background / No background**, **Border: None / Tiled / Corners** (corners: Thin / Thick / Artistic)
- Optional reference photo
- AI-chosen palette of **2–5 colors** (default **2**)
- Exclusive output: mosaic-blanket-ready crisp flat vector art (2k PNG)
- Browser gallery in IndexedDB, capped at **50** designs
- Ready for **Netlify** deploy (optional server-side `XAI_API_KEY`)

## Stack

- Next.js 15 (App Router)
- TypeScript + Tailwind CSS v4
- xAI Imagine endpoints:
  - `POST https://api.x.ai/v1/images/generations` (prompt only)
  - `POST https://api.x.ai/v1/images/edits` (prompt + photo)
- Model: `grok-imagine-image-quality`

## Setup

1. Clone the repo and install dependencies:

```bash
npm install
```

2. Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first visit the app asks for your API key from [console.x.ai](https://console.x.ai). The key is stored in `localStorage` on your device.

Optional: you can still set a server default key instead of (or in addition to) the browser prompt:

```bash
cp .env.example .env.local
```

```env
XAI_API_KEY=your_xai_api_key_here
```

## Environment variables

| Variable       | Required | Description                                      |
|----------------|----------|--------------------------------------------------|
| `XAI_API_KEY`  | No*      | Optional server fallback for the xAI API         |

\*Required only if you do **not** enter a key in the UI. When a browser key is provided, it is sent to `/api/generate` via the `x-xai-api-key` header and used for that request. The browser key never becomes a public env var.

## Deploy on Netlify

1. Connect this repository in Netlify.
2. Build settings are already in `netlify.toml` (uses `@netlify/plugin-nextjs`).
3. Optional: add site environment variable `XAI_API_KEY` if you want a shared server key. Otherwise visitors enter their own key in the UI.
4. Deploy.

Local Netlify CLI (optional):

```bash
npx netlify dev
```

## Usage

1. Enter your xAI API key when prompted (or use **Change** in the header later).
2. Type a short subject (e.g. `sleepy fox`) — you do not need a long prompt.
3. Pick orientation + proportion, detail, background, border options, and color count.
4. Optional: click **Preview prompt** to inspect the full Imagine prompt (no API call).
5. Optionally upload a photo to convert into a crisp vector motif.
6. Click **Create design**, then **Download PNG**.
7. Browse past designs in the on-device gallery (max 50; oldest drop off).

## Scripts

| Command        | Description              |
|----------------|--------------------------|
| `npm run dev`  | Start local development  |
| `npm run build`| Production build         |
| `npm start`    | Serve production build   |
| `npm run lint` | Run ESLint               |

## Project layout

```
src/
  app/
    api/generate/route.ts   # Grok Imagine proxy
    page.tsx
    layout.tsx
    globals.css
  components/
    MosaicApp.tsx
    ApiKeyGate.tsx          # Browser API key prompt
    CreatorForm.tsx
    ResultPanel.tsx
    Gallery.tsx
  lib/
    mosaic-brain/           # Stitch-feasibility engine + theme knowledge
    xai.ts                  # xAI client
    apiKey.ts               # localStorage API key helpers
    prompt.ts               # Mosaic style prompt builder
    gallery.ts              # IndexedDB gallery helpers
    types.ts
netlify.toml
.env.example
```

## Notes

- On first visit (or after Clear), the UI asks for your xAI API key and stores it in `localStorage`.
- The mosaic brain checks every option against yarn/graphghan limits (large shapes, limited colors, no tiny border icons) and injects those rules into the Imagine prompt.
- Generated images are requested as `b64_json` so PNG download and gallery storage work without relying on temporary xAI URLs.
- Reference photos are resized client-side before upload to keep payloads modest.
- The gallery never leaves the user’s browser (IndexedDB; max 50 designs).
