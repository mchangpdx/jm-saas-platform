// v1 API route registry — mounts all sub-routers under /api/v1 (v1 API 라우트 레지스트리 — 서브 라우터 등록)
import { Router } from 'express';
import { webhooksRouter } from './webhooks.js';
import { llmRouter }      from './llm.js';

export const v1Router = Router();

// Health check — no auth required (헬스 체크 — 인증 불필요)
v1Router.get('/health', (_req, res) => {
  res.json({ status: 'ok', version: 'v1', timestamp: new Date().toISOString() });
});

// Inbound webhooks — /api/v1/webhooks/* (인바운드 웹훅 — /api/v1/webhooks/*)
v1Router.use('/webhooks', webhooksRouter);

// LLM conversation — /api/v1/llm/* (LLM 대화 — /api/v1/llm/*)
v1Router.use('/llm', llmRouter);

// TODO: mount feature routers as they are implemented (기능 라우터 구현 후 여기에 등록)
// v1Router.use('/orders',   ordersRouter);
// v1Router.use('/payments', paymentsRouter);
