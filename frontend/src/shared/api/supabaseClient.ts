// Browser Supabase client — lazy singleton for Client Components and hooks.
// Uses @supabase/ssr createBrowserClient for cookie-based session management.
// Lazy initialization prevents module-level evaluation errors when env vars are absent (e.g. during CI builds).
// (브라우저 Supabase 클라이언트 — 클라이언트 컴포넌트와 훅을 위한 지연 싱글톤.
//  @supabase/ssr의 createBrowserClient로 쿠키 기반 세션 관리.
//  환경 변수 없는 CI 빌드 시 모듈 레벨 평가 오류 방지를 위해 지연 초기화)

import { createBrowserClient } from '@supabase/ssr';

type SupabaseClient = ReturnType<typeof createBrowserClient>;

// Factory used when you need a fresh instance (e.g. in tests).
// (새 인스턴스가 필요할 때 사용하는 팩토리 — 예: 테스트)
export function createClient(): SupabaseClient {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

// Lazy singleton — only instantiated on first call, never at module evaluation time.
// Import and call getSupabaseClient() in Client Components instead of a bare singleton.
// (지연 싱글톤 — 첫 호출 시에만 인스턴스화, 모듈 평가 시점에는 생성 안 함.
//  클라이언트 컴포넌트에서 bare 싱글톤 대신 getSupabaseClient() 호출하여 import)
let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) _client = createClient();
  return _client;
}
