// Mailer — sends HTML confirmation emails for orders and reservations.
// Uses Nodemailer SMTP transport configured via environment variables.
// Fire-and-forget safe: email failure is non-fatal and never blocks any flow.
// Sender display name is always "JM Tech One" for brand consistency across all emails.
// (메일러 — 주문 및 예약 확인 HTML 이메일 전송.
//  환경 변수로 설정된 Nodemailer SMTP 트랜스포트 사용.
//  fire-and-forget 안전: 이메일 실패는 치명적이지 않으며 어떤 흐름도 차단하지 않음.
//  발신자 표시 이름은 브랜드 일관성을 위해 모든 이메일에서 항상 "JM Tech One")
//
// Required environment variables (필요한 환경 변수):
//   SMTP_HOST  — SMTP server hostname (SMTP 서버 호스트명)
//   SMTP_PORT  — SMTP port, default 587 (SMTP 포트, 기본 587)
//   SMTP_SECURE— "true" for TLS on port 465, otherwise "false" (465 포트 TLS는 "true")
//   SMTP_USER  — SMTP login username / sender address (SMTP 로그인 사용자명 / 발신자 주소)
//   SMTP_PASS  — SMTP login password or app password (SMTP 로그인 비밀번호 또는 앱 비밀번호)

import nodemailer from 'nodemailer';

// Sender display name — fixed to "JM Tech One" for all outgoing emails regardless of store.
// Ensures a single, recognisable brand identity in every customer's inbox.
// (발신자 표시 이름 — 매장에 관계없이 모든 발신 이메일에 "JM Tech One" 고정.
//  모든 고객의 받은 편지함에서 단일하고 인식 가능한 브랜드 정체성 보장)
const SENDER_NAME = 'JM Tech One';

// Build the SMTP transport once at module load — reused for all sends in this process.
// createTransport() is cheap and stateless; the actual TCP connection is made per sendMail().
// (모듈 로드 시 한 번 SMTP 트랜스포트 생성 — 이 프로세스의 모든 전송에 재사용.
//  createTransport()는 저렴하고 무상태 — 실제 TCP 연결은 sendMail() 호출 시 생성)
const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: process.env.SMTP_SECURE === 'true',  // true enables TLS on port 465 (true이면 465 포트 TLS 활성화)
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ── HTML Builders ─────────────────────────────────────────────────────────────

/**
 * Build an HTML table row for a single order line item.
 * Used inside the order summary table in the email body.
 * (단일 주문 라인 항목의 HTML 테이블 행 생성. 이메일 바디 내 주문 요약 테이블에 사용)
 *
 * @param {{ name: string, quantity: number, unit_price: number }} item
 * @returns {string} HTML <tr> string (HTML <tr> 문자열)
 */
function buildItemRow(item) {
  const subtotal = (item.unit_price * item.quantity).toFixed(2);
  return `
    <tr>
      <td style="padding: 10px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #111827;">
        ${item.name}
      </td>
      <td style="padding: 10px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: center;">
        ${item.quantity}
      </td>
      <td style="padding: 10px 16px; border-bottom: 1px solid #e5e7eb; font-size: 14px; color: #374151; text-align: right;">
        $${subtotal}
      </td>
    </tr>`;
}

/**
 * Build the full HTML email document for an order confirmation.
 * Uses table-based layout and inline CSS for broad email client compatibility.
 * Includes: store header, greeting, order ID, items summary table, and a Pay Now button.
 * (주문 확인용 전체 HTML 이메일 문서 생성.
 *  폭넓은 이메일 클라이언트 호환성을 위해 테이블 레이아웃과 인라인 CSS 사용.
 *  매장 헤더, 인사말, 주문 ID, 항목 요약 테이블, 결제 버튼 포함)
 *
 * @param {object} params
 * @param {string}   params.customerName — customer's full name (고객 이름)
 * @param {string}   params.orderId      — DB-generated order UUID (DB 생성 주문 UUID)
 * @param {Array}    params.items        — enriched items: [{ name, quantity, unit_price }] (보강된 항목)
 * @param {number}   params.totalAmount  — server-calculated order total (서버 계산 총액)
 * @param {string}   params.paymentUrl   — full URL of the payment endpoint (결제 엔드포인트 전체 URL)
 * @param {string}   params.storeName    — store display name (매장 표시 이름)
 * @returns {string} complete HTML document (완성된 HTML 문서)
 */
