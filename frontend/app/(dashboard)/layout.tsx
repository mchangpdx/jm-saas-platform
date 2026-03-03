// Dashboard layout — Server Component that enforces authentication and RBAC.
// Queries the profiles table for the user's role and email, then fetches stores:
//   agency → all stores (passed to global sidebar selector)
//   store  → single store linked via owner_id
// Missing profile row defaults to role='agency' so the app doesn't crash.
// Does NOT redirect for missing stores — child pages render their own empty states.
// (대시보드 레이아웃 — 인증 및 RBAC를 강제하는 서버 컴포넌트.
//  profiles 테이블에서 사용자 역할과 이메일 조회 후 역할별 매장 조회:
//    에이전시 → 전체 매장 (전역 사이드바 선택기에 전달)
//    매장     → owner_id로 연결된 단일 매장
//  profiles 행 없으면 role='agency' 기본값으로 앱 오류 방지.
//  매장 없음으로 인한 리다이렉트 금지 — 하위 페이지가 자체 빈 상태 렌더링)

import { redirect }                   from 'next/navigation';
import { createServerSupabaseClient } from '@/shared/api/supabaseServer';
import { DashboardShell }             from '@/shared/components/DashboardShell';

// profiles table row shape (profiles 테이블 행 형태)
interface ProfileRow {
  role:  'agency' | 'store';
  email: string;
}

// Minimal store shape for the agency sidebar selector (에이전시 사이드바 선택기를 위한 최소 매장 형태)
interface StoreOption {
  id:   string;
  name: string;
}

// Store shape for store-owner linked-store lookup.
// Only columns confirmed to exist in the stores table are selected here.
// agent_id is intentionally omitted — it does not exist in the current schema.
// (매장 소유자 연결 매장 조회용 형태.
//  stores 테이블에 실제로 존재하는 컬럼만 선택.
//  agent_id는 현재 스키마에 없으므로 의도적으로 제외)
interface LinkedStore {
  id:   string;
  name: string;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient();

  // Validate the session via server-side JWT check — more secure than getSession().
  // (서버 사이드 JWT 검증으로 세션 확인 — getSession()보다 안전)
  const { data: { user }, error: userError } = await supabase.auth.getUser();

  // Only unauthenticated users are redirected. (미인증 사용자만 리다이렉트)
  if (userError || !user) {
    redirect('/login');
  }

  // Resolve the user's role and email from the profiles table.
  // maybeSingle() returns null without error if no row exists yet.
  // Default to 'agency' so first-time users without a profile row still see the UI.
  // (profiles 테이블에서 역할과 이메일 조회.
  //  maybeSingle()은 행이 없을 때 오류 없이 null 반환.
  //  프로필 행이 없는 신규 사용자도 UI를 볼 수 있도록 기본값 'agency' 사용)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, email')
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  const role: 'agency' | 'store' = profile?.role ?? 'agency';
  const email: string             = profile?.email ?? user.email ?? '';

  // Fetch store data based on role.
  // (역할에 따라 매장 데이터 조회)
  let allStores:   StoreOption[]  = [];
  let linkedStore: LinkedStore | null = null;

