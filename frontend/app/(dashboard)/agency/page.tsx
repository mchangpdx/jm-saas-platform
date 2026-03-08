'use client';

import Link                        from 'next/link';
import { Mic, CalendarCheck }      from 'lucide-react';
import { useStoreContext }         from '@/shared/contexts/StoreContext';
import { AnalyticsDashboard }      from '@/shared/components/AnalyticsDashboard';

export default function AgencyOverviewPage() {
  // 원래 개발자가 설계한 가장 안정적인 동기식 ID 호출 (agentId가 맞습니다!)
  const { agentId } = useStoreContext();

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

      {/* 복잡한 로딩 화면 다 치우고 원래대로 렌더링! 
          빈칸("") 에러는 이미 AnalyticsDashboard 내부에서 완벽하게 차단하고 있습니다. */}
      <AnalyticsDashboard mode="agency" id={agentId} forceAggregation={true} />

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