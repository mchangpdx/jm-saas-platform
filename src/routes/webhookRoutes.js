// Webhook routes — real-time Loyverse event handlers for items, receipts, inventory, and customers.
// Handles four Loyverse webhook event types:
//   items.update            → POST /api/webhooks/loyverse/items
//   receipts.update         → POST /api/webhooks/loyverse/receipts
//   inventory_levels.update → POST /api/webhooks/loyverse/inventory_levels
//   customer.created        → POST /api/webhooks/loyverse/customers
//   customer.updated        → POST /api/webhooks/loyverse/customers
// Mounted at /api/webhooks in app.js.
// Direct-to-DB architecture: item and inventory webhooks update menu_items directly
// without a pos_items staging intermediary. Customer webhooks upsert into the
// customers table to maintain bi-directional sync with Loyverse.
// Each handler follows the fire-and-forget contract: respond 200 immediately,
// then process the payload asynchronously so Loyverse never times out waiting.
//
// Multi-tenant store resolution for customer webhooks:
//   Loyverse does not embed our internal store UUID in the webhook payload.
//   Two resolution strategies are used in order:
//     1. ?store_id=<uuid> query parameter — operators append this when registering
//        the webhook URL in the Loyverse dashboard (recommended for new installs).
//     2. Lookup by pos_customer_id — for customer.updated events where the customer
//        was previously synced, the existing row's store_id is used.
//   If neither strategy resolves a store_id the customer entry is skipped safely.
// (실시간 Loyverse 항목, 영수증, 재고, 고객 이벤트 핸들러.
//  네 가지 Loyverse 웹훅 이벤트 유형 처리.
//  app.js에서 /api/webhooks에 마운트.
//  Direct-to-DB 아키텍처: 항목·재고 웹훅이 pos_items 없이 menu_items 직접 업데이트.
//  고객 웹훅은 customers 테이블 upsert로 Loyverse와 양방향 동기화 유지.
//  각 핸들러는 파이어 앤 포겟 계약을 따름.
//  다중 테넌트 store_id 해결: ①?store_id 쿼리 파라미터, ②pos_customer_id 조회 순)

import { Router }   from 'express';
import { supabase } from '../config/supabase.js';

export const webhookRouter = Router();

// ── POST /loyverse/items ──────────────────────────────────────────────────────

/**
 * Receive real-time items.update notifications from Loyverse.
 *
 * Pipeline (파이프라인):
 *   1. Immediately return 200 OK so Loyverse does not retry or time out.
 *      (즉시 200 OK 반환 — Loyverse 재시도 및 타임아웃 방지)
 *   2. In the background, iterate over every item → variant in the payload.
 *      For each variant_id, update name, price, and promoted_at in menu_items
 *      directly — no pos_items guard or promotion check needed.
 *      (백그라운드에서 페이로드의 모든 항목 → 변형 순회.
 *       각 variant_id마다 menu_items의 name, price, promoted_at을 직접 업데이트 —
 *       pos_items 가드 또는 승격 확인 불필요)
 *
 * category is intentionally NOT updated here: the webhook payload contains only
 * category_id (UUID), not the human-readable name. It will be resolved correctly
 * on the next syncAllToLive run.
 * (category는 의도적으로 업데이트하지 않음: 웹훅 페이로드에는 category_id(UUID)만 포함,
 *  사람이 읽을 수 있는 이름은 없음. 다음 syncAllToLive 실행 시 올바르게 해결됨)
 *
 * menu_items rows that don't exist yet (item not yet synced) result in no-op UPDATEs.
 * (아직 존재하지 않는 menu_items 행은 no-op UPDATE — 안전하고 예상된 동작)
 */
