// Notification service — real Email (Nodemailer SMTP) + SMS (Twilio) with mock fallback
// (알림 서비스 — 실제 Email(Nodemailer SMTP) + SMS(Twilio) 발송, 설정 누락 시 목 폴백)
//
// Required environment variables (필요한 환경 변수):
//   SMTP_HOST        — SMTP server hostname, defaults to smtp.gmail.com (SMTP 서버 호스트명)
//   SMTP_PORT        — SMTP server port, defaults to 587 (SMTP 서버 포트)
//   SMTP_USER        — SMTP username / sender address (SMTP 사용자명 / 발신자 주소)
//   SMTP_PASS        — SMTP password or app-specific password (SMTP 비밀번호 또는 앱 전용 비밀번호)
//   TWILIO_ACCOUNT_SID  — Twilio account SID (Twilio 계정 SID)
//   TWILIO_AUTH_TOKEN   — Twilio auth token (Twilio 인증 토큰)
//   TWILIO_PHONE_NUMBER — Twilio verified sender phone number, e.g. +15005550006 (Twilio 발신 번호)
//
// If any required variable for a channel is missing, that channel silently degrades to
// a console.warn mock so the application never crashes on missing credentials.
// (필수 환경 변수 누락 시 해당 채널은 console.warn 목 모드로 조용히 전환 — 앱 크래시 방지)

import nodemailer from 'nodemailer';
import twilio     from 'twilio';

// ── SMTP Transport (Lazy Singleton) ───────────────────────────────────────────

