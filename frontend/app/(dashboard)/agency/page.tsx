// Agency overview page — landing page after login for agency-role users.
// Shows full aggregated analytics via AnalyticsDashboard in agency mode.
// When a store is selected in the sidebar, AnalyticsDashboard isolates to that store.
// Module shortcuts are rendered below the dashboard for quick navigation.
// (에이전시 개요 페이지 — 에이전시 역할 사용자 로그인 후 랜딩 페이지.
//  에이전시 모드의 AnalyticsDashboard로 전체 집계 분석을 표시.
//  사이드바에서 매장 선택 시 해당 매장 데이터만 격리. 하단에 모듈 바로가기 렌더링)

'use client';

import Link                        from 'next/link';
import { Mic, CalendarCheck }      from 'lucide-react';
import { useSessionStore }         from '@/shared/stores/sessionStore';
import { AnalyticsDashboard }      from '@/shared/components/AnalyticsDashboard';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgencyOverviewPage() {
  // agentId is the agency's ID — used as the `id` prop for AnalyticsDashboard in agency mode.
  // AnalyticsDashboard queries stores WHERE agency_id = agentId to aggregate all stores.
  // (agentId는 에이전시의 ID — agency 모드 AnalyticsDashboard의 `id` prop으로 사용.
  //  AnalyticsDashboard는 agency_id = agentId인 매장을 조회하여 전체 집계)
  const agentId = useSessionStore((s) => s.agentId);

  return (
    <div className="space-y-8">

      {/* Page heading (페이지 제목) */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          Agency Overall Performance
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          에이전시 전체 통합 통계 — aggregated across all stores. Select a store in the sidebar to filter.
        </p>
      </div>

      {/* Full analytics dashboard — agency mode aggregates all stores for this agency.
          When selectedStoreId is set in Zustand, AnalyticsDashboard scopes to that store only.
          (전체 분석 대시보드 — agency 모드로 이 에이전시의 모든 매장 데이터를 집계.
           Zustand에 selectedStoreId가 설정되면 해당 매장 데이터만 표시) */}
      {agentId ? (
        <AnalyticsDashboard mode="agency" id={agentId} />
      ) : (
        <p className="text-sm text-gray-400">Loading agency context…</p>
      )}

      {/* Module shortcuts — quick navigation to key agency modules (주요 에이전시 모듈로의 빠른 내비게이션) */}
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
