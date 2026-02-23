// BullMQ order queue producer — enqueues incoming voice orders for async processing
// (BullMQ 주문 큐 프로듀서 — 수신된 음성 주문을 비동기 처리용 큐에 등록)
import { Queue } from 'bullmq';
import { env } from '../config/env.js';

export const ORDER_QUEUE_NAME = 'order-queue';

// BullMQ manages its own IORedis connection from options — do NOT share the app-level redisClient
// (BullMQ는 옵션에서 자체 IORedis 연결 관리 — 앱 레벨 redisClient 공유 금지)
const connection = {
  host:     env.redis.host,
  port:     env.redis.port,
  password: env.redis.password,
};

// Singleton Queue instance — created once and reused for all enqueue calls
// (싱글톤 큐 인스턴스 — 한 번 생성 후 모든 enqueue 호출에서 재사용)
const orderQueue = new Queue(ORDER_QUEUE_NAME, {
  connection,
  defaultJobOptions: {
    attempts: 3,                                    // Retry up to 3 times on failure (실패 시 최대 3회 재시도)
    backoff: { type: 'exponential', delay: 3000 },  // 3s → 9s → 27s exponential back-off (지수 백오프)
    removeOnComplete: { count: 200 },               // Keep last 200 completed jobs for audit (감사용 완료 잡 200개 유지)
    removeOnFail:     { count: 100 },               // Keep last 100 failed jobs for debugging (디버깅용 실패 잡 100개 유지)
  },
});

orderQueue.on('error', (err) => {
  // Log queue-level errors — connection drops, serialization failures, etc.
  // (큐 레벨 오류 로깅 — 연결 끊김, 직렬화 실패 등)
  console.error('[Queue:producer] Queue error (큐 오류):', err.message);
});

/**
 * Enqueue an order job for asynchronous processing by the worker.
 * Called after the webhook controller has already responded 200 to Retell.
 * (웹훅 컨트롤러가 Retell에 200 응답 후 호출 — 비동기 처리용 주문 잡 등록)
 *
 * @param {object} orderData    — normalized order payload from Retell webhook (Retell 웹훅의 정규화된 주문 데이터)
 * @param {object} storeContext — tenant context from req.storeContext (req.storeContext의 테넌트 컨텍스트)
 * @returns {Promise<{ jobId: string, queueName: string }>}
 */
export async function enqueueOrder(orderData, storeContext) {
  // Use a deterministic jobId to prevent duplicate processing if the webhook fires twice
  // (웹훅 중복 발생 시 이중 처리 방지를 위한 결정론적 잡 ID 사용)
  const jobId = `order-${storeContext.agentId}-${orderData.orderId}`;

  const job = await orderQueue.add(
    'process-order',  // Job type name — useful for per-type metrics (잡 유형명 — 유형별 메트릭에 유용)
    {
      orderData,
      storeContext,
      enqueuedAt: new Date().toISOString(),  // Timestamp for queue latency tracking (큐 지연 시간 추적용 타임스탬프)
    },
    {
      jobId,
      // Override retry delay for this specific job if needed (필요 시 이 잡의 재시도 지연 재정의)
      // priority: 1,  // lower number = higher priority (숫자가 낮을수록 우선순위 높음)
    }
  );

  console.log(
    `[Queue:producer] Enqueued job ${job.id} for order ${orderData.orderId} ` +
    `(잡 ${job.id} 등록 완료 — 주문 ${orderData.orderId})`
  );

  return {
    jobId:     job.id,
    queueName: ORDER_QUEUE_NAME,
  };
}

// Export the queue instance for use in health checks or queue introspection
// (헬스 체크 또는 큐 조회를 위한 큐 인스턴스 내보내기)
export { orderQueue };
