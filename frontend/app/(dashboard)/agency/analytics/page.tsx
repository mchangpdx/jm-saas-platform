// Agency Analytics page — reads the agency-selected store from Zustand and delegates all
// rendering to the shared AnalyticsDashboard component.
// (에이전시 애널리틱스 페이지 — Zustand에서 에이전시 선택 매장을 읽고
//  공유 AnalyticsDashboard 컴포넌트에 모든 렌더링을 위임합니다.)

'use client';

import { useSessionStore }    from '@/shared/stores/sessionStore';
import { AnalyticsDashboard } from '@/shared/components/AnalyticsDashboard';

export default function AgencyAnalyticsPage() {
  // Agency-wide store selection driven by the sidebar dropdown (사이드바 드롭다운으로 설정된 에이전시 전체 매장 선택)
  const selectedStoreId = useSessionStore((s) => s.selectedStoreId);

  return (
    <AnalyticsDashboard
      storeId={selectedStoreId}
      emptyStateLabel="Select a store from the sidebar to view analytics."
    />
  );
}
