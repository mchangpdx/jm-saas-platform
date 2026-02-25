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

// ── Shared background sync helper ────────────────────────────────────────────

/**
 * Fetch all stores with a pos_api_key and run syncMenuFromLoyverse for each.
 * Shared by all three Loyverse webhook endpoints to avoid code duplication.
 * (pos_api_key가 있는 모든 매장 조회 후 syncMenuFromLoyverse 실행.
 *  코드 중복 방지를 위해 세 Loyverse 웹훅 엔드포인트가 공유)
 *
 * @param {string} triggerLabel — label used in log lines to identify which event fired (어떤 이벤트가 발생했는지 식별하는 로그 레이블)
 */
async function runBackgroundSync(triggerLabel) {
  console.log(
    `[WebhookRoute] Background menu re-sync triggered by ${triggerLabel} ` +
    `(${triggerLabel}에 의해 백그라운드 메뉴 재동기화 트리거)`
  );

  const { data: stores, error: fetchError } = await supabase
    .from('stores')
    .select('id, name, pos_api_key')
    .not('pos_api_key', 'is', null);

  if (fetchError || !stores?.length) {
    console.error(
      `[WebhookRoute] Failed to fetch stores for ${triggerLabel} sync | ` +
      `${fetchError?.message ?? 'no stores found'} ` +
      `(${triggerLabel} 동기화를 위한 매장 조회 실패 | 오류: ${fetchError?.message ?? '매장 없음'})`
    );
    return;
  }

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

  console.log(`[WebhookRoute] Background webhook sync complete | trigger: ${triggerLabel} (백그라운드 웹훅 동기화 완료 | 트리거: ${triggerLabel})`);
}

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

  // Fire-and-forget background sync — detached from the HTTP request lifecycle
  // (파이어 앤 포겟 백그라운드 동기화 — HTTP 요청 라이프사이클에서 분리)
  runBackgroundSync('items.update webhook').catch((err) => {
    console.error(`[WebhookRoute] Unhandled error in runBackgroundSync | ${err.message} (runBackgroundSync 미처리 오류)`);
  });
});

// ── POST /loyverse/receipts ───────────────────────────────────────────────────

/**
 * Receive real-time receipt update notifications from Loyverse.
 *
 * Pipeline (파이프라인):
 *   1. Immediately return 200 OK so Loyverse does not retry or time out
 *      (즉시 200 OK 반환 — Loyverse 재시도 및 타임아웃 방지)
 *   2. In the background, loop through req.body.receipts and upsert each
 *      record into the loyverse_receipts table, keyed on receipt id
 *      (백그라운드에서 req.body.receipts를 순회하며 loyverse_receipts 테이블에 upsert)
 */
webhookRouter.post('/loyverse/receipts', (req, res) => {
  // Log incoming payload keys for debugging (디버깅을 위해 수신 페이로드 키 로깅)
  console.log(
    '[WebhookRoute] Loyverse receipt update received | payload keys: ' +
    `${Object.keys(req.body ?? {}).join(', ')} ` +
    `(Loyverse 영수증 업데이트 수신 | 페이로드 키: ${Object.keys(req.body ?? {}).join(', ')})`
  );

  // Acknowledge immediately — Loyverse requires a fast 200 to avoid retries
  // (즉시 확인 — Loyverse 재시도 방지를 위해 빠른 200 응답 필수)
  res.status(200).send('OK');

  // Fire-and-forget — parse receipts array and upsert into loyverse_receipts
  // (파이어 앤 포겟 — receipts 배열을 파싱하여 loyverse_receipts에 upsert)
  const receipts = req.body?.receipts ?? [];

  (async () => {
    for (const receipt of receipts) {
      try {
        // Upsert receipt row; on duplicate id, overwrite with latest data
        // (중복 id 발생 시 최신 데이터로 덮어쓰는 upsert 실행)
        const { error } = await supabase
          .from('loyverse_receipts')
          .upsert(
            {
              id:             receipt.id,
              store_id:       receipt.store_id,
              receipt_number: receipt.receipt_number,
              total_money:    receipt.total_money,
              receipt_date:   receipt.receipt_date,
              raw_data:       receipt,            // Store full payload for future reference (미래 참조를 위해 전체 페이로드 저장)
            },
            { onConflict: 'id' }
          );

        if (error) {
          console.error(
            `[WebhookRoute] Failed to upsert receipt | id: ${receipt.id} | ${error.message} ` +
            `(영수증 upsert 실패 | id: ${receipt.id} | 오류: ${error.message})`
          );
        } else {
          console.log(
            `[WebhookRoute] Receipt upserted | id: ${receipt.id} | number: ${receipt.receipt_number} ` +
            `(영수증 upsert 성공 | id: ${receipt.id} | 번호: ${receipt.receipt_number})`
          );
        }
      } catch (err) {
        // Unexpected per-receipt error — log and continue to next receipt
        // (예기치 않은 영수증별 오류 — 로깅 후 다음 영수증으로 계속)
        console.error(
          `[WebhookRoute] Unexpected error upserting receipt | id: ${receipt.id} | ${err.message} ` +
          `(영수증 upsert 중 예기치 않은 오류 | id: ${receipt.id} | 오류: ${err.message})`
        );
      }
    }

    console.log(
      `[WebhookRoute] Receipt webhook processing complete | count: ${receipts.length} ` +
      `(영수증 웹훅 처리 완료 | 건수: ${receipts.length})`
    );
  })().catch((err) => {
    console.error(
      `[WebhookRoute] Unhandled error in receipts background handler | ${err.message} ` +
      `(영수증 백그라운드 핸들러 미처리 오류 | ${err.message})`
    );
  });
});

