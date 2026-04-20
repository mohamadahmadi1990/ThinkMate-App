"use client";

import { FormEvent, useState } from "react";

type ClassificationKind =
  | "word"
  | "number"
  | "declarative"
  | "interrogative"
  | "imperative"
  | "exclamatory"
  | "other";

type Classification = {
  normalizedText: string;
  kind: ClassificationKind;
  isSentence: boolean;
  explanation: string;
};

type ApiResponse =
  | { ok: true; data: Classification }
  | { ok: false; error: string };

const maxLength = 50;

export default function Home() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<Classification | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isLoading) {
      return;
    }

    const trimmedText = text.trim();
    setError("");
    setResult(null);

    if (!trimmedText) {
      setError("Enter a word, number, or short sentence.");
      return;
    }

    if (trimmedText.length > maxLength) {
      setError("Use 50 characters or fewer.");
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ text: trimmedText })
      });
      const payload = (await response.json()) as ApiResponse;

      if (!payload.ok) {
        setError(payload.error);
        return;
      }

      setResult(payload.data);
    } catch {
      setError("Classification is unavailable right now. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleClear() {
    setText("");
    setResult(null);
    setError("");
  }

  return (
    <main className="shell">
      <section className="panel" aria-labelledby="page-title">
        <div className="intro">
          <h1 id="page-title">Sentence Type</h1>
          <p>Enter up to 50 characters.</p>
        </div>

        <form className="form" onSubmit={handleSubmit}>
          <label htmlFor="text">Text</label>
          <input
            id="text"
            name="text"
            type="text"
            value={text}
            maxLength={maxLength}
            onChange={(event) => setText(event.target.value)}
            placeholder="hello"
            autoComplete="off"
          />

          <div className="meta">
            <span>{text.length} / {maxLength}</span>
          </div>

          <div className="actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Classifying..." : "Classify"}
            </button>
            <button type="button" className="secondary" onClick={handleClear}>
              Clear
            </button>
          </div>
        </form>

        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}

        {result ? (
          <article className="result" aria-live="polite">
            <p className="eyebrow">Result</p>
            <h2>{result.kind}</h2>
            <dl>
              <div>
                <dt>Normalized text</dt>
                <dd>{result.normalizedText}</dd>
              </div>
              <div>
                <dt>Sentence</dt>
                <dd>{result.isSentence ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Why</dt>
                <dd>{result.explanation}</dd>
              </div>
            </dl>
          </article>
        ) : null}
      </section>
    </main>
  );
}
