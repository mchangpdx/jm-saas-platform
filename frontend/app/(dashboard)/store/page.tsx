// Store dashboard page — Server Component that authenticates the current user,
// queries the stores table by owner_id, and renders the full dashboard:
//   1. Call-stats KPI cards (top)
//   2. AI revenue area chart (middle)
//   3. PersonaEditor + LiveCallLog side by side (bottom)
// If no store is linked, an informative empty state is shown without any redirect.
// (스토어 대시보드 페이지 — 현재 사용자 인증, owner_id로 stores 테이블 조회 후
//  전체 대시보드 렌더링:
//   1. 통화 통계 KPI 카드 (상단)
//   2. AI 매출 AreaChart (중간)
//   3. PersonaEditor + LiveCallLog 나란히 (하단)
//  연결된 매장이 없으면 리다이렉트 없이 안내 빈 상태 표시)

import { Building2 }                   from 'lucide-react';
import { createServerSupabaseClient }  from '@/shared/api/supabaseServer';
import { PersonaEditor }               from '@/modules/ai-voice-bot/components/PersonaEditor';
import { LiveCallLog }                 from '@/modules/ai-voice-bot/components/LiveCallLog';
import { RevenueChart, CallStatsWidget } from '@/modules/analytics';

// Store shape fetched from Supabase (Supabase에서 조회한 매장 형태)
interface StoreRow {
  id:            string;
  name:          string;
  system_prompt: string | null;
}

// ── Page ────────────────────────────────────────────────────────────────────

export default async function StorePage() {
  const supabase = await createServerSupabaseClient();

  // Verify the session via server-side JWT — more secure than getSession().
  // (서버 사이드 JWT로 세션 확인 — getSession()보다 안전)
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Layout auth guard should already redirect — handle defensively here.
    // (레이아웃 인증 가드가 이미 리다이렉트해야 하지만 방어적으로 처리)
    return <EmptyState message="You must be logged in to view this page." />;
  }

  // Resolve the store linked to this user via the owner_id column.
  // maybeSingle() returns null data without an error when no row matches.
  // (owner_id 컬럼으로 이 사용자에 연결된 매장 확인.
  //  maybeSingle()은 일치하는 행 없을 때 오류 없이 null 반환)
  const { data: store } = await supabase
    .from('stores')
    .select('id, name, system_prompt')
    .eq('owner_id', user.id)
    .maybeSingle<StoreRow>();

  if (!store) {
    return <EmptyState message="No store linked to this account." />;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Page heading with store name and live indicator
          (매장명과 라이브 표시가 있는 페이지 제목) */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
            {store.name}
          </h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            AI ROI analytics, persona control, and live call orders — all in one place.
          </p>
        </div>

        {/* Animated live indicator pill (애니메이션 라이브 표시 pill) */}
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700 ring-1 ring-green-200 dark:bg-green-900/20 dark:text-green-400 dark:ring-green-800">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
          Live
        </span>
      </div>

      {/* ── Section 1: KPI stat cards ──────────────────────────────────────── */}
      {/* Three counters: Total Calls Handled, Orders Placed, Reservations Made
          (총 통화 처리, 주문, 예약 세 가지 카운터) */}
      <CallStatsWidget storeId={store.id} />

      {/* ── Section 2: AI revenue area chart — full width ─────────────────── */}
      {/* Visualises daily revenue from paid orders over the last 7 days.
          (최근 7일간 결제 주문의 일별 매출을 시각화) */}
      <RevenueChart storeId={store.id} />

      {/* ── Section 3: Persona + call log ─────────────────────────────────── */}
      {/* Two-column grid on xl+ screens; stacked on smaller viewports.
          (xl+ 화면에서 2열 그리드; 소형 화면에서 세로 적층) */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">

        {/* PersonaEditor — edit the AI system prompt for this store
            (PersonaEditor — 이 매장의 AI 시스템 프롬프트 편집) */}
        <PersonaEditor store={store} />

        {/* LiveCallLog — latest 10 voice-ordered orders
            (LiveCallLog — 음성 주문된 최근 10건) */}
        <LiveCallLog storeId={store.id} />
      </div>
    </div>
  );
}

// ── Empty state helper ───────────────────────────────────────────────────────

// Centered informational message rendered when the store lookup returns nothing.
// No redirect — avoids the /login ↔ /agency infinite loop.
// (store 조회 결과 없을 때 렌더링되는 가운데 정렬 안내 메시지.
//  리다이렉트 없음 — /login ↔ /agency 무한 루프 방지)
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
