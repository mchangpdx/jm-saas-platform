// promotionService — bulk promotion service for the Menu Promotion System.
// Fetches multiple pos_items records by their DB primary key and upserts them all
// into menu_items in a single batch write.
// Distinct from syncManager.promoteToMenu (single-item with optional AI overrides):
// this service is designed for the "Promote Selected" UI action in SyncCenter.
// (메뉴 승격 시스템 대량 승격 서비스.
//  여러 pos_items 레코드를 DB 기본 키로 가져와 한 번의 배치로 menu_items에 업서트.
//  syncManager.promoteToMenu(AI 재정의 포함 단일 항목)와 구별:
//  이 서비스는 SyncCenter의 "선택 항목 승격" UI 액션을 위해 설계됨)

import { supabase } from '../config/supabase.js';

// ── promoteItemsToLive ────────────────────────────────────────────────────────

/**
 * Bulk-promote an array of pos_items staging rows into the menu_items AI-active table.
 *
 * Steps:
 *   1. Validate inputs — storeId and posItemIds must both be present and non-empty.
 *   2. Fetch all matching pos_items rows scoped to storeId (prevents cross-tenant access).
 *   3. Pre-check menu_items to classify each row as new INSERT or existing UPDATE:
 *        pos_item_ref = NULL (or row missing) → INSERT new record
 *        pos_item_ref set                     → UPDATE existing record (refreshes stock, price, name)
 *   4. Map each staging row to a menu_items record (name, price, category, stock_quantity,
 *        pos_item_ref, item_id, store_id, variant_id, promoted_at).
 *   5. Batch upsert into menu_items on variant_id — handles both INSERT and UPDATE paths.
 *   6. Mark pos_items.mapping_status = 'promoted' for each successfully promoted row.
 *
 * Returns { success, promoted, skipped, error } where:
 *   promoted — count of rows successfully written to menu_items
 *   skipped  — IDs in posItemIds that had no matching pos_items row for this store
 *
 * (pos_items 스테이징 행 배열을 menu_items AI 활성 테이블로 대량 승격.
 *  단계: 1. 입력 검증, 2. storeId 범위의 pos_items 행 조회(크로스 테넌트 접근 방지),
 *  3. 각 행을 menu_items 레코드로 매핑(category←category_name, stock_quantity, pos_item_ref←pos_items.id 포함),
 *  4. variant_id로 배치 업서트 — 멱등성 보장.
 *  5. 승격된 pos_items 행에 mapping_status='promoted' 설정.
 *  반환: { success, promoted, skipped, error })
 *
 * @param {string}   storeId    — store UUID; scopes all DB queries for tenant isolation (테넌트 격리용 매장 UUID)
 * @param {string[]} posItemIds — array of pos_items.id (DB primary key) values (pos_items.id PK 배열)
 * @returns {Promise<{ success: boolean, promoted?: number, skipped?: string[], error?: string }>}
 */
