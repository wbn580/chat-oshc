// chat-oshc Worker — Vectorize KB (Phase 3 RAG implementation)
// KB retrieval: embed query → query Vectorize → format results as context

import type { Env } from './types';

/**
 * Main RAG entry: get KB context for a user message.
 * Returns formatted context string of top-K chunks, or empty string.
 */
export async function retrieveKB(
  env: Env,
  query: string,
  topK: number = 5,
): Promise<string> {
  if (!query || query.trim().length < 3) return '';

  try {
    // 1. Embed the user query
    const vector = await getEmbedding(env, query);
    if (!vector || vector.length === 0) return '';

    // 2. Query Vectorize for top-K matches
    const matches = await queryVectorize(env, vector, topK);
    if (!matches || matches.length === 0) return '';

    // 3. Format results as RAG context
    return formatRagContext(matches);
  } catch (e) {
    console.error('[kb] retrieveKB failed', e);
    return '';
  }
}

/**
 * Query Vectorize index with embedding vector.
 */
export async function queryVectorize(
  env: Env,
  vector: number[],
  topK: number = 5,
): Promise<VectorizeMatch[]> {
  try {
    const results = await env.KB.query(vector, { topK, returnMetadata: true });
    return results.matches ?? [];
  } catch (e) {
    console.error('[kb] Vectorize query failed', e);
    return [];
  }
}

/**
 * Call DashScope text-embedding-v3 to get embedding vector.
 */
export async function getEmbedding(
  env: Env,
  text: string,
): Promise<number[]> {
  const resp = await fetch(`${env.DASHSCOPE_BASE_URL}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.DASHSCOPE_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!resp.ok) {
    throw new Error(`DashScope embedding failed: ${resp.status}`);
  }

  const data = (await resp.json()) as any;
  return data?.data?.[0]?.embedding ?? [];
}

/**
 * Format Vectorize matches into RAG context string for injection into system prompt.
 * Each match: {id, score, metadata: {provider, doc_type, source, year, lang}}
 */
function formatRagContext(matches: VectorizeMatch[]): string {
  const parts: string[] = [];

  for (const m of matches) {
    const meta = (m.metadata ?? {}) as Record<string, string>;
    const provider = meta.provider ?? 'unknown';
    const docType = meta.doc_type ?? 'unknown';
    const source = meta.source ?? 'unknown';

    // Build a compact reference line per chunk
    parts.push(`[Source: ${provider} ${docType}, ref: ${source}] ${m.text ?? ''}`);
  }

  return parts.join('\n\n');
}

type VectorizeMatch = {
  id: string;
  score: number;
  text?: string;
  metadata?: Record<string, string>;
};
