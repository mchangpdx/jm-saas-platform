// Next.js Edge Proxy (formerly middleware) — intercepts every matched request to refresh
// the Supabase session token and enforce auth guards before the route handler runs.
// (Next.js 엣지 프록시 (구 미들웨어) — 매칭된 모든 요청에서 Supabase 세션 토큰을 갱신하고
//  라우트 핸들러 실행 전에 인증 가드 적용)

import { createServerClient }      from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Routes that require an authenticated session (인증된 세션이 필요한 라우트)
const PROTECTED_PREFIXES = ['/agency', '/store'];

// Routes that authenticated users should not re-visit (인증된 사용자가 재방문하지 않아야 하는 라우트)
const AUTH_ROUTES = ['/login', '/signup'];

// Named "proxy" per Next.js 16 convention (renamed from "middleware" in Next.js 15).
// (Next.js 16 컨벤션에 따라 "proxy"로 명명 — Next.js 15의 "middleware"에서 변경)
export async function proxy(request: NextRequest) {
  // Start with a plain pass-through response; the cookie handler will mutate it.
  // (쿠키 핸들러가 변경할 수 있는 기본 통과 응답으로 시작)
  let response = NextResponse.next({ request });

  // Build a middleware-scoped Supabase client that can read and refresh cookies.
  // (쿠키를 읽고 갱신할 수 있는 미들웨어 범위의 Supabase 클라이언트 생성)
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Write cookies to both the outgoing request and response so downstream
          // Server Components can read the refreshed session immediately.
          // (다운스트림 서버 컴포넌트가 갱신된 세션을 즉시 읽을 수 있도록
          //  요청과 응답 모두에 쿠키 쓰기)
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh the session — MUST be called before any redirect logic.
  // getUser() is safe: it validates the JWT server-side, not just from the cookie.
  // (세션 갱신 — 리다이렉트 로직 전에 반드시 호출.
  //  getUser()는 쿠키가 아닌 서버 사이드 JWT 검증으로 안전함)
  const { data: { user } } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Redirect unauthenticated users away from protected routes (인증 안 된 사용자를 보호 라우트에서 리다이렉트)
  const isProtected = PROTECTED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (isProtected && !user) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from login/signup (인증된 사용자를 로그인/회원가입에서 리다이렉트)
  const isAuthRoute = AUTH_ROUTES.some((route) => pathname.startsWith(route));
  if (isAuthRoute && user) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = '/agency';
    return NextResponse.redirect(dashboardUrl);
  }

  return response;
}

// Apply middleware to all routes except Next.js internals and static assets.
// (Next.js 내부 경로와 정적 자산을 제외한 모든 라우트에 미들웨어 적용)
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
