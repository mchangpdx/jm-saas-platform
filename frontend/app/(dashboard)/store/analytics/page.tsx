// Store Analytics page — reads the store's own storeId from Zustand session state
// (set by DashboardShell on mount) and delegates all rendering to the shared
// AnalyticsDashboard component.
// (매장 애널리틱스 페이지 — Zustand 세션 상태에서 매장 고유 storeId를 읽어
//  (DashboardShell이 마운트 시 설정)
//  공유 AnalyticsDashboard 컴포넌트에 모든 렌더링을 위임합니다.)

'use client';

import { useSessionStore }    from '@/shared/stores/sessionStore';
import { AnalyticsDashboard } from '@/shared/components/AnalyticsDashboard';

export default function StoreAnalyticsPage() {
  // Store's own storeId — set by DashboardShell after auth resolves (DashboardShell이 인증 확인 후 설정하는 매장 고유 storeId)
  const storeId = useSessionStore((s) => s.storeId);

  return (
    <AnalyticsDashboard
      storeId={storeId}
      emptyStateLabel="No store linked to your account yet."
    />
  );
}
