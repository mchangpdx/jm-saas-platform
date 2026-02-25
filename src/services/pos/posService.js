// POS injection service — direct Loyverse API integration via pure axios
// (POS 주입 서비스 — 순수 axios를 사용한 Loyverse API 직접 연동)
//
// Design principles (설계 원칙):
//   - Pure axios: no Loyverse SDK dependency (순수 axios — Loyverse SDK 의존성 없음)
//   - Dynamic API keys: storeApiKey always comes from the DB, never from .env
//     (동적 API 키 — storeApiKey는 항상 DB에서 조회, .env 사용 금지)
//   - Interface-first: injectReservation and injectPayment are stubs with matching
//     signatures so callers never need to change when they are implemented
//     (인터페이스 우선 — injectReservation, injectPayment는 서명 일치 스텁)
//   - Non-blocking failures: POS injection must never block or crash the payment flow
//     (비차단 실패 — POS 주입 실패가 결제 흐름을 중단하거나 충돌시키면 안 됨)

import axios from 'axios';

// Loyverse REST API base URL (Loyverse REST API 기본 URL)
const LOYVERSE_BASE_URL = 'https://api.loyverse.com/v1.0';

// Loyverse receipts endpoint (Loyverse 영수증 엔드포인트)
const RECEIPTS_ENDPOINT = `${LOYVERSE_BASE_URL}/receipts`;

// HTTP request timeout for Loyverse API calls in milliseconds (Loyverse API 호출 HTTP 요청 타임아웃 밀리초)
const LOYVERSE_TIMEOUT_MS = parseInt(process.env.LOYVERSE_TIMEOUT_MS ?? '8000', 10);

// ── Payload Builder ───────────────────────────────────────────────────────────

/**
 * Map a single order item from our internal format to a Loyverse receipt line item.
 *
 * Loyverse line items require item_id and variant_id in production.
 * For MVP, those fields are omitted because we do not yet perform a Loyverse item
 * catalog sync. Once catalog sync is implemented, replace the TODOs below with
 * the real UUIDs looked up by item name.
 *
 * Fields we can populate now from our order data (현재 주문 데이터로 채울 수 있는 필드):
 *   item_name        — human-readable label passed through to the receipt
 *   quantity         — units ordered
 *   price            — unit price derived by dividing total_amount evenly (MVP approximation)
 *   gross_total_money — quantity × price
 *   total_money       — same as gross_total_money (no discounts in MVP)
 *
 * (단일 주문 항목을 내부 형식에서 Loyverse 영수증 라인 항목으로 매핑.
 *  프로덕션에서는 item_id와 variant_id 필수 — MVP에서는 카탈로그 동기화 미구현으로 생략.
 *  카탈로그 동기화 구현 후 아래 TODO를 실제 UUID로 교체)
 *
 * @param {{ name: string, quantity: number }} item        — internal order item (내부 주문 항목)
 * @param {number}                             unitPrice   — unit price for this item (항목 단가)
 * @returns {object} Loyverse receipt line_item object (Loyverse 영수증 라인 항목 객체)
 */
function mapItemToLineItem(item, unitPrice) {
  const grossTotal = parseFloat((unitPrice * item.quantity).toFixed(2));

  return {
    // TODO: replace with real Loyverse item UUID from catalog sync (카탈로그 동기화 후 실제 Loyverse item UUID로 교체)
    // item_id:          'loyverse-item-uuid',
    // TODO: replace with real Loyverse variant UUID from catalog sync (카탈로그 동기화 후 실제 variant UUID로 교체)
    // variant_id:       'loyverse-variant-uuid',
    item_name:          item.name,                   // Display label on the receipt (영수증 표시 레이블)
    quantity:           item.quantity,               // Units ordered (주문 수량)
    price:              parseFloat(unitPrice.toFixed(2)), // Unit price (단가)
    gross_total_money:  grossTotal,                  // quantity × unit price before discounts (할인 전 소계)
    total_money:        grossTotal,                  // Net line total — no discounts in MVP (순 라인 합계 — MVP에서 할인 없음)
  };
}

