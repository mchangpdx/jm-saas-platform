// Agency Analytics page — resolves the authenticated user's ID (used as agency_id)
// and passes it to AnalyticsDashboard with mode='agency'.
// The dashboard then queries stores WHERE agency_id = agencyId and aggregates across all of them.
// (에이전시 애널리틱스 페이지 — 인증된 사용자 ID(agency_id로 사용)를 확인하고
//  mode='agency'와 함께 AnalyticsDashboard에 전달.
//  대시보드는 agency_id = agencyId인 매장을 조회하고 전체 집계를 수행)

'use client';

import { useState, useEffect }           from 'react';
import { Activity }                      from 'lucide-react';
import { getSupabaseClient }             from '@/shared/api/supabaseClient';
import { AnalyticsDashboard }            from '@/shared/components/AnalyticsDashboard';

export default function AgencyAnalyticsPage() {
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [loading,  setLoading ] = useState(true);

  // Resolve the authenticated user's ID to use as agency_id for store lookups (매장 조회의 agency_id로 사용할 인증 사용자 ID 확인)
  useEffect(() => {
    getSupabaseClient()
      .auth.getUser()
      .then(({ data: { user } }) => {
        setAgencyId(user?.id ?? null);
        setLoading(false);
      });
  }, []);

  if (loading) {
    // Show a minimal pulse skeleton while resolving auth (인증 확인 중 최소 펄스 스켈레톤 표시)
    return (
      <div className="flex flex-col gap-6">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="animate-pulse rounded-2xl bg-slate-800/50 h-32" />
        ))}
      </div>
    );
  }

  if (!agencyId) {
    // Auth resolved but no user — layout guard should have redirected; show fallback (인증은 완료됐으나 사용자 없음 — 레이아웃 가드가 리다이렉트해야 하나 폴백 표시)
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <Activity className="h-8 w-8 text-slate-700 mb-3" />
        <p className="text-sm text-slate-500">Not authenticated.</p>
      </div>
    );
  }

  return <AnalyticsDashboard mode="agency" id={agencyId} />;
}
