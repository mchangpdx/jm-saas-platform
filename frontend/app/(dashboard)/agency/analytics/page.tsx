// Agency Analytics page — reads the agency-selected store from Zustand and delegates all
// rendering to the shared AnalyticsDashboard component.
// (에이전시 애널리틱스 페이지 — Zustand에서 에이전시 선택 매장을 읽고
//  공유 AnalyticsDashboard 컴포넌트에 모든 렌더링을 위임합니다.)

'use client';

import { AnalyticsDashboard } from '@/shared/components/AnalyticsDashboard';

export default function AgencyAnalyticsPage() {
  // Agency mode — component resolves all owned stores internally via auth.getUser().
  // (에이전시 모드 — 컴포넌트가 auth.getUser()로 소유 매장을 내부에서 직접 확인)
  return (
    <AnalyticsDashboard mode="agency" />
  );
}
