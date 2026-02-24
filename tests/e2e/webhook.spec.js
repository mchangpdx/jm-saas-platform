/**
 * E2E API tests — POST /api/v1/webhooks/retell
 *
 * What these tests prove:
 *   1. The server responds 200 IMMEDIATELY regardless of Redis/POS/payment state.
 *      This validates our fire-and-forget queue architecture against Retell's 2s timeout.
 *   2. The tenantMiddleware correctly resolves, rejects, and guards agent_id.
 *   3. The response body matches the shape downstream callers depend on.
 *
 * (이 테스트가 증명하는 것:
 *   1. Redis/POS/결제 상태와 무관하게 즉시 200 응답 — Retell 2초 타임아웃 대비 비동기 큐 아키텍처 검증
 *   2. tenantMiddleware의 올바른 agent_id 해석, 거절, 검증
 *   3. 응답 바디가 하위 호출자가 의존하는 형태와 일치)
 *
 * Server setup: playwright.config.js starts Express on port 3001 with:
 *   NODE_ENV=development, USE_MOCK_TENANT=true  (bypasses Supabase entirely)
 * (서버 설정: playwright.config.js가 포트 3001에 Express 시작 —
 *  NODE_ENV=development, USE_MOCK_TENANT=true로 Supabase 완전 우회)
 */

import { test, expect } from '@playwright/test';

// ── Shared Fixtures ────────────────────────────────────────────────────────────

// Canonical Retell AI webhook payload — mirrors the real POST body Retell sends
// after its LLM has parsed a customer voice order.
// (Retell AI 표준 웹훅 페이로드 — Retell LLM이 고객 음성 주문을 파싱한 후 전송하는 실제 POST 바디와 동일)
const RETELL_PAYLOAD = {
  agent_id:             'agent-001',           // Mock LOYVERSE/stripe tenant (목 LOYVERSE/stripe 테넌트)
  call_id:              'retell-call-abc123',  // Retell unique call ID → becomes orderId (Retell 통화 ID → 주문 ID)
  from_number:          '+15551234567',        // Customer phone number (고객 전화번호)

  // LLM-extracted order items — what the AI understood from the voice conversation
  // (LLM이 음성 대화에서 추출한 주문 항목)
  order_items: [
    { name: 'Americano',     quantity: 2, priceCents: 350  },
    { name: 'Club Sandwich', quantity: 1, priceCents: 1200 },
  ],

  total_amount_cents:   1900,                  // 2×350 + 1×1200 (총 금액: 1900센트)
  special_instructions: 'Extra hot, no ice',  // Free-text voice notes (음성 특이 사항)
};

const WEBHOOK_URL = '/api/v1/webhooks/retell';

// ── Suite 1: Core Architecture — Fire-and-Forget 200 ──────────────────────────

