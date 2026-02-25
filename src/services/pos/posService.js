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
import { supabase } from '../../config/supabase.js';

// Loyverse REST API base URL (Loyverse REST API 기본 URL)
const LOYVERSE_BASE_URL = 'https://api.loyverse.com/v1.0';

// Loyverse receipts endpoint (Loyverse 영수증 엔드포인트)
const RECEIPTS_ENDPOINT = `${LOYVERSE_BASE_URL}/receipts`;

// Loyverse items endpoint for catalog sync (카탈로그 동기화용 Loyverse 항목 엔드포인트)
const ITEMS_ENDPOINT = `${LOYVERSE_BASE_URL}/items`;

// HTTP request timeout for Loyverse API calls in milliseconds (Loyverse API 호출 HTTP 요청 타임아웃 밀리초)
const LOYVERSE_TIMEOUT_MS = parseInt(process.env.LOYVERSE_TIMEOUT_MS ?? '8000', 10);

// ── Payload Builder ───────────────────────────────────────────────────────────

/**
 * Map a single order item from our internal format to a Loyverse receipt line item.
 *
 * When a menuRecord is supplied (synced from Loyverse catalog), the real item_id,
 * variant_id, and unit price are used. Without a menuRecord (catalog not yet synced),
 * the unit price is approximated by dividing total_amount evenly across all units.
 *
 * (내부 형식의 단일 주문 항목을 Loyverse 영수증 라인 항목으로 매핑.
 *  menuRecord가 있으면 실제 item_id, variant_id, 단가 사용.
 *  없으면 total_amount를 전체 수량으로 균등 분배한 근사 단가 사용)
 *
 * @param {{ name: string, quantity: number }} item        — internal order item (내부 주문 항목)
 * @param {number}                             unitPrice   — fallback unit price when no catalog record (카탈로그 없을 때 폴백 단가)
 * @param {{ variant_id: string, item_id: string, price: number } | null} menuRecord
 *   — catalog record from menu_items table, or null if catalog not yet synced (menu_items 카탈로그 레코드 또는 null)
 * @returns {object} Loyverse receipt line_item object (Loyverse 영수증 라인 항목 객체)
 */
function mapItemToLineItem(item, unitPrice, menuRecord) {
  // Use catalog price when available, otherwise fall back to the evenly-split approximation
  // (카탈로그 가격이 있으면 사용, 없으면 균등 분배 근사값 폴백)
  const resolvedPrice = menuRecord?.price ?? unitPrice;
  const grossTotal    = parseFloat((resolvedPrice * item.quantity).toFixed(2));

  const lineItem = {
    item_name:          item.name,                             // Display label on the receipt (영수증 표시 레이블)
    quantity:           item.quantity,                         // Units ordered (주문 수량)
    price:              parseFloat(resolvedPrice.toFixed(2)),  // Unit price from catalog or approximation (카탈로그 또는 근사 단가)
    gross_total_money:  grossTotal,                            // quantity × unit price before discounts (할인 전 소계)
    total_money:        grossTotal,                            // Net line total — no discounts in MVP (순 라인 합계 — MVP 할인 없음)
  };

  // Include real Loyverse IDs when the catalog has been synced — required for production receipts
  // (카탈로그 동기화 시 실제 Loyverse ID 포함 — 프로덕션 영수증에 필수)
  if (menuRecord?.variant_id) lineItem.variant_id = menuRecord.variant_id;
  if (menuRecord?.item_id)    lineItem.item_id    = menuRecord.item_id;

  return lineItem;
}

/**
 * Build the full Loyverse POST /receipts payload from our order data.
 *
 * When menuLookup is provided, each line item is matched by name (case-insensitive)
 * to a catalog record and uses the real variant_id, item_id, and price.
 * When menuLookup is null (catalog not yet synced), prices are approximated.
 *
 * (주문 데이터에서 Loyverse POST /receipts 전체 페이로드 생성.
 *  menuLookup이 있으면 항목명(대소문자 무시)으로 카탈로그 레코드 매칭 후 실제 ID·가격 사용.
 *  없으면 총액 균등 분배 근사값 사용)
 *
 * @param {object}   orderData  — full order row from Supabase (Supabase의 전체 주문 행)
 * @param {Map|null} menuLookup — lowercase name → menu record map, or null (소문자 이름 → 메뉴 레코드 맵 또는 null)
 * @returns {object} Loyverse receipt request body (Loyverse 영수증 요청 바디)
 */
