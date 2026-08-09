import {
  DEFAULT_ASPECT_RATIO,
  DEFAULT_BACKGROUND_MODE,
  DEFAULT_BORDER_MODE,
  DEFAULT_CORNER_STYLE,
  DEFAULT_DETAIL_LEVEL,
  GALLERY_MAX_ITEMS,
  GALLERY_STORAGE_KEY,
  type AspectRatio,
  type BackgroundMode,
  type BorderMode,
  type ColorCount,
  type CornerStyle,
  type DetailLevel,
  type GalleryItem,
} from "./types";

const DB_NAME = "mosaic-image-creator";
const DB_VERSION = 1;
const STORE_NAME = "gallery";

function migrateBorderMode(raw: unknown): BorderMode {
  if (raw === "tiled" || raw === "corners" || raw === "none") return raw;
  if (raw === "border") return "corners";
  return DEFAULT_BORDER_MODE;
}

function migrateCornerStyle(
  item: Partial<GalleryItem> & { borderComplexity?: unknown },
): CornerStyle {
  if (
    item.cornerStyle === "thin" ||
    item.cornerStyle === "thick" ||
    item.cornerStyle === "artistic"
  ) {
    return item.cornerStyle;
  }
  if (item.borderComplexity === "complex") return "artistic";
  if (item.borderComplexity === "simple") return "thin";
  return DEFAULT_CORNER_STYLE;
}

function normalizeGalleryItem(item: Partial<GalleryItem> & {
  id?: string;
  prompt?: string;
  colorCount?: ColorCount;
  imageDataUrl?: string;
  createdAt?: string;
  borderComplexity?: unknown;
}): GalleryItem | null {
  if (
    !item.id ||
    !item.prompt ||
    !item.colorCount ||
    !item.imageDataUrl ||
    !item.createdAt
  ) {
    return null;
  }

  return {
    id: item.id,
    prompt: item.prompt,
    colorCount: item.colorCount,
    aspectRatio: (item.aspectRatio as AspectRatio) || DEFAULT_ASPECT_RATIO,
    detailLevel: (item.detailLevel as DetailLevel) || DEFAULT_DETAIL_LEVEL,
    borderMode: migrateBorderMode(item.borderMode),
    cornerStyle: migrateCornerStyle(item),
    backgroundMode:
      (item.backgroundMode as BackgroundMode) || DEFAULT_BACKGROUND_MODE,
    imageDataUrl: item.imageDataUrl,
    createdAt: item.createdAt,
  };
}

function canUseIndexedDb(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openGalleryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not open gallery storage."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Gallery storage request failed."));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("Gallery storage transaction failed."));
    tx.onabort = () =>
      reject(tx.error ?? new Error("Gallery storage transaction aborted."));
  });
}

function sortNewestFirst(items: GalleryItem[]): GalleryItem[] {
  return [...items].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function readLegacyLocalStorageGallery(): GalleryItem[] {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return [];
  }
  try {
    const raw = localStorage.getItem(GALLERY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GalleryItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearLegacyLocalStorageGallery(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(GALLERY_STORAGE_KEY);
  } catch {
    // Ignore quota/security errors while clearing.
  }
}

async function writeAllItems(items: GalleryItem[]): Promise<GalleryItem[]> {
  if (!canUseIndexedDb()) {
    throw new Error("This browser cannot store the gallery.");
  }

  const capped = sortNewestFirst(items).slice(0, GALLERY_MAX_ITEMS);
  const db = await openGalleryDb();

  try {
    const clearTx = db.transaction(STORE_NAME, "readwrite");
    clearTx.objectStore(STORE_NAME).clear();
    await transactionDone(clearTx);

    if (capped.length === 0) return [];

    const writeTx = db.transaction(STORE_NAME, "readwrite");
    const store = writeTx.objectStore(STORE_NAME);
    for (const item of capped) {
      store.put(item);
    }
    await transactionDone(writeTx);
    return capped;
  } finally {
    db.close();
  }
}

async function readAllItems(): Promise<GalleryItem[]> {
  if (!canUseIndexedDb()) return [];
  const db = await openGalleryDb();
  try {
    const tx = db.transaction(STORE_NAME, "readonly");
    const items = await requestToPromise(
      tx.objectStore(STORE_NAME).getAll() as IDBRequest<GalleryItem[]>,
    );
    await transactionDone(tx);
    return sortNewestFirst(
      (items ?? [])
        .map((item) => normalizeGalleryItem(item))
        .filter((item): item is GalleryItem => Boolean(item)),
    ).slice(0, GALLERY_MAX_ITEMS);
  } finally {
    db.close();
  }
}

async function migrateLegacyGalleryIfNeeded(): Promise<void> {
  const legacy = readLegacyLocalStorageGallery();
  if (legacy.length === 0) return;

  const existing = await readAllItems();
  if (existing.length === 0) {
    await writeAllItems(legacy);
  }
  clearLegacyLocalStorageGallery();
}

export async function loadGallery(): Promise<GalleryItem[]> {
  if (!canUseIndexedDb()) return [];
  try {
    await migrateLegacyGalleryIfNeeded();
    return await readAllItems();
  } catch {
    return [];
  }
}

export async function addToGallery(input: {
  prompt: string;
  colorCount: ColorCount;
  aspectRatio: AspectRatio;
  detailLevel: DetailLevel;
  borderMode: BorderMode;
  cornerStyle: CornerStyle;
  backgroundMode: BackgroundMode;
  imageDataUrl: string;
}): Promise<GalleryItem[]> {
  const nextItem: GalleryItem = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `mosaic-${Date.now()}`,
    prompt: input.prompt,
    colorCount: input.colorCount,
    aspectRatio: input.aspectRatio,
    detailLevel: input.detailLevel,
    borderMode: input.borderMode,
    cornerStyle: input.cornerStyle,
    backgroundMode: input.backgroundMode,
    imageDataUrl: input.imageDataUrl,
    createdAt: new Date().toISOString(),
  };

  const existing = (await loadGallery()).filter(
    (item) => item.id !== nextItem.id,
  );
  let next = [nextItem, ...existing].slice(0, GALLERY_MAX_ITEMS);

  // If storage is still tight, drop oldest designs until the write succeeds.
  while (next.length > 0) {
    try {
      return await writeAllItems(next);
    } catch (error) {
      if (next.length <= 1) throw error;
      next = next.slice(0, next.length - 1);
    }
  }

  return [];
}

export async function removeFromGallery(id: string): Promise<GalleryItem[]> {
  const next = (await loadGallery()).filter((item) => item.id !== id);
  return writeAllItems(next);
}

export async function clearGallery(): Promise<GalleryItem[]> {
  clearLegacyLocalStorageGallery();
  return writeAllItems([]);
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
