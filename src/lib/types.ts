export type ColorCount = 2 | 3 | 4 | 5;

export interface GenerateRequest {
  prompt: string;
  colorCount: ColorCount;
  imageDataUrl?: string;
}

export interface GenerateResponse {
  imageBase64: string;
  mimeType: string;
  promptUsed: string;
  colorCount: ColorCount;
}

export interface GalleryItem {
  id: string;
  prompt: string;
  colorCount: ColorCount;
  imageDataUrl: string;
  createdAt: string;
}

export const GALLERY_STORAGE_KEY = "mosaic-gallery-v1";
export const GALLERY_MAX_ITEMS = 50;
export const DEFAULT_COLOR_COUNT: ColorCount = 2;
export const COLOR_COUNT_OPTIONS: ColorCount[] = [2, 3, 4, 5];
