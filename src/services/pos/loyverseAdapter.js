// LoyverseAdapter — service-layer Loyverse client for the Direct-to-DB sync engine.
// Distinct from src/adapters/pos/loyverse.js (runtime order adapter used by the queue worker):
// this class is used exclusively by posSyncService.js to pull raw POS catalog data.
// Exposes three methods: fetchItems(), fetchCategories(), fetchInventoryLevels().
// Returns a standardized JSON format regardless of POS provider so the sync engine stays provider-agnostic.
// (Direct-to-DB 동기화 엔진을 위한 서비스 계층 Loyverse 클라이언트.
//  런타임 주문 어댑터(src/adapters/pos/loyverse.js)와 구별:
//  이 클래스는 posSyncService.js 전용으로 원시 POS 카탈로그 데이터 조회에 사용됨.
//  fetchItems(), fetchCategories(), fetchInventoryLevels() 세 메서드를 제공.
//  동기화 엔진이 공급자에 독립적이 되도록 표준화된 JSON 형식 반환)

import axios from 'axios';

// Loyverse REST API base URL — v1.0 (Loyverse REST API 기본 URL)
const LOYVERSE_BASE_URL = 'https://api.loyverse.com/v1.0';

// HTTP timeout for catalog fetch calls — configurable via env (카탈로그 조회 HTTP 타임아웃 — 환경 변수로 설정 가능)
const LOYVERSE_TIMEOUT_MS = parseInt(process.env.LOYVERSE_TIMEOUT_MS ?? '8000', 10);

export class LoyverseAdapter {
  /**
   * Construct the adapter with a Loyverse Bearer token.
   * Throws immediately if apiKey is missing so every caller fails fast.
   * (Loyverse Bearer 토큰으로 어댑터 생성. apiKey 누락 시 즉시 예외 — 조기 실패)
   *
   * @param {string} apiKey — Loyverse per-tenant Bearer access token (테넌트별 Loyverse Bearer 액세스 토큰)
   */
  constructor(apiKey) {
    if (!apiKey) {
      // Fail fast — without a key every request will 401 (API 키 없으면 모든 요청 401 — 조기 실패)
      throw new Error(
        '[LoyverseAdapter] apiKey is required — cannot fetch catalog without a valid Bearer token. ' +
        '(apiKey 필수 — 유효한 Bearer 토큰 없이 카탈로그 조회 불가)'
      );
    }

    // Aggressively clean the API key before placing it in the Authorization header.
    // Step 1: String() coerces non-string inputs (e.g. Buffer, number) to string.
    // Step 2: replace(/[\n\r\t]/g) removes embedded newline/carriage-return/tab characters
    //         that survive a plain .trim() because they appear in the middle of the value.
    // Step 3: .trim() removes any remaining leading/trailing whitespace.
    // This three-step pattern prevents ALL "Invalid character in header content" errors
    // caused by stray control characters stored in the Supabase DB.
    // (Authorization 헤더에 넣기 전 API 키를 강도 높게 정리.
    //  1단계: String()으로 비문자열 입력 강제 변환.
    //  2단계: replace(/[\n\r\t]/g)로 평범한 .trim()이 처리 못하는 중간의 줄바꿈/탭 제거.
    //  3단계: .trim()으로 나머지 앞뒤 공백 제거.
    //  이 3단계 패턴으로 Supabase DB에 저장된 제어 문자로 인한
    //  모든 "Invalid character in header content" 오류 방지)
    const cleanKey = String(apiKey).replace(/[\n\r\t]/g, '').trim();

    // Warn when the raw and cleaned values differ — confirms DB value had hidden characters
    // (원본과 정리된 값이 다르면 경고 — DB 값에 숨겨진 문자가 있음을 확인)
    if (cleanKey.length !== String(apiKey).length) {
      console.warn(
        `[LoyverseAdapter] apiKey contained control/whitespace characters — stripped before use. ` +
        `raw length: ${String(apiKey).length} → clean length: ${cleanKey.length} ` +
        `(apiKey에 제어/공백 문자 포함 — 사용 전 제거 완료. 원본 길이: ${String(apiKey).length} → 정리 후: ${cleanKey.length})`
      );
    }

    // Pre-configure a shared axios instance with the clean auth header and base URL.
    // (정리된 인증 헤더와 기본 URL로 공유 axios 인스턴스 사전 구성)
    this._client = axios.create({
      baseURL: LOYVERSE_BASE_URL,
      timeout: LOYVERSE_TIMEOUT_MS,
      headers: {
        Authorization:  `Bearer ${cleanKey}`, // cleanKey is guaranteed whitespace-free (cleanKey는 공백 없음이 보장됨)
        'Content-Type': 'application/json',
      },
    });

    console.log(
      '[LoyverseAdapter] Initialized catalog adapter — ready to fetch items, categories, and inventory levels. ' +
      '(카탈로그 어댑터 초기화 완료 — 항목, 카테고리, 재고 수준 조회 준비 완료)'
    );
  }

