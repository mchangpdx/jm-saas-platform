// Payment routes — mock payment gateway callback handler for MVP
// (결제 라우트 — MVP용 목 결제 게이트웨이 콜백 핸들러)
//
// Mounted at /api/payment in app.js.
// In production, replace the mock endpoint with real PG webhook handlers.
// (app.js에서 /api/payment에 마운트.
//  프로덕션에서는 목 엔드포인트를 실제 PG 웹훅 핸들러로 교체)

import { Router } from 'express';
import { supabase }    from '../config/supabase.js';
import { injectOrder } from '../services/pos/posService.js';

export const paymentRouter = Router();

// ── HTML Page Builders ────────────────────────────────────────────────────────

/**
 * Render the payment success HTML page returned to the customer's browser.
 * Uses inline CSS for broad compatibility — no external stylesheet dependencies.
 * (고객 브라우저에 반환되는 결제 성공 HTML 페이지 렌더링.
 *  외부 스타일시트 의존성 없이 광범위한 호환성을 위해 인라인 CSS 사용)
 *
 * @param {string} orderId — confirmed order ID to display (표시할 확인된 주문 ID)
 * @returns {string} complete HTML document (완성된 HTML 문서)
 */
function buildSuccessPage(orderId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Successful</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f0fdf4; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
  <div style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); padding: 48px 40px; max-width: 480px; width: 90%; text-align: center;">

    <!-- Success icon (성공 아이콘) -->
    <div style="width: 72px; height: 72px; background-color: #22c55e; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 36px; line-height: 72px;">
      ✅
    </div>

    <!-- Heading (제목) -->
    <h1 style="margin: 0 0 12px; font-size: 26px; font-weight: bold; color: #15803d;">
      Payment Successful!
    </h1>

    <!-- Confirmation message (확인 메시지) -->
    <p style="margin: 0 0 28px; font-size: 16px; color: #374151; line-height: 1.6;">
      Your order has been confirmed and sent to the kitchen.
    </p>

    <!-- Order ID badge (주문 ID 배지) -->
    <div style="background-color: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 14px 20px; margin-bottom: 28px;">
      <span style="font-size: 13px; color: #6b7280; display: block; margin-bottom: 4px;">Order ID</span>
      <span style="font-size: 14px; font-weight: bold; color: #166534; font-family: monospace;">${orderId}</span>
    </div>

    <!-- Closing note (마무리 안내) -->
    <p style="margin: 0; font-size: 14px; color: #9ca3af;">
      Thank you for your order. You will receive a confirmation shortly.
    </p>

  </div>