// Build the Nodemailer transport once and reuse across calls.
// Returns null when SMTP credentials are absent — callers must check before use.
// (Nodemailer 트랜스포트를 한 번 생성하여 호출 간 재사용.
//  SMTP 자격 증명이 없으면 null 반환 — 호출자가 사용 전 확인 필요)
function buildSmtpTransport() {
  const { SMTP_USER, SMTP_PASS } = process.env;

  if (!SMTP_USER || !SMTP_PASS) {
    // Credentials absent — transport unavailable, will fall back to mock (자격 증명 없음 — 목 모드로 전환)
    return null;
  }

  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST ?? 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465, // true only for port 465 (포트 465일 때만 TLS 활성화)
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

// Singleton transport — created on first module load (모듈 첫 로드 시 생성되는 싱글톤 트랜스포트)
const smtpTransport = buildSmtpTransport();

// ── Twilio Client (Lazy Singleton) ────────────────────────────────────────────

// Build the Twilio client once and reuse across calls.
// Returns null when Twilio credentials are absent — callers must check before use.
// (Twilio 클라이언트를 한 번 생성하여 재사용.
//  Twilio 자격 증명이 없으면 null 반환 — 호출자가 사용 전 확인 필요)
function buildTwilioClient() {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    // Credentials absent — client unavailable, will fall back to mock (자격 증명 없음 — 목 모드로 전환)
    return null;
  }

  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

// Singleton client — created on first module load (모듈 첫 로드 시 생성되는 싱글톤 클라이언트)
const twilioClient = buildTwilioClient();

// ── HTML Template Helpers ─────────────────────────────────────────────────────

/**
 * Render an HTML table row for a single order item.
 * (단일 주문 항목에 대한 HTML 테이블 행 렌더링)
 *
 * @param {{ name: string, quantity: number }} item
 * @returns {string}
 */
function renderItemRow(item) {
  return `
    <tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e9ecef;">${item.quantity}×</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #e9ecef;">${item.name}</td>
    </tr>`;
}

/**
 * Build the full HTML email body for a payment-link notification.
 * Uses inline CSS for maximum email-client compatibility.
 * (결제 링크 알림용 전체 HTML 이메일 본문 생성.
 *  최대 이메일 클라이언트 호환성을 위해 인라인 CSS 사용)
 *
 * @param {object} opts
 * @param {string}   opts.storeName   — display name of the store (매장 표시명)
 * @param {Array}    opts.items        — order items [{ name, quantity }] (주문 항목 배열)
 * @param {number}   opts.totalAmount  — order total (주문 총액)
 * @param {string}   opts.paymentUrl   — payment link URL (결제 링크 URL)
 * @returns {string} complete HTML document (완성된 HTML 문서)
 */
function buildOrderEmailHtml({ storeName, items, totalAmount, paymentUrl }) {
  const itemRows = items.map(renderItemRow).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your Order from ${storeName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f8f9fa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header (헤더) -->
          <tr>
            <td style="background-color: #212529; padding: 28px 32px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: bold;">
                ${storeName}
              </h1>
              <p style="margin: 6px 0 0; color: #adb5bd; font-size: 14px;">Order Confirmation</p>
            </td>
          </tr>

          <!-- Body (본문) -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 20px; color: #495057; font-size: 16px;">
                Thank you for your order! Please review the details below and complete your payment.
              </p>

              <!-- Order items table (주문 항목 테이블) -->
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="border: 1px solid #e9ecef; border-radius: 6px; border-collapse: collapse; margin-bottom: 24px;">
                <thead>
                  <tr style="background-color: #f8f9fa;">
                    <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6c757d; border-bottom: 1px solid #e9ecef;">Qty</th>
                    <th style="padding: 10px 12px; text-align: left; font-size: 13px; color: #6c757d; border-bottom: 1px solid #e9ecef;">Item</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
              </table>

              <!-- Total amount (총 금액) -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="font-size: 16px; color: #495057; font-weight: bold;">Order Total</td>
                  <td align="right" style="font-size: 20px; color: #212529; font-weight: bold;">
                    $${Number(totalAmount).toFixed(2)}
                  </td>
                </tr>
              </table>

              <!-- Payment CTA button (결제 CTA 버튼) -->
              <div style="text-align: center;">
                <a href="${paymentUrl}"
                   style="background-color: #28a745; color: #ffffff; padding: 14px 25px;
                          text-align: center; text-decoration: none; display: inline-block;
                          border-radius: 4px; font-weight: bold; font-size: 16px; margin-top: 20px;">
                  Complete Payment
                </a>
              </div>

              <p style="margin: 28px 0 0; font-size: 13px; color: #6c757d; text-align: center;">
                This link expires in 24 hours. If you have any questions, please call us directly.
              </p>
            </td>
          </tr>

          <!-- Footer (푸터) -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 18px 32px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; font-size: 12px; color: #adb5bd; text-align: center;">
                © ${new Date().getFullYear()} ${storeName}. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Build the full HTML email body for a reservation confirmation.
 * (예약 확인용 전체 HTML 이메일 본문 생성)
 *
 * @param {object} opts
 * @param {string} opts.storeName    — display name of the store (매장 표시명)
 * @param {string} opts.date         — reservation date YYYY-MM-DD (예약 날짜)
 * @param {string} opts.time         — reservation time HH:MM 24h (예약 시간)
 * @param {number} opts.partySize    — number of guests (인원 수)
 * @param {string} opts.reservationId — confirmation ID (확인 ID)
 * @returns {string} complete HTML document (완성된 HTML 문서)
 */
function buildReservationEmailHtml({ storeName, date, time, partySize, reservationId }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reservation Confirmed — ${storeName}</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; background-color: #f8f9fa;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f8f9fa; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header (헤더) -->
          <tr>
            <td style="background-color: #212529; padding: 28px 32px;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: bold;">
                ${storeName}
              </h1>
              <p style="margin: 6px 0 0; color: #adb5bd; font-size: 14px;">Reservation Confirmed</p>
            </td>
          </tr>

          <!-- Body (본문) -->
          <tr>
            <td style="padding: 32px;">
              <p style="margin: 0 0 24px; color: #495057; font-size: 16px;">
                Your reservation is confirmed! We look forward to seeing you.
              </p>

              <!-- Reservation details table (예약 상세 테이블) -->
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="border: 1px solid #e9ecef; border-radius: 6px; border-collapse: collapse; margin-bottom: 28px;">
                <tbody>
                  <tr>
                    <td style="padding: 12px 16px; font-weight: bold; color: #6c757d; font-size: 13px; border-bottom: 1px solid #e9ecef; width: 40%;">Date</td>
                    <td style="padding: 12px 16px; color: #212529; font-size: 15px; border-bottom: 1px solid #e9ecef;">${date}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 16px; font-weight: bold; color: #6c757d; font-size: 13px; border-bottom: 1px solid #e9ecef;">Time</td>
                    <td style="padding: 12px 16px; color: #212529; font-size: 15px; border-bottom: 1px solid #e9ecef;">${time}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 16px; font-weight: bold; color: #6c757d; font-size: 13px; border-bottom: 1px solid #e9ecef;">Party Size</td>
                    <td style="padding: 12px 16px; color: #212529; font-size: 15px; border-bottom: 1px solid #e9ecef;">${partySize} guest${partySize !== 1 ? 's' : ''}</td>
                  </tr>
                  <tr>
                    <td style="padding: 12px 16px; font-weight: bold; color: #6c757d; font-size: 13px;">Confirmation ID</td>
                    <td style="padding: 12px 16px; color: #212529; font-size: 15px; font-family: monospace;">${reservationId}</td>
                  </tr>
                </tbody>
              </table>

              <p style="margin: 0; font-size: 13px; color: #6c757d; text-align: center;">
                Need to change your reservation? Please call us directly and mention your Confirmation ID.
              </p>
            </td>
          </tr>

          <!-- Footer (푸터) -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 18px 32px; border-top: 1px solid #e9ecef;">
              <p style="margin: 0; font-size: 12px; color: #adb5bd; text-align: center;">
                © ${new Date().getFullYear()} ${storeName}. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ── Low-Level Channel Senders ─────────────────────────────────────────────────

/**
 * Send one email via SMTP. Falls back to mock log when transport is unavailable.
 * (SMTP를 통해 이메일 발송. 트랜스포트 없으면 목 로그로 폴백)
 *
 * @param {object} opts
 * @param {string} opts.to       — recipient address (수신자 주소)
 * @param {string} opts.subject  — email subject line (이메일 제목)
 * @param {string} opts.html     — full HTML body (전체 HTML 본문)
 * @returns {Promise<void>}
 */
async function sendEmail({ to, subject, html }) {
  if (!smtpTransport) {
    // SMTP credentials missing — degrade gracefully to mock (SMTP 자격 증명 없음 — 목 모드로 조용히 전환)
    console.warn(
      `[Notifier] MOCK Email (SMTP_USER/SMTP_PASS not set) → ${to} | Subject: "${subject}" ` +
      `(목 이메일 — SMTP 환경변수 미설정 | 수신자: ${to})`
    );
    return;
  }

  try {
    const info = await smtpTransport.sendMail({
      from:    `"${process.env.SMTP_FROM_NAME ?? 'JM Restaurant'}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(
      `[Notifier] Email sent → ${to} | messageId: ${info.messageId} ` +
      `(이메일 발송 완료 | 수신자: ${to} | 메시지 ID: ${info.messageId})`
    );
  } catch (err) {
    // Log but do not re-throw — notification failure must not block the order flow
    // (로깅 후 예외 미전파 — 알림 실패가 주문 흐름을 차단하면 안 됨)
    console.error(
      `[Notifier] Email send failed → ${to} | ${err.message} ` +
      `(이메일 발송 실패 | 수신자: ${to} | 오류: ${err.message})`
    );
  }
}

/**
 * Send one SMS via Twilio. Falls back to mock log when client is unavailable.
 * (Twilio를 통해 SMS 발송. 클라이언트 없으면 목 로그로 폴백)
 *
 * @param {object} opts
 * @param {string} opts.to   — recipient phone number in E.164 format (E.164 형식 수신자 전화번호)
 * @param {string} opts.body — SMS message text, max 160 chars recommended (SMS 본문, 최대 160자 권장)
 * @returns {Promise<void>}
 */
async function sendSms({ to, body }) {
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;

  if (!twilioClient || !fromNumber) {
    // Twilio credentials missing — degrade gracefully to mock (Twilio 자격 증명 없음 — 목 모드로 조용히 전환)
    console.warn(
      `[Notifier] MOCK SMS (Twilio env vars not set) → ${to} | "${body}" ` +
      `(목 SMS — Twilio 환경변수 미설정 | 수신자: ${to})`
    );
    return;
  }

  try {
    const message = await twilioClient.messages.create({ from: fromNumber, to, body });
    console.log(
      `[Notifier] SMS sent → ${to} | sid: ${message.sid} ` +
      `(SMS 발송 완료 | 수신자: ${to} | SID: ${message.sid})`
    );
  } catch (err) {
    // Log but do not re-throw — notification failure must not block the order flow
    // (로깅 후 예외 미전파 — 알림 실패가 주문 흐름을 차단하면 안 됨)
    console.error(
      `[Notifier] SMS send failed → ${to} | ${err.message} ` +
      `(SMS 발송 실패 | 수신자: ${to} | 오류: ${err.message})`
    );
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Notify a customer that their order is ready for payment.
 * Fires both Email and SMS in parallel — failures are caught internally.
 * (고객에게 결제 준비 완료 알림 발송.
 *  이메일과 SMS를 병렬로 발송 — 내부에서 실패 처리)
 *
 * @param {object} opts
 * @param {string}   opts.customerPhone  — recipient phone number (수신자 전화번호)
 * @param {string}   opts.customerEmail  — recipient email address (수신자 이메일 주소)
 * @param {string}   opts.paymentUrl     — payment link URL (결제 링크 URL)
 * @param {string}   opts.storeName      — display name of the store (매장 표시명)
 * @param {Array}    opts.items           — order items [{ name, quantity }] (주문 항목)
 * @param {number}   opts.totalAmount     — order total (주문 총액)
 * @returns {Promise<void>}
 */
export async function sendPaymentLink({
  customerPhone,
  customerEmail,
  paymentUrl,
  storeName,
  items,
  totalAmount,
}) {
  const itemSummary = items
    .map((i) => `${i.quantity}x ${i.name}`)
    .join(', ');

  // Build channel-specific payloads (채널별 페이로드 생성)
  const emailPayload = {
    to:      customerEmail,
    subject: `Your Order from ${storeName} — Complete Payment`,
    html:    buildOrderEmailHtml({ storeName, items, totalAmount, paymentUrl }),
  };

  const smsPayload = {
    to:   customerPhone,
    body: `${storeName}: Your order (${itemSummary}) totals $${Number(totalAmount).toFixed(2)}. Pay here: ${paymentUrl}`,
  };

  // Dispatch both channels concurrently — one failure does not block the other
  // (두 채널 동시 발송 — 하나의 실패가 다른 채널을 차단하지 않음)
  await Promise.all([
    sendEmail(emailPayload),
    sendSms(smsPayload),
  ]);
}

/**
 * Notify a customer that their reservation is confirmed.
 * Fires both Email and SMS in parallel — failures are caught internally.
 * (고객에게 예약 확인 알림 발송.
 *  이메일과 SMS를 병렬로 발송 — 내부에서 실패 처리)
 *
 * @param {object} opts
 * @param {string} opts.customerPhone   — recipient phone number (수신자 전화번호)
 * @param {string} opts.customerEmail   — recipient email address (수신자 이메일 주소)
 * @param {string} opts.storeName       — display name of the store (매장 표시명)
 * @param {string} opts.date            — reservation date YYYY-MM-DD (예약 날짜)
 * @param {string} opts.time            — reservation time HH:MM 24h (예약 시간)
 * @param {number} opts.partySize       — number of guests (인원 수)
 * @param {string} opts.reservationId   — confirmation ID from the DB (DB 확인 ID)
 * @returns {Promise<void>}
 */
export async function sendReservationConfirmation({
  customerPhone,
  customerEmail,
  storeName,
  date,
  time,
  partySize,
  reservationId,
}) {
  // Build channel-specific payloads (채널별 페이로드 생성)
  const emailPayload = {
    to:      customerEmail,
    subject: `Reservation Confirmed — ${storeName}`,
    html:    buildReservationEmailHtml({ storeName, date, time, partySize, reservationId }),
  };

  const smsPayload = {
    to:   customerPhone,
    body: `${storeName}: Your reservation for ${partySize} on ${date} at ${time} is confirmed. ID: ${reservationId}`,
  };

  // Dispatch both channels concurrently — one failure does not block the other
  // (두 채널 동시 발송 — 하나의 실패가 다른 채널을 차단하지 않음)
  await Promise.all([
    sendEmail(emailPayload),
    sendSms(smsPayload),
  ]);
}
