// LLM routes — handles Gemini-powered conversation turns for voice ordering
// (LLM 라우트 — 음성 주문을 위한 Gemini 대화 턴 처리)

import { Router }        from 'express';
import { tenantMiddleware } from '../../middlewares/tenant.js';
import { handleLlmChat }   from '../../controllers/llmController.js';

export const llmRouter = Router();

// POST /api/v1/llm/chat
// Body: { agent_id, conversation_history: [{role: 'user'|'model', parts: [{text}]}] }
// (바디: agent_id + conversation_history — Gemini 형식 대화 히스토리)
llmRouter.post('/chat', tenantMiddleware, handleLlmChat);
