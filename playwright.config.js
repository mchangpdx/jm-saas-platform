// Playwright configuration for API (E2E) testing — no browser binaries required
// (API E2E 테스트용 Playwright 설정 — 브라우저 바이너리 불필요)
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', // Only look for tests under this directory (이 디렉토리 아래에서만 테스트 탐색)

  // Run tests sequentially — they all hit the same local server process (동일 로컬 서버 프로세스 대상으로 순차 실행)
  fullyParallel: false,
  workers:       1,

  // No retries in development; CI can override via env (개발 환경 재시도 없음 — CI는 환경 변수로 재정의 가능)
  retries: process.env.CI ? 1 : 0,

  // Per-test timeout — generous enough for server cold-start on first test (첫 번째 테스트의 서버 콜드 스타트를 위해 충분한 타임아웃)
  timeout: 15_000,

  // Report to terminal (list) + generate HTML report (terminal 목록 + HTML 보고서 생성)
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  use: {
    // Base URL — all request.get('/path') calls resolve against this (모든 request.get('/path') 호출의 기준 URL)
    baseURL: 'http://localhost:3001',

    // Default headers applied to every API request (모든 API 요청에 적용되는 기본 헤더)
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
    },
  },

  // ── Local Web Server ──────────────────────────────────────────────────────
  //
  // Playwright starts the Express app on port 3001 before running any tests,
  // and shuts it down cleanly when all tests finish.
  // (Playwright는 테스트 실행 전 포트 3001에 Express 앱을 시작하고, 모든 테스트 완료 후 종료)

  webServer: {
    command: 'node src/app.js',

    // Playwright polls this URL; tests start only after it returns 200
    // (Playwright가 이 URL을 폴링 — 200 반환 후에만 테스트 시작)
    url: 'http://localhost:3001/',

    // In local dev: reuse a server already running on 3001 to save startup time
    // In CI: always start fresh to avoid stale state
    // (로컬 개발: 이미 실행 중인 3001 서버 재사용으로 시작 시간 절약 / CI: 항상 새로 시작)
    reuseExistingServer: !process.env.CI,

    // Server must be ready within this window (서버는 이 시간 내에 준비 완료해야 함)
    timeout: 10_000,

    // ── Test Environment Variables ──────────────────────────────────────────
    //
    // These override the developer's local .env for the test server process.
    // They are scoped to this child process — the developer's shell is unaffected.
    // (테스트 서버 프로세스를 위해 개발자 로컬 .env를 재정의.
    //  이 자식 프로세스에만 적용 — 개발자 쉘에는 영향 없음)

    env: {
      // Use a dedicated port so tests never collide with the running dev server
      // (개발 서버와 충돌하지 않도록 전용 포트 사용)
      PORT: '3001',

      // Enable mock tenant path — tenantMiddleware skips Supabase entirely
      // (목 테넌트 경로 활성화 — tenantMiddleware가 Supabase를 완전히 우회)
      NODE_ENV:        'development',
      USE_MOCK_TENANT: 'true',

      // Stub Supabase values — env.js requires these keys to exist but they are never
      // called when USE_MOCK_TENANT=true (스텁 Supabase 값 — env.js가 존재를 요구하지만
      // USE_MOCK_TENANT=true일 때 실제 호출 없음)
      SUPABASE_URL:              'https://stub-test-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'stub-service-role-key-for-tests-only',

      // Redis — BullMQ will emit connection errors if Redis is unavailable, but the
      // webhook 200 response is sent BEFORE enqueueOrder() runs (fire-and-forget).
      // Tests pass regardless of whether Redis is reachable.
      // (Redis — 비가용 시 BullMQ가 연결 오류를 emit하지만, 웹훅 200 응답은 enqueueOrder()
      //  실행 전에 전송됨. Redis 접근 가능 여부에 관계없이 테스트 통과)
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6379',
    },
  },
});
