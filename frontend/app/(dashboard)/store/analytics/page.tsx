// Store Analytics page — reads this store's storeId from Zustand session state
// (set by DashboardShell on mount) and passes it to AnalyticsDashboard with mode='store'.
// The dashboard fetches call_logs and paid orders WHERE store_id = storeId.
// (매장 애널리틱스 페이지 — Zustand 세션 상태에서 storeId를 읽어
//  mode='store'와 함께 AnalyticsDashboard에 전달.
//  대시보드는 store_id = storeId인 call_logs와 결제 완료 주문을 조회)

'use client';

import { Activity }         from 'lucide-react';
import { useSessionStore }  from '@/shared/stores/sessionStore';
import { AnalyticsDashboard } from '@/shared/components/AnalyticsDashboard';

export default function StoreAnalyticsPage() {
  // storeId set by DashboardShell after auth resolves — null before hydration (DashboardShell이 인증 확인 후 설정하는 storeId — 하이드레이션 전에는 null)
  const storeId = useSessionStore((s) => s.storeId);

  if (!storeId) {
    // Guard against pre-hydration render — avoids passing an empty string to Supabase queries (빈 문자열이 Supabase 쿼리에 전달되는 것을 방지하는 하이드레이션 전 렌더링 가드)
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Activity className="h-8 w-8 text-slate-700 mb-3" />
        <p className="text-sm text-slate-500">No store linked to your account yet.</p>
      </div>
    );
  }

  return <AnalyticsDashboard mode="store" id={storeId} />;
}
