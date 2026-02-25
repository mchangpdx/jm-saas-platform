// Maverick PG service — payment link creation and refund stubs for MVP
// (Maverick PG 서비스 — MVP용 결제 링크 생성 및 환불 스텁)

// ── createPaymentLink ─────────────────────────────────────────────────────────

/**
 * Generate a payment link for a confirmed order.
 * MVP implementation returns a deterministic mock URL — no real network call.
 * Replace with the live Maverick PG API call in production.
 * (확정된 주문에 대한 결제 링크 생성.
 *  MVP는 결정론적 목 URL 반환 — 실제 네트워크 호출 없음.
 *  프로덕션에서 실제 Maverick PG API 호출로 교체)
 *
 * @param {string|number} orderId  — order identifier from the orders table (orders 테이블의 주문 식별자)
 * @param {number}        amount   — order total (주문 총액)
 * @param {string}        storeId  — store identifier for routing (라우팅용 매장 식별자)
 * @returns {Promise<{ paymentUrl: string }>}
 */
export async function createPaymentLink(orderId, amount, storeId) {
  // Build a mock URL that encodes the key identifiers for easy debugging
  // (디버깅 편의를 위해 주요 식별자를 인코딩한 목 URL 생성)
  const paymentUrl = `https://pay.maverick.com/mock-link-${orderId}`;

  console.log(
    `[MaverickPG] createPaymentLink | orderId: ${orderId} | amount: ${amount} | ` +
    `storeId: ${storeId} | url: ${paymentUrl} ` +
    `(결제 링크 생성 | 주문: ${orderId} | 금액: ${amount} | 매장: ${storeId})`
  );

  return { paymentUrl };
}

// ── processRefund (STUB) ──────────────────────────────────────────────────────

/**
 * Process a refund for a given order.
 * STUB: returns a mock success payload — no real network call.
 * Replace with the live Maverick PG refund API in production.
 * (주문 환불 처리.
 *  스텁: 목 성공 페이로드 반환 — 실제 네트워크 호출 없음.
 *  프로덕션에서 실제 Maverick PG 환불 API로 교체)
 *
 * @param {string|number} orderId  — order to refund (환불할 주문)
 * @returns {Promise<{ success: boolean, refundId: string, message: string }>}
 */
export async function processRefund(orderId) {
  // Generate a deterministic stub refund ID for traceability (추적 가능성을 위한 결정론적 스텁 환불 ID 생성)
  const refundId = `refund-mock-${orderId}`;

  console.log(
    `[MaverickPG] processRefund (stub) | orderId: ${orderId} | refundId: ${refundId} ` +
    `(환불 처리 스텁 | 주문: ${orderId} | 환불 ID: ${refundId})`
  );

  return {
    success:  true,
    refundId,
    message:  `Refund processed successfully for order ${orderId}.`,
  };
}
