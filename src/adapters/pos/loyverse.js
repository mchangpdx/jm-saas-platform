/**
 * LoyverseAdapter — POS adapter for the Loyverse cloud POS API.
 * Wraps all Loyverse REST calls so controllers/workers never touch Loyverse directly.
 * (Loyverse 클라우드 POS API 어댑터. 컨트롤러/워커가 Loyverse를 직접 호출하지 않도록 래핑)
 *
 * Loyverse API docs: https://developer.loyverse.com/docs/
 * Auth: Bearer token passed via Authorization header (Bearer 토큰 인증)
 */

import axios from 'axios';
import { PosAdapter, PosError } from './interface.js';

// Loyverse API base URL — versioned v1.0 endpoint (Loyverse API 기본 URL — v1.0 버전)
const LOYVERSE_BASE_URL = 'https://api.loyverse.com/v1.0';

export class LoyverseAdapter extends PosAdapter {
  /**
   * @param {string} apiKey — Loyverse API access token from the tenant's store config
   *                          (테넌트 스토어 설정에서 가져온 Loyverse API 액세스 토큰)
   */
  constructor(apiKey) {
    super();

    if (!apiKey) {
      // Fail fast on construction — missing key means all requests will 401
      // (생성 시 즉시 실패 — API 키 없으면 모든 요청이 401로 실패하므로 조기 검증)
      throw new PosError(
        '[LoyverseAdapter] Missing API key — cannot instantiate adapter. ' +
        '(API 키 누락 — 어댑터 생성 불가)',
        'LoyverseAdapter',
        'MISSING_API_KEY'
      );
    }

    // Pre-configure axios instance with auth header and base URL (인증 헤더와 기본 URL로 axios 인스턴스 사전 구성)
    this._client = axios.create({
      baseURL: LOYVERSE_BASE_URL,
      timeout: parseInt(process.env.LOYVERSE_TIMEOUT_MS ?? '8000', 10), // Default 8s (기본 8초)
      headers: {
        Authorization: `Bearer ${apiKey}`, // Bearer token auth (Bearer 토큰 인증)
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Fetch the active menu (items + categories) from Loyverse.
   * Maps Loyverse's `/items` and `/categories` endpoints into a normalized MenuResult.
   * (Loyverse에서 활성 메뉴 조회 — /items와 /categories를 정규화된 MenuResult로 변환)
   *
   * @param {object} [options]
   * @param {number} [options.limit=250]  — max items per page, Loyverse max is 250 (페이지당 최대 항목 수)
   * @returns {Promise<import('./interface.js').MenuResult>}
   */
  async getMenu(options = {}) {
    const limit = options.limit ?? 250; // Loyverse maximum page size (Loyverse 최대 페이지 크기)

    console.log(
      `[LoyverseAdapter] Fetching menu — limit: ${limit} ` +
      `(Loyverse 메뉴 조회 — 제한: ${limit})`
    );

    try {
      // Fetch items and categories in parallel for efficiency (효율적인 병렬 조회)
      const [itemsRes, categoriesRes] = await Promise.all([
        this._client.get('/items', { params: { limit } }),
        this._client.get('/categories', { params: { limit } }),
      ]);

      const rawItems      = itemsRes.data?.items ?? [];
      const rawCategories = categoriesRes.data?.categories ?? [];

      // Build category lookup map — O(1) access when building menu tree (O(1) 접근을 위한 카테고리 조회 맵 구성)
      const categoryMap = new Map(
        rawCategories.map((c) => [c.id, c.name])
      );

      // Normalize Loyverse item schema into flat MenuResult categories array
      // (Loyverse 항목 스키마를 정규화된 카테고리 배열로 변환)
      const categories = this._groupItemsByCategory(rawItems, categoryMap);

      console.log(
        `[LoyverseAdapter] Menu fetched — ${rawItems.length} items across ${categories.length} categories ` +
        `(메뉴 조회 완료 — 항목 ${rawItems.length}개, 카테고리 ${categories.length}개)`
      );

      return {
        success:    true,
        adapter:    this.adapterName,
        categories,
        fetchedAt:  new Date().toISOString(),
        meta: {
          totalItems:      rawItems.length,
          totalCategories: rawCategories.length,
        },
      };
    } catch (err) {
      // Wrap axios/network errors in PosError to keep caller interface clean (axios/네트워크 오류를 PosError로 래핑)
      throw this._wrapError('getMenu', err);
    }
  }

  /**
   * Submit an order to Loyverse via the /receipts endpoint.
   * Loyverse models completed sales as receipts, not open orders.
   * (Loyverse /receipts 엔드포인트로 주문 전송 — Loyverse는 완료된 판매를 영수증으로 모델링)
   *
   * @param {object} orderData    — normalized order from the queue worker (큐 워커의 정규화된 주문)
   * @param {object} storeContext — tenant store context (테넌트 스토어 컨텍스트)
   * @returns {Promise<import('./interface.js').PosOrderResult>}
   */
  async createOrder(orderData, storeContext) {
    console.log(
      `[LoyverseAdapter] Creating order ${orderData.orderId} for store ${storeContext.storeName} ` +
      `(주문 생성 — 주문 ID: ${orderData.orderId}, 스토어: ${storeContext.storeName})`
    );

    // Build Loyverse receipt payload from normalized order data (정규화된 주문 데이터로 Loyverse 영수증 페이로드 구성)
    const receiptPayload = this._buildReceiptPayload(orderData, storeContext);

    try {
      const response = await this._client.post('/receipts', receiptPayload);

      const receipt = response.data; // Loyverse returns the created receipt object (Loyverse는 생성된 영수증 객체 반환)

      console.log(
        `[LoyverseAdapter] Order ${orderData.orderId} → Loyverse receipt ${receipt.receipt_number} ` +
        `(주문 ${orderData.orderId} → Loyverse 영수증 ${receipt.receipt_number})`
      );

      return {
        success:      true,
        adapter:      this.adapterName,
        posOrderId:   receipt.receipt_number,          // Loyverse's unique receipt number (Loyverse 고유 영수증 번호)
        orderId:      orderData.orderId,               // Echo internal ID for correlation (내부 주문 ID 반환)
        status:       'submitted',
        submittedAt:  new Date().toISOString(),
        meta: {
          receiptId:    receipt.id,                    // Loyverse internal UUID (Loyverse 내부 UUID)
          source:       receipt.source ?? 'API',
        },
      };
    } catch (err) {
      // Wrap all Loyverse/network errors uniformly (모든 Loyverse/네트워크 오류 균일 래핑)
      throw this._wrapError('createOrder', err);
    }
  }

  // ── Private Helpers ──────────────────────────────────────────────────────────

  /**
   * Group flat Loyverse items into category buckets for the MenuResult shape.
   * (Loyverse 항목을 카테고리 버킷으로 그룹화하여 MenuResult 형태로 구성)
   *
   * @param {Array}  items       — raw Loyverse item objects (원시 Loyverse 항목 객체 배열)
   * @param {Map}    categoryMap — id → name lookup map (id → 이름 조회 맵)
   * @returns {Array}
   */
  _groupItemsByCategory(items, categoryMap) {
    const buckets = new Map(); // categoryId → { categoryName, items[] } (카테고리 ID → 버킷)

    for (const item of items) {
      const catId   = item.category_id ?? 'uncategorized';
      const catName = categoryMap.get(catId) ?? 'Uncategorized'; // Fallback label (폴백 레이블)

      if (!buckets.has(catId)) {
        buckets.set(catId, { categoryId: catId, categoryName: catName, items: [] });
      }

      // Normalize each item to a minimal common shape (각 항목을 최소 공통 형태로 정규화)
      buckets.get(catId).items.push({
        itemId:       item.id,
        name:         item.item_name,
        priceCents:   Math.round((item.variants?.[0]?.default_price ?? 0) * 100), // Loyverse stores prices in major units (Loyverse는 주요 통화 단위로 가격 저장)
        available:    item.track_stock === false || (item.variants?.[0]?.stores?.[0]?.available_for_sale ?? true),
      });
    }

    return Array.from(buckets.values()); // Return as ordered array (순서 있는 배열로 반환)
  }

  /**
   * Build a Loyverse-compatible receipt payload from the normalized order.
   * (정규화된 주문에서 Loyverse 호환 영수증 페이로드 구성)
   *
   * @param {object} orderData
   * @param {object} storeContext
   * @returns {object} Loyverse receipt request body (Loyverse 영수증 요청 본문)
   */
  _buildReceiptPayload(orderData, storeContext) {
    return {
      // Loyverse links receipts to a physical store via store_id (Loyverse는 store_id로 영수증을 실제 스토어에 연결)
      store_id: storeContext.loyverseStoreId ?? storeContext.agentId,

      // Line items — map normalized items to Loyverse line_items schema
      // (정규화된 항목을 Loyverse line_items 스키마로 매핑)
      line_items: (orderData.items ?? []).map((item) => ({
        item_id:     item.posItemId ?? item.itemId,    // POS-side item ID (POS 측 항목 ID)
        variant_id:  item.variantId ?? undefined,      // Optional variant (선택적 변형)
        quantity:    item.quantity ?? 1,
        price:       (item.priceCents ?? 0) / 100,     // Convert cents → major units (센트 → 주요 단위 변환)
        note:        item.note ?? undefined,
      })),

      // External reference — lets us correlate Loyverse receipt ↔ internal order
      // (외부 참조 — Loyverse 영수증과 내부 주문 상관 관계 설정)
      note: `JM-ORDER:${orderData.orderId}`,

      total_money: (orderData.totalAmountCents ?? 0) / 100, // Authoritative total (권위 있는 합계)
    };
  }

  /**
   * Wrap an axios or unknown error into a typed PosError with HTTP context.
   * (axios 또는 알 수 없는 오류를 HTTP 컨텍스트가 포함된 PosError로 래핑)
   *
   * @param {string} operation — method name where the error occurred (오류 발생 메서드명)
   * @param {Error}  err       — raw error to wrap (래핑할 원시 오류)
   * @returns {PosError}
   */
  _wrapError(operation, err) {
    const status = err.response?.status;                             // HTTP status from Loyverse (Loyverse HTTP 상태 코드)
    const detail = err.response?.data?.message ?? err.message;      // Loyverse error message (Loyverse 오류 메시지)
    const code   = status ? `LOYVERSE_HTTP_${status}` : 'LOYVERSE_NETWORK_ERROR';

    console.error(
      `[LoyverseAdapter] ${operation} failed — ${code}: ${detail} ` +
      `(${operation} 실패 — ${code}: ${detail})`
    );

    return new PosError(
      `[LoyverseAdapter] ${operation} failed: ${detail}`,
      this.adapterName,
      code,
      err
    );
  }
}
