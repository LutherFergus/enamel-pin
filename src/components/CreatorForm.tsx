"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { fileToResizedDataUrl } from "@/lib/gallery";
import {
  COLOR_COUNT_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_BORDER_COMPLEXITY,
  DEFAULT_BORDER_MODE,
  DEFAULT_COLOR_COUNT,
  DEFAULT_DETAIL_LEVEL,
  DEFAULT_ORIENTATION,
  ORIENTATION_OPTIONS,
  PROPORTION_OPTIONS,
  defaultAspectForOrientation,
  orientationForAspect,
  type AspectRatio,
  type BorderComplexity,
  type BorderMode,
  type ColorCount,
  type DetailLevel,
  type GenerateOptions,
  type Orientation,
} from "@/lib/types";

type CreatorFormProps = {
  busy: boolean;
  onGenerate: (input: GenerateOptions) => Promise<void>;
};

function OptionGroup<T extends string>({
  label,
  hint,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  const groupId = useId();
  return (
    <div className="field">
      <label id={groupId}>{label}</label>
      {hint ? <p className="field-hint">{hint}</p> : null}
      <div className="option-pills" role="group" aria-labelledby={groupId}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={
              option.value === value ? "option-pill is-active" : "option-pill"
            }
            onClick={() => onChange(option.value)}
            disabled={disabled}
            aria-pressed={option.value === value}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function CreatorForm({ busy, onGenerate }: CreatorFormProps) {
  const promptId = useId();
  const colorId = useId();
  const photoId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  const [prompt, setPrompt] = useState("");
  const [colorCount, setColorCount] = useState<ColorCount>(DEFAULT_COLOR_COUNT);
  const [orientation, setOrientation] =
    useState<Orientation>(DEFAULT_ORIENTATION);
  const [aspectRatio, setAspectRatio] =
    useState<AspectRatio>(DEFAULT_ASPECT_RATIO);
  const [detailLevel, setDetailLevel] =
    useState<DetailLevel>(DEFAULT_DETAIL_LEVEL);
  const [borderMode, setBorderMode] = useState<BorderMode>(DEFAULT_BORDER_MODE);
  const [borderComplexity, setBorderComplexity] = useState<BorderComplexity>(
    DEFAULT_BORDER_COMPLEXITY,
  );
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>();
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    const allowed = PROPORTION_OPTIONS[orientation].map((item) => item.value);
    if (!allowed.includes(aspectRatio)) {
      setAspectRatio(defaultAspectForOrientation(orientation));
    }
  }, [orientation, aspectRatio]);

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
      setLocalError("Enter a short subject — a few words is enough.");
      return;
    }

    await onGenerate({
      prompt: trimmed,
      colorCount,
      aspectRatio,
      detailLevel,
      borderMode,
      borderComplexity:
        borderMode === "border" ? borderComplexity : DEFAULT_BORDER_COMPLEXITY,
      imageDataUrl: photoDataUrl,
    });
  }

  return (
    <form className="creator-form" onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={promptId}>Prompt</label>
        <p className="field-hint">
          A few words is enough — style settings do the rest.
        </p>
        <textarea
          id={promptId}
          name="prompt"
          rows={3}
          maxLength={1200}
          placeholder="sleepy fox"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          disabled={busy}
          required
        />
      </div>

      <div className="field-row">
        <OptionGroup
          label="Orientation"
          hint="Square, landscape, or portrait."
          value={orientation}
          options={ORIENTATION_OPTIONS}
          disabled={busy}
          onChange={(next) => {
            setOrientation(next);
            setAspectRatio(defaultAspectForOrientation(next));
          }}
        />
        <OptionGroup
          label="Proportion"
          hint={`Aspect ratio for ${orientation}.`}
          value={aspectRatio}
          options={PROPORTION_OPTIONS[orientation]}
          disabled={busy}
          onChange={(next) => {
            setAspectRatio(next);
            setOrientation(orientationForAspect(next));
          }}
        />
      </div>

      <div className="field-row">
        <OptionGroup
          label="Detail"
          value={detailLevel}
          options={[
            { value: "simple", label: "Simple" },
            { value: "detailed", label: "Detailed" },
          ]}
          disabled={busy}
          onChange={setDetailLevel}
        />
        <OptionGroup
          label="Border"
          value={borderMode}
          options={[
            { value: "none", label: "No border" },
            { value: "border", label: "Border" },
          ]}
          disabled={busy}
          onChange={setBorderMode}
        />
      </div>

      {borderMode === "border" ? (
        <OptionGroup
          label="Border artwork"
          hint="How much ornament fills the border."
          value={borderComplexity}
          options={[
            { value: "simple", label: "Simple" },
            { value: "complex", label: "Complex" },
          ]}
          disabled={busy}
          onChange={setBorderComplexity}
        />
      ) : null}

      <div className="field-row">
        <div className="field">
          <label htmlFor={colorId}>Colors</label>
          <p className="field-hint">AI chooses the palette. Default is 2.</p>
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
          <p className="field-hint">Turns a photo into a crisp vector motif.</p>
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