function buildReceiptPayload(orderData, menuLookup) {
  const items      = orderData.items ?? [];
  const totalUnits = items.reduce((sum, i) => sum + (i.quantity ?? 1), 0);
  const totalAmount = parseFloat(orderData.total_amount ?? 0);

  // Fallback unit price — evenly distributed across all units (폴백 단가 — 전체 수량에 균등 분배)
  const unitPrice = totalUnits > 0 ? totalAmount / totalUnits : 0;

  const lineItems = items.map((item) => {
    // Case-insensitive name lookup in the catalog map (카탈로그 맵에서 대소문자 무시 이름 조회)
    const key        = item.name?.toLowerCase()?.trim() ?? '';
    const menuRecord = menuLookup?.get(key) ?? null;
    return mapItemToLineItem(item, unitPrice, menuRecord);
  });

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
 * Fetches the menu_items catalog for the store before building the payload so that
 * real variant_id and item_id values are included in each line item. Falls back to
 * price approximation when no catalog rows exist (catalog not yet synced).
 *
 * Uses the dynamic storeApiKey (Bearer token) fetched from the stores table —
 * never reads from .env so different tenants can each have their own Loyverse token.
 *
 * On success: logs the Loyverse receipt number and returns the response data.
 * On failure: logs the full error detail and returns null — callers must not crash.
 *
 * (POST /receipts를 통해 결제 완료 주문을 Loyverse POS에 주입.
 *  페이로드 생성 전 매장의 menu_items 카탈로그 조회 → 실제 variant_id, item_id 포함.
 *  카탈로그 미동기화 시 단가 근사값 폴백.
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

  // Fetch menu_items for this store to resolve variant_id and item_id per line item
  // (라인 항목별 variant_id, item_id 조회를 위해 이 매장의 menu_items 조회)
  let menuLookup = null;
  const { data: menuItems } = await supabase
    .from('menu_items')
    .select('variant_id, item_id, name, price')
    .eq('store_id', orderData.store_id);

  if (menuItems?.length) {
    // Build a lowercase name → menu record map for O(1) lookup per line item
    // (라인 항목당 O(1) 조회를 위한 소문자 이름 → 메뉴 레코드 맵 생성)
    menuLookup = new Map(
      menuItems.map((m) => [m.name.toLowerCase().trim(), m])
    );
    console.log(
      `[PosService] Menu catalog loaded | store: ${orderData.store_id} | items: ${menuLookup.size} ` +
      `(메뉴 카탈로그 로드 | 매장: ${orderData.store_id} | 항목 수: ${menuLookup.size})`
    );
  } else {
    // No catalog rows — variant_id will be omitted; run /api/pos/sync/:storeId first
    // (카탈로그 없음 — variant_id 생략. 먼저 /api/pos/sync/:storeId 실행 필요)
    console.warn(
      `[PosService] No menu_items found for store ${orderData.store_id} — ` +
      `sending receipt without variant_id. Run /api/pos/sync/:storeId to fix. ` +
      `(menu_items 없음 — variant_id 없이 영수증 전송 | 매장: ${orderData.store_id})`
    );
  }

  const payload = buildReceiptPayload(orderData, menuLookup);

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
 * Synchronise the Loyverse item catalog into the local menu_items table and
 * write a formatted menu_cache string to the stores row for fast LLM access.
 *
 * Called manually via GET /api/pos/sync/:storeId or on a schedule.
 * Safe to call repeatedly — upserts on (store_id, variant_id) are idempotent.
 *
 * (Loyverse 항목 카탈로그를 로컬 menu_items 테이블에 동기화하고
 *  LLM 빠른 접근을 위해 stores 행에 형식화된 menu_cache 문자열 작성.
 *  GET /api/pos/sync/:storeId 또는 스케줄러로 수동 호출.
 *  반복 호출 안전 — (store_id, variant_id) 업서트는 멱등성 보장)
 *
 * @param {string} storeId     — store UUID from the stores table (stores 테이블의 매장 UUID)
 * @param {string} storeApiKey — Loyverse Bearer token from stores.pos_api_key (stores.pos_api_key의 Bearer 토큰)
 * @returns {Promise<{ success: boolean, synced?: number, itemCount?: number, error?: string }>}
 */
export async function syncMenuFromLoyverse(storeId, storeApiKey) {
  console.log(
    `[PosService] syncMenuFromLoyverse start | store: ${storeId} ` +
    `(Loyverse 메뉴 동기화 시작 | 매장: ${storeId})`
  );

  if (!storeApiKey) {
    // Cannot authenticate without an API key — abort and surface the error to the caller
    // (API 키 없이 인증 불가 — 중단 후 호출자에게 오류 노출)
    console.error(
      `[PosService] syncMenuFromLoyverse aborted — storeApiKey missing | store: ${storeId} ` +
      `(동기화 중단 — storeApiKey 누락 | 매장: ${storeId})`
    );
    return { success: false, error: 'Missing POS API key' };
  }

  const cleanApiKey = storeApiKey.trim();

  // ── Step 1: Fetch all items from Loyverse catalog ──────────────────────────
  // GET /v1.0/items?limit=250 — returns up to 250 items per page (MVP: single page)
  // (GET /v1.0/items?limit=250 — 페이지당 최대 250개 항목 반환 | MVP: 단일 페이지)
  let loyverseItems;
  try {
    const response = await axios.get(`${ITEMS_ENDPOINT}?limit=250`, {
      timeout: LOYVERSE_TIMEOUT_MS,
      headers: {
        Authorization:  `Bearer ${cleanApiKey}`, // Trimmed per-tenant token (공백 제거된 테넌트별 토큰)
        'Content-Type': 'application/json',
      },
    });
    loyverseItems = response.data?.items ?? [];
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data ?? err.message;
    console.error(
      `[PosService] syncMenuFromLoyverse fetch failed | store: ${storeId} | ` +
      `HTTP: ${status ?? 'N/A'} | detail: ${JSON.stringify(detail)} ` +
      `(Loyverse 항목 조회 실패 | 매장: ${storeId})`
    );
    return { success: false, error: `Loyverse fetch failed: ${err.message}` };
  }

  console.log(
    `[PosService] syncMenuFromLoyverse fetched | store: ${storeId} | items: ${loyverseItems.length} ` +
    `(Loyverse 항목 조회 완료 | 매장: ${storeId} | 항목 수: ${loyverseItems.length})`
  );

  // ── Step 2: Flatten item → variants into upsertable rows ──────────────────
  // Each Loyverse item has one or more variants (size, style, etc.).
  // We store one row per variant so variant_id is available for receipt injection.
  // (각 Loyverse 항목은 하나 이상의 변형(크기, 스타일 등)을 가짐.
  //  영수증 주입에 variant_id를 사용할 수 있도록 변형당 하나의 행 저장)
  const rows = [];
  for (const item of loyverseItems) {
    const variants = item.variants ?? [];
    for (const variant of variants) {
      rows.push({
        store_id:   storeId,
        item_id:    item.id,                         // Loyverse item UUID (Loyverse 항목 UUID)
        variant_id: variant.variant_id,              // Loyverse variant UUID for receipt line items (영수증 라인 항목용 UUID)
        name:       item.item_name,                  // Display name used to match order items (주문 항목 매칭에 사용되는 표시명)
        price:      parseFloat(variant.default_price ?? variant.price ?? 0),  // Loyverse stores unit price in default_price; fall back to price for safety (Loyverse는 단가를 default_price에 저장 — 안전을 위해 price로 폴백)
        category:   item.category_id ?? null,        // Optional category ID for filtering (선택적 카테고리 ID)
      });
    }
  }

  if (rows.length === 0) {
    // Loyverse returned items but none had variants — unusual; log and return early
    // (Loyverse가 항목을 반환했지만 변형이 없음 — 비정상 상태 — 로깅 후 조기 반환)
    console.warn(
      `[PosService] syncMenuFromLoyverse | no variants found in ${loyverseItems.length} items | store: ${storeId} ` +
      `(변형 없음 — ${loyverseItems.length}개 항목에서 변형 미발견 | 매장: ${storeId})`
    );
    return { success: true, synced: 0, itemCount: loyverseItems.length };
  }

  // ── Step 3: Upsert into menu_items ─────────────────────────────────────────
  // onConflict targets variant_id — the unique constraint defined on the table.
  // Repeated syncs safely overwrite name, price, and category without inserting duplicates.
  // (onConflict는 테이블에 정의된 고유 제약 조건인 variant_id를 대상으로 함.
  //  반복 동기화 시 중복 삽입 없이 name, price, category를 안전하게 덮어씀)
  const { error: upsertError } = await supabase
    .from('menu_items')
    .upsert(rows, { onConflict: 'variant_id' });

  if (upsertError) {
    console.error(
      `[PosService] syncMenuFromLoyverse upsert failed | store: ${storeId} | ${upsertError.message} ` +
      `(menu_items 업서트 실패 | 매장: ${storeId} | 오류: ${upsertError.message})`
    );
    return { success: false, error: `DB upsert failed: ${upsertError.message}` };
  }

  console.log(
    `[PosService] syncMenuFromLoyverse upserted | store: ${storeId} | rows: ${rows.length} ` +
    `(menu_items 업서트 완료 | 매장: ${storeId} | 행 수: ${rows.length})`
  );

  // ── Step 4: Build and cache the LLM menu_cache string ─────────────────────
  // A deduplicated, human-readable menu list written to stores.menu_cache so the
  // WebSocket server can embed it in the Gemini system prompt without a DB round-trip.
  // Deduplication prevents duplicate lines when an item has multiple variants.
  // (중복 제거된 사람이 읽을 수 있는 메뉴 목록을 stores.menu_cache에 작성.
  //  WebSocket 서버가 DB 왕복 없이 Gemini 시스템 프롬프트에 포함 가능.
  //  항목에 여러 변형이 있는 경우 중복 줄 방지)
  const priceByName = {};
  for (const r of rows) {
    // Use the lowest variant price as the representative display price (표시 가격으로 최저 변형 가격 사용)
    if (priceByName[r.name] == null || r.price < priceByName[r.name]) {
      priceByName[r.name] = r.price;
    }
  }
  const menuCache = Object.entries(priceByName)
    .map(([name, price]) => `${name} - $${price.toFixed(2)}`)  // Dollar sign for US market; toFixed(2) ensures consistent decimal format (미국 시장용 달러 기호 — toFixed(2)로 소수점 형식 통일)
    .join('\n');

  const { error: cacheError } = await supabase
    .from('stores')
    .update({ menu_cache: menuCache })
    .eq('id', storeId);

  if (cacheError) {
    // Non-fatal — menu_items are already upserted; LLM will use menu_cache on next sync
    // (치명적이지 않음 — menu_items는 이미 업서트됨 — 다음 동기화 시 LLM이 menu_cache 사용)
    console.error(
      `[PosService] syncMenuFromLoyverse cache write failed | store: ${storeId} | ${cacheError.message} ` +
      `(menu_cache 쓰기 실패 — 치명적이지 않음 | 매장: ${storeId})`
    );
  } else {
    console.log(
      `[PosService] syncMenuFromLoyverse menu_cache updated | store: ${storeId} | ` +
      `${Object.keys(priceByName).length} unique items ` +
      `(menu_cache 업데이트 완료 | 매장: ${storeId} | 고유 항목: ${Object.keys(priceByName).length}개)`
    );
  }

  return { success: true, synced: rows.length, itemCount: loyverseItems.length };
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
