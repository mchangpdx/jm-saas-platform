'use client';

import Link                        from 'next/link';
import { Mic, CalendarCheck }      from 'lucide-react';
import { useStoreContext }         from '@/shared/contexts/StoreContext';
import { useSessionStore }         from '@/shared/stores/sessionStore';
import { AnalyticsDashboard }      from '@/shared/components/AnalyticsDashboard';
import { useEffect, useState }     from 'react';

export default function AgencyOverviewPage() {
  const storeContext = useStoreContext() as any;
  const session = useSessionStore((s: any) => s);

  const [finalId, setFinalId] = useState<string>('');

  // [핵심 픽스] 빈칸 에러를 막기 위해, 세션이나 컨텍스트에서 진짜 ID가 로딩될 때까지 추적합니다.
  useEffect(() => {
    // 1순위: 로그인한 유저 ID (보통 에이전시 오너 ID) / 2순위: StoreContext의 agentId
    const resolvedId = session?.user?.id || session?.session?.user?.id || storeContext?.agentId || storeContext?.agencyId || '';
    
    if (resolvedId !== '') {
      console.log('[X-Ray] Agency ID Successfully Resolved:', resolvedId);
      setFinalId(resolvedId);
    }
  }, [session, storeContext]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          Agency Overall Performance
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Aggregated across all stores.
        </p>
      </div>

      {/* [가장 중요한 픽스] finalId가 빈칸일 때는 대시보드를 아예 부르지 않고 기다립니다. 
          ID가 채워지는 순간 대시보드가 렌더링되면서 DB를 정상적으로 타격합니다! */}
      {!finalId ? (
        <div className="flex flex-col items-center justify-center min-h-[400px] bg-white border border-gray-200 rounded-xl shadow-sm">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4"></div>
          <p className="text-gray-500 font-medium">Loading agency data...</p>
        </div>
      ) : (
        <AnalyticsDashboard mode="agency" id={finalId} forceAggregation={true} />
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/agency/ai-voice-bot"
          className="flex items-start gap-4 rounded-xl border border-indigo-100 bg-indigo-50 p-5 transition hover:border-indigo-200 hover:bg-indigo-100 dark:border-indigo-900/40 dark:bg-indigo-900/20 dark:hover:bg-indigo-900/30"
        >
          <Mic className="mt-0.5 h-6 w-6 shrink-0 text-indigo-600 dark:text-indigo-400" />
          <div>
            <p className="font-semibold text-indigo-900 dark:text-indigo-200">AI Voice Bot</p>
            <p className="mt-0.5 text-sm text-indigo-700 dark:text-indigo-400">
              Manage system prompts and review call logs.
            </p>
          </div>
        </Link>

        <Link
          href="/agency/reservations"
          className="flex items-start gap-4 rounded-xl border border-blue-100 bg-blue-50 p-5 transition hover:border-blue-200 hover:bg-blue-100 dark:border-blue-900/40 dark:bg-blue-900/20 dark:hover:bg-blue-900/30"
        >
          <CalendarCheck className="mt-0.5 h-6 w-6 shrink-0 text-blue-600 dark:text-blue-400" />
          <div>
            <p className="font-semibold text-blue-900 dark:text-blue-200">Reservations</p>
            <p className="mt-0.5 text-sm text-blue-700 dark:text-blue-400">
              View and manage upcoming guest reservations.
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}