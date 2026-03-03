// syncManager — orchestrates Expert Mode (Method B) POS-to-staging-to-menu pipeline.
// Architecture: Loyverse → pos_items (staging) → menu_items (AI-ready).
// The two-stage design protects menu_items from direct raw POS overwrites:
// operators review pos_items staging data and selectively promote records to menu_items
// with optional AI-specific name and description overrides.
// (전문가 모드(방법 B) POS-스테이징-메뉴 파이프라인 조율.
//  아키텍처: Loyverse → pos_items(스테이징) → menu_items(AI 준비).
//  2단계 설계로 menu_items를 직접 POS 원시 덮어쓰기로부터 보호:
//  운영자가 pos_items 스테이징 데이터를 검토 후
//  선택적으로 AI 전용 이름/설명 재정의와 함께 menu_items로 승격)

import { supabase }          from '../config/supabase.js';
import { LoyverseAdapter }   from './pos/loyverseAdapter.js';
import axios                 from 'axios';

// ── writeSyncLog ──────────────────────────────────────────────────────────────

/**
 * Insert a non-fatal audit record into the sync_logs table.
 * Called exclusively from the try...finally blocks in syncPosToStaging and
 * syncCustomersFromPos — guaranteed to run regardless of success, failure, or
 * early return in those functions.
 * Failures are swallowed silently — logging never aborts a sync.
 * (sync_logs 테이블에 치명적이지 않은 감사 레코드 삽입.
 *  syncPosToStaging과 syncCustomersFromPos의 try...finally 블록에서만 호출 —
 *  성공, 실패, 조기 반환에 관계없이 실행 보장.
 *  실패는 조용히 삼킴 — 로깅이 동기화를 중단하지 않음)
 *
 * @param {string}                 storeId          — store UUID (매장 UUID)
 * @param {'items'|'customers'}    syncType         — which pipeline emitted this record (이 레코드를 생성한 파이프라인)
 * @param {'success'|'failed'}     status           — outcome of the sync attempt (동기화 결과)
 * @param {number|null}            [itemsProcessed] — rows written on success; null on failure (성공 시 작성된 행 수 — 실패 시 null)
 * @param {string|null}            [errorMsg]       — error detail on failure; null on success (실패 시 오류 상세 — 성공 시 null)
 */
async function writeSyncLog(storeId, syncType, status, itemsProcessed = null, errorMsg = null) {
  try {
    await supabase.from('sync_logs').insert({
      store_id:        storeId,
      sync_type:       syncType,                  // 'items' or 'customers' — identifies the pipeline ('items' 또는 'customers' — 파이프라인 식별)
      status,                                     // 'success' or 'failed' (성공 또는 실패)
      items_processed: itemsProcessed,            // Rows written on success; null on failure (성공 시 작성된 행 수 — 실패 시 null)
      error_message:   errorMsg,
      created_at:      new Date().toISOString(),  // Explicit timestamp for sort accuracy (정렬 정확도를 위한 명시적 타임스탬프)
    });
  } catch (logErr) {
    // Log write failure is non-fatal — never abort a sync because of logging (로그 쓰기 실패는 치명적이지 않음 — 로깅 때문에 동기화 중단 금지)
    console.warn(
      `[SyncManager] writeSyncLog failed | store: ${storeId} | type: ${syncType} | ${logErr.message} ` +
      `(동기화 로그 쓰기 실패 | 매장: ${storeId} | 유형: ${syncType} | 오류: ${logErr.message})`
    );
  }
}

// ── syncPosToStaging ─────────────────────────────────────────────────────────

/**
 * Pull the full Loyverse item catalog for a store and write it to pos_items (staging).
 *
 * Steps:
 *   1. Load the store row to obtain pos_api_key.
 *   2. Fetch all items + categories concurrently via LoyverseAdapter (full fetch, no filter).
 *   3. Build category-name lookup map (pos_category_id → name).
 *   4. Flatten item × variants into staging rows with category_name + sync_metadata.
 *   5. Upsert into pos_items on (store_id, pos_item_id, variant_id) — idempotent.
 *
 * A try...finally block guarantees that writeSyncLog is called at every exit point —
 * including early returns — so the audit trail is always complete.
 *
 * (스토어의 전체 Loyverse 항목 카탈로그를 가져와 pos_items(스테이징)에 저장.
 *  단계: 1. pos_api_key 조회, 2. 전체 항목+카테고리 병렬 조회(필터 없음),
 *  3. 카테고리명 조회 맵 구성, 4. 항목×변형을 스테이징 행으로 평탄화, 5. 멱등 upsert.
 *  try...finally 블록으로 모든 종료 지점에서 writeSyncLog 호출 보장 — 조기 반환 포함)
 *
 * @param {string} storeId — store UUID from the stores table (stores 테이블의 매장 UUID)
 * @returns {Promise<SyncResult>}
 */
