'use client';

import Link                        from 'next/link';
import { Mic, CalendarCheck }      from 'lucide-react';
import { useStoreContext }         from '@/shared/contexts/StoreContext';
import { useSessionStore }         from '@/shared/stores/sessionStore';
import { AnalyticsDashboard }      from '@/shared/components/AnalyticsDashboard';

export default function AgencyOverviewPage() {
  const storeContext = useStoreContext() as any;
  const session = useSessionStore((s: any) => s);

  // [핵심 픽스] 클로드의 오타(agentId)를 무시하고, 실제 존재하는 에이전시 ID를 영혼까지 끌어모아 찾습니다.
  const finalId = storeContext.agencyId || storeContext.id || storeContext.agentId || session.user?.id || '';

  return (
    <div className="space-y-8">
      {/* 페이지 제목 */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          Agency Overall Performance
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          Aggregated across all stores.
        </p>
      </div>

      {/* 대시보드 렌더링 - 찾은 finalId를 넣고, 강제 합산(forceAggregation) 스위치를 켭니다 */}
      <AnalyticsDashboard mode="agency" id={finalId} forceAggregation={true} />

      {/* 모듈 바로가기 */}
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