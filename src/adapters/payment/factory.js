// Payment adapter factory — returns the correct adapter instance for a given gateway key
// (결제 어댑터 팩토리 — 게이트웨이 키에 맞는 어댑터 인스턴스 반환)
import { StripeAdapter }   from './stripe.js';
import { MaverickAdapter } from './maverick.js';

/**
 * Registry maps gateway key strings to adapter constructors.
 * Add new adapters here without touching factory logic.
 * (게이트웨이 키와 어댑터 생성자의 레지스트리 — 새 어댑터는 여기에만 추가)
 */
const ADAPTER_REGISTRY = {
  STRIPE:   StripeAdapter,
  MAVERICK: MaverickAdapter,
};

// Default gateway when storeConfig does not specify one — Maverick for in-person POS
// (storeConfig에 게이트웨이가 없을 때 기본값 — 대면 POS용 Maverick)
const DEFAULT_GATEWAY = 'MAVERICK';

/**
 * Returns an instantiated PaymentAdapter for the given gateway key.
 *
 * Usage:
 *   const adapter = getPaymentAdapter(req.storeContext.paymentType);
 *   const result  = await adapter.processPayment(amount, orderId, req.storeContext);
 *
 * (사용법: getPaymentAdapter로 어댑터 인스턴스를 받아 processPayment 호출)
 *
 * @param {string} [paymentGateway] — 'STRIPE' | 'MAVERICK', case-insensitive (대소문자 무관)
 * @returns {import('./interface.js').PaymentAdapter}
 */
export function getPaymentAdapter(paymentGateway) {
  // Normalize to uppercase and fall back to default if null/undefined/empty
  // (대문자 정규화 — null/undefined/빈 값은 기본 게이트웨이로 폴백)
  const key = (paymentGateway ?? DEFAULT_GATEWAY).toUpperCase().trim();

  const AdapterClass = ADAPTER_REGISTRY[key];

  if (!AdapterClass) {
    // Unknown gateway key — log a warning and fall back to default rather than crashing
    // (알 수 없는 게이트웨이 키 — 크래시 대신 기본 어댑터로 폴백 후 경고 로그)
    console.warn(
      `[PaymentFactory] Unknown gateway "${key}" — falling back to ${DEFAULT_GATEWAY}. ` +
      `(알 수 없는 게이트웨이 "${key}" — ${DEFAULT_GATEWAY}으로 폴백)`
    );
    return new ADAPTER_REGISTRY[DEFAULT_GATEWAY]();
  }

  return new AdapterClass();
}

/**
 * Returns all registered gateway keys — useful for validation and documentation endpoints.
 * (등록된 모든 게이트웨이 키 반환 — 유효성 검사 및 문서화 엔드포인트에 유용)
 *
 * @returns {string[]}
 */
export function getSupportedGateways() {
  return Object.keys(ADAPTER_REGISTRY);
}
