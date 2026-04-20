import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenAIClient } from "@/lib/openai";

export const runtime = "nodejs";

const MAX_INPUT_LENGTH = 50;

const requestSchema = z.object({
  text: z.string()
});

const classificationSchema = z.object({
  normalizedText: z.string(),
  kind: z.enum([
    "word",
    "number",
    "declarative",
    "interrogative",
    "imperative",
    "exclamatory",
    "other"
  ]),
  isSentence: z.boolean(),
  explanation: z.string()
});

const systemInstruction = [
  "Classify the user's short input.",
  "If the input is only a number, set kind to number.",
  "If it is a single word and not really a sentence, set kind to word.",
  "If it is a sentence, classify it as declarative, interrogative, imperative, or exclamatory.",
  "If unclear, use other.",
  "Keep explanation short.",
  "Preserve the original language in normalizedText after trimming."
].join(" ");

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function getErrorStatus(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }

  return undefined;
}

function safeErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) {
    return jsonError("The classifier returned an unexpected response.", 502);
  }

  if (
    error instanceof Error &&
    error.message === "OPENAI_API_KEY is not configured."
  ) {
    return jsonError("Classification is not configured.", 500);
  }

  const status = getErrorStatus(error);

  if (status === 401) {
    return jsonError("Classification is not configured correctly.", 500);
  }

  if (status === 429) {
    return jsonError("Classification is temporarily unavailable.", 503);
  }

  if (status && status >= 500) {
    return jsonError("Classification is temporarily unavailable.", 502);
  }

  return jsonError("Unable to classify text right now.", 500);
}

type TextValidation =
  | { ok: true; text: string }
  | { ok: false; error: string };

function validateText(body: unknown): TextValidation {
  const parsed = requestSchema.safeParse(body);

  if (!parsed.success) {
    return { ok: false, error: "Request body must include text as a string." };
  }

  const text = parsed.data.text.trim();

  if (!text) {
    return { ok: false, error: "Text is required." };
  }

  if (text.length > MAX_INPUT_LENGTH) {
    return { ok: false, error: "Text must be 50 characters or fewer." };
  }

  return { ok: true, text };
}

export async function POST(request: Request) {
  try {
    let body: unknown;

    try {
      body = await request.json();
    } catch {
      return jsonError("Request body must be valid JSON.", 400);
    }

    const validation = validateText(body);

    if (!validation.ok) {
      return jsonError(validation.error, 400);
    }

    const response = await getOpenAIClient().responses.parse({
      model: process.env.OPENAI_MODEL || "gpt-5.4-nano",
      input: [
        { role: "system", content: systemInstruction },
        { role: "user", content: validation.text }
      ],
      text: {
        format: zodTextFormat(classificationSchema, "sentence_type")
      }
    });

    if (!response.output_parsed) {
      return jsonError("The model did not return a classification.", 502);
    }

    const data = classificationSchema.parse(response.output_parsed);

    return NextResponse.json({
      ok: true,
      data: {
        ...data,
        normalizedText: validation.text
      }
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
