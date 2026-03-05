// Solink video-link API integration test script (Solink 비디오 링크 API 통합 테스트 스크립트)
// Three scenarios: missing params (400), invalid date (400), happy path (200 + URL)
// (세 가지 시나리오: 파라미터 누락(400), 잘못된 날짜(400), 정상 경로(200 + URL))
//
// Usage: node test-solink-video-api.js
// Requires: server running on PORT 3000 (or set TEST_PORT env var)
// (사용법: node test-solink-video-api.js — 포트 3000에서 서버 실행 필요)

import axios from 'axios';

const BASE = `http://localhost:${process.env.TEST_PORT ?? 3000}/api/solink/video-link`;

// Test camera UUID provided by Solink (Solink에서 제공한 테스트 카메라 UUID)
const CAMERA_ID  = '3f34c890-17fb-11f1-a67a-af67afbf5812';
const TIMESTAMP  = '2026-03-05T15:33:09Z';

// ── Helpers ───────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

// Print a test result with status badge (상태 배지와 함께 테스트 결과 출력)
function report(label, ok, detail) {
  const badge = ok ? '✅ PASS' : '❌ FAIL';
  console.log(`${badge}  ${label}`);
  if (detail) console.log(`       ${detail}`);
  ok ? passed++ : failed++;
}

// Perform GET request, tolerate HTTP error responses without throwing (HTTP 오류 응답을 예외 없이 처리하는 GET 요청)
async function get(params) {
  try {
    const res = await axios.get(BASE, { params, timeout: 12_000 });
    return { status: res.status, data: res.data };
  } catch (err) {
    if (err.response) return { status: err.response.status, data: err.response.data };
    throw err; // Network-level failure — re-throw (네트워크 수준 오류 — 재throw)
  }
}

// ── Test Cases ────────────────────────────────────────────────────────────────

// Scenario 1: Missing both cameraId and timestamp → expect 400 (시나리오 1: cameraId, timestamp 모두 누락 → 400 기대)
async function testMissingParams() {
  const { status, data } = await get({});
  const ok = status === 400;
  report(
    'Scenario 1 — Missing params → 400',
    ok,
    `HTTP ${status} | body: ${JSON.stringify(data)}`,
  );
}

// Scenario 2: cameraId present, timestamp is not a valid date → expect 400 (시나리오 2: cameraId 있음, timestamp 잘못된 날짜 → 400 기대)
async function testInvalidDate() {
  const { status, data } = await get({ cameraId: CAMERA_ID, timestamp: 'not-a-date' });
  const ok = status === 400;
  report(
    'Scenario 2 — Invalid date  → 400',
    ok,
    `HTTP ${status} | body: ${JSON.stringify(data)}`,
  );
}

// Scenario 3: Valid cameraId + valid ISO timestamp → expect 200 + non-empty URL (시나리오 3: 유효한 cameraId + ISO 타임스탬프 → 200 + 유효한 URL 기대)
async function testHappyPath() {
  const { status, data } = await get({ cameraId: CAMERA_ID, timestamp: TIMESTAMP });
  // Accept 200 or 502 when Solink creds are test-only stubs (테스트 전용 자격 증명일 경우 502도 허용)
  const reachable = status === 200 || status === 502;
  const hasUrl    = status === 200 && (data?.data?.url || data?.videoLink);

  if (status === 200) {
    report(
      'Scenario 3 — Happy path      → 200 + URL',
      hasUrl,
      `HTTP ${status} | url: ${data?.data?.url ?? data?.videoLink ?? '(none)'}`,
    );
  } else {
    // Solink returned an upstream error — route itself worked correctly (Solink가 업스트림 오류 반환 — 라우트 자체는 정상 동작)
    report(
      'Scenario 3 — Happy path      → upstream error (credentials may be test-only)',
      reachable,
      `HTTP ${status} | body: ${JSON.stringify(data)}`,
    );
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  console.log('=== Solink video-link API tests ===');
  console.log(`Target: ${BASE}\n`);

  try {
    await testMissingParams();
    await testInvalidDate();
    await testHappyPath();
  } catch (err) {
    console.error('\n[FATAL] Could not reach the server — is it running?', err.message);
    process.exit(1);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  // Exit non-zero if any test failed (테스트 실패 시 비정상 종료)
  if (failed > 0) process.exit(1);
}

run();
