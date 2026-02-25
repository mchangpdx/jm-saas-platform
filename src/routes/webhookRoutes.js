// Webhook routes — real-time Loyverse item update handler
// (웹훅 라우트 — 실시간 Loyverse 항목 업데이트 핸들러)
//
// Mounted at /api/webhooks in app.js.
// Loyverse sends a POST to /api/webhooks/loyverse/items whenever catalog items change.
// (app.js에서 /api/webhooks에 마운트.
//  카탈로그 항목 변경 시 Loyverse가 /api/webhooks/loyverse/items로 POST 전송)

import { Router } from 'express';
import { supabase }             from '../config/supabase.js';
import { syncMenuFromLoyverse } from '../services/pos/posService.js';

export const webhookRouter = Router();

// ── POST /loyverse/items ──────────────────────────────────────────────────────

/**
 * Receive real-time item update notifications from Loyverse.
 *
 * Pipeline (파이프라인):
 *   1. Immediately return 200 OK so Loyverse does not retry or time out
 *      (즉시 200 OK 반환 — Loyverse 재시도 및 타임아웃 방지)
 *   2. In the background, fetch all stores with a pos_api_key and trigger
 *      syncMenuFromLoyverse for each one
 *      (백그라운드에서 pos_api_key가 있는 모든 매장 조회 후 동기화 트리거)
 *
 * The 200 response is sent before any sync I/O starts — Loyverse receives
 * its acknowledgement within milliseconds regardless of sync duration.
 * (동기화 I/O 시작 전에 200 응답 전송 — 동기화 소요 시간과 무관하게 Loyverse가 즉시 확인)
 */
webhookRouter.post('/loyverse/items', (req, res) => {
  // Log the raw payload for debugging — useful for identifying merchant-specific fields later
  // (디버깅을 위해 원시 페이로드 로깅 — 나중에 가맹점별 필드 식별에 유용)
  console.log(
    '[WebhookRoute] Loyverse item update received | payload keys: ' +
    `${Object.keys(req.body ?? {}).join(', ')} ` +
    `(Loyverse 항목 업데이트 수신 | 페이로드 키: ${Object.keys(req.body ?? {}).join(', ')})`
  );

  // Acknowledge immediately — Loyverse requires a fast 200 to avoid retries
  // (즉시 확인 — Loyverse 재시도 방지를 위해 빠른 200 응답 필수)
  res.status(200).send('OK');

  // Background sync — detached from the HTTP request lifecycle via setTimeout
  // (백그라운드 동기화 — setTimeout으로 HTTP 요청 라이프사이클에서 분리)
  setTimeout(async () => {
    console.log('[WebhookRoute] Background menu re-sync triggered by Loyverse webhook (Loyverse 웹훅으로 백그라운드 메뉴 재동기화 트리거)');

    // Fetch all stores that have a Loyverse API key configured
    // (Loyverse API 키가 설정된 모든 매장 조회)
    const { data: stores, error: fetchError } = await supabase
      .from('stores')
      .select('id, name, pos_api_key')  // 'name' is the correct stores column — not 'store_name' (올바른 stores 컬럼명은 'name' — 'store_name' 아님)
      .not('pos_api_key', 'is', null);

    if (fetchError || !stores?.length) {
      console.error(
        `[WebhookRoute] Failed to fetch stores for webhook-triggered sync | ` +
        `${fetchError?.message ?? 'no stores found'} ` +
        `(웹훅 트리거 동기화를 위한 매장 조회 실패 | 오류: ${fetchError?.message ?? '매장 없음'})`
      );
      return;
    }

    // Sync each store sequentially to respect Loyverse API rate limits
    // (Loyverse API 속도 제한 준수를 위해 매장별 순차 동기화)
    for (const store of stores) {
      try {
        // Log the store name before each sync so progress is visible in server output (동기화 전 매장명 로깅 — 서버 출력에서 진행 상황 확인)
        console.log(
          `[WebhookRoute] Starting background menu sync for store: ${store.name} (${store.id}) ` +
          `(백그라운드 메뉴 동기화 시작 | 매장: ${store.name} (${store.id}))`
        );
        const result = await syncMenuFromLoyverse(store.id, store.pos_api_key);

        if (result.success) {
          console.log(
            `[WebhookRoute] Webhook sync success | store: ${store.name} (${store.id}) | ` +
            `synced: ${result.synced} variants from ${result.itemCount} items ` +
            `(웹훅 동기화 성공 | 매장: ${store.name} | 동기화: ${result.itemCount}개 항목의 ${result.synced}개 변형)`
          );
        } else {
          console.error(
            `[WebhookRoute] Webhook sync failed | store: ${store.name} (${store.id}) | ${result.error} ` +
            `(웹훅 동기화 실패 | 매장: ${store.name} | 오류: ${result.error})`
          );
        }
      } catch (err) {
        // Per-store error — log and continue to next store (매장별 오류 — 로깅 후 다음 매장으로 계속)
        console.error(
          `[WebhookRoute] Unexpected error during webhook sync | store: ${store.name} (${store.id}) | ${err.message} ` +
          `(웹훅 동기화 중 예기치 않은 오류 | 매장: ${store.name} | 오류: ${err.message})`
        );
      }
    }

    console.log('[WebhookRoute] Background webhook sync complete (백그라운드 웹훅 동기화 완료)');
  }, 0);
});
