// Maverick Gateway + Dejavoo P1/P8 terminal adapter — full mock server simulation
// (Maverick 게이트웨이 + Dejavoo P1/P8 단말기 어댑터 — 완전한 목 서버 시뮬레이션)
import { PaymentAdapter, PaymentError } from './interface.js';
import { randomUUID } from 'crypto';

// ── Terminal Configuration ────────────────────────────────────────────────────

// Supported Dejavoo terminal model identifiers (지원되는 Dejavoo 단말기 모델 식별자)
const DEJAVOO_MODELS = {
  P1: 'DEJAVOO_P1',   // Countertop terminal (카운터탑 단말기)
  P8: 'DEJAVOO_P8',   // Portable/wireless terminal (휴대용/무선 단말기)
};

// Simulated network delay constants — mimics real terminal card-tap wait time
// (시뮬레이션된 네트워크 지연 상수 — 실제 단말기 카드 탭 대기 시간 모방)
const TERMINAL_TAP_DELAY_MS    = 2000;  // 2s tap-and-wait simulation (카드 탭 대기 2초)
const GATEWAY_RESPONSE_DELAY_MS =  300;  // 300ms gateway auth roundtrip (게이트웨이 인증 왕복 300ms)

// Decline simulation rate — 0.0 means always approve in mock mode
// (결제 거절 시뮬레이션 비율 — 0.0은 목 모드에서 항상 승인)
const MOCK_DECLINE_RATE = parseFloat(process.env.MOCK_DECLINE_RATE ?? '0.0');

// ── ISO 8583-style response codes (ISO 8583 스타일 응답 코드) ──────────────────
const RESPONSE_CODES = {
  APPROVED:          '00',
  DECLINED_GENERIC:  '05',
  INSUFFICIENT_FUNDS:'51',
  INVALID_CARD:      '14',
  EXPIRED_CARD:      '54',
};

// ── Mock card pool — rotated deterministically by orderId hash ────────────────
// (목 카드 풀 — orderId 해시로 결정론적 순환)
const MOCK_CARDS = [
  { brand: 'VISA',       last4: '4242', expiry: '12/26', entryMode: 'CONTACTLESS' },
  { brand: 'MASTERCARD', last4: '5555', expiry: '09/25', entryMode: 'CONTACTLESS' },
  { brand: 'AMEX',       last4: '0005', expiry: '03/27', entryMode: 'CHIP' },
  { brand: 'DISCOVER',   last4: '1117', expiry: '11/25', entryMode: 'SWIPE' },
];

export class MaverickAdapter extends PaymentAdapter {
  /**
   * Simulate a full Maverick Gateway + Dejavoo terminal payment flow:
   *   1. Request sent to Maverick Gateway (게이트웨이로 요청 전송)
   *   2. Gateway routes to Dejavoo terminal (단말기로 라우팅)
   *   3. Terminal waits for customer card tap — 2 second delay (카드 탭 대기 — 2초 지연)
   *   4. Gateway processes auth and returns approval (게이트웨이 인증 처리 후 승인 반환)
   *
   * @param {number} amount       — amount in cents (센트 단위 금액)
   * @param {string} orderId      — internal order ID (내부 주문 ID)
   * @param {object} storeConfig  — tenant store context (테넌트 스토어 컨텍스트)
   * @returns {Promise<PaymentResult>}
   */
  async processPayment(amount, orderId, storeConfig) {
    // Validate amount — must be positive integer in cents (금액 검증 — 양수 정수 센트 필수)
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new PaymentError(
        `Invalid amount: ${amount}. Must be a positive integer in cents.`,
        'maverick',
        'INVALID_AMOUNT'
      );
    }

    // Resolve terminal model from storeConfig, default to P8 portable
    // (storeConfig에서 단말기 모델 결정, 기본값은 P8 휴대용)
    const terminalModel = DEJAVOO_MODELS[storeConfig.terminalModel] ?? DEJAVOO_MODELS.P8;

    console.log(
      `[Maverick] Routing $${(amount / 100).toFixed(2)} to ${terminalModel} for order ${orderId}` +
      ` (Maverick 게이트웨이: ${terminalModel}로 $${(amount / 100).toFixed(2)} 라우팅, 주문 ${orderId})`
    );

    // ── Phase 1: Simulate gateway request acknowledgment (게이트웨이 요청 수신 확인 시뮬레이션) ──
    await simulateDelay(GATEWAY_RESPONSE_DELAY_MS);

    console.log(
      `[Maverick] Terminal ${terminalModel} is waiting for customer card tap...` +
      ` (${terminalModel} 단말기가 고객 카드 탭을 기다리는 중...)`
    );

