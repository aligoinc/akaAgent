# Service Adapters

**Adapter** là pre-built code wrap **REST API / service** (Slack, Gmail, Telegram, OpenAI, Notion, Postgres, S3...).

## ⚠️ Phân biệt với web automation

- **Web automation** (FB đăng group, Zalo nhắn tin, Shopee đặt hàng) → workflow + `core.*` primitives + element picker + composite block. **DỮ LIỆU trong DB**, không phải code.
- **Service integration** (Slack send, Gmail search, OpenAI complete) → adapter block. **CODE trong package**.

## Cấu trúc

```
packages/adapters/
├── adapter-sdk/                ← shared utilities: AuthFlow, RateLimiter, OAuth helpers
└── (future: slack/, gmail/, telegram/, openai/, google-sheets/, notion/, postgres/, s3/, ...)
```

Mỗi adapter là 1 npm workspace package độc lập (`@akabiz/adapter-{name}`):
- `auth.ts` — schema cho Connection (OAuth2/API key/cookie)
- `actions/` — action blocks (vd `slack.sendMessage`)
- `triggers/` — trigger blocks (vd `slack.onNewMessage`)
- `index.ts` — export `registerAll(registry)`

## Tham chiếu

- [n8n nodes](https://github.com/n8n-io/n8n) — pattern node-package
- [Activepieces pieces](https://github.com/activepieces/activepieces) — piece framework với auth + actions/triggers

## Status

Phase 0 — placeholder. Adapter cụ thể sẽ implement khi engine ready (Phase 6+).