function buildOrderEmailHtml({ customerName, orderId, items, totalAmount, paymentUrl, storeName }) {
  const itemRows  = (items ?? []).map(buildItemRow).join('');
  const totalStr  = parseFloat(totalAmount).toFixed(2);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Order Confirmation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background-color: #ffffff; border-radius: 12px;
                      box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: hidden;">

          <!-- Store header (매장 헤더) -->
          <tr>
            <td style="background-color: #16a34a; padding: 28px 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: bold;">
                ${storeName}
              </h1>
              <p style="margin: 6px 0 0; color: #d1fae5; font-size: 14px;">
                Order Confirmation
              </p>
            </td>
          </tr>

          <!-- Greeting (인사말) -->
          <tr>
            <td style="padding: 28px 32px 16px;">
              <p style="margin: 0; font-size: 16px; color: #111827;">
                Hi <strong>${customerName}</strong>,
              </p>
              <p style="margin: 10px 0 0; font-size: 15px; color: #374151; line-height: 1.6;">
                Thank you for your order! Please review the details below and click
                <strong>Pay Now</strong> to complete your purchase.
              </p>
            </td>
          </tr>

          <!-- Order ID (주문 ID) -->
          <tr>
            <td style="padding: 0 32px 20px;">
              <p style="margin: 0; font-size: 13px; color: #6b7280;">
                Order ID:
                <span style="font-family: monospace; color: #111827; font-weight: bold;">
                  ${orderId}
                </span>
              </p>
            </td>
          </tr>

          <!-- Items summary table (항목 요약 테이블) -->
          <tr>
            <td style="padding: 0 32px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                <thead>
                  <tr style="background-color: #f3f4f6;">
                    <th style="padding: 10px 16px; text-align: left;   font-size: 13px; color: #6b7280; font-weight: 600;">Item</th>
                    <th style="padding: 10px 16px; text-align: center; font-size: 13px; color: #6b7280; font-weight: 600;">Qty</th>
                    <th style="padding: 10px 16px; text-align: right;  font-size: 13px; color: #6b7280; font-weight: 600;">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemRows}
                </tbody>
                <tfoot>
                  <tr style="background-color: #f9fafb;">
                    <td colspan="2" style="padding: 12px 16px; font-weight: bold; font-size: 15px; color: #111827;">
                      Total
                    </td>
                    <td style="padding: 12px 16px; text-align: right; font-weight: bold; font-size: 15px; color: #16a34a;">
                      $${totalStr}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </td>
          </tr>

          <!-- Pay Now button — large green CTA (대형 초록색 결제 버튼) -->
          <tr>
            <td style="padding: 0 32px 36px; text-align: center;">
              <a href="${paymentUrl}"
                 style="display: inline-block;
                        background-color: #16a34a;
                        color: #ffffff;
                        text-decoration: none;
                        padding: 16px 48px;
                        border-radius: 8px;
                        font-size: 18px;
                        font-weight: bold;
                        letter-spacing: 0.3px;">
                Pay Now — $${totalStr}
              </a>
            </td>
          </tr>

          <!-- Footer (푸터) -->
          <tr>
            <td style="background-color: #f9fafb; padding: 18px 32px;
                       border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                This email was sent by ${storeName}.
                If you did not place this order, please ignore this email.
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

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send an order confirmation email to the customer.
 *
 * Silently skips if SMTP_HOST or SMTP_USER are not configured — this allows the
 * server to run in dev without email credentials without crashing.
 * All errors are caught and logged; email failure is non-fatal.
 *
 * (고객에게 주문 확인 이메일 전송.
 *  SMTP_HOST 또는 SMTP_USER 미설정 시 조용히 건너뜀 — 개발 환경에서 자격증명 없이 실행 가능.
 *  모든 오류는 캐치하여 로깅 — 이메일 실패는 치명적이지 않음)
 *
 * @param {object} params
 * @param {string}   params.to           — recipient email address (수신자 이메일 주소)
 * @param {string}   params.customerName — customer's full name (고객 이름)
 * @param {string}   params.orderId      — DB-generated order UUID (DB 생성 주문 UUID)
 * @param {Array}    params.items        — enriched items: [{ name, quantity, unit_price }] (보강된 항목)
 * @param {number}   params.totalAmount  — server-calculated order total (서버 계산 총액)
 * @param {string}   params.paymentUrl   — full URL of the payment endpoint (결제 엔드포인트 전체 URL)
 * @param {string}   params.storeName    — store display name for subject and header (제목·헤더용 매장명)
 * @returns {Promise<void>}
 */
