# Mosaic Image Creator

Next.js app that turns a text prompt (and an optional photo) into **clean vector mosaic blanket designs** using the [Grok Imagine API](https://docs.x.ai/developers/model-capabilities/imagine).

## Features (v1)

- Text prompt + optional reference photo
- AI-chosen palette of **2–5 colors** (default **2**)
- Flat vector / graphghan-friendly mosaic look
- **PNG download** for each design
- Browser gallery stored in `localStorage`, capped at **50** designs
- Ready for **Netlify** deploy with `XAI_API_KEY`

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

2. Copy the env example and add your key from [console.x.ai](https://console.x.ai):

```bash
cp .env.example .env.local
```

```env
XAI_API_KEY=your_xai_api_key_here
```

3. Run the dev server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment variables

| Variable       | Required | Description                                      |
|----------------|----------|--------------------------------------------------|
| `XAI_API_KEY`  | Yes      | Bearer token for the xAI Grok Imagine API        |

The key is read only on the server (`src/app/api/generate/route.ts` / `src/lib/xai.ts`). It is never exposed to the browser.

## Deploy on Netlify

1. Connect this repository in Netlify.
2. Build settings are already in `netlify.toml` (uses `@netlify/plugin-nextjs`).
3. Add site environment variable:

   - Key: `XAI_API_KEY`
   - Value: your xAI API key

4. Deploy.

Local Netlify CLI (optional):

```bash
npx netlify dev
```

## Usage

1. Describe a motif in the prompt (e.g. “sleepy fox under a crescent moon”).
2. Pick how many colors the AI should use (2–5).
3. Optionally upload a photo to convert into a mosaic blanket motif.
4. Click **Create mosaic**, then **Download PNG**.
5. Browse past designs in the on-device gallery (max 50; oldest drop off).

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
    CreatorForm.tsx
    ResultPanel.tsx
    Gallery.tsx
  lib/
    xai.ts                  # xAI client
    prompt.ts               # Mosaic style prompt builder
    gallery.ts              # localStorage gallery helpers
    types.ts
netlify.toml
.env.example
```

## Notes

- Generated images are requested as `b64_json` so PNG download and gallery storage work without relying on temporary xAI URLs.
- Reference photos are resized client-side before upload to keep payloads modest.
- The gallery never leaves the user’s browser.