  // ── fetchItems ──────────────────────────────────────────────────────────────

  /**
   * Fetch all active items from Loyverse GET /items (full catalog pull).
   * Always fetches the complete catalog — no differential filtering via updated_at_min.
   * This guarantees pos_items is fully populated on every sync run.
   * Each Loyverse item is returned with its variants; syncManager handles flattening.
   * stock_quantity is extracted from variant.stores[0].in_stock — the per-store
   * inventory level Loyverse embeds inside each variant's stores array.
   * Untracked variants fall back to 0 (see storeEntry resolution below).
   * (Loyverse GET /items에서 모든 활성 항목 조회 — 전체 카탈로그.
   *  updated_at_min 차등 필터링 없음 — 매 동기화 실행 시 pos_items 완전 채워짐 보장.
   *  각 항목은 변형을 포함하여 반환 — 평탄화는 syncManager가 처리.
   *  stock_quantity는 variant.stores[]에 포함된 stores[0].in_stock에서 추출.
   *  미추적 변형은 0으로 폴백)
   *
   * @returns {Promise<StandardizedItem[]>} standardized item array (표준화된 항목 배열)
   */
  async fetchItems() {
    // Always fetch the full catalog — no updated_at_min filter applied.
    // Full fetch guarantees pos_items is populated on every run without edge-case gaps.
    // (항상 전체 카탈로그 조회 — updated_at_min 필터 미적용.
    //  전체 조회로 매 실행 시 pos_items가 빠짐없이 채워짐 보장)
    const endpoint = '/items?limit=250';

    console.log(
      `[LoyverseAdapter] fetchItems — calling GET ${endpoint} (full catalog) ` +
      `(GET ${endpoint} 호출 중 — 전체 카탈로그)`
    );

    let rawItems;
    try {
      const response = await this._client.get(endpoint);
      rawItems = response.data?.items ?? [];
    } catch (err) {
      // Surface HTTP and network errors with full context for debugging (디버깅을 위해 HTTP 및 네트워크 오류 전체 컨텍스트 노출)
      const status = err.response?.status;
      const detail = err.response?.data ?? err.message;
      throw new Error(
        `[LoyverseAdapter] fetchItems failed | HTTP: ${status ?? 'N/A'} | ${JSON.stringify(detail)} ` +
        `(fetchItems 실패 | HTTP: ${status ?? 'N/A'})`
      );
    }

    console.log(
      `[LoyverseAdapter] fetchItems — raw items received: ${rawItems.length} (full catalog) ` +
      `(원시 항목 수신 완료: ${rawItems.length}개 — 전체 카탈로그)`
    );

    // Standardize each Loyverse item into our provider-agnostic shape.
    // Each item is returned as-is (not exploded by variant) — syncManager handles variant flattening.
    // (각 Loyverse 항목을 공급자 독립적 형태로 표준화.
    //  항목은 변형별로 분해되지 않고 그대로 반환 — 변형 평탄화는 syncManager가 처리)
    return rawItems.map((item) => ({
      pos_item_id:  item.id,                        // Loyverse item UUID (Loyverse 항목 UUID)
      name:         item.item_name,                 // Display name (표시명)
      category_id:  item.category_id ?? null,       // Category UUID for later lookup (카테고리 UUID)
      color:        item.color ?? null,             // Optional item color (선택적 항목 색상)
      description:  item.description ?? null,       // Loyverse item description, may be null (Loyverse 항목 설명, null 가능)
      variants:     (item.variants ?? []).map((v) => {
        // Extract the first store entry — contains both the price override and the inventory level.
        // Loyverse embeds per-store data in variant.stores[]; index 0 is the primary store.
        // (가격 재정의와 재고 수준을 모두 포함하는 첫 번째 매장 항목 추출.
        //  Loyverse는 variant.stores[]에 매장별 데이터를 포함; 인덱스 0이 기본 매장)
        const storeEntry  = (v.stores && v.stores.length > 0) ? v.stores[0] : null;

        // Price resolution: store-specific override → variant default_price → 0.
        // (가격 결정: 매장별 재정의 → 변형 기본 가격 → 0 순서)
        const price = (storeEntry?.price !== null && storeEntry?.price !== undefined)
          ? storeEntry.price
          : (v.default_price || 0);

        // Inventory: in_stock is the on-hand quantity in the primary store.
        // Fallback to 0 when the item is not tracked or no store entry is present —
        // ensures downstream tables always receive a numeric value for stock display.
        // (재고: in_stock은 기본 매장의 현재 보유 수량.
        //  항목이 추적되지 않거나 매장 항목이 없으면 0으로 폴백 — 다운스트림 테이블이 항상 숫자 값 수신 보장)
        const stockQty = storeEntry?.in_stock ?? 0;

        return {
          variant_id:     v.variant_id,              // Loyverse variant UUID — unique per item option (Loyverse 변형 UUID — 옵션당 고유)
          sku:            v.sku ?? null,             // Stock-keeping unit code (재고 관리 코드)
          option_value:   v.option1_value ?? null,   // Variant label (e.g. "Large", "Small") (변형 레이블)
          price:          parseFloat(price),         // Resolved price: store override → default (확정 가격: 매장별 → 기본값)
          stock_quantity: stockQty,                  // On-hand inventory from Loyverse; 0 when item is untracked (Loyverse 재고 수량 — 미추적 항목은 0)
        };
      }),
      raw: item, // Full Loyverse payload preserved for sync_metadata (sync_metadata 보존용 원본 Loyverse 페이로드)
    }));
  }

