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
  // Build a clickable local URL so the payment flow can be completed end-to-end in development.
  // APP_BASE_URL should be set to the public-facing origin in production (e.g. https://yourdomain.com).
  // Falls back to http://localhost:3000 when the variable is absent.
  // (로컬에서 전체 결제 흐름을 완성할 수 있는 클릭 가능한 URL 생성.
  //  프로덕션에서는 APP_BASE_URL을 공개 도메인으로 설정해야 함 — 없으면 localhost:3000으로 폴백)
  const baseUrl    = process.env.APP_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
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
