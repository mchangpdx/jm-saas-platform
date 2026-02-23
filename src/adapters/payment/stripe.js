// Stripe payment adapter — creates a hosted Checkout Session and returns a payment URL
// (Stripe 결제 어댑터 — 호스팅 Checkout 세션을 생성하고 결제 URL 반환)
import axios from 'axios';
import { PaymentAdapter, PaymentError } from './interface.js';

// Stripe Checkout Sessions REST endpoint (Stripe Checkout 세션 REST 엔드포인트)
const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export class StripeAdapter extends PaymentAdapter {
  /**
   * Create a Stripe Checkout Session for the given order.
   * Returns a short-lived hosted payment URL that can be sent to the customer via SMS/email.
   * (주문에 대한 Stripe Checkout 세션 생성 — 고객에게 SMS/이메일로 전송할 단기 결제 URL 반환)
   *
   * @param {number} amount       — amount in cents, e.g. 2500 = $25.00 (센트 단위, 예: 2500 = $25.00)
   * @param {string} orderId      — internal order ID used as Stripe metadata (Stripe 메타데이터로 사용되는 내부 주문 ID)
   * @param {object} storeConfig  — tenant store context from req.storeContext (테넌트 스토어 컨텍스트)
   * @returns {Promise<PaymentResult>}
   */
  async processPayment(amount, orderId, storeConfig) {
    // Resolve Stripe secret key — tenant-specific key takes priority over global env
    // (테넌트별 키가 전역 환경 변수보다 우선 적용)
    const secretKey = storeConfig.stripeSecretKey ?? process.env.STRIPE_SECRET_KEY;

    if (!secretKey) {
      throw new PaymentError(
        'Stripe secret key is not configured for this tenant',
        'stripe',
        'MISSING_API_KEY'
      );
    }

    // Build URL-encoded form body — Stripe REST API uses application/x-www-form-urlencoded
    // (Stripe REST API는 application/x-www-form-urlencoded 형식 사용)
    const params = new URLSearchParams();
    params.append('mode',                         'payment');
    params.append('line_items[0][price_data][currency]',             'usd');
    params.append('line_items[0][price_data][unit_amount]',          String(amount));
    params.append('line_items[0][price_data][product_data][name]',   `Order #${orderId}`);
    params.append('line_items[0][price_data][product_data][description]', storeConfig.storeName ?? 'JM SaaS Store');
    params.append('line_items[0][quantity]',      '1');

    // Redirect URLs — use env-configured base URL or fallback placeholder
    // (리다이렉트 URL — 환경 변수 설정 기반 URL 또는 플레이스홀더 사용)
    const baseUrl = process.env.APP_BASE_URL ?? 'https://your-domain.com';
    params.append('success_url', `${baseUrl}/payment/success?order_id=${orderId}&session_id={CHECKOUT_SESSION_ID}`);
    params.append('cancel_url',  `${baseUrl}/payment/cancel?order_id=${orderId}`);

    // Attach internal order ID as Stripe metadata for webhook reconciliation
    // (웹훅 조정을 위해 내부 주문 ID를 Stripe 메타데이터로 첨부)
    params.append('metadata[order_id]',  orderId);
    params.append('metadata[agent_id]',  storeConfig.agentId ?? '');
    params.append('metadata[store_name]', storeConfig.storeName ?? '');

    try {
      // POST to Stripe Checkout Sessions API with Basic Auth (API key as username)
      // (Stripe Checkout Sessions API에 기본 인증으로 POST — API 키를 사용자명으로 사용)
      const response = await axios.post(
        `${STRIPE_API_BASE}/checkout/sessions`,
        params.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          auth: { username: secretKey, password: '' },
          timeout: 8000, // 8-second timeout before treating as gateway error (8초 타임아웃 — 초과 시 게이트웨이 오류)
        }
      );

      const session = response.data;

      // Return normalized PaymentResult (정규화된 PaymentResult 반환)
      return {
        success:       true,
        adapter:       'stripe',
        transactionId: session.id,          // Stripe session ID: cs_test_... (Stripe 세션 ID)
        orderId,
        amount,
        status:        'pending',           // Customer has not yet paid — URL is live (고객 미결제 — URL 활성 상태)
        meta: {
          paymentUrl:  session.url,         // Hosted checkout URL to send to customer (고객에게 전송할 결제 URL)
          expiresAt:   session.expires_at,  // Unix timestamp — session expires after 24h (세션 만료 Unix 타임스탬프)
          currency:    session.currency,
          livemode:    session.livemode,    // false in test mode (테스트 모드에서는 false)
        },
      };
    } catch (err) {
      // Stripe returns structured errors in err.response.data.error (Stripe 구조화 오류는 err.response.data.error에 있음)
      const stripeError = err.response?.data?.error;
      throw new PaymentError(
        stripeError?.message ?? err.message,
        'stripe',
        stripeError?.code   ?? 'STRIPE_API_ERROR',
        err
      );
    }
  }
}
