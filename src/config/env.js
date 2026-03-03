// Load and validate environment variables at startup (앱 시작 시 환경 변수 로드 및 검증)
import 'dotenv/config';

// Required variables that must exist — crash early if missing (없으면 즉시 종료 — Fast Fail 전략)
const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key} (필수 환경 변수 누락: ${key})`);
  }
}

// Non-fatal warning for important-but-optional keys — the server starts without them,
// but features that depend on them will be degraded or disabled at runtime.
// Logged here (at boot) so the developer sees the gap before any call arrives.
// (선택적이지만 중요한 키의 비치명 경고 — 서버는 이 없이도 시작되지만
//  의존 기능이 저하되거나 비활성화됨. 부팅 시 로깅하여 통화 전에 개발자가 확인 가능)
if (!process.env.RETELL_API_KEY) {
  console.error(
    '!!! CRITICAL ERROR: RETELL_API_KEY IS MISSING IN BACKEND .ENV !!! ' +
    'Phone lookup and CRM personalisation are DISABLED for ALL calls. ' +
    '(치명 오류: .env에 RETELL_API_KEY 누락 — 모든 통화의 전화번호 조회 및 CRM 개인화 비활성화)'
  );
}

export const env = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  // Supabase connection config (Supabase 연결 설정)
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },

  // Redis connection config (Redis 연결 설정)
  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
};