export async function syncPosToStaging(storeId) {
  console.log(
    `[SyncManager] syncPosToStaging start | store: ${storeId} ` +
    `(POS 스테이징 동기화 시작 | 매장: ${storeId})`
  );

  // Audit log tracking — default to 'failed' so any unhandled early exit is recorded correctly.
  // logStatus/logCount/logError are written to sync_logs in the finally block.
  // (감사 로그 추적 — 처리되지 않은 조기 종료도 올바르게 기록되도록 기본값 'failed'.
  //  logStatus/logCount/logError는 finally 블록에서 sync_logs에 기록)
  let logStatus = 'failed';
  let logCount  = null;
  let logError  = null;

  try {

    // ── Step 1: Load store row — obtain pos_api_key ──────────────────────────
    // (pos_api_key 획득을 위한 매장 행 로드)
    const { data: store, error: storeErr } = await supabase
      .from('stores')
      .select('id, name, pos_api_key')
      .eq('id', storeId)
      .single();

    if (storeErr || !store) {
      // Store lookup failed — abort with a clear error for the caller (매장 조회 실패 — 호출자에게 명확한 오류 반환)
      logError = storeErr?.message ?? 'Store not found';
      console.error(
        `[SyncManager] syncPosToStaging | store lookup failed | store: ${storeId} | ${logError} ` +
        `(매장 조회 실패 | 매장: ${storeId} | 오류: ${logError})`
      );
      return { success: false, error: logError };
    }

    if (!store.pos_api_key) {
      // A missing API key makes every Loyverse request unauthenticated — abort early
      // (API 키 누락 시 모든 Loyverse 요청이 인증 실패 — 조기 중단)
      logError = 'Store has no POS API key configured';
      console.error(
        `[SyncManager] syncPosToStaging aborted — no pos_api_key | store: ${storeId} ` +
        `(동기화 중단 — pos_api_key 없음 | 매장: ${storeId})`
      );
      return { success: false, error: logError };
    }

    // ── Step 2: Fetch all items and categories concurrently (full catalog) ───
    // Full fetch — no updated_at_min filter — guarantees pos_items is fully populated.
    // Concurrent fetch halves the round-trip time vs. sequential calls.
    // (전체 조회 — updated_at_min 필터 없음 — pos_items 완전 채워짐 보장.
    //  병렬 조회로 순차 호출 대비 왕복 시간 절반 단축)
    const adapter = new LoyverseAdapter(store.pos_api_key);

    let items, categories;
    try {
      [items, categories] = await Promise.all([
        adapter.fetchItems(),       // Full catalog fetch — no differential filter (전체 카탈로그 조회 — 차등 필터 없음)
        adapter.fetchCategories(),
      ]);
    } catch (err) {
      // Loyverse API error — return structured failure so the route can respond with 500
      // (Loyverse API 오류 — 라우트가 500 응답할 수 있도록 구조화된 실패 반환)
      logError = err.message;
      console.error(
        `[SyncManager] syncPosToStaging Loyverse fetch error | store: ${storeId} | ${err.message} ` +
        `(Loyverse 조회 오류 | 매장: ${storeId} | 오류: ${err.message})`
      );
      return { success: false, error: err.message };
    }

    console.log(
      `[SyncManager] syncPosToStaging fetched | store: ${storeId} | items: ${items.length} | categories: ${categories.length} ` +
      `(조회 완료 | 매장: ${storeId} | 항목: ${items.length}개 | 카테고리: ${categories.length}개)`
    );

    // ── Step 3: Build category lookup map ───────────────────────────────────
    // Map pos_category_id → category name so each item row gets a human-readable label.
    // fetchCategories() returns [] on failure so the map is always safe to build.
    // (pos_category_id → 카테고리명 맵 구성 — 각 항목 행에 사람이 읽을 수 있는 레이블 제공.
    //  fetchCategories()는 실패 시 [] 반환하므로 맵 구성은 항상 안전)
    const catMap = new Map(categories.map((c) => [c.pos_category_id, c.name]));

    console.log(
      `[SyncManager] syncPosToStaging | catMap built | entries: ${catMap.size} ` +
      `(카테고리 맵 구성 완료 | 항목 수: ${catMap.size}개)`
    );

    // ── Step 4: Flatten item × variants into staging rows ────────────────────
    // One row per variant so every variant_id is individually promotable.
    // The unique constraint is (store_id, pos_item_id, variant_id) — all three must
    // be present in every row or the upsert will fail with a constraint violation.
    // stock_quantity carries the on-hand inventory from the adapter (0 for untracked).
    // sync_metadata: full raw Loyverse item JSON for auditing and future field extraction.
    // (변형당 하나의 행 — 각 variant_id를 개별적으로 승격 가능.
    //  고유 제약 조건은 (store_id, pos_item_id, variant_id) — 세 컬럼 모두 필수.
    //  stock_quantity는 어댑터의 현재 재고 — 미추적 항목은 0.
    //  sync_metadata: 감사 및 향후 필드 추출용 원시 Loyverse 항목 전체 JSON)
    const rows = [];

    for (const item of items) {
      for (const variant of item.variants) {
        rows.push({
          store_id:       storeId,                               // Tenant isolation key — part of unique constraint (테넌트 격리 키 — 고유 제약 조건 구성)
          pos_item_id:    item.pos_item_id,                      // Loyverse item UUID — part of unique constraint (Loyverse 항목 UUID — 고유 제약 조건 구성)
          variant_id:     variant.variant_id,                    // Loyverse variant UUID — part of unique constraint (Loyverse 변형 UUID — 고유 제약 조건 구성)
          name:           item.name,                             // Mapped from Loyverse item_name via adapter (어댑터에서 item_name 매핑)
          price:          variant.price,                         // Resolved variant price: store override → default (확정 변형 가격: 매장별 → 기본값)
          sku:            variant.sku ?? null,                   // Stock-keeping unit, null when absent (재고 관리 코드 — 없으면 null)
          category_name:  catMap.get(item.category_id) ?? null,  // Human-readable label from catMap; null when item has no category (catMap 조회 레이블 — 카테고리 미설정 시 null)
          stock_quantity: variant.stock_quantity ?? null,        // On-hand inventory from adapter; 0 when untracked (어댑터의 현재 재고 — 미추적 시 0)
          sync_metadata:  item.raw,                              // Full raw Loyverse item JSON (원시 Loyverse 항목 전체 JSON)
        });
      }
    }

    if (rows.length === 0) {
      // Items were returned but had no variants — unusual but not an error (항목 반환됐지만 변형 없음 — 비정상이지만 오류 아님)
      logStatus = 'success';
      logCount  = 0;
      console.warn(
        `[SyncManager] syncPosToStaging | no variants found in ${items.length} items | store: ${storeId} ` +
        `(변형 없음 — ${items.length}개 항목에서 변형 미발견 | 매장: ${storeId})`
      );
      return { success: true, synced: 0, itemCount: items.length };
    }

    // ── Step 5: Upsert into pos_items staging table ──────────────────────────
    // onConflict must match the actual DB unique constraint: (store_id, pos_item_id, variant_id).
    // Repeated syncs safely overwrite name, price, sku, category_name, stock_quantity,
    // sync_metadata without inserting duplicates.
    // (onConflict는 실제 DB 고유 제약 조건과 일치해야 함: (store_id, pos_item_id, variant_id).
    //  반복 동기화 시 중복 없이 안전하게 모든 컬럼 덮어씀)
    let upsertError = null;
    try {
      const result = await supabase
        .from('pos_items')
        .upsert(rows, { onConflict: 'store_id,pos_item_id,variant_id' });
      upsertError = result.error;
    } catch (thrown) {
      // Supabase client itself threw — log the raw exception details (Supabase 클라이언트 자체 throw — 원시 예외 상세 로깅)
      logError = `Upsert exception: ${thrown?.message ?? 'unknown'}`;
      console.error(
        `[SyncManager] syncPosToStaging upsert threw | store: ${storeId} | ` +
        `name: ${thrown?.name} | message: ${thrown?.message} | stack: ${thrown?.stack} ` +
        `(pos_items 업서트 예외 | 매장: ${storeId} | 오류명: ${thrown?.name} | 오류: ${thrown?.message})`
      );
      return { success: false, error: logError };
    }

    if (upsertError) {
      // PostgREST returned a structured error — log code, message, details, and hint for full visibility
      // (PostgREST 구조적 오류 반환 — 전체 가시성을 위해 코드, 메시지, 상세, 힌트 로깅)
      logError = `DB upsert failed: ${upsertError.message}`;
      console.error('[Sync Integrity Error]', upsertError.message, upsertError.details); // Exact pattern for log grep (로그 grep을 위한 정확한 패턴)
      console.error(
        `[SyncManager] syncPosToStaging upsert failed | store: ${storeId} | ` +
        `code: ${upsertError.code} | message: ${upsertError.message} | details: ${upsertError.details} | hint: ${upsertError.hint} ` +
        `(pos_items 업서트 실패 | 매장: ${storeId} | 코드: ${upsertError.code} | 오류: ${upsertError.message})`
      );
      return { success: false, error: logError };
    }

    // ── Happy path ───────────────────────────────────────────────────────────
    logStatus = 'success';
    logCount  = rows.length;

    console.log(
      `[SyncManager] syncPosToStaging complete | store: ${storeId} | rows: ${rows.length} ` +
      `(POS 스테이징 동기화 완료 | 매장: ${storeId} | 행 수: ${rows.length})`
    );

    return { success: true, synced: rows.length, itemCount: items.length };

  } finally {
    // Always insert a sync_logs audit record — try...finally guarantees this runs
    // regardless of success, failure, or early return in the try block above.
    // (항상 sync_logs 감사 레코드 삽입 — try...finally로 위 try 블록의
    //  성공, 실패, 조기 반환에 관계없이 실행 보장)
    await writeSyncLog(storeId, 'items', logStatus, logCount, logError);
  }
}

