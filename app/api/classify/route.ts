import { zodTextFormat } from "openai/helpers/zod";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  cosineSimilarity,
  createEmbedding,
  topSemanticMatches
} from "@/lib/embeddings";
import { getOpenAIClient } from "@/lib/openai";
import { getPrismaClient } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_INPUT_LENGTH = 50;
const ACTIVE_WINDOW_MS = 5 * 60 * 1000;
const SAME_MEANING_MATCH_THRESHOLD = 0.9;
const MAX_SEMANTIC_COMPARISON_ENTRIES = 50;
const EXACT_MATCH_PERSISTENCE_THRESHOLD = 3;
const SAME_MEANING_PERSISTENCE_THRESHOLD = 3;
const SHOULD_LOG_TIMINGS = process.env.NODE_ENV !== "production";

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
  "Return normalizedText as the input after trimming; the application handles matching normalization separately."
].join(" ");

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type ClassifyTimings = Partial<Record<string, number>>;

type ActiveExactMatch = {
  text: string;
  normalizedText: string;
  kind: string;
  createdAt: Date;
};

type ActiveComparableEntry = ActiveExactMatch & {
  embedding: number[];
};

function nowMs() {
  return performance.now();
}

function normalizeTextForMatching(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

async function measureStep<T>(
  timings: ClassifyTimings,
  name: string,
  work: () => Promise<T>
) {
  const startedAt = nowMs();

  try {
    return await work();
  } finally {
    timings[name] = Math.round(nowMs() - startedAt);
  }
}

function logTimings(timings: ClassifyTimings) {
  if (!SHOULD_LOG_TIMINGS) {
    return;
  }

  console.info("[classify:timings]", timings);
}

function getErrorStatus(error: unknown) {
  if (typeof error === "object" && error && "status" in error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? status : undefined;
  }

  return undefined;
}

function safeErrorResponse(error: unknown) {
  if (
    typeof error === "object" &&
    error &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  ) {
    return jsonError("This text has already been stored.", 409);
  }

  if (error instanceof z.ZodError) {
    return jsonError("The classifier returned an unexpected response.", 502);
  }

  if (
    error instanceof Error &&
    error.message === "The embedding model did not return a vector."
  ) {
    return jsonError("Could not compare same-meaning entries right now.", 502);
  }

  if (
    error instanceof Error &&
    (error.message === "OPENAI_API_KEY is not configured." ||
      error.message === "DATABASE_URL is not configured.")
  ) {
    return jsonError("Classification storage is not configured.", 500);
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

function getExpiresAt(now: Date) {
  return new Date(now.getTime() + ACTIVE_WINDOW_MS);
}

function getActiveWindowStart(now: Date) {
  return new Date(now.getTime() - ACTIVE_WINDOW_MS);
}

async function cleanupExpiredInputs(now: Date) {
  const db = getPrismaClient();

  await db.ephemeralInput.deleteMany({
    where: {
      expiresAt: {
        lte: now
      }
    }
  });
}

async function findActiveExactMatches(
  normalizedText: string,
  now: Date
): Promise<ActiveExactMatch[]> {
  const db = getPrismaClient();

  return db.ephemeralInput.findMany({
    where: {
      normalizedText,
      expiresAt: {
        gt: now
      }
    },
    select: {
      text: true,
      normalizedText: true,
      kind: true,
      createdAt: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

async function findActiveComparableEntries(
  now: Date
): Promise<ActiveComparableEntry[]> {
  const db = getPrismaClient();

  return db.ephemeralInput.findMany({
    where: {
      expiresAt: {
        gt: now
      },
      NOT: {
        embedding: {
          isEmpty: true
        }
      }
    },
    select: {
      text: true,
      normalizedText: true,
      kind: true,
      embedding: true,
      createdAt: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: MAX_SEMANTIC_COMPARISON_ENTRIES
  });
}

async function storeEphemeralInput({
  text,
  normalizedText,
  kind,
  embedding,
  expiresAt
}: {
  text: string;
  normalizedText: string;
  kind: string;
  embedding: number[];
  expiresAt: Date;
}) {
  const db = getPrismaClient();

  await db.ephemeralInput.create({
    data: { text, normalizedText, kind, embedding, expiresAt }
  });
}

async function createOrUpdateMatchEvent({
  representativeText,
  kind,
  matchType,
  matchCount,
  firstSeenAt,
  lastSeenAt,
  averageSimilarity
}: {
  representativeText: string;
  kind: string;
  matchType: "exact" | "approximate";
  matchCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  averageSimilarity?: number;
}) {
  const db = getPrismaClient();
  const activeWindowStart = getActiveWindowStart(lastSeenAt);
  const existingEvent = await db.matchEvent.findFirst({
    where: {
      representativeText,
      matchType,
      lastSeenAt: {
        gte: activeWindowStart
      }
    },
    orderBy: {
      lastSeenAt: "desc"
    }
  });

  if (existingEvent) {
    await db.matchEvent.update({
      where: { id: existingEvent.id },
      data: {
        kind,
        matchCount,
        firstSeenAt:
          existingEvent.firstSeenAt < firstSeenAt
            ? existingEvent.firstSeenAt
            : firstSeenAt,
        lastSeenAt,
        averageSimilarity
      }
    });

    return "updated";
  }

  await db.matchEvent.create({
    data: {
      representativeText,
      kind,
      matchType,
      matchCount,
      firstSeenAt,
      lastSeenAt,
      averageSimilarity
    }
  });

  return "created";
}

type TextValidation =
  | { ok: true; text: string; normalizedText: string }
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

  return {
    ok: true,
    text,
    normalizedText: normalizeTextForMatching(text)
  };
}

export async function POST(request: Request) {
  const requestStartedAt = nowMs();
  const timings: ClassifyTimings = {};

  try {
    const now = new Date();
    const expiresAt = getExpiresAt(now);
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

    await measureStep(timings, "cleanupExpiredInputsMs", () =>
      cleanupExpiredInputs(now)
    );

    const response = await measureStep(timings, "classificationMs", () =>
      getOpenAIClient().responses.parse({
        model: process.env.OPENAI_MODEL || "gpt-4.1-nano",
        input: [
          { role: "system", content: systemInstruction },
          { role: "user", content: validation.text }
        ],
        text: {
          format: zodTextFormat(classificationSchema, "sentence_type")
        }
      })
    );

    if (!response.output_parsed) {
      return jsonError("The model did not return a classification.", 502);
    }

    const data = classificationSchema.parse(response.output_parsed);
    const activeExactMatches = await measureStep(
      timings,
      "exactDuplicateLookupMs",
      () => findActiveExactMatches(validation.normalizedText, now)
    );
    const activeExactMatchCount = activeExactMatches.length + 1;
    const isDuplicate = activeExactMatches.length > 0;

    if (isDuplicate) {
      const eventAction =
        activeExactMatchCount >= EXACT_MATCH_PERSISTENCE_THRESHOLD
          ? await measureStep(timings, "eventPersistenceMs", () =>
              createOrUpdateMatchEvent({
                representativeText:
                  activeExactMatches[0]?.text ?? validation.text,
                kind: data.kind,
                matchType: "exact",
                matchCount: activeExactMatchCount,
                firstSeenAt: activeExactMatches[0]?.createdAt ?? now,
                lastSeenAt: now
              })
            )
          : "none";

      await measureStep(timings, "databaseInsertMs", () =>
        storeEphemeralInput({
          text: validation.text,
          normalizedText: validation.normalizedText,
          kind: data.kind,
          embedding: [],
          expiresAt
        })
      );

      timings.exactDuplicateFound = 1;
      timings.totalMs = Math.round(nowMs() - requestStartedAt);
      logTimings(timings);

      return NextResponse.json({
        ok: true,
        data: {
          ...data,
          normalizedText: validation.normalizedText,
          isDuplicate: true,
          hasSameMeaningMatch: false,
          hasApproximateMatch: false,
          similarEntries: [],
          activeExactMatchCount,
          activeSameMeaningMatchCount: 0,
          activeApproximateMatchCount: 0,
          persistedEventAction: eventAction
        }
      });
    }

    timings.exactDuplicateFound = 0;
    const embedding = await measureStep(timings, "embeddingGenerationMs", () =>
      createEmbedding(validation.text)
    );
    const { similarEntries, strongSameMeaningMatches } = await measureStep(
      timings,
      "sameMeaningLookupComparisonMs",
      async () => {
        const previousEntries = await findActiveComparableEntries(now);

        return {
          similarEntries: topSemanticMatches(embedding, previousEntries),
          strongSameMeaningMatches: previousEntries
            .map((entry) => ({
              text: entry.text,
              kind: entry.kind,
              createdAt: entry.createdAt,
              similarity: Number(
                Math.min(
                  1,
                  Math.max(0, cosineSimilarity(embedding, entry.embedding))
                ).toFixed(4)
              )
            }))
            .filter(
              (entry) => entry.similarity >= SAME_MEANING_MATCH_THRESHOLD
            )
            .sort(
              (a, b) =>
                a.createdAt.getTime() - b.createdAt.getTime() ||
                a.text.localeCompare(b.text)
            )
        };
      }
    );
    const hasSameMeaningMatch = similarEntries.some(
      (entry) => entry.similarity >= SAME_MEANING_MATCH_THRESHOLD
    );
    const activeSameMeaningMatchCount = strongSameMeaningMatches.length + 1;
    const eventAction =
      activeSameMeaningMatchCount >= SAME_MEANING_PERSISTENCE_THRESHOLD
        ? await measureStep(timings, "eventPersistenceMs", () =>
            createOrUpdateMatchEvent({
              representativeText:
                strongSameMeaningMatches[0]?.text ?? validation.text,
              kind: data.kind,
              matchType: "approximate",
              matchCount: activeSameMeaningMatchCount,
              firstSeenAt: strongSameMeaningMatches[0]?.createdAt ?? now,
              lastSeenAt: now,
              averageSimilarity:
                strongSameMeaningMatches.length > 0
                  ? strongSameMeaningMatches.reduce(
                      (sum, entry) => sum + entry.similarity,
                      0
                    ) / strongSameMeaningMatches.length
                  : undefined
            })
          )
        : "none";

    await measureStep(timings, "databaseInsertMs", () =>
      storeEphemeralInput({
        text: validation.text,
        normalizedText: validation.normalizedText,
        kind: data.kind,
        embedding,
        expiresAt
      })
    );

    timings.totalMs = Math.round(nowMs() - requestStartedAt);
    logTimings(timings);

    return NextResponse.json({
      ok: true,
      data: {
        ...data,
        normalizedText: validation.normalizedText,
        isDuplicate,
        hasSameMeaningMatch,
        hasApproximateMatch: hasSameMeaningMatch,
        similarEntries,
        activeExactMatchCount,
        activeSameMeaningMatchCount,
        activeApproximateMatchCount: activeSameMeaningMatchCount,
        persistedEventAction: eventAction
      }
    });
  } catch (error) {
    return safeErrorResponse(error);
  }
}
