// Auth routes — one-time Loyverse OAuth 2.0 setup flow
// (인증 라우트 — 일회성 Loyverse OAuth 2.0 설정 흐름)
//
// Mounted at /api/auth in app.js.
// Usage: visit GET /api/auth/loyverse in a browser to start the OAuth flow.
// (app.js에서 /api/auth에 마운트.
//  사용법: 브라우저에서 GET /api/auth/loyverse를 방문하여 OAuth 흐름 시작)

import { Router } from 'express';

export const authRouter = Router();

// ── GET /loyverse ─────────────────────────────────────────────────────────────

/**
 * Start the Loyverse OAuth 2.0 authorization flow.
 *
 * Redirects the browser to the Loyverse authorization page where the merchant
 * grants this app permission to read their catalog and register webhooks.
 * After granting, Loyverse redirects back to LOYVERSE_REDIRECT_URI with a code.
 *
 * (브라우저를 Loyverse 인증 페이지로 리다이렉트.
 *  가맹점이 카탈로그 읽기 및 웹훅 등록 권한을 앱에 부여.
 *  권한 부여 후 Loyverse가 code와 함께 LOYVERSE_REDIRECT_URI로 리다이렉트)
 */
authRouter.get('/loyverse', (req, res) => {
  const clientId     = process.env.LOYVERSE_CLIENT_ID;
  const redirectUri  = process.env.LOYVERSE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    // Required env vars missing — cannot start OAuth flow (필수 환경 변수 누락 — OAuth 흐름 시작 불가)
    console.error('[AuthRoute] LOYVERSE_CLIENT_ID or LOYVERSE_REDIRECT_URI not set (LOYVERSE_CLIENT_ID 또는 LOYVERSE_REDIRECT_URI 미설정)');
    return res.status(500).send('<h1>Configuration Error</h1><p>LOYVERSE_CLIENT_ID or LOYVERSE_REDIRECT_URI is not set.</p>');
  }

  // Build the Loyverse authorization URL with required query parameters
  // (필수 쿼리 파라미터를 포함한 Loyverse 인증 URL 생성)
  const authUrl = new URL('https://api.loyverse.com/oauth/authorize');
  authUrl.searchParams.set('client_id',     clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri',  redirectUri);

  console.log(
    `[AuthRoute] Redirecting to Loyverse OAuth | clientId: ${clientId} ` +
    `(Loyverse OAuth로 리다이렉트 | 클라이언트 ID: ${clientId})`
  );

  res.redirect(authUrl.toString());
});
