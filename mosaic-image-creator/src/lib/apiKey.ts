export const API_KEY_STORAGE_KEY = "mosaic-xai-api-key-v1";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

export function loadApiKey(): string {
  if (!canUseStorage()) return "";
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function saveApiKey(key: string): void {
  if (!canUseStorage()) return;
  const trimmed = key.trim();
  if (!trimmed) {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    return;
  }
  localStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
}

export function clearApiKey(): void {
  if (!canUseStorage()) return;
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