// ── promoteToMenu ────────────────────────────────────────────────────────────

/**
 * Promote a single pos_items staging record into the menu_items AI-active table.
 *
 * aiOverrides lets operators customise the AI presentation of the item:
 *   - ai_name:        replaces the raw Loyverse item name in menu_items.name
 *   - ai_description: written to menu_items.ai_description for use in LLM prompts
 *
 * When no overrides are provided the raw POS name and null description are used.
 * Safe to call repeatedly — upserts on variant_id so re-promoting is idempotent.
 *
 * (단일 pos_items 스테이징 레코드를 menu_items AI 활성 테이블로 승격.
 *  aiOverrides로 운영자가 항목의 AI 표현 커스터마이징 가능.
 *  재정의 없으면 원시 POS명과 null 설명 사용.
 *  반복 호출 안전 — variant_id로 업서트하여 재승격 멱등성 보장)
 *
 * @param {string|number} posItemId   — primary key of the pos_items row to promote (승격할 pos_items 행의 기본 키)
 * @param {object}        [aiOverrides] — optional AI presentation overrides (선택적 AI 표현 재정의)
 * @param {string}        [aiOverrides.ai_name]        — custom AI name (커스텀 AI 이름)
 * @param {string}        [aiOverrides.ai_description] — custom AI description (커스텀 AI 설명)
 * @returns {Promise<PromoteResult>}
 */