/**
 * Build the full Loyverse POST /receipts payload from our order data.
 *
 * Unit price is approximated by splitting total_amount evenly across all item units.
 * Real catalog sync would supply exact per-item prices. (MVP 근사값 — 실제 카탈로그 동기화 후 정확한 단가 사용)
 *
 * (주문 데이터로부터 Loyverse POST /receipts 전체 페이로드 생성.
 *  단가는 total_amount를 총 주문 수량으로 균등 분배한 근사값)
 *
 * @param {object} orderData — full order row from Supabase (Supabase의 전체 주문 행)
 * @returns {object} Loyverse receipt request body (Loyverse 영수증 요청 바디)
 */
function buildReceiptPayload(orderData) {
  const items     = orderData.items ?? [];
  const totalUnits = items.reduce((sum, i) => sum + (i.quantity ?? 1), 0);
  const totalAmount = parseFloat(orderData.total_amount ?? 0);

  // Approximate unit price — evenly distributed across all units (단가 근사 — 전체 수량에 균등 분배)
  const unitPrice = totalUnits > 0 ? totalAmount / totalUnits : 0;

  const lineItems = items.map((item) => mapItemToLineItem(item, unitPrice));

  return {
    // source marks this receipt as externally created, not from Loyverse POS hardware
    // (source는 이 영수증이 Loyverse POS 하드웨어가 아닌 외부에서 생성되었음을 표시)
    source:       'EXTERNAL',
    receipt_date: orderData.created_at ?? new Date().toISOString(), // Use original order time (원래 주문 시간 사용)
    note:         `JM Voice Order | order_id: ${orderData.id} | customer: ${orderData.customer_phone ?? 'unknown'}`,
    line_items:   lineItems,
    total_money:  totalAmount,       // Confirmed order total (확정된 주문 총액)
    total_discount: 0,               // No discounts in MVP (MVP에서 할인 없음)
    total_tax:      0,               // Tax handling deferred to post-MVP (세금 처리는 MVP 이후로 지연)
    payments: [
      {
        // TODO: replace with real Loyverse payment_type_id from store config (매장 설정의 실제 payment_type_id로 교체)
        // payment_type_id: 'loyverse-payment-type-uuid',
        money_amount: totalAmount,   // Full payment amount (전체 결제 금액)
      },
    ],
  };
}

// ── Public Interface ──────────────────────────────────────────────────────────

/**
 * Inject a paid order into Loyverse POS via POST /receipts.
 *
 * Uses the dynamic storeApiKey (Bearer token) fetched from the stores table —
 * never reads from .env so different tenants can each have their own Loyverse token.
 *
 * On success: logs the Loyverse receipt number and returns the response data.
 * On failure: logs the full error detail and returns null — callers must not crash.
 *
 * (POST /receipts를 통해 결제 완료 주문을 Loyverse POS에 주입.
 *  stores 테이블에서 동적으로 가져온 storeApiKey(Bearer 토큰) 사용 — .env 의존 금지.
 *  성공: Loyverse 영수증 번호 로깅 후 응답 데이터 반환.
 *  실패: 전체 오류 상세 로깅 후 null 반환 — 호출자가 충돌해서는 안 됨)
 *
 * @param {object} orderData   — full order row from Supabase (Supabase의 전체 주문 행)
 * @param {string} storeApiKey — Loyverse Bearer token from stores.pos_api_key (stores.pos_api_key의 Loyverse Bearer 토큰)
 * @returns {Promise<object|null>} Loyverse receipt response or null on failure (Loyverse 영수증 응답 또는 실패 시 null)
 */
