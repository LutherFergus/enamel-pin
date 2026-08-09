"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { maskApiKey } from "@/lib/apiKey";

type ApiKeyGateProps = {
  open: boolean;
  initialKey?: string;
  onSave: (key: string) => void;
  onClose?: () => void;
  allowDismiss?: boolean;
};

export function ApiKeyGate({
  open,
  initialKey = "",
  onSave,
  onClose,
  allowDismiss = false,
}: ApiKeyGateProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialKey);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(initialKey);
      setError(null);
      const timer = window.setTimeout(() => inputRef.current?.focus(), 40);
      return () => window.clearTimeout(timer);
    }
  }, [open, initialKey]);

  if (!open) return null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Paste your xAI API key to continue.");
      return;
    }
    onSave(trimmed);
  }

  return (
    <div
      className="api-key-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-key-title"
    >
      <form className="api-key-panel" onSubmit={handleSubmit}>
        <p className="api-key-eyebrow">xAI · Grok Imagine</p>
        <h2 id="api-key-title">Enter your API key</h2>
        <p className="api-key-copy">
          Mosaic uses your personal key from{" "}
          <a
            href="https://console.x.ai"
            target="_blank"
            rel="noreferrer"
          >
            console.x.ai
          </a>
          . It stays in this browser and is only sent to generate mosaics.
        </p>

        <div className="field">
          <label htmlFor={inputId}>XAI_API_KEY</label>
          <input
            ref={inputRef}
            id={inputId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="xai-…"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          {initialKey ? (
            <p className="field-hint">Current key: {maskApiKey(initialKey)}</p>
          ) : null}
        </div>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="api-key-actions">
          <button className="primary-btn" type="submit">
            Save key & continue
          </button>
          {allowDismiss && onClose ? (
            <button
              className="secondary-btn ghost-on-light"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
