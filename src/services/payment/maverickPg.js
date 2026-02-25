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
  // Resolve the public base URL from SERVER_URL — set this to the Ngrok HTTPS URL during development
  // so payment links in emails are globally accessible. Falls back to localhost for local-only testing.
  // (SERVER_URL에서 공개 베이스 URL 결정 — 개발 시 Ngrok HTTPS URL로 설정하면 이메일 링크가 전 세계 어디서나 접근 가능.
  //  미설정 시 로컬 전용 테스트를 위해 localhost로 폴백)
  const baseUrl    = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3000}`;
  const paymentUrl = `${baseUrl}/api/payment/mock/${orderId}`;

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
