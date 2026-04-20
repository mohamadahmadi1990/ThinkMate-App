import { getOpenAIClient } from "@/lib/openai";

export type SimilarEntry = {
  text: string;
  kind: string;
  similarity: number;
};

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const MIN_SIMILARITY_SCORE = 0.5;

export async function createEmbedding(text: string) {
  const response = await getOpenAIClient().embeddings.create({
    model: process.env.OPENAI_EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    input: text,
    encoding_format: "float"
  });

  const embedding = response.data[0]?.embedding;

  if (!embedding) {
    throw new Error("The embedding model did not return a vector.");
  }

  return embedding;
}

export function cosineSimilarity(a: number[], b: number[]) {
  if (a.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let aMagnitude = 0;
  let bMagnitude = 0;

  for (let index = 0; index < a.length; index += 1) {
    const aValue = a[index];
    const bValue = b[index];

    dotProduct += aValue * bValue;
    aMagnitude += aValue * aValue;
    bMagnitude += bValue * bValue;
  }

  const denominator = Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude);

  return denominator === 0 ? 0 : dotProduct / denominator;
}

export function topSimilarEntries(
  embedding: number[],
  entries: Array<{ text: string; kind: string; embedding: number[] }>
) {
  return entries
    .filter((entry) => entry.embedding.length === embedding.length)
    .map((entry) => ({
      text: entry.text,
      kind: entry.kind,
      similarity: Number(cosineSimilarity(embedding, entry.embedding).toFixed(4))
    }))
    .filter((entry) => entry.similarity >= MIN_SIMILARITY_SCORE)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);
}
