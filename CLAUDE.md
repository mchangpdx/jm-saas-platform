# JM Voice SaaS Platform — CLAUDE.md

## Project Overview
Multi-tenant Voice AI SaaS platform for restaurant/retail POS integrations.
Agents (tenants) each own independent store contexts, payment adapters, and queue workers.
(다중 테넌트 Voice AI SaaS 플랫폼. 에이전트별로 독립된 스토어 컨텍스트, 결제 어댑터, 큐 워커를 보유)

---

## Coding Conventions

### Comment Style — Mandatory
All comments must follow the bilingual format:
```js
// Extract tenant ID from incoming request body (요청 바디에서 테넌트 ID 추출)
// Validate against Supabase store registry (Supabase 스토어 레지스트리에서 유효성 검증)
```
- First clause: English description (functional intent)
- Second clause (괄호 안): 한글 요약 (Korean summary of the line)
- No exceptions — applies to inline, block, and JSDoc comments

### Architecture Pattern — Adapter Pattern
All third-party integrations (POS, Payment, SMS, etc.) are wrapped in adapters:
```
src/adapters/
  pos/          ← POS system adapters (e.g., Toast, Square, Clover)
  payment/      ← Payment gateway adapters (e.g., Stripe, KCP, Toss)
```
Each adapter implements a shared interface contract. Controllers never call SDKs directly.
(모든 서드파티 연동은 어댑터로 래핑. 컨트롤러는 SDK를 직접 호출하지 않음)

### Queue Pattern — Redis + BullMQ
All async workloads (order processing, voice transcription, webhook dispatch) go through BullMQ:
```
src/queue/
  producers/    ← Enqueue jobs (잡 등록)
  workers/      ← Process jobs (잡 처리)
```
Never perform blocking I/O in request handlers — delegate to queue workers.
(요청 핸들러에서 블로킹 I/O 금지 — 큐 워커에 위임)

---

## Directory Structure
```
jm-saas-platform/
├── src/
│   ├── config/           ← env, redis, supabase clients (환경 설정)
│   ├── middlewares/      ← express middlewares (미들웨어)
│   ├── routes/v1/        ← versioned API routes (버전 관리 API 라우트)
│   ├── controllers/      ← thin request handlers (요청 핸들러)
│   ├── queue/            ← BullMQ producers + workers (큐)
│   ├── services/         ← business logic (비즈니스 로직)
│   └── adapters/
│       ├── pos/          ← POS system adapters (POS 어댑터)
│       └── payment/      ← payment gateway adapters (결제 어댑터)
├── CLAUDE.md
├── package.json
└── .env.example
```

---

## Environment Variables
See `.env.example` for required variables. Never commit `.env`.
(`.env.example` 참조. `.env` 파일은 절대 커밋 금지)

## Node / Runtime
- Runtime: Node.js 20+
- Package manager: npm
- Entry point: `src/app.js`
- Port: `process.env.PORT` (default 3000)