export async function sendOrderConfirmationEmail({
  to,
  customerName,
  orderId,
  items,
  totalAmount,
  paymentUrl,
  storeName,
}) {
  // Skip silently if SMTP is not configured — avoids crashes in dev (SMTP 미설정 시 조용히 건너뜀 — 개발 환경 충돌 방지)
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn(
      '[Mailer] SMTP_HOST or SMTP_USER not configured — skipping order confirmation email ' +
      '(SMTP_HOST 또는 SMTP_USER 미설정 — 주문 확인 이메일 건너뜀)'
    );
    return;
  }

  // Sender is always SENDER_NAME — store name appears in the subject line only
  // (발신자는 항상 SENDER_NAME — 매장명은 제목 줄에만 표시)
  const subject = `Your Order Confirmation — ${storeName}`;
  const html    = buildOrderEmailHtml({ customerName, orderId, items, totalAmount, paymentUrl, storeName });

  try {
    await transporter.sendMail({
      from:    `"${SENDER_NAME}" <${process.env.SMTP_USER}>`,  // Fixed brand sender for all emails (모든 이메일에 고정 브랜드 발신자)
      to,
      subject,
      html,
    });

    console.log(
      `[Mailer] Order confirmation sent | to: ${to} | orderId: ${orderId} ` +
      `(주문 확인 이메일 전송 완료 | 수신자: ${to} | 주문: ${orderId})`
    );
  } catch (err) {
    // Non-fatal — order is already saved in the DB; email failure must not block the flow
    // (치명적이지 않음 — 주문은 이미 DB에 저장됨 — 이메일 실패가 흐름을 차단하면 안 됨)
    console.error(
      `[Mailer] Failed to send order confirmation | to: ${to} | orderId: ${orderId} | ${err.message} ` +
      `(주문 확인 이메일 전송 실패 | 수신자: ${to} | 주문: ${orderId} | 오류: ${err.message})`
    );
  }
}

// ── Reservation Email ──────────────────────────────────────────────────────────

/**
 * Build the full HTML email document for a reservation confirmation.
 * Uses table-based layout and inline CSS for broad email client compatibility.
 * Includes: store header, greeting, reservation ID, details card, and footer.
 * (예약 확인용 전체 HTML 이메일 문서 생성.
 *  폭넓은 이메일 클라이언트 호환성을 위해 테이블 레이아웃과 인라인 CSS 사용.
 *  매장 헤더, 인사말, 예약 ID, 상세 카드, 푸터 포함)
 *
 * @param {object} params
 * @param {string} params.customerName    — customer's full name (고객 이름)
 * @param {string} params.reservationId  — DB-generated reservation UUID (DB 생성 예약 UUID)
 * @param {string} params.reservationDate — date in YYYY-MM-DD (예약 날짜 YYYY-MM-DD)
 * @param {string} params.reservationTime — time in HH:MM (예약 시간 HH:MM)
 * @param {number} params.partySize       — number of guests (인원 수)
 * @param {string} params.storeName       — store display name (매장 표시 이름)
 * @returns {string} complete HTML document (완성된 HTML 문서)
 */
