// Shared IORedis client — single connection reused across queue producers (공유 Redis 클라이언트 — 큐 프로듀서 전역 재사용)
import Redis from 'ioredis';
import { env } from './env.js';

// BullMQ requires maxRetriesPerRequest: null for blocking commands (BullMQ 블로킹 명령을 위해 maxRetriesPerRequest: null 필수)
// Render의 통짜 주소(REDIS_URL)가 있으면 우선 사용하고, 없으면 로컬 방식을 사용합니다.
export const redisClient = process.env.REDIS_URL 
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
  : new Redis({
      host: env.redis.host,
      port: env.redis.port,
      password: env.redis.password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });

redisClient.on('connect', () => {
  console.log(`[Redis] Connected to ${env.redis.host}:${env.redis.port} (Redis 연결 성공)`);
});

redisClient.on('error', (err) => {
  console.error('[Redis] Connection error (Redis 연결 오류):', err.message);
});
