-- chat-oshc-leads D1 schema
-- Phase 1+2 MVP: sessions + messages tables

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,              -- chat-oshc-{ts}-{rand} UUID
  created_at INTEGER NOT NULL,      -- unix ts
  updated_at INTEGER NOT NULL,
  visitor_id TEXT,                  -- cookie / fingerprint
  site TEXT,                        -- 来源站
  channel TEXT,                     -- widget / wechat / direct
  lang TEXT DEFAULT 'zh-CN',

  -- chatbot 5 字段
  visa_class TEXT,                  -- 500 / 485 / 482
  policy_start TEXT,                -- YYYY-MM-DD
  policy_finish TEXT,               -- YYYY-MM-DD
  adults INTEGER DEFAULT 1,
  children INTEGER DEFAULT 0,
  state TEXT,                       -- NSW / VIC / etc
  school TEXT,                      -- optional

  -- 报价结果
  quote_at INTEGER,
  quote_data TEXT,                  -- JSON: 5 providers + purchase_urls

  -- 推荐 + 用户行为
  recommended_provider TEXT,
  clicked_purchase_url TEXT,
  clicked_at INTEGER,

  -- session close state
  close_type TEXT,                  -- visitor / partial / quoted / clicked_purchase
  ip_country TEXT,
  ua TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_close ON sessions(close_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state, created_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- user / assistant / system
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
