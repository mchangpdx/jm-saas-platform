/**
 * QuanticAdapter — mock POS adapter for the Quantic cloud POS system.
 * Serves as a development/testing stub until the real Quantic API integration is built.
 * (Quantic 클라우드 POS 시스템용 목 어댑터 — 실제 Quantic API 연동 전 개발/테스트용 스텁)
 *
 * All responses are simulated with configurable delays to mimic real POS latency.
 * (모든 응답은 실제 POS 지연을 모방하는 구성 가능한 딜레이로 시뮬레이션)
 */

import { PosAdapter } from './interface.js';

// Simulated round-trip delay in ms — mirrors a realistic cloud POS API call (클라우드 POS API 호출을 모방하는 시뮬레이션 왕복 딜레이)
const MOCK_DELAY_MS = parseInt(process.env.QUANTIC_MOCK_DELAY_MS ?? '150', 10);

// Sample menu fixture — static data representing a typical restaurant menu (일반 레스토랑 메뉴를 나타내는 정적 샘플 메뉴 데이터)
const MOCK_MENU = [
  {
    categoryId:   'cat-drinks',
    categoryName: 'Drinks',
    items: [
      { itemId: 'q-001', name: 'Americano',     priceCents: 350,  available: true },
      { itemId: 'q-002', name: 'Latte',         priceCents: 450,  available: true },
      { itemId: 'q-003', name: 'Cold Brew',     priceCents: 500,  available: true },
    ],
  },
  {
    categoryId:   'cat-food',
    categoryName: 'Food',
    items: [
      { itemId: 'q-010', name: 'Club Sandwich', priceCents: 1200, available: true },
      { itemId: 'q-011', name: 'Caesar Salad',  priceCents: 1000, available: true },
      { itemId: 'q-012', name: 'Croissant',     priceCents: 550,  available: false }, // Sold out — tests availability filter (품절 — 가용성 필터 테스트)
    ],
  },
];

export class QuanticAdapter extends PosAdapter {
  /**
   * @param {string} [apiKey] — Quantic API key (ignored in mock, accepted for interface parity)
   *                            (목에서는 무시되지만 인터페이스 일관성을 위해 수락)
   */
  constructor(apiKey) {
    super();
    // Store for future real implementation — logged to confirm injection (미래 실제 구현을 위해 저장 — 주입 확인용 로깅)
    this._apiKey = apiKey ?? 'MOCK_KEY';

    console.log(
      `[QuanticAdapter] Initialized in MOCK mode (apiKey: ${this._apiKey.slice(0, 6)}…) ` +
      `(목 모드로 초기화됨 (API 키: ${this._apiKey.slice(0, 6)}…))`
    );
  }

  /**
   * Return the mock menu fixture after a simulated network delay.
   * (시뮬레이션된 네트워크 딜레이 후 목 메뉴 픽스처 반환)
   *
   * @returns {Promise<import('./interface.js').MenuResult>}
   */
  async getMenu() {
    console.log(
      `[QuanticAdapter] getMenu() — simulating ${MOCK_DELAY_MS}ms POS round-trip ` +
      `(getMenu() — POS 왕복 ${MOCK_DELAY_MS}ms 시뮬레이션)`
    );

    // Simulate async network latency (비동기 네트워크 지연 시뮬레이션)
    await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));

    const totalItems = MOCK_MENU.reduce((sum, cat) => sum + cat.items.length, 0); // Count all items across categories (모든 카테고리 항목 수 합산)

    return {
      success:    true,
      adapter:    this.adapterName,
      categories: structuredClone(MOCK_MENU),             // Return a deep copy so callers cannot mutate the fixture (호출자가 픽스처를 변경하지 못하도록 깊은 복사 반환)
      fetchedAt:  new Date().toISOString(),
      meta: {
        totalItems,
        totalCategories: MOCK_MENU.length,
        source: 'MOCK',                                   // Flag this as mock data (목 데이터임을 표시)
      },
    };
  }

  /**
   * Simulate a successful order submission to the Quantic POS.
   * Generates a deterministic mock posOrderId from the internal orderId.
   * (Quantic POS에 주문 전송 성공 시뮬레이션 — 내부 주문 ID에서 결정적 목 posOrderId 생성)
   *
   * @param {object} orderData
   * @param {object} storeContext
   * @returns {Promise<import('./interface.js').PosOrderResult>}
   */
  async createOrder(orderData, storeContext) {
    console.log(
      `[QuanticAdapter] createOrder() — order ${orderData.orderId} for ${storeContext.storeName} | ` +
      `simulating ${MOCK_DELAY_MS}ms POS round-trip ` +
      `(createOrder() — 주문 ${orderData.orderId}, 스토어 ${storeContext.storeName} | ${MOCK_DELAY_MS}ms 시뮬레이션)`
    );

    // Simulate async network latency (비동기 네트워크 지연 시뮬레이션)
    await new Promise((r) => setTimeout(r, MOCK_DELAY_MS));

    // Derive a stable mock receipt number from the order ID (주문 ID에서 안정적인 목 영수증 번호 파생)
    const mockReceiptNum = `QNT-${orderData.orderId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-8)}`;

    return {
      success:      true,
      adapter:      this.adapterName,
      posOrderId:   mockReceiptNum,
      orderId:      orderData.orderId,
      status:       'submitted',
      submittedAt:  new Date().toISOString(),
      meta: {
        source:     'MOCK',                               // Flag this as mock data (목 데이터임을 표시)
        itemCount:  orderData.items?.length ?? 0,
        totalCents: orderData.totalAmountCents ?? 0,
      },
    };
  }
}
