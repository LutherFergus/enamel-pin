const XAI_BASE_URL = "https://api.x.ai/v1";
const MODEL = "grok-imagine-image-quality";

export type XaiImageResult = {
  imageBase64: string;
  mimeType: string;
};

type XaiImageResponse = {
  data?: Array<{
    b64_json?: string | null;
    url?: string | null;
    mime_type?: string | null;
  }>;
  error?: { message?: string };
};

export function resolveApiKey(provided?: string | null): string {
  const fromRequest = provided?.trim();
  if (fromRequest) return fromRequest;

  const fromEnv = process.env.XAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  throw new Error(
    "Missing XAI_API_KEY. Enter your key in the app, or set XAI_API_KEY in the environment.",
  );
}

async function parseXaiResponse(response: Response): Promise<XaiImageResult> {
  const payload = (await response.json()) as XaiImageResponse;

  if (!response.ok) {
    const message =
      payload.error?.message ||
      `xAI request failed with status ${response.status}`;
    throw new Error(message);
  }

  const first = payload.data?.[0];
  if (!first) {
    throw new Error("xAI returned no image data.");
  }

  if (first.b64_json) {
    return {
      imageBase64: first.b64_json,
      mimeType: first.mime_type || "image/png",
    };
  }

  if (first.url) {
    const imageResponse = await fetch(first.url);
    if (!imageResponse.ok) {
      throw new Error("Failed to download generated image from xAI.");
    }
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    const contentType = imageResponse.headers.get("content-type") || "image/png";
    return {
      imageBase64: buffer.toString("base64"),
      mimeType: contentType.split(";")[0].trim() || "image/png",
    };
  }

  throw new Error("xAI response did not include b64_json or url.");
}

export async function generateMosaicImage(options: {
  prompt: string;
  imageDataUrl?: string;
  aspectRatio?: string;
  apiKey?: string | null;
}): Promise<XaiImageResult> {
  const apiKey = resolveApiKey(options.apiKey);
  const hasImage = Boolean(options.imageDataUrl);
  const aspectRatio = options.aspectRatio || "1:1";

  const endpoint = hasImage
    ? `${XAI_BASE_URL}/images/edits`
    : `${XAI_BASE_URL}/images/generations`;

  const body = hasImage
    ? {
        model: MODEL,
        prompt: options.prompt,
        n: 1,
        aspect_ratio: aspectRatio,
        resolution: "2k",
        response_format: "b64_json",
        image: {
          url: options.imageDataUrl,
          type: "image_url",
        },
      }
    : {
        model: MODEL,
        prompt: options.prompt,
        n: 1,
        aspect_ratio: aspectRatio,
        resolution: "2k",
        response_format: "b64_json",
      };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return parseXaiResponse(response);
}
