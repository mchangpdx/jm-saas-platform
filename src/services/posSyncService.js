// posSyncService — Direct-to-DB sync engine for Loyverse catalog data.
// Fetches items, variants, and categories from Loyverse and upserts them
// directly into menu_items — no staging layer (pos_items) involved.
// Writes to sync_logs at start ('running') and end ('success'|'failed') so
// the sync history is never empty even on crash or early return.
// (Direct-to-DB Loyverse 카탈로그 동기화 엔진.
//  Loyverse에서 항목, 변형, 카테고리를 가져와 pos_items 스테이징 없이
//  menu_items에 직접 업서트.
//  시작 시 'running', 종료 시 'success'|'failed'를 sync_logs에 기록 —
//  충돌 또는 조기 반환 시에도 동기화 기록이 빈 채로 남지 않음)

import { supabase }        from '../config/supabase.js';
import { LoyverseAdapter } from './pos/loyverseAdapter.js';

// ── writeSyncLog ──────────────────────────────────────────────────────────────

/**
 * Persist a sync run record to the sync_logs table.
 * Column mapping (DB schema):
 *   started_at  — set for 'running' records to mark when the sync began
 *   finished_at — set for 'success'/'failed' records to mark when it ended
 * Non-fatal — a log write failure is warned but never throws.
 * (sync_logs 테이블에 동기화 실행 기록 저장.
 *  컬럼 매핑 (DB 스키마):
 *   started_at  — 동기화 시작 시간을 기록하는 'running' 레코드에 설정
 *   finished_at — 종료 시간을 기록하는 'success'/'failed' 레코드에 설정
 *  치명적이지 않음 — 로그 쓰기 실패는 경고되지만 예외를 던지지 않음)
 *
 * @param {string}      storeId        — store UUID (매장 UUID)
 * @param {string}      syncType       — event label for sync_type column (sync_type 열 이벤트 레이블)
 * @param {string}      status         — 'running' | 'success' | 'failed' (실행 상태)
 * @param {number|null} itemsProcessed — row count; null for in-flight records (처리 행 수; 실행 중은 null)
 * @param {string|null} errorMsg       — error message on failure; null on success (실패 시 오류 메시지)
 */
async function writeSyncLog(storeId, syncType, status, itemsProcessed, errorMsg) {
  const now = new Date().toISOString();

  // Use started_at for the in-flight record, finished_at for terminal records.
  // The DB schema has no 'synced_at' column — using it caused a 400 insert error.
  // ('running' 레코드에는 started_at, 종료 레코드에는 finished_at 사용.
  //  DB 스키마에 'synced_at' 컬럼 없음 — 사용 시 400 삽입 오류 발생)
  const timestamps = status === 'running'
    ? { started_at: now,  finished_at: null }  // Sync just started (동기화 시작)
    : { started_at: null, finished_at: now };   // Sync ended (동기화 종료)

  const { error } = await supabase
    .from('sync_logs')
    .insert({
      store_id:        storeId,
      sync_type:       syncType,
      status,
      items_processed: itemsProcessed ?? null,
      error_message:   errorMsg       ?? null,
      ...timestamps,
    });

  if (error) {
    // Non-fatal — log the failure and continue (치명적이지 않음 — 실패 로깅 후 계속)
    console.warn(
      `[PosSyncService] sync_logs write failed | store: ${storeId} | status: ${status} | ${error.message} ` +
      `(sync_logs 쓰기 실패 | 매장: ${storeId} | 상태: ${status} | 오류: ${error.message})`
    );
  }
}

// ── syncAllToLive ─────────────────────────────────────────────────────────────