  if (role === 'agency') {
    // Fetch all stores alphabetically for the global sidebar selector.
    // (전역 사이드바 선택기를 위해 알파벳 순으로 전체 매장 조회)
    const { data } = await supabase
      .from('stores')
      .select('id, name')
      .order('name', { ascending: true });
    allStores = data ?? [];
  } else {
    // Two-pass store lookup — tries owner_id first, then auth_user_id.
    // Uses .limit(1) instead of .maybeSingle() so multi-store users get the first
    // alphabetical store rather than a PGRST116 error. Only 'id' and 'name' are
    // selected — agent_id does NOT exist in the current stores table schema.
    // (2단계 매장 조회 — 먼저 owner_id, 없으면 auth_user_id 시도.
    //  다중 매장 사용자에게 PGRST116 오류 대신 첫 번째 알파벳 매장 반환을 위해
    //  maybeSingle() 대신 .limit(1) 사용. agent_id는 stores 테이블에 없으므로 제외)

    // Pass 1: look up store by owner_id (standard relational column)
    // (1단계: owner_id로 매장 조회 — 표준 관계형 컬럼)
    console.log(`[DB Trace] Pass 1 — searching stores WHERE owner_id = '${user.id}' (owner_id로 매장 검색)`);
    const { data: rowsOwner, error: ownerErr } = await supabase
      .from('stores')
      .select('id, name')
      .eq('owner_id', user.id)
      .order('name', { ascending: true })
      .limit(1);

    const byOwner: LinkedStore | null = rowsOwner?.[0] ?? null;

    // Log explicit Supabase error so failures are never silent (Supabase 오류 명시적 로그 — 조용한 실패 방지)
    if (ownerErr) {
      console.error(
        `[DB Fix] Supabase error on owner_id lookup | user: ${user.id} | ${ownerErr.message} ` +
        `(owner_id 조회 Supabase 오류 | 사용자: ${user.id} | 오류: ${ownerErr.message})`
      );
    }
    if (byOwner) {
      console.log(
        `[DB Fix] Successfully found store for owner: ${byOwner.id} ` +
        `(owner_id로 매장 발견 | 매장: ${byOwner.id})`
      );
    }

    console.log(
      `[Layout] store lookup pass 1 (owner_id) | user: ${user.id} | ` +
      `found: ${byOwner?.id ?? 'null'} | err: ${ownerErr?.message ?? 'none'} ` +
      `(레이아웃 1단계 조회 (owner_id) | 사용자: ${user.id} | 결과: ${byOwner?.id ?? 'null'})`
    );

    linkedStore = byOwner;

    if (!linkedStore) {
      // Pass 2: fall back to auth_user_id — used when store was provisioned via Supabase Auth
      // (2단계 폴백: auth_user_id — Supabase Auth로 매장이 프로비저닝된 경우 사용)
      console.log(`[DB Trace] Pass 2 — searching stores WHERE auth_user_id = '${user.id}' (auth_user_id로 매장 검색)`);
      const { data: rowsAuth, error: authErr } = await supabase
        .from('stores')
        .select('id, name')
        .eq('auth_user_id', user.id)
        .order('name', { ascending: true })
        .limit(1);

      const byAuth: LinkedStore | null = rowsAuth?.[0] ?? null;

      // Log explicit Supabase error so failures are never silent (Supabase 오류 명시적 로그 — 조용한 실패 방지)
      if (authErr) {
        console.error(
          `[DB Fix] Supabase error on auth_user_id lookup | user: ${user.id} | ${authErr.message} ` +
          `(auth_user_id 조회 Supabase 오류 | 사용자: ${user.id} | 오류: ${authErr.message})`
        );
      }
      if (byAuth) {
        console.log(
          `[DB Fix] Successfully found store for owner: ${byAuth.id} ` +
          `(auth_user_id로 매장 발견 | 매장: ${byAuth.id})`
        );
      }

      console.log(
        `[Layout] store lookup pass 2 (auth_user_id) | user: ${user.id} | ` +
        `found: ${byAuth?.id ?? 'null'} | err: ${authErr?.message ?? 'none'} ` +
        `(레이아웃 2단계 조회 (auth_user_id) | 사용자: ${user.id} | 결과: ${byAuth?.id ?? 'null'})`
      );

      linkedStore = byAuth;
    }

    // Log a clear warning when neither lookup produced a result — actionable for debugging.
    // (어느 조회도 결과를 반환하지 않은 경우 명확한 경고 기록 — 디버깅에 직접적으로 활용)
    if (!linkedStore) {
      console.warn(
        `[Layout] No store found for user ${user.id} after trying both owner_id and auth_user_id columns. ` +
        `Ensure the stores table has one of these columns populated with the Supabase auth user UUID. ` +
        `(사용자 ${user.id}에 대해 owner_id와 auth_user_id 컬럼 모두 시도했지만 매장 미발견. ` +
        `stores 테이블에 Supabase auth 사용자 UUID가 채워져 있는지 확인 필요)`
      );
    }
  }

  // Resolve DashboardShell props — empty string fallbacks prevent crashes for no-store users.
  // (DashboardShell props 확인 — 매장 없는 사용자에게 빈 문자열 폴백으로 오류 방지)
  const storeId   = linkedStore?.id   ?? '';
  const agentId   = linkedStore?.id   ?? '';   // agent_id column does not exist; use store id as agent id fallback (agent_id 컬럼 없음 — 매장 id를 에이전트 id 폴백으로 사용)
  const storeName = linkedStore?.name ?? '';

  return (
    <DashboardShell
      storeId={storeId}
      agentId={agentId}
      storeName={storeName}
      role={role}
      email={email}
      allStores={allStores}
    >
      {children}
    </DashboardShell>
  );
}
