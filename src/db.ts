// chat-oshc Worker — D1 database operations (v2 Flywire Hybrid)

import type { MessageRow, OshcFields, SessionRow } from './types';

function genSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `chat-oshc-${ts}-${rand}`;
}

export { genSessionId };

export async function createSession(
  db: D1Database,
  sessionId: string,
  ipCountry: string,
  ua: string,
  lang: string = 'zh-CN',
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO sessions (id, created_at, updated_at, lang, ip_country, ua)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(sessionId, now, now, lang, ipCountry, ua).run();
}

export async function getSession(
  db: D1Database,
  sessionId: string,
): Promise<SessionRow | null> {
  return db.prepare('SELECT * FROM sessions WHERE id = ?')
    .bind(sessionId)
    .first<SessionRow>();
}

export async function updateSessionFields(
  db: D1Database,
  sessionId: string,
  fields: OshcFields,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE sessions
     SET visa_class = COALESCE(?, visa_class),
         policy_start = COALESCE(?, policy_start),
         policy_finish = COALESCE(?, policy_finish),
         adults = COALESCE(?, adults),
         children = COALESCE(?, children),
         state = COALESCE(?, state),
         school = COALESCE(?, school),
         updated_at = ?
     WHERE id = ?`,
  ).bind(
    fields.visa_class ?? null,
    fields.policy_start ?? null,
    fields.policy_finish ?? null,
    fields.adults ?? null,
    fields.children ?? null,
    fields.state ?? null,
    fields.school ?? null,
    now,
    sessionId,
  ).run();
}

export async function saveQuote(
  db: D1Database,
  sessionId: string,
  quoteData: object,
  recommended: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE sessions
     SET quote_at = ?, quote_data = ?, recommended_provider = ?, close_type = 'quoted', updated_at = ?
     WHERE id = ?`,
  ).bind(now, JSON.stringify(quoteData), recommended, now, sessionId).run();
}

export async function recordClick(
  db: D1Database,
  sessionId: string,
  purchaseUrl: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `UPDATE sessions
     SET clicked_purchase_url = ?, clicked_at = ?, close_type = 'clicked_purchase', updated_at = ?
     WHERE id = ?`,
  ).bind(purchaseUrl, now, now, sessionId).run();
}

export async function appendMessage(
  db: D1Database,
  sessionId: string,
  role: string,
  content: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(
    `INSERT INTO messages (session_id, role, content, created_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(sessionId, role, content, now).run();
}

export async function loadMessages(
  db: D1Database,
  sessionId: string,
  limit: number = 20,
): Promise<{ role: string; content: string }[]> {
  const rs = await db.prepare(
    `SELECT role, content FROM messages
     WHERE session_id = ? AND role IN ('user', 'assistant')
     ORDER BY created_at ASC
     LIMIT ?`,
  ).bind(sessionId, limit).all<MessageRow>();
  return (rs.results ?? []).map(r => ({ role: r.role, content: r.content }));
}

export function getSessionFields(session: SessionRow): OshcFields {
  const f: OshcFields = {};
  if (session.visa_class) f.visa_class = session.visa_class;
  if (session.policy_start) f.policy_start = session.policy_start;
  if (session.policy_finish) f.policy_finish = session.policy_finish;
  if (session.adults != null) f.adults = session.adults;
  if (session.children != null) f.children = session.children;
  if (session.state) f.state = session.state;
  if (session.school) f.school = session.school;
  return f;
}

export function allFieldsReady(session: SessionRow): boolean {
  return !!(
    session.visa_class &&
    session.policy_start &&
    session.policy_finish &&
    session.adults != null &&
    session.state
  );
}

export function anyFieldsSet(session: SessionRow): boolean {
  return !!(
    session.visa_class ||
    session.policy_start ||
    session.state
  );
}
