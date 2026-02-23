// Webhook controller — handles inbound Retell AI callbacks with immediate 200 response
// (웹훅 컨트롤러 — Retell AI 콜백 즉시 200 응답 처리)
//
// CRITICAL PATTERN: Retell's AI engine has a ~2s response timeout.
// If we await async work (DB writes, payment calls) before responding, the call will error.
// Solution: respond 200 immediately, then fire-and-forget the job queue.
// (핵심 패턴: Retell은 ~2초 응답 타임아웃. 비동기 작업 완료 전에 즉시 200 응답 후 잡 큐에 위임)

import { enqueueOrder } from '../queue/producer.js';

/**
 * POST /api/v1/webhooks/retell
 *
 * Step 1 — Respond 200 immediately so Retell does not mark the call as failed.
 * Step 2 — Fire-and-forget: parse payload, normalize, and enqueue for async processing.
 * (스텝 1 — 즉시 200 응답. 스텝 2 — 페이로드 파싱 및 정규화 후 비동기 큐 등록)
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 */
export function handleRetellWebhook(req, res) {
  // Capture storeContext injected by tenantMiddleware (tenantMiddleware가 주입한 storeContext 캡처)
  const storeContext = req.storeContext;
  const payload      = req.body;

  // ── Respond 200 immediately ── This MUST happen before any async work.
  // (즉시 200 응답 — 모든 비동기 작업보다 반드시 먼저 실행)
  res.status(200).json({
    received:  true,
    orderId:   payload.call_id ?? null,
    message:   'Order received and queued for processing (주문 수신 완료, 처리 대기열에 등록됨)',
  });

  // ── Fire-and-forget: enqueue after response is flushed ──────────────────────
  // res.json() sends the response synchronously to the socket buffer.
  // Code after it runs in the same event-loop tick — safe to do async work here.
  // (res.json()은 소켓 버퍼에 동기적으로 전송. 이후 코드는 동일 이벤트 루프 틱에서 실행 — 비동기 작업 안전)

  // Normalize Retell payload into canonical orderData shape (Retell 페이로드를 표준 주문 데이터 형태로 정규화)
  const orderData = normalizeRetellPayload(payload, storeContext);

  // Enqueue — intentionally not awaited. Errors are caught and logged below.
  // (의도적으로 await 없음 — 오류는 아래에서 캐치 및 로깅)
  enqueueOrder(orderData, storeContext)
    .then(({ jobId }) => {
      console.log(
        `[Webhook] ✓ Order ${orderData.orderId} enqueued as job ${jobId} | ` +
        `agent: ${storeContext.agentId} (주문 ${orderData.orderId} → 잡 ${jobId} 등록)`
      );
    })
    .catch((err) => {
      // Enqueue failure is a system-level error — log with full context for alerting
      // (큐 등록 실패는 시스템 레벨 오류 — 알림을 위해 전체 컨텍스트 로깅)
      console.error(
        `[Webhook] ✗ Failed to enqueue order ${orderData.orderId} | ` +
        `agent: ${storeContext.agentId} | error: ${err.message} ` +
        `(주문 ${orderData.orderId} 큐 등록 실패)`
      );
    });
}

// ── Payload Normalizer ────────────────────────────────────────────────────────

/**
 * Transforms the raw Retell webhook payload into the canonical orderData shape
 * consumed by the worker. Keeps the controller and worker decoupled from Retell's schema.
 * (Retell 웹훅 원시 페이로드를 워커가 소비하는 표준 주문 데이터 형태로 변환.
 *  컨트롤러와 워커를 Retell 스키마에서 분리)
 *
 * Retell payload reference fields used here:
 *   call_id              — unique call identifier (고유 통화 ID)
 *   from_number          — customer's phone number (고객 전화번호)
 *   order_items          — array of voice-parsed order items (음성 파싱 주문 항목 배열)
 *   total_amount_cents   — total charge in cents (센트 단위 총 금액)
 *   special_instructions — free-text customer notes (고객 특이 사항)
 *   retell_llm_dynamic_variables — key/value bag from Retell LLM (Retell LLM 동적 변수)
 *
 * @param {object} payload      — raw Retell POST body (Retell 원시 POST 바디)
 * @param {object} storeContext — tenant context (테넌트 컨텍스트)
 * @returns {object} orderData
 */
function normalizeRetellPayload(payload, storeContext) {
  return {
    // Unique order identifier — use Retell call_id for idempotency (멱등성을 위해 Retell call_id를 주문 ID로 사용)
    orderId:             payload.call_id ?? `fallback-${Date.now()}`,

    // Call metadata (통화 메타데이터)
    callId:              payload.call_id,
    customerPhone:       payload.from_number ?? null,

    // Order contents parsed by Retell's LLM (Retell LLM이 파싱한 주문 내용)
    items:               Array.isArray(payload.order_items) ? payload.order_items : [],

    // Total amount — must be integer cents; default 0 triggers worker validation error
    // (총 금액 — 정수 센트 필수. 기본값 0은 워커 검증 오류 유발)
    totalAmountCents:    typeof payload.total_amount_cents === 'number'
                           ? payload.total_amount_cents
                           : 0,

    // Free-text instructions from the voice interaction (음성 대화에서 추출된 특이 사항)
    specialInstructions: payload.special_instructions ?? '',

    // LLM dynamic variables — language preference, promo codes, etc. (LLM 동적 변수 — 언어, 프로모 코드 등)
    llmVariables:        payload.retell_llm_dynamic_variables ?? {},

    // Tenant + source context attached for worker tracing (워커 추적을 위한 테넌트 및 소스 컨텍스트)
    agentId:             storeContext.agentId,
    storeName:           storeContext.storeName,
    source:              'retell_voice',
    receivedAt:          new Date().toISOString(),
  };
}