</body>
</html>`;
}

/**
 * Render the payment error HTML page returned when the DB update fails.
 * (DB 업데이트 실패 시 반환되는 결제 오류 HTML 페이지 렌더링)
 *
 * @param {string} orderId — order ID that failed (실패한 주문 ID)
 * @param {string} reason  — short reason string for display (표시용 짧은 이유)
 * @returns {string} complete HTML document (완성된 HTML 문서)
 */
function buildErrorPage(orderId, reason) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Payment Error</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #fef2f2; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
  <div style="background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); padding: 48px 40px; max-width: 480px; width: 90%; text-align: center;">

    <!-- Error icon (오류 아이콘) -->
    <div style="width: 72px; height: 72px; background-color: #ef4444; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; font-size: 36px; line-height: 72px;">
      ❌
    </div>

    <!-- Heading (제목) -->
    <h1 style="margin: 0 0 12px; font-size: 26px; font-weight: bold; color: #b91c1c;">
      Payment Could Not Be Confirmed
    </h1>

    <!-- Error message (오류 메시지) -->
    <p style="margin: 0 0 28px; font-size: 16px; color: #374151; line-height: 1.6;">
      We were unable to confirm your payment. Please contact us directly and provide your order ID.
    </p>

    <!-- Order ID badge (주문 ID 배지) -->
    <div style="background-color: #fef2f2; border: 1px solid #fca5a5; border-radius: 8px; padding: 14px 20px; margin-bottom: 28px;">
      <span style="font-size: 13px; color: #6b7280; display: block; margin-bottom: 4px;">Order ID</span>
      <span style="font-size: 14px; font-weight: bold; color: #991b1b; font-family: monospace;">${orderId}</span>
    </div>

    <!-- Reason detail (오류 세부 사항) -->
    <p style="margin: 0; font-size: 13px; color: #9ca3af;">
      Reason: ${reason}
    </p>

  </div>
</body>
</html>`;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/payment/mock/:orderId
 *
 * Mock payment gateway callback — simulates a successful card payment.
 *
 * Pipeline (파이프라인):
 *   1. Fetch the current order row to read status and store_id
 *      (현재 주문 행 조회 — status와 store_id 읽기)
 *   2. IDEMPOTENCY CHECK — if status is already 'paid', return the success page
 *      immediately without touching the DB or POS again. Protects against
 *      double-clicks and duplicate webhook deliveries.
 *      (멱등성 확인 — status가 이미 'paid'이면 DB·POS 재처리 없이 성공 페이지 즉시 반환.
 *       더블클릭 및 중복 웹훅 방지)
 *   3. Fetch the store row using order.store_id to obtain the dynamic pos_api_key.
 *      The POS key lives in the DB, never in .env.
 *      (order.store_id로 매장 행 조회 → 동적 pos_api_key 획득.
 *       POS 키는 DB에 있음 — .env에 절대 없음)
 *   4. Update orders.status → 'paid' (orders.status → 'paid' 업데이트)
 *   5. Inject the order into Loyverse POS via posService.injectOrder().
 *      POS failure is non-fatal — the customer already paid; log and continue.
 *      (posService.injectOrder()로 Loyverse POS에 주문 주입.
 *       POS 실패는 치명적이지 않음 — 고객은 이미 결제함 — 로깅 후 계속)
 *   6. Return success HTML page to the customer's browser
 *      (고객 브라우저에 성공 HTML 페이지 반환)
 *
 * In production, replace with a real PG webhook that validates a signature before updating.
 * (프로덕션에서는 서명 검증 후 업데이트하는 실제 PG 웹훅으로 교체)
 */