/**
 * Full Direct-to-DB sync: Loyverse catalog → menu_items in one pass.
 *
 * Steps:
 *   1. Validate storeId; fetch the store's pos_api_key from Supabase.
 *   2. Write a 'running' record to sync_logs immediately (fixes empty-log issue).
 *   3. Construct LoyverseAdapter with the store's API key.
 *   4. Fetch items, categories, AND inventory_levels concurrently from Loyverse.
 *      /inventory_levels is the authoritative source for stock data — stock syncing
 *      as 0 was caused by relying solely on the embedded stores[0].in_stock field
 *      inside /items, which can be absent or stale. Both sources are fetched and merged.
 *   5. Build lookup maps: category ID → name, variant ID → in_stock.
 *   6. Flatten each item's variants into menu_items-shaped rows, merging inventory.
 *      Stock resolution: /inventory_levels value → /items embedded value → 0.
 *   7. Batch upsert into menu_items on conflict variant_id.
 *   8. In the finally block, write 'success'|'failed' to sync_logs.
 *
 * Returns { success, synced, error } where:
 *   synced — count of variant rows written to menu_items
 *   error  — error message string on failure; absent on success
 *
 * (전체 Direct-to-DB 동기화: Loyverse 카탈로그 → menu_items 단일 패스.
 *  단계: 1. storeId 검증 및 pos_api_key 조회. 2. sync_logs에 'running' 즉시 기록.
 *  3. LoyverseAdapter 구성.
 *  4. 항목, 카테고리, 재고 수준을 동시 조회.
 *     /inventory_levels가 재고 데이터의 권위 있는 소스 — /items의 embedded
 *     stores[0].in_stock에만 의존하면 재고가 0으로 동기화되는 문제 발생.
 *  5. 카테고리 ID → 이름 맵, 변형 ID → in_stock 맵 생성.
 *  6. 각 변형을 menu_items 행으로 평탄화하며 재고 병합.
 *     재고 결정: /inventory_levels 값 → /items embedded 값 → 0.
 *  7. variant_id 충돌 시 menu_items에 배치 업서트.
 *  8. finally 블록에서 'success'|'failed' 기록.
 *  반환: { success, synced, error })
 *
 * @param {string} storeId — store UUID; scopes all DB queries (테넌트 격리용 매장 UUID)
 * @returns {Promise<{ success: boolean, synced?: number, error?: string }>}
 */
