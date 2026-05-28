// chat-oshc Worker — 主入口
// Phase 1+2 MVP 路由：
//   GET  /health     — 健康检查
//   POST /session    — 创建新 chatbot session + UUID
//   POST /chat       — chatbot 对话主入口
//   POST /quote      — Cohort Go Quote API 调取
//   OPTIONS *        — CORS 预检

import type { ChatRequest, ChatResponse, Env, HealthResponse, QuoteResult, SessionResponse } from './types';
import {
  allFieldsReady,
  appendMessage,
  createSession,
  genSessionId,
  getSession,
  getSessionFields,
  loadMessages,
  saveQuote,
  updateSessionFields,
} from './db';
import { chat, extractOshcFields } from './llm';
import { retrieveKB } from './kb';
import { appendCounselorKey, getQuote, pickRecommendation } from './cohortgo';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS },
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      // ─── GET /health ───
      if (url.pathname === '/health' && req.method === 'GET') {
        return json<HealthResponse>({
          ok: true,
          service: 'chat-oshc',
          ts: new Date().toISOString(),
        });
      }

      // ─── POST /session ───
      if (url.pathname === '/session' && req.method === 'POST') {
        return handleSession(req, env);
      }

      // ─── POST /chat ───
      if (url.pathname === '/chat' && req.method === 'POST') {
        return handleChat(req, env, ctx);
      }

      // ─── POST /quote ───
      if (url.pathname === '/quote' && req.method === 'POST') {
        return handleQuote(req, env);
      }

      return new Response('not found', { status: 404, headers: CORS });
    } catch (e: any) {
      console.error('[worker] uncaught', e);
      return json({ error: 'internal', message: String(e?.message ?? e) }, 500);
    }
  },
};

// ─── POST /session — 创建新 session ───
async function handleSession(req: Request, env: Env): Promise<Response> {
  let body: { lang?: string; site?: string; channel?: string } = {};
  try { body = await req.json(); } catch { /* ok */ }

  const cf = (req as any).cf ?? {};
  const sessionId = genSessionId();
  await createSession(env.DB, sessionId, cf.country ?? 'unknown', req.headers.get('User-Agent') ?? '', body.lang ?? 'zh-CN');

  return json<SessionResponse>({
    session_id: sessionId,
    created_at: Math.floor(Date.now() / 1000),
  });
}

// ─── POST /chat — 对话端点 ───
async function handleChat(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: ChatRequest;
  try { body = await req.json(); } catch {
    return json({ error: 'invalid json' }, 400);
  }

  let sessionId = body.session_id;
  let isNewSession = false;

  if (!sessionId) {
    sessionId = genSessionId();
    isNewSession = true;
    const cf = (req as any).cf ?? {};
    await createSession(env.DB, sessionId, cf.country ?? 'unknown', req.headers.get('User-Agent') ?? '', body.lang ?? 'zh-CN');
  } else {
    const existing = await getSession(env.DB, sessionId);
    if (!existing) {
      return json({ error: 'session not found' }, 404);
    }
  }

  // 空消息 — 返回开场白
  if (!body.message?.trim()) {
    const greeting = isNewSession
      ? `👋 嗨！我是 Olivia，可以帮你 30 秒对比 5 家政府认可的 OSHC 报价。\n\n请问你是哪种签证？\n1. 500 学生签证（标准 OSHC）\n2. 485 毕业生工作签证（需 485 insurance，不是 OSHC）\n3. 482 工作签证（需 OVHC）\n4. 其他`
      : '请问还有什么可以帮你的吗？';

    return json<ChatResponse>({
      session_id: sessionId,
      reply: greeting,
      done: true,
    });
  }

  // KB 检索（Phase 1+2: placeholder，Phase 3: 接 RAG）
  let kbContext = '';
  try { kbContext = await retrieveKB(env, body.message); } catch { /* ok */ }

  // 写入用户消息
  await appendMessage(env.DB, sessionId, 'user', body.message.slice(0, 2000));

  // 加载对话历史
  const history = await loadMessages(env.DB, sessionId, 30);

  // 调 DSPro 生成回复
  let replyText: string;
  try {
    // 如果有 KB context，作为用户消息的补充注入
    const chatMessages = [...history];
    if (kbContext) {
      chatMessages.push({ role: 'system', content: `Relevant policy info: ${kbContext}` });
    }
    replyText = await chat(env, chatMessages);
  } catch (e: any) {
    console.error('[chat] LLM call failed', e);
    replyText = '哎呀这边网络有点问题，能稍后再试一次吗？或者直接告诉我你的签证类型和入学时间，我帮你先查报价～';
  }

  // 写入 assistant 消息
  await appendMessage(env.DB, sessionId, 'assistant', replyText);

  // 异步抽取 OSHC 字段（不阻塞对话响应）
  ctx.waitUntil(extractAndSave(env, sessionId));

  // 检查之前是否已有完整 5 字段（从历史抽取缓存）→ 触发 auto-quote
  const session = await getSession(env.DB, sessionId);
  let quote: QuoteResult | undefined;
  if (session && allFieldsReady(session)) {
    try {
      const qr = await fetchQuoteForSession(env, sessionId, session);
      quote = qr;
    } catch (e: any) {
      console.error('[chat] auto-quote failed', e);
    }
  }

  return json<ChatResponse>({
    session_id: sessionId,
    reply: replyText,
    done: true,
    quote,
  });
}

