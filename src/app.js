// Entry point — bootstrap Express app and mount all middleware/routes (진입점 — Express 앱 초기화 및 미들웨어/라우트 마운트)
import './config/env.js'; // Validate env vars before anything else (다른 모듈보다 먼저 환경 변수 검증)
import express from 'express';
import cors    from 'cors';
import axios             from 'axios';
import { env }            from './config/env.js';
import { v1Router }       from './routes/v1/index.js';
import { paymentRouter }  from './routes/paymentRoutes.js';
import { posRouter }      from './routes/posRoutes.js';
import { webhookRouter }  from './routes/webhookRoutes.js';
import { authRouter }     from './routes/authRoutes.js';
import { aiRouter }       from './routes/aiRoutes.js';
import { syncRouter }     from './routes/syncRoutes.js';
import { setupWebSocket } from './websocket/llmServer.js';
import './jobs/cronJobs.js'; // Activate the daily menu sync scheduler on boot (부팅 시 일별 메뉴 동기화 스케줄러 활성화)
import solinkRoutes from './routes/solinkRoutes.js'; // ★ Import the new router

const app = express();

// ── Global Middleware ──────────────────────────────────────────────────────────

// Allow cross-origin requests from the Next.js dev server (Next.js 개발 서버의 크로스 오리진 요청 허용)
// --- CORS VIP 명단 설정 ---
const allowedOrigins = [
  'http://localhost:3000', // 로컬 테스트용 (3000 포트)
  'http://localhost:3001', // 로컬 테스트용 (3001 포트)
  'https://jm-saas-platform-demo.netlify.app', // Netlify 임시 도메인
  'https://aidemo.jmtechone.com' // 사장님 정식 도메인 (✨가장 중요)
];

app.use(cors({
  origin: function (origin, callback) {
    // origin이 없거나(서버 간 통신), VIP 명단에 있으면 통과
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS 정책에 의해 차단되었습니다.'));
    }
  },
  credentials: true, // 쿠키 및 인증 헤더 허용
}));

// Parse incoming JSON bodies — must run BEFORE the body logger so req.body is populated
// (JSON 바디 파싱 — req.body가 채워지도록 바디 로거보다 먼저 실행되어야 함)
app.use(express.json());

// Parse URL-encoded form data (URL 인코딩 폼 데이터 파싱)
app.use(express.urlencoded({ extended: false }));

// X-Ray logger — runs AFTER body parsers so req.body is fully available for every method.
// Logs method, URL, and the parsed body to confirm what the server actually receives.
// (X-Ray 로거 — 바디 파서 이후 실행하여 모든 메서드에서 req.body 완전히 사용 가능.
//  서버가 실제로 수신한 내용 확인을 위해 메서드, URL, 파싱된 바디 기록)
app.use((req, _res, next) => {
  console.log(`[Server Trace] ${req.method} ${req.url} | Body:`, req.body); // Full request trace for CORS + storeId debugging (CORS + storeId 디버깅을 위한 전체 요청 추적)
  next();
});

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

// Mount AI router — simplified endpoints designed for LLM tool/function calling
// (AI 라우터 마운트 — LLM 도구/함수 호출을 위해 설계된 간소화된 엔드포인트)
app.use('/api/ai', aiRouter);

// Mount sync router — Expert Mode (Method B) POS → staging → AI menu pipeline
// (동기화 라우터 마운트 — 전문가 모드(방법 B) POS → 스테이징 → AI 메뉴 파이프라인)
app.use('/api/sync', syncRouter);

