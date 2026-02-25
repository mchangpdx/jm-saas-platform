// Webhook routes — inbound callbacks from Retell AI and future integrations
// (웹훅 라우트 — Retell AI 및 향후 연동의 인바운드 콜백)
import { Router } from 'express';
import { tenantMiddleware }     from '../../middlewares/tenant.js';
import { handleRetellWebhook }  from '../../controllers/webhookController.js';

export const webhooksRouter = Router();

/**
 * POST /api/v1/webhooks/retell
 *
 * Middleware chain: tenantMiddleware → handleRetellWebhook
 *   1. tenantMiddleware resolves agent_id → req.storeContext (agent_id → req.storeContext 해석)
 *   2. handleRetellWebhook responds 200 immediately, then enqueues (즉시 200 응답 후 큐 등록)
 *
 * Body requirements (요청 바디 필수 항목):
 *   agent_id            — tenant identifier required by tenantMiddleware (테넌트 식별자)
 *   call_id             — Retell unique call ID, used as orderId (Retell 고유 통화 ID → 주문 ID)
 *   order_items         — array of LLM-parsed items (LLM 파싱 항목 배열)
 *   total_amount_cents  — total in cents (센트 단위 총 금액)
 */
webhooksRouter.post('/retell', tenantMiddleware, handleRetellWebhook);

/**
 * POST /api/v1/webhooks/payment
 *
 * STUB: receive payment success/failure events from the Maverick PG.
 * Responds 200 immediately and logs the raw payload for inspection.
 * Replace the stub body with real order-status updates in production.
 * (스텁: Maverick PG에서 결제 성공/실패 이벤트 수신.
 *  즉시 200 응답 후 원시 페이로드 로깅.
 *  프로덕션에서 실제 주문 상태 업데이트 로직으로 교체)
 */
webhooksRouter.post('/payment', (req, res) => {
  // Log the full payload for debugging and future integration work (디버깅 및 향후 연동 작업을 위해 전체 페이로드 로깅)
  console.log('[Webhook] Payment event received (결제 이벤트 수신):', JSON.stringify(req.body, null, 2));
  res.status(200).json({ received: true });
});

// Future webhook endpoints can be added here without touching v1/index.js
// (향후 웹훅 엔드포인트는 v1/index.js 수정 없이 여기에 추가)
// webhooksRouter.post('/square',  tenantMiddleware, handleSquareWebhook);
// webhooksRouter.post('/doordash', tenantMiddleware, handleDoorDashWebhook);