  // ── fetchCategories ─────────────────────────────────────────────────────────

  /**
   * Fetch all categories from Loyverse GET /categories.
   * Returned as a standardized array so syncManager can build a category name lookup
   * without any knowledge of the Loyverse payload shape.
   * (Loyverse GET /categories에서 모든 카테고리 조회.
   *  syncManager가 Loyverse 페이로드 형태를 알지 못해도
   *  카테고리명 조회를 구성할 수 있도록 표준화된 배열로 반환)
   *
   * @returns {Promise<StandardizedCategory[]>} standardized category array (표준화된 카테고리 배열)
   */
  async fetchCategories() {
    console.log(
      '[LoyverseAdapter] fetchCategories — calling GET /categories ' +
      '(GET /categories 호출 중)'
    );

    let rawCategories;
    try {
      const response = await this._client.get('/categories');
      rawCategories = response.data?.categories ?? [];
    } catch (err) {
      // Non-fatal: category names are decorative; log and return empty instead of aborting
      // (치명적이지 않음: 카테고리명은 보조적 — 중단 대신 빈 배열 반환 후 로깅)
      const status = err.response?.status;
      console.warn(
        `[LoyverseAdapter] fetchCategories failed — continuing without categories | HTTP: ${status ?? 'N/A'} | ${err.message} ` +
        `(카테고리 조회 실패 — 카테고리 없이 계속 | HTTP: ${status ?? 'N/A'})`
      );
      return [];
    }

    console.log(
      `[LoyverseAdapter] fetchCategories — received: ${rawCategories.length} ` +
      `(카테고리 수신 완료: ${rawCategories.length}개)`
    );

    // Standardize each Loyverse category (Loyverse 카테고리 표준화)
    return rawCategories.map((c) => ({
      pos_category_id: c.id,            // Loyverse category UUID (Loyverse 카테고리 UUID)
      name:            c.name,          // Display name for category label in menu_items (menu_items 카테고리 레이블 표시명)
      color:           c.color ?? null, // Optional accent color (선택적 강조 색상)
    }));
  }