function buildReservationEmailHtml({ customerName, reservationId, reservationDate, reservationTime, partySize, storeName }) {
  // Format date to a human-readable form for the email body (이메일 바디용 사람이 읽기 좋은 날짜 형식 변환)
  const displayDate = (() => {
    try {
      return new Date(`${reservationDate}T${reservationTime}`).toLocaleString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true,
      });
    } catch {
      return `${reservationDate} at ${reservationTime}`;  // Fallback to raw strings on parse error (파싱 오류 시 원본 문자열 폴백)
    }
  })();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Reservation Confirmation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f9fafb; font-family: Arial, Helvetica, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f9fafb; padding: 40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background-color: #ffffff; border-radius: 12px;
                      box-shadow: 0 4px 20px rgba(0,0,0,0.08); overflow: hidden;">

          <!-- Store header (매장 헤더) -->
          <tr>
            <td style="background-color: #0369a1; padding: 28px 32px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: bold;">
                ${storeName}
              </h1>
              <p style="margin: 6px 0 0; color: #bae6fd; font-size: 14px;">
                Reservation Confirmed
              </p>
            </td>
          </tr>

          <!-- Greeting (인사말) -->
          <tr>
            <td style="padding: 28px 32px 16px;">
              <p style="margin: 0; font-size: 16px; color: #111827;">
                Hi <strong>${customerName}</strong>,
              </p>
              <p style="margin: 10px 0 0; font-size: 15px; color: #374151; line-height: 1.6;">
                Your reservation has been confirmed. We look forward to seeing you!
              </p>
            </td>
          </tr>

          <!-- Reservation ID (예약 ID) -->
          <tr>
            <td style="padding: 0 32px 20px;">
              <p style="margin: 0; font-size: 13px; color: #6b7280;">
                Reservation ID:
                <span style="font-family: monospace; color: #111827; font-weight: bold;">
                  ${reservationId}
                </span>
              </p>
            </td>
          </tr>

          <!-- Reservation details card (예약 상세 카드) -->
          <tr>
            <td style="padding: 0 32px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0"
                     style="background-color: #f0f9ff; border: 1px solid #bae6fd;
                            border-radius: 8px; overflow: hidden;">
                <tr>
                  <td style="padding: 20px 24px;">

                    <table width="100%" cellpadding="0" cellspacing="0">
                      <!-- Date & Time row (날짜·시간 행) -->
                      <tr>
                        <td style="padding: 6px 0; font-size: 13px; color: #6b7280; width: 110px;">
                          Date &amp; Time
                        </td>
                        <td style="padding: 6px 0; font-size: 14px; color: #0c4a6e; font-weight: bold;">
                          ${displayDate}
                        </td>
                      </tr>
                      <!-- Party size row (파티 인원 행) -->
                      <tr>
                        <td style="padding: 6px 0; font-size: 13px; color: #6b7280;">
                          Party Size
                        </td>
                        <td style="padding: 6px 0; font-size: 14px; color: #0c4a6e; font-weight: bold;">
                          ${partySize} ${partySize === 1 ? 'guest' : 'guests'}
                        </td>
                      </tr>
                      <!-- Location row (위치 행) -->
                      <tr>
                        <td style="padding: 6px 0; font-size: 13px; color: #6b7280;">
                          Location
                        </td>
                        <td style="padding: 6px 0; font-size: 14px; color: #0c4a6e; font-weight: bold;">
                          ${storeName}
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer (푸터) -->
          <tr>
            <td style="background-color: #f9fafb; padding: 18px 32px;
                       border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #9ca3af;">
                This email was sent by ${storeName} via ${SENDER_NAME}.
                If you did not make this reservation, please ignore this email.
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
 * Send a reservation confirmation email to the customer.
 *
 * Silently skips if SMTP_HOST or SMTP_USER are not configured — allows the server
 * to run in dev without email credentials without crashing.
 * All errors are caught and logged; email failure is non-fatal.
 *
 * (고객에게 예약 확인 이메일 전송.
 *  SMTP_HOST 또는 SMTP_USER 미설정 시 조용히 건너뜀 — 개발 환경에서 자격증명 없이 실행 가능.
 *  모든 오류는 캐치하여 로깅 — 이메일 실패는 치명적이지 않음)
 *
 * @param {object} params
 * @param {string} params.to              — recipient email address (수신자 이메일 주소)
 * @param {string} params.customerName    — customer's full name (고객 이름)
 * @param {string} params.reservationId  — DB-generated reservation UUID (DB 생성 예약 UUID)
 * @param {string} params.reservationDate — date in YYYY-MM-DD (예약 날짜)
 * @param {string} params.reservationTime — time in HH:MM (예약 시간)
 * @param {number} params.partySize       — number of guests (인원 수)
 * @param {string} params.storeName       — store display name for subject and header (제목·헤더용 매장명)
 * @returns {Promise<void>}
 */
export async function sendReservationConfirmationEmail({
  to,
  customerName,
  reservationId,
  reservationDate,
  reservationTime,
  partySize,
  storeName,
}) {
  // Skip silently if SMTP is not configured — avoids crashes in dev (SMTP 미설정 시 조용히 건너뜀 — 개발 환경 충돌 방지)
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.warn(
      '[Mailer] SMTP_HOST or SMTP_USER not configured — skipping reservation confirmation email ' +
      '(SMTP_HOST 또는 SMTP_USER 미설정 — 예약 확인 이메일 건너뜀)'
    );
    return;
  }

  const subject = `Your Reservation is Confirmed — ${storeName}`;
  const html    = buildReservationEmailHtml({
    customerName, reservationId, reservationDate, reservationTime, partySize, storeName,
  });

  try {
    await transporter.sendMail({
      from:    `"${SENDER_NAME}" <${process.env.SMTP_USER}>`,  // Fixed brand sender for all emails (모든 이메일에 고정 브랜드 발신자)
      to,
      subject,
      html,
    });

    console.log(
      `[Mailer] Reservation confirmation sent | to: ${to} | reservationId: ${reservationId} ` +
      `(예약 확인 이메일 전송 완료 | 수신자: ${to} | 예약: ${reservationId})`
    );
  } catch (err) {
    // Non-fatal — reservation is already saved in the DB; email failure must not block the flow
    // (치명적이지 않음 — 예약은 이미 DB에 저장됨 — 이메일 실패가 흐름을 차단하면 안 됨)
    console.error(
      `[Mailer] Failed to send reservation confirmation | to: ${to} | reservationId: ${reservationId} | ${err.message} ` +
      `(예약 확인 이메일 전송 실패 | 수신자: ${to} | 예약: ${reservationId} | 오류: ${err.message})`
    );
  }
}
