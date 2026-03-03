// syncRoutes — Express router for Direct-to-DB POS sync endpoints.
// Single sync route: POST /api/sync/all triggers syncAllToLive for the given store.
// Customer sync remains separate as it does not involve menu_items.
// All inputs are validated before calling the service layer so service functions
// never receive undefined storeId.
// (Direct-to-DB POS 동기화 엔드포인트용 Express 라우터.
//  단일 동기화 라우트: POST /api/sync/all이 주어진 매장의 syncAllToLive 트리거.
//  고객 동기화는 menu_items와 무관하여 별도 유지.
//  서비스 함수에 undefined storeId가 전달되지 않도록 서비스 계층 호출 전 모든 입력 검증)

import { Router }             from 'express';
import { syncAllToLive }      from '../services/posSyncService.js';
import { syncCustomersFromPos } from '../services/syncManager.js';

export const syncRouter = Router();

// ── POST /api/sync/all ────────────────────────────────────────────────────────
//
// Full Direct-to-DB sync: fetches the complete Loyverse catalog and upserts
// all variants directly into menu_items in a single batch.
// Writes 'running' to sync_logs at start and 'success'|'failed' at end.
// Safe to call repeatedly — upserts are idempotent on variant_id.
// Body: { storeId: string }
//
// (전체 Direct-to-DB 동기화: 전체 Loyverse 카탈로그를 가져와
//  모든 변형을 단일 배치로 menu_items에 직접 업서트.
//  시작 시 sync_logs에 'running' 기록, 종료 시 'success'|'failed' 기록.
//  반복 호출 안전 — variant_id 기준 업서트는 멱등성 보장.
//  바디: { storeId: string })
syncRouter.post('/all', async (req, res) => {
  console.log('[Server Trace] Received Body:', req.body); // Log raw body for debugging (디버깅용 원시 바디 로깅)
  const { storeId } = req.body;

  // Reject requests missing the required storeId field (필수 storeId 필드 누락 요청 거부)
  if (!storeId) {
    return res.status(400).json({
      success: false,
      error: 'storeId is required in the request body.',
    });
  }

  console.log(
    `[SyncRoute] POST /api/sync/all | storeId: ${storeId} ` +
    `(전체 Direct-to-DB 동기화 요청 | 매장: ${storeId})`
  );

  const result = await syncAllToLive(storeId);

  if (!result.success) {
    // Service layer returned a structured failure — propagate as 500
    // (서비스 계층이 구조화된 실패 반환 — 500으로 전파)
    return res.status(500).json(result);
  }

  console.log(
    `[SyncRoute] POST /api/sync/all complete | storeId: ${storeId} | synced: ${result.synced} ` +
    `(전체 동기화 완료 | 매장: ${storeId} | 동기화: ${result.synced}개)`
  );

  return res.json(result);
});

// ── POST /api/sync/customers ──────────────────────────────────────────────────
//
// Pulls the full Loyverse customer list for a store and upserts into the
// customers table keyed on (store_id, customer_phone). Phone numbers are
// normalised to XXX-XXX-XXXX; customers without a valid 10-digit number are skipped.
// Safe to call repeatedly — upserts are idempotent.
// Body: { storeId: string }
//
// (매장의 전체 Loyverse 고객 목록을 가져와 (store_id, customer_phone) 키로
//  customers 테이블에 업서트. 전화번호는 XXX-XXX-XXXX로 정규화;
//  유효한 10자리 번호가 없는 고객은 건너뜀.
//  반복 호출 안전 — 업서트는 멱등성 보장.
//  바디: { storeId: string })
syncRouter.post('/customers', async (req, res) => {
  console.log('[Server Trace] Received Body:', req.body); // Log raw body for debugging (디버깅용 원시 바디 로깅)
  const { storeId } = req.body;

  // Reject requests missing the required storeId field (필수 storeId 필드 누락 요청 거부)
  if (!storeId) {
    return res.status(400).json({
      success: false,
      error: 'storeId is required in the request body.',
    });
  }

  console.log(
    `[SyncRoute] POST /api/sync/customers | storeId: ${storeId} ` +
    `(고객 동기화 요청 | 매장: ${storeId})`
  );

  const result = await syncCustomersFromPos(storeId);

  if (!result.success) {
    // Service layer returned a structured failure — propagate as 500
    // (서비스 계층이 구조화된 실패 반환 — 500으로 전파)
    return res.status(500).json(result);
  }

  console.log(
    `[SyncRoute] POST /api/sync/customers complete | storeId: ${storeId} | synced: ${result.synced} ` +
    `(고객 동기화 완료 | 매장: ${storeId} | 동기화 수: ${result.synced})`
  );

  return res.json(result);
});
