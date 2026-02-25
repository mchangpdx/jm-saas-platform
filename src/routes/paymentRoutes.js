// Payment routes — mock payment gateway callback handler for MVP
// (결제 라우트 — MVP용 목 결제 게이트웨이 콜백 핸들러)
//
// Mounted at /api/payment in app.js.
// In production, replace the mock endpoint with real PG webhook handlers.
// (app.js에서 /api/payment에 마운트.
//  프로덕션에서는 목 엔드포인트를 실제 PG 웹훅 핸들러로 교체)

import { Router } from 'express';
import { supabase } from '../config/supabase.js';

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
 * Steps:
 *   1. Extract orderId from URL params (URL 파라미터에서 orderId 추출)
 *   2. Update orders.status to 'paid' in Supabase (Supabase orders.status를 'paid'로 업데이트)
 *   3. Return a success HTML page or an error HTML page (성공/오류 HTML 페이지 반환)
 *
 * This endpoint is the target of the payment link sent to the customer via email/SMS.
 * In production, replace with a real PG webhook that validates a signature before updating.
 * (이 엔드포인트는 이메일/SMS로 전송된 결제 링크의 대상.
 *  프로덕션에서는 서명 검증 후 업데이트하는 실제 PG 웹훅으로 교체)
 */
paymentRouter.get('/mock/:orderId', async (req, res) => {
  const { orderId } = req.params; // Order ID from the payment link URL (결제 링크 URL의 주문 ID)

  console.log(
    `[Payment] Mock callback received | orderId: ${orderId} (목 결제 콜백 수신 | 주문: ${orderId})`
  );

  // Update the order status to 'paid' in the database (데이터베이스에서 주문 상태를 'paid'로 업데이트)
  const { error } = await supabase
    .from('orders')
    .update({ status: 'paid' })
    .eq('id', orderId);

  if (error) {
    // Log the DB error and return a user-facing error page (DB 오류 로깅 및 사용자용 오류 페이지 반환)
    console.error(
      `[Payment] DB update failed | orderId: ${orderId} | ${error.message} ` +
      `(DB 업데이트 실패 | 주문: ${orderId} | 오류: ${error.message})`
    );
    return res
      .status(500)
      .send(buildErrorPage(orderId, 'Database update failed. Please contact support.'));
  }

  console.log(
    `[Payment] Order marked as paid | orderId: ${orderId} (주문 결제 완료 처리 | 주문: ${orderId})`
  );

  // Return the success page — the customer sees this in their browser after clicking the link
  // (고객이 링크 클릭 후 브라우저에서 보는 성공 페이지 반환)
  return res.status(200).send(buildSuccessPage(orderId));
});
