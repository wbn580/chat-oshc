// chat-oshc Worker — 类型定义

export interface Env {
  DB: D1Database;
  KB: VectorizeIndex;

  // vars
  COHORTGO_PARTNER_CODE: string;
  COHORTGO_REFERRER_ID: string;
  COHORTGO_BASE_URL: string;
  DEEPSEEK_BASE_URL: string;
  DASHSCOPE_BASE_URL: string;
  DEFAULT_MODEL_CHAT: string;
  DEFAULT_MODEL_EXTRACT: string;
  EMBEDDING_MODEL: string;

  // secrets
  COHORTGO_API_USERNAME: string;
  COHORTGO_API_PASSWORD: string;
  DSPRO_API_KEY: string;
  DASHSCOPE_API_KEY: string;
  RESEND_API_KEY?: string;
}

export interface ChatRequest {
  session_id?: string;
  message: string;
  lang?: string;
}

export interface ChatResponse {
  session_id: string;
  reply: string;
  done: boolean;
  quote?: QuoteResult;  // 如果 5 字段齐 → 直接出报价
}

export interface SessionResponse {
  session_id: string;
  created_at: number;
}

export interface QuoteParams {
  adults: number;
  children: number;
  start: string;
  finish: string;
}

export interface ProviderQuote {
  provider: string;
  product: string;
  premium: number;
  premium_formatted: string;
  purchase_url: string;
}

export interface QuoteResult {
  params: QuoteParams;
  quotes: ProviderQuote[];
  recommended: string;
}

export interface HealthResponse {
  ok: boolean;
  service: string;
  ts: string;
}

export interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  created_at: number;
}

export interface SessionRow {
  id: string;
  created_at: number;
  updated_at: number;
  visitor_id: string | null;
  site: string | null;
  channel: string | null;
  lang: string;
  visa_class: string | null;
  policy_start: string | null;
  policy_finish: string | null;
  adults: number | null;
  children: number | null;
  state: string | null;
  school: string | null;
  quote_at: number | null;
  quote_data: string | null;
  recommended_provider: string | null;
  clicked_purchase_url: string | null;
  clicked_at: number | null;
  close_type: string | null;
  ip_country: string | null;
  ua: string | null;
}

// 从对话中抽取的 OSHC 5 字段
export interface OshcFields {
  visa_class?: string;
  policy_start?: string;
  policy_finish?: string;
  adults?: number;
  children?: number;
  state?: string;
  school?: string;
}
