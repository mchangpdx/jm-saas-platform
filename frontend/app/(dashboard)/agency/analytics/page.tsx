// Agency Analytics page — reads the globally selected store from the Zustand session
// store (set by the sidebar dropdown in DashboardShell) and immediately renders
// AI ROI metrics: KPI cards and revenue chart for that store.
// (에이전시 분석 페이지 — Zustand 세션 스토어에서 전역 선택 매장을 읽어
//  (DashboardShell의 사이드바 드롭다운으로 설정)
//  해당 매장의 AI ROI 지표(KPI 카드 + 매출 차트)를 즉시 표시)

'use client';

import { BarChart2 }                    from 'lucide-react';
import { useSessionStore }              from '@/shared/stores/sessionStore';
import { CallStatsWidget, RevenueChart } from '@/modules/analytics';

export default function AnalyticsPage() {
  const selectedStoreId = useSessionStore((s) => s.selectedStoreId);

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          AI-generated revenue and call volume metrics for the selected store.
        </p>
      </div>

      {/* No store selected — prompt the user to use the sidebar selector
          (선택된 매장 없음 — 사이드바 선택기 사용을 안내) */}
      {!selectedStoreId && (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 py-24 text-center dark:border-gray-700">
          <BarChart2 className="mb-3 h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
            Select a store from the sidebar to view analytics.
          </p>
        </div>
      )}

      {/* ── Analytics content — rendered once a store is selected ─────────────── */}
      {/* key on each component forces a clean remount when selectedStoreId changes,
          guaranteeing data and chart state reset to the new store.
          (selectedStoreId 변경 시 각 컴포넌트에 key를 사용해 강제 리마운트,
           데이터와 차트 상태가 새 매장 기준으로 초기화됨) */}
      {selectedStoreId && (
        <div className="space-y-6">

          {/* KPI stat cards — Total Calls Handled, Orders Placed, Reservations Made
              (KPI 통계 카드 — 총 통화 처리, 주문, 예약) */}
          <CallStatsWidget
            key={`stats-${selectedStoreId}`}
            storeId={selectedStoreId}
          />

          {/* AI revenue area chart — last 7 days of paid orders
              (AI 매출 AreaChart — 최근 7일간 결제 주문) */}
          <RevenueChart
            key={`chart-${selectedStoreId}`}
            storeId={selectedStoreId}
          />
        </div>
      )}
    </div>
  );
}
