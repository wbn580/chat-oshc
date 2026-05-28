# chat-oshc — OSHC Insurance Chatbot (Cloudflare Worker)

OSHC 海外学生医保比价 chatbot，部署在 chat.oshc.com.cn。学生对话式收 5 字段 → 调 Cohort Go Quote API 拿 5 家报价 → 推荐 + 立即购买跳转。

**Bot 名**: Olivia  
**Partner code**: au-unilink (UNILINK Education Pty Ltd)  
**对标**: chat.unilink.co (Lina) / chat.arrivau.com (Hayden)

## 架构

```
Cloudflare Worker (chat-oshc)
├── D1 (chat-oshc-leads) — sessions + messages
├── Vectorize (kb-oshc) — 1024维 cosine, DashScope text-embedding-v3
├── DeepSeek Pro — 对话生成
├── DeepSeek Flash — 5 字段抽取
└── Cohort Go Quote API — 实时报价 + purchase_url
```

## 端点

| Method | Path | 说明 |
|--------|------|------|
| GET | /health | 健康检查 |
| POST | /session | 创建 session |
| POST | /chat | 对话主入口 |
| POST | /quote | 调 Cohort Go 拿报价 |

## 部署

```bash
npm install
npx wrangler deploy
```

### Secrets（必须配）

```bash
wrangler secret put COHORTGO_API_USERNAME
wrangler secret put COHORTGO_API_PASSWORD
wrangler secret put DSPRO_API_KEY
wrangler secret put DASHSCOPE_API_KEY
wrangler secret put RESEND_API_KEY
```

### D1 + Vectorize

```bash
wrangler d1 create chat-oshc-leads
wrangler d1 execute chat-oshc-leads --file=schema.sql --remote
wrangler vectorize create kb-oshc --dimensions=1024 --metric=cosine
```

## 测试

```bash
# Health
curl https://chat-oshc.wubaining.workers.dev/health

# Create session
curl -X POST https://chat-oshc.wubaining.workers.dev/session \
  -H 'Content-Type: application/json' -d '{}'

# Quote (5 字段 → 5 家报价)
curl -X POST https://chat-oshc.wubaining.workers.dev/quote \
  -H 'Content-Type: application/json' \
  -d '{"adults":1,"children":0,"start":"2026-06-01","finish":"2028-05-31"}'
```

## Phase 进度

- [x] Phase 1: Worker scaffold + D1 + Vectorize + secrets + /health /session /chat
- [x] Phase 2: Cohort Go Quote API + purchase_url + fw_counselor_key
- [ ] Phase 3: KB 灌料 + RAG
- [ ] Phase 4: Full system prompt + widget JS
- [ ] Phase 5: DNS custom domain + 嵌入 6 站 + weekly digest

## 文件

```
chat-oshc/
├── wrangler.toml      # CF Worker 配置
├── package.json
├── tsconfig.json
├── schema.sql          # D1 schema (sessions + messages)
├── src/
│   ├── index.ts        # Worker 入口 + 路由
│   ├── db.ts           # D1 数据库操作
│   ├── llm.ts          # DeepSeek LLM 调用
│   ├── kb.ts           # Vectorize KB (Phase 3)
│   ├── cohortgo.ts     # Cohort Go Quote API
│   └── types.ts        # 类型定义
└── README.md
```