// ★ Mount the router to a specific API path (Solink Router)
app.use('/api/solink', solinkRoutes);

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

    // Step 2: Register all three critical webhooks in a loop.
    // Each type gets its own endpoint path derived from the event name prefix.
    // Errors are caught per-type so a duplicate registration does not abort the rest.
    // (세 가지 핵심 웹훅을 루프로 등록.
    //  각 타입은 이벤트명 접두사에서 파생된 고유 엔드포인트 경로를 가짐.
    //  오류는 타입별로 포착 — 중복 등록이 나머지 등록을 중단하지 않음)
    const webhookTypes = ['items.update', 'receipts.update', 'inventory_levels.update'];

    for (const type of webhookTypes) {
      // Derive endpoint name from the event type prefix (e.g. 'items.update' → 'items')
      // (이벤트 타입 접두사에서 엔드포인트명 파생 — 예: 'items.update' → 'items')
      const endpointName = type.split('.')[0];

      const webhookPayload = {
        type:   type,                                                    // Loyverse event type — "type" key required (NOT "action") (Loyverse 이벤트 타입 — "action"이 아닌 "type" 키 사용)
        url:    `${redirectUri}/api/webhooks/loyverse/${endpointName}`, // Dedicated endpoint per event type (이벤트 타입별 전용 엔드포인트)
        status: 'ENABLED',                                               // Required by Loyverse to activate the webhook (웹훅 활성화를 위한 Loyverse 필수 필드)
      };

      try {
        await axios.post('https://api.loyverse.com/v1.0/webhooks', webhookPayload, {
          headers: {
            Authorization:  `Bearer ${accessToken}`,  // Short-lived token from OAuth exchange (OAuth 교환으로 얻은 단기 토큰)
            'Content-Type': 'application/json',
          },
        });
        console.log(
          `[OAuth] Webhook registered | type: ${type} | endpoint: /api/webhooks/loyverse/${endpointName} ` +
          `(웹훅 등록 성공 | 타입: ${type} | 엔드포인트: /api/webhooks/loyverse/${endpointName})`
        );
      } catch (webhookErr) {
        // Log but continue — webhook may already exist from a previous setup run (로깅 후 계속 — 이전 설정에서 웹훅이 이미 존재할 수 있음)
        const webhookDetail = webhookErr.response?.data ?? webhookErr.message;
        console.warn(
          `[OAuth] Webhook registration info | type: ${type} | ${JSON.stringify(webhookDetail)} ` +
          `(웹훅 등록 정보 | 타입: ${type} | 이미 존재하거나 실패)`
        );
      }
    }

    // Step 3: Confirm success to the user — they can now close the browser tab
    // (사용자에게 성공 확인 — 브라우저 탭을 닫아도 됨)
    return res.status(200).send(
      '<h1>Webhook Setup Complete!</h1>' +
      '<p>Registered: items.update, receipts.update, inventory_levels.update. You can close this window.</p>'
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

// 프론트엔드에서 솔링크 이벤트를 검색할 수 있도록 뚫어주는 정식 API
app.get('/api/solink/events', async (req, res) => {
    try {
        // 1. 프론트엔드에서 보낸 검색 조건(날짜 등)을 받습니다. (안 보내면 기본 7일)
        const days = req.query.days ? parseInt(req.query.days) : 7;
        
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);

        // 2. 솔링크 토큰 발급 (이전에 쓰시던 getSolinkToken 함수가 있다면 그걸 쓰셔도 됩니다)
        const tokenResponse = await axios.post(
            "https://api-prod-us-west-2.solinkcloud.com/v2/oauth/token", 
            {
                client_id: "7df388c42e968295f2747890b8695cb1", 
                client_secret: "1L0/pk/u4VvKu4nUNhb1tByDgZXSvwi8PLS1BCjINOaM5VxcD5um7MKhEYMG1TSGlZXT84c=", 
                audience: "https://prod.solinkcloud.com/", 
                grant_type: "client_credentials" 
            },
            { headers: { "x-api-key": "FWcxTFalhW5ZNOxmgKUGW38EtLHA4PuM75BUa7jW" } }
        );
        const token = tokenResponse.data.access_token;

        // 3. 솔링크에서 데이터 검색
        const eventsResponse = await axios.get(
            `https://api-prod-us-west-2.solinkcloud.com/v2/events?startTime=${startDate.toISOString()}&endTime=${endDate.toISOString()}`,
            {
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "x-api-key": "FWcxTFalhW5ZNOxmgKUGW38EtLHA4PuM75BUa7jW"
                }
            }
        );

        // 4. 검색된 결과를 프론트엔드로 전달!
        const events = eventsResponse.data.events || eventsResponse.data;
        res.status(200).json({ success: true, data: events });

    } catch (error) {
        console.error("Solink API Error:", error.message);
        res.status(500).json({ success: false, message: "솔링크 데이터 조회 실패" });
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