// ── POST /loyverse/inventory_levels ──────────────────────────────────────────

/**
 * Receive real-time inventory level update notifications from Loyverse.
 *
 * Pipeline (파이프라인):
 *   1. Immediately return 200 OK so Loyverse does not retry or time out
 *      (즉시 200 OK 반환 — Loyverse 재시도 및 타임아웃 방지)
 *   2. In the background, loop through req.body.inventory_levels and update
 *      stock_quantity on the matching menu_items row by variant_id
 *      (백그라운드에서 req.body.inventory_levels를 순회하며 variant_id로 menu_items의 stock_quantity 업데이트)
 */
webhookRouter.post('/loyverse/inventory_levels', (req, res) => {
  // Log incoming payload keys for debugging (디버깅을 위해 수신 페이로드 키 로깅)
  console.log(
    '[WebhookRoute] Loyverse inventory level update received | payload keys: ' +
    `${Object.keys(req.body ?? {}).join(', ')} ` +
    `(Loyverse 재고 수준 업데이트 수신 | 페이로드 키: ${Object.keys(req.body ?? {}).join(', ')})`
  );

  // Acknowledge immediately — Loyverse requires a fast 200 to avoid retries
  // (즉시 확인 — Loyverse 재시도 방지를 위해 빠른 200 응답 필수)
  res.status(200).send('OK');

  // Fire-and-forget — parse inventory_levels array and update stock_quantity per variant
  // (파이어 앤 포겟 — inventory_levels 배열을 파싱하여 variant별 stock_quantity 업데이트)
  const levels = req.body?.inventory_levels ?? [];

  (async () => {
    for (const level of levels) {
      try {
        // Update stock_quantity for the matching menu_items row by variant_id
        // (variant_id로 일치하는 menu_items 행의 stock_quantity 업데이트)
        const { error } = await supabase
          .from('menu_items')
          .update({ stock_quantity: level.in_stock })
          .eq('variant_id', level.variant_id);

        if (error) {
          console.error(
            `[WebhookRoute] Failed to update stock_quantity | variant_id: ${level.variant_id} | ${error.message} ` +
            `(stock_quantity 업데이트 실패 | variant_id: ${level.variant_id} | 오류: ${error.message})`
          );
        } else {
          console.log(
            `[WebhookRoute] Stock updated | variant_id: ${level.variant_id} | in_stock: ${level.in_stock} ` +
            `(재고 업데이트 성공 | variant_id: ${level.variant_id} | 재고: ${level.in_stock})`
          );
        }
      } catch (err) {
        // Unexpected per-level error — log and continue to next level
        // (예기치 않은 재고 항목별 오류 — 로깅 후 다음 항목으로 계속)
        console.error(
          `[WebhookRoute] Unexpected error updating stock | variant_id: ${level.variant_id} | ${err.message} ` +
          `(재고 업데이트 중 예기치 않은 오류 | variant_id: ${level.variant_id} | 오류: ${err.message})`
        );
      }
    }

    console.log(
      `[WebhookRoute] Inventory webhook processing complete | count: ${levels.length} ` +
      `(재고 웹훅 처리 완료 | 건수: ${levels.length})`
    );
  })().catch((err) => {
    console.error(
      `[WebhookRoute] Unhandled error in inventory_levels background handler | ${err.message} ` +
      `(재고 수준 백그라운드 핸들러 미처리 오류 | ${err.message})`
    );
  });
});