test.describe('Core fire-and-forget architecture', () => {

  test('responds 200 immediately with a valid Retell payload', async ({ request }) => {
    // THE critical test: Retell drops the call if we take >2s to respond.
    // The server must return 200 before touching Redis, POS, or payment.
    // (핵심 테스트: Retell은 2초 초과 시 통화를 중단.
    //  서버는 Redis, POS, 결제 접근 전에 200을 반환해야 함)

    const startMs  = Date.now();

    const response = await request.post(WEBHOOK_URL, { data: RETELL_PAYLOAD });

    const elapsedMs = Date.now() - startMs;

    // ── Status must be 200 (상태 코드 200 필수) ────────────────────────────────
    expect(response.status()).toBe(200);

    // ── Response must arrive well under Retell's 2-second voice timeout
    // (응답은 Retell 2초 음성 타임아웃보다 충분히 빨라야 함)
    expect(elapsedMs).toBeLessThan(500);
  });

  test('response body contains received:true confirming the webhook was accepted', async ({ request }) => {
    // The body shape is the contract our callers depend on (바디 형태는 호출자가 의존하는 계약)
    const response = await request.post(WEBHOOK_URL, { data: RETELL_PAYLOAD });

    expect(response.status()).toBe(200);

    const body = await response.json();

    // received:true tells Retell the webhook was successfully accepted (received:true는 Retell에 웹훅 수락을 알림)
    expect(body.received).toBe(true);

    // message field must be a non-empty string for logging/debugging (로깅/디버깅을 위한 비어 있지 않은 문자열 필수)
    expect(typeof body.message).toBe('string');
    expect(body.message.length).toBeGreaterThan(0);
  });

  test('echoes call_id as orderId so callers can correlate the queued job', async ({ request }) => {
    // The webhook controller uses call_id as the idempotency key for BullMQ jobs.
    // Echoing it back lets the caller track job status without a separate lookup.
    // (웹훅 컨트롤러는 call_id를 BullMQ 잡의 멱등성 키로 사용.
    //  반환으로 호출자가 별도 조회 없이 잡 상태 추적 가능)

    const uniqueCallId = `call-${Date.now()}`; // Fresh ID per test run to avoid jobId collisions (잡 ID 충돌 방지를 위한 테스트 실행별 고유 ID)

    const response = await request.post(WEBHOOK_URL, {
      data: { ...RETELL_PAYLOAD, call_id: uniqueCallId },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.orderId).toBe(uniqueCallId); // Must echo back exactly (정확히 반환해야 함)
  });

  test('200 even when order_items is missing — payload validation belongs to the worker', async ({ request }) => {
    // The controller is deliberately thin: it accepts the payload and enqueues it.
    // The queue worker (not the HTTP layer) validates the job payload.
    // This separation means Retell always gets its 200 and the worker can retry bad payloads.
    // (컨트롤러는 의도적으로 얇음: 페이로드 수락 후 큐에 등록.
    //  큐 워커가 잡 페이로드 검증 담당 — Retell은 항상 200을 받고, 워커는 불량 페이로드 재시도 가능)

    const partialPayload = {
      agent_id: 'agent-001',
      call_id:  'call-partial-test',
      total_amount_cents: 0,
      // order_items intentionally omitted (order_items 의도적으로 생략)
    };

    const response = await request.post(WEBHOOK_URL, { data: partialPayload });
    expect(response.status()).toBe(200);
  });

});

// ── Suite 2: Tenant Resolution ─────────────────────────────────────────────────

test.describe('Tenant middleware — agent_id resolution', () => {

  test('returns 400 when agent_id is absent from the request body', async ({ request }) => {
    // tenantMiddleware rejects at the middleware layer — the controller is never reached
    // (tenantMiddleware가 미들웨어 레이어에서 거절 — 컨트롤러에 도달하지 않음)

    const { agent_id: _omit, ...payloadWithoutAgentId } = RETELL_PAYLOAD;

    const response = await request.post(WEBHOOK_URL, { data: payloadWithoutAgentId });

    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(typeof body.error).toBe('string');   // Structured error (구조화된 오류)
    expect(typeof body.message).toBe('string'); // Korean message field (한글 메시지 필드)
  });

  test('returns 404 when agent_id does not match any registered store', async ({ request }) => {
    // An unrecognised agent has no POS/payment config — rejecting early protects the queue
    // (미등록 에이전트는 POS/결제 설정 없음 — 조기 거절로 큐 보호)

    const response = await request.post(WEBHOOK_URL, {
      data: { ...RETELL_PAYLOAD, agent_id: 'agent-does-not-exist-999' },
    });

    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(typeof body.error).toBe('string');
  });

  test('accepts agent-002 (QUANTIC POS / Toss payments) — validates both mock tenants', async ({ request }) => {
    // The tenant fixture has two agents. Both must work, proving the middleware
    // isn't hard-coded to a single store.
    // (테넌트 픽스처에 두 에이전트 존재. 둘 다 작동해야 하며, 미들웨어가 단일 스토어에 종속되지 않음을 증명)

    const response = await request.post(WEBHOOK_URL, {
      data: { ...RETELL_PAYLOAD, agent_id: 'agent-002', call_id: 'call-agent-002-test' },
    });

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.received).toBe(true);
    expect(body.orderId).toBe('call-agent-002-test');
  });

});

// ── Suite 3: Infrastructure Sanity ────────────────────────────────────────────

test.describe('Infrastructure health checks', () => {

  test('GET / — root ping confirms the server process is running', async ({ request }) => {
    // If this fails, webServer failed to start — all other tests are meaningless
    // (실패 시 webServer 시작 실패 — 다른 모든 테스트 무의미)

    const response = await request.get('/');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.service).toBe('jm-saas-platform');
    expect(body.status).toBe('running');
  });

  test('GET /api/v1/health — v1 router is mounted and reachable', async ({ request }) => {
    // Confirms the versioned router is mounted at /api/v1 (버전 관리 라우터가 /api/v1에 마운트됨을 확인)

    const response = await request.get('/api/v1/health');

    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.version).toBe('v1');
    expect(typeof body.timestamp).toBe('string'); // ISO timestamp present (ISO 타임스탬프 존재)
  });

  test('GET /api/v1/nonexistent — unmatched routes return structured 404', async ({ request }) => {
    // The 404 handler must return JSON (not an HTML page) so API clients can parse it
    // (404 핸들러는 API 클라이언트가 파싱할 수 있도록 HTML이 아닌 JSON을 반환해야 함)

    const response = await request.get('/api/v1/nonexistent-route-xyz');

    expect(response.status()).toBe(404);

    const body = await response.json();
    expect(typeof body.error).toBe('string');   // Machine-readable field (머신 가독 필드)
    expect(typeof body.path).toBe('string');    // Echo the attempted path (시도된 경로 반환)
  });

});
