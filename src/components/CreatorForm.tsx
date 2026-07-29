"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  COLOR_COUNT_OPTIONS,
  DEFAULT_COLOR_COUNT,
  type ColorCount,
} from "@/lib/types";
import { fileToResizedDataUrl } from "@/lib/gallery";

type CreatorFormProps = {
  busy: boolean;
  onGenerate: (input: {
    prompt: string;
    colorCount: ColorCount;
    imageDataUrl?: string;
  }) => Promise<void>;
};

export function CreatorForm({ busy, onGenerate }: CreatorFormProps) {
  const promptId = useId();
  const colorId = useId();
  const photoId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [prompt, setPrompt] = useState("");
  const [colorCount, setColorCount] = useState<ColorCount>(DEFAULT_COLOR_COUNT);
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>();
  const [localError, setLocalError] = useState<string | null>(null);

  async function handlePhotoChange(file: File | undefined) {
    setLocalError(null);
    if (!file) {
      setPhotoName(null);
      setPhotoDataUrl(undefined);
      return;
    }

    if (!file.type.startsWith("image/")) {
      setLocalError("Please choose a PNG, JPEG, or WebP photo.");
      return;
    }

    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setPhotoName(file.name);
      setPhotoDataUrl(dataUrl);
    } catch {
      setLocalError("Could not read that photo.");
      setPhotoName(null);
      setPhotoDataUrl(undefined);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);
    const trimmed = prompt.trim();
    if (!trimmed) {
      setLocalError("Describe the design you want to make.");
      return;
    }

    await onGenerate({
      prompt: trimmed,
      colorCount,
      imageDataUrl: photoDataUrl,
    });
  }

  return (
    <form className="creator-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={promptId}>Prompt</label>
        <textarea
          id={promptId}
          name="prompt"
          rows={4}
          maxLength={1200}
          placeholder="A sleepy fox curled under a crescent moon"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={busy}
          required
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor={colorId}>Colors</label>
          <p className="field-hint">
            AI chooses the palette. Default is 2.
          </p>
          <div className="color-pills" role="group" aria-labelledby={colorId}>
            <span id={colorId} className="sr-only">
              Number of colors
            </span>
            {COLOR_COUNT_OPTIONS.map((count) => (
              <button
                key={count}
                type="button"
                className={
                  count === colorCount ? "color-pill is-active" : "color-pill"
                }
                onClick={() => setColorCount(count)}
                disabled={busy}
                aria-pressed={count === colorCount}
              >
                {count}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor={photoId}>Optional photo</label>
          <p className="field-hint">
            Turns a photo into a crisp vector motif.
          </p>
          <div className="photo-row">
            <input
              ref={fileRef}
              id={photoId}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(event) =>
                void handlePhotoChange(event.target.files?.[0])
              }
            />
            {photoName ? (
              <button
                type="button"
                className="text-btn"
                disabled={busy}
                onClick={() => {
                  if (fileRef.current) fileRef.current.value = "";
                  void handlePhotoChange(undefined);
                }}
              >
                Clear
              </button>
            ) : null}
          </div>
          {photoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="photo-preview"
              src={photoDataUrl}
              alt="Reference upload preview"
            />
          ) : null}
        </div>
      </div>

      {localError ? <p className="form-error">{localError}</p> : null}

      <button className="primary-btn" type="submit" disabled={busy}>
        {busy ? "Creating design…" : "Create design"}
      </button>
    </form>
  );
}
