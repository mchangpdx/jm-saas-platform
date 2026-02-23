/**
 * PosAdapter — abstract base class for all POS system adapters.
 * Every concrete adapter MUST extend this class and implement getMenu() and createOrder().
 * (모든 POS 어댑터의 추상 기반 클래스. getMenu()와 createOrder()를 반드시 구현해야 함)
 *
 * Contract enforced:
 *   - getMenu()      must return a normalized MenuResult object
 *   - createOrder()  must return a normalized PosOrderResult object
 *   - Adapters must never throw raw SDK/HTTP errors — wrap them in PosError
 *   (어댑터는 원시 SDK/HTTP 오류를 그대로 던지면 안 됨 — PosError로 래핑 필수)
 */
export class PosAdapter {
  /**
   * Fetch the current menu from the POS system.
   * (POS 시스템에서 현재 메뉴 조회)
   *
   * @param {object} [options]  — adapter-specific query options (어댑터별 조회 옵션)
   * @returns {Promise<MenuResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async getMenu(options = {}) {
    // Subclasses must override — guard enforces the interface contract (서브클래스 미구현 시 즉시 오류 — 인터페이스 계약 강제)
    throw new Error(
      `[PosAdapter] getMenu() is not implemented by ${this.constructor.name}. ` +
      `(${this.constructor.name}에서 getMenu()가 구현되지 않았습니다.)`
    );
  }

  /**
   * Submit a new order to the POS system.
   * (POS 시스템에 새 주문 전송)
   *
   * @param {object} orderData   — normalized order payload from the queue worker (큐 워커에서 전달된 정규화 주문 페이로드)
   * @param {object} storeContext — tenant-scoped store settings from req.storeContext (테넌트 스토어 컨텍스트)
   * @returns {Promise<PosOrderResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async createOrder(orderData, storeContext) {
    // Subclasses must override — guard enforces the interface contract (서브클래스 미구현 시 즉시 오류 — 인터페이스 계약 강제)
    throw new Error(
      `[PosAdapter] createOrder() is not implemented by ${this.constructor.name}. ` +
      `(${this.constructor.name}에서 createOrder()가 구현되지 않았습니다.)`
    );
  }

  /**
   * Returns the adapter's identifier string for logging and routing.
   * (로깅 및 라우팅을 위한 어댑터 식별자 반환)
   *
   * @returns {string}
   */
  get adapterName() {
    return this.constructor.name; // Derived from concrete class name (구체 클래스명에서 파생)
  }
}

/**
 * PosOrderResult — normalized response shape returned by createOrder().
 * Queue workers depend only on this shape, never on adapter internals.
 * (createOrder()가 반환하는 정규화된 응답 구조 — 큐 워커는 이 구조에만 의존)
 *
 * @typedef  {object}  PosOrderResult
 * @property {boolean} success       — whether the POS accepted the order (POS 주문 수락 여부)
 * @property {string}  adapter       — which adapter processed this order (처리한 어댑터명)
 * @property {string}  posOrderId    — POS-issued order reference ID (POS 발급 주문 ID)
 * @property {string}  orderId       — echoed internal order ID for correlation (상관 관계용 내부 주문 ID)
 * @property {string}  status        — 'submitted' | 'accepted' | 'rejected' | 'error' (주문 상태)
 * @property {string}  submittedAt   — ISO timestamp of submission (전송 시각 ISO 타임스탬프)
 * @property {object}  [meta]        — adapter-specific extra fields (어댑터별 추가 데이터)
 */

/**
 * MenuResult — normalized response shape returned by getMenu().
 * (getMenu()가 반환하는 정규화된 메뉴 응답 구조)
 *
 * @typedef  {object}   MenuResult
 * @property {boolean}  success     — whether the menu was fetched successfully (메뉴 조회 성공 여부)
 * @property {string}   adapter     — which adapter fetched the menu (조회한 어댑터명)
 * @property {Array}    categories  — list of menu categories with items (메뉴 카테고리 및 항목 목록)
 * @property {string}   fetchedAt   — ISO timestamp of the fetch (조회 시각 ISO 타임스탬프)
 * @property {object}   [meta]      — adapter-specific extra fields (어댑터별 추가 데이터)
 */

/**
 * PosError — structured error wrapper for POS integration failures.
 * Preserves the original cause while adding POS-level context.
 * (POS 연동 실패 구조화 오류 — 원인 보존 + POS 컨텍스트 추가)
 */
export class PosError extends Error {
  /**
   * @param {string} message   — human-readable error description (사람이 읽을 수 있는 오류 설명)
   * @param {string} adapter   — adapter that threw (오류 발생 어댑터)
   * @param {string} [code]    — POS-specific error code (POS 오류 코드)
   * @param {Error}  [cause]   — original underlying error (원인 오류)
   */
  constructor(message, adapter, code = 'POS_ERROR', cause = null) {
    super(message);
    this.name       = 'PosError';
    this.adapter    = adapter;   // Which adapter threw (오류 발생 어댑터)
    this.code       = code;      // POS error code (POS 오류 코드)
    this.cause      = cause;     // Original error for stack tracing (스택 추적용 원인 오류)
    this.statusCode = 502;       // Upstream POS failure maps to 502 (상위 POS 실패 → 502)
  }
}