webhookRouter.post('/loyverse/items', (req, res) => {
  // Log the raw payload keys so field names are visible in server logs during testing
  // (테스트 중 서버 로그에서 필드명 확인을 위해 원시 페이로드 키 로깅)
  console.log(
    '[WebhookRoute] Loyverse items.update received | payload keys: ' +
    `${Object.keys(req.body ?? {}).join(', ')} ` +
    `(Loyverse items.update 수신 | 페이로드 키: ${Object.keys(req.body ?? {}).join(', ')})`
  );

  // Acknowledge immediately — Loyverse requires a fast 200 to avoid marking delivery as failed
  // (즉시 확인 — Loyverse가 전송 실패로 표시하지 않도록 빠른 200 필수)
  res.status(200).send('OK');

  // Snapshot the items array from the payload before the async loop starts
  // (비동기 루프 시작 전 페이로드에서 items 배열 스냅샷)
  const payloadItems = req.body?.items ?? [];

  // Fire-and-forget — detached from the HTTP request lifecycle
  // (파이어 앤 포겟 — HTTP 요청 라이프사이클에서 분리)
  (async () => {
    for (const item of payloadItems) {
      const itemName = item.item_name ?? null; // Display name from webhook payload (웹훅 페이로드의 표시명)
      const variants = item.variants    ?? []; // All variants for this item (이 항목의 모든 변형)

      for (const variant of variants) {
        const variantId = variant.variant_id;
        if (!variantId) continue; // Skip malformed entries missing variant_id (variant_id 없는 잘못된 항목 건너뜀)

        // Resolve price: per-store override in stores[0] → variant default_price → 0.
        // Mirrors the price resolution logic in LoyverseAdapter.fetchItems.
        // (가격 결정: stores[0] 매장별 재정의 → variant default_price → 0.
        //  LoyverseAdapter.fetchItems의 가격 결정 로직과 동일)
        const storeEntry = (variant.stores && variant.stores.length > 0) ? variant.stores[0] : null;
        const price = (storeEntry?.price !== null && storeEntry?.price !== undefined)
          ? storeEntry.price
          : (variant.default_price || 0);

        try {
          // Safety check + update in one query: .select() returns the affected rows.
          // If data is empty the variant is not yet in menu_items (item was never synced)
          // — skip the update to avoid inserting phantom rows outside the manual sync flow.
          // (안전 확인 + 업데이트를 한 번의 쿼리로: .select()가 영향받은 행을 반환.
          //  data가 비어 있으면 variant가 아직 menu_items에 없음(항목이 아직 동기화되지 않음)
          //  — 수동 동기화 흐름 밖에서 팬텀 행 삽입을 피하기 위해 업데이트 건너뜀)
          const { data: updated, error: menuErr } = await supabase
            .from('menu_items')
            .update({
              name:        itemName,
              price:       parseFloat(price),
              promoted_at: new Date().toISOString(), // Refresh last-updated timestamp (마지막 업데이트 타임스탬프 갱신)
            })
            .eq('variant_id', variantId)
            .select('variant_id'); // Return affected rows to detect no-op (no-op 감지를 위해 영향받은 행 반환)

          if (menuErr) {
            console.error(
              `[WebhookRoute] menu_items item update failed | variant_id: ${variantId} | ${menuErr.message} ` +
              `(menu_items 항목 업데이트 실패 | variant_id: ${variantId} | 오류: ${menuErr.message})`
            );
          } else if (!updated || updated.length === 0) {
            // Variant not yet in menu_items — not an error, just needs a manual Sync Now first
            // (variant가 아직 menu_items에 없음 — 오류 아님, 먼저 수동 Sync Now 필요)
            console.log(
              `[WebhookRoute] item.updated skipped — variant not in menu_items yet | variant_id: ${variantId} ` +
              `(item.updated 건너뜀 — variant가 아직 menu_items에 없음 | variant_id: ${variantId})`
            );
          } else {
            console.log(
              `[WebhookRoute] menu_items item updated | variant_id: ${variantId} | name: "${itemName}" | price: ${price} ` +
              `(menu_items 항목 업데이트 완료 | variant_id: ${variantId} | 이름: "${itemName}" | 가격: ${price})`
            );
          }
        } catch (err) {
          // Unexpected per-variant error — log and continue to the next variant
          // (예기치 않은 변형별 오류 — 로깅 후 다음 변형으로 계속)
          console.error(
            `[WebhookRoute] Unexpected error updating item | variant_id: ${variantId} | ${err.message} ` +
            `(항목 업데이트 중 예기치 않은 오류 | variant_id: ${variantId} | 오류: ${err.message})`
          );
        }
      }
    }

    console.log(
      `[WebhookRoute] Item webhook processing complete | items: ${payloadItems.length} ` +
      `(항목 웹훅 처리 완료 | 항목 수: ${payloadItems.length})`
    );
  })().catch((err) => {
    console.error(
      `[WebhookRoute] Unhandled error in items background handler | ${err.message} ` +
      `(항목 백그라운드 핸들러 미처리 오류 | 오류: ${err.message})`
    );
  });
});

// ── POST /loyverse/receipts ───────────────────────────────────────────────────

/**
 * Receive real-time receipts.update notifications from Loyverse.
 *
 * Pipeline (파이프라인):
 *   1. Immediately return 200 OK so Loyverse does not retry or time out.
 *      (즉시 200 OK 반환 — Loyverse 재시도 및 타임아웃 방지)
 *   2. In the background, loop through req.body.receipts and upsert each
 *      record into the loyverse_receipts table, keyed on receipt id.
 *      (백그라운드에서 req.body.receipts를 순회하며
 *       loyverse_receipts 테이블에 receipt id 기준으로 upsert)
 */
