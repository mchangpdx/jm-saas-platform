// Daily cron job — scheduled menu sync for all active Loyverse stores
// (일별 크론 작업 — 모든 활성 Loyverse 매장의 예약 메뉴 동기화)
//
// Runs once at 06:00 AM every day (매일 오전 6시에 한 번 실행)
// Import this module in app.js to activate the scheduler on server boot.
// (서버 부팅 시 스케줄러를 활성화하려면 app.js에서 이 모듈을 임포트)

import cron from 'node-cron';
import { supabase }             from '../config/supabase.js';
import { syncMenuFromLoyverse, syncInventoryFromLoyverse } from '../services/pos/posService.js';

// ── Daily Menu Sync ───────────────────────────────────────────────────────────

/**
 * Schedule a daily menu sync at 06:00 AM server time.
 *
 * Pipeline (파이프라인):
 *   1. Fetch all stores that have a pos_api_key (pos_api_key가 있는 모든 매장 조회)
 *   2. Loop through each store and call syncMenuFromLoyverse (각 매장별 syncMenuFromLoyverse 호출)
 *   3. Log success and failure per store (매장별 성공·실패 로깅)
 *
 * Errors are caught per-store so one failing sync does not abort the rest.
 * (오류는 매장별로 포착 — 하나의 동기화 실패가 나머지를 중단하지 않음)
 */
cron.schedule('0 6 * * *', async () => {
  console.log(
    '[CronJobs] Daily menu sync started (일별 메뉴 동기화 시작)'
  );

  // Fetch all stores that have a Loyverse API key configured
  // (Loyverse API 키가 설정된 모든 매장 조회)
  const { data: stores, error: fetchError } = await supabase
    .from('stores')
    .select('id, name, pos_api_key')  // 'name' is the correct stores column — not 'store_name' (올바른 stores 컬럼명은 'name' — 'store_name' 아님)
    .not('pos_api_key', 'is', null);

  if (fetchError) {
    console.error(
      `[CronJobs] Failed to fetch stores for menu sync | ${fetchError.message} ` +
      `(메뉴 동기화를 위한 매장 조회 실패 | 오류: ${fetchError.message})`
    );
    return;
  }

  if (!stores?.length) {
    // No stores configured with a POS API key — nothing to sync (POS API 키가 설정된 매장 없음 — 동기화 대상 없음)
    console.log('[CronJobs] No stores with pos_api_key found — skipping sync (pos_api_key가 있는 매장 없음 — 동기화 건너뜀)');
    return;
  }

  console.log(
    `[CronJobs] Syncing menu for ${stores.length} store(s) ` +
    `(${stores.length}개 매장 메뉴 동기화 중)`
  );

  // Process stores sequentially to avoid Loyverse API rate limits
  // (Loyverse API 속도 제한 방지를 위해 매장을 순차적으로 처리)
  for (const store of stores) {
    try {
      // ── Menu sync ─────────────────────────────────────────────────────────
      // Runs first — inventory sync depends on variant_id rows already existing
      // (먼저 실행 — 재고 동기화는 variant_id 행이 이미 존재해야 함)
      const menuResult = await syncMenuFromLoyverse(store.id, store.pos_api_key);

      if (menuResult.success) {
        console.log(
          `[CronJobs] Menu sync success | store: ${store.name} (${store.id}) | ` +
          `synced: ${menuResult.synced} variants from ${menuResult.itemCount} items ` +
          `(메뉴 동기화 성공 | 매장: ${store.name} | 동기화: ${menuResult.itemCount}개 항목의 ${menuResult.synced}개 변형)`
        );
      } else {
        console.error(
          `[CronJobs] Menu sync failed | store: ${store.name} (${store.id}) | ${menuResult.error} ` +
          `(메뉴 동기화 실패 | 매장: ${store.name} | 오류: ${menuResult.error})`
        );
      }

      // ── Inventory sync ────────────────────────────────────────────────────
      // Always runs after menu sync regardless of menu sync result — keeps stock current
      // (메뉴 동기화 결과에 상관없이 항상 이후에 실행 — 재고 최신 유지)
      const invResult = await syncInventoryFromLoyverse(store.id, store.pos_api_key);

      if (invResult.success) {
        console.log(
          `[CronJobs] Inventory sync success | store: ${store.name} (${store.id}) | ` +
          `synced: ${invResult.synced}/${invResult.total} levels ` +
          `(재고 동기화 성공 | 매장: ${store.name} | 동기화: ${invResult.synced}/${invResult.total}개 레벨)`
        );
      } else {
        console.error(
          `[CronJobs] Inventory sync failed | store: ${store.name} (${store.id}) | ${invResult.error} ` +
          `(재고 동기화 실패 | 매장: ${store.name} | 오류: ${invResult.error})`
        );
      }
    } catch (err) {
      // Unexpected error — log and continue to the next store (예기치 않은 오류 — 로깅 후 다음 매장으로 계속)
      console.error(
        `[CronJobs] Unexpected error during full sync | store: ${store.name} (${store.id}) | ${err.message} ` +
        `(전체 동기화 중 예기치 않은 오류 | 매장: ${store.name} | 오류: ${err.message})`
      );
    }
  }

  console.log(
    '[CronJobs] Daily menu sync complete (일별 메뉴 동기화 완료)'
  );
});

console.log('[CronJobs] Scheduler initialised — daily menu sync at 06:00 AM (스케줄러 초기화 완료 — 매일 오전 6시 메뉴 동기화)');