    // ── Phase 2: 2-second delay simulating customer presenting card to terminal ──
    // (고객이 단말기에 카드를 제시하는 2초 대기 시뮬레이션)
    await simulateDelay(TERMINAL_TAP_DELAY_MS);

    console.log(
      `[Maverick] Card tapped — processing authorization...` +
      ` (카드 탭 감지 — 인증 처리 중...)`
    );

    // ── Phase 3: Simulate decline probability (결제 거절 확률 시뮬레이션) ──
    if (Math.random() < MOCK_DECLINE_RATE) {
      return buildDeclinedResult(orderId, amount, terminalModel);
    }

    // ── Phase 4: Build approval response with realistic terminal data ──
    // (실제와 유사한 단말기 데이터로 승인 응답 구성)
    const card = pickMockCard(orderId);

    // Generate Maverick transaction ID — format: MVK-{timestamp}-{uuid prefix}
    // (Maverick 거래 ID 생성 — 형식: MVK-{타임스탬프}-{uuid 앞부분})
    const transactionId = `MVK-${Date.now()}-${randomUUID().slice(0, 8).toUpperCase()}`;

    // Generate 6-digit approval code matching real terminal format (실제 단말기 형식의 6자리 승인 코드 생성)
    const approvalCode = Math.floor(100000 + Math.random() * 900000).toString();

    return {
      success:       true,
      adapter:       'maverick',
      transactionId,
      orderId,
      amount,
      status:        'approved',
      meta: {
        gateway:      'MAVERICK',
        terminal:     terminalModel,
        approvalCode,                          // 6-digit auth code (6자리 승인 코드)
        responseCode: RESPONSE_CODES.APPROVED, // ISO 8583 '00' = approved (ISO 8583 승인 코드)
        cardBrand:    card.brand,
        last4:        card.last4,
        cardExpiry:   card.expiry,
        entryMode:    card.entryMode,          // CONTACTLESS | CHIP | SWIPE (입력 방식)
        batchId:      generateBatchId(),       // Daily settlement batch ID (일일 정산 배치 ID)
        processedAt:  new Date().toISOString(),
      },
    };
  }
}

// ── Private Helpers ───────────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves after `ms` milliseconds.
 * Used to simulate real-world terminal and gateway network latency.
 * (밀리초 단위 지연 후 resolve되는 Promise 반환 — 단말기/게이트웨이 네트워크 지연 시뮬레이션)
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function simulateDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Pick a mock card deterministically based on orderId to ensure reproducible test results.
 * (재현 가능한 테스트를 위해 orderId 기반으로 목 카드를 결정론적으로 선택)
 *
 * @param {string} orderId
 * @returns {object}
 */
function pickMockCard(orderId) {
  // Simple hash: sum of char codes mod card pool length (단순 해시: 문자 코드 합계를 카드 풀 크기로 나눈 나머지)
  const hash = [...orderId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return MOCK_CARDS[hash % MOCK_CARDS.length];
}

/**
 * Build a normalized declined PaymentResult.
 * (정규화된 결제 거절 PaymentResult 구성)
 *
 * @param {string} orderId
 * @param {number} amount
 * @param {string} terminalModel
 * @returns {PaymentResult}
 */
function buildDeclinedResult(orderId, amount, terminalModel) {
  console.warn(
    `[Maverick] Card DECLINED for order ${orderId} (주문 ${orderId} 카드 거절)`
  );
  return {
    success:       false,
    adapter:       'maverick',
    transactionId: `MVK-DECLINE-${Date.now()}`,
    orderId,
    amount,
    status:        'declined',
    meta: {
      gateway:      'MAVERICK',
      terminal:     terminalModel,
      responseCode: RESPONSE_CODES.DECLINED_GENERIC, // ISO 8583 '05' (ISO 8583 거절 코드)
      reason:       'Do not honor',                   // Standard issuer decline reason (표준 발급사 거절 사유)
      processedAt:  new Date().toISOString(),
    },
  };
}

/**
 * Generate a daily settlement batch ID in format BATCH-YYYYMMDD-XXXX.
 * (BATCH-YYYYMMDD-XXXX 형식의 일일 정산 배치 ID 생성)
 *
 * @returns {string}
 */
function generateBatchId() {
  const now   = new Date();
  const date  = now.toISOString().slice(0, 10).replace(/-/g, '');   // YYYYMMDD
  const seq   = Math.floor(1000 + Math.random() * 9000);            // 4-digit sequence (4자리 시퀀스)
  return `BATCH-${date}-${seq}`;
}