  // ── fetchInventoryLevels ─────────────────────────────────────────────────────

  /**
   * Fetch all inventory levels from Loyverse GET /inventory (correct v1.0 endpoint).
   * Note: The path is /inventory, NOT /inventory_levels — the latter returns 404 in
   * Loyverse API v1.0. The response payload still uses the key "inventory_levels".
   * This is the authoritative source for on-hand stock quantities — more reliable
   * than the embedded stores[0].in_stock inside the /items response, which can be
   * absent or stale when inventory tracking is toggled per item.
   * Non-fatal: a network failure returns [] and the caller falls back to the
   * stock_quantity already embedded in each variant from fetchItems().
   * (Loyverse GET /inventory에서 모든 재고 수준 조회 (올바른 v1.0 엔드포인트).
   *  참고: 경로는 /inventory이며 /inventory_levels가 아님 — 후자는 v1.0에서 404 반환.
   *  응답 페이로드는 여전히 "inventory_levels" 키를 사용함.
   *  이는 현재 보유 재고 수량의 권위 있는 소스 — /items의 embedded stores[0].in_stock보다 신뢰성 높음.
   *  치명적이지 않음: 네트워크 실패 시 [] 반환, 호출자는 fetchItems()의 embedded 값으로 폴백)
   *
   * @returns {Promise<StandardizedInventoryLevel[]>} standardized inventory level array (표준화된 재고 수준 배열)
   */
  async fetchInventoryLevels() {
    // Correct Loyverse API v1.0 path: /inventory (not /inventory_levels which yields 404).
    // (올바른 Loyverse API v1.0 경로: /inventory — /inventory_levels는 404 반환)
    const endpoint = '/inventory?limit=250';

    console.log(
      `[LoyverseAdapter] fetchInventoryLevels — calling GET ${endpoint} ` +
      `(GET ${endpoint} 호출 중 — 전체 재고 수준)`
    );

    let rawLevels;
    try {
      const response = await this._client.get(endpoint);
      // Response key is "inventory_levels" even though the path is /inventory
      // (응답 키는 경로가 /inventory여도 "inventory_levels"를 사용)
      rawLevels = response.data?.inventory_levels ?? [];
    } catch (err) {
      // Non-fatal — fall back to embedded stores data; sync can still complete without this
      // (치명적이지 않음 — embedded stores 데이터로 폴백; 이 데이터 없이도 동기화 완료 가능)
      const status = err.response?.status;
      console.warn(
        `[LoyverseAdapter] fetchInventoryLevels failed — falling back to embedded stores data | HTTP: ${status ?? 'N/A'} | ${err.message} ` +
        `(재고 수준 조회 실패 — embedded stores 데이터로 폴백 | HTTP: ${status ?? 'N/A'})`
      );
      return [];
    }

    console.log(
      `[LoyverseAdapter] fetchInventoryLevels — received: ${rawLevels.length} level(s) ` +
      `(재고 수준 수신 완료: ${rawLevels.length}개)`
    );

    // Standardize each inventory level row (각 재고 수준 행 표준화)
    return rawLevels.map((level) => ({
      variant_id: level.variant_id,        // Loyverse variant UUID — join key (Loyverse 변형 UUID — 조인 키)
      store_id:   level.store_id ?? null,  // Loyverse store UUID (Loyverse 매장 UUID)
      in_stock:   level.in_stock  ?? 0,    // On-hand quantity; 0 when null (현재 보유 수량; null이면 0)
    }));
  }
}
