// BullMQ order queue worker — processes jobs by orchestrating POS + payment adapters
// (BullMQ 주문 큐 워커 — POS + 결제 어댑터를 조율하여 잡 처리)
//
// Run as standalone process in production: node src/queue/worker.js
// In development: imported as a side-effect by app.js (or run separately)
// (운영 환경: 독립 프로세스로 실행 / 개발 환경: app.js의 사이드 이펙트 또는 별도 실행)

import { Worker, UnrecoverableError } from 'bullmq';
import { env } from '../config/env.js';
import { getPaymentAdapter } from '../adapters/payment/factory.js';
import { ORDER_QUEUE_NAME } from './producer.js';

// Separate IORedis connection options — Worker uses blocking XREAD commands that must not
// share a connection with the Queue producer (워커는 블로킹 XREAD를 사용하므로 프로듀서와 연결 분리 필수)
const connection = {
  host:     env.redis.host,
  port:     env.redis.port,
  password: env.redis.password,
};

// ── Job Processor ─────────────────────────────────────────────────────────────

/**
 * Main job processor — receives a BullMQ job and orchestrates the full order lifecycle.
 * BullMQ automatically retries this function on thrown errors (up to defaultJobOptions.attempts).
 * (BullMQ 잡 프로세서 — 주문 전체 생애주기 조율. 오류 발생 시 자동 재시도)
 *
 * @param {import('bullmq').Job} job
 */
async function processOrderJob(job) {
  const { orderData, storeContext, enqueuedAt } = job.data;

  // Log queue latency — time between enqueue and worker pickup (큐 지연 시간 로깅 — 등록~처리 시간)
  const queueLatencyMs = Date.now() - new Date(enqueuedAt).getTime();
  console.log(
    `[Worker] ▶ Starting job ${job.id} | order: ${orderData.orderId} | ` +
    `queue latency: ${queueLatencyMs}ms | agent: ${storeContext.agentId} ` +
    `(잡 시작 | 주문: ${orderData.orderId} | 큐 지연: ${queueLatencyMs}ms)`
  );

  // ── Stage 1: Validate job payload before doing any I/O (I/O 수행 전 잡 페이로드 검증) ──
  validateOrderPayload(orderData, job);

  // Update job progress — BullMQ stores this and it's readable via QueueEvents
  // (잡 진행 상황 업데이트 — BullMQ 저장, QueueEvents로 읽기 가능)
  await job.updateProgress(10);

  // ── Stage 2: Push order to POS system via POS adapter (POS 어댑터로 POS 시스템에 주문 전송) ──
  const posResult = await processPosStage(orderData, storeContext, job);
  await job.updateProgress(50);

  // ── Stage 3: Process payment via Payment adapter (결제 어댑터로 결제 처리) ──
  const paymentResult = await processPaymentStage(orderData, storeContext, job);
  await job.updateProgress(90);

  // ── Stage 4: Build and return combined result (결합 결과 구성 및 반환) ──
  const result = {
    orderId:      orderData.orderId,
    agentId:      storeContext.agentId,
    pos:          posResult,
    payment:      paymentResult,
    completedAt:  new Date().toISOString(),
    queueLatencyMs,
  };

  await job.updateProgress(100);

  console.log(
    `[Worker] ✓ Job ${job.id} completed for order ${orderData.orderId} ` +
    `(잡 ${job.id} 완료 — 주문 ${orderData.orderId})`
  );

  return result; // Stored as job.returnvalue in BullMQ (BullMQ의 job.returnvalue로 저장됨)
}

// ── Stage Handlers ────────────────────────────────────────────────────────────

/**
 * Stage 2 — Send the order to the POS system.
 * POS adapters will be implemented in Step 5. This stub mirrors the real interface.
 * (스테이지 2 — POS 시스템에 주문 전송. POS 어댑터는 Step 5에서 구현. 실제 인터페이스를 모방한 스텁)
 *
 * @param {object} orderData
 * @param {object} storeContext
 * @param {import('bullmq').Job} job
 * @returns {Promise<object>} posResult
 */
async function processPosStage(orderData, storeContext, job) {
  console.log(
    `[Worker] [${job.id}] Stage 2 — sending to POS adapter: ${storeContext.posType} ` +
    `(스테이지 2 — POS 어댑터 전송: ${storeContext.posType})`
  );

  // TODO: replace stub with real POS adapter call in Step 5
  // (TODO: Step 5에서 실제 POS 어댑터 호출로 교체)
  //   import { getPosAdapter } from '../adapters/pos/factory.js';
  //   const posAdapter = getPosAdapter(storeContext.posType);
  //   return posAdapter.submitOrder(orderData, storeContext);

  // Stub: simulate POS network round-trip (스텁: POS 네트워크 왕복 시뮬레이션)
  await new Promise((r) => setTimeout(r, 200));

  return {
    posOrderId:  `POS-${storeContext.posType?.toUpperCase()}-${orderData.orderId}`,
    status:      'submitted',
    posType:     storeContext.posType ?? 'unknown',
    submittedAt: new Date().toISOString(),
  };
}