webhookRouter.post('/loyverse/receipts', (req, res) => {
  // Log incoming payload keys for debugging (디버깅을 위해 수신 페이로드 키 로깅)
  console.log(
    '[WebhookRoute] Loyverse receipts.update received | payload keys: ' +
    `${Object.keys(req.body ?? {}).join(', ')} ` +
    `(Loyverse receipts.update 수신 | 페이로드 키: ${Object.keys(req.body ?? {}).join(', ')})`
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
        // Upsert receipt row; on duplicate id, overwrite with latest data.
        // receipt_number is the stable Loyverse identifier — falls back to receipt.id
        // then a timestamp-keyed surrogate.
        // (중복 id 발생 시 최신 데이터로 덮어쓰는 upsert 실행.
        //  receipt_number가 기본 식별자 — receipt.id, 타임스탬프 대체키 순으로 폴백)
        const { error } = await supabase
          .from('loyverse_receipts')
          .upsert(
            {
              id:             receipt.receipt_number || receipt.id || `receipt-${Date.now()}`,
              store_id:       receipt.store_id || req.body.merchant_id, // Fall back to root merchant_id when store_id is absent (receipt 객체에 store_id 없을 때 루트 merchant_id로 폴백)
              receipt_number: receipt.receipt_number,
              total_money:    receipt.total_money,
              receipt_date:   receipt.receipt_date,
              raw_data:       receipt, // Store full payload for future reference (미래 참조를 위해 전체 페이로드 저장)
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
 * Receive real-time inventory_levels.update notifications from Loyverse.
 *
 * Pipeline (파이프라인):
 *   1. Immediately return 200 OK so Loyverse does not retry or time out.
 *      (즉시 200 OK 반환 — Loyverse 재시도 및 타임아웃 방지)
 *   2. In the background, loop through req.body.inventory_levels and update
 *      stock_quantity on the matching menu_items row by variant_id directly.
 *      (백그라운드에서 req.body.inventory_levels를 순회하며
 *       variant_id로 menu_items의 stock_quantity를 직접 업데이트)
 *
 * Direct-to-DB architecture: no pos_items staging update needed.
 * (Direct-to-DB 아키텍처: pos_items 스테이징 업데이트 불필요)
 */
webhookRouter.post('/loyverse/inventory_levels', (req, res) => {
  // Log incoming payload keys for debugging (디버깅을 위해 수신 페이로드 키 로깅)
  console.log(
    '[WebhookRoute] Loyverse inventory_levels.update received | payload keys: ' +
    `${Object.keys(req.body ?? {}).join(', ')} ` +
    `(Loyverse inventory_levels.update 수신 | 페이로드 키: ${Object.keys(req.body ?? {}).join(', ')})`
  );

  // Acknowledge immediately — Loyverse requires a fast 200 to avoid retries
  // (즉시 확인 — Loyverse 재시도 방지를 위해 빠른 200 응답 필수)
  res.status(200).send('OK');

  // Fire-and-forget — update stock_quantity in menu_items directly for each level entry
  // (파이어 앤 포겟 — 각 레벨 항목에 대해 menu_items의 stock_quantity 직접 업데이트)
  const levels = req.body?.inventory_levels ?? [];

  (async () => {
    for (const level of levels) {
      const { variant_id, in_stock } = level;
      if (!variant_id) continue; // Skip malformed entries missing variant_id (variant_id 없는 잘못된 항목 건너뜀)

      try {
        // Safety check + update in one query: .select() returns the affected rows.
        // If data is empty the variant is not yet in menu_items — skip to avoid phantom rows.
        // (안전 확인 + 업데이트를 한 번의 쿼리로: .select()가 영향받은 행을 반환.
        //  data가 비어 있으면 variant가 아직 menu_items에 없음 — 팬텀 행 방지를 위해 건너뜀)
        const { data: updated, error: menuErr } = await supabase
          .from('menu_items')
          .update({ stock_quantity: in_stock })
          .eq('variant_id', variant_id)
          .select('variant_id'); // Return affected rows to detect no-op (no-op 감지를 위해 영향받은 행 반환)

        if (menuErr) {
          console.error(
            `[WebhookRoute] menu_items stock update failed | variant_id: ${variant_id} | ${menuErr.message} ` +
            `(menu_items 재고 업데이트 실패 | variant_id: ${variant_id} | 오류: ${menuErr.message})`
          );
        } else if (!updated || updated.length === 0) {
          // Variant not yet in menu_items — not an error, item needs a manual Sync Now first
          // (variant가 아직 menu_items에 없음 — 오류 아님, 먼저 수동 Sync Now 필요)
          console.log(
            `[WebhookRoute] inventory.updated skipped — variant not in menu_items yet | variant_id: ${variant_id} ` +
            `(inventory.updated 건너뜀 — variant가 아직 menu_items에 없음 | variant_id: ${variant_id})`
          );
        } else {
          console.log(
            `[WebhookRoute] menu_items stock updated | variant_id: ${variant_id} | in_stock: ${in_stock} ` +
            `(menu_items 재고 업데이트 완료 | variant_id: ${variant_id} | 재고: ${in_stock})`
          );
        }
      } catch (err) {
        // Unexpected per-level error — log and continue to next level
        // (예기치 않은 재고 항목별 오류 — 로깅 후 다음 항목으로 계속)
        console.error(
          `[WebhookRoute] Unexpected error updating stock | variant_id: ${variant_id} | ${err.message} ` +
          `(재고 업데이트 중 예기치 않은 오류 | variant_id: ${variant_id} | 오류: ${err.message})`
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

// ── POST /loyverse/customers ──────────────────────────────────────────────────

/**
 * Receive real-time customer.created and customer.updated notifications from Loyverse.
 * Upserts each customer into our local customers table to maintain bi-directional
 * consistency between Loyverse POS and our CRM without requiring a manual sync run.
 * (Loyverse customer.created 및 customer.updated 실시간 알림 수신.
 *  각 고객을 로컬 customers 테이블에 upsert하여 수동 동기화 없이
 *  Loyverse POS와 CRM 간 양방향 일관성 유지)
 *
 * Pipeline (파이프라인):
 *   1. Immediately return 200 OK so Loyverse does not retry or time out.
 *      (즉시 200 OK 반환 — Loyverse 재시도 및 타임아웃 방지)
 *   2. Resolve store_id via two strategies in order of preference:
 *        a. ?store_id=<uuid> query parameter — operators append this when registering
 *           the Loyverse webhook URL (recommended). Example URL:
 *           https://your-server.com/api/webhooks/loyverse/customers?store_id=UUID
 *        b. Lookup by pos_customer_id in the customers table — handles customer.updated
 *           events where the customer was previously synced via POST /api/sync/customers.
 *      (store_id 해결: ①?store_id 쿼리 파라미터, ②pos_customer_id 조회 순)
 *   3. Normalise phone to XXX-XXX-XXXX — same format used by syncCustomersFromPos
 *      and injectCustomerToCrmAndPos to ensure consistent dedup key matching.
 *      (전화번호 XXX-XXX-XXXX 정규화 — syncCustomersFromPos/injectCustomerToCrmAndPos와 동일)
 *   4. Upsert on (store_id, phone) — matches the actual customers table unique constraint.
 *      When phone is absent, fall back to update-by-pos_customer_id so name/email are
 *      still refreshed even when no valid phone number is available.
 *      ((store_id, phone) upsert — 실제 customers 테이블 고유 제약 조건과 일치.
 *       전화번호 없을 시 pos_customer_id로 업데이트 폴백 — 이름/이메일 갱신 보장)
 *
 * Note: total_orders is NOT touched here — this handler syncs profile data only.
 * Order counts are managed by injectCustomerToCrmAndPos during live voice calls.
 * (total_orders는 여기서 수정하지 않음 — 이 핸들러는 프로필 데이터만 동기화.
 *  주문 횟수는 음성 통화 중 injectCustomerToCrmAndPos가 관리)
 */
webhookRouter.post('/loyverse/customers', (req, res) => {
  // Log incoming payload type and customer count for diagnostics
  // (진단을 위해 수신 페이로드 유형과 고객 수 로깅)
  const eventType    = req.body?.type ?? 'unknown';
  const rawCustomers = req.body?.customers ?? [];

  console.log(
    `[WebhookRoute] Loyverse customer webhook received | type: ${eventType} | ` +
    `count: ${rawCustomers.length} | store_id_param: ${req.query?.store_id ?? 'none'} ` +
    `(Loyverse 고객 웹훅 수신 | 유형: ${eventType} | 고객 수: ${rawCustomers.length})`
  );

  // Acknowledge immediately — Loyverse requires a fast 200 to avoid marking delivery as failed
  // (즉시 확인 — Loyverse가 전송 실패로 표시하지 않도록 빠른 200 필수)
  res.status(200).send('OK');

  // Snapshot before async work — avoids referencing req after the response is sent
  // (비동기 작업 전 스냅샷 — 응답 전송 후 req 참조 방지)
  const storeIdFromQuery = req.query?.store_id ?? null;

  // Fire-and-forget — detached from the HTTP request lifecycle
  // (파이어 앤 포겟 — HTTP 요청 라이프사이클에서 분리)
  (async () => {
    for (const customer of rawCustomers) {
      // pos_customer_id is the Loyverse customer UUID — used as a stable identifier
      // for store_id resolution on customer.updated events where a prior record exists.
      // (pos_customer_id는 Loyverse 고객 UUID — 기존 레코드가 있는 customer.updated 이벤트에서
      //  store_id 해결을 위한 안정적인 식별자)
      const posCustomerId = customer.id ?? null;
      if (!posCustomerId) {
        console.warn(
          '[WebhookRoute] customer.upsert skipped — missing customer id (고객 id 없음 — 건너뜀)'
        );
        continue;
      }

      // ── Step 1: Resolve store_id ──────────────────────────────────────────
      //
      // Strategy a: use ?store_id from the webhook registration URL (preferred).
      // Strategy b: look up an existing customers row by pos_customer_id.
      //   This handles customer.updated events where the record was created by a prior
      //   manual sync (POST /api/sync/customers) or a save_customer_consent tool call.
      //
      // If neither strategy succeeds the entry is logged and skipped — no orphan rows.
      // (전략 a: 웹훅 등록 URL의 ?store_id 사용(권장).
      //  전략 b: pos_customer_id로 기존 customers 행 조회.
      //  두 전략 모두 실패 시 로깅 후 건너뜀 — 고아 행 없음)
      let storeId = storeIdFromQuery;

      if (!storeId) {
        // Strategy b — look up by pos_customer_id to find a previously synced record.
        // maybeSingle() returns null (not an error) when no row is found.
        // (전략 b — pos_customer_id로 이전에 동기화된 레코드 조회.
        //  maybeSingle()은 행 없을 때 오류가 아닌 null 반환)
        const { data: existing, error: lookupErr } = await supabase
          .from('customers')
          .select('store_id')
          .eq('pos_customer_id', posCustomerId)
          .maybeSingle();

        if (lookupErr) {
          console.error(
            `[WebhookRoute] store_id lookup by pos_customer_id failed | ` +
            `pos_customer_id: ${posCustomerId} | ${lookupErr.message} ` +
            `(pos_customer_id로 store_id 조회 실패 | 오류: ${lookupErr.message})`
          );
        } else if (existing) {
          storeId = existing.store_id;
        }
      }

      if (!storeId) {
        // Neither strategy resolved a store — skip safely.
        // Operators should register the webhook URL with ?store_id=<uuid> to prevent this.
        // (두 전략 모두 실패 — 안전하게 건너뜀.
        //  운영자는 이 상황을 방지하기 위해 ?store_id=<uuid>로 웹훅 URL 등록 권장)
        console.warn(
          `[WebhookRoute] customer.upsert skipped — could not resolve store_id | ` +
          `pos_customer_id: ${posCustomerId} | ` +
          `Tip: register webhook URL with ?store_id=<your-store-uuid> ` +
          `(store_id 해결 불가 — 건너뜀 | 웹훅 URL에 ?store_id=<uuid> 추가 권장)`
        );
        continue;
      }

      // ── Step 2: Check for deletion before any upsert work ───────────────
      //
      // Loyverse does NOT send a dedicated "customer.deleted" event type.
      // Instead it reuses "customer.updated" and populates deleted_at with an
      // ISO timestamp when the customer is removed from the POS system.
      // Without this guard the handler would blindly upsert a deleted profile
      // back into our DB — keeping a stale record Loyverse no longer has.
      //
      // Delete is scoped to (store_id, pos_customer_id) for tenant isolation.
      // If the row was never synced to our DB the DELETE is a silent no-op — safe.
      // (Loyverse는 별도의 "customer.deleted" 이벤트 유형을 전송하지 않음.
      //  대신 "customer.updated"를 재사용하고 고객이 POS에서 제거될 때
      //  deleted_at에 ISO 타임스탬프를 채워 전송.
      //  이 가드 없이는 삭제된 프로필을 DB에 다시 upsert — Loyverse에 더 이상 없는 오래된 레코드 유지.
      //  삭제는 테넌트 격리를 위해 (store_id, pos_customer_id) 범위로 제한.
      //  행이 DB에 없으면 DELETE는 무음 no-op — 안전)
      if (customer.deleted_at !== null && customer.deleted_at !== undefined) {
        // Primary delete: filter by (store_id, pos_customer_id).
        // This matches rows that had pos_customer_id written back after a successful
        // Loyverse POST via save_customer_consent (the normal path post-fix).
        // (프라이머리 삭제: (store_id, pos_customer_id)로 필터링.
        //  save_customer_consent를 통한 Loyverse POST 성공 후 pos_customer_id가 역기록된 행과 매칭.)
        const { error: deleteErr } = await supabase
          .from('customers')
          .delete()
          .eq('store_id', storeId)
          .eq('pos_customer_id', posCustomerId);

        if (deleteErr) {
          console.error(
            `[WebhookRoute] customer delete (by pos_customer_id) failed | ` +
            `pos_customer_id: ${posCustomerId} | store: ${storeId} | ${deleteErr.message} ` +
            `(pos_customer_id 기반 고객 삭제 실패 | 오류: ${deleteErr.message})`
          );
        } else {
          console.log(
            `[WebhookRoute] customer deleted (by pos_customer_id) | ` +
            `pos_customer_id: ${posCustomerId} | store: ${storeId} | deleted_at: ${customer.deleted_at} ` +
            `(pos_customer_id 기반 고객 삭제 완료)`
          );
        }

        // Fallback delete: filter by (store_id, phone) for legacy rows where
        // pos_customer_id was never written back (created before the write-back fix).
        // Normalise phone the same way injectCustomerToCrmAndPos does: last 10 digits → XXX-XXX-XXXX.
        // A no-op when the primary delete already removed the row — safe to always run.
        // (폴백 삭제: pos_customer_id가 역기록되지 않은 레거시 행을 (store_id, phone)으로 처리.
        //  역기록 수정 전에 생성된 행 대상. 프라이머리 삭제로 이미 제거된 경우 no-op — 항상 실행해도 안전)
        const rawDeletePhone  = customer.phone_number ?? customer.phone ?? '';
        const deleteDigits    = rawDeletePhone.replace(/\D/g, '').slice(-10);
        const normalizedPhone = deleteDigits.length === 10
          ? `${deleteDigits.slice(0, 3)}-${deleteDigits.slice(3, 6)}-${deleteDigits.slice(6)}`
          : null;

        if (normalizedPhone) {
          const { error: fallbackDeleteErr } = await supabase
            .from('customers')
            .delete()
            .eq('store_id', storeId)
            .eq('phone', normalizedPhone);

          if (fallbackDeleteErr) {
            console.error(
              `[WebhookRoute] customer delete (by phone fallback) failed | ` +
              `phone: ${normalizedPhone} | store: ${storeId} | ${fallbackDeleteErr.message} ` +
              `(phone 기반 폴백 고객 삭제 실패 | 오류: ${fallbackDeleteErr.message})`
            );
          } else {
            console.log(
              `[WebhookRoute] customer delete (by phone fallback) completed | ` +
              `phone: ${normalizedPhone} | store: ${storeId} ` +
              `(phone 기반 폴백 고객 삭제 완료 — 레거시 행 대상)`
            );
          }
        }

        continue; // Skip the upsert path — this customer no longer exists in Loyverse (이 고객은 Loyverse에서 더 이상 존재하지 않으므로 upsert 경로 건너뜀)
      }

      // ── Step 3: Normalise phone to XXX-XXX-XXXX ──────────────────────────
      // Strips country code, spaces, dashes, and parentheses.
      // Result must be exactly 10 NANP digits to be a valid dedup key.
      // When phone is null or invalid, fall back to update-by-pos_customer_id path below.
      // (국가 코드·공백·대시·괄호 제거. 결과는 정확히 10자리 NANP이어야 유효한 중복 방지 키.
      //  전화번호가 null 또는 유효하지 않으면 아래 pos_customer_id 업데이트 폴백)
      const rawPhone = customer.phone_number ?? customer.phone ?? '';
      const digits   = rawPhone.replace(/\D/g, '').slice(-10);
      const phone    = digits.length === 10
        ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`
        : null;

      // Build the display name — prefer top-level name, fall back to joined first + last.
      // (표시명 구성 — 최상위 name 우선, 없으면 first_name + last_name 조합)
      const name = customer.name
        || [customer.first_name, customer.last_name].filter(Boolean).join(' ').trim()
        || null;

      const email = customer.email ?? null;

      try {
        if (phone) {
          // ── Happy path: upsert on (store_id, phone) ────────────────────
          // Matches the unique constraint used by syncCustomersFromPos and the
          // injectCustomerToCrmAndPos Supabase write.
          // total_orders is intentionally excluded — this sync does not represent
          // a new transaction; order counts are managed by the voice call pipeline.
          // (syncCustomersFromPos 및 injectCustomerToCrmAndPos와 동일한 고유 제약 조건 사용.
          //  total_orders는 의도적으로 제외 — 이 동기화는 새 거래를 나타내지 않음.
          //  주문 횟수는 음성 통화 파이프라인이 관리)
          const { error: upsertErr } = await supabase
            .from('customers')
            .upsert(
              {
                store_id:        storeId,
                phone,
                name,
                email,
                pos_customer_id: posCustomerId,
              },
              { onConflict: 'store_id,phone' }
            );

          if (upsertErr) {
            console.error(
              `[WebhookRoute] customer upsert failed | pos_customer_id: ${posCustomerId} | ` +
              `phone: ${phone} | ${upsertErr.message} ` +
              `(고객 upsert 실패 | 오류: ${upsertErr.message})`
            );
          } else {
            console.log(
              `[WebhookRoute] customer upserted | pos_customer_id: ${posCustomerId} | ` +
              `phone: ${phone} | store: ${storeId} | type: ${eventType} ` +
              `(고객 upsert 완료 | 유형: ${eventType})`
            );
          }

        } else {
          // ── Fallback: update name/email by pos_customer_id when phone is absent ──
          // Cannot upsert without a phone because (store_id, phone) is the unique
          // constraint and NULL in a unique column causes ambiguous conflict resolution.
          // Update-only is safe — if no row exists the UPDATE is a no-op (0 rows affected).
          // (전화번호 없을 때 pos_customer_id로 이름/이메일만 업데이트.
          //  전화번호 없이 upsert 불가 — NULL은 고유 제약 조건에서 충돌 해결 모호.
          //  행 없으면 UPDATE는 no-op — 안전)
          const { error: updateErr } = await supabase
            .from('customers')
            .update({ name, email })
            .eq('store_id', storeId)
            .eq('pos_customer_id', posCustomerId);

          if (updateErr) {
            console.error(
              `[WebhookRoute] customer update (no-phone fallback) failed | ` +
              `pos_customer_id: ${posCustomerId} | ${updateErr.message} ` +
              `(전화번호 없는 고객 업데이트 실패 | 오류: ${updateErr.message})`
            );
          } else {
            console.log(
              `[WebhookRoute] customer updated (no phone) | pos_customer_id: ${posCustomerId} | ` +
              `store: ${storeId} ` +
              `(전화번호 없는 고객 업데이트 완료)`
            );
          }
        }

      } catch (err) {
        // Unexpected per-customer error — log and continue to the next customer
        // (예기치 않은 고객별 오류 — 로깅 후 다음 고객으로 계속)
        console.error(
          `[WebhookRoute] Unexpected error processing customer | ` +
          `pos_customer_id: ${posCustomerId} | ${err.message} ` +
          `(고객 처리 중 예기치 않은 오류 | 오류: ${err.message})`
        );
      }
    }

    console.log(
      `[WebhookRoute] Customer webhook processing complete | type: ${eventType} | ` +
      `count: ${rawCustomers.length} ` +
      `(고객 웹훅 처리 완료 | 유형: ${eventType} | 고객 수: ${rawCustomers.length})`
    );

  })().catch((err) => {
    console.error(
      `[WebhookRoute] Unhandled error in customers background handler | ${err.message} ` +
      `(고객 백그라운드 핸들러 미처리 오류 | 오류: ${err.message})`
    );
  });
});

// ── POST /retell ──────────────────────────────────────────────────────────────

/**
 * Receive call_analyzed events from Retell AI and persist them to call_logs.
 *
 * Pipeline (파이프라인):
 *   1. X-Ray log — print entire payload so every field Retell sends is visible.
 *      (X-Ray 로그 — Retell이 전송하는 모든 필드 확인을 위해 전체 페이로드 출력)
 *   2. Immediately return 200 OK before any async work — prevents Retell retries.
 *      (비동기 작업 전 즉시 200 OK 반환 — Retell 재시도 방지)
 *   3. In the background, filter non-target events, resolve store_id via the
 *      agents table, and upsert the call record into call_logs on call_id.
 *      (백그라운드에서 비대상 이벤트 필터링, agents 테이블로 store_id 확인,
 *       call_id 기준으로 call_logs에 upsert)
 *
 * Idempotency: upsert on call_id — safe against Retell duplicate deliveries.
 * (멱등성: call_id 기준 upsert — Retell 중복 전송에 안전)
 */
webhookRouter.post('/retell', (req, res) => {
  // X-Ray log — print the full incoming payload before any processing.
  // JSON.stringify with indentation makes multi-field payloads readable in server logs.
  // (전체 수신 페이로드를 처리 전에 출력하는 X-Ray 로그.
  //  들여쓰기로 JSON.stringify하여 서버 로그에서 다중 필드 페이로드 가독성 향상)
  console.log('🔥 RETELL WEBHOOK PAYLOAD:', JSON.stringify(req.body, null, 2));

  // Acknowledge immediately — Retell requires a fast 200 to avoid marking delivery as failed.
  // All real work happens asynchronously below, detached from this HTTP response.
  // (즉시 확인 — Retell이 전송 실패로 표시하지 않도록 빠른 200 필수.
  //  실제 작업은 이 HTTP 응답에서 분리되어 비동기적으로 처리됨)
  res.status(200).send('OK');

  // Snapshot req.body before entering the async closure — req is no longer safe to read
  // after the response has been sent and the event loop has moved on.
  // (비동기 클로저 진입 전 req.body 스냅샷 — 응답 전송 후 req 참조는 안전하지 않음)
  const body = req.body ?? {};

  // Fire-and-forget — detached from the HTTP request lifecycle.
  // (파이어 앤 포겟 — HTTP 요청 라이프사이클에서 분리)
  (async () => {

    // ── Step 1: Extract and validate the event type ───────────────────────

    // Log the event type on every delivery — surfaces non-target events in server logs.
    // (모든 전송에서 이벤트 타입 로그 — 서버 로그에서 비대상 이벤트 표시)
    const event = body.event ?? null;
    console.log(
      `[RetellWebhook] Incoming event type (수신 이벤트 타입): ${event}`
    );

    // Skip every event other than call_analyzed — Retell sends many event types here.
    // (call_analyzed 이외의 모든 이벤트 건너뜀 — Retell이 다양한 이벤트 타입 전송)
    if (event !== 'call_analyzed') {
      console.log(
        `[RetellWebhook] Skipping event (이벤트 스킵): ${event}`
      );
      return;
    }

    // ── Step 2: Extract call fields from the payload ──────────────────────

    // Retell wraps all call data under the "call" key (Retell은 모든 통화 데이터를 "call" 키 아래에 래핑)
    const call = body.call ?? {};

    const call_id         = call.call_id         ?? null;
    const agent_id        = call.agent_id         ?? null;
    const start_timestamp = call.start_timestamp  ?? null; // Unix ms from Retell (Retell의 Unix 밀리초)
    const duration_ms     = call.duration_ms      ?? null;
    const user_sentiment  = call.user_sentiment   ?? null;
    const call_status     = call.call_status      ?? null;
    const cost            = call.cost             ?? null;
    const recording_url   = call.recording_url    ?? null;

    // call_analysis sub-object holds the AI-generated summary and transcript.
    // (call_analysis 하위 객체에 AI 생성 요약 및 트랜스크립트 포함)
    const call_analysis      = call.call_analysis ?? {};
    const summary            = call_analysis.call_summary      ?? null;
    const transcript_object  = call_analysis.transcript_object ?? null; // Passed as JSONB — Supabase serialises automatically (JSONB로 전달 — Supabase가 자동 직렬화)

    // Validate the minimum required fields before touching the database.
    // (데이터베이스 접근 전 최소 필수 필드 검증)
    if (!call_id || !agent_id) {
      console.warn(
        `[RetellWebhook] Missing call_id or agent_id — skipping insert ` +
        `(call_id 또는 agent_id 누락 — 삽입 건너뜀) | call_id: ${call_id} | agent_id: ${agent_id}`
      );
      return;
    }

    // ── Step 3: Resolve store_id via the agents table ─────────────────────

    // The agents table maps each Retell agent_id to our internal store_id.
    // This is the same lookup used by the Next.js webhook receiver.
    // (agents 테이블이 각 Retell agent_id를 내부 store_id에 매핑.
    //  Next.js 웹훅 수신기와 동일한 조회 방식)
    let store_id = null;

    try {
      const { data: agentRow, error: agentError } = await supabase
        .from('agents')
        .select('store_id')
        .eq('agent_id', agent_id)
        .maybeSingle();

      if (agentError) {
        // DB read error — log exact message and continue with null store_id.
        // (DB 읽기 오류 — 정확한 메시지 로그 후 null store_id로 계속)
        console.error(
          `[RetellWebhook] agents table lookup failed (agents 테이블 조회 실패) | ` +
          `agent_id: ${agent_id} | error: ${agentError.message}`
        );
      } else if (!agentRow) {
        // agent_id not registered — common with Retell's Test button dummy data.
        // Log a clear warning and proceed; the call log will be stored with null store_id.
        // (agent_id 미등록 — Retell 테스트 버튼 더미 데이터에서 자주 발생.
        //  명확한 경고 로그 후 진행 — 통화 로그는 null store_id로 저장됨)
        console.log(`⚠️ No store found for agent: ${agent_id} — proceeding with null store_id (에이전트에 대한 매장 없음 — null store_id로 진행)`);
      } else {
        store_id = agentRow.store_id;
      }
    } catch (lookupErr) {
      // Unexpected exception during lookup — log and continue with null store_id.
      // (조회 중 예기치 않은 예외 — 로그 후 null store_id로 계속)
      console.error(
        `[RetellWebhook] Unexpected error during agent lookup (에이전트 조회 중 예기치 않은 오류) | ` +
        `agent_id: ${agent_id} | ${lookupErr.message}`
      );
    }

    // ── Step 4: Map fields and upsert into call_logs ──────────────────────

    // Convert start_timestamp from Unix ms to ISO-8601 string for the timestamptz column.
    // (Unix ms를 timestamptz 컬럼용 ISO-8601 문자열로 변환)
    const start_timestamp_iso = start_timestamp
      ? new Date(start_timestamp).toISOString()
      : null;

    // Build the row to upsert — mirrors the call_logs schema exactly.
    // transcript_object is stored as JSONB; pass the raw object and Supabase handles serialisation.
    // (upsert할 행 구성 — call_logs 스키마와 정확히 일치.
    //  transcript_object는 JSONB로 저장 — 원시 객체를 전달하면 Supabase가 직렬화 처리)
    const callLogRow = {
      call_id,
      agent_id,
      store_id,
      start_timestamp:   start_timestamp_iso,
      duration_ms,
      user_sentiment,
      call_status,
      cost,
      recording_url,
      summary,
      transcript_object, // Stored as JSONB in Supabase — do NOT JSON.stringify before inserting (Supabase에 JSONB로 저장 — 삽입 전 JSON.stringify 금지)
    };

    try {
      // Upsert on call_id to make this handler idempotent against Retell duplicate deliveries.
      // (Retell 중복 전송에 대한 멱등성 보장을 위해 call_id 기준 upsert)
      const { error: insertError } = await supabase
        .from('call_logs')
        .upsert(callLogRow, { onConflict: 'call_id' });

      if (insertError) {
        // Log the exact database insertion error for triage in server logs.
        // (서버 로그에서 트리아지를 위해 정확한 데이터베이스 삽입 오류 로그)
        console.error(
          `[RetellWebhook] Failed to upsert call_log — exact error (통화 로그 upsert 실패 — 정확한 오류) | ` +
          `call_id: ${call_id} | ${insertError.message}`
        );
      } else {
        // Success log — confirms which call was stored and to which store.
        // (성공 로그 — 저장된 통화와 해당 매장 확인)
        console.log(
          `[RetellWebhook] call_analyzed stored successfully (통화 분석 저장 완료) | ` +
          `call_id: ${call_id} | store_id: ${store_id}`
        );
      }
    } catch (insertErr) {
      // Catch unexpected DB client exceptions — log the exact error message for triage.
      // (예상치 못한 DB 클라이언트 예외 캐치 — 트리아지를 위해 정확한 오류 메시지 로그)
      console.error(
        `[RetellWebhook] DB upsert threw an exception (DB upsert 예외 발생) | ` +
        `call_id: ${call_id} | ${insertErr.message}`
      );
    }

  })().catch((err) => {
    // Top-level catch for any unhandled promise rejection in the background handler.
    // (백그라운드 핸들러의 미처리 프로미스 거부를 위한 최상위 캐치)
    console.error(
      `[RetellWebhook] Unhandled error in background handler (백그라운드 핸들러 미처리 오류) | ` +
      `${err.message}`
    );
  });
});
