import { NextResponse } from "next/server";
import { buildMosaicPrompt } from "@/lib/prompt";
import { generateMosaicImage } from "@/lib/xai";
import {
  ASPECT_RATIO_OPTIONS,
  COLOR_COUNT_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_BACKGROUND_MODE,
  DEFAULT_BORDER_MODE,
  DEFAULT_COLOR_COUNT,
  DEFAULT_CORNER_STYLE,
  DEFAULT_DETAIL_LEVEL,
  type AspectRatio,
  type BackgroundMode,
  type BorderMode,
  type ColorCount,
  type CornerStyle,
  type DetailLevel,
  type GenerateResponse,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  prompt?: unknown;
  colorCount?: unknown;
  aspectRatio?: unknown;
  detailLevel?: unknown;
  borderMode?: unknown;
  cornerStyle?: unknown;
  backgroundMode?: unknown;
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

function isAspectRatio(value: unknown): value is AspectRatio {
  return (
    typeof value === "string" &&
    ASPECT_RATIO_OPTIONS.includes(value as AspectRatio)
  );
}

function isDetailLevel(value: unknown): value is DetailLevel {
  return value === "simple" || value === "detailed";
}

function isBorderMode(value: unknown): value is BorderMode {
  return value === "none" || value === "tiled" || value === "corners";
}

function isCornerStyle(value: unknown): value is CornerStyle {
  return value === "thin" || value === "thick" || value === "artistic";
}

function isBackgroundMode(value: unknown): value is BackgroundMode {
  return value === "none" || value === "themed";
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
    const aspectRatio = isAspectRatio(body.aspectRatio)
      ? body.aspectRatio
      : DEFAULT_ASPECT_RATIO;
    const detailLevel = isDetailLevel(body.detailLevel)
      ? body.detailLevel
      : DEFAULT_DETAIL_LEVEL;
    const borderMode = isBorderMode(body.borderMode)
      ? body.borderMode
      : DEFAULT_BORDER_MODE;
    const cornerStyle = isCornerStyle(body.cornerStyle)
      ? body.cornerStyle
      : DEFAULT_CORNER_STYLE;
    const backgroundMode = isBackgroundMode(body.backgroundMode)
      ? body.backgroundMode
      : DEFAULT_BACKGROUND_MODE;

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

    const resolvedCornerStyle =
      borderMode === "corners" ? cornerStyle : DEFAULT_CORNER_STYLE;

    const promptUsed = buildMosaicPrompt({
      userPrompt: prompt,
      colorCount,
      aspectRatio,
      detailLevel,
      borderMode,
      cornerStyle: resolvedCornerStyle,
      backgroundMode,
      hasReferenceImage: Boolean(imageDataUrl),
    });

    const result = await generateMosaicImage({
      prompt: promptUsed,
      imageDataUrl,
      aspectRatio,
      apiKey: readApiKey(request, body),
    });

    const payload: GenerateResponse = {
      imageBase64: result.imageBase64,
      mimeType: result.mimeType.startsWith("image/")
        ? result.mimeType
        : "image/png",
      promptUsed,
      colorCount,
      aspectRatio,
      detailLevel,
      borderMode,
      cornerStyle: resolvedCornerStyle,
      backgroundMode,
    };

    return NextResponse.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Generation failed.";
    const status = message.includes("XAI_API_KEY") ? 401 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
