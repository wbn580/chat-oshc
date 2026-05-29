// chat-oshc Worker — LLM 调用（DeepSeek Pro + DS-flash extract）
// Phase 4: full system prompt from src/prompts.ts, RAG context injection

import type { Env, MessageRow, OshcFields } from './types';
import { SYSTEM_PROMPT } from './prompts';

/**
 * Olivia full system prompt from src/prompts.ts
 */
export function getSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

/**
 * 调 DSPro 生成对话回复。
 * messages 应包含对话历史（role: user/assistant）。
 * kbContext 是 RAG 检索到的 KB 文本，会作为参考资料注入。
 */
export async function chat(
  env: Env,
  messages: { role: string; content: string }[],
  kbContext?: string,
): Promise<string> {
  // Build system message with optional RAG context
  let systemContent = getSystemPrompt();
  if (kbContext && kbContext.trim()) {
    systemContent += `\n\n## REFERENCE MATERIALS (Do not contradict these):\n${kbContext}\n\nRule: Use these references for factual answers. If they don't cover the question, say so. Never invent information.`;
  }

  const body = {
    model: env.DEFAULT_MODEL_CHAT,
    messages: [
      { role: 'system', content: systemContent },
      ...messages,
    ],
    temperature: 0.6,
    max_tokens: 800,
  };

  const resp = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.DSPRO_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek API ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as any;
  return data?.choices?.[0]?.message?.content ?? '';
}

/**
 * 用 DS-flash 从对话中抽取 OSHC 5 字段
 */
export async function extractOshcFields(
  env: Env,
  messages: { role: string; content: string }[],
): Promise<OshcFields> {
  const convo = messages.map(m => `${m.role}: ${m.content}`).join('\n');

  const prompt = `Extract OSHC insurance quote fields from this conversation. Return ONLY valid JSON, no explanation.

Fields:
- visa_class: "500" | "485" | "482" | null
- policy_start: "YYYY-MM-DD" | null
- policy_finish: "YYYY-MM-DD" | null
- adults: number | null
- children: number (default 0) | null
- state: "NSW"|"VIC"|"QLD"|"WA"|"SA"|"TAS"|"ACT"|"NT" | null
- school: string | null

Conversation:
${convo}

Return only: {"visa_class": ..., "policy_start": ..., ...}`;

  const resp = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.DSPRO_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DEFAULT_MODEL_EXTRACT,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 200,
    }),
  });

  if (!resp.ok) {
    throw new Error(`DS-flash extract failed: ${resp.status}`);
  }

  const data = (await resp.json()) as any;
  const text = data?.choices?.[0]?.message?.content ?? '{}';

  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}
