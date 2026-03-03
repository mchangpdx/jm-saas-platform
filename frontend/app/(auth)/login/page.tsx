// Login page — email/password form using Supabase signInWithPassword.
// After a successful login, queries the profiles table for the user's role
// and redirects: agency → /agency, store → /store.
// (로그인 페이지 — Supabase signInWithPassword를 사용한 이메일/비밀번호 폼.
//  로그인 성공 후 profiles 테이블에서 역할 조회 후 역할 기반 리다이렉트:
//  에이전시 → /agency, 매장 → /store)

'use client';

import { useState, FormEvent }  from 'react';
import { useRouter }            from 'next/navigation';
import { Building2, Mic }       from 'lucide-react';
import { getSupabaseClient }    from '@/shared/api/supabaseClient';
import { Spinner }              from '@/shared/components/Spinner';

export default function LoginPage() {
  const router = useRouter();

  const [email,    setEmail   ] = useState('');
  const [password, setPassword] = useState('');
  const [loading,  setLoading ] = useState(false);
  const [error,    setError   ] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = getSupabaseClient();

    // Authenticate with Supabase — returns session + user on success.
    // Client is lazily initialized here (not at module load time) to avoid SSR issues.
    // (Supabase 인증 — 성공 시 세션 + 사용자 반환.
    //  SSR 문제 방지를 위해 모듈 로드 시점이 아닌 여기서 지연 초기화)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      // Surface the Supabase error message directly — it is already user-friendly.
      // (Supabase 오류 메시지를 직접 노출 — 이미 사용자 친화적)
      setError(authError.message);
      setLoading(false);
      return;
    }

    // Query profiles to determine which dashboard section to redirect to.
    // Default to 'agency' if the profile row doesn't exist yet.
    // (리다이렉트 목적지 결정을 위해 profiles 조회.
    //  프로필 행이 없으면 기본값 'agency' 사용)
    const userId = authData.user?.id;
    let role: 'agency' | 'store' = 'agency';

    if (userId) {
      // @ts-ignore
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle<{ role: 'agency' | 'store' }>();
      role = profile?.role ?? 'agency';
    }

    // Redirect based on role — session is already in cookies at this point.
    // (세션이 쿠키에 저장된 상태에서 역할에 따라 리다이렉트)
    router.push(role === 'store' ? '/store' : '/agency');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 dark:bg-gray-950">
      <div className="w-full max-w-sm space-y-6">

        {/* Brand header (브랜드 헤더) */}
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600">
            <Mic className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold">JM AI Voice Platform</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Sign in to your account</p>
        </div>

        {/* Login card (로그인 카드) */}
        <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Email field (이메일 필드) */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@restaurant.com"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:placeholder-gray-500"
              />
            </div>

            {/* Password field (비밀번호 필드) */}
            <div>
              <label className="mb-1.5 block text-sm font-medium">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3.5 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:placeholder-gray-500"
              />
            </div>

            {/* Error message (오류 메시지) */}
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            {/* Submit button (제출 버튼) */}
            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-60 dark:bg-indigo-500 dark:hover:bg-indigo-600"
            >
              {loading && <Spinner className="h-4 w-4 text-white" />}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Link to sign-up (회원가입 링크) */}
        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          Don&apos;t have an account?{' '}
          <a href="/signup" className="font-medium text-indigo-600 hover:underline dark:text-indigo-400">
            Sign up
          </a>
        </p>

        {/* Store selector hint (매장 선택기 힌트) */}
        <p className="flex items-center justify-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
          <Building2 className="h-3.5 w-3.5" />
          Multi-store access is available after login.
        </p>
      </div>
    </div>
  );
}
