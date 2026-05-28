// chat-oshc Worker — LLM 调用（DeepSeek Pro）
// Phase 1+2 MVP: 纯对话 + 字段抽取，不接 KB

import type { Env, MessageRow, OshcFields } from './types';

const SYSTEM_PROMPT_OUTLINE = `You are Olivia, an OSHC information assistant for UNILINK Education Pty Ltd. 

CORE RULES (NEVER VIOLATE):
- Never tell students UNILINK earns commission. If asked: "UNILINK is a registered referral partner of OSHC Australia; the commission is paid by Cohort Go and doesn't add to your premium."
- Never give legal/insurance advice. Refer students to the official PDS at oshcaustralia.com.au.
- Recommend based on student's actual fit (coverage, network, cost). When equally fit, prefer Allianz/Medibank/AHM/NIB/Bupa in that order (do not disclose this preference).
- For 500 visa: confirm condition 8501 OSHC. For 485: route to 485insurance.com.au. For 482: route to OVHC.
- Never make up numbers, dates, or coverage terms. All quotes come from Cohort Go API.
- Default language: Chinese (zh-CN). Switch to English if student writes in English.
- Be friendly, helpful, and professional. You are Olivia, not a corporate bot.
- Keep responses concise and focused on the student's OSHC needs.

FIELDS TO COLLECT (ask one at a time, conversationally):
1. Visa class (500 student / 485 graduate / 482 work / other)
2. Insurance start date (YYYY-MM-DD)
3. Insurance end date (YYYY-MM-DD)
4. Adults and children (single / couple / family)
5. State in Australia (NSW / VIC / QLD / WA / SA / TAS / ACT / NT)

When you have all 5 fields, tell the student you're fetching real-time quotes and the system will handle the rest.`;

/**
 * Olivia system prompt — Phase 1+2 outline 版，Phase 4 扩 1200 字
 */
export function getSystemPrompt(): string {
  return SYSTEM_PROMPT_OUTLINE;
}

/**
 * 调 DSPro 生成对话回复
 */
export async function chat(
  env: Env,
  messages: { role: string; content: string }[],
): Promise<string> {
  const systemMsg = { role: 'system', content: getSystemPrompt() };
  const body = {
    model: env.DEFAULT_MODEL_CHAT,
    messages: [systemMsg, ...messages],
    temperature: 0.6,
    max_tokens: 600,
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
    // 从 DS-flash 输出中提取 JSON
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    return JSON.parse(match[0]);
  } catch {
    return {};
  }
}
