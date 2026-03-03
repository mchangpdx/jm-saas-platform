// Store Analytics page — async Server Component.
// Authenticates the user server-side and fetches the linked store directly from Supabase.
// Renders two sections in a responsive single-column layout:
//   1. This Month's Performance — three KPI cards (calls, revenue, upsell estimate).
//   2. Revenue Trend — 7-day AreaChart of paid orders.
// Each section uses a labelled header so the dashboard feels structured and scannable.
// (스토어 분석 페이지 — 비동기 서버 컴포넌트.
//  서버 사이드에서 사용자를 인증하고 Supabase에서 연결된 매장을 직접 조회.
//  반응형 단일 열 레이아웃에 두 섹션 렌더링:
//    1. 이번 달 실적 — 세 가지 KPI 카드 (통화, 매출, 업셀 추정치).
//    2. 매출 추세  — 결제 주문 7일 AreaChart.
//  각 섹션에 레이블 헤더를 사용하여 대시보드를 구조화되고 읽기 쉽게 구성)

import { Building2 }                    from 'lucide-react';
import { createServerSupabaseClient }   from '@/shared/api/supabaseServer';
import { CallStatsWidget, RevenueChart } from '@/modules/analytics';

// Minimal store shape — only id and name are needed by this page.
// (이 페이지에 필요한 최소 매장 형태 — id와 name만 필요)
interface StoreRow {
  id:   string;
  name: string;
  [key: string]: unknown; // allow select('*') extra columns (select('*') 추가 열 허용)
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function StoreAnalyticsPage() {
  const supabase = await createServerSupabaseClient();

  // Verify session via server-side JWT — more secure than getSession().
  // (서버 사이드 JWT로 세션 확인 — getSession()보다 안전)
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    // Layout auth guard should already redirect — handle defensively here.
    // (레이아웃 인증 가드가 이미 리다이렉트해야 하지만 방어적으로 처리)
    return <EmptyState message="You must be logged in to view this page." />;
  }

  // Fetch the store linked to this user via owner_id — the same query the Overview uses.
  // single() returns an error (not null) when no row exists — treat that as "no store linked".
  // (owner_id로 이 사용자에 연결된 매장 조회 — 개요 페이지와 동일한 쿼리.
  //  single()은 행이 없을 때 null이 아닌 오류 반환 — "연결 매장 없음"으로 처리)
  const { data: store, error: storeError } = await supabase
    .from('stores')
    .select('*')
    .eq('owner_id', user.id)
    .single<StoreRow>();

  if (storeError || !store) {
    // Log server-side warning to aid debugging when owner_id has no linked store.
    // (owner_id에 연결된 매장이 없을 때 디버깅을 돕기 위한 서버 사이드 경고 기록)
    console.warn(`[analytics] No store found for owner_id: ${user.id}`);
    return <EmptyState message="No store linked to this account." />;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* Page heading — store name in the subtitle (페이지 제목 — 부제목에 매장명 표시) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          AI-generated revenue and call volume metrics for{' '}
          <span className="font-semibold text-gray-700 dark:text-gray-200">{store.name}</span>.
        </p>
      </div>

      {/* ── Section 1: This Month's Performance ─────────────────────────────── */}
      {/* Three KPI cards: Total Calls Handled, Total AI Revenue, Estimated Upsell Value.
          Data scope is the current calendar month; values update on each page load.
          (세 KPI 카드: 총 통화 처리, 총 AI 매출, 예상 업셀 가치.
           데이터 범위는 현재 달력 월; 페이지 로드 시마다 값 업데이트) */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          This Month&apos;s Performance
        </h3>
        <CallStatsWidget storeId={store.id} />
      </section>

      {/* ── Section 2: Revenue Trend ─────────────────────────────────────────── */}
      {/* 7-day AreaChart of paid orders. Dark mode colours adapt automatically.
          Empty state: "No data available for this period. Let the AI handle more calls!"
          (결제 주문 7일 AreaChart. 다크 모드 색상 자동 적응.
           빈 상태: "이 기간에 데이터가 없습니다. AI가 더 많은 통화를 처리하게 하세요!") */}
      <section>
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
          Revenue Trend — Last 7 Days
        </h3>
        <RevenueChart storeId={store.id} />
      </section>

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
