// Server Supabase client factory — for use in Server Components, Route Handlers, and Middleware.
// Must be called once per request; reads/writes cookies via Next.js `cookies()` API.
// (서버 Supabase 클라이언트 팩토리 — 서버 컴포넌트, 라우트 핸들러, 미들웨어에서 사용.
//  요청당 한 번 호출; Next.js cookies() API로 쿠키 읽기/쓰기)

import { createServerClient } from '@supabase/ssr';
import { cookies }            from 'next/headers';

// Returns a Supabase client scoped to the current request's cookie jar.
// (현재 요청의 쿠키 저장소에 범위가 지정된 Supabase 클라이언트 반환)
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        // Read a single cookie by name (이름으로 단일 쿠키 읽기)
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // Write one or more cookies — used when refreshing the session token.
        // (세션 토큰 갱신 시 하나 이상의 쿠키 쓰기)
        set(name: string, value: string, options: Record<string, unknown>) {
          cookieStore.set({ name, value, ...options });
        },
        // Remove a cookie by setting it to empty with maxAge 0.
        // (maxAge 0으로 빈 값 설정하여 쿠키 삭제)
        remove(name: string, options: Record<string, unknown>) {
          cookieStore.set({ name, value: '', ...options });
        },
      },
    },
  );
}
