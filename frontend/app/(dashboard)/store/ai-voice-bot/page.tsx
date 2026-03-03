// Store AI Voice Bot page — async Server Component.
// Authenticates the user server-side and fetches the linked store directly from Supabase.
// Also resolves the user's role from the profiles table so PersonaEditor can enforce
// read-only access on the Essential Prompt for store-role users.
// This pattern mirrors store/page.tsx (Overview) and is the correct Next.js App Router
// approach: each page owns its own data fetch so no client-side state is needed.
// (스토어 AI Voice Bot 페이지 — 비동기 서버 컴포넌트.
//  서버 사이드에서 사용자를 인증하고 Supabase에서 연결된 매장을 직접 조회.
//  PersonaEditor가 매장 역할 사용자에게 필수 프롬프트 읽기 전용을 강제할 수 있도록
//  profiles 테이블에서 사용자 역할도 확인.
//  이 패턴은 store/page.tsx(개요)와 동일하며 올바른 Next.js App Router 방식:
//  각 페이지가 자체 데이터 조회를 수행하므로 클라이언트 상태가 불필요)

import { Building2 }                  from 'lucide-react';
import { createServerSupabaseClient } from '@/shared/api/supabaseServer';
import { PersonaEditor }              from '@/modules/ai-voice-bot/components/PersonaEditor';
import { LiveCallLog }                from '@/modules/ai-voice-bot/components/LiveCallLog';

// Store row shape returned by the direct DB query — includes both prompt columns.
// (직접 DB 쿼리로 반환되는 매장 행 형태 — 두 프롬프트 컬럼 모두 포함)
interface StoreRow {
  id:               string;
  name:             string;
  system_prompt:    string | null;
  temporary_prompt: string | null;
  [key: string]: unknown; // allow select('*') extra columns (select('*') 추가 열 허용)
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function StoreAiVoiceBotPage() {
  const supabase = await createServerSupabaseClient();

  // Verify session via server-side JWT — more secure than getSession().
  // (서버 사이드 JWT로 세션 확인 — getSession()보다 안전)
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Layout auth guard should already redirect — handle defensively here.
    // (레이아웃 인증 가드가 이미 리다이렉트해야 하지만 방어적으로 처리)
    return <EmptyState message="You must be logged in to view this page." />;
  }

  // Resolve the user's role from profiles — needed for PersonaEditor's access control.
  // maybeSingle() returns null without error if the profile row doesn't exist yet.
  // Default to 'agency' to avoid locking out users with an incomplete profile.
  // (PersonaEditor 접근 제어를 위해 profiles에서 사용자 역할 확인.
  //  maybeSingle()은 프로필 행이 없을 때 오류 없이 null 반환.
  //  불완전한 프로필을 가진 사용자를 잠그지 않도록 기본값 'agency' 사용)
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: 'agency' | 'store' }>();

  const role: 'agency' | 'store' = profile?.role ?? 'agency';

  // Fetch the store linked to this user via owner_id — the same query the Overview uses.
  // single() is used here; if no store is found it returns an error (not null), which
  // we treat as "no store linked" and show the empty state.
  // (owner_id로 이 사용자에 연결된 매장 조회 — 개요 페이지와 동일한 쿼리.
  //  single() 사용; 매장이 없으면 오류를 반환(null 아님), 이를 "연결 매장 없음"으로 처리)
  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .eq('owner_id', user.id)
    .single<StoreRow>();

  if (storeError || !store) {
    // Log server-side warning to aid debugging when owner_id has no linked store.
    // (owner_id에 연결된 매장이 없을 때 디버깅을 돕기 위한 서버 사이드 경고 기록)
    console.warn(`[ai-voice-bot] No store found for owner_id: ${user.id}`);
    return <EmptyState message="No store linked to this account." />;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">AI Voice Bot</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Manage your AI persona and review recent voice-ordered orders for{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-200">{store.name}</span>.
        </p>
      </div>

      {/* Two-column grid on xl+ screens; stacked on smaller viewports.
          (xl+ 화면에서 2열 그리드; 소형 화면에서 세로 적층) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

        {/* PersonaEditor — edit the AI persona for this store.
            userRole controls whether the Essential Prompt textarea is editable.
            Store users see it read-only; agency users can edit both sections.
            (PersonaEditor — 이 매장의 AI 페르소나 편집.
             userRole로 필수 프롬프트 텍스트에리어 편집 가능 여부 제어.
             매장 사용자는 읽기 전용; 에이전시 사용자는 두 섹션 모두 편집 가능) */}
        <PersonaEditor store={store} userRole={role} />

        {/* LiveCallLog — latest 10 voice-ordered orders for this store.
            (LiveCallLog — 이 매장의 음성 주문 최근 10건) */}
        <LiveCallLog storeId={store.id} />
      </div>
    </div>
  );
}

// ── Empty state helper ────────────────────────────────────────────────────────

// Renders a centred message when auth fails or no store is linked to the user.
// No redirect — prevents infinite loop with the layout auth guard.
// (인증 실패 또는 사용자에게 연결된 매장이 없을 때 가운데 정렬 메시지 렌더링.
//  리다이렉트 없음 — 레이아웃 인증 가드와의 무한 루프 방지)
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
        <Building2 className="h-8 w-8 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="text-base font-semibold text-gray-700 dark:text-gray-300">{message}</p>
      <p className="mt-2 max-w-xs text-sm text-gray-400 dark:text-gray-500">
        Contact your administrator to link a store to your account.
      </p>
    </div>
  );
}
