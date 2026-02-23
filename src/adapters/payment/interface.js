/**
 * PaymentAdapter — abstract base class for all payment gateway adapters.
 * Every concrete adapter MUST extend this class and implement processPayment().
 * (모든 결제 어댑터의 추상 기반 클래스. processPayment()를 반드시 구현해야 함)
 *
 * Contract enforced:
 *   - processPayment() must return a normalized PaymentResult object
 *   - Adapters must never throw raw SDK errors — wrap them in PaymentError
 *   (어댑터는 원시 SDK 오류를 그대로 던지면 안 됨 — PaymentError로 래핑 필수)
 */
export class PaymentAdapter {
  /**
   * Process a payment for a given order.
   * (주문에 대한 결제를 처리)
   *
   * @param {number}  amount      — charge amount in cents / smallest currency unit (센트 단위 금액)
   * @param {string}  orderId     — internal order reference (내부 주문 ID)
   * @param {object}  storeConfig — tenant-scoped store settings from req.storeContext (테넌트 스토어 설정)
   * @returns {Promise<PaymentResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async processPayment(amount, orderId, storeConfig) {
    // Subclasses must override this method — guard enforces the contract (서브클래스 미구현 시 즉시 오류 발생 — 계약 강제)
    throw new Error(
      `[PaymentAdapter] processPayment() is not implemented by ${this.constructor.name}. ` +
      `(${this.constructor.name}에서 processPayment()가 구현되지 않았습니다.)`
    );
  }

  /**
   * Returns the adapter's identifier string for logging and routing.
   * (로깅 및 라우팅을 위한 어댑터 식별자 반환)
   *
   * @returns {string}
   */
  get adapterName() {
    return this.constructor.name;
  }
}

/**
 * PaymentResult — normalized response shape returned by every adapter.
 * Controllers and queue workers depend only on this shape, never on adapter internals.
 * (모든 어댑터가 반환하는 정규화된 응답 구조 — 컨트롤러는 이 구조에만 의존)
 *
 * @typedef  {object}  PaymentResult
 * @property {boolean} success       — whether the transaction was approved (거래 승인 여부)
 * @property {string}  adapter       — which adapter processed this payment (처리한 어댑터명)
 * @property {string}  transactionId — gateway-issued transaction/session ID (게이트웨이 거래 ID)
 * @property {string}  orderId       — echoed back for correlation (상관 관계용 주문 ID)
 * @property {number}  amount        — echoed amount in cents (센트 단위 금액 반환)
 * @property {string}  status        — 'approved' | 'pending' | 'declined' | 'error' (거래 상태)
 * @property {object}  [meta]        — adapter-specific extra fields (어댑터별 추가 데이터)
 */

/**
 * PaymentError — structured error wrapper for payment failures.
 * Preserves the original cause while adding gateway-level context.
 * (결제 실패 구조화 오류 — 원인 보존 + 게이트웨이 컨텍스트 추가)
 */
export class PaymentError extends Error {
  /**
   * @param {string} message    — human-readable error description (사람이 읽을 수 있는 오류 설명)
   * @param {string} adapter    — adapter that threw (오류 발생 어댑터)
   * @param {string} [code]     — gateway-specific error code (게이트웨이 오류 코드)
   * @param {Error}  [cause]    — original underlying error (원인 오류)
   */
  constructor(message, adapter, code = 'UNKNOWN', cause = null) {
    super(message);
    this.name = 'PaymentError';
    this.adapter = adapter;      // Which adapter threw (오류 발생 어댑터)
    this.code = code;            // Gateway error code (게이트웨이 오류 코드)
    this.cause = cause;          // Original error for stack tracing (스택 추적용 원인 오류)
    this.statusCode = 502;       // Upstream gateway failure maps to 502 (상위 게이트웨이 실패 → 502)
  }
}