/**
 * Stage 3 — Charge the customer via the tenant's configured payment gateway.
 * Resolves the correct adapter from the factory and calls processPayment().
 * (스테이지 3 — 테넌트 설정 결제 게이트웨이로 고객 결제. 팩토리에서 어댑터 해석 후 processPayment 호출)
 *
 * @param {object} orderData
 * @param {object} storeContext
 * @param {import('bullmq').Job} job
 * @returns {Promise<import('../adapters/payment/interface.js').PaymentResult>}
 */
async function processPaymentStage(orderData, storeContext, job) {
  const { paymentType } = storeContext;

  console.log(
    `[Worker] [${job.id}] Stage 3 — charging via ${paymentType} adapter ` +
    `(스테이지 3 — ${paymentType} 어댑터로 결제 처리)`
  );

  // Resolve adapter via factory — defaults to MAVERICK if paymentType is missing
  // (팩토리에서 어댑터 해석 — paymentType 없으면 MAVERICK 기본값)
  const paymentAdapter = getPaymentAdapter(paymentType);

  const paymentResult = await paymentAdapter.processPayment(
    orderData.totalAmountCents,
    orderData.orderId,
    storeContext
  );

  // If the gateway hard-declined (not a transient error), do not retry the entire job
  // (게이트웨이 거절은 재시도해도 소용없음 — UnrecoverableError로 즉시 실패 처리)
  if (!paymentResult.success && paymentResult.status === 'declined') {
    throw new UnrecoverableError(
      `Payment declined for order ${orderData.orderId}: ${paymentResult.meta?.reason ?? 'unknown reason'} ` +
      `(주문 ${orderData.orderId} 결제 거절 — 재시도 없음)`
    );
  }

  return paymentResult;
}

// ── Payload Validation ────────────────────────────────────────────────────────

/**
 * Validate that the job data has the minimum fields required to process an order.
 * Throws UnrecoverableError for structurally invalid jobs — no point retrying bad data.
 * (잡 처리에 필요한 최소 필드 검증. 구조적으로 잘못된 잡은 재시도 없이 즉시 실패 처리)
 *
 * @param {object} orderData
 * @param {import('bullmq').Job} job
 */
function validateOrderPayload(orderData, job) {
  const missing = [];

  if (!orderData.orderId)                    missing.push('orderId');
  if (typeof orderData.totalAmountCents !== 'number') missing.push('totalAmountCents');
  if (!Array.isArray(orderData.items))       missing.push('items');

  if (missing.length > 0) {
    // UnrecoverableError prevents BullMQ from retrying — bad payload won't fix itself
    // (UnrecoverableError로 BullMQ 재시도 방지 — 잘못된 페이로드는 재시도해도 동일)
    throw new UnrecoverableError(
      `[Worker] Job ${job.id} has invalid payload — missing fields: ${missing.join(', ')} ` +
      `(잡 ${job.id} 페이로드 오류 — 누락 필드: ${missing.join(', ')})`
    );
  }
}

// ── Worker Instantiation ──────────────────────────────────────────────────────

const worker = new Worker(ORDER_QUEUE_NAME, processOrderJob, {
  connection,
  concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? '5', 10), // Env-configurable (환경 변수로 설정 가능)
  limiter: {
    max:      50,   // Max 50 jobs per interval (인터벌당 최대 50개 잡 처리)
    duration: 1000, // 1-second window (1초 윈도우)
  },
});

// ── Worker Event Listeners ────────────────────────────────────────────────────

worker.on('completed', (job, result) => {
  // Log at info level — completed jobs are expected (완료된 잡은 정상이므로 info 레벨 로깅)
  console.log(
    `[Worker] ✓ completed job ${job.id} | order: ${result.orderId} | ` +
    `payment: ${result.payment?.status} (잡 완료 | 결제: ${result.payment?.status})`
  );
});

worker.on('failed', (job, err) => {
  // Log failed jobs with attempt info for alerting/monitoring (알림/모니터링을 위한 실패 잡 로깅)
  console.error(
    `[Worker] ✗ failed job ${job?.id} | attempt ${job?.attemptsMade}/${job?.opts?.attempts} | ` +
    `${err.message} (잡 실패 | 시도: ${job?.attemptsMade}/${job?.opts?.attempts})`
  );
});

worker.on('error', (err) => {
  // Worker-level errors (Redis disconnect, etc.) — distinct from job-level failures
  // (워커 레벨 오류 — Redis 연결 끊김 등. 잡 레벨 실패와 구별)
  console.error('[Worker] Worker error (워커 오류):', err.message);
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────

// Close the worker cleanly on SIGTERM (container stop) and SIGINT (Ctrl+C)
// (SIGTERM — 컨테이너 종료 / SIGINT — Ctrl+C 시 워커 정상 종료)
async function shutdown(signal) {
  console.log(`[Worker] Received ${signal} — shutting down gracefully (${signal} 수신 — 정상 종료 중)`);
  await worker.close();
  console.log('[Worker] Worker closed (워커 종료 완료)');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

console.log(
  `[Worker] Listening on queue "${ORDER_QUEUE_NAME}" ` +
  `(큐 "${ORDER_QUEUE_NAME}" 대기 중)`
);

// Export for use in integration tests or programmatic control (통합 테스트 또는 프로그래밍 방식 제어용 내보내기)
export { worker };
