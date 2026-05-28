// chat-oshc Worker — Vectorize KB (Phase 1+2 placeholder)
// Phase 3: 灌 5 家 PDS + 30 FAQ → RAG 接入 chatbot

import type { Env } from './types';

/**
 * Phase 1+2: no-op, returns empty context.
 * Phase 3: 调 DashScope embedding → Vectorize query → 返回 top-K chunk text
 */
export async function retrieveKB(
  _env: Env,
  _query: string,
): Promise<string> {
  // TODO Phase 3: implement RAG
  return '';
}

/**
 * Query Vectorize index with embedding vector
 */
export async function queryVectorize(
  env: Env,
  vector: number[],
  topK: number = 5,
): Promise<VectorizeMatch[]> {
  try {
    const results = await env.KB.query(vector, { topK, returnMetadata: true });
    return results.matches;
  } catch (e) {
    console.error('[kb] Vectorize query failed', e);
    return [];
  }
}

/**
 * Call DashScope text-embedding-v3 to get embedding vector
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
