/**
 * LoyverseAdapter — POS adapter for the Loyverse cloud POS API.
 * Skeleton implementation: axios client is wired up and ready.
 * Full legacy Loyverse API logic will be migrated into getMenu() and createOrder() in a future step.
 * (Loyverse POS API 어댑터 스켈레톤 — axios 클라이언트 구성 완료.
 *  기존 Loyverse API 로직은 추후 getMenu()와 createOrder()로 마이그레이션 예정)
 */

import axios from 'axios';
import { PosAdapter, PosError } from './interface.js';

// Loyverse REST API base URL — v1.0 (Loyverse REST API 기본 URL)
const LOYVERSE_BASE_URL = 'https://api.loyverse.com/v1.0';

export class LoyverseAdapter extends PosAdapter {
  /**
   * @param {string} pos_api_key — Loyverse Bearer access token from the tenant's store config
   *                               (테넌트 스토어 설정의 Loyverse Bearer 액세스 토큰)
   */
  constructor(pos_api_key) {
    super();

    if (!pos_api_key) {
      // Fail fast — a missing key means every request will 401 (API 키 없으면 모든 요청 401 — 조기 실패)
      throw new PosError(
        '[LoyverseAdapter] Missing pos_api_key — cannot instantiate adapter. ' +
        '(pos_api_key 누락 — 어댑터 생성 불가)',
        'LoyverseAdapter',
        'MISSING_API_KEY'
      );
    }

    // Pre-configure a shared axios instance with auth header and base URL
    // (인증 헤더와 기본 URL로 공유 axios 인스턴스 사전 구성)
    this._client = axios.create({
      baseURL: LOYVERSE_BASE_URL,
      timeout: parseInt(process.env.LOYVERSE_TIMEOUT_MS ?? '8000', 10), // Default 8 s (기본 8초)
      headers: {
        Authorization:  `Bearer ${pos_api_key}`, // Loyverse Bearer token auth (Loyverse Bearer 토큰 인증)
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetch the active menu from Loyverse.
   * TODO: migrate legacy Loyverse getMenu() logic here.
   * (Loyverse에서 활성 메뉴 조회. TODO: 기존 Loyverse getMenu() 로직 마이그레이션 예정)
   *
   * @returns {Promise<import('./interface.js').MenuResult>}
   */
  async getMenu() {
    // Log entry point for observability before the real implementation lands
    // (실제 구현 전 관측 가능성을 위한 진입점 로깅)
    console.log(
      '[LoyverseAdapter] getMenu() called — will fetch /items and /categories ' +
      '(getMenu() 호출 — /items 및 /categories 조회 예정)'
    );

    // TODO: migrate legacy Loyverse getMenu logic here
    // Expected calls:  GET /items, GET /categories
    // Expected return: normalized MenuResult (categories[] with items[])
    // (TODO: 기존 Loyverse getMenu 로직 마이그레이션.
    //  예상 호출: GET /items, GET /categories
    //  반환값: 정규화된 MenuResult — categories[] with items[])

    return {
      success:    true,
      adapter:    this.adapterName,
      categories: [],               // Populated after migration (마이그레이션 후 채워질 예정)
      fetchedAt:  new Date().toISOString(),
    };
  }

  /**
   * Submit a new order to Loyverse.
   * TODO: migrate legacy Loyverse createOrder() logic here.
   * (Loyverse에 새 주문 전송. TODO: 기존 Loyverse createOrder() 로직 마이그레이션 예정)
   *
   * @param {object} orderData    — normalized order from the queue worker (큐 워커의 정규화된 주문)
   * @param {object} storeContext — tenant store context (테넌트 스토어 컨텍스트)
   * @returns {Promise<import('./interface.js').PosOrderResult>}
   */
  async createOrder(orderData, storeContext) {
    // Log the incoming order for traceability before the real implementation lands
    // (실제 구현 전 추적 가능성을 위한 수신 주문 로깅)
    console.log(
      `[LoyverseAdapter] createOrder() called — orderId: ${orderData.orderId}, ` +
      `store: ${storeContext.storeName} ` +
      `(createOrder() 호출 — 주문 ID: ${orderData.orderId}, 스토어: ${storeContext.storeName})`
    );

    // TODO: migrate legacy Loyverse createOrder logic here
    // Expected call:   POST /receipts with Loyverse receipt payload
    // Expected return: normalized PosOrderResult with posOrderId = receipt_number
    // (TODO: 기존 Loyverse createOrder 로직 마이그레이션.
    //  예상 호출: POST /receipts (Loyverse 영수증 페이로드)
    //  반환값: 정규화된 PosOrderResult — posOrderId = receipt_number)

    return {
      success:     true,
      adapter:     this.adapterName,
      posOrderId:  `LYV-PENDING-${orderData.orderId}`, // Placeholder until migration (마이그레이션 전 임시 값)
      orderId:     orderData.orderId,
      status:      'submitted',
      submittedAt: new Date().toISOString(),
    };
  }
}