paymentRouter.get('/mock/:orderId', async (req, res) => {
  const { orderId } = req.params; // Order ID from the payment link URL (결제 링크 URL의 주문 ID)

  console.log(
    `[Payment] Mock callback received | orderId: ${orderId} ` +
    `(목 결제 콜백 수신 | 주문: ${orderId})`
  );

  // ── Step 1: Fetch the current order row ────────────────────────────────────
  // Select all columns so we can pass the full row to the POS injector later.
  // (이후 POS 주입에 전체 행을 전달할 수 있도록 모든 컬럼 조회)
  const { data: order, error: fetchError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (fetchError || !order) {
    // Order not found — could be a stale or tampered link (주문 없음 — 오래된 링크 또는 변조된 링크)
    console.error(
      `[Payment] Order not found | orderId: ${orderId} | ${fetchError?.message ?? 'no row returned'} ` +
      `(주문 없음 | 주문: ${orderId} | 오류: ${fetchError?.message ?? '행 없음'})`
    );
    return res
      .status(404)
      .send(buildErrorPage(orderId, 'Order not found. The link may have expired.'));
  }

  // ── Step 2: Idempotency guard ──────────────────────────────────────────────
  // If the order is already paid, return the success page without any side effects.
  // This handles: user double-clicking the email link, browser retries, duplicate PG callbacks.
  // (이미 결제된 주문 — 부작용 없이 성공 페이지 반환.
  //  이메일 링크 더블클릭, 브라우저 재시도, 중복 PG 콜백 처리)
  if (order.status === 'paid') {
    console.log(
      `[Payment] Order already paid — returning success page without re-processing | orderId: ${orderId} ` +
      `(이미 결제된 주문 — 재처리 없이 성공 페이지 반환 | 주문: ${orderId})`
    );
    return res.status(200).send(buildSuccessPage(orderId));
  }

  // ── Step 3: Fetch store row for dynamic POS API key ────────────────────────
  // The pos_api_key is stored per-tenant in the stores table, not in .env.
  // This allows each store to use its own Loyverse account independently.
  // (pos_api_key는 테넌트별로 stores 테이블에 저장 — .env 아님.
  //  각 매장이 독립된 Loyverse 계정을 사용할 수 있음)
  const { data: storeData, error: storeError } = await supabase
    .from('stores')
    .select('pos_api_key')
    .eq('id', order.store_id)
    .single();

  if (storeError || !storeData) {
    // Store not found — log but do not block payment; POS injection will be skipped
    // (매장 없음 — 로깅 후 결제 진행 — POS 주입 건너뜀)
    console.error(
      `[Payment] Store not found for order | orderId: ${orderId} | store_id: ${order.store_id} | ` +
      `${storeError?.message ?? 'no row returned'} ` +
      `(주문의 매장 없음 | 주문: ${orderId} | 매장: ${order.store_id})`
    );
  }

  // ── Step 4: Mark order as paid ─────────────────────────────────────────────
  // Only reached when the current status is NOT 'paid' — prevents double updates.
  // (현재 status가 'paid'가 아닐 때만 도달 — 이중 업데이트 방지)
  const { error: updateError } = await supabase
    .from('orders')
    .update({ status: 'paid' })
    .eq('id', orderId);

  if (updateError) {
    // DB update failed — log and return error page to the customer (DB 업데이트 실패 — 로깅 후 고객에게 오류 페이지 반환)
    console.error(
      `[Payment] DB update failed | orderId: ${orderId} | ${updateError.message} ` +
      `(DB 업데이트 실패 | 주문: ${orderId} | 오류: ${updateError.message})`
    );
    return res
      .status(500)
      .send(buildErrorPage(orderId, 'Database update failed. Please contact support.'));
  }

  console.log(
    `[Payment] Order marked as paid | orderId: ${orderId} ` +
    `(주문 결제 완료 처리 | 주문: ${orderId})`
  );

  // ── Step 5: Return success page immediately ───────────────────────────────
  // The DB update is complete — the payment is confirmed. Send the response NOW
  // so the customer's browser does not wait for the Loyverse network call.
  // POS injection runs in the background after the response is flushed.
  // (DB 업데이트 완료 — 결제 확정. 지금 즉시 응답 전송.
  //  고객 브라우저가 Loyverse 네트워크 호출을 기다리지 않도록.
  //  POS 주입은 응답 플러시 후 백그라운드에서 실행)
  res.status(200).send(buildSuccessPage(orderId));

  // ── Step 6: True fire-and-forget POS injection via setTimeout ────────────
  // setTimeout(fn, 0) pushes the callback to the next iteration of the event loop,
  // fully detaching POS work from this HTTP request's call stack.
  // The customer's browser receives the success page before any Loyverse I/O begins.
  // POS failure is non-fatal: the payment record is already 'paid' in the DB.
  // (setTimeout(fn, 0)으로 콜백을 다음 이벤트 루프 반복으로 밀어넣어
  //  POS 작업을 HTTP 요청 콜 스택에서 완전히 분리.
  //  Loyverse I/O 시작 전에 고객 브라우저에 성공 페이지 전달.
  //  POS 실패는 치명적이지 않음 — 결제 기록이 DB에 이미 'paid'로 저장됨)
  const posApiKey = storeData?.pos_api_key ?? null;
  setTimeout(() => {
    injectOrder(order, posApiKey).catch((posErr) => {
      // Background POS injection error — log thoroughly for ops visibility (백그라운드 POS 주입 오류 — 운영 가시성을 위해 상세 로깅)
      console.error(
        `[Payment] Background POS injection failed | orderId: ${orderId} | ${posErr.message} ` +
        `(백그라운드 POS 주입 실패 | 주문: ${orderId} | 오류: ${posErr.message})`
      );
    });
  }, 0);
});