export async function promoteToMenu(posItemId, aiOverrides = {}) {
  console.log(
    `[SyncManager] promoteToMenu start | posItemId: ${posItemId} | ` +
    `overrides: ${JSON.stringify(aiOverrides)} ` +
    `(메뉴 승격 시작 | posItemId: ${posItemId} | 재정의: ${JSON.stringify(aiOverrides)})`
  );

  // ── Step 1: Load the pos_items staging row ───────────────────────────────
  // (pos_items 스테이징 행 로드)
  const { data: staging, error: fetchErr } = await supabase
    .from('pos_items')
    .select('*')
    .eq('id', posItemId)
    .single();

  if (fetchErr || !staging) {
    // The staging row must exist before promotion can proceed (스테이징 행이 먼저 존재해야 승격 가능)
    console.error(
      `[SyncManager] promoteToMenu | pos_items row not found | posItemId: ${posItemId} | ${fetchErr?.message ?? 'not found'} ` +
      `(pos_items 행 미발견 | posItemId: ${posItemId} | 오류: ${fetchErr?.message ?? '미발견'})`
    );
    return { success: false, error: fetchErr?.message ?? 'pos_items row not found' };
  }

  // ── Step 2: Build the menu_items row, applying AI overrides ─────────────
  // ai_name overrides the POS name when provided; ai_description defaults to null.
  // (AI 재정의 적용하여 menu_items 행 구성.
  //  ai_name이 있으면 POS명 대체; ai_description 기본값 null)
  const menuRow = {
    store_id:       staging.store_id,
    item_id:        staging.pos_item_id,                           // Loyverse item UUID from staging (스테이징의 Loyverse 항목 UUID)
    variant_id:     staging.variant_id,                            // Unique constraint target in menu_items (menu_items 고유 제약 조건 대상)
    name:           aiOverrides.ai_name?.trim() || staging.name,   // AI override name or raw POS name (AI 재정의 이름 또는 원시 POS명)
    price:          staging.price,                                 // Price carried over from staging (스테이징에서 이월된 가격)
    category:       staging.category_name ?? null,                 // Category label from staging (스테이징의 카테고리 레이블)
    ai_description: aiOverrides.ai_description?.trim() || null,    // AI description override, null when absent (AI 설명 재정의, 없으면 null)
    promoted_at:    new Date().toISOString(),                       // Timestamp of this promotion for auditing (감사용 승격 타임스탬프)
  };

  // ── Step 3: Upsert into menu_items ───────────────────────────────────────
  // onConflict targets variant_id — the unique constraint on menu_items.
  // Re-promoting the same row updates the AI name/description without duplicating.
  // (menu_items 업서트.
  //  onConflict는 menu_items의 고유 제약 조건인 variant_id 대상.
  //  동일 행 재승격 시 AI 이름/설명 업데이트 — 중복 없음)
  const { error: upsertError } = await supabase
    .from('menu_items')
    .upsert(menuRow, { onConflict: 'variant_id' });

  if (upsertError) {
    console.error(
      `[SyncManager] promoteToMenu upsert failed | posItemId: ${posItemId} | ${upsertError.message} ` +
      `(menu_items 업서트 실패 | posItemId: ${posItemId} | 오류: ${upsertError.message})`
    );
    return { success: false, error: `DB upsert failed: ${upsertError.message}` };
  }

  console.log(
    `[SyncManager] promoteToMenu complete | posItemId: ${posItemId} | ` +
    `name: "${menuRow.name}" | variant_id: ${menuRow.variant_id} ` +
    `(메뉴 승격 완료 | posItemId: ${posItemId} | 이름: "${menuRow.name}" | variant_id: ${menuRow.variant_id})`
  );

  return {
    success:  true,
    promoted: menuRow, // Echoed row for the caller to inspect or log (호출자 검사·로깅용 반환 행)
  };
}

