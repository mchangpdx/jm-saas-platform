// Supabase admin client using service role key — bypasses RLS (서비스 롤 키로 RLS 우회 — 서버 전용 클라이언트)
import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

export const supabase = createClient(
  env.supabase.url,
  env.supabase.serviceRoleKey,
  {
    auth: {
      // Disable session persistence — stateless server context (세션 유지 비활성화 — 무상태 서버 환경)
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);
