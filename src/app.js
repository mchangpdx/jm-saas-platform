// Entry point — bootstrap Express app and mount all middleware/routes (진입점 — Express 앱 초기화 및 미들웨어/라우트 마운트)
import './config/env.js'; // Validate env vars before anything else (다른 모듈보다 먼저 환경 변수 검증)
import express from 'express';
import axios             from 'axios';
import { env }            from './config/env.js';
import { v1Router }       from './routes/v1/index.js';
import { paymentRouter }  from './routes/paymentRoutes.js';
import { posRouter }      from './routes/posRoutes.js';
import { webhookRouter }  from './routes/webhookRoutes.js';
import { authRouter }     from './routes/authRoutes.js';
import { setupWebSocket } from './websocket/llmServer.js';
import './jobs/cronJobs.js'; // Activate the daily menu sync scheduler on boot (부팅 시 일별 메뉴 동기화 스케줄러 활성화)

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

// Mount webhook router — receives real-time Loyverse item update notifications
// (웹훅 라우터 마운트 — 실시간 Loyverse 항목 업데이트 알림 수신)
app.use('/api/webhooks', webhookRouter);

// Mount auth router — one-time Loyverse OAuth setup (일회성 Loyverse OAuth 설정 라우터 마운트)
app.use('/api/auth', authRouter);

// ── Root Route — OAuth callback or health check ───────────────────────────────
//
// LOYVERSE_REDIRECT_URI is set to the root ngrok URL, so the OAuth callback
// lands here as GET /?code=<auth_code>. Any request without a code is a
// standard infrastructure health check.
// (LOYVERSE_REDIRECT_URI가 ngrok 루트 URL로 설정되어 OAuth 콜백이
//  GET /?code=<인증_코드>로 도착. code 없는 요청은 일반 헬스 체크)
app.get('/', async (req, res) => {

  if (!req.query.code) {
    // No OAuth code present — standard health check response (OAuth 코드 없음 — 일반 헬스 체크 응답)
    return res.json({ service: 'jm-saas-platform', status: 'running' });
  }

  // ── OAuth callback — exchange code → token → register webhook ─────────────
  const { code } = req.query;

  // Validate all required OAuth env vars before making any network call
  // (네트워크 호출 전에 필수 OAuth 환경 변수를 모두 검증)
  const clientId     = process.env.LOYVERSE_CLIENT_ID;
  const clientSecret = process.env.LOYVERSE_CLIENT_SECRET;
  const redirectUri  = process.env.LOYVERSE_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    // Log exact values so missing vars are immediately visible in server output
    // (누락된 환경 변수를 서버 출력에서 즉시 확인할 수 있도록 정확한 값 로깅)
    console.error(
      `[OAuth] Missing ENV variables | clientId: ${clientId} | ` +
      `clientSecret: ${clientSecret ? '***set***' : 'MISSING'} | redirectUri: ${redirectUri} ` +
      `(OAuth 환경 변수 누락 | clientId: ${clientId} | redirectUri: ${redirectUri})`
    );
    return res.status(500).send('Server Configuration Error: Missing ENV variables (LOYVERSE_CLIENT_ID, LOYVERSE_CLIENT_SECRET, or LOYVERSE_REDIRECT_URI)');
  }

  console.log(
    `[OAuth] Callback received | code: ${code.slice(0, 8)}… | clientId: ${clientId} ` +
    `(OAuth 콜백 수신 | 코드: ${code.slice(0, 8)}… | 클라이언트 ID: ${clientId})`
  );

  try {
    // Step 1: Exchange authorization code for an access token.
    // OAuth 2.0 spec requires application/x-www-form-urlencoded — NOT JSON.
    // URLSearchParams serialises the body correctly and Axios sets the Content-Type header automatically.
    // (인증 코드를 액세스 토큰으로 교환.
    //  OAuth 2.0 규격은 application/x-www-form-urlencoded 필수 — JSON 불가.
    //  URLSearchParams가 바디를 올바르게 직렬화하고 Axios가 Content-Type 헤더를 자동 설정)
    const tokenPayload = new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
    });

    const tokenRes = await axios.post('https://api.loyverse.com/oauth/token', tokenPayload);

    const accessToken = tokenRes.data.access_token;

    console.log(
      '[OAuth] Access token obtained — registering webhook (' +
      'OAuth 액세스 토큰 획득 — 웹훅 등록 중)'
    );

    // Step 2: Register the items.update webhook using the newly obtained token.
    // Loyverse requires the key "type" (NOT "action") — sending "action" causes a 400 error.
    // Content-Type must be application/json for this endpoint.
    // (새로 획득한 토큰으로 items.update 웹훅 등록.
    //  Loyverse는 "type" 키를 요구함 — "action" 사용 시 400 오류 발생.
    //  이 엔드포인트는 Content-Type: application/json 필수)
    const webhookPayload = {
      type:   'items.update',                                          // Loyverse required key — must be "type" not "action" (Loyverse 필수 키 — "action"이 아닌 "type" 사용)
      url:    `${redirectUri}/api/webhooks/loyverse/items`,           // Endpoint that receives real-time item change events (실시간 항목 변경 이벤트를 수신하는 엔드포인트)
      status: 'ENABLED',                                              // Required by Loyverse — explicitly activates the webhook (Loyverse 필수 — 웹훅을 명시적으로 활성화)
    };

    await axios.post('https://api.loyverse.com/v1.0/webhooks', webhookPayload, {
      headers: {
        Authorization:  `Bearer ${accessToken}`,  // Short-lived token from OAuth exchange (OAuth 교환으로 얻은 단기 토큰)
        'Content-Type': 'application/json',
      },
    });

    console.log(
      '[OAuth] Webhook registered successfully | type: items.update (' +
      'OAuth 웹훅 등록 성공 | 타입: items.update)'
    );

    // Step 3: Confirm success to the user — they can now close the browser tab
    // (사용자에게 성공 확인 — 브라우저 탭을 닫아도 됨)
    return res.status(200).send(
      '<h1>Webhook Setup Complete!</h1>' +
      '<p>Loyverse will now send real-time item updates to this server. You can close this window.</p>'
    );

  } catch (err) {
    // OAuth or webhook registration failed — show error detail in the browser (OAuth 또는 웹훅 등록 실패 — 브라우저에 오류 상세 표시)
    const detail = err.response?.data ?? err.message;
    console.error(
      `[OAuth] Setup failed | ${JSON.stringify(detail)} ` +
      `(OAuth 설정 실패 | 오류: ${JSON.stringify(detail)})`
    );
    return res.status(500).send(
      `<h1>OAuth Setup Failed</h1><p>${JSON.stringify(detail)}</p>`
    );
  }
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
