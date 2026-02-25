// Notification service — SMS and email dispatch stubs for MVP
// (알림 서비스 — MVP용 SMS 및 이메일 발송 스텁)

// ── sendPaymentLink ───────────────────────────────────────────────────────────

/**
 * Send a payment link to the customer via SMS and email.
 * MVP implementation logs the outbound message — no real SMS/email gateway call.
 * Replace console.log with a real provider (e.g., Twilio, SendGrid) in production.
 * (고객에게 SMS 및 이메일로 결제 링크 발송.
 *  MVP는 발신 메시지를 로깅 — 실제 SMS/이메일 게이트웨이 호출 없음.
 *  프로덕션에서 실제 제공업체(Twilio, SendGrid 등)로 교체)
 *
 * @param {string} customerPhone — recipient phone number (수신자 전화번호)
 * @param {string} customerEmail — recipient email address (수신자 이메일 주소)
 * @param {string} paymentUrl   — payment link to send (발송할 결제 링크)
 * @returns {Promise<void>}
 */
export async function sendPaymentLink(customerPhone, customerEmail, paymentUrl) {
  // Simulate SMS dispatch — log to stdout (SMS 발송 시뮬레이션 — 표준 출력에 로깅)
  console.log(
    `[Notifier] SMS → ${customerPhone} | ` +
    `"Your payment link: ${paymentUrl}" ` +
    `(SMS 발송 시뮬레이션 | 수신자: ${customerPhone})`
  );

  // Simulate email dispatch — log to stdout (이메일 발송 시뮬레이션 — 표준 출력에 로깅)
  console.log(
    `[Notifier] Email → ${customerEmail} | ` +
    `Subject: "Complete your order payment" | ` +
    `Body: "Click here to pay: ${paymentUrl}" ` +
    `(이메일 발송 시뮬레이션 | 수신자: ${customerEmail})`
  );
}
