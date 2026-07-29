import {
  GALLERY_MAX_ITEMS,
  GALLERY_STORAGE_KEY,
  type ColorCount,
  type GalleryItem,
} from "./types";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadGallery(): GalleryItem[] {
  if (!canUseStorage()) return [];
  try {
    const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GalleryItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, GALLERY_MAX_ITEMS);
  } catch {
    return [];
  }
}

function saveGallery(items: GalleryItem[]): void {
  if (!canUseStorage()) return;
  localStorage.setItem(
    GALLERY_STORAGE_KEY,
    JSON.stringify(items.slice(0, GALLERY_MAX_ITEMS)),
  );
}

export function addToGallery(input: {
  prompt: string;
  colorCount: ColorCount;
  imageDataUrl: string;
}): GalleryItem[] {
  const nextItem: GalleryItem = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `mosaic-${Date.now()}`,
    prompt: input.prompt,
    colorCount: input.colorCount,
    imageDataUrl: input.imageDataUrl,
    createdAt: new Date().toISOString(),
  };

  const existing = loadGallery().filter((item) => item.id !== nextItem.id);
  const next = [nextItem, ...existing].slice(0, GALLERY_MAX_ITEMS);
  saveGallery(next);
  return next;
}

export function removeFromGallery(id: string): GalleryItem[] {
  const next = loadGallery().filter((item) => item.id !== id);
  saveGallery(next);
  return next;
}

export function clearGallery(): GalleryItem[] {
  saveGallery([]);
  return [];
}

export function downloadPng(imageDataUrl: string, filename: string): void {
  const link = document.createElement("a");
  link.href = imageDataUrl;
  link.download = filename.endsWith(".png") ? filename : `${filename}.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function toImageDataUrl(base64: string, mimeType = "image/png"): string {
  const normalized =
    mimeType === "image/png" ||
    mimeType === "image/jpeg" ||
    mimeType === "image/webp"
      ? mimeType
      : "image/png";
  return `data:${normalized};base64,${base64}`;
}

/** Normalize any generated image to a PNG data URL for download/gallery. */
export async function toPngDataUrl(imageDataUrl: string): Promise<string> {
  if (imageDataUrl.startsWith("data:image/png")) {
    return imageDataUrl;
  }

  const image = await loadImage(imageDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not convert image to PNG.");
  }
  ctx.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

export async function fileToResizedDataUrl(
  file: File,
  maxEdge = 1024,
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Could not prepare image preview.");
    }
    ctx.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read that image."));
    image.src = src;
  });
}