export async function injectOrder(orderData, storeApiKey) {
  console.log(
    `[PosService] injectOrder | orderId: ${orderData.id} | store: ${orderData.store_id} ` +
    `(POS 주문 주입 시작 | 주문: ${orderData.id} | 매장: ${orderData.store_id})`
  );

  if (!storeApiKey) {
    // Without an API key every request will 401 — abort early and log clearly
    // (API 키 없으면 모든 요청이 401 — 명확하게 로깅 후 조기 중단)
    console.error(
      `[PosService] injectOrder aborted — storeApiKey is missing for order ${orderData.id} ` +
      `(주입 중단 — storeApiKey 누락 | 주문: ${orderData.id})`
    );
    return null;
  }

  // Trim whitespace from the DB value — trailing spaces cause "Invalid character in header content"
  // (DB 값의 공백 제거 — 후행 공백이 "Invalid character in header content" 오류를 유발함)
  const cleanApiKey = storeApiKey.trim();

  const payload = buildReceiptPayload(orderData);

  console.log(
    `[PosService] Posting to Loyverse /receipts | items: ${payload.line_items.length} | ` +
    `total: ${payload.total_money} ` +
    `(Loyverse /receipts에 POST | 항목 수: ${payload.line_items.length} | 합계: ${payload.total_money})`
  );

  try {
    const response = await axios.post(RECEIPTS_ENDPOINT, payload, {
      timeout: LOYVERSE_TIMEOUT_MS,
      headers: {
        Authorization:  `Bearer ${cleanApiKey}`, // Trimmed per-tenant Loyverse token (공백 제거된 테넌트별 Loyverse 토큰)
        'Content-Type': 'application/json',
      },
    });

    console.log(
      `[PosService] injectOrder success | orderId: ${orderData.id} | ` +
      `loyverse_receipt_number: ${response.data?.receipt_number ?? 'N/A'} | ` +
      `HTTP: ${response.status} ` +
      `(POS 주입 성공 | 주문: ${orderData.id} | Loyverse 영수증 번호: ${response.data?.receipt_number ?? 'N/A'})`
    );

    return response.data;

  } catch (err) {
    // Extract the most useful error detail from axios error shape (axios 오류 형태에서 가장 유용한 오류 상세 추출)
    const status  = err.response?.status;
    const detail  = err.response?.data ?? err.message;

    console.error(
      `[PosService] injectOrder failed | orderId: ${orderData.id} | ` +
      `HTTP: ${status ?? 'N/A'} | detail: ${JSON.stringify(detail)} ` +
      `(POS 주입 실패 | 주문: ${orderData.id} | HTTP: ${status ?? 'N/A'} | 상세: ${JSON.stringify(detail)})`
    );

    // Return null — the payment is already confirmed; POS failure is non-fatal
    // (null 반환 — 결제는 이미 확정됨 — POS 실패는 치명적이지 않음)
    return null;
  }
}

/**
 * Inject a reservation into the POS system.
 * STUB: Loyverse does not support reservation records — skip silently.
 * (예약을 POS 시스템에 주입.
 *  스텁: Loyverse는 예약 기록을 지원하지 않음 — 조용히 건너뜀)
 *
 * @param {object} reservationData — reservation row from Supabase (Supabase의 예약 행)
 * @param {string} storeApiKey     — POS API key (사용하지 않음 — POS API 키)
 * @returns {Promise<boolean>} always true (항상 true 반환)
 */
export async function injectReservation(reservationData, storeApiKey) { // eslint-disable-line no-unused-vars
  // Loyverse POS does not support reservation records — skip POS injection entirely
  // (Loyverse POS는 예약 기록을 지원하지 않음 — POS 주입 전체 건너뜀)
  console.log(
    `[PosService] injectReservation | reservationId: ${reservationData?.id ?? 'N/A'} — ` +
    `POS system does not support reservations. Skipping POS injection. ` +
    `(POS 시스템이 예약을 지원하지 않습니다. POS 주입을 건너뜁니다.)`
  );
  return true;
}

/**
 * Inject a payment event into the POS system.
 * STUB: payment reconciliation via POS API is deferred to post-MVP.
 * (POS 시스템에 결제 이벤트 주입.
 *  스텁: POS API를 통한 결제 조정은 MVP 이후로 지연)
 *
 * @param {object} paymentData — payment details (결제 상세)
 * @param {string} storeApiKey — POS API key (사용하지 않음 — POS API 키)
 * @returns {Promise<boolean>} always true (항상 true 반환)
 */
export async function injectPayment(paymentData, storeApiKey) { // eslint-disable-line no-unused-vars
  // Payment injection into POS is deferred — log the call for future implementation
  // (POS 결제 주입은 지연됨 — 향후 구현을 위해 호출 로깅)
  console.log(
    `[PosService] injectPayment stub called | orderId: ${paymentData?.orderId ?? 'N/A'} ` +
    `(POS 결제 주입 스텁 호출 | 주문: ${paymentData?.orderId ?? 'N/A'})`
  );
  return true;
}