export async function promoteItemsToLive(storeId, posItemIds) {
  console.log(
    `[PromotionService] promoteItemsToLive start | store: ${storeId} | count: ${posItemIds?.length ?? 0} ` +
    `(대량 승격 시작 | 매장: ${storeId} | 항목 수: ${posItemIds?.length ?? 0}개)`
  );

  // ── Step 1: Validate inputs ──────────────────────────────────────────────
  // Fail fast with descriptive messages so the route can return a clear 400.
  // (명확한 400 반환을 위한 설명적 메시지와 함께 조기 실패)
  if (!storeId) {
    return { success: false, error: 'storeId is required' };
  }
  if (!Array.isArray(posItemIds) || posItemIds.length === 0) {
    return { success: false, error: 'posItemIds must be a non-empty array' };
  }

  // ── Step 2: Fetch matching pos_items rows scoped to this store ───────────
  // .in('id', posItemIds) batch-fetches only the requested rows in one query.
  // .eq('store_id', storeId) ensures a compromised client cannot promote another
  // tenant's items by guessing foreign primary keys.
  // (.in('id', posItemIds)으로 요청된 행만 한 번의 쿼리로 배치 조회.
  //  .eq('store_id', storeId)로 범위 제한 — 클라이언트가 다른 테넌트 항목을 승격하기 위해
  //  외부 기본 키를 추측하는 것을 방지)
  const { data: stagingRows, error: fetchError } = await supabase
    .from('pos_items')
    .select('id, pos_item_id, variant_id, name, price, category_name, sku, stock_quantity')
    .in('id', posItemIds)
    .eq('store_id', storeId);

  if (fetchError) {
    console.error(
      `[PromotionService] pos_items fetch failed | store: ${storeId} | ${fetchError.message} ` +
      `(pos_items 조회 실패 | 매장: ${storeId} | 오류: ${fetchError.message})`
    );
    return { success: false, error: fetchError.message };
  }

  if (!stagingRows || stagingRows.length === 0) {
    // None of the requested IDs matched any pos_items row for this store (요청된 ID 중 이 매장의 pos_items 행과 일치하는 것 없음)
    console.warn(
      `[PromotionService] No matching pos_items rows found | store: ${storeId} | ids: ${posItemIds.join(', ')} ` +
      `(일치하는 pos_items 행 없음 | 매장: ${storeId})`
    );
    return { success: false, error: 'No matching staging rows found for the given IDs' };
  }

  // Identify requested IDs that were not found in the DB (DB에서 찾지 못한 요청 ID 식별)
  const foundIds = new Set(stagingRows.map((r) => r.id));
  const skipped  = posItemIds.filter((id) => !foundIds.has(id));

  if (skipped.length > 0) {
    console.warn(
      `[PromotionService] ${skipped.length} ID(s) not found in pos_items | store: ${storeId} | skipped: ${skipped.join(', ')} ` +
      `(pos_items에서 ${skipped.length}개 ID 누락 | 매장: ${storeId})`
    );
  }

  // ── Step 3: Pre-check menu_items to classify each row as new or update ────
  // Fetch existing menu_items rows for the given variant_ids.
  // A row where pos_item_ref is NULL was either created outside the staging pipeline
  // or pre-dates the pos_item_ref column — treat as a new record (INSERT path).
  // A row where pos_item_ref is already set was previously promoted through this
  // service — treat as an update (refresh name, price, stock_quantity, promoted_at).
  // Both paths are handled by a single upsert; this pre-check logs the split for
  // operator visibility and debugging.
  // (각 행을 신규 또는 업데이트로 분류하기 위한 menu_items 사전 확인.
  //  pos_item_ref = NULL인 행은 스테이징 파이프라인 외부에서 생성 — 신규 레코드(INSERT 경로).
  //  pos_item_ref가 이미 설정된 행은 이전에 이 서비스로 승격 — 업데이트 경로.
  //  두 경로 모두 단일 upsert로 처리; 사전 확인은 운영자 가시성과 디버깅을 위해 분류를 로깅)
  const variantIds = stagingRows.map((r) => r.variant_id);

  const { data: existingMenu } = await supabase
    .from('menu_items')
    .select('variant_id, pos_item_ref')
    .in('variant_id', variantIds)
    .eq('store_id', storeId);

  // Build the set of variant_ids that already have pos_item_ref set (prior promotions)
  // (이미 pos_item_ref가 설정된 variant_id 집합 — 이전 승격 항목)
  const existingRefSet = new Set(
    (existingMenu ?? [])
      .filter((r) => r.pos_item_ref !== null)
      .map((r)   => r.variant_id)
  );

  const newCount    = stagingRows.filter((r) => !existingRefSet.has(r.variant_id)).length; // Rows to INSERT into menu_items (menu_items에 INSERT할 행 수)
  const updateCount = stagingRows.filter((r) =>  existingRefSet.has(r.variant_id)).length; // Rows to UPDATE in menu_items (menu_items에서 UPDATE할 행 수)

  console.log(
    `[PromotionService] Classification | store: ${storeId} | new (INSERT): ${newCount} | update (REFRESH): ${updateCount} ` +
    `(분류 결과 | 매장: ${storeId} | 신규(INSERT): ${newCount}개 | 업데이트(갱신): ${updateCount}개)`
  );

  // ── Step 4: Map staging rows to menu_items records ───────────────────────
  // Field mapping (pos_items schema → menu_items schema):
  //   pos_items.name           → menu_items.name           (display name for AI and UI)
  //   pos_items.price          → menu_items.price          (variant price from POS)
  //   pos_items.category_name  → menu_items.category       (AI-readable category label)
  //   pos_items.stock_quantity → menu_items.stock_quantity  (on-hand inventory from Loyverse)
  //   pos_items.id             → menu_items.pos_item_ref   (staging row UUID — webhook guard key)
  //   pos_items.pos_item_id    → menu_items.item_id        (Loyverse item UUID for joins)
  //   promoted_at set to now — updated every time the item is promoted or refreshed.
  // (필드 매핑:
  //  category_name → category, stock_quantity → stock_quantity,
  //  pos_items.id → pos_item_ref (웹훅 가드 키), promoted_at 승격/갱신 타임스탬프)
  const now      = new Date().toISOString();
  const menuRows = stagingRows.map((row) => ({
    store_id:       storeId,                        // Tenant isolation key (테넌트 격리 키)
    item_id:        row.pos_item_id,                // Loyverse item UUID from staging (스테이징의 Loyverse 항목 UUID)
    variant_id:     row.variant_id,                 // Unique constraint target in menu_items (menu_items 고유 제약 조건 대상)
    name:           row.name,                       // Display name from POS (POS 표시명)
    price:          row.price,                      // Variant price from POS (POS 변형 가격)
    category:       row.category_name ?? null,      // Human-readable category; null when item has no category (사람이 읽을 수 있는 카테고리 — 카테고리 없으면 null)
    stock_quantity: row.stock_quantity ?? null,     // On-hand inventory propagated from staging; null when Loyverse does not track this item (스테이징에서 전파된 현재 재고 — Loyverse 미추적 항목은 null)
    pos_item_ref:   row.id,                         // Staging row UUID — webhook guard checks this to confirm the item was explicitly promoted (스테이징 행 UUID — 웹훅 가드가 명시적 승격 여부 확인에 사용)
    promoted_at:    now,                            // Batch promotion timestamp for auditing (감사용 배치 승격 타임스탬프)
  }));

  console.log(
    `[PromotionService] Mapped ${menuRows.length} row(s) for upsert | store: ${storeId} ` +
    `(업서트용 ${menuRows.length}개 행 매핑 완료 | 매장: ${storeId})`
  );

  // ── Step 5: Batch upsert into menu_items ─────────────────────────────────
  // onConflict targets variant_id — the unique constraint on menu_items.
  // INSERT when the variant_id is new (pos_item_ref was NULL or row missing).
  // UPDATE when the variant_id already exists — refreshes name, price, stock_quantity,
  // pos_item_ref, and promoted_at with the latest staging data.
  // (menu_items에 배치 업서트.
  //  onConflict는 menu_items의 고유 제약 조건인 variant_id 대상.
  //  variant_id가 신규이면 INSERT — pos_item_ref 없거나 행 없음.
  //  variant_id가 기존이면 UPDATE — name/price/stock_quantity/pos_item_ref/promoted_at 갱신)
  const { error: upsertError } = await supabase
    .from('menu_items')
    .upsert(menuRows, { onConflict: 'variant_id' });

  if (upsertError) {
    console.error(
      `[PromotionService] menu_items upsert failed | store: ${storeId} | ` +
      `code: ${upsertError.code} | message: ${upsertError.message} | hint: ${upsertError.hint} ` +
      `(menu_items 업서트 실패 | 매장: ${storeId} | 코드: ${upsertError.code} | 오류: ${upsertError.message})`
    );
    return { success: false, error: `DB upsert failed: ${upsertError.message}` };
  }

  // ── Step 6: Mark staging rows as promoted ────────────────────────────────
  // Setting mapping_status = 'promoted' on pos_items is the authoritative signal
  // used by the SyncCenter to exclude these rows from the "Pending Promotion" list.
  // It is also used by webhook handlers as a guard before updating menu_items.
  // Non-fatal: a status-update failure is logged but does not roll back the promotion —
  // the items ARE live in menu_items; the status flag is correctable on next sync.
  // (pos_items에 mapping_status = 'promoted' 설정은 SyncCenter가 "승격 대기" 목록에서
  //  해당 행을 제외하는 데 사용하는 권위 있는 신호.
  //  웹훅 핸들러가 menu_items 업데이트 전 가드로도 사용.
  //  치명적이지 않음 — 상태 업데이트 실패는 로깅되지만 승격을 롤백하지 않음.
  //  항목은 menu_items에 라이브 상태이며 상태 플래그는 다음 동기화에서 수정 가능)
  const promotedIds = stagingRows.map((r) => r.id);
  const { error: statusError } = await supabase
    .from('pos_items')
    .update({ mapping_status: 'promoted' })
    .in('id', promotedIds);

  if (statusError) {
    // Non-fatal — log the failure but return success since menu_items was written (치명적이지 않음 — menu_items 쓰기 성공이므로 성공 반환, 실패 로깅)
    console.warn(
      `[PromotionService] mapping_status update failed (non-fatal) | store: ${storeId} | ${statusError.message} ` +
      `(mapping_status 업데이트 실패(치명적이지 않음) | 매장: ${storeId} | 오류: ${statusError.message})`
    );
  } else {
    console.log(
      `[PromotionService] mapping_status set to 'promoted' | store: ${storeId} | ids: ${promotedIds.length} ` +
      `(mapping_status를 'promoted'로 설정 완료 | 매장: ${storeId} | ID 수: ${promotedIds.length})`
    );
  }

  console.log(
    `[PromotionService] promoteItemsToLive complete | store: ${storeId} | ` +
    `promoted: ${menuRows.length} | skipped: ${skipped.length} ` +
    `(대량 승격 완료 | 매장: ${storeId} | 승격: ${menuRows.length}개 | 건너뜀: ${skipped.length}개)`
  );

  return {
    success:  true,
    promoted: menuRows.length,
    skipped,
  };
}
