// Entry point — bootstrap Express app and mount all middleware/routes (진입점 — Express 앱 초기화 및 미들웨어/라우트 마운트)
import './config/env.js'; // Validate env vars before anything else (다른 모듈보다 먼저 환경 변수 검증)
import express from 'express';
import { env }            from './config/env.js';
import { v1Router }       from './routes/v1/index.js';
import { paymentRouter }  from './routes/paymentRoutes.js';
import { posRouter }      from './routes/posRoutes.js';
import { setupWebSocket } from './websocket/llmServer.js';

const app = express();

// ── Global Middleware ──────────────────────────────────────────────────────────

// Parse incoming JSON bodies (JSON 바디 파싱)
app.use(express.json());

// Parse URL-encoded form data (URL 인코딩 폼 데이터 파싱)
app.use(express.urlencoded({ extended: false }));

// Attach request timestamp for latency tracking (요청 타임스탬프 주입 — 지연 시간 추적용)
app.use((_req, _res, next) => {
  _req.startedAt = Date.now();
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────

// Mount versioned API router (버전 관리 API 라우터 마운트)
app.use('/api/v1', v1Router);

// Mount payment callback router — handles mock PG redirect and order status updates
// (결제 콜백 라우터 마운트 — 목 PG 리다이렉트 및 주문 상태 업데이트 처리)
app.use('/api/payment', paymentRouter);

// Mount POS management router — Loyverse catalog sync and menu management
// (POS 관리 라우터 마운트 — Loyverse 카탈로그 동기화 및 메뉴 관리)
app.use('/api/pos', posRouter);

// Root ping — infrastructure health check (루트 핑 — 인프라 헬스 체크)
app.get('/', (_req, res) => {
  res.json({ service: 'jm-saas-platform', status: 'running' });
});

// ── 404 Handler ───────────────────────────────────────────────────────────────

// Catch unmatched routes and return structured 404 (매칭되지 않은 라우트 처리 — 구조화된 404 반환)
app.use((req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    message: '요청한 경로를 찾을 수 없습니다.',
  });
});

// ── Global Error Handler ──────────────────────────────────────────────────────

// Centralized error handler — must have 4 params for Express to treat it as error middleware
// (중앙 집중식 오류 핸들러 — Express가 오류 미들웨어로 인식하려면 4개 매개변수 필수)
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode ?? 500;
  console.error(`[Error] ${err.message} (오류 발생)`, { stack: err.stack });
  res.status(statusCode).json({
    error: err.message ?? 'Internal server error',
    message: '서버 오류가 발생했습니다.',
  });
});

// ── Server Start ──────────────────────────────────────────────────────────────

// app.listen() returns the underlying http.Server — capture it so we can attach the WebSocket server.
// Both HTTP (Express) and WS traffic share the same port; the ws library discriminates via the
// HTTP Upgrade header on the initial handshake request.
// (app.listen()은 기본 http.Server를 반환 — WebSocket 서버 부착을 위해 캡처.
//  HTTP(Express)와 WS 트래픽이 동일 포트 공유 — ws 라이브러리가 초기 핸드셰이크의 HTTP Upgrade 헤더로 구별)
const httpServer = app.listen(env.port, () => {
  console.log(`[Server] JM SaaS Platform running on port ${env.port} (서버 시작: 포트 ${env.port})`);
  console.log(`[Server] Environment: ${env.nodeEnv} (환경: ${env.nodeEnv})`);
});

// Attach WebSocket server to the same HTTP server instance (동일 HTTP 서버 인스턴스에 WebSocket 서버 부착)
setupWebSocket(httpServer);

export default app;