// ── syncCustomersFromPos ──────────────────────────────────────────────────────

/**
 * Pull the full Loyverse customer list for a store and upsert into the customers table.
 *
 * Steps:
 *   1. Load the store row to obtain pos_api_key.
 *   2. Fetch all Loyverse customers via paginated GET /v1.0/customers.
 *   3. Normalise phone numbers to XXX-XXX-XXXX format.
 *   4. Upsert into the customers table on (store_id, phone) — idempotent.
 *
 * A try...finally block guarantees that writeSyncLog is called at every exit point
 * so the audit trail is always complete.
 *
 * (매장의 전체 Loyverse 고객 목록을 가져와 customers 테이블에 업서트.
 *  단계: 1. pos_api_key 조회, 2. 페이지 단위 GET /v1.0/customers 조회,
 *  3. 전화번호 XXX-XXX-XXXX 정규화, 4. (store_id, phone)으로 upsert — 멱등성 보장.
 *  try...finally 블록으로 모든 종료 지점에서 writeSyncLog 호출 보장)
 *
 * @param {string} storeId — store UUID from the stores table (stores 테이블의 매장 UUID)
 * @returns {Promise<{success: boolean, synced?: number, error?: string}>}
 */
export async function syncCustomersFromPos(storeId) {
  console.log(
    `[SyncManager] syncCustomersFromPos start | store: ${storeId} ` +
    `(고객 동기화 시작 | 매장: ${storeId})`
  );

  // Audit log tracking — default to 'failed'; overwritten on the happy path.
  // Written to sync_logs in the finally block regardless of how the function exits.
  // (감사 로그 추적 — 기본값 'failed'; 정상 경로에서 덮어씀.
  //  함수 종료 방식에 관계없이 finally 블록에서 sync_logs에 기록)
  let logStatus = 'failed';
  let logCount  = null;
  let logError  = null;

  try {

    // ── Step 1: Load store row and obtain pos_api_key ────────────────────────
    // (매장 행 로드 및 pos_api_key 획득)
    const { data: store, error: storeErr } = await supabase
      .from('stores')
      .select('id, name, pos_api_key')
      .eq('id', storeId)
      .single();

    if (storeErr || !store) {
      logError = storeErr?.message ?? 'Store not found';
      console.error(
        `[SyncManager] syncCustomersFromPos | store lookup failed | store: ${storeId} | ${logError} ` +
        `(매장 조회 실패 | 매장: ${storeId} | 오류: ${logError})`
      );
      return { success: false, error: logError };
    }

    if (!store.pos_api_key) {
      logError = 'Store has no POS API key configured';
      console.error(
        `[SyncManager] syncCustomersFromPos aborted — no pos_api_key | store: ${storeId} ` +
        `(동기화 중단 — pos_api_key 없음 | 매장: ${storeId})`
      );
      return { success: false, error: logError };
    }

    // ── Step 2: Fetch all customers from Loyverse with pagination ────────────
    // Loyverse returns up to 250 customers per page; loop until cursor is exhausted.
    // Three-step API key cleaning prevents "Invalid character in header content" errors
    // caused by control characters stored in the DB.
    // (Loyverse는 페이지당 최대 250명 반환; 커서가 소진될 때까지 반복.
    //  3단계 API 키 정리로 DB에 저장된 제어 문자로 인한
    //  "Invalid character in header content" 오류 방지)
    const cleanApiKey = String(store.pos_api_key).replace(/[\n\r\t]/g, '').trim();

    // Warn when the DB value contained hidden characters (DB 값에 숨겨진 문자가 있는 경우 경고)
    if (cleanApiKey.length !== String(store.pos_api_key).length) {
      console.warn(
        `[SyncManager] syncCustomersFromPos | pos_api_key had control/whitespace characters — stripped | store: ${storeId} | ` +
        `raw length: ${String(store.pos_api_key).length} → clean length: ${cleanApiKey.length} ` +
        `(pos_api_key에 제어/공백 문자 포함 — 제거 완료 | 매장: ${storeId})`
      );
    }

    const loyverseCustomers = [];
    let cursor = null;

    try {
      do {
        const params = { limit: 250 };
        if (cursor) params.cursor = cursor; // Append cursor for subsequent pages (다음 페이지 커서 추가)

        const response = await axios.get('https://api.loyverse.com/v1.0/customers', {
          headers: { Authorization: `Bearer ${cleanApiKey}` }, // cleanApiKey is whitespace-free (cleanApiKey는 공백 없음이 보장됨)
          params,
          timeout: 12000, // 12-second timeout to accommodate large customer lists (대규모 고객 목록 대응 12초 타임아웃)
        });

        const page = response.data.customers ?? [];
        loyverseCustomers.push(...page);
        cursor = response.data.cursor ?? null; // null when last page reached (마지막 페이지 도달 시 null)

      } while (cursor);

    } catch (err) {
      logError = err.message;
      console.error(
        `[SyncManager] syncCustomersFromPos Loyverse fetch error | store: ${storeId} | ${err.message} ` +
        `(Loyverse 고객 조회 오류 | 매장: ${storeId} | 오류: ${err.message})`
      );
      return { success: false, error: err.message };
    }

    console.log(
      `[SyncManager] syncCustomersFromPos fetched | store: ${storeId} | customers: ${loyverseCustomers.length} ` +
      `(고객 조회 완료 | 매장: ${storeId} | 고객 수: ${loyverseCustomers.length})`
    );

    if (loyverseCustomers.length === 0) {
      // No customers in Loyverse — valid state, not an error (Loyverse에 고객 없음 — 유효한 상태, 오류 아님)
      logStatus = 'success';
      logCount  = 0;
      return { success: true, synced: 0 };
    }

    // ── Step 3: Normalise phone numbers and build upsert rows ────────────────
    // Column names match the actual customers table schema exactly:
    //   phone  — formatted XXX-XXX-XXXX (dedup key with store_id)
    //   name   — full name joined from Loyverse first_name + last_name
    //   email  — from Loyverse customer email field
    // (컬럼명은 실제 customers 테이블 스키마와 정확히 일치)
    const rows = [];

    for (const c of loyverseCustomers) {
      const raw    = c.phone_number ?? c.phone ?? '';
      const digits = raw.replace(/\D/g, '').slice(-10);
      if (digits.length !== 10) continue; // Skip customers with no valid 10-digit phone (유효한 10자리 전화번호 없는 고객 건너뜀)

      const phone = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`; // XXX-XXX-XXXX format (XXX-XXX-XXXX 형식)

      rows.push({
        store_id:        storeId,                                                               // Tenant isolation key (테넌트 격리 키)
        phone:           phone,                                                                 // Formatted phone — unique constraint key with store_id (형식화된 전화번호 — store_id와 고유 제약 조건 키)
        name:            c.name || [c.first_name, c.last_name].filter(Boolean).join(' ').trim() || null, // Prefer top-level name; fall back to joined first+last (최상위 name 우선; 없으면 first_name + last_name 조합)
        email:           c.email ?? null,                                                       // Customer email from Loyverse (Loyverse 고객 이메일)
        pos_customer_id: c.id ?? null,                                                          // Loyverse customer UUID for future lookups (향후 조회를 위한 Loyverse 고객 UUID)
      });
    }

    if (rows.length === 0) {
      // All customers lacked a valid phone number — nothing to upsert (모든 고객의 유효한 전화번호 없음 — 업서트 대상 없음)
      logStatus = 'success';
      logCount  = 0;
      console.warn(
        `[SyncManager] syncCustomersFromPos | no customers with valid phone | store: ${storeId} ` +
        `(유효한 전화번호 있는 고객 없음 | 매장: ${storeId})`
      );
      return { success: true, synced: 0 };
    }

    // ── Step 4: Upsert into customers table ──────────────────────────────────
    // onConflict targets the (store_id, phone) unique constraint — matches the actual DB schema.
    // (onConflict는 (store_id, phone) 고유 제약 조건 대상 — 실제 DB 스키마와 일치)
    const { error: upsertError } = await supabase
      .from('customers')
      .upsert(rows, { onConflict: 'store_id,phone' });

    if (upsertError) {
      // Log with [Sync Integrity Error] prefix for consistent grep pattern (일관된 grep 패턴을 위한 [Sync Integrity Error] 접두사)
      logError = `DB upsert failed: ${upsertError.message}`;
      console.error('[Sync Integrity Error]', upsertError.message, upsertError.details);
      console.error(
        `[SyncManager] syncCustomersFromPos upsert failed | store: ${storeId} | ` +
        `code: ${upsertError.code} | message: ${upsertError.message} | details: ${upsertError.details} | hint: ${upsertError.hint} ` +
        `(customers 업서트 실패 | 매장: ${storeId} | 코드: ${upsertError.code} | 오류: ${upsertError.message})`
      );
      return { success: false, error: logError };
    }

    // ── Happy path ───────────────────────────────────────────────────────────
    logStatus = 'success';
    logCount  = rows.length;

    console.log(
      `[SyncManager] syncCustomersFromPos complete | store: ${storeId} | synced: ${rows.length} ` +
      `(고객 동기화 완료 | 매장: ${storeId} | 동기화된 고객 수: ${rows.length})`
    );

    return { success: true, synced: rows.length };

  } finally {
    // Always insert a sync_logs audit record — try...finally guarantees this runs
    // regardless of success, failure, or early return.
    // (항상 sync_logs 감사 레코드 삽입 — try...finally로 성공, 실패, 조기 반환에 관계없이 실행 보장)
    await writeSyncLog(storeId, 'customers', logStatus, logCount, logError);
  }
}
