// POS management routes — menu sync endpoint for Loyverse catalog synchronization
// (POS 관리 라우트 — Loyverse 카탈로그 동기화를 위한 메뉴 동기화 엔드포인트)
//
// Mounted at /api/pos in app.js.
// (app.js에서 /api/pos에 마운트)

import { Router } from 'express';
import { supabase }              from '../config/supabase.js';
import { syncMenuFromLoyverse }  from '../services/pos/posService.js';

export const posRouter = Router();

/**
 * GET /api/pos/sync/:storeId
 *
 * Trigger a Loyverse catalog sync for the given store.
 * Fetches all items from Loyverse /items, upserts into menu_items,
 * and updates stores.menu_cache with a formatted summary string.
 *
 * Safe to call repeatedly — upsert on (store_id, variant_id) is idempotent.
 *
 * (주어진 매장에 대해 Loyverse 카탈로그 동기화 트리거.
 *  Loyverse /items에서 모든 항목 조회 → menu_items 업서트 → stores.menu_cache 업데이트.
 *  반복 호출 안전 — (store_id, variant_id) 업서트는 멱등성 보장)
 */
posRouter.get('/sync/:storeId', async (req, res) => {
  const { storeId } = req.params; // Store UUID from URL parameter (URL 파라미터의 매장 UUID)

  console.log(
    `[PosRoute] Menu sync requested | storeId: ${storeId} ` +
    `(메뉴 동기화 요청 | 매장: ${storeId})`
  );

  // Fetch the store's POS API key from Supabase (Supabase에서 매장 POS API 키 조회)
  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('pos_api_key')
    .eq('id', storeId)
    .single();

  if (storeError || !store) {
    console.error(
      `[PosRoute] Store not found | storeId: ${storeId} | ` +
      `${storeError?.message ?? 'no row returned'} ` +
      `(매장 없음 | 매장: ${storeId})`
    );
    return res.status(404).json({
      error:   'Store not found',
      storeId,
      message: '매장을 찾을 수 없습니다.',
    });
  }

  // Run the sync — returns { success, synced, itemCount } or { success: false, error }
  // (동기화 실행 — { success, synced, itemCount } 또는 { success: false, error } 반환)
  const result = await syncMenuFromLoyverse(storeId, store.pos_api_key);

  if (!result.success) {
    console.error(
      `[PosRoute] Menu sync failed | storeId: ${storeId} | error: ${result.error} ` +
      `(메뉴 동기화 실패 | 매장: ${storeId})`
    );
    return res.status(502).json({
      error:   result.error,
      storeId,
      message: '메뉴 동기화 실패.',
    });
  }

  console.log(
    `[PosRoute] Menu sync complete | storeId: ${storeId} | synced: ${result.synced} variants ` +
    `(메뉴 동기화 완료 | 매장: ${storeId} | 동기화된 변형: ${result.synced}개)`
  );

  return res.json({
    success:   true,
    storeId,
    synced:    result.synced,
    itemCount: result.itemCount,
    message:   `Menu synced: ${result.synced} variants from ${result.itemCount} items.`,
  });
});
