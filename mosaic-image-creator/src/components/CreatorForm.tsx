"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { evaluateMosaicDesign } from "@/lib/mosaic-brain";
import { fileToResizedDataUrl } from "@/lib/gallery";
import { buildMosaicPrompt } from "@/lib/prompt";
import {
  BORDER_MODE_OPTIONS,
  COLOR_COUNT_OPTIONS,
  CORNER_STYLE_OPTIONS,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_BACKGROUND_MODE,
  DEFAULT_BORDER_MODE,
  DEFAULT_COLOR_COUNT,
  DEFAULT_CORNER_STYLE,
  DEFAULT_DETAIL_LEVEL,
  DEFAULT_ORIENTATION,
  ORIENTATION_OPTIONS,
  PROPORTION_OPTIONS,
  defaultAspectForOrientation,
  orientationForAspect,
  type AspectRatio,
  type BackgroundMode,
  type BorderMode,
  type ColorCount,
  type CornerStyle,
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
  const [cornerStyle, setCornerStyle] = useState<CornerStyle>(
    DEFAULT_CORNER_STYLE,
  );
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>(
    DEFAULT_BACKGROUND_MODE,
  );
  const [photoName, setPhotoName] = useState<string | null>(null);
  const [photoDataUrl, setPhotoDataUrl] = useState<string | undefined>();
  const [localError, setLocalError] = useState<string | null>(null);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const resolvedCornerStyle =
    borderMode === "corners" ? cornerStyle : DEFAULT_CORNER_STYLE;

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
      cornerStyle: resolvedCornerStyle,
      backgroundMode,
      imageDataUrl: photoDataUrl,
    });
  }

  const brain = evaluateMosaicDesign({
    subject: prompt.trim() || "subject",
    colorCount,
    aspectRatio,
    detailLevel,
    borderMode,
    cornerStyle: resolvedCornerStyle,
    backgroundMode,
    hasReferenceImage: Boolean(photoDataUrl),
  });

  const previewPrompt = buildMosaicPrompt({
    userPrompt: prompt.trim() || "subject",
    colorCount,
    aspectRatio,
    detailLevel,
    borderMode,
    cornerStyle: resolvedCornerStyle,
    backgroundMode,
    hasReferenceImage: Boolean(photoDataUrl),
  });

  async function handleCopyPrompt() {
    try {
      await navigator.clipboard.writeText(previewPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setLocalError("Could not copy the prompt.");
    }
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
          label="Background"
          hint="None keeps the subject alone. Themed adds a few large related shapes."
          value={backgroundMode}
          options={[
            { value: "none", label: "No background" },
            { value: "themed", label: "Background" },
          ]}
          disabled={busy}
          onChange={setBackgroundMode}
        />
      </div>

      <div className="field-row">
        <OptionGroup
          label="Border"
          hint="Tiled band, corner accents, or none."
          value={borderMode}
          options={BORDER_MODE_OPTIONS}
          disabled={busy}
          onChange={setBorderMode}
        />
        {borderMode === "corners" ? (
          <OptionGroup
            label="Corner style"
            hint="Thick ≈ 5% of canvas width. Top and bottom match."
            value={cornerStyle}
            options={CORNER_STYLE_OPTIONS}
            disabled={busy}
            onChange={setCornerStyle}
          />
        ) : (
          <div className="field" aria-hidden="true" />
        )}
      </div>

      <div className={`brain-note is-${brain.preference}`} role="status">
        <p className="brain-note-title">
          Mosaic brain · {brain.preference === "ideal"
            ? "great for yarn"
            : brain.preference === "ok"
              ? "workable"
              : "busy for stitches"}
        </p>
        <p className="brain-note-body">
          {brain.notes[0] ??
            "Designs stay large, flat, and high-contrast so they chart into a blanket."}
        </p>
      </div>

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

      <div className="form-actions">
        <button className="primary-btn" type="submit" disabled={busy}>
          {busy ? "Creating design…" : "Create design"}
        </button>
        <button
          className="ghost-on-light"
          type="button"
          disabled={busy}
          aria-expanded={showPromptPreview}
          onClick={() => setShowPromptPreview((open) => !open)}
        >
          {showPromptPreview ? "Hide prompt" : "Preview prompt"}
        </button>
      </div>

      {showPromptPreview ? (
        <div className="prompt-preview">
          <div className="prompt-preview-head">
            <div>
              <p className="prompt-preview-title">Assembled Imagine prompt</p>
              <p className="field-hint">
                No API call — this is exactly what Create design sends to xAI.
              </p>
            </div>
            <button
              type="button"
              className="text-btn"
              onClick={() => void handleCopyPrompt()}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="prompt-preview-body">{previewPrompt}</pre>
        </div>
      ) : null}
    </form>
  );
}
