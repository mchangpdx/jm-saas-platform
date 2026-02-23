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
