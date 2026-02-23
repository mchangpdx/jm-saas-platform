// LLM controller — routes conversation turns through Gemini and acts on tool call results
// (LLM 컨트롤러 — 대화 턴을 Gemini로 라우팅하고 도구 호출 결과에 따라 동작)
//
// POST /api/v1/llm/chat
//   Request:  { agent_id, conversation_history: [{role, parts}] }
//   Response: { type, text? } | { type, name, orderData?, jobId? }
// (요청: agent_id + conversation_history / 응답: 텍스트 또는 도구 호출 결과)

import { llmService, extractOrderIntent } from '../services/llm/gemini.js';
import { enqueueOrder }                   from '../queue/producer.js';
import { getPosAdapter }                  from '../adapters/pos/factory.js';

/**
 * POST /api/v1/llm/chat
 *
 * Processes one conversation turn:
 *   1. Pass full history to Gemini (gemini-1.5-flash)
 *   2. Branch on LlmResult type:
 *        TEXT        → return voice reply directly
 *        get_menu    → fetch from POS adapter, return menu to caller (for TTS)
 *        create_order → extract orderData, enqueue to Redis, return job confirmation
 *
 * (하나의 대화 턴 처리:
 *  1. 전체 히스토리를 Gemini에 전달
 *  2. LlmResult 타입으로 분기:
 *       TEXT        → 음성 응답 반환
 *       get_menu    → POS 어댑터에서 메뉴 조회 후 반환
 *       create_order → orderData 추출, Redis 큐 등록, 잡 확인 반환)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export async function handleLlmChat(req, res, next) {
  // storeContext is injected by tenantMiddleware (tenantMiddleware가 주입한 storeContext)
  const storeContext         = req.storeContext;
  const { conversation_history: conversationHistory } = req.body;

  // Validate that the client sent a non-empty conversation history (클라이언트가 비어 있지 않은 대화 히스토리를 전송했는지 검증)
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) {
    return res.status(400).json({
      error:   'conversation_history must be a non-empty array',
      message: 'conversation_history는 비어 있지 않은 배열이어야 합니다.',
    });
  }

  try {
    // ── Step 1: Send conversation to Gemini (대화를 Gemini에 전송) ──────────────
    const llmResult = await llmService.generateResponse(conversationHistory, storeContext);

    // ── Step 2: Branch on result type (결과 타입에 따라 분기) ────────────────────

    // ── TEXT: model's voice reply — return it for text-to-speech (모델 음성 응답 — TTS를 위해 반환)
    if (llmResult.type === 'TEXT') {
      return res.status(200).json({
        type: 'TEXT',
        text: llmResult.text,
      });
    }

    // ── TOOL_CALL: get_menu — fetch from POS and return for TTS (get_menu — POS에서 조회 후 TTS 반환)
    if (llmResult.type === 'TOOL_CALL' && llmResult.name === 'get_menu') {
      console.log(
        `[LlmController] get_menu call for agent ${storeContext.agentId} ` +
        `(get_menu 호출 — 에이전트: ${storeContext.agentId})`
      );

      // Resolve POS adapter from the tenant's storeContext (테넌트 storeContext에서 POS 어댑터 해석)
      const posAdapter = getPosAdapter(storeContext);
      const menuResult = await posAdapter.getMenu();

      // Return the menu so the caller can feed it back into the next conversation turn
      // (호출자가 다음 대화 턴에 메뉴 결과를 다시 주입할 수 있도록 메뉴 반환)
      return res.status(200).json({
        type:       'TOOL_CALL',
        name:       'get_menu',
        menuResult,
      });
    }

    // ── TOOL_CALL: create_order — extract intent and enqueue to Redis (create_order — 의도 추출 후 Redis 큐 등록)
    if (llmResult.type === 'TOOL_CALL' && llmResult.name === 'create_order') {
      // extractOrderIntent() normalizes Gemini's args into the canonical orderData shape
      // (extractOrderIntent()가 Gemini 인수를 표준 orderData 형태로 정규화)
      const orderData = extractOrderIntent(llmResult, storeContext);

      console.log(
        `[LlmController] create_order intent — orderId: ${orderData.orderId} | ` +
        `items: ${orderData.items.length} | total: ${orderData.totalAmountCents}¢ ` +
        `(create_order 의도 — 주문 ID: ${orderData.orderId} | ` +
        `항목 수: ${orderData.items.length} | 합계: ${orderData.totalAmountCents}센트)`
      );

      // Enqueue to BullMQ (→ Redis) — worker handles POS submission + payment
      // (BullMQ에 등록 → Redis. 워커가 POS 전송 + 결제 처리)
      const { jobId } = await enqueueOrder(orderData, storeContext);

      return res.status(202).json({
        type:      'TOOL_CALL',
        name:      'create_order',
        orderData,           // Echo normalized order back so the caller can confirm to the customer (고객 확인을 위해 정규화된 주문 반환)
        jobId,               // BullMQ job ID for status polling (상태 조회용 BullMQ 잡 ID)
        message:   `Order ${orderData.orderId} queued for processing (주문 ${orderData.orderId} 처리 대기열에 등록됨)`,
      });
    }

    // Unreachable in practice — guard against new tool names added without handling
    // (실제로는 도달 불가 — 처리 없이 추가된 새 도구명에 대한 안전 장치)
    return res.status(500).json({
      error:   `Unhandled tool call: ${llmResult.name}`,
      message: `처리되지 않은 도구 호출: ${llmResult.name}`,
    });

  } catch (err) {
    // Forward to Express error handler — preserves statusCode from LlmError/PosError
    // (Express 오류 핸들러로 전달 — LlmError/PosError의 statusCode 보존)
    next(err);
  }
}
