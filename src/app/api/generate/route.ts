import { NextResponse } from "next/server";
import { buildMosaicPrompt } from "@/lib/prompt";
import { generateMosaicImage } from "@/lib/xai";
import {
  COLOR_COUNT_OPTIONS,
  DEFAULT_COLOR_COUNT,
  type ColorCount,
  type GenerateResponse,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  prompt?: unknown;
  colorCount?: unknown;
  imageDataUrl?: unknown;
  apiKey?: unknown;
};

function readApiKey(request: Request, body: Body): string | undefined {
  const headerKey =
    request.headers.get("x-xai-api-key")?.trim() ||
    request.headers.get("x-api-key")?.trim();
  if (headerKey) return headerKey;

  if (typeof body.apiKey === "string" && body.apiKey.trim()) {
    return body.apiKey.trim();
  }

  return undefined;
}

function isColorCount(value: unknown): value is ColorCount {
  return (
    typeof value === "number" &&
    COLOR_COUNT_OPTIONS.includes(value as ColorCount)
  );
}

function isDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(value)
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Body;
    const prompt =
      typeof body.prompt === "string" ? body.prompt.trim() : "";

    if (!prompt) {
      return NextResponse.json(
        { error: "A text prompt is required." },
        { status: 400 },
      );
    }

    if (prompt.length > 1200) {
      return NextResponse.json(
        { error: "Prompt is too long (max 1200 characters)." },
        { status: 400 },
      );
    }

    const colorCount = isColorCount(body.colorCount)
      ? body.colorCount
      : DEFAULT_COLOR_COUNT;

    const imageDataUrl = isDataUrl(body.imageDataUrl)
      ? body.imageDataUrl
      : undefined;

    if (body.imageDataUrl && !imageDataUrl) {
      return NextResponse.json(
        {
          error:
            "Optional photo must be a PNG, JPEG, or WebP data URL.",
        },
        { status: 400 },
      );
    }

    if (imageDataUrl && imageDataUrl.length > 8_000_000) {
      return NextResponse.json(
        { error: "Photo is too large. Try a smaller image." },
        { status: 400 },
      );
    }

    const promptUsed = buildMosaicPrompt(
      prompt,
      colorCount,
      Boolean(imageDataUrl),
    );

    const result = await generateMosaicImage({
      prompt: promptUsed,
      imageDataUrl,
      apiKey: readApiKey(request, body),
    });

    const payload: GenerateResponse = {
      imageBase64: result.imageBase64,
      mimeType: result.mimeType.startsWith("image/")
        ? result.mimeType
        : "image/png",
      promptUsed,
      colorCount,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Generation failed.";
    const status = message.includes("XAI_API_KEY") ? 401 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
