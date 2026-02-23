// Shared IORedis client — single connection reused across queue producers (공유 Redis 클라이언트 — 큐 프로듀서 전역 재사용)
import Redis from 'ioredis';
import { env } from './env.js';

// BullMQ requires maxRetriesPerRequest: null for blocking commands (BullMQ 블로킹 명령을 위해 maxRetriesPerRequest: null 필수)
export const redisClient = new Redis({
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