// ─── POST /quote — 手动调 quote API ───
async function handleQuote(req: Request, env: Env): Promise<Response> {
  let body: {
    session_id?: string;
    adults?: number;
    children?: number;
    start?: string;
    finish?: string;
  };
  try { body = await req.json(); } catch {
    return json({ error: 'invalid json' }, 400);
  }

  let sessionId = body.session_id;

  if (!sessionId) {
    sessionId = genSessionId();
    const cf = (req as any).cf ?? {};
    await createSession(env.DB, sessionId, cf.country ?? 'unknown', req.headers.get('User-Agent') ?? '', 'zh-CN');
  }

  const session = await getSession(env.DB, sessionId);
  if (!session) {
    return json({ error: 'session not found' }, 404);
  }

  // 用 body 参数或 session 里的字段
  const params = {
    adults: body.adults ?? session.adults ?? 1,
    children: body.children ?? session.children ?? 0,
    start: body.start ?? session.policy_start ?? '',
    finish: body.finish ?? session.policy_finish ?? '',
  };

  if (!params.start || !params.finish) {
    return json({ error: 'start and finish dates required' }, 400);
  }

  const quoteResult = await fetchQuoteForSession(env, sessionId, session, params);
  return json(quoteResult);
}

// ─── Extractor: 从对话中抽 5 字段 + 写回 D1 ───
async function extractAndSave(env: Env, sessionId: string): Promise<void> {
  try {
    const messages = await loadMessages(env.DB, sessionId, 30);
    if (messages.length < 2) return;

    const fields = await extractOshcFields(env, messages);
    const validFields: Record<string, any> = {};
    if (fields.visa_class) validFields.visa_class = fields.visa_class;
    if (fields.policy_start) validFields.policy_start = fields.policy_start;
    if (fields.policy_finish) validFields.policy_finish = fields.policy_finish;
    if (fields.adults != null) validFields.adults = fields.adults;
    if (fields.children != null) validFields.children = fields.children;
    if (fields.state) validFields.state = fields.state;
    if (fields.school) validFields.school = fields.school;

    if (Object.keys(validFields).length > 0) {
      await updateSessionFields(env.DB, sessionId, validFields);
    }
  } catch (e) {
    console.error('[chat] extract failed', e);
  }
}

// ─── 调 Cohort Go Quote API + 写 D1 + 返回结果 ───
async function fetchQuoteForSession(
  env: Env,
  sessionId: string,
  session: any,
  paramsOverride?: { adults: number; children: number; start: string; finish: string },
): Promise<QuoteResult> {
  const params = paramsOverride ?? {
    adults: session.adults ?? 1,
    children: session.children ?? 0,
    start: session.policy_start ?? '',
    finish: session.policy_finish ?? '',
  };

  const rawQuotes = await getQuote(env, params);

  // 附加 fw_counselor_key
  const quotes = rawQuotes.map(q => ({
    ...q,
    purchase_url: appendCounselorKey(q.purchase_url, sessionId),
  }));

  const recommended = pickRecommendation(quotes);

  // 写 D1
  await saveQuote(env.DB, sessionId, { params, quotes }, recommended);

  return { params, quotes, recommended };
}