export async function syncAllToLive(storeId) {
  console.log(
    `[PosSyncService] syncAllToLive start | store: ${storeId} ` +
    `(Direct-to-DB 동기화 시작 | 매장: ${storeId})`
  );

  // ── Step 1: Validate storeId ──────────────────────────────────────────────
  // Fail fast — every downstream call requires a valid store UUID.
  // (조기 실패 — 모든 다운스트림 호출에 유효한 매장 UUID 필요)
  if (!storeId) {
    return { success: false, error: 'storeId is required' };
  }

  // Fetch the store's Loyverse API key — never passed from the client.
  // (매장의 Loyverse API 키 조회 — 클라이언트에서 전달되지 않음)
  const { data: storeRow, error: storeError } = await supabase
    .from('stores')
    .select('pos_api_key')
    .eq('id', storeId)
    .maybeSingle();

  if (storeError || !storeRow?.pos_api_key) {
    const msg = storeError?.message ?? 'No pos_api_key found for store';
    console.error(
      `[PosSyncService] Store lookup failed | store: ${storeId} | ${msg} ` +
      `(매장 조회 실패 | 매장: ${storeId} | 오류: ${msg})`
    );
    return { success: false, error: msg };
  }

  // Tracking variables written to sync_logs in the finally block
  // (finally 블록에서 sync_logs에 기록하는 추적 변수)
  let logStatus = 'failed';
  let logCount  = null;
  let logError  = null;

  // ── Step 2: Write 'running' record to sync_logs ───────────────────────────
  // Writing at the START guarantees sync_logs is never empty even when the
  // function crashes before reaching the finally block.
  // (START에서 기록하면 함수가 finally 블록 도달 전에 충돌해도
  //  sync_logs가 빈 채로 남지 않음)
  await writeSyncLog(storeId, 'full_sync', 'running', null, null);

  try {
    // ── Step 3: Construct LoyverseAdapter ────────────────────────────────
    // Constructor validates and strips control characters from the API key.
    // (생성자가 API 키를 검증하고 제어 문자를 제거)
    const adapter = new LoyverseAdapter(storeRow.pos_api_key);

    // ── Step 4: Fetch items, categories, AND inventory levels concurrently ──
    // Three-way concurrent fetch minimises wall-clock time.
    // fetchCategories() and fetchInventoryLevels() are non-fatal — both return []
    // on error so the sync can still complete with partial data.
    // (세 가지 동시 조회로 실벽 시간 최소화.
    //  fetchCategories()와 fetchInventoryLevels()는 치명적이지 않음 —
    //  오류 시 [] 반환하여 부분 데이터로도 동기화 완료 가능)
    const [items, categories, inventoryLevels] = await Promise.all([
      adapter.fetchItems(),
      adapter.fetchCategories(),
      adapter.fetchInventoryLevels(),
    ]);

    console.log(
      `[PosSyncService] Loyverse data fetched | items: ${items.length} | ` +
      `categories: ${categories.length} | inventory_levels: ${inventoryLevels.length} ` +
      `(Loyverse 데이터 조회 완료 | 항목: ${items.length}개 | 카테고리: ${categories.length}개 | 재고 수준: ${inventoryLevels.length}개)`
    );

    // ── Step 5: Build lookup maps ──────────────────────────────────────────
    // categoryMap  — pos_category_id → human-readable category name
    //                Items without a match get null for the category column.
    // inventoryMap — variant_id → in_stock (from /inventory_levels, the authoritative source)
    //                Variants not in the map fall back to the embedded stock_quantity
    //                from fetchItems() (which itself falls back to 0 for untracked items).
    //                This two-source merge is what fixes the "stock syncing as 0" bug:
    //                /items stores[0].in_stock can be null or absent when inventory
    //                tracking is toggled, while /inventory_levels is always present for
    //                actively tracked variants.
    // (categoryMap  — pos_category_id → 카테고리명 (없으면 null)
    //  inventoryMap — variant_id → in_stock (/inventory_levels에서, 권위 있는 소스)
    //                 맵에 없는 변형은 fetchItems()의 embedded stock_quantity로 폴백.
    //                 이 두 소스 병합이 "재고가 0으로 동기화" 버그를 수정:
    //                 /items stores[0].in_stock은 재고 추적 전환 시 null이거나 없을 수 있지만,
    //                 /inventory_levels는 활성 추적 변형에 항상 존재함)
    const categoryMap = new Map(
      categories.map((c) => [c.pos_category_id, c.name])
    );

    // Take the first matching inventory level per variant_id
    // (변형 ID당 첫 번째 일치하는 재고 수준 사용)
    const inventoryMap = new Map(
      inventoryLevels.map((level) => [level.variant_id, level.in_stock])
    );

    // ── Step 6: Flatten variants into menu_items rows ─────────────────────
    // Each Loyverse item has N variants; each variant becomes one menu_items row.
    // Stock resolution priority: /inventory_levels → /items embedded → 0.
    // promoted_at is reused as the sync timestamp in the direct-to-DB architecture.
    // (각 Loyverse 항목은 N개의 변형을 가짐; 각 변형이 하나의 menu_items 행이 됨.
    //  재고 결정 우선순위: /inventory_levels → /items embedded → 0.
    //  promoted_at은 direct-to-DB 아키텍처에서 동기화 타임스탬프로 재사용됨)
    const now      = new Date().toISOString();
    const menuRows = [];

    for (const item of items) {
      const categoryName = item.category_id
        ? (categoryMap.get(item.category_id) ?? null)
        : null;

      for (const variant of item.variants) {
        // Stock resolution: authoritative /inventory_levels first, then /items embedded fallback
        // (재고 결정: 권위 있는 /inventory_levels 우선, 이후 /items embedded 폴백)
        const stockQty = inventoryMap.has(variant.variant_id)
          ? inventoryMap.get(variant.variant_id)   // From /inventory_levels (권위 있는 소스)
          : variant.stock_quantity;                 // Fallback from /items stores[0] (/items 폴백)

        menuRows.push({
          store_id:       storeId,            // Tenant isolation key (테넌트 격리 키)
          item_id:        item.pos_item_id,   // Loyverse item UUID (Loyverse 항목 UUID)
          variant_id:     variant.variant_id, // Unique constraint key (고유 제약 조건 키)
          name:           item.name,          // Display name from POS (POS 표시명)
          price:          variant.price,      // Resolved price from LoyverseAdapter (결정된 가격)
          category:       categoryName,       // Human-readable category; null when uncategorised (사람이 읽을 수 있는 카테고리)
          stock_quantity: stockQty,           // Merged stock: /inventory_levels preferred (병합된 재고: /inventory_levels 우선)
          promoted_at:    now,                // Last sync timestamp (마지막 동기화 타임스탬프)
        });
      }
    }

    console.log(
      `[PosSyncService] Mapped ${menuRows.length} variant row(s) for upsert | store: ${storeId} ` +
      `(업서트용 ${menuRows.length}개 변형 행 매핑 완료 | 매장: ${storeId})`
    );

    if (menuRows.length === 0) {
      // No variants found — Loyverse catalog may be empty (변형 없음 — Loyverse 카탈로그가 비어 있을 수 있음)
      console.warn(
        `[PosSyncService] No variants to upsert | store: ${storeId} ` +
        `(업서트할 변형 없음 | 매장: ${storeId})`
      );
      logStatus = 'success';
      logCount  = 0;
      return { success: true, synced: 0 };
    }

    // ── Step 7: Batch upsert into menu_items ──────────────────────────────
    // onConflict targets variant_id — the unique constraint on menu_items.
    // INSERT when the variant is new; UPDATE when it already exists.
    // (onConflict는 menu_items의 고유 제약 조건인 variant_id 대상.
    //  변형이 신규이면 INSERT; 이미 존재하면 UPDATE)
    const { error: upsertError } = await supabase
      .from('menu_items')
      .upsert(menuRows, { onConflict: 'variant_id' });

    if (upsertError) {
      console.error(
        `[PosSyncService] menu_items upsert failed | store: ${storeId} | ` +
        `code: ${upsertError.code} | ${upsertError.message} ` +
        `(menu_items 업서트 실패 | 매장: ${storeId} | 코드: ${upsertError.code} | 오류: ${upsertError.message})`
      );
      logError = upsertError.message;
      return { success: false, error: `DB upsert failed: ${upsertError.message}` };
    }

    logStatus = 'success';
    logCount  = menuRows.length;

    console.log(
      `[PosSyncService] syncAllToLive complete | store: ${storeId} | synced: ${menuRows.length} ` +
      `(Direct-to-DB 동기화 완료 | 매장: ${storeId} | 동기화: ${menuRows.length}개)`
    );

    return { success: true, synced: menuRows.length };

  } catch (err) {
    // Unexpected top-level error — set tracking vars and return structured failure
    // (예기치 않은 최상위 오류 — 추적 변수 설정 후 구조화된 실패 반환)
    logError = err.message;
    console.error(
      `[PosSyncService] syncAllToLive unexpected error | store: ${storeId} | ${err.message} ` +
      `(syncAllToLive 예기치 않은 오류 | 매장: ${storeId} | 오류: ${err.message})`
    );
    return { success: false, error: err.message };

  } finally {
    // ── Step 8: Write terminal sync_logs record ──────────────────────────
    // Always executes — every 'running' record is paired with a terminal record.
    // (항상 실행 — 모든 'running' 레코드는 종료 레코드와 쌍을 이룸)
    await writeSyncLog(storeId, 'full_sync', logStatus, logCount, logError);
  }
}
